/* ============================================================================
 * modules/okx/engines/buysignal.js —— ★BTC 涨跌家数买卖信号引擎（2026-10-26）
 * ----------------------------------------------------------------------------
 * 用户需求：
 *   "下跌家数在50%以上连续3次，然后最后第四次下跌家数变成20%以下 就买入，
 *    买入只买入BTC合约，计算15m/5m/3m/1h/2h/4h 的买卖信号，只要BTC，其他不能显示
 *    —— 给我计算回测 做表格"
 *
 * ★规则（只针对 BTC）：
 *   对每个周期(grain)，统计全市场每个时间片的 下跌家数占比 downRatio = down/total：
 *     ① 连续 3 根 downRatio ≥ 50%   （市场整体偏弱）
 *     ② 第 4 根 downRatio ≤ 20%     （恐慌后急速收敛 → 买点）
 *   → 触发买入 BTC。
 *
 * ★回测口径（信号后固定持有 K 根）：
 *   触发后按 BTC 该时间片收盘买入，统计持有 1/2/3/5 根K线后的涨幅
 *   （相对买入收盘价）。每周期输出全部历史信号 + 汇总统计（信号数/胜率/平均收益/最佳最差）。
 *
 * ★数据源：全市场各周期 K 线库(data/okx/kline/*_<grain>.sqlite)
 *   复用 updown 引擎的涨跌家数统计 + 主力(BTC)蜡烛序列。
 * ========================================================================== */
'use strict';
const UD = require('./updown');
const STORE = require('./buysigstore');

const SIG_GRANS = ['15m', '5m', '3m', '1h', '2h', '4h'];
const HOLDS = [1, 2, 3, 5];          // 买入后固定持有 K 根
const GRAN_LABEL = {
  '3m': '3分钟', '5m': '5分钟', '15m': '15分钟',
  '1h': '1小时', '2h': '2小时', '4h': '4小时'
};

const CACHE = new Map();
const CACHE_TTL = 20000;

/**
 * 深拷贝一个给 downRatio 的信号算的结果 —— 单周期
 * @param {string} grain
 */
async function scanGrain(grain, bars) {
  const bN = Math.max(30, Math.min(12000, parseInt(bars, 10) || 2000));
  /* 复用 updown：全市场涨跌家数 + BTC leadCandles */
  const u = await UD.updown({ grain, sector: '', bars: bN, beforeTs: 0, lead: 'BTC' });
  if (!u.ok || !u.bars || !u.bars.length) {
    return { ok: false, err: (u.err || 'no data'), grain, signals: [], stats: null };
  }

  const aggs = u.bars;                    // 涨跌家数序列（ts/up/down/total/upRatio…）
  /* BTC candles 已由 updown 按 aggs 同轴对齐（从 leadCandles 升序） */
  const candles = u.leadCandles || [];
  const cByTs = {};
  candles.forEach(c => { if (c && c.ts) cByTs[c.ts] = c; });

  const signals = [];
  /* 遍历每个时间片，检查「前3根 downRatio≥50% 且本根≤20%」 */
  for (let i = 3; i < aggs.length; i++) {
    const b = aggs[i];
    if (b === null || b === undefined) continue;
    const dc = downRatio(b);
    if (dc === null || dc > 20) continue;              // 第4根必须 ≤20%（弱修复）
    /* 前3根全部 ≥50% */
    let preOk = true;
    for (let k = 1; k <= 3; k++) {
      const pre = aggs[i - k];
      const pdr = downRatio(pre);
      if (pdr === null || pdr < 50) { preOk = false; break; }
    }
    if (!preOk) continue;

    /* 买点：当前根 BTC 收盘价 */
    const cb = cByTs[b.ts];
    if (!cb || !isFinite(cb.c) || cb.c <= 0) continue;
    const buyPx = cb.c;

    /* 未来 1/2/3/5 根收益（相对当前根的后续K线收盘） */
    const fwd = {};
    const nextCandles = candles.filter(x => x.ts > b.ts).slice(0, 5);
    for (let n = 1; n <= 5; n++) {
      const nc = nextCandles[n - 1];
      fwd['f' + n] = (nc && isFinite(nc.c) && nc.c > 0) ? +(((nc.c - buyPx) / buyPx * 100).toFixed(3)) : null;
    }

    signals.push({
      ts: b.ts,
      grain,
      buyRatio: +((dc || 0).toFixed(2)),          // 触发根: 下跌家数占比(≤20%)
      down_1: (aggs[i - 3] ? roundR(aggs[i - 3]) : null),
      down_2: (aggs[i - 2] ? roundR(aggs[i - 2]) : null),
      down_3: (aggs[i - 1] ? roundR(aggs[i - 1]) : null),
      buyPx: +buyPx.toFixed(4),
      f1: fwd.f1, f2: fwd.f2, f3: fwd.f3, f5: fwd.f5
    });
  }

  /* 汇总统计 */
  const stats = summarize(signals);
  return { ok: true, grain, label: GRAN_LABEL[grain] || grain, count: u.count, covCount: u.covCount, signals, stats };
}

