/* ============================================================================
 * modules/okx/engines/relation.js —— 【关系核实引擎】
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25 第四轮）：
 *   "要求核实涨跌比例和加密货币涨跌的关系 ... 做表格做图"
 *   "饼图和曲线图和柱状图 要求比较每个分时比较关系 和大盘的关系做表格做图"
 *
 * ★分时多档对比：板块等权 1m/5m/15m 涨跌幅 + 相对大盘的超额
 *   数据源：WS 快照 pct1m/pct5m/pct15m + 本地 5m K 线兜底
 *
 * [taker removed 2026-10-26] takervol 主动买比/关系核实/买卖信号相关全部移除
 * ========================================================================== */
'use strict';

const TTL = 60000;                 // 缓存 60 秒
let CACHE = null, CACHE_AT = 0;

let _T = null, _KL = null, _WS = null;
function T() { if (!_T) _T = require('./universe'); return _T; }
function KL() { if (!_KL) _KL = require('./kline'); return _KL; }
function WS() { if (!_WS) _WS = require('./okxws'); return _WS; }

const SECT_NAME = {
  l1: '公链层', l2: '扩容层', defi: 'DeFi', meme: 'Meme', ai: 'AI',
  infra: '基础设施', nft: '链游与NFT', rwa: '实物资产与DePIN', other: '其他加密'
};
const SECT_ICON = {
  l1: '⛓', l2: '🧱', defi: '🔗', meme: '🐕', ai: '🤖',
  infra: '🧰', nft: '🎮', rwa: '🏗', other: '🪙'
};

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx <= 0 || dy <= 0) return 0;
  return +(num / Math.sqrt(dx * dy)).toFixed(3);
}

/* ============================================================================
 * 分时多档对比（1m / 5m / 15m）板块 × 大盘 —— 基于价格/K线（非 taker）
 * ========================================================================== */
async function intraday() {
  const u = await T().universe();
  const q = await T().quotesAll();
  if (!u.ok || !q.ok) return { ok: false, err: '行情未就绪' };
  const ws = WS();
  const KL = require('./kline');

  // 板块聚合
  const agg = {};
  for (const x of u.list) {
    const t = q.map[x.instId];
    const s = ws.snap(x.instId);
    const a = agg[x.sector] || (agg[x.sector] = {
      sector: x.sector, name: SECT_NAME[x.sector] || x.sector, icon: SECT_ICON[x.sector] || '',
      count: 0, p1: 0, p1n: 0, p5: 0, p5n: 0, p15: 0, p15n: 0, d1: 0, d1n: 0,
      turn: 0, wsOk: 0
    });
    a.count++;
    if (s) {
      if ((s.pct1m !== null && s.pct1m !== undefined)) { a.p1 += s.pct1m; a.p1n++; }
      if ((s.pct5m !== null && s.pct5m !== undefined)) { a.p5 += s.pct5m; a.p5n++; }
      if ((s.pct15m !== null && s.pct15m !== undefined)) { a.p15 += s.pct15m; a.p15n++; }
      if ((s.pct1m !== null && s.pct1m !== undefined)) a.wsOk++;
    }
    // ★5m/15m 兜底：WS 10 秒缓冲需跑满 15 分钟才有 15 分钟前的价点
    //   → 用本地 5m K 线算（最后 1 根 vs 前 1 根 = 5 分钟；vs 前 3 根 = 15 分钟）
    let k5 = null, k15 = null;
    try {
      const kl = KL.loadLocal(x.instId, '5m', 5);
      if (kl && kl.length >= 2) {
        const last = kl[kl.length - 1].c, p5 = kl[kl.length - 2].c;
        if (last && p5) k5 = (last - p5) / p5 * 100;
        if (kl.length >= 4) {
          const p15 = kl[kl.length - 4].c;
          if (last && p15) k15 = (last - p15) / p15 * 100;
        }
      }
    } catch (e) { }
    if ((k5 !== null && k5 !== undefined) && a.p5n === 0) { a.p5 += k5; a.p5n++; }
    if ((k15 !== null && k15 !== undefined) && a.p15n === 0) { a.p15 += k15; a.p15n++; }

    // ★兜底：WS 快照不足（刚启动，10 秒缓冲未满 5 分钟）→ 用当日 1D 涨跌
    if (t && t.pct1d !== null && t.pct1d !== undefined) {
      a.d1 += (t.pct1d || 0); a.d1n++;
      a.turn += (t.turn || 0);
    }
  }
  const list = Object.keys(agg).map(sid => {
    const a = agg[sid];
    const pct1m = a.p1n ? a.p1 / a.p1n : 0;
    const pct5m = a.p5n ? a.p5 / a.p5n : 0;
    const pct15m = a.p15n ? a.p15 / a.p15n : 0;
    return {
      sector: sid, name: a.name, icon: a.icon, count: a.count,
      pct1m: +pct1m.toFixed(3), pct5m: +pct5m.toFixed(3), pct15m: +pct15m.toFixed(3),
      pct1d: +(a.d1n ? a.d1 / a.d1n : 0).toFixed(3),
      buyRatio: null, buyRatioDev: null,
      turn: Math.round(a.turn),
      // wsReady: 该板块有多少标的拿到了真实分时（WS 缓冲够）
      wsReady: a.wsOk, wsTotal: a.count
    };
  }).sort((a, b) => b.pct5m - a.pct5m);

  // 全市场基准
  const w = list.reduce((s, x) => s + x.count, 0) || 1;
  const mkt = {
    pct1m: +(list.reduce((s, x) => s + x.pct1m * x.count, 0) / w).toFixed(3),
    pct5m: +(list.reduce((s, x) => s + x.pct5m * x.count, 0) / w).toFixed(3),
    pct15m: +(list.reduce((s, x) => s + x.pct15m * x.count, 0) / w).toFixed(3),
    pct1d: +(list.reduce((s, x) => s + x.pct1d * x.count, 0) / w).toFixed(3),
    buyRatio: null,
    wsReady: list.reduce((s, x) => s + x.wsReady, 0), wsTotal: w
  };
  // 各板块相对大盘超额
  list.forEach(x => {
    x.ex1m = +(x.pct1m - mkt.pct1m).toFixed(3);
    x.ex5m = +(x.pct5m - mkt.pct5m).toFixed(3);
    x.ex15m = +(x.pct15m - mkt.pct15m).toFixed(3);
  });

  return { ok: true, at: Date.now(), list, market: mkt };
}

/* ============================================================================
 * 组合入口（一次请求返回全部核实数据，AJAX 友好）
 * [taker removed 2026-10-26] verify/signalBacktest 已移除，仅保留分时板块对比
 * ========================================================================== */
async function all(opt) {
  opt = opt || {};
  if (!opt.force && CACHE && Date.now() - CACHE_AT < TTL) return CACHE;
  const it = await intraday();
  const data = { ok: it.ok, at: Date.now(), intraday: it };
  CACHE = data; CACHE_AT = Date.now();
  return data;
}

/* ---------------- 后台预热（★核实要读 503 个 K线库，冷启 29 秒 → 不能放请求链路） ---------------- */
let WARMING = false;
async function warm(opt) {
  if (WARMING) return { ok: false, err: 'warming' };
  WARMING = true;
  const t0 = Date.now();
  try {
    const d = await all(Object.assign({}, opt, { force: true }));
    return { ok: d.ok, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e), ms: Date.now() - t0 };
  } finally { WARMING = false; }
}

module.exports = { intraday, all, warm, pearson, SECT_NAME, SECT_ICON };