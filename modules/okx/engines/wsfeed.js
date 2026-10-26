/* ============================================================================
 * modules/okx/engines/wsfeed.js —— OKX 公共 WebSocket 实时行情（毫秒级）
 * ----------------------------------------------------------------------------
 * 用户要求：
 *   "行情毫秒级ws 没有声音啊 给我毫秒级"
 *   "首页各类涨幅 信号等 包括A股 okx nq面板 根本没有实时拿数据 没有ajax更新数据啊"
 *
 * 做法：
 *   服务端长连 OKX 公共 WS(wss://ws.okx.com:8443/ws/v5/public)，【按 instId 批量订阅】
 *   成交量和关注度最高的约 250 个 USDT 永续（v5 公共 WS 不支持 instType 批量订阅，
 *   必须逐个 instId；单连接上限约 300，取 250 留余量），OKX 每有成交就推送 →
 *   内存 Map 实时更新；浏览器通过 SSE(/api/okx/stream)拿增量，价格变动【毫秒级】
 *   反映到页面，不再等 3 秒轮询。断线自动重连(指数退避)，每 10 分钟刷新订阅列表。
 *
 * 接口：
 *   wsfeed.snapshot()          → {ok, list:[{instId,last,pxText,chg,chgText,...}], at}
 *   wsfeed.subscribe(fn)       → 每次批量更新回调(list) → 返回取消函数
 *   wsfeed.stats()             → {connected, lastMsgAt, count, reconnects, subscribed}
 * ========================================================================== */
'use strict';

const WS_URL = 'wss://ws.okx.com:8443/ws/v5/public';
const SUB_LIMIT = 250;             // 单连接订阅上限 300, 取 250 留余量
const SUB_REFRESH = 10 * 60 * 1000; // 10 分钟刷新一次订阅列表(接纳新合约)

// 价格格式化：与 realtime.fp4 同口径
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

let ws = null;
let connected = false;
let lastMsgAt = 0;
let reconnects = 0;
let reconnectTimer = null;
let subscribed = false;
let dirty = new Set();                 // 本次增量里有变更的 instId
let listeners = [];                    // SSE 订阅者
const TICK = new Map();                // instId → {instId,last,pxText,open24h,chg,chgText,high24h,low24h,vol24h,volCcy24h,ts}

function log() {
  try { require('../../../core/log').info.apply(null, arguments); } catch (e) { }
}