/* 下跌家数占比(%) */
function downRatio(b) {
  if (!b) return null;
  const t = b.total || 0;
  if (!t || !isFinite(t)) return null;
  return b.down / t * 100;
}
function roundDown(b) { const v = downRatio(b); return v === null ? null : +v.toFixed(2); }
function roundR(b) { return roundDown(b); }

/* 汇总一个周期的全部信号（回测表） */
function summarize(signals) {
  const st = { grain: '', total: signals.length, win1: 0, win2: 0, win3: 0, win5: 0, avg1: 0, avg2: 0, avg3: 0, avg5: 0, best: null, worst: null, lt1: null, lt5: null };
  let s1 = 0, s2 = 0, s3 = 0, s5 = 0, n1 = 0, n2 = 0, n3 = 0, n5 = 0;
  for (const s of signals) {
    if (s.f1 !== null) { n1++; s1 += s.f1; if (s.f1 > 0) st.win1++; }
    if (s.f2 !== null) { n2++; s2 += s.f2; if (s.f2 > 0) st.win2++; }
    if (s.f3 !== null) { n3++; s3 += s.f3; if (s.f3 > 0) st.win3++; }
    if (s.f5 !== null) { n5++; s5 += s.f5; if (s.f5 > 0) st.win5++; }
    st.worst = (st.worst === null || s.f1 < st.worst) ? s.f1 : st.worst;
    st.best = (st.best === null || s.f1 > st.best) ? s.f1 : st.best;
    /* 最新一次信号时间 */
    if (s.ts > (st.lt1 || 0)) { st.lt1 = s.ts; }
  }
  const fmt = v => (v === null || v === undefined) ? null : +v.toFixed(3);
  st.avg1 = n1 ? +(s1 / n1).toFixed(3) : null;
  st.avg2 = n2 ? +(s2 / n2).toFixed(3) : null;
  st.avg3 = n3 ? +(s3 / n3).toFixed(3) : null;
  st.avg5 = n5 ? +(s5 / n5).toFixed(3) : null;
  st.lt5 = st.lt1;   // 最近信号 ts
  st.best = fmt1(st.best); st.worst = fmt1(st.worst);
  return st;
}
function fmt1(v) { return (v === null || v === undefined) ? null : +v.toFixed(3); }

/**
 * 全周期扫描（多个周期并行一次返回）
 */
async function buySignals(opt) {
  opt = opt || {};
  const bars = opt.bars || 2000;
  const key = 'sig:' + bars;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  const results = [];
  for (const g of SIG_GRANS) {
    try {
      const r = await scanGrain(g, bars);
      results.push(r);
    } catch (e) {
      results.push({ ok: false, grain: g, err: String((e && e.message) || e), signals: [], stats: null });
    }
  }
  const out = { ok: true, at: Date.now(), all: results };
  /* ★2026-10-26 自动持久化到 SQLite（数据库保存，换新电脑自检回补基于此库） */
  try { STORE.saveSignals(out); } catch (e) { out.saveErr = String((e && e.message) || e); }
  CACHE.set(key, { at: Date.now(), data: out });
  return out;
}

module.exports = { buySignals, scanGrain, SIG_GRANS, GRAN_LABEL };