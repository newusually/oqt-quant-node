/* ============================================================================
 * modules/okx/engines/okxws.js —— OKX 全量行情【统一 WebSocket 引擎】
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）："能不能全部使用ws"
 *   合约 7×24 全时段交易，休市不影响
 *
 * ★为什么全走 WS：
 *   REST 的 rubik/taker-volume 与 market/candles 限流极严(串行 120ms 即 429)，
 *   扫 40 个合约 24 秒，粒度还被钉死在 5 分钟。
 *   ★绝不能用多 IP 伪造绕过限流(违反 OKX 服务条款 → IP 段被永久封禁)。
 *   OKX 官方公共 WS 本来就是给高频用的，不限 REST 配额：
 *     wss://ws.okx.com:8443/ws/v5/public
 *
 * ★实测验证的频道能力（勿臆断）：
 *   tickers  → {last, open24h, high24h, low24h, sodUtc0, sodUtc8, vol24h, volCcy24h, ts}
 *              ★含 sodUtc8(北京时间当日开盘) → 当日 1D 涨跌幅可算，与 REST 完全一致
 *   trades   → {instId, tradeId, px, sz, side:"buy"|"sell", ts, count}
 *              ★side 即 taker 方向 → 本地分桶聚合出 30s/1m/5m/15m 任意粒度
 *   candleXm → 只在每根收线时推送，拿不到历史快照 → 故分时涨跌改用 tickers 本地快照
 *
 * ★省掉的两个 REST 依赖：
 *   1) 5m/1m 涨跌幅 不再请求 candles —— 用 tickers 的 last 每 10 秒存一个快照点，
 *      保留 40 点(≈6.7 分钟)，1m=6 点前，5m=30 点前，零请求
 *   2) taker 买卖量 不再请求 rubik  —— 用 trades 频道本地聚合，零请求
 *
 * ★订阅规模：tickers 全量(≈507) + trades 活跃 top(≈120)，共 9~10 个连接
 *   (OKX 单连接上限 100 args，连接数上限够用)
 * ========================================================================== */
'use strict';

const WS_URL = 'wss://ws.okx.com:8443/ws/v5/public';
const SUB_PER_CONN = 80;      // 每连接订阅数(OKX 上限 100，留余量)
const PING_MS = 20000;        // 心跳(OKX 要求 30s 内有上行消息)

// ── taker 分桶（30 秒桶）
const BUCKET_MS = 30000;
const BUCKETS = 30;           // 30 桶 = 15 分钟
// ── 价格快照（10 秒点）
const HIST_MS = 10000;
const HIST_N = 180;           // 180 点 ≈ 30 分钟（留足 1m/5m/15m 多周期分析窗口）

const state = new Map();      // instId → {px, sodUtc8, open24h, vol24, volCcy, ts, h:[], b:[]}
const conns = [];
let started = false;
const stat = { msgs: 0, tick: 0, trades: 0, err: 0, reconnect: 0, at: 0, subs: 0 };

/* ---------------- 状态存取 ---------------- */
function st(instId) {
  let s = state.get(instId);
  if (!s) {
    s = { px: 0, sodUtc8: 0, open24h: 0, high24h: 0, low24h: 0, vol24: 0, volCcy: 0, ts: 0, h: [], b: [], lastTrade: 0, lastTradeSide: '' };
    state.set(instId, s);
  }
  return s;
}
function bucketOf(ts) { return Math.floor(ts / BUCKET_MS); }
function slotOf(ts) { return Math.floor(ts / HIST_MS); }

