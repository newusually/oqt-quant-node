/* ============================================================================
 * modules/okx/engines/liveupdown.js —— ★实时涨跌家数引擎（WS 秒级）
 * ----------------------------------------------------------------------------
 * 用户需求（2026-10-28）："ws实时计数 我要" / "改成ws实时的当前数据+前一个时间段数据
 *          其他都是历史" —— 详细表格的【当前形成中 bar】和【前一根已收盘 bar】
 *          走 WS 实时计数（秒级跳动），更老的历史走预聚合(5分钟重建)。
 *
 * 做法：
 *   - 每秒用 okxws(优先)/wsfeed(兜底) 的实时价，对比每个合约「上一根已收盘」的收盘价，
 *     实时数出 当前形成中 bar 的 上涨/下跌/平盘 家数（与 updown.js 的 WS 片口径一致）。
 *   - 前一根 bar 取预聚合库(updown.sqlite)最后一条（已收盘，5分钟重建刷新）。
 *   - 通过 SSE 推给前端，前端把表格顶 2 行实时刷掉；历史行不变。
 *
 * 只在「有订阅者」的周期上计算，无客户端时不占用 CPU。
 * ========================================================================== */
'use strict';
const I = require('./universe');
const KS = require('./kstore');
const GRAIN_MS = {
  '3m': 180000, '5m': 300000, '15m': 900000,
  '1h': 3600000, '2h': 7200000, '4h': 14400000
};

let started = false;
let timer = null;
const tips = {};                                   // grain -> 最近一次 tip
const subs = {};                                   // grain -> Set<fn>
const lcCache = {};                                // grain -> {at, map: instId->{ts,c}}

/* ---- 实时价双源（与 updown.js 一致）---- */
let _WS = null, _WSF = null, _wsAt = 0, _wsfMap = null, _wsfAt = 0, _sourcesEnsured = false;
function ensureSources() {
  if (!_WS) { try { _WS = require('./okxws'); } catch (e) { } }
  if (!_WSF) { try { _WSF = require('./wsfeed'); } catch (e) { } }
  if (_sourcesEnsured) return;
  _sourcesEnsured = true;
  /* ★确保 wsfeed(公开 250 ticker, 无需鉴权) 已连接 —— 否则无人看图时 wsfeed 处于
   *   断开态 → livePx 取不到任何价 → cur.n=0 → 永远不推送。主动 connect 保证实时计数
   *   始终有数据源（覆盖绝大多数标的, n≈252）。okxws 若已被其它页面拉起则作为补充源,
   *   这里不主动调用 okxws.start() 以免在无人看图时触发 287 合约订阅风暴。 */
  if (_WSF && typeof _WSF.connect === 'function') { try { _WSF.connect(); } catch (e) { } }
}
/* REST 全市场实时价兜底(当 wsfeed/ws 未就绪/未订阅时, 保证实时涨跌计数仍有价可数)。
 * realtime.tickers() 是 OKX 公开 REST(/api/v5/market/tickers?instType=SWAP), 自带 3s 缓存,
 * 返回全部 USDT 永续的 last; 这里再叠 2s 本地缓存, 每秒刷新几乎零额外开销。 */
let _restMap = null, _restAt = 0;
async function restMap() {
  if (_restMap && Date.now() - _restAt < 2000) return _restMap;
  try {
    const rt = require('./realtime');
    const t = await rt.tickers();
    if (t && t.ok && t.list && t.list.length) {
      const m = {};
      for (const x of t.list) { const v = +x.last; if (x.instId && isFinite(v) && v > 0) m[x.instId] = v; }
      if (Object.keys(m).length) { _restMap = m; _restAt = Date.now(); return m; }
    }
  } catch (e) { }
  return _restMap || {};
}

