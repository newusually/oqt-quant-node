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
  if (!STATE.floor) STATE.floor = {};   // ★2026-10-27 数据尽头标记（上线不足90天的新币）
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
const GATE = require('./okxgate');   // ★2026-10-27 全局限流协调（与 kline.js 保鲜共享一个桶）
async function jget(url, ms) {
  await GATE.wait();                 // ★全局统一节流 + 等待限流暂停解除
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 25000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const j = await r.json();
    /* ★限流 → 通知全局一起退避（原版只有自己退避, 其它模块继续打 → 挤兑死循环） */
    if (j && (j.code === '50011' || j.code === '50013')) GATE.punish(6000);
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
        try { await worker(items[i], i); }
        catch (e) { /* ★不再静默：记录失败项，便于排查数据缺口 */ console.error('[backfill] worker失败:', (e && e.message) || e); STATE.log.push({ ts: Date.now(), evt: 'worker_error', msg: String((e && e.message) || e).slice(0, 200) }); }
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
  const target = Date.now() - (days || 365) * 86400000;
  const span = SPAN[grain] || SPAN['5m'];
  const ck = cursorKey('kline', grain, instId);
  let after = state().cursor[ck] || 0;
  /* ★2026-10-27 已完成短路: cursor 已到达目标 或 已打"数据尽头"标记 → 0 请求直接返回。
   *   重跑轮靠它秒过已完成合约(287 个只扫真正缺数据的) */
  if ((after && after <= target) || state().floor[ck]) {
    return { ok: true, inst: instId, grain, added: 0, pages: 0, done: true, oldest: after, hadError: false, skipped: true };
  }

  let added = 0, pages = 0, done = false, oldest = 0, hadError = false;
  /* ★2026-10-27 上限保护按 days 动态算: 覆盖目标天数所需页数 + 10 页余量。
   *   (旧版 15m/1h 硬编码 40 页=125/500 天, days 改 365 后会被截断;
   *    OKX 实际只有 ~100 天, 正常永远触不到上限, 纯兜底) */
  const MAXP = Math.min(2000, Math.ceil((days || 365) * 86400000 / span / KLINE_PAGE) + 10);
  for (let p = 0; p < MAXP; p++) {
    let url = KLINE_API + '?instId=' + encodeURIComponent(instId) +
      '&bar=' + (KL.OKX_BAR[grain] || grain) + '&limit=' + KLINE_PAGE;
    if (after) url += '&after=' + after;
    /* ★数据缺口修复（2026-10-27）：
     *   旧版：限流(50011/50013)只重试1次，仍失败或网络错误 → done=true 且 cursor 前进
     *         → 该页及更早的数据被永久跳过（这就是"数据有错漏"的根因）。
     *   新版：限流/网络错误 → 指数退避重试最多 5 次；仍失败 → hadError=true，
     *         cursor 不推进（停在成功位置），下次调度从断点继续补。 */
    let j = null;
    for (let attempt = 0; attempt <= 5; attempt++) {
      j = await jget(url, 25000);
      if (j.code === '0') break;
      const rateLimited = j.code === '50011' || j.code === '50013';
      if (!rateLimited && j.code !== '-1') break;   // 业务性错误（如参数错）重试无意义
      const backoff = 1500 * Math.pow(2, attempt);  // 1.5s → 3s → 6s → 12s → 24s → 48s
      console.error(`[backfill] ${instId} ${grain} 第${p + 1}页 ${j.code}(${j.msg})，${backoff}ms 后第${attempt + 1}次重试`);
      await sleep(backoff);
    }
    if (j.code === '50011' || j.code === '50013' || j.code === '-1') {
      hadError = true;   // 重试耗尽仍失败：不推进 cursor，保留断点
      console.error(`[backfill] ${instId} ${grain} 重试耗尽，本轮回补中止在 ts=${after}（cursor 不推进，下次续补）`);
      break;
    }
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
    /* ★2026-10-27: 分页节流已由 GATE 统一(150ms/req), 删除独立 KLINE_GAP sleep
     *   (原 70ms×2worker+保鲜 130ms = 36req/s ≫ 20req/2s 互挤全灭的根因之一) */
  }
  /* ★cursor 推进规则：只有无错误（hadError=false）才写 oldest；
   *   出错时保留原 cursor（断点），下次调度自动续补缺口。 */
  if (!hadError) {
    state().cursor[ck] = oldest || after;
    /* ★2026-10-27 数据尽头标记（floor）：
     *   done=true（自然到底: OKX 返回空/翻页原地踏步/覆盖到目标）但游标仍在
     *   90 天线之内 = 上线不足 90 天的新币, OKX 已无更早数据。
     *   注意 first-page-empty 场景: cursor 已是最早一根, 第一页就返回空,
     *   oldest 从未赋值(=0) —— 所以判定用 oldest||after 而非仅 oldest。
     *   不打标 → 每次重启都把这批新币从上线日重新翻一遍（纯浪费）,
     *   coverage/进度面板也永远显示"未完成" → 用户以为补全卡死"不知道要几天"。
     *   打标后: klineDeep 短路跳过 + coverage 计入完成 + 新K线由保鲜员持续追新。 */
    const finalTs = oldest || after;
    if (done && finalTs > target) state().floor[ck] = 1;
  }
  saveState();
  return { ok: !hadError, inst: instId, grain, added, pages, done, oldest, hadError };
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
 *   autoRetry: 默认 true —— 一轮结束后仍有失败 → 指数退避自动重跑（最多 5 轮）
 *
 * ★2026-10-27 修复"补充数据卡死没进度"：
 *   原版只跑一轮, 启动时限流挤兑 → 287 个全 FAIL → job「完成」后永不再跑,
 *   cursor 断点永远没人续传。现版: 失败 >0 → 2min→5min→12.5min→31min 后自动
 *   重跑（cursor 断点续传 + 已完成短路, 重跑只补真正缺的）。
 */
const RETRY_MAX_ROUNDS = 5;
async function runBatch(opt) {
  let last = null;
  for (let round = 1; round <= RETRY_MAX_ROUNDS; round++) {
    last = await runBatchOnce(opt, round);
    if (!last || !last.ok || !last.job) return last;
    if (last.job.fail <= 0 || opt.autoRetry === false) return last;
    if (round >= RETRY_MAX_ROUNDS) return last;
    const waitMs = Math.min(120000 * Math.pow(2.5, round - 1), 2400000);   // 2min 5min 12.5min 31min
    const job = JOBS.get(opt.jobKey || ((opt.kind || 'kline') + ':' + (opt.grain || '5m')));
    if (job) { job.nextRetryAt = Date.now() + waitMs; job.round = round + 1; }
    console.error('[backfill] ' + (opt.jobKey || last.job.grain) + ' 第' + round + '轮还有 ' + last.job.fail + ' 个失败, ' + Math.round(waitMs / 60000) + ' 分钟后自动第 ' + (round + 1) + ' 轮（断点续传）');
    await sleep(waitMs);
    /* 等待期间可能被 stopJob → 中止重跑链 */
    if (job && job.running === false && job.stopped) return last;
  }
  return last;
}

async function runBatchOnce(opt, round) {
  const kind = opt.kind || 'kline';
  const grain = opt.grain || '5m';
  const days = opt.days || 365;   // ★2026-10-27 尽力一年(OKX 尽头即停)
  const jobKey = opt.jobKey || (kind + ':' + grain);
  if (JOBS.has(jobKey) && JOBS.get(jobKey).running) return { ok: false, err: 'busy' };

  const job = { running: true, kind, grain, days, round: round || 1, nextRetryAt: 0, done: 0, total: (opt.list || []).length, ok: 0, fail: 0, added: 0, startedAt: Date.now(), log: [] };
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
    round: job.round || 1, nextRetryAt: job.nextRetryAt || 0,
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
  if (j) { j.running = false; j.stopped = true; j.nextRetryAt = 0; }   // ★stopped: 中止自动重跑链
  return !!j;
}

/* 覆盖度统计（boards.js backfill 端点用）: 每粒度 已完成/总数 */
async function coverage(grain) {
  const T = require("./universe");
  let total = 0, done = 0, missing = [];
  try {
    const u = await T.universe();
    const list = (u.ok && u.list) ? u.list.map(x => x.instId) : [];
    total = list.length;
    /* ★2026-10-27 目标 365 天(尽力一年): OKX 实际只保留 ~100 天,
     *   老币拉到数据尽头时 cursor(~100天前) > target(365天前) 永不达标,
     *   全部依赖 floor 标记计入完成 —— 所以第一轮全量回补跑完前会短暂显示未完成 */
    const target = Date.now() - 365 * 86400000;
    for (const inst of list) {
      const ck = cursorKey("kline", grain, inst);
      const c = state().cursor[ck] || 0;
      /* floor(数据尽头) 计入完成 —— 新币/OKX尽头合约 不越界不重拉 */
      if ((c && c <= target) || state().floor[ck]) done++; else missing.push(inst);
    }
  } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  return { ok: true, grain, total, done, missing: missing.slice(0, 30), missingCount: missing.length };
}

module.exports = {
  klineDeep, runBatch, jobStat, allJobs, stopJob,
  state, saveState, cursorKey, SPAN, coverage
};
