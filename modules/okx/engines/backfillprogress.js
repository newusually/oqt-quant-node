/* ============================================================================
 * modules/okx/engines/backfillprogress.js —— ★历史回补进度（2026-10-26）
 * ----------------------------------------------------------------------------
 * 用户需求："写一个回补数据的进度的面板在最下面 ... 什么合约名称 进度条到百分之
 *            多少了 还差多少 大概预计多久完成 ... 每页显示10行 ... 分类筛选
 *            已经完成的 完成不到一半的 还有大部分完成的 ... 选项卡筛选"
 *
 * 数据来源：
 *   1) data/okx/backfill_progress.json —— tools/backfill_deep.js 实时写入
 *      （正在下载哪个合约、到哪天了、每个粒度的已完成数/新增根数/耗时）
 *   2) data/okx/kline/<inst>_<grain>.sqlite —— 实际落库行数与最早时间
 *   3) universe —— 合约全量清单（名称/板块）
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const U = require('./universe');

const ROOT = path.resolve(__dirname, '../../../');
const KS = require('./kstore');   // ★2026-10-27 月分片存储唯一入口
const PROGRESS_FILE = path.join(ROOT, 'data/okx/backfill_progress.json');
const STATE_FILE = path.join(ROOT, 'data/okx/backfill_deep_state.json');
const STATE_MAIN = path.join(ROOT, 'data/okx/backfill_state.json');   // ★backfill.js 引擎主状态（cursor/floor）

const SPAN = { '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000,
  '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000, '12h': 43200000,
  '1d': 86400000 };
const GRAINS = ['3m', '5m', '15m', '1h', '2h', '4h'];   // ★2026-10-26 补齐短周期选项卡
const DAY = 86400000;

/* ---------------- 缓存（全量扫 287 个库较重） ---------------- */
const CACHE = new Map();
const CACHE_TTL = 8000;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

/* 单个合约单个粒度的落库情况（★月分片: 跨片聚合; 完全未迁移才计 legacy 整库,
 *   迁移中只算月片 —— 月片是 legacy 的子集, 双算会令进度虚高） */
function statOne(instId, grain) {
  let have = 0, oldest = 0, newest = 0;
  const months = KS.monthsOf(grain, instId);
  for (const ym of months) {
    const db = KS.roOpen(KS.monthFile(grain, instId, ym));
    if (!db) continue;
    try {
      const r = db.prepare('SELECT COUNT(*) c, MIN(ts) mn, MAX(ts) mx FROM kline').get();
      if (r && r.c) { have += r.c; if (!oldest || r.mn < oldest) oldest = r.mn; if (r.mx > newest) newest = r.mx; }
    } catch (e) { }
  }
  if (!months.length && KS.hasLegacy(grain, instId)) {
    const db = KS.roOpen(KS.legacyFile(grain, instId));
    if (db) {
      try {
        const r = db.prepare('SELECT COUNT(*) c, MIN(ts) mn, MAX(ts) mx FROM kline').get();
        if (r) { have = r.c || 0; oldest = r.mn || 0; newest = r.mx || 0; }
      } catch (e) { }
    }
  }
  return { have, oldest, newest };
}