function livePx(id) {
  ensureSources();
  // 1) okxws(页面活跃时的秒级源, 最新鲜)
  if (_WS && typeof _WS.snap === 'function') {
    const t = _WS.snap(id);
    if (t && isFinite(t.px) && t.px > 0) return t.px;
  }
  // 2) wsfeed(公开 250 ticker; 若已订阅则有值)
  if (_WSF && typeof _WSF.snapshot === 'function') {
    if (!_wsfMap || Date.now() - _wsfAt > 30000) {
      _wsfMap = {}; _wsfAt = Date.now();
      try {
        const s = _WSF.snapshot();
        (s.list || []).forEach(x => { const v = +x.last; if (x.instId && isFinite(v) && v > 0) _wsfMap[x.instId] = v; });
      } catch (e) { }
    }
    if (_wsfMap[id]) return _wsfMap[id];
  }
  // 3) REST 兜底(全市场实时价, 保证不空)
  if (_restMap && _restMap[id]) return _restMap[id];
  return null;
}

/* 各合约「上一根已收盘」收盘价（预聚合/实时扫描的"前收"基准），30s 缓存 */
async function getLastClose(grain) {
  const hit = lcCache[grain];
  if (hit && Date.now() - hit.at < 30000) return hit.map;
  const map = new Map();
  try {
    const u = await I.universe();
    if (u && u.ok) {
      for (const x of u.list) {
        try {
          const chain = KS.readChain(grain, x.instId, 0, 1);   // 最新一片
          if (!chain.length) continue;
          const db = KS.roOpen(chain[0]);
          if (!db) continue;
          const r = db.prepare('SELECT ts,c FROM kline ORDER BY ts DESC LIMIT 1').get();
          if (r) map.set(x.instId, { ts: r.ts, c: r.c });
        } catch (e) { }
      }
    }
  } catch (e) { }
  lcCache[grain] = { at: Date.now(), map };
  return map;
}

/* 当前形成中 bar：实时价 vs 上收 */
function computeCur(grain, list, lastClose) {
  const GM = GRAIN_MS[grain] || 900000;
  const liveTs = Math.floor(Date.now() / GM) * GM;
  const a = { ts: liveTs, up: 0, down: 0, flat: 0, n: 0 };
  for (const x of list) {
    const px = livePx(x.instId);
    const lc = lastClose.get(x.instId);
    if (!px || !lc || !isFinite(lc.c) || lc.c <= 0) continue;
    const p = (px - lc.c) / lc.c;
    a.n++;
    if (p > 0) a.up++; else { a.down++; if (p === 0) a.flat++; }
  }
  a.upRatio = a.n ? +(a.up / a.n * 100).toFixed(2) : 0;
  a.diff = a.up - a.down;
  a.total = a.n;            // ★SSE 顶行"样本"列需要 total, 否则顶行样本显示空白
  return a;
}

/* 当前 bar 的主力(BTC)实时 K线（用于表格 BTC 列与统计条） */
function btcCandle(grain, list, lastClose) {
  const lead = (list || []).find(x => x.sym === 'BTC') || null;
  if (!lead) return null;
  const lc = lastClose.get(lead.instId);
  const c = livePx(lead.instId);
  if (!lc || !isFinite(c) || c <= 0) return null;
  const o = lc.c, h = Math.max(o, c), l = Math.min(o, c);
  return { o: o, h: h, l: l, c: c, chg: (c - o) / o * 100 };
}

/* 用已落库 K线重算指定片(给 SSE「前一根」用, 避免其样本数偏低) */
async function recomputeBarLive(grain, list, barTs) {
  const GM = GRAIN_MS[grain] || 900000;
  const prevTs = barTs - GM;
  const a = { ts: barTs, up: 0, down: 0, flat: 0, n: 0 };
  for (const x of list) {
    try {
      const chain = KS.readChain(grain, x.instId, 0, 1);
      if (!chain.length) continue;
      const db = KS.roOpen(chain[0]);
      if (!db) continue;
      const rT = db.prepare('SELECT c FROM kline WHERE ts=?').get(barTs);
      const rP = db.prepare('SELECT c FROM kline WHERE ts=?').get(prevTs);
      const cT = (rT && rT.c !== undefined && isFinite(rT.c) && rT.c > 0) ? rT.c : null;
      const cP = (rP && rP.c !== undefined && isFinite(rP.c) && rP.c > 0) ? rP.c : null;
      if (!cT || !cP) continue;
      const pct = (cT - cP) / cP;
      a.n++;
      if (pct > 0) a.up++; else { a.down++; if (pct === 0) a.flat++; }
    } catch (e) { }
  }
  if (a.n < Math.max(20, Math.floor(list.length * 0.1))) return null;
  return a;
}