function connect() {
  if (ws) { try { ws.close(); } catch (e) { } ws = null; }
  let WebSocket;
  try {
    // Node 22 自带全局 WebSocket
    WebSocket = global.WebSocket;
  } catch (e) { WebSocket = null; }
  if (!WebSocket) {
    log('wsfeed', '当前 Node 无全局 WebSocket, 毫秒级行情不可用(回退轮询)');
    return;
  }
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = function () {
    connected = true;
    subscribed = false;
    // 按 instId 批量订阅(成交量最大的 SUB_LIMIT 个 USDT 永续)
    buildSubArgs().then(function (args) {
      if (!ws || ws.readyState !== 1) return;
      try {
        ws.send(JSON.stringify({ op: 'subscribe', args: args }));
        subscribed = true;
        log('wsfeed', 'OKX 公共WS已连接, 批量订阅 ' + args.length + ' 个合约 tickers');
      } catch (e) { }
    }).catch(function () { });
  };

  ws.onmessage = function (ev) {
    lastMsgAt = Date.now();
    let j;
    try { j = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
    if (!j || !j.data) return;
    const arg = j.arg || {};
    if (arg.channel !== 'tickers') return;
    for (const t of j.data) {
      const last = +t.last, open = +t.open24h;
      if (!isFinite(last) || last <= 0) continue;
      const chg = open ? (last - open) / open * 100 : 0;
      TICK.set(t.instId, {
        instId: t.instId,
        last,
        pxText: fp4(last),
        open24h: open,
        chg,
        chgText: (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%',
        high24h: +t.high24h, low24h: +t.low24h,
        vol24h: +t.vol24h, volCcy24h: +t.volCcy24h,
        ts: +t.ts
      });
      dirty.add(t.instId);
    }
  };

  ws.onerror = function () { /* 交给 onclose 重连 */ };

  ws.onclose = function () {
    connected = false;
    subscribed = false;
    ws = null;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnects++;
  const delay = Math.min(30000, 1000 * Math.pow(1.7, Math.min(8, reconnects)));
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    connect();
  }, delay);
}

/* 构造订阅列表: 成交量最大的 SUB_LIMIT 个 USDT 本位永续 */
async function buildSubArgs() {
  try {
    const rt = require('./realtime');
    const t = await rt.tickers();
    const list = (t && t.ok && t.list) ? t.list : [];
    const usdt = list
      .filter(x => /USDT/.test(x.instId))
      .sort((a, b) => (b.volCcy24h || 0) - (a.volCcy24h || 0))
      .slice(0, SUB_LIMIT);
    if (!usdt.length) {
      // REST 也失败 → 至少订阅几个主流币, 保证有数据
      return ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'XRP-USDT-SWAP', 'DOGE-USDT-SWAP']
        .map(id => ({ channel: 'tickers', instId: id }));
    }
    return usdt.map(x => ({ channel: 'tickers', instId: x.instId }));
  } catch (e) {
    return ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP']
      .map(id => ({ channel: 'tickers', instId: id }));
  }
}

/* 每 300ms 把增量推给 SSE 订阅者（批量, 不是每条消息一个事件） */
setInterval(function () {
  if (!dirty.size || !listeners.length) { if (dirty.size > 4000) dirty.clear(); return; }
  const batch = [];
  for (const id of dirty) {
    const t = TICK.get(id);
    if (t) batch.push(t);
  }
  dirty.clear();
  if (!batch.length) return;
  const payload = 'data: ' + JSON.stringify({ ok: true, list: batch, at: Date.now() }) + '\n\n';
  for (const fn of listeners.slice()) {
    try { fn(payload); } catch (e) { }
  }
}, 300).unref?.();

/* 心跳: 15 秒一条注释, 防代理断 idle */
setInterval(function () {
  const hb = ': ping ' + Date.now() + '\n\n';
  for (const fn of listeners.slice()) { try { fn(hb); } catch (e) { } }
}, 15000).unref?.();

function snapshot() {
  const list = [];
  for (const t of TICK.values()) list.push(t);
  list.sort((a, b) => (b.volCcy24h || 0) - (a.volCcy24h || 0));
  return { ok: connected, list, at: Date.now(), count: TICK.size };
}

function subscribe(fn) {
  listeners.push(fn);
  // 立刻推一份全量快照, 让页面秒开
  try { fn('data: ' + JSON.stringify(snapshot()) + '\n\n'); } catch (e) { }
  return function () {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function stats() {
  return {
    connected, lastMsgAt, count: TICK.size, reconnects,
    listeners: listeners.length, subscribed,
    lastMsgAgo: lastMsgAt ? Date.now() - lastMsgAt : -1
  };
}

// 启动即连（服务起来就开始收行情）
connect();

// 每 10 分钟刷新订阅列表（接纳新合约 / 成交量排名变化）
setInterval(function () {
  if (!connected || !ws) return;
  buildSubArgs().then(function (args) {
    if (!ws || ws.readyState !== 1) return;
    try {
      // 先退订旧列表再订新列表(退订参数与订阅相同)
      ws.send(JSON.stringify({ op: 'unsubscribe', args: args }));
      ws.send(JSON.stringify({ op: 'subscribe', args: args }));
    } catch (e) { }
  }).catch(function () { });
}, SUB_REFRESH).unref?.();

module.exports = { snapshot, subscribe, stats, connect };
