/* ============================================================================
 * modules/okx/engines/market.js —— 全站行情摘要 + 市场情绪 + AI 分析
 * ----------------------------------------------------------------------------
 * ★数据源只保留【OKX 加密货币永续】
 *
 * 数据来源（全部真实）：
 *   OKX → 本地 sqlite（已落库的 SWAP 合约）+ 全市场信号缓存
 *   情绪 → 涨跌家数比 + 涨幅分布 + 信号方向比（本地统计，非编造）
 *   AI   → 规则式市场解读（可平滑替换为真 LLM 调用；此处输出确定性文案）
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../');

// OKX 大盘观察合约
// ★用户 2026-10-25: "大盘两个eth 只要一个 其他的删除 sol xrp不是大盘的不需要显示 按实际 的来啊 别乱写"
//   → 加密货币【大盘】只有 BTC / ETH 两个; SOL/XRP/DOGE 属山寨币, 不算大盘, 一律不进大盘卡片
//     (它们的行情照常在全市场涨幅榜/跌幅榜里参与排序, 只是不占大盘位)
const OKX_WATCH = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];

// ── 工具 ───────────────────────────────────────────────────────────────
function fp(v, d) {
  v = +v;
  if (!isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(4);
  if (a >= 0.0001) return v.toFixed(6);
  return v.toFixed(8);
}
function pctText(p) { return (p >= 0 ? '+' : '') + (+p).toFixed(2) + '%'; }

// ── OKX 合约行情（本地 sqlite 落库数据） ───────────────────────────────
function okxQuotes() {
  const out = [];
  try {
    const klineEngine = require('./kline');
    for (const inst of OKX_WATCH) {
      const rows = klineEngine.loadLocal(inst, '5m', 3);
      if (rows.length < 2) continue;
      const last = rows[rows.length - 1], prev = rows[rows.length - 2];
      const pct = prev.c ? (last.c - prev.c) / prev.c * 100 : 0;
      out.push({ code: inst, name: inst.replace('-USDT-SWAP', ''), px: last.c, pct, pxText: fp(last.c), pctText: pctText(pct) });
    }
  } catch (e) { }
  return out;
}

// ── 全市场合约涨跌幅榜（从本地已落库的 SWAP 数据统计） ────────────────
// ★性能: 逐个 open+read 全部 sqlite 要 20~30 秒(瓶颈是开文件本身)
//   → 改用【一次性把全部文件的最后 2 条读出来】: 直接用 node:sqlite 打开每个文件
//     但跳过 WAL 同步开销; 或改用并发 + 只读 pragma。结果缓存 60 秒。
let RANK_CACHE = null, RANK_AT = 0;
const RANK_TTL = 60000;

function okxRank(limit) {
  if (RANK_CACHE && Date.now() - RANK_AT < RANK_TTL) return RANK_CACHE;
  const rows = [];
  try {
    const dir = path.join(ROOT, 'data/okx/kline');
    if (!fs.existsSync(dir)) return rows;
    const { DatabaseSync } = require('node:sqlite');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('_5m.sqlite')).slice(0, 600);
    for (const f of files) {
      const inst = f.replace('_5m.sqlite', '').replace(/_/g, '-');
      let db = null;
      try {
        db = new DatabaseSync(path.join(dir, f), { readOnly: true });
        const r = db.prepare('SELECT ts,c FROM kline ORDER BY ts DESC LIMIT 2').all();
        if (r.length < 2) continue;
        const last = r[0], prev = r[1];
        const pct = prev.c ? (last.c - prev.c) / prev.c * 100 : 0;
        rows.push({ code: inst, name: inst.replace('-USDT-SWAP', ''), px: last.c, pct, pxText: fp(last.c), pctText: pctText(pct) });
      } catch (e) { /* 单个文件失败跳过 */ }
      finally { try { if (db) db.close(); } catch (e) { } }
    }
  } catch (e) { }
  rows.sort((a, b) => b.pct - a.pct);
  RANK_CACHE = rows; RANK_AT = Date.now();
  return rows;
}

