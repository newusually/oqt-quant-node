/* ============================================================================
 * modules/okx/engines/panel3.js —— ★第六轮新面板数据引擎（2026-10-25）
 * ----------------------------------------------------------------------------
 * 用户需求（三块新面板）：
 *  ① 「首页 板块涨跌双曲线」（历史三个月、可左移、悬浮窗）
 *  ② 「加密货币板块 净买量与动能 ↔ 涨幅」双曲线
 *  ③ 「加密货币板块 情绪值 ↔ 涨跌幅」双曲线
 *
 * ★粒度设计（关键）：
 *   - 三个月历史 → 用 1H 粒度（1H K线，本地库已有 100 天）
 *   - 5m 粒度用于信号验证
 *   - 1D 粒度用于超长期
 *
 * [taker removed 2026-10-26] takervol 主动买卖量/净买/买比相关序列全部移除。
 *   仍保留：板块等权涨跌幅（K线）、情绪分（移除 taker 因子后仅由涨跌家数+动量构成）
 * ========================================================================== */
'use strict';

const SECT_NAME = {
  l1: '公链层', l2: '扩容层', defi: 'DeFi', meme: 'Meme', ai: 'AI',
  infra: '基础设施', nft: '链游与NFT', rwa: '实物资产与DePIN', other: '其他加密'
};
const SECT_ICON = {
  l1: '⛓', l2: '🧱', defi: '🔗', meme: '🐕', ai: '🤖',
  infra: '🧰', nft: '🎮', rwa: '🏗', other: '🪙'
};

let _T = null, _KL = null;
function T() { if (!_T) _T = require('./universe'); return _T; }
function KL() { if (!_KL) _KL = require('./kline'); return _KL; }

const DAY = 86400000;

/* ============================================================================
 * 一、板块长历史序列（1H / 1D）—— 用于「三个月双曲线」
 *   数据源：本地对应粒度 K 线库（板块等权涨跌幅）
 * ========================================================================== */
/* ---------------- 缓存层 ----------------
 * longSeries 每次都要读 289 个 K线库 → 缓存 2 分钟（预热周期 90s < TTL）
 */
const LS_CACHE = new Map();     // key → {at, data}
const LS_TTL = 120000;   // 2 分钟

async function longSeries(opt) {
  opt = opt || {};
  const sid = opt.sector || '';
  const grain = opt.grain || '1h';
  const key = sid + '|' + grain + '|' + (opt.beforeTs || 0) + '|' + (opt.bars || 0);
  const hit = LS_CACHE.get(key);
  if (hit && Date.now() - hit.at < LS_TTL) return hit.data;
  const r = await longSeriesCalc(opt);
  if (r.ok) LS_CACHE.set(key, { at: Date.now(), data: r });
  return r;
}