/* ---------------- tickers 处理（价格 + 当日开盘 + 快照） ---------------- */
function onTicker(d) {
  const id = d.instId;
  const s = st(id);
  const px = +d.last;
  if (isFinite(px) && px > 0) {
    s.px = px;
    s.ts = +d.ts || Date.now();
    // 10 秒一格的价格快照（同一格内覆盖为最新值）
    const k = slotOf(s.ts);
    const last = s.h.length ? s.h[s.h.length - 1] : null;
    if (!last || last.k !== k) {
      s.h.push({ k: k, px: px, t: s.ts });
      if (s.h.length > HIST_N) s.h.shift();
    } else { last.px = px; last.t = s.ts; }
  }
  if (d.sodUtc8) s.sodUtc8 = +d.sodUtc8;      // ★北京时间当日开盘
  if (d.sodUtc0) s.sodUtc0 = +d.sodUtc0;
  if (d.open24h) s.open24h = +d.open24h;
  if (d.high24h) s.high24h = +d.high24h;
  if (d.low24h) s.low24h = +d.low24h;
  if (d.vol24h) s.vol24 = +d.vol24h;
  if (d.volCcy24h) s.volCcy = +d.volCcy24h;
  stat.tick++;
}

/* ---------------- trades 处理（taker 分桶） ---------------- */
function onTrade(d) {
  const id = d.instId;
  const s = st(id);
  const q = +d.sz;
  if (!isFinite(q) || q <= 0) return;
  const ts = +d.ts || Date.now();
  const px = +d.px || 0;
  const k = bucketOf(ts);
  const curK = bucketOf(Date.now());
  if (k < curK - (BUCKETS - 1)) return;             // 太老，丢弃
  while (s.b.length && s.b[0].k < curK - (BUCKETS - 1)) s.b.shift();
  let cur = s.b.length ? s.b[s.b.length - 1] : null;
  if (!cur || cur.k !== k) { cur = { k: k, buy: 0, sell: 0, n: 0 }; s.b.push(cur); }
  if (d.side === 'buy') cur.buy += q; else cur.sell += q;
  cur.n++;
  if (ts >= s.ts) { s.ts = ts; if (px > 0) s.px = px; }
  /* ★单独记录【最近一笔成交时间】—— s.ts 会被 tickers 频道覆盖，
   *   无法用来算"taker 数据距今多久"（用户: "没有秒级的更新吗"） */
  if (!s.lastTrade || ts > s.lastTrade) { s.lastTrade = ts; s.lastTradeSide = d.side; }
  s.tradePx = px;
  stat.trades++;
}

/* ---------------- 查询：实时快照（价格 + 各粒度涨跌） ---------------- */
function snap(id) {
  const s = state.get(id);
  if (!s || !s.px) return null;
  const px = s.px;
  // 当日 1D（北京时间）：sodUtc8
  const pct1d = s.sodUtc8 > 0 ? (px - s.sodUtc8) / s.sodUtc8 * 100 : 0;
  const pct24 = s.open24h > 0 ? (px - s.open24h) / s.open24h * 100 : 0;
  // 分时：从 10 秒快照里取 N 秒前那格
  function ago(ms) {
    if (!s.h.length) return null;
    const target = slotOf(Date.now() - ms);
    // 找 <= target 的最近一格
    for (let i = s.h.length - 1; i >= 0; i--) {
      if (s.h[i].k <= target) return s.h[i].px;
    }
    return null;                                  // 历史不够长(刚启动)
  }
  const p5 = ago(300000), p1 = ago(60000), p15 = ago(900000);
  return {
    instId: id, px,
    sodUtc8: s.sodUtc8, open24h: s.open24h,
    pct1d, pct24,
    pct5m: p5 ? (px - p5) / p5 * 100 : null,      // null = 快照不足(刚启动/刚订阅)
    pct1m: p1 ? (px - p1) / p1 * 100 : null,
    pct15m: p15 ? (px - p15) / p15 * 100 : null,   // ★15分钟分时（缓冲 30 分钟，够用）
    vol24: s.vol24, volCcy: s.volCcy,
    turn: s.volCcy * px,
    ts: s.ts,
    histLen: s.h.length
  };
}