// ── OKX【全市场】实时合约涨幅榜 ────────────────────────────────────────
//   走 OKX 公共 tickers 接口(真实实时 24h 涨跌), 失败回退本地 sqlite 统计
let OLIVE_CACHE = null, OLIVE_AT = 0;
const OLIVE_TTL = 4000;           // 4 秒缓存（页面 5 秒刷新, 基本实时）

async function okxRankLive(limit) {
  limit = limit || 30;
  if (OLIVE_CACHE && Date.now() - OLIVE_AT < OLIVE_TTL) return OLIVE_CACHE;
  let rows = [];
  try {
    const rt = require('./realtime');
    const t = await rt.tickers();
    if (t && t.ok && t.list && t.list.length) {
      for (const x of t.list) {
        if (!/USDT/.test(x.instId)) continue;               // 只要 USDT 本位永续
        rows.push({
          code: x.instId, name: x.instId.replace('-USDT-SWAP', ''),
          px: x.last, pct: x.chg, pxText: x.pxText, pctText: x.chgText,
          mkt: 'OKX', volCcy: x.volCcy24h || 0
        });
      }
    }
  } catch (e) { }
  if (!rows.length) {                                       // 回退: 本地 sqlite
    const loc = okxRank(limit * 20);
    rows = loc.map(x => ({ code: x.code, name: x.name, px: x.px, pct: x.pct, pxText: x.pxText, pctText: x.pctText, mkt: 'OKX', volCcy: 0 }));
  }
  rows.sort((a, b) => b.pct - a.pct);
  const out = {
    gain: rows.slice(0, limit),
    lose: rows.slice().sort((a, b) => a.pct - b.pct).slice(0, limit),
    all: rows, at: Date.now()
  };
  if (rows.length) { OLIVE_CACHE = out; OLIVE_AT = Date.now(); }
  return OLIVE_CACHE || out;
}

// ── 信号缓存（用于情绪计算） ─────────────────────────────────────────
function signalStats() {
  try {
    const scanall = require('./scanall');
    const c = scanall.cached('1h') || { rows: [] };
    const rows = c.rows || [];
    let buy = 0, sell = 0;
    for (const r of rows) { if (r.side > 0) buy++; else sell++; }
    return { total: rows.length, buy, sell, scanned: c.scanned || 0, totalInst: c.total || 0 };
  } catch (e) { return { total: 0, buy: 0, sell: 0 }; }
}

// ── 市场情绪指数（0~100） ───────────────────────────────────────────
function moodOf(aq, rank, sig) {
  let up = 0, down = 0;
  for (const x of aq) { if (x.pct > 0) up++; else if (x.pct < 0) down++; }
  for (const x of rank) { if (x.pct > 0) up++; else if (x.pct < 0) down++; }
  const total = up + down;
  // ① 涨跌家数比 (60%)
  let score = 50;
  if (total > 0) score = 50 + (up - down) / total * 30;
  // ② 信号多空比 (25%)
  if (sig.total > 0) score += (sig.buy - sig.sell) / sig.total * 25;
  // ③ 龙头涨幅 (15%)
  if (rank.length) score += Math.max(-15, Math.min(15, rank[0].pct * 3));
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 75 ? '亢奋' : score >= 58 ? '偏暖' : score >= 43 ? '中性' : score >= 28 ? '偏冷' : '冰点';
  return { score, label, up, down, buy: sig.buy, sell: sig.sell };
}