async function longSeriesCalc(opt) {
  opt = opt || {};
  const sid = opt.sector || '';
  const grain = opt.grain || '1h';
  const u = await T().universe();
  if (!u.ok) return { ok: false, err: 'universe 未就绪', bars: [] };
  const list = (u.list || []).filter(x => !sid || sid === 'all' || x.sector === sid);
  if (!list.length) return { ok: false, err: '板块无标的', bars: [] };

  const lim = Math.max(24, Math.min(4000, opt.bars || (grain === '1h' ? 2160 : 90)));

  // ① K线：板块等权涨跌幅（用对应粒度本地库）
  const kgrain = grain === '1h' ? '1h' : (grain === '1d' ? '1d' : '5m');
  const pxAgg = new Map();
  for (const x of list) {
    const kl = KL().loadLocal(x.instId, kgrain, lim + 2);
    if (!kl || kl.length < 2) continue;
    for (let i = 1; i < kl.length; i++) {
      const prev = kl[i - 1].c, cur = kl[i].c;
      if (!prev || !cur) continue;
      const pct = (cur - prev) / prev * 100;
      if (opt.beforeTs && kl[i].t > opt.beforeTs) continue;
      let a = pxAgg.get(kl[i].t);
      if (!a) { a = { sum: 0, n: 0, up: 0, down: 0 }; pxAgg.set(kl[i].t, a); }
      a.sum += pct; a.n++;
      if (pct > 0) a.up++; else if (pct < 0) a.down++;
    }
  }

  // ② 合并输出
  const tsList = Array.from(pxAgg.keys()).sort((a, b) => a - b);
  let bars = [];
  for (const ts of tsList) {
    const p = pxAgg.get(ts);
    const pctAvg = p && p.n ? p.sum / p.n : null;
    const up = p ? p.up : 0, down = p ? p.down : 0;
    const ratio = (up + down) > 0 ? (up - down) / (up + down) : 0;
    bars.push({
      ts, pctAvg: (pctAvg === null || pctAvg === undefined) ? null : +pctAvg.toFixed(4),
      up, down, ratio: +ratio.toFixed(4),
      buyRatio: null, buy: null, sell: null, net: null, netCum: null,
      tkN: 0,
      pxN: p ? p.n : 0
    });
  }
  if (opt.beforeTs) bars = bars.filter(b => b.ts <= opt.beforeTs);
  bars = bars.slice(-lim);

  // ③ 派生：情绪分（仅由涨跌家数占比 + 涨跌动量构成，taker 因子已移除）
  for (let i = 0; i < bars.length; i++) {
    const upRatio01 = (bars[i].up + bars[i].down) > 0 ? bars[i].up / (bars[i].up + bars[i].down) : 0.5;
    const mom01 = Math.max(0, Math.min(1, 0.5 + (bars[i].pctAvg || 0) / 2));
    const score = Math.round(100 * (0.6 * upRatio01 + 0.4 * mom01));
    bars[i].score = score;
    bars[i].scoreLabel = score >= 75 ? '极贪婪' : score >= 60 ? '贪婪' : score >= 40 ? '中性' : score >= 25 ? '恐惧' : '极恐惧';
  }

  // ④ 统计（用于结论文字）
  const last = bars[bars.length - 1] || {};
  const prev = bars[bars.length - 2] || {};

  return {
    ok: true, at: Date.now(), sector: sid, grain,
    name: sid ? (SECT_NAME[sid] || sid) : '全市场',
    icon: sid ? (SECT_ICON[sid] || '') : '🌐',
    count: list.length,
    bars,
    oldest: bars.length ? bars[0].ts : 0,
    newest: bars.length ? bars[bars.length - 1].ts : 0,
    stats: {
      lastPct: last.pctAvg, lastScore: last.score, lastScoreLabel: last.scoreLabel,
      avgBuyRatio: null,
      pctChange: ((last.pctAvg !== null && last.pctAvg !== undefined) && (prev.pctAvg !== null && prev.pctAvg !== undefined)) ? +(last.pctAvg - prev.pctAvg).toFixed(4) : 0,
      spanDays: bars.length ? +(((bars[bars.length - 1].ts - bars[0].ts) / DAY)).toFixed(1) : 0
    }
  };
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return 0;
  return +(sxy / Math.sqrt(sxx * syy)).toFixed(4);
}
function agreeRate(xs, ys) {
  let same = 0, n = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === 0 || ys[i] === 0) continue;
    if ((xs[i] > 0) === (ys[i] > 0)) same++;
    n++;
  }
  return n ? +(same / n * 100).toFixed(1) : 0;
}
function corrText(r, agree) {
  const a = Math.abs(r);
  let t;
  if (a >= 0.6) t = '强相关';
  else if (a >= 0.3) t = '中等相关';
  else if (a >= 0.1) t = '弱相关';
  else t = '基本无关';
  return t + (r < 0 ? '·方向相反' : '·方向互有') + '（一致率 ' + agree + '%）';
}

/* ============================================================================
 * 二、加密货币板块专用：情绪值 ↔ 涨跌幅 双曲线
 *   [taker removed 2026-10-26] 净买量&动能↔涨幅 面板已移除（纯 taker）
 * ========================================================================== */
const CP_CACHE = new Map();
const CP_TTL = 120000;

async function cryptoPanels(opt) {
  opt = opt || {};
  const grain = opt.grain || '1h';
  const bars = opt.bars || 2160;
  const key = grain + '|' + bars;
  const hit = CP_CACHE.get(key);
  if (hit && Date.now() - hit.at < CP_TTL) return hit.data;
  const r = await cryptoPanelsCalc(opt, grain, bars);
  if (r.ok) CP_CACHE.set(key, { at: Date.now(), data: r });
  return r;
}