/* ---------------- 多标的等权价格曲线（板块涨跌 vs takervol 相关性用） ----------------
 * 返回 [{ts, value}] —— value = 该标的对【窗口首价】的涨跌%，多标的按等权平均
 * ★为什么要这个：
 *   - WS 只保留 10 秒一格的价格点，无法直接给出"板块平均涨跌曲线"
 *   - 本地 5m K 线库全部陈旧 2.7 小时（keepLatest 只刷新被浏览过的合约），
 *     批量读 507 个库实测 31 秒 → 绝不能放在请求链路上
 *   → 唯一能实时拿到"板块价格曲线"的办法：从 WS 内存缓冲直接算（毫秒级、零请求）
 */
function histSeries(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return [];
  // 1) 每个标的算出相对首价的涨跌序列（按 slot 归并）
  const bySlot = new Map();      // slot → {sum, n}
  for (const id of list) {
    const s = state.get(id);
    if (!s || !s.h.length) continue;
    const base = s.h[0].px;
    if (!base) continue;
    for (const pt of s.h) {
      if (!pt.px) continue;
      let b = bySlot.get(pt.k);
      if (!b) { b = { sum: 0, n: 0 }; bySlot.set(pt.k, b); }
      b.sum += (pt.px - base) / base * 100;
      b.n++;
    }
  }
  const slots = Array.from(bySlot.keys()).sort((a, b) => a - b);
  const out = [];
  for (const k of slots) {
    const b = bySlot.get(k);
    out.push({ ts: k * HIST_MS, value: +(b.sum / b.n).toFixed(4), n: b.n });
  }
  return out;
}

/* ---------------- 连接管理 ---------------- */
function openConn(subs, idx) {
  let ws;
  try { ws = new WebSocket(WS_URL); } catch (e) { return null; }
  const conn = { ws, idx, subs, alive: false, ping: null };
  conns[idx] = conn;

  const send = (o) => { try { if (ws.readyState === 1) ws.send(typeof o === 'string' ? o : JSON.stringify(o)); } catch (e) { } };

  ws.onopen = () => {
    conn.alive = true;
    for (let i = 0; i < subs.length; i += 50) {
      send({ op: 'subscribe', args: subs.slice(i, i + 50) });
    }
  };

  ws.onmessage = (ev) => {
    stat.msgs++;
    if (ev.data === 'pong') return;
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.event === 'error') { stat.err++; return; }
    if (m.event) return;
    const ch = m.arg && m.arg.channel;
    if (!m.data) return;
    if (ch === 'tickers') { for (const d of m.data) { try { onTicker(d); } catch (e) { } } }
    else if (ch === 'trades') { for (const d of m.data) { try { onTrade(d); } catch (e) { } } }
  };

  ws.onerror = () => { stat.err++; };
  ws.onclose = () => {
    conn.alive = false;
    if (conn.ping) { clearInterval(conn.ping); conn.ping = null; }
    setTimeout(() => { if (conns[idx] === conn) { stat.reconnect++; openConn(subs, idx); } }, 2500);
  };

  conn.ping = setInterval(() => { if (ws.readyState === 1) send('ping'); }, PING_MS);
  return conn;
}

/* ---------------- ★动态订阅（空闲降频） ----------------
 *   实测（2026-10-25）：全量订阅 287 合约 tickers + 287 trades = 574 订阅，
 *   8 条连接每秒收 1200+ 条消息 → 进程常驻 16~84% CPU。
 *   但用户不开页面时，这些行情没人看 → 纯浪费。
 *   方案：空闲时只保留【核心合约】（BTC/ETH 等 12 个），
 *        有真实访问时再恢复全量订阅。
 */
const CORE_SYMS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'TRX', 'TON'];
let fullTickList = [];
let fullTradeList = [];
let idleMode = false;