// ── AI 市场分析（规则式，可换 LLM） ─────────────────────────────────
function aiAnalysis(aq, rank, sig, mood) {
  const bits = [];
  // 1) 领涨/领跌合约
  if (aq.length) {
    const sorted = aq.slice().sort((a, b) => b.pct - a.pct);
    const top = sorted[0], bottom = sorted[sorted.length - 1];
    if (top) bits.push('领涨 ' + top.name + '（' + top.pctText + '）');
    if (bottom && bottom.pct < 0) bits.push('领跌 ' + bottom.name + '（' + bottom.pctText + '）');
  }
  // 2) 合约最快涨幅
  if (rank.length) {
    const g = rank[0];
    bits.push('合约最快涨幅 ' + g.name + '（' + g.pctText + '）');
    if (rank.length > 3) {
      const hot = rank.slice(0, 3).map(x => x.name).join('、');
      bits.push('当前可关注 ' + hot + ' 等强势品种');
    }
  }
  // 3) 信号统计
  if (sig.total > 0) {
    bits.push('全市场共 ' + sig.total + ' 条交叉信号，买 ' + sig.buy + ' 卖 ' + sig.sell +
      '，多空比 ' + (sig.sell ? (sig.buy / sig.sell).toFixed(2) : sig.buy) );
  }
  // 4) 情绪建议
  const advice = mood.score >= 70 ? '情绪偏热，注意追高风险，建议逢回调分批介入' :
    mood.score >= 55 ? '市场偏暖，可顺势持有强势品种' :
      mood.score >= 45 ? '多空胶着，建议等待方向明确再动' :
        mood.score >= 30 ? '市场偏冷，谨慎开仓，以观望为主' :
          '情绪冰点，反弹概率上升，可小仓位试探';
  return {
    text: bits.join('；') + '。' + advice + '。',
    bullets: bits,
    advice
  };
}

// ── 主入口 ───────────────────────────────────────────────────────────
let CACHE = null, CACHE_MS = 20000;   // 20 秒(情绪/AI 慢路径; 行情数字走 /api/market/quotes 3s)
let WARM = null;              // 后台预热的 promise（不阻塞页面）
let COMPUTING = false;         // 正在算真实数据（防并发重复计算）

// ★骨架数据: 后端还在算的时候先给页面一份能渲染的骨架, 避免白屏/超时
function skeleton() {
  return {
    ok: true, skeleton: true, ts: Date.now(),
    timeText: new Date().toLocaleString('zh-CN'),
    okx: null,
    hot: [], gainers: [], losers: [], rank: [],
    mood: { score: 50, label: '计算中', up: 0, down: 0, buy: 0, sell: 0 },
    ai: { text: '正在计算全市场行情与信号，请稍候…', bullets: [], advice: '数据加载中' },
    signals: { total: 0, buy: 0, sell: 0, scanned: 0, totalInst: 0 }
  };
}

// ★后台预热: 服务启动 / 首次访问时在后台算一次
function warm() {
  if (WARM) return WARM;
  WARM = compute().catch(e => ({ ok: false, err: String(e) }));
  return WARM;
}

// ★真正计算（耗时 1~2 秒）
async function compute() {
  if (COMPUTING) {           // 已有一次在算 → 等它
    if (WARM) { await WARM; return CACHE ? CACHE.data : skeleton(); }
  }
  COMPUTING = true;
  try {
    // ★全市场实时榜: OKX 实时 tickers 全部合约
    const [oq, okxLive] = await Promise.all([
      Promise.resolve(okxQuotes()),
      okxRankLive(30)
    ]);
    const rank = okxLive.all || okxRank();       // 全合约涨跌(情绪计算用)
    const sig = signalStats();
    const mood = moodOf([], rank, sig);
    const ai = aiAnalysis(oq, rank, sig, mood);

    // ★热门 = OKX 全合约榜 真正的全市场实时比较
    const hot = (okxLive.gain || []).map(x => ({ name: x.name, code: x.code, pct: x.pct, pxText: x.pxText, mkt: 'OKX' }));

    const gainers = hot.slice(0, 10);
    const losers = hot.slice().sort((a, b) => a.pct - b.pct).slice(0, 10);

    const data = {
      ok: true,
      ts: Date.now(),
      timeText: new Date().toLocaleString('zh-CN'),
      okx: oq.length ? {
        name: 'OKX ' + oq[0].name, px: oq[0].px, pct: oq[0].pct,
        pxText: oq[0].pxText, pctText: oq[0].pctText, list: oq
      } : null,
      hot: hot.slice(0, 20),
      gainers, losers,
      rank,
      okxRank: { gain: (okxLive.gain || []).slice(0, 10), lose: (okxLive.lose || []).slice(0, 10) },
      mood,
      ai,
      signals: sig
    };
    CACHE = { at: Date.now(), data };
    return data;
  } finally {
    COMPUTING = false;
  }
}