async function cryptoPanelsCalc(opt, grain, bars) {
  const r = await longSeries({ sector: '', grain, bars });
  if (!r.ok) return r;

  // ① 情绪 ↔ 涨跌幅
  const moodPct = r.bars.map(b => ({
    ts: b.ts, time: fmtTime(b.ts), date: fmtDate(b.ts),
    pct: b.pctAvg,                       // 左轴：涨幅%
    score: b.score,                      // 右轴：情绪分 0~100
    scoreLabel: b.scoreLabel,
    up: b.up, down: b.down
  }));

  // ② 情绪与涨幅的相关性
  const mr = pearson(r.bars.map(b => b.score), r.bars.map(b => (b.pctAvg === null || b.pctAvg === undefined) ? 0 : b.pctAvg));

  return {
    ok: true, at: Date.now(), grain,
    name: r.name, icon: r.icon,
    stats: r.stats,
    netMomentum: [],
    moodPct,
    moodCorr: { r: mr, text: corrText(mr, agreeRate(r.bars.map(b => b.score - 50), r.bars.map(b => (b.pctAvg === null || b.pctAvg === undefined) ? 0 : b.pctAvg))) },
    count: r.count,
    oldest: r.oldest, newest: r.newest
  };
}

function fmtTime(ts) {
  const d = new Date(ts);
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
function fmtDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

/* ============================================================================
 * 三、首页「板块涨跌双曲线」最重要参考（K线等权涨跌幅）
 * ========================================================================== */
async function mainDual(opt) {
  opt = opt || {};
  const sid = opt.sector || '';
  const grain = opt.grain || '1h';
  const bars = Math.max(20, Math.min(4000, opt.bars || 100));
  const r = await longSeries({ sector: sid, grain, bars: Math.min(4000, bars + 400), beforeTs: opt.beforeTs || 0 });
  if (!r.ok) return r;

  const win = r.bars.slice(-bars);
  const s = r.stats;
  const last = win[win.length - 1] || {};

  const dirTxt = (last.pctAvg || 0) > 0 ? '上涨' : (last.pctAvg || 0) < 0 ? '下跌' : '持平';
  const concl = [
    '板块等权' + dirTxt + ' ' + ((last.pctAvg !== null && last.pctAvg !== undefined) ? last.pctAvg.toFixed(3) + '%' : '-'),
    '情绪分 ' + last.score + '（' + last.scoreLabel + '）'
  ].join('；');

  return {
    ok: true, at: Date.now(), sector: sid, grain,
    name: r.name, icon: r.icon,
    bars: win,
    stats: s,
    total: r.bars.length,
    oldest: r.oldest, newest: r.newest,
    hasMore: r.bars.length > win.length || (win.length && win[0].ts > 0),
    window: bars,
    concl
  };
}

/* ============================================================================
 * 四、合约级价格曲线（供信号详情面板用）—— 仅 K 线，taker 序列已移除
 * ========================================================================== */
async function contractCurve(sym, opt) {
  opt = opt || {};
  const u = await T().universe();
  if (!u.ok) return { ok: false, err: 'universe 未就绪' };
  const x = (u.list || []).find(y => y.sym === sym || y.instId === sym);
  if (!x) return { ok: false, err: '未找到合约 ' + sym };
  const grain = opt.grain || '5m';
  const kgrain = grain === '1h' ? '1h' : (grain === '1d' ? '1d' : '5m');
  const bars = Math.max(20, Math.min(1000, opt.bars || 200));

  const kl = KL().loadLocal(x.instId, kgrain, bars + 2);

  const out = [];
  for (let i = 1; i < kl.length; i++) {
    const b = kl[i], prev = kl[i - 1];
    if (!prev.c || !b.c) continue;
    out.push({
      ts: b.t, time: fmtTime(b.t), date: fmtDate(b.t),
      pct: +((b.c - prev.c) / prev.c * 100).toFixed(4),
      close: b.c,
      buyRatio: null, ratio: null, buy: null, sell: null
    });
  }
  return {
    ok: true, at: Date.now(), sym: x.sym, instId: x.instId, name: x.name, sector: x.sector,
    bars: out.slice(-bars)
  };
}

module.exports = { longSeries, cryptoPanels, mainDual, contractCurve, pearson, corrText, agreeRate, SECT_NAME, SECT_ICON };