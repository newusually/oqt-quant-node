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
function livePx(id) {
  ensureSources();
  if (_WS && typeof _WS.snap === 'function') {
    const t = _WS.snap(id);
    if (t && isFinite(t.px) && t.px > 0) return t.px;
  }
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

/* 前一根已收盘 bar：预聚合库最后一条 */
function computePrev(grain) {
  try {
    const ST = require('./updownstore');
    const m = ST.agg(grain, null);
    if (m && m.size) {
      const arr = Array.from(m.values());
      const e = arr[arr.length - 1];
      if (e) return {
        ts: e.ts, up: e.up, down: e.down, flat: e.flat, total: e.n,
        upRatio: e.n ? +(e.up / e.n * 100).toFixed(2) : 0,
        diff: e.up - e.down
      };
    }
  } catch (e) { }
  return null;
}

async function computeOne(grain) {
  const u = await I.universe();
  if (!u || !u.ok || !u.list || !u.list.length) return null;
  const list = u.list;
  const lastClose = await getLastClose(grain);
  const cur = computeCur(grain, list, lastClose);
  const btc = btcCandle(grain, list, lastClose);
  const prev = computePrev(grain);
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