/* ---------------- 全量计算 ---------------- */
async function build(grain) {
  const u = await U.universe();
  if (!u.ok || !u.list) return { ok: false, err: 'universe 未就绪', rows: [] };
  const prog = readJson(PROGRESS_FILE) || {};
  const state = readJson(STATE_FILE) || {};
  const doneMap = state.done || {};
  /* ★2026-10-27: floor(数据尽头) 从 backfill.js 引擎主状态读取 ——
   *   上线不足 90 天的新币 OKX 无更早数据, 必须按"数据尽头"计 100%,
   *   否则进度条永远差一截、ETA 天文数字（用户: "不知道要几天"） */
  const floorMap = (readJson(STATE_MAIN) || {}).floor || {};
  const cur = prog.cur || {};
  const g = (prog.grain && prog.grain[grain]) || {};
  /* ★2026-10-27: 目标 90 天 → 365 天(尽力一年, 用户: "尽力查询最近一年数据")。
   *   OKX 实际只保留 ~100 天历史: 老币拉到数据尽头由 floor 标记计 100%,
   *   新币同理 —— ended 合约显示 100%, coverDays 字段反映实际可得天数。 */
  const days = g.days || 365;
  const span = SPAN[grain] || 3600000;
  const targetRows = Math.floor(days * DAY / span);
  const now = Date.now();

  const rows = u.list.map(x => {
    const st = statOne(x.instId, grain);
    const key = grain + ':' + x.instId;
    const d = doneMap[key];
    const running = !!cur[key];
    const c = running ? (cur[key] || {}) : {};
    /* ★有效最早时间：正在下载时以实时游标为准（已下到的最早一根），
     *   否则用落库 MIN(ts) —— 下载中数据还在内存缓冲未落盘, 只看库会严重低估 */
    let effOldest = st.oldest;
    if (c.oldest && (!effOldest || c.oldest < effOldest)) effOldest = c.oldest;
    const coverDays = effOldest ? (now - effOldest) / DAY : 0;
    const have = Math.max(st.have, c.rows || 0);
    /* 目标：90 天；已取到数据尽头(d.end 或引擎 floor 标记) → 该合约历史已完整, 进度 100% */
    const ended = !!(d && d.end) || !!floorMap['kline:' + key];
    let pct = ended ? 100 : Math.min(100, Math.max(0, coverDays / days * 100));
    if (!ended && effOldest && effOldest <= now - days * DAY) pct = 100;
    const status = pct >= 99.5 ? 'done' : (pct >= 50 ? 'most' : (have > 0 ? 'half' : 'none'));
    return {
      inst: x.instId, sym: x.sym || x.instId, sector: x.sector || '',
      have: have, saved: st.have, target: ended ? Math.max(have, 1) : targetRows,
      pct: +pct.toFixed(1), remain: 0, ended: ended,
      coverDays: +coverDays.toFixed(1), oldest: effOldest, newest: st.newest,
      status: status, running: running,
      livePages: running ? (c.pages || 0) : 0
    };
  });

  /* ★还差多少根：按该合约已覆盖天数外推总量（上市不足一年的合约不会虚高到一年目标）；
   *   完全没数据的合约用「已完成合约的平均总量」估 —— 使 ETA 接近真实耗时 */
  const doneList = rows.filter(r => r.status === 'done' && r.have > 0);
  const avgDone = doneList.length
    ? Math.round(doneList.reduce((a, r) => a + r.have, 0) / doneList.length)
    : targetRows;
  rows.forEach(function (r) {
    if (r.ended || r.status === 'done') { r.remain = 0; return; }
    let expect;
    if (r.coverDays > 1) expect = Math.round(r.have / Math.min(1, r.coverDays / days));
    else expect = avgDone;
    if (!isFinite(expect) || expect <= 0) expect = avgDone;
    r.remain = Math.max(0, expect - r.have);
  });

  /* 汇总 */
  const sum = { total: rows.length, done: 0, most: 0, half: 0, none: 0, running: 0, pctSum: 0 };
  for (const r of rows) {
    sum[r.status] = (sum[r.status] || 0) + 1;
    if (r.running) sum.running++;
    sum.pctSum += r.pct;
  }
  const remainRows = rows.reduce((a, r) => a + (r.status === 'done' ? 0 : r.remain), 0);
  const haveRows = rows.reduce((a, r) => a + r.have, 0);
  const avgPct = rows.length ? sum.pctSum / rows.length : 0;
  /* 速度/ETA：用脚本上报的粒度级吞吐（并发总吞吐，根/秒） */
  const speed = (g.added && g.ms) ? (g.added / (g.ms / 1000)) : 0;
  const etaSec = speed > 0 ? Math.round(remainRows / speed) : 0;
  return {
    ok: true, grain: grain, grains: GRAINS, days: days, at: now,
    summary: {
      total: sum.total, done: sum.done, most: sum.most, half: sum.half, none: sum.none,
      running: sum.running, avgPct: +avgPct.toFixed(1), remainRows: remainRows, haveRows: haveRows,
      added: g.added || 0, elapsedSec: Math.round((g.ms || 0) / 1000),
      speed: +speed.toFixed(1), etaSec: etaSec,
      taskRunning: !!g.running, doneContracts: g.done || 0
    },
    rows: rows
  };
}

/* ---------------- 对外：带缓存 + 筛选 + 分页 ---------------- */
async function progress(opt) {
  opt = opt || {};
  const grain = GRAINS.indexOf(opt.grain) >= 0 ? opt.grain : '1h';
  const ck = grain;
  const hit = CACHE.get(ck);
  let data;
  if (hit && Date.now() - hit.at < CACHE_TTL) data = hit.data;
  else { data = await build(grain); CACHE.set(ck, { at: Date.now(), data: data }); }
  if (!data.ok) return data;

  let rows = data.rows.slice();
  const f = opt.filter || 'all';
  if (f === 'done') rows = rows.filter(r => r.status === 'done');
  else if (f === 'most') rows = rows.filter(r => r.status === 'most');
  else if (f === 'half') rows = rows.filter(r => r.status === 'half');
  else if (f === 'none') rows = rows.filter(r => r.status === 'none');
  else if (f === 'undone') rows = rows.filter(r => r.status !== 'done');
  const q = (opt.q || '').trim().toUpperCase();
  if (q) rows = rows.filter(r => r.inst.indexOf(q) >= 0 || String(r.sym).indexOf(q) >= 0);
  const sort = opt.sort || 'progress';
  if (sort === 'name') rows.sort((a, b) => a.inst.localeCompare(b.inst));
  else if (sort === 'remain') rows.sort((a, b) => b.remain - a.remain);
  else rows.sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;      // 进行中优先
    if (a.pct !== b.pct) return a.pct - b.pct;                    // 进度低的优先
    return a.inst.localeCompare(b.inst);
  });

  const size = Math.max(1, Math.min(100, parseInt(opt.size, 10) || 10));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.max(1, Math.min(pages, parseInt(opt.page, 10) || 1));
  const slice = rows.slice((page - 1) * size, (page - 1) * size + size);
  return {
    ok: true, grain: data.grain, grains: data.grains, days: data.days, at: data.at,
    summary: data.summary, rows: slice,
    page: page, size: size, total: total, pages: pages, filter: f, q: opt.q || '', sort: sort
  };
}

module.exports = { progress: progress, GRAINS: GRAINS };