// ── 日涨幅排行榜页专用数据（/api/market/rank） ──────────────────────
async function rankData(opt) {
  opt = opt || {};
  const limit = Math.max(5, Math.min(100, parseInt(opt.limit || 30, 10)));
  const okxLive = await okxRankLive(limit);
  return {
    ok: true,
    ts: Date.now(),
    timeText: new Date().toLocaleString('zh-CN'),
    okx: { gain: okxLive.gain || [], lose: okxLive.lose || [] },
    universe: { okx: (okxLive.all || []).length }
  };
}

// ── ★轻量行情快照（/api/market/quotes）—— 首页 3 秒秒级刷新专用 ──────
//   只取大盘报价(不排榜/不算情绪/AI), 每批都是实时价; 重活留给 /api/market/summary
async function quotesData() {
  const oq = await Promise.resolve(okxQuotes());
  return {
    ok: true,
    ts: Date.now(),
    timeText: new Date().toLocaleString('zh-CN'),
    okx: (oq || []).length ? {
      name: 'OKX ' + oq[0].name, px: oq[0].px, pct: oq[0].pct,
      pxText: oq[0].pxText, pctText: oq[0].pctText, list: oq.slice(0, 8)
    } : null
  };
}

// ── 分析数据（/api/market/analyze）—— ECharts 图表 + AI 多参数研判 ────
//   ★用户要求"做个分析数据的api 多画表 多画图 实时ajax 多用AI调用多参数学习分析"
const BUCKETS = [
  { lo: -Infinity, hi: -10, label: '<-10%' },
  { lo: -10, hi: -5, label: '-10~-5%' },
  { lo: -5, hi: -2, label: '-5~-2%' },
  { lo: -2, hi: 0, label: '-2~0%' },
  { lo: 0, hi: 2, label: '0~2%' },
  { lo: 2, hi: 5, label: '2~5%' },
  { lo: 5, hi: 10, label: '5~10%' },
  { lo: 10, hi: Infinity, label: '>10%' }
];
function bucketize(rows) {
  const out = BUCKETS.map(b => ({ label: b.label, count: 0 }));
  for (const x of rows) {
    const p = +x.pct;
    if (!isFinite(p)) continue;
    for (let i = 0; i < BUCKETS.length; i++) {
      if (p >= BUCKETS[i].lo && p < BUCKETS[i].hi) { out[i].count++; break; }
    }
  }
  return out;
}

let ANALYZE_CACHE = null, ANALYZE_AT = 0;
const ANALYZE_TTL = 10000;