/** 进入空闲模式：只保留核心合约 */
function enterIdle() {
  if (idleMode || !started) return;
  idleMode = true;
  const keep = new Set(CORE_SYMS);
  const tk = fullTickList.filter(id => keep.has(String(id).split('-')[0]));
  const td = fullTradeList.filter(id => keep.has(String(id).split('-')[0]));
  const all = tk.map(id => ({ channel: 'tickers', instId: id }))
    .concat(td.map(id => ({ channel: 'trades', instId: id })));
  if (!all.length) return;
  // 关闭现有连接，重开小订阅
  try { closeAll(); } catch (e) { }
  const n = Math.min(4, Math.ceil(all.length / SUB_PER_CONN));
  for (let i = 0; i < n; i++) openConn(all.slice(i * SUB_PER_CONN, (i + 1) * SUB_PER_CONN), i);
  stat.subs = all.length;
  console.log('[ws] 空闲模式：订阅降到 ' + all.length + '（核心 ' + CORE_SYMS.length + ' 合约）');
}

/** 恢复全量订阅 */
function exitIdle() {
  if (!idleMode || !started) return;
  idleMode = false;
  try { closeAll(); } catch (e) { }
  const all = fullTickList.map(id => ({ channel: 'tickers', instId: id }))
    .concat(fullTradeList.map(id => ({ channel: 'trades', instId: id })));
  const n = Math.min(16, Math.ceil(all.length / SUB_PER_CONN));
  for (let i = 0; i < n; i++) openConn(all.slice(i * SUB_PER_CONN, (i + 1) * SUB_PER_CONN), i);
  stat.subs = all.length;
  console.log('[ws] 恢复全量订阅：' + all.length);
}

/** 关闭所有连接 */
function closeAll() {
  for (const c of conns) {
    if (!c) continue;
    try { if (c.ping) clearInterval(c.ping); } catch (e) { }
    try { c.ws.close(); } catch (e) { }
  }
  conns.length = 0;
  started = false;
}

/* ---------------- 启动 ----------------
 * tickList: 订阅 tickers 的 instId 数组(全量)
 * tradeList: 订阅 trades 的 instId 数组(活跃 top) */
function start(tickList, tradeList, fullList) {
  const tk = (tickList || []).map(id => ({ channel: 'tickers', instId: id }));
  const td = (tradeList || []).map(id => ({ channel: 'trades', instId: id }));
  const all = tk.concat(td);
  if (!all.length) return { ok: false, err: 'empty' };
  /* ★全量列表单独保存 —— 启动时只订核心合约，访问后靠它恢复全量 */
  if (fullList && fullList.length) {
    fullTickList = fullList.slice();
    fullTradeList = fullList.slice();
  }
  fullTickList = (tickList || []).slice();
  fullTradeList = (tradeList || []).slice();
  const n = Math.min(16, Math.ceil(all.length / SUB_PER_CONN));
  for (let i = 0; i < n; i++) openConn(all.slice(i * SUB_PER_CONN, (i + 1) * SUB_PER_CONN), i);
  started = true;
  stat.at = Date.now();
  stat.subs = all.length;
  return { ok: true, conn: n, tickers: tk.length, trades: td.length };
}

function isStarted() { return started; }
function enterIdleMode() { enterIdle(); }
function exitIdleMode() { exitIdle(); }
function isIdleMode() { return idleMode; }
function getStat() {
  let live = 0;
  for (const c of conns) if (c && c.alive) live++;
  return {
    conn: live, total: conns.length,
    msgs: stat.msgs, tick: stat.tick, trades: stat.trades,
    err: stat.err, reconnect: stat.reconnect,
    insts: state.size, subs: stat.subs,
    uptime: stat.at ? Math.floor((Date.now() - stat.at) / 1000) : 0,
    at: Date.now()
  };
}
function known(id) { const s = state.get(id); return !!(s && s.px); }
function count() { return state.size; }
function allIds() { return Array.from(state.keys()); }

module.exports = { start, isStarted, getStat, snap, known, count, allIds, state, histSeries, enterIdleMode, exitIdleMode, isIdleMode };
