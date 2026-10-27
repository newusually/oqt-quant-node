/* ============================================================================
 * modules/okx/engines/rediscache.js —— ★极简 Redis 客户端（2026-10-28）
 * ----------------------------------------------------------------------------
 * 为什么自己写而不是 npm install redis:
 *   本项目 node_modules 为空(刻意保持零依赖), 且用户要求"更轻/省内存"。
 *   Redis 的 RESP2 协议只有 5 种回复类型, 用 node:net 百来行即可覆盖
 *   GET/SET/DEL/PING 这几个缓存场景需要的命令, 不引入任何第三方包。
 *
 * 设计要点:
 *   1. 单连接 + 命令队列（缓存场景并发量不高, 不值得连接池）
 *   2. 始终降级优先: Redis 未装/未启动/超时 → 所有操作静默返回 null,
 *      **绝不抛错、绝不阻塞主流程**（主服务不能因为缓存挂了而挂）
 *   3. 自动重连: 连接断开后下次调用惰性重连
 *   4. 全部操作带超时(默认 300ms), 超时即放弃本次缓存(不等待)
 *
 * 用途: 共享预聚合结果(updown) + 行情快照(tickers)
 * ========================================================================== */
'use strict';
const net = require('net');

const HOST = process.env.REDIS_HOST || '127.0.0.1';
const PORT = parseInt(process.env.REDIS_PORT, 10) || 6379;
const CMD_TIMEOUT = parseInt(process.env.REDIS_TIMEOUT, 10) || 300;

let sock = null;
let ready = false;
let buf = Buffer.alloc(0);
const pend = [];              // 待回复的命令队列 [{resolve, timer}]
let dead = false;             // 判定不可用时置 true, 之后全部快速失败(不再重试连接)
let deadAt = 0;

/* ---------------- RESP 编码 ---------------- */
function encode(args) {
  const parts = [];
  parts.push(Buffer.from('*' + args.length + '\r\n'));
  for (const a of args) {
    const b = Buffer.from(String(a), 'utf8');
    parts.push(Buffer.from('$' + b.length + '\r\n'));
    parts.push(b);
    parts.push(Buffer.from('\r\n'));
  }
  return Buffer.concat(parts);
}

/* ---------------- RESP 解码(增量) ----------------
 * 返回 null 表示数据还不完整, 继续等下一包 */
function tryParse(b) {
  if (!b.length) return null;
  const t = b[0];
  const nl = b.indexOf('\r\n');
  if (nl < 0) return null;
  const line = b.slice(1, nl).toString();
  if (t === 0x2b) return { v: line, rest: b.slice(nl + 2) };                 // +OK
  if (t === 0x2d) return { v: null, err: line, rest: b.slice(nl + 2) };      // -ERR
  if (t === 0x3a) return { v: parseInt(line, 10), rest: b.slice(nl + 2) };   // :123
  if (t === 0x24) {                                                          // $bulk
    const len = parseInt(line, 10);
    if (len < 0) return { v: null, rest: b.slice(nl + 2) };                  // $-1 = nil
    const start = nl + 2;
    if (b.length < start + len + 2) return null;
    return { v: b.slice(start, start + len).toString('utf8'), rest: b.slice(start + len + 2) };
  }
  if (t === 0x2a) {                                                          // *array
    const n = parseInt(line, 10);
    if (n < 0) return { v: null, rest: b.slice(nl + 2) };
    let rest = b.slice(nl + 2), out = [];
    for (let i = 0; i < n; i++) {
      const r = tryParse(rest);
      if (!r) return null;
      out.push(r.v); rest = r.rest;
    }
    return { v: out, rest: rest };
  }
  return { v: null, err: '未知回复类型', rest: Buffer.alloc(0) };
}

function flush() {
  while (true) {
    const r = tryParse(buf);
    if (!r) break;
    buf = r.rest;
    const p = pend.shift();
    if (p) { clearTimeout(p.timer); p.resolve(r.err ? null : r.v); }
  }
}

function killConn() {
  try { if (sock) sock.destroy(); } catch (e) { }
  sock = null; ready = false; buf = Buffer.alloc(0);
  for (const p of pend.splice(0)) { clearTimeout(p.timer); p.resolve(null); }
}

function connect() {
  return new Promise(res => {
    if (ready && sock) return res(true);
    if (dead) return res(false);
    try {
      const s = net.createConnection({ host: HOST, port: PORT });
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; try { s.destroy(); } catch (e) { } res(false); } }, 1500);
      s.on('connect', () => { clearTimeout(to); if (!done) { done = true; sock = s; ready = true; res(true); } });
      s.on('data', d => { buf = Buffer.concat([buf, d]); flush(); });
      s.on('error', () => { clearTimeout(to); if (!done) { done = true; res(false); } killConn(); });
      s.on('close', () => { clearTimeout(to); if (!done) { done = true; res(false); } killConn(); });
    } catch (e) { res(false); }
  });
}

async function cmd(args) {
  /* 快速失败: Redis 判定不可用后 60 秒内不再尝试连接(避免每个请求都去连一次) */
  if (dead && Date.now() - deadAt < 60000) return null;
  const ok = await connect();
  if (!ok) { dead = true; deadAt = Date.now(); return null; }
  return new Promise(res => {
    const timer = setTimeout(() => { res(null); }, CMD_TIMEOUT);   // 超时放弃本次缓存
    pend.push({ resolve: res, timer: timer });
    try { sock.write(encode(args)); } catch (e) { clearTimeout(timer); const i = pend.length - 1; if (i >= 0) pend.splice(i, 1); res(null); }
  });
}

/* ---------------- 对外 API（全部静默降级） ---------------- */
async function get(key) { try { return await cmd(['GET', key]); } catch (e) { return null; } }
async function setex(key, ttlSec, val) {
  try { await cmd(['SETEX', key, String(Math.max(1, Math.round(ttlSec))), val]); return true; }
  catch (e) { return false; }
}
async function del(key) { try { await cmd(['DEL', key]); return true; } catch (e) { return false; } }

/* JSON 便捷方法 */
async function getJSON(key) {
  const s = await get(key);
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}
async function setJSON(key, ttlSec, obj) {
  try { return await setex(key, ttlSec, JSON.stringify(obj)); } catch (e) { return false; }
}

async function ping() {
  const r = await cmd(['PING']);
  return r === 'PONG';
}

/* 启动探测一次, 不可用时打日志但不影响服务 */
let probed = false;
async function probe() {
  if (probed) return;
  probed = true;
  const ok = await ping();
  console.log('[rediscache] Redis ' + HOST + ':' + PORT + ' → ' +
    (ok ? '可用(缓存已启用)' : '不可用(自动降级为纯内存缓存, 服务不受影响)'));
}
setTimeout(probe, 2000);

module.exports = { get: get, setex: setex, del: del, getJSON: getJSON, setJSON: setJSON, ping: ping };