/* ★2026-10-28 修复「顶行出现两个相同时间戳(重复/延迟)」:
 *   前一根必须固定取「当前形成中 bar 的前一根」= curTs - GM。
 *   旧实现取预聚合库「最后一条」, 而最后一条往往就是正在形成中的当前 bar(其 open-ts 与 cur.ts 相同)
 *   → prev.ts 与 cur.ts 撞车, patchLiveTip 把表格顶两行都写成同一个时间(用户看到的"两个25分/重复行")。
 *   改为按 cur.ts - GM 精确取前收片, 从根本上消除撞车。 */
async function computePrev(grain, curTs) {
  const GM = GRAIN_MS[grain] || 900000;
  const prevTs = (curTs || Math.floor(Date.now() / GM) * GM) - GM;
  let base = null;
  try {
    const ST = require('./updownstore');
    const m = ST.agg(grain, null);
    if (m && m.size) {
      let total = 287;
      try { const u = await I.universe(); if (u && u.list) total = u.list.length; } catch (e) { }
      const minN = Math.max(20, Math.floor(total * 0.1));
      const b = m.get(prevTs);
      if (b && b.n >= minN) base = b;        // 精确取前收片, 不回退到最后一条
    }
  } catch (e) { }
  /* 预聚合库缺失/覆盖偏低 → 用已落库 K线直接重算该前收片(满覆盖) */
  try {
    const u = await I.universe();
    if (u && u.list) {
      const hb = await recomputeBarLive(grain, u.list, prevTs);
      if (hb && hb.n > 0 && (!base || hb.n >= base.n)) {
        return {
          ts: hb.ts, up: hb.up, down: hb.down, flat: hb.flat, total: hb.n,
          upRatio: hb.n ? +(hb.up / hb.n * 100).toFixed(2) : 0,
          diff: hb.up - hb.down
        };
      }
    }
  } catch (e) { }
  if (!base) return null;
  return {
    ts: base.ts, up: base.up, down: base.down, flat: base.flat, total: base.n,
    upRatio: base.n ? +(base.up / base.n * 100).toFixed(2) : 0,
    diff: base.up - base.down
  };
}

async function computeOne(grain) {
  const u = await I.universe();
  if (!u || !u.ok || !u.list || !u.list.length) return null;
  const list = u.list;
  await restMap();                              // 预热 REST 实时价兜底(若 wsfeed/ws 未就绪)
  const lastClose = await getLastClose(grain);
  const cur = computeCur(grain, list, lastClose);
  const btc = btcCandle(grain, list, lastClose);
  const prev = await computePrev(grain, cur.ts);
  const minN = Math.max(2, Math.floor(list.length * 0.3));
  if (cur.n < minN) return null;      // WS 未就绪(快照刚启动/重连中) → 不推送残缺统计
  const tip = { grain: grain, at: Date.now(), cur: Object.assign({ lead: btc }, cur), prev: prev };
  tips[grain] = tip;
  return tip;
}

async function tick() {
  for (const g of Object.keys(subs)) {
    const set = subs[g];
    if (!set || !set.size) continue;
    try {
      const tip = await computeOne(g);
      if (!tip) continue;
      for (const fn of set) { try { fn(tip); } catch (e) { } }
    } catch (e) { }
  }
}

function ensureStarted() {
  if (started) return;
  started = true;
  timer = setInterval(() => { tick().catch(() => { }); }, 1000);
  if (timer.unref) timer.unref();
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null; started = false;
}

function tip(grain) { return tips[grain] || null; }
function subscribe(grain, fn) {
  ensureStarted();
  if (!subs[grain]) subs[grain] = new Set();
  subs[grain].add(fn);
  // 立即算一次(异步)，让首条消息尽快到达
  computeOne(grain).then(t => { if (t) { try { fn(t); } catch (e) { } } }).catch(() => { });
  return function unsub() {
    const set = subs[grain];
    if (set) { set.delete(fn); if (!set.size) delete subs[grain]; }
  };
}

module.exports = { ensureStarted, stop, tip, subscribe, computeOne };
