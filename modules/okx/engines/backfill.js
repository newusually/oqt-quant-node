/* ============================================================================
 * modules/okx/engines/backfill.js —— ★历史回补引擎（2026-10-25 第六轮）
 * ----------------------------------------------------------------------------
 * 用户需求："给我历史搞来最高三个月的数据 分析一下 ... 往左移动可以查询更前面历史
 *            一开始只显示100根K线的长度数据"
 *
 * ★为什么需要回补（实测数据缺口）：
 *   - 5m K线库：crypto 最深 56 天，但其余板块中位仅 213 根（17 小时）
 *   → 想画"三个月"的板块双曲线，必须主动回补
 *
 * 接口能力实测（2026-10-25）：
 *   GET /api/v5/market/history-candles
 *     - limit 最大 300（实测 300 行）→ 5m=25h/页, 1H=12.5天/页
 *     - after 参数翻页（返回更早的数据）
 *     - ★限流宽松：60ms 间隔 30 页全过
 *
 * ★分层回补策略（成本 / 收益权衡）：
 *   层C  5m 粒度 K线 —— 支撑信号验证的"后续 15 分钟涨跌幅"
 *        成本：25h/页，7 天需 7 页/合约
 *
 * ★断点续传：每个 (类型,粒度,合约) 记录游标 ts 到 backfill_state.json，
 *   重启后从游标继续，不重复拉取。
 * ========================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../../');
const DATA_DIR = path.join(ROOT, 'data/okx');
const STATE_FILE = path.join(DATA_DIR, 'backfill_state.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const KLINE_API = 'https://www.okx.com/api/v5/market/history-candles';

/* 单次拉取上限 */
const KLINE_PAGE = 300;        // history-candles limit 最大 300
const KLINE_GAP = 70;          // ms（实测 60ms 间隔 30 页全过）

/* 各粒度单根覆盖时长（键同时覆盖小写/大写两种写盘形式） */
const SPAN = {
  '3m': 3 * 60000, '5m': 5 * 60000, '15m': 15 * 60000,
  '1h': 3600000, '2h': 2 * 3600000, '4h': 4 * 3600000, '1H': 3600000,
  '1d': 86400000, '1D': 86400000
};
const PERIOD_OKX = { '3m': '3m', '5m': '5m', '15m': '15m', '1h': '1H', '2h': '2H', '4h': '4H', '1H': '1H', '1d': '1D', '1D': '1D' };

/* ---------------- 状态（断点续传） ---------------- */
let STATE = null;
function state() {
  if (STATE) return STATE;
  try {
    if (fs.existsSync(STATE_FILE)) {
      STATE = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } else STATE = {};
  } catch (e) { STATE = {}; }
  if (!STATE.cursor) STATE.cursor = {};
  if (!STATE.log) STATE.log = [];
  return STATE;
}
function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state()));
  } catch (e) { }
}
function cursorKey(kind, grain, id) { return kind + ':' + grain + ':' + id; }

