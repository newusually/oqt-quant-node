/* ============================================================================
 * modules/okx/engines/analysis.js —— AI 市场分析【全市场 500+ 合约】
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）：
 *   "AI 市场分析 要求500多合约的分析"
 *   "合约分布 应该是各个板块分布"
 *   "合约各个介绍和概念都要保存在数据库然后分类各个合约和股票"
 *
 * ★全部真实计算（无 LLM 依赖，稳定可复现）：
 *   1) 全市场 507 合约涨跌家数/成交额统计
 *   2) 板块分布：公链/扩容/DeFi/Meme/AI/基础设施… 各自涨跌与情绪
 *   3) 极端异动榜（涨/跌 top）
 *   4) 板块代表合约 + 概念（来自 insts 概念库）
 *   5) 多参数加权评分 → 文字结论 + 操作建议
 * 缓存 10 秒
 * [taker removed 2026-10-26] 主动买卖量相关统计与输出已移除
 * ========================================================================== */
'use strict';

const TTL = 10000;
let CACHE = null, CACHE_AT = 0;

function f1(v) { return +(+v).toFixed(1); }
function f2(v) { return +(+v).toFixed(2); }

async function analyze(force) {
  if (!force && CACHE && Date.now() - CACHE_AT < TTL) return CACHE;
  try {
    const T = require('./universe');
    const I = require('./insts');
    const S = require('./sentiment');

    const [u, q, sentiment, tree] = await Promise.all([
      T.universe(),
      T.quotesAll(),
      S.compute(false, 1),
      Promise.resolve(I.tree())
    ]);
    if (!u.ok || !q.ok) return CACHE || { ok: false, err: '数据源未就绪' };

    /* ---- 1) 全市场统计 ---- */
    let up = 0, down = 0, flat = 0, turn = 0, pctW = 0;
    const rows = [];
    for (const x of u.list) {
      const t = q.map[x.instId];
      if (!t) continue;
      const pct = t.pct1d || 0;
      if (pct > 0) up++; else if (pct < 0) down++; else flat++;
      turn += (t.turn || 0);
      pctW += pct * (t.turn || 0);
      rows.push({
        instId: x.instId, sym: x.sym, name: x.name, sector: x.sector,
        pct, px: t.px, turn: t.turn || 0
      });
    }
    const total = rows.length;
    const takerCov = null;
    const pctAvg = turn > 0 ? pctW / turn : 0;

    /* ---- 2) 板块分布（一级） ---- */
    const by = {};
    for (const r of rows) {
      const sid = r.sector || 'other';
      (by[sid] = by[sid] || { id: sid, count: 0, up: 0, down: 0, turn: 0, pctW: 0, syms: [] });
      const b = by[sid];
      b.count++; if (r.pct > 0) b.up++; else if (r.pct < 0) b.down++;
      b.turn += r.turn; b.pctW += r.pct * r.turn;
      b.syms.push(r);
    }
    const secMeta = {};
    (tree.sectors || []).forEach(s => { secMeta[s.id] = s; });
    const sectors = Object.keys(by).map(sid => {
      const b = by[sid];
      const pAvg = b.turn > 0 ? b.pctW / b.turn : 0;
      const top = b.syms.slice().sort((x, y) => y.pct - x.pct)[0];
      return {
        id: sid, name: (secMeta[sid] && secMeta[sid].name) || sid,
        icon: (secMeta[sid] && secMeta[sid].icon) || '',
        count: b.count, up: b.up, down: b.down, pctAvg: f2(pAvg),
        turn: Math.round(b.turn), takerCov: null, takerBuy: null,
        topSym: top ? { sym: top.sym, name: top.name, pct: f2(top.pct) } : null,
        hotSym: null,
        concept: top ? (I.get(top.sym) || {}).concept || '' : '',
        subs: (secMeta[sid] && secMeta[sid].subs || []).map(x => ({ id: x.id, name: x.name, count: x.count }))
      };
    }).sort((a, b) => b.turn - a.turn);

    /* ---- 3) 极端异动榜 ---- */
    const gainTop = rows.slice().sort((a, b) => b.pct - a.pct).slice(0, 10)
      .map(r => ({ sym: r.sym, name: r.name, sector: r.sector, pct: f2(r.pct), px: r.px, turn: Math.round(r.turn) }));
    const loseTop = rows.slice().sort((a, b) => a.pct - b.pct).slice(0, 10)
      .map(r => ({ sym: r.sym, name: r.name, sector: r.sector, pct: f2(r.pct), px: r.px, turn: Math.round(r.turn) }));
    /* taker 极端（已移除：taker removed 2026-10-26） */
    const withTk = [];
    const takerStrong = [];
    const takerWeak = [];

    /* ---- 4) ★各合约情绪分（用户 2026-10-25 第三轮: "各个合约 各个板块的情绪"）
     *   ★必须先算：后面的 bullets / reads / moodTop 都依赖它（否则 TDZ 报错）
     *   公式（与板块情绪同源，尺度一致，便于横截面对比）：
     *     score = 100 × (0.6×当日涨跌映射 + 0.4×成交额动能)
     *   涨跌映射: pct1d ∈ [-5%, +5%] 线性映射到 [0,1]
     *   成交额动能: 该合约成交额在全市场的相对位置（活跃度 0~1）
     */
    const maxTurn = Math.max(1, ...rows.map(r => r.turn));
    for (const r of rows) {
      const dir = Math.max(0, Math.min(1, 0.5 + (r.pct || 0) / 10));   // ±5% → 0~1
      const act = Math.max(0, Math.min(1, (r.turn || 0) / maxTurn));
      const ms = Math.round(100 * (0.6 * dir + 0.4 * act));
      r.mood = ms;
      r.moodLabel = ms >= 75 ? '极贪婪' : ms >= 60 ? '贪婪' : ms >= 40 ? '中性' : ms >= 25 ? '恐惧' : '极恐惧';
      r.moodColor = ms >= 75 ? '#f0334b' : ms >= 60 ? '#f06a7a' : ms >= 40 ? '#f0a020' : ms >= 25 ? '#3d9be8' : '#0bbf7a';
      r.longShort = '中性';
      r.longShortColor = '#8b94ad';
    }
    const moodTop = rows.slice().sort((a, b) => b.mood - a.mood).slice(0, 10)
      .map(r => ({ sym: r.sym, name: r.name, sector: r.sector, pct: f2(r.pct), mood: r.mood, moodLabel: r.moodLabel, moodColor: r.moodColor, longShort: r.longShort }));
    const moodLow = rows.slice().sort((a, b) => a.mood - b.mood).slice(0, 10)
      .map(r => ({ sym: r.sym, name: r.name, sector: r.sector, pct: f2(r.pct), mood: r.mood, moodLabel: r.moodLabel, moodColor: r.moodColor, longShort: r.longShort }));

    /* ---- 5) AI 多参数结论 ---- */
    const bullets = [];
    bullets.push('全市场 ' + total + ' 个合约：上涨 ' + up + ' / 下跌 ' + down + ' / 平盘 ' + flat +
      '（' + f1(up / Math.max(1, total) * 100) + '% 收红），成交额加权平均涨跌 ' + f2(pctAvg) + '%');
    bullets.push('市场情绪总分 ' + sentiment.all.score + '/100（' + sentiment.all.label + '）');
    const hotSec = sectors.slice(0, 3).map(s => s.icon + s.name + '（' + f2(s.pctAvg) + '%/' + s.up + '涨' + s.down + '跌）').join('、');
    bullets.push('成交额集中板块：' + hotSec);
    if (gainTop.length) bullets.push('涨幅极端：' + gainTop.slice(0, 3).map(x => x.name + ' +' + x.pct + '%').join('、') +
      '；跌幅极端：' + loseTop.slice(0, 3).map(x => x.name + ' ' + x.pct + '%').join('、'));

    /* ★2026-10-25 第三轮：补上"市场买多还是卖空"与"各合约情绪"结论 */
    const mv0 = require('./flow');
    let mvx = null;
    try { mvx = await mv0.marketVerdict(); } catch (e) { mvx = null; }
    if (mvx && mvx.ok) bullets.push('资金面结论：' + mvx.text);
    if (moodTop.length) bullets.push('情绪最强合约：' + moodTop.slice(0, 3).map(x => x.name + '（' + x.mood + '分/' + x.longShort + '）').join('、') +
      '；情绪最弱：' + moodLow.slice(0, 2).map(x => x.name + '（' + x.mood + '分/' + x.longShort + '）').join('、'));

    const score = sentiment.all.score;
    const advice = score >= 75 ? '情绪极贪婪：多数板块收红，可顺势持有强势品种，但追高需设止损，警惕次日高开低走' :
      score >= 60 ? '情绪偏暖：板块普涨，回调至支撑可分批介入，优先资金流入最强的板块' :
        score >= 40 ? '多空平衡：板块分化明显，建议只做强势板块，其余观望' :
          score >= 25 ? '情绪偏冷：多数板块走弱，控制仓位，等待企稳再考虑左侧' :
            '情绪冰点：普跌，不接飞刀，等待缩量企稳与情绪分回升';
    const text = bullets.join('；') + '。综合评分 ' + score + '/100。';

    /* ---- 6) ★市场买卖倾向（用户: "市场要买多还是卖空"）
     *   依据：全市场主动买比 + 涨跌家数比 + 资金流向（flow 引擎） */
    const FL = require('./flow');
    let mktFlow = null;
    try { mktFlow = await FL.marketVerdict(); } catch (e) { mktFlow = null; }
    const upRatio = (up + down) > 0 ? up / (up + down) * 100 : 50;
    let marketBias, marketBiasColor, marketBiasReason;
    if (mktFlow && mktFlow.ok) {
      marketBias = mktFlow.action;
      marketBiasColor = mktFlow.color;
      marketBiasReason = mktFlow.reason;
    } else {
      const upRatio2 = upRatio;
      marketBias = upRatio2 >= 55 ? '买多' : upRatio2 <= 45 ? '卖空' : '震荡';
      marketBiasColor = upRatio2 >= 55 ? '#f0334b' : upRatio2 <= 45 ? '#0bbf7a' : '#f0a020';
      marketBiasReason = '涨跌家数比 ' + f1(upRatio2) + '%';
    }
    const marketBiasText = '市场倾向「' + marketBias + '」：' + marketBiasReason +
      '（涨跌家数 ' + up + '涨 / ' + down + '跌）';

    /* ---- 7) ★榜单解读（用户: "要通过榜单表达什么"）---- */
    const conc = gainTop.length ? (() => {
      const top3 = gainTop.slice(0, 3).reduce((s, x) => s + Math.max(0, x.pct), 0);
      const top10 = gainTop.slice(0, 10).reduce((s, x) => s + Math.max(0, x.pct), 0);
      return top10 > 0 ? Math.round(top3 / top10 * 100) : 0;
    })() : 0;
    const reads = [
      {
        icon: '🔥', title: '涨幅榜在说什么',
        text: '榜首 ' + (gainTop[0] ? gainTop[0].name + ' +' + gainTop[0].pct + '%（' + gainTop[0].sector + '）' : '无') +
          '；前 3 名占前 10 名涨幅的 ' + conc + '%（' +
          (conc > 70 ? '行情由个别标的驱动，指数化风险高' : '涨势由多个标的共同推动，板块性行情') + '）'
      },
      {
        icon: '🔻', title: '跌幅榜在说什么',
        text: '跌幅榜首 ' + (loseTop[0] ? loseTop[0].name + ' ' + loseTop[0].pct + '%（' + loseTop[0].sector + '）' : '无') +
          '；全市场上涨占比 ' + f1(upRatio) + '%，' +
          (upRatio >= 60 ? '普涨格局' : upRatio <= 40 ? '普跌格局' : '涨跌分化')
      },
      {
        icon: '🧭', title: '市场该买多还是卖空',
        text: marketBiasText
      }
    ];

    const data = {
      ok: true, at: Date.now(), timeText: new Date().toLocaleString('zh-CN'),
      total, up, down, flat, turn: Math.round(turn), pctAvg: f2(pctAvg),
      takerCov, mood: sentiment.all,
      sectors, gainTop, loseTop, takerStrong, takerWeak,
      moodTop, moodLow,
      marketBias, marketBiasColor, marketBiasReason, marketBiasText,
      reads,
      ai: { text, bullets, advice, score }
    };
    CACHE = data; CACHE_AT = Date.now();
    return data;
  } catch (e) {
    return CACHE || { ok: false, err: String(e && e.message || e) };
  }
}

module.exports = { analyze };
