/* 02-state.js — 状态层：db / 盘口 / 金字塔 / K线事件槽
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
let db = null, started = false;
/* pxIns：px_hist 分钟价格桶 UPSERT 语句（懒创建） */
let pxIns = null;
/* pxBuf：待落库的分钟价格桶缓冲（key = instId|分钟） */
const pxBuf = new Map();
let ws = { conns: [], alive: 0, subs: 0, msgs: 0, err: 0, reconnect: 0, booksMsgs: 0, tradeMsgs: 0 };
const books = new Map();
const lastPx = new Map();
const pxHist = new Map();
const longPxHist = new Map();
/* ★★2026-11-09 MACD 入场信号缓存：key = instId|tfId → { dir, prev, barTs, last, bars, at }
 *   dir = 1 买多 / -1 卖空 / 0 无信号；数据源 OKX REST candles。
 *   ★刷新时机：只按 15m K 线边界定时（:00/:15/:30/:45），不再做全市场轮转。 */
const macdCache = new Map();
let macdQueue = [];
const macdStat = { ok: 0, fail: 0, buy: 0, sell: 0, none: 0, refreshed: 0, cycles: 0 };
/* 定时调度状态：tfId -> { lastBar, startedAt, finishedAt, queued, done, intervalMs } */
const macdSched = {};
let macdJobs = [];                   // 待刷新任务 { inst, tf }，按周期顺序（15m 优先）
let macdRunning = false;
const jumpStat = {
  rev: 0, up: 0, down: 0, flat: 0, nohist: 0, maxChgBp: 0, scanned: 0,
  maxSeriesLen: 0, maxSpanMin: 0, instWithSeries: 0,
  nohist_none: 0, nohist_short: 0, nohist_span: 0, nohist_px: 0,
  filledMid: 0, filledTrade: 0, persisted: 0, restored: 0,
  rev1h: 0, nohist1h: 0, mom: 0
};
const taker = new Map();
const universe = [];
let deepList = [];
let deepStat = { ok: 0, fail: 0, imb10Sum: 0, imb10N: 0 };
const pyramids = new Map();          // pid -> p
const pyrActive = new Map();        // inst|tf|dir -> pid
let pendingPyr = [];                 // 待落库的金字塔事件
let pyrSeq = 0;                      // 自增金字塔序号
/* 硬性规定：同一合约·同一周期·同一根K线，只允许一次「买多/卖空/加仓」。
 *   pyrBarUsed: "inst|tf|barStart" -> 1；barStart = 该根K线的起始毫秒时间戳。
 *   服务重启后从 pyr 表回填最近 26 小时的事件，保证重启不会绕过该规则。 */
const pyrBarUsed = new Map();

function pyrBarStart(tfId, ts) {
  for (let i = 0; i < PYR.TFS.length; i++) {
    if (PYR.TFS[i].id === tfId) return Math.floor(ts / (PYR.TFS[i].step * 60000)) * PYR.TFS[i].step * 60000;
  }
  return Math.floor(ts / 60000) * 60000;
}
function pyrBarTaken(instId, tfId, ts) {
  return pyrBarUsed.has(instId + '|' + tfId + '|' + pyrBarStart(tfId, ts));
}
function pyrBarMark(instId, tfId, ts) {
  pyrBarUsed.set(instId + '|' + tfId + '|' + pyrBarStart(tfId, ts), 1);
  /* 内存保护：超过 4 万槽时清理 26 小时前的旧 K 线槽 */
  if (pyrBarUsed.size > 40000) {
    const cut = Math.floor(Date.now() / 60000) * 60000 - 26 * 3600000;
    for (const k of pyrBarUsed.keys()) {
      if (+k.slice(k.lastIndexOf('|') + 1) < cut) pyrBarUsed.delete(k);
    }
  }
}
/* 重启后回填同根K线事件槽（近 26 小时内的买多/卖空/加仓） */
function restoreBarUsed() {
  if (!db) return;
  try {
    const rows = db.prepare(
      "SELECT inst_id, tf, ts FROM pyr WHERE ts >= ? AND event IN ('buy','sell','add')").all(Date.now() - 26 * 3600000);
    let n = 0;
    for (const r of rows) {
      const k = r.inst_id + '|' + r.tf + '|' + pyrBarStart(r.tf, r.ts);
      if (!pyrBarUsed.has(k)) { pyrBarUsed.set(k, 1); n++; }
    }
    if (n) console.log('[pyr] 同根K线事件槽回填: ' + n + ' 个（近26小时 buy/sell/add）');
  } catch (e) { console.error('[pyr] 同根K线事件槽回填失败:', e.message); }
}
let startedAt = 0, endAt = 0, lastSettleAt = 0, settleSeq = 0;
let totalTrades = 0;