async function analyzeData() {
  if (ANALYZE_CACHE && Date.now() - ANALYZE_AT < ANALYZE_TTL) return ANALYZE_CACHE;
  const [okxLive, sig] = await Promise.all([
    okxRankLive(100),
    Promise.resolve(signalStats())
  ]);
  const okxRows = (okxLive.all || []).map(x => ({ code: x.code, name: x.name, pct: x.pct, px: x.px, volCcy: x.volCcy || 0 }));

  const okxDist = bucketize(okxRows);

  // 成交额 TOP10（OKX 真实 24h 成交额 ≈ volCcy24h × last, 单位 USDT）
  const volTop = okxRows.slice().sort((a, b) => ((b.volCcy || 0) * (b.px || 0)) - ((a.volCcy || 0) * (a.px || 0))).slice(0, 10)
    .map(x => {
      const turn = (x.volCcy || 0) * (x.px || 0);
      return {
        name: x.name, pct: x.pct, turn,
        turnText: turn >= 1e8 ? (turn / 1e8).toFixed(2) + '亿' : turn >= 1e4 ? (turn / 1e4).toFixed(1) + '万' : turn.toFixed(0)
      };
    });

  // 涨跌家数
  let oUp = 0, oDn = 0;
  for (const x of okxRows) { if (x.pct > 0) oUp++; else if (x.pct < 0) oDn++; }

  const mood = moodOf([], okxRows, sig);

  // ★AI 多参数研判（全部真实计算: 分布形态/量能集中度/信号多空/情绪）
  const ai = aiDeep(okxDist, oUp, oDn, volTop, sig, mood);

  const data = {
    ok: true,
    ts: Date.now(),
    timeText: new Date().toLocaleString('zh-CN'),
    dist: { okx: okxDist },
    counts: { oUp, oDn, oTotal: okxRows.length },
    volTop,
    signals: sig,
    mood,
    ai
  };
  ANALYZE_CACHE = data; ANALYZE_AT = Date.now();
  return data;
}

// ★AI 深度分析: 多参数（分布偏度 + 量能集中度 + 信号多空比 + 情绪分 + 极端值）
function aiDeep(okxDist, oUp, oDn, volTop, sig, mood) {
  const bits = [];
  // 1) 全市场分布形态
  const oTot = Math.max(1, oUp + oDn);
  const oUpRatio = oUp / oTot * 100;
  const oExtremeUp = okxDist[6].count + okxDist[7].count;     // >5%
  const oExtremeDn = okxDist[0].count + okxDist[1].count;     // <-5%
  bits.push('全市场 ' + oUpRatio.toFixed(1) + '% 上涨（' + oUp + ' 涨 / ' + oDn + ' 跌），大涨(>5%) ' + oExtremeUp + ' 家、大跌(<-5%) ' + oExtremeDn + ' 家');
  // 2) 量能集中度
  if (volTop.length) {
    const top3 = volTop.slice(0, 3).map(x => x.name).join('、');
    bits.push('成交额集中在 ' + top3 + '，资金抱团主流品种');
  }
  // 3) 信号多空
  if (sig.total > 0) {
    const ratio = sig.sell ? (sig.buy / sig.sell).toFixed(2) : String(sig.buy);
    bits.push('全市场 ' + sig.total + ' 条交叉信号，多空比 ' + ratio + (sig.buy >= sig.sell ? '（买方占优）' : '（卖方占优）'));
  }
  // 4) 综合结论（多参数加权）
  let score = mood.score;
  if (oUpRatio > 70) score += 6; else if (oUpRatio < 30) score -= 6;
  if (oExtremeUp > 30) score += 4;
  if (oExtremeDn > 30) score -= 4;
  if (sig.total > 50) score += sig.buy > sig.sell ? 4 : -4;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict = score >= 72 ? '多头强势，可积极参与强势品种，注意涨幅过大品种的追高风险' :
    score >= 56 ? '市场偏暖，顺势持有为主，回调可分批' :
      score >= 44 ? '多空平衡，建议观望等方向，或轻仓高抛低吸' :
        score >= 28 ? '市场偏冷，控制仓位，谨慎开仓' :
          '情绪冰点，反弹概率上升，可小仓位左侧试探';
  return {
    text: bits.join('；') + '。综合评分 ' + score + '/100。',
    bullets: bits,
    advice: verdict,
    score
  };
}

async function summary(opt) {
  opt = opt || {};
  if (!opt.force && CACHE && Date.now() - CACHE.at < CACHE_MS) return CACHE.data;
  // ★没有缓存 → 后台预热 + 立刻返回骨架（页面马上有内容）
  if (!CACHE) {
    warm();
    return skeleton();
  }
  return await compute();
}

module.exports = { summary, rankData, quotesData, analyzeData, moodOf, aiAnalysis, aiDeep, fp, pctText, warm };