/* ---------------- HTTP ---------------- */
async function jget(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 25000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const j = await r.json();
    return { code: j.code, msg: j.msg, data: Array.isArray(j.data) ? j.data : [] };
  } catch (e) {
    return { code: '-1', msg: String((e && e.message) || e), data: [] };
  } finally { clearTimeout(t); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 并发池 ----------------
 * ★实测（2026-10-25）：candles 6 路并发 6/6 成功（99ms）
 *   → 每个 worker 内部仍按单请求节流（KLINE_GAP）保证不撞限流
 */
async function pool(items, worker, conc) {
  const n = Math.max(1, conc || 4);
  let idx = 0;
  const runners = [];
  for (let w = 0; w < n; w++) {
    runners.push((async () => {
      for (;;) {
        const i = idx++;
        if (i >= items.length) break;
        try { await worker(items[i], i); } catch (e) { }
      }
    })());
  }
  await Promise.all(runners);
}

/* ============================================================================
 * 一、K线回补
 * ========================================================================== */
/**
 * 单合约单粒度回补到 days 天前
 * @param {string} instId
 * @param {string} bar    '5m' | '1H' | '1D'
 * @param {number} days   回补到多少天前
 */
async function klineDeep(instId, bar, days) {
  const KL = require('./kline');
  /* ★粒度归一化：本地库文件后缀用小写（_1h / _1d），OKX 接口 bar 用大写（1H / 1D）
   *   OKX_BAR 映射表本身就是小写键 → 直接用它反查接口值 */
  const grain = KL.OKX_BAR[bar] ? bar : '5m';
  const target = Date.now() - (days || 90) * 86400000;
  const span = SPAN[grain] || SPAN['5m'];
  const ck = cursorKey('kline', grain, instId);
  let after = state().cursor[ck] || 0;

  let added = 0, pages = 0, done = false, oldest = 0;
  const MAXP = grain === '1d' ? 6 : (grain === '1h' ? 40 : (grain === '15m' ? 40 : 260));   // 上限保护
  for (let p = 0; p < MAXP; p++) {
    let url = KLINE_API + '?instId=' + encodeURIComponent(instId) +
      '&bar=' + (KL.OKX_BAR[grain] || grain) + '&limit=' + KLINE_PAGE;
    if (after) url += '&after=' + after;
    let j = await jget(url, 25000);
    if (j.code === '50011' || j.code === '50013') { await sleep(1500); j = await jget(url, 25000); }
    if (j.code !== '0' || !j.data.length) { done = true; break; }
    const rows = j.data.map(row => ({
      ts: parseInt(row[0], 10), o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5]
    })).filter(r => isFinite(r.ts) && r.ts > 0).sort((a, b) => a.ts - b.ts);
    if (!rows.length) { done = true; break; }
    const sv = await KL.saveRows(instId, grain, rows);
    added += sv.added;
    oldest = rows[0].ts;
    pages++;
    // 已覆盖到目标
    if (oldest <= target) { done = true; break; }
    const prev = after;
    after = oldest;
    // 没有更早的数据
    if (prev && oldest >= prev) { done = true; break; }
    await sleep(KLINE_GAP);
  }
  state().cursor[ck] = oldest || after;
  saveState();
  return { ok: true, inst: instId, grain, added, pages, done, oldest };
}

/* ============================================================================
 * 三、批量调度（后台任务用）
 * ========================================================================== */
const JOBS = new Map();     // jobKey → {running, done, total, ok, fail, log[]}

/**
 * 批量回补：按合约列表依次回补
 * @param {object} opt
 *   kind: 'kline'
 *   grain: '5m' | '1H' | '1D'
 *   days: 回补天数
 *   list: [{instId, weight}]  —— 按 weight 降序（成交额优先）
 *   jobKey: 任务标识（用于查询进度）
 *   onLog: 进度回调
 */
async function runBatch(opt) {
  const kind = opt.kind || 'kline';
  const grain = opt.grain || '5m';
  const days = opt.days || 90;
  const jobKey = opt.jobKey || (kind + ':' + grain);
  if (JOBS.has(jobKey) && JOBS.get(jobKey).running) return { ok: false, err: 'busy' };

  const job = { running: true, kind, grain, days, done: 0, total: (opt.list || []).length, ok: 0, fail: 0, added: 0, startedAt: Date.now(), log: [] };
  JOBS.set(jobKey, job);

  const list = (opt.list || []).slice();
  const conc = Math.max(1, Math.min(8, opt.concurrency || 4));

  await pool(list, async (it) => {
    if (!job.running) return;
    let r = null;
    try {
      r = await klineDeep(it.instId, grain, days);
    } catch (e) {
      r = { ok: false, err: String((e && e.message) || e) };
    }
    job.done++;
    if (r && r.ok) { job.ok++; job.added += r.added || 0; }
    else job.fail++;
    const line = it.instId + ' ' + (r && r.ok ? '+' + (r.added || 0) + (r.done ? ' done' : ' more') : ' FAIL');
    job.log.push(line);
    if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
    if (opt.onLog) { try { opt.onLog(line, job); } catch (e) { } }
  }, conc);

  job.running = false;
  job.finishedAt = Date.now();
  job.ms = job.finishedAt - job.startedAt;
  saveState();
  return { ok: true, job: summarize(job) };
}

function summarize(job) {
  return {
    running: job.running, kind: job.kind, grain: job.grain, days: job.days,
    done: job.done, total: job.total, ok: job.ok, fail: job.fail, added: job.added,
    startedAt: job.startedAt, finishedAt: job.finishedAt || 0, ms: job.ms || 0,
    log: (job.log || []).slice(-40)
  };
}

function jobStat(jobKey) {
  const j = JOBS.get(jobKey);
  return j ? summarize(j) : null;
}

function allJobs() {
  const out = [];
  for (const [k, j] of JOBS) out.push({ key: k, ...summarize(j) });
  return out;
}

function stopJob(jobKey) {
  const j = JOBS.get(jobKey);
  if (j) j.running = false;
  return !!j;
}

module.exports = {
  klineDeep, runBatch, jobStat, allJobs, stopJob,
  state, saveState, cursorKey, SPAN
};
