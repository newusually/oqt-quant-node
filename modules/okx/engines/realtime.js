/* ============================================================================
 * modules/okx/engines/realtime.js —— OKX 实时行情（公共接口，无需凭证）
 * ----------------------------------------------------------------------------
 * 用户要求：
 *   "左边列表 要不仅写他们的合约列表名称还要写价格四位数小数点
 *    还有实时ajax变动 动态价格 上涨有小箭头 下跌也是 红绿区分涨跌实时ws"
 *   "另外列表太占地方了 太长了 实时买卖队列也要加上啊
 *    列表只是显示几行就行 点开来滑动才显示列表可以下拉"
 *   "OKX 还少了持仓监控面板 等面板"
 *
 * 接口（都是公共接口，OK-ACCESS-* 签名不需要）：
 *   GET /api/v5/market/tickers?instType=SWAP          → 全市场实时价 + 涨跌 + 买卖一档
 *   （★返回结果已按 universe 的加密货币名单过滤：不含股票/ETF/指数/贵金属/能源）
 *   GET /api/v5/market/books?instId=xxx&sz=15        → 实时买卖队列(深度)
 *   GET /api/v5/public/instruments?instType=SWAP      → 合约列表(带中文名/成交量)
 * ========================================================================== */
'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const BASE = 'https://www.okx.com';

// 缓存
let TICK_CACHE = null, TICK_AT = 0;
let INST_CACHE = null, INST_AT = 0;
const BOOK_CACHE = new Map();     // instId → {at, data}
const TICK_TTL = 3000;            // 3 秒
const INST_TTL = 6 * 3600 * 1000; // 6 小时
const BOOK_TTL = 2500;            // 2.5 秒

// 价格格式化：小数点后四位自适应（用户要求「价格四位数小数点」）
function fp4(v) {
  v = +v;
  if (!isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(2);
  if (a >= 1) return v.toFixed(4);
  if (a >= 0.01) return v.toFixed(4);
  if (a >= 0.0001) return v.toFixed(6);
  return v.toFixed(8);
}

async function jget(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(BASE + path, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const j = await r.json();
    if (!j || j.code !== '0') return { ok: false, err: (j && j.msg) || ('http ' + r.status) };
    return { ok: true, data: j.data || [] };
  } catch (e) {
    return { ok: false, err: String(e && e.message || e) };
  } finally { clearTimeout(timer); }
}

/* ---------------- 全市场实时 ticker（★只含加密货币） ---------------- */
async function tickers(force) {
  if (!force && TICK_CACHE && Date.now() - TICK_AT < TICK_TTL) return TICK_CACHE;
  const r = await jget('/api/v5/market/tickers?instType=SWAP');
  if (!r.ok) return TICK_CACHE || { ok: false, err: r.err, list: [] };
  // ★只保留加密货币合约（universe 已剔除股票/ETF/指数/贵金属/能源）
  const U = require('./universe');
  const u = await U.universe();
  const allow = {};
  (u.list || []).forEach(x => { allow[x.instId] = 1; });
  const list = [];
  for (const t of r.data) {
    if (!allow[t.instId]) continue;
    const last = +t.last, open = +t.open24h;
    if (!isFinite(last) || last <= 0) continue;
    const chg = open ? (last - open) / open * 100 : 0;
    list.push({
      instId: t.instId,
      last,
      pxText: fp4(last),
      open24h: open,
      chg,
      chgText: (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%',
      high24h: +t.high24h, low24h: +t.low24h,
      vol24h: +t.vol24h, volCcy24h: +t.volCcy24h,
      bidPx: +t.bidPx, bidSz: +t.bidSz,
      askPx: +t.askPx, askSz: +t.askSz,
      ts: +t.ts
    });
  }
  list.sort((a, b) => (b.volCcy24h || 0) - (a.volCcy24h || 0));   // 成交量大的排前面
  TICK_CACHE = { ok: true, list, at: Date.now() };
  TICK_AT = Date.now();
  return TICK_CACHE;
}

/* ---------------- 合约列表（含成交量，用于排序） ---------------- */
async function instruments(force) {
  if (!force && INST_CACHE && Date.now() - INST_AT < INST_TTL) return INST_CACHE;
  const r = await jget('/api/v5/public/instruments?instType=SWAP');
  if (!r.ok) return INST_CACHE || { ok: false, err: r.err, list: [] };
  // ★只保留加密货币合约
  const U = require('./universe');
  const u = await U.universe();
  const allow = {};
  (u.list || []).forEach(x => { allow[x.instId] = 1; });
  const list = r.data.filter(x => allow[x.instId]).map(x => ({
    instId: x.instId,
    instFamily: x.instFamily || '',
    tickSz: x.tickSz,
    ctVal: x.ctVal,
    state: x.state
  }));
  INST_CACHE = { ok: true, list, at: Date.now() };
  INST_AT = Date.now();
  return INST_CACHE;
}

/* ---------------- 实时买卖队列（order book） ---------------- */
async function book(instId, sz) {
  const id = instId || 'ETH-USDT-SWAP';
  const c = BOOK_CACHE.get(id);
  if (c && Date.now() - c.at < BOOK_TTL) return c;
  const r = await jget('/api/v5/market/books?instId=' + encodeURIComponent(id) + '&sz=' + (sz || 12));
  if (!r.ok || !r.data.length) return c || { ok: false, err: r.err, asks: [], bids: [] };
  const d = r.data[0];
  const asks = (d.asks || []).map(a => ({ px: +a[0], sz: +a[1], pxText: fp4(+a[0]) })).slice(0, sz || 12);
  const bids = (d.bids || []).map(b => ({ px: +b[0], sz: +b[1], pxText: fp4(+b[0]) })).slice(0, sz || 12);
  const out = {
    ok: true, instId: id, asks, bids,
    spread: asks.length && bids.length ? (asks[0].px - bids[0].px) : 0,
    ts: +d.ts, at: Date.now()
  };
  BOOK_CACHE.set(id, out);
  return out;
}

/* ---------------- 持仓（私有接口，需凭证） ---------------- */
async function positions() {
  const okxapi = require('./okxapi');
  const r = await okxapi.positions({ instType: 'SWAP' });
  if (!r.ok) return { ok: false, err: r.err, rows: [] };
  const rows = [];
  for (const p of (r.data || [])) {
    const pos = +p.pos, avg = +p.avgPx, mark = +p.markPx;
    if (!pos) continue;                       // 没持仓的跳过
    const upl = +p.upl || 0;
    const uplPct = avg ? upl / (Math.abs(pos) * avg) * 100 : 0;
    rows.push({
      instId: p.instId,
      posSide: p.posSide,                 // long / short
      dir: p.posSide === 'short' ? -1 : 1,
      pos, szText: String(Math.abs(pos)),
      avgPx: avg, avgPxText: fp4(avg),
      markPx: mark, markPxText: fp4(mark),
      upl, uplText: (upl >= 0 ? '+' : '') + upl.toFixed(4),
      uplPct, uplPctText: (uplPct >= 0 ? '+' : '') + uplPct.toFixed(2) + '%',
      notional: Math.abs(pos) * (mark || avg),
      leverage: p.lever,
      mgn: +p.margin || 0, imr: +p.imr || 0,
      liqPx: p.liqPx ? fp4(+p.liqPx) : '-'
    });
  }
  const totalUpl = rows.reduce((a, r) => a + r.upl, 0);
  return { ok: true, rows, count: rows.length, totalUpl, totalUplText: (totalUpl >= 0 ? '+' : '') + totalUpl.toFixed(4) };
}

module.exports = { tickers, instruments, book, positions, fp4 };
