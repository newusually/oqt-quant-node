// M4 modules/okx/engines/kline.js · OKX 真实行情引擎（一比一承接 tools/okx_pull.py + cpp/okx 指标）
//   功能: 从 OKX 公共行情接口拉真实 OHLC K线(无需凭证) → 本地 node:sqlite 存储
//        → 本地算 EMA12/26/DIF/DEA/MACD → 算缠论(摆动顶/底 + 10根高低 + 斐波那契 + 买卖点)
//        → 合约列表(instruments SWAP, 缓存)。
//   涨红跌绿(中国惯例); 无未来函数(摆动点需右侧 PW 根确认)。
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../../');
const INST_CACHE = path.join(ROOT, 'data/okx/instruments/instruments.json');

// OKX bar 口径: 库/接口统一用小写键, 接口 bar 用 OKX 要求的大写(H/D/W/M)
const OKX_BAR = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H',
  '1d': '1D', '2d': '2D', '3d': '3D', '1w': '1W', '1M': '1M'
};

/* ★★2026-10-27 月分片改造（用户: "分时的3分钟5分钟等都要按分时保存数据,
 *   要分类分月不要全在一个文件避免锁住"）：
 *   旧布局 data/okx/kline/{inst}_{bar}.sqlite 单文件全历史 —— 保鲜每 2.5 分钟
 *   写 287 个全历史库, 5m 单库 15MB/全市场 422MB, 历史月数据白白暴露在写锁下。
 *   新布局 data/okx/kline/{bar}/{inst}/{ym}.sqlite (ym=UTC年月)：
 *     - 按周期分子目录(分类), 按月分文件(分月) —— 历史月片只读, 只有当月片接收写入;
 *     - 路径/只读LRU池收敛到 engines/kstore.js（此前 5 个文件各自实现 storePath）。
 *   迁移: migrate-kline-monthly.js 把旧库按 ym 拆片(零停机, REPLACE 幂等);
 *   未迁移/迁移中走 legacy 只读 fallback, 迁移完旧库改名 .legacy 自动退出读取链。 */
const KS = require('./kstore');

/* 跨月片统计: COUNT/MIN/MAX 聚合(backfill 收尾/saveRows/前端展示用)。
 * legacy 只在"完全没有月片"时全量计入, 迁移中只补比月片最旧更早的部分(不双算)。 */
function statsRows(bar, instId) {
  let c = 0, mn = 0, mx = 0;
  const months = KS.monthsOf(bar, instId);
  for (const ym of months) {
    const db = KS.roOpen(KS.monthFile(bar, instId, ym));
    if (!db) continue;
    try {
      const s = db.prepare('SELECT COUNT(*) c, MIN(ts) mn, MAX(ts) mx FROM kline').get();
      if (s && s.c) { c += s.c; if (!mn || s.mn < mn) mn = s.mn; if (s.mx > mx) mx = s.mx; }
    } catch (e) { }
  }
  if (KS.hasLegacy(bar, instId)) {
    const db = KS.roOpen(KS.legacyFile(bar, instId));
    if (db) {
      try {
        let s;
        if (!months.length) s = db.prepare('SELECT COUNT(*) c, MIN(ts) mn, MAX(ts) mx FROM kline').get();
        else if (mn) s = db.prepare('SELECT COUNT(*) c, MIN(ts) mn FROM kline WHERE ts < ?').get(mn);
        if (s && s.c) { c += s.c; if (!mn || s.mn < mn) mn = s.mn; }
      } catch (e) { }
    }
  }
  return { c, mn, mx };
}

const CANDLES_API = 'https://www.okx.com/api/v5/market/history-candles';
const INST_API = 'https://www.okx.com/api/v5/public/instruments?instType=SWAP';
const TF = require('./universe');   // ★合约生态分类映射（公链/扩容/DeFi/Meme/AI/基础设施/链游/实物资产/其他）
const GATE = require('./okxgate');  // ★2026-10-27 全局限流协调（保鲜+回填共享一个桶, 彻底消除互挤）

// ---------------------------------------------------------------------------
// 拉取: OKX history-candles 降序返回, after 翻更早
// ★2026-10-27 限流修复: 原版遇 50011 直接 break(=失败), 保鲜一轮 186 失败;
//   且与回填并发时 36req/s ≫ 20req/2s 互挤全灭。
//   现版: 请求前走全局 gate 节流; 限流 → 全局暂停 + 本页重试(最多4次);
//   分页间隔由 gate 统一管理, 不再单独 sleep。
// ---------------------------------------------------------------------------
async function fetchCandles(instId, bar, pages, afterTs) {
  const out = new Map();
  let after = afterTs || null;
  for (let p = 0; p < (pages || 2); p++) {
    let url = CANDLES_API + '?instId=' + encodeURIComponent(instId) + '&bar=' + (OKX_BAR[bar] || bar) + '&limit=100';
    if (after) url += '&after=' + after;
    let data = null;
    for (let attempt = 0; attempt <= 3; attempt++) {
      let j = null;
      try {
        await GATE.wait();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        try {
          const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
          j = await res.json();
        } finally { clearTimeout(timer); }
      } catch (e) { j = null; }
      if (j && j.code === '0' && Array.isArray(j.data)) { data = j.data; break; }
      const rl = j && (j.code === '50011' || j.code === '50013');
      if (rl) GATE.punish(6000);          // 限流 → 全局一起退避
      if (!rl && attempt >= 1) break;     // 非限流错误最多重试 1 次
      if (attempt >= 3) break;
    }
    if (!data || !data.length) break;
    let oldest = null;
    for (const row of data) {
      const ts = parseInt(row[0], 10);
      if (!isFinite(ts)) continue;
      if (oldest === null || ts < oldest) oldest = ts;
      out.set(ts, { ts, o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5] });
    }
    after = oldest;
  }
  return [...out.values()].sort((a, b) => a.ts - b.ts);
}

function tsParts(ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { d: y + '-' + m + '-' + day, ym: y * 100 + (+m) };
}

// pull: 拉取并落库(INSERT OR REPLACE 幂等); 返回新增/总数
async function pull(instId, bar, pages) {
  const rows = await fetchCandles(instId, bar, pages || 2, null);
  return await saveRows(instId, bar, rows);
}

/* ---------------- ★全市场 K线保鲜（2026-10-25）
 *   背景：keepLatest 只保鲜「被浏览过」的 ≤12 个合约，其余 495 个库的
 *   最新 ts 可能比 taker 库早好几小时 → ts 无交集 → 相关性分析样本只剩 69 个。
 *   实测 NVDA：kline 到 10-24T11:20，taker 已到 23:50 → 交集 0。
 *   修法：每轮为全市场拉 1 页(100 根 ≈ 8.3 小时) 5m K线，
 *        串行 0.13s 间隔 → 507 请求约 66 秒，远小于 10 分钟周期。
 *   ★只补最新（history-candles 降序返回），不会回补历史，省流量。 */
const ALL_KEEP_GAP = 150000;     // 同一合约同周期 2.5 分钟内不重复拉（轮次间隔 3 分钟）
const ALL_KEEP_AT = new Map();
let allKeepRunning = false;
let keepRound = 0;               // 轮次（奇偶交替正反序, 避免列表头部合约(如BTC)每轮都最先拉=永远最旧）

async function keepAllMarket(instIds, bar) {
  if (allKeepRunning) return { ok: false, err: 'busy' };
  allKeepRunning = true;
  const now = Date.now();
  let n = 0, fail = 0;
  const barN = bar || '5m';
  const ids = (instIds || []).slice();
  if (++keepRound % 2 === 0) ids.reverse();      // ★奇偶轮换: BTC 等头部合约不再永远滞后一轮
  try {
    for (const id of ids) {
      /* ★2026-10-26 key 按「合约|周期」隔离: 原来只按合约记时间戳,
       *   5m 保鲜刚拉过 → 15m 保鲜同 id 被跳过, 15m 库永远不更新(统计/信号全陈旧) */
      const k = id + '|' + barN;
      const at = ALL_KEEP_AT.get(k) || 0;
      if (now - at < ALL_KEEP_GAP) continue;
      ALL_KEEP_AT.set(k, now);
      try {
        await pull(id, barN, 1);
        n++;
      } catch (e) { fail++; }
      /* ★2026-10-27: 节流已由 GATE 全局统一(150ms/req), 这里不再重复 sleep,
       *   原双重节流(130ms + gate)会把保鲜一轮拖到 6 分钟且仍可能挤兑 */
      await new Promise(r => setTimeout(r, 20));   // 仅让出事件循环
    }
  } finally { allKeepRunning = false; }
  return { ok: true, got: n, fail, at: Date.now() };
}

/* ---------------- ★K线保鲜员（2026-10-24 用户: "OKX K线图 居然不动 毫秒级ws"） ----------------
 * 主图实时由【前端 SSE 拼形成中K线】负责; 这里负责把【已收线】的K线持续落库,
 * 让定时对账重载(60s)能拿到真实的新K线, 回测/历史也保持完整。
 * 只保鲜「最近被浏览过」的合约(页面调 kline() 即登记), 最多 12 个, 串行拉取限流。 */
const WATCH = new Map();          // 'inst|bar' → 最后浏览时间
const KEEP_AT = new Map();        // 'inst|bar' → 最后拉取时间
const WATCH_MAX = 12;
const WATCH_TTL = 10 * 60000;     // 10 分钟没人看就停止保鲜
const KEEP_GAP = 25000;           // 同一合约 25s 内不重复拉

function touchWatch(instId, bar) {
  const k = instId + '|' + bar;
  WATCH.set(k, Date.now());
  if (WATCH.size > WATCH_MAX) {
    let oldK = null, oldT = Infinity;
    for (const [kk, vv] of WATCH) if (vv < oldT) { oldT = vv; oldK = kk; }
    if (oldK) WATCH.delete(oldK);
  }
}

async function keepLatest() {
  const now = Date.now();
  const jobs = [];
  for (const [k, at] of WATCH) {
    if (now - at > WATCH_TTL) { WATCH.delete(k); KEEP_AT.delete(k); continue; }
    if (now - (KEEP_AT.get(k) || 0) < KEEP_GAP) continue;
    KEEP_AT.set(k, now);
    const i = k.lastIndexOf('|');
    jobs.push([k.slice(0, i), k.slice(i + 1)]);
  }
  let n = 0;
  for (const [inst, bar] of jobs) {
    try { await pull(inst, bar, 1); n++; } catch (e) { /* 单合约失败不影响其他 */ }
  }
  return n;
}

// pullBefore: 拉取【指定时间之前】的历史K线(悬浮迷你窗定位老成交用)
//   OKX history-candles 的 after 参数 = "返回比 after 时间戳更早的记录"
async function pullBefore(instId, bar, beforeTs, pages) {
  const rows = await fetchCandles(instId, bar, pages || 6, beforeTs);
  return await saveRows(instId, bar, rows);
}

// backfill: 往回【分页回补】历史K线, 直到覆盖 untilTs 或没有更多数据
//   每页用 after=当前最老一根 继续往前翻(OKX history-candles 单页上限100根)
//   返回 {added, total, oldest, newest, rounds, done}
// backfill: 分页往前翻历史K线
//   opt 优先用:
//     {days: 3}          → 只回填最近 N 天（首屏轻量）
//     {limit: 1000}      → 一直往前翻, 直到本地总数 >= limit 根（或翻完）
//     {untilTs}          → 翻到该时间戳为止
//   旧接口 years 保留兼容（内部换算成 days）
//
// ★2026-10-27 提速改造（用户: "okx 补全数据太慢了 帮我加速 这么慢不知道要几天"）：
//   旧版三大慢点 ——
//     a) 单页 limit=100 根（history-candles 实测上限 300, 白白多 3 倍请求）
//     b) 首页从【最新】开始翻 —— 本地已有的数据全部重复拉一遍才走到缺口
//     c) 独立 sleep 130ms + GATE 150ms 双重限流 ≈ 280ms/页, 实际 ~3.5req/s
//   新版 ——
//     a) 单页 300 根
//     b) 翻页起点 = 本地最老一根(statsRows.mn), 直接从缺口处接力, 零重复
//     c) 节流全交 GATE(105ms ≈ 9.5req/s), 已覆盖目标的合约 0 请求秒回
//   效果: 点一次"补90天" = 5m 87页 ≈ 12s / 3m 144页 ≈ 20s（旧版要点 8+ 次且永远差一点）
//
// ★2026-10-27 二期（用户: "尽力查询最近一年数据 如果真的是新币就查询最远的数据返回就行 不要超过边界"）：
//   - days 可传 365(一年): 翻到 OKX 数据尽头自然停止(返回空/不足300根), 绝不越界
//   - 接入 floor"数据尽头"标记(与 backfill.js 引擎共享 STATE):
//       拉到尽头仍未覆盖目标天数 → floor[ck]=1, 之后每次点击 0 请求秒回
//   - maxRounds 上限 300→800 页(800×300=24万根≈833天 > 365天, 兜底)
async function backfill(instId, bar, opt) {
  opt = (opt && typeof opt === 'object') ? opt : { years: opt };
  const days = (opt.days !== null && opt.days !== undefined) ? +opt.days : (opt.years ? Math.round(+opt.years * 365) : null);
  const limit = (opt.limit !== null && opt.limit !== undefined) ? parseInt(opt.limit, 10) : 0;
  const untilTs = opt.untilTs || 0;
  const maxRounds = Math.max(1, Math.min(parseInt(opt.rounds || 40, 10) || 40, 800));
  const target = (days !== null && days !== undefined) ? Date.now() - days * 86400000 : 0;
  /* ★floor 共享状态(backfill.js 的 STATE_FILE, 顶层 require 安全:
   *   backfill.js 顶层不依赖 kline, 它在 klineDeep 函数内才反向 require 本模块) */
  const BF = require('./backfill');
  const ck = 'kline:' + bar + ':' + instId;

  /* 起点接力: 从本地最老一根继续往前翻(0 根则从最新翻起) */
  let after = statsRows(bar, instId).mn || null;
  /* 前置短路: 已覆盖目标天数 或 已知数据尽头 → 0 请求秒回 */
  if ((after && target && after <= target) || BF.state().floor[ck]) {
    const stats = statsRows(bar, instId);
    return { ok: true, inst: instId, bar, added: 0, rounds: 0, done: true, total: stats.c, oldest: stats.mn, newest: stats.mx };
  }

  let added = 0, done = false, oldest = 0;
  for (let r = 0; r < maxRounds; r++) {
    // ★每次翻页前先看本地已有多少根 —— limit 模式到量就停（移动K线回补1000根）
    if (limit > 0) {
      const cur = localCount(instId, bar);
      if (cur >= limit) { done = true; break; }
    }
    const rows = await historyPage(instId, bar, after);
    if (!rows.length) { done = true; break; }              // OKX 无更早数据 = 数据尽头
    const sv = await saveRows(instId, bar, rows);
    added += sv.added;
    const o = rows[0].ts;
    if (!oldest) oldest = o;
    if (untilTs && o <= untilTs) { done = true; break; }   // 已覆盖到目标时间
    if (target && o <= target) { done = true; break; }     // 已回填够 N 天
    if (after && o >= after) { done = true; break; }       // 没有更早的数据
    after = o;
    if (rows.length < 300) { done = true; break; }         // 最后一页(单页上限300)
  }
  /* ★数据尽头打标: 自然到底(非 limit/untilTs 截断)且仍未覆盖目标天数 → floor,
   *   之后本函数与后台引擎共用短路, 不越界不重拉。 */
  if (done && limit <= 0 && !untilTs) {
    const finalTs = statsRows(bar, instId).mn;
    if (finalTs > 0 && target && finalTs > target) BF.state().floor[ck] = 1;
  }
  /* ★月分片: 统计不再开整库, 直接跨片聚合 */
  const stats = statsRows(bar, instId);
  return {
    ok: true, inst: instId, bar, added, rounds: maxRounds, done,
    total: stats.c, oldest: stats.mn, newest: stats.mx
  };
}

/* ★2026-10-27 history-candles 单页拉取（300 根/页, GATE 统一节流 + 限流重试）
 *   供 backfill() 深翻历史用; fetchCandles(limit=100) 保留给保鲜/pull 近端场景。 */
async function historyPage(instId, bar, after) {
  let url = CANDLES_API + '?instId=' + encodeURIComponent(instId) +
    '&bar=' + (OKX_BAR[bar] || bar) + '&limit=300';
  if (after) url += '&after=' + after;
  for (let attempt = 0; attempt <= 3; attempt++) {
    let j = null;
    try {
      await GATE.wait();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        j = await res.json();
      } finally { clearTimeout(timer); }
    } catch (e) { j = null; }
    if (j && j.code === '0' && Array.isArray(j.data)) {
      return j.data.map(row => ({ ts: parseInt(row[0], 10), o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5] }))
        .filter(r => isFinite(r.ts) && r.ts > 0).sort((a, b) => a.ts - b.ts);
    }
    const rl = j && (j.code === '50011' || j.code === '50013');
    if (rl) GATE.punish(6000);          // 限流 → 全局一起退避
    if (!rl && attempt >= 1) break;     // 非限流错误最多重试 1 次
  }
  return [];
}

// 落库 + 统计（★2026-10-27 月分片版）
async function saveRows(instId, bar, rows) {
  if (!rows.length) return { ok: true, inst: instId, bar, added: 0, total: 0, empty: true };
  /* ★按 ym 分组, 各组只写自己的 {bar}/{inst}/{ym}.sqlite 月片
   *   —— 历史月片完全不触碰, 写锁窗口 = 当月片一次事务。
   *   事务规范(★node:sqlite 无 .transaction(), 必须手动 BEGIN/COMMIT/ROLLBACK,
   *   此前误用 better-sqlite3 API 抛 "is not a function" 的教训见 git log)。 */
  const groups = new Map();   // ym → rows[]
  for (const r of rows) {
    const pp = tsParts(r.ts);
    if (!groups.has(pp.ym)) groups.set(pp.ym, []);
    groups.get(pp.ym).push({ ts: r.ts, d: pp.d, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
  }
  let added = 0, lastTs = 0;
  for (const [ym, g] of groups) {
    const db = KS.openMonth(bar, instId, ym);
    const ins = db.prepare('INSERT OR REPLACE INTO kline (ts,d,ym,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)');
    const totalBefore = db.prepare('SELECT COUNT(*) c FROM kline').get().c;
    db.exec('BEGIN');
    try {
      for (const r of g) ins.run(r.ts, r.d, ym, r.o, r.h, r.l, r.c, r.v);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) { }
      db.close();
      throw e;
    }
    const totalAfter = db.prepare('SELECT COUNT(*) c FROM kline').get().c;
    added += totalAfter - totalBefore;
    db.close();
    for (const r of g) if (r.ts > lastTs) lastTs = r.ts;
  }
  const total = statsRows(bar, instId).c;   // 跨片总根数(前端进度展示语义不变)
  return { ok: true, inst: instId, bar, added, total, last_ts: lastTs };
}

function loadLocal(instId, bar, limit, beforeTs) {
  /* ★月分片读取: 从最新片往旧逐片读, 凑够 limit 即停;
   *   beforeTs 从该 ts 所在月开始; legacy 未迁移库自动并入读取链(按 ts 去重)。 */
  const files = KS.readChain(bar, instId, beforeTs || 0, limit || 0);
  if (!files.length) return [];
  let rows = [];
  try {
    for (const f of files) {
      const db = KS.roOpen(f);              // 常驻只读句柄(LRU), 避免 3000+ 库反复 open/close
      if (!db) continue;
      let part;
      if (beforeTs && files.length === 1) {
        // 单文件(未迁移 legacy 或单月片): 走原索引查询
        part = (limit && limit > 0)
          ? db.prepare('SELECT ts,o,h,l,c,v FROM kline WHERE ts <= ? ORDER BY ts DESC LIMIT ?').all(beforeTs, limit)
          : db.prepare('SELECT ts,o,h,l,c,v FROM kline WHERE ts <= ? ORDER BY ts ASC').all(beforeTs);
      } else if (limit && limit > 0) {
        part = db.prepare('SELECT ts,o,h,l,c,v FROM kline ORDER BY ts DESC LIMIT ?').all(limit);
      } else if (beforeTs) {
        part = db.prepare('SELECT ts,o,h,l,c,v FROM kline WHERE ts <= ? ORDER BY ts ASC').all(beforeTs);
      } else {
        part = db.prepare('SELECT ts,o,h,l,c,v FROM kline ORDER BY ts ASC').all();
      }
      rows = rows.concat(part);
      if (limit && rows.length >= limit) break;
    }
  } catch (e) { return []; }
  if (rows.length > 1) {
    rows.sort((a, b) => a.ts - b.ts);
    if (files.length > 1) {                  // 跨片(legacy+月片并存)去重
      const seen = new Set();
      rows = rows.filter(r => (seen.has(r.ts) ? false : (seen.add(r.ts), true)));
    }
  }
  let arr = rows.map(r => ({ t: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
  if (limit && arr.length > limit) arr = arr.slice(arr.length - limit);
  return arr;
}

function localCount(instId, bar) {
  return statsRows(bar, instId).c;
}

// ---------------------------------------------------------------------------
// 指标: EMA12/26 → DIF/DEA/MACD(本地算, 不依赖过期 dump)
// ---------------------------------------------------------------------------
function ema(arr, n) { const k = 2 / (n + 1); let p = null; return arr.map(x => (p = (p === null || p === undefined) ? x : x * k + p * (1 - k))); }
function calcInd(C) {
  const e12 = ema(C, 12), e26 = ema(C, 26);
  const dif = e12.map((v, i) => v - e26[i]);
  const k9 = 2 / 10; let dea = null;
  const deaF = dif.map(x => (dea = (dea === null || dea === undefined) ? x : x * k9 + dea * (1 - k9)));
  const macd = dif.map((v, i) => (v - deaF[i]) * 2);
  return { e12, e26, dif, dea: deaF, macd };
}

// ---------------------------------------------------------------------------
// 缠论: 摆动顶/底(分型窗口确认, 无未来函数) + 最近10根高低 + 斐波那契 + 买卖点
//   摆点算法与原 astock app.js chanNew() 完全一致(同源口径)。
//   买卖点: 一买·大趋势底 = 下跌后的摆动底(dir>0); 一卖·大趋势顶 = 上涨后的摆动顶(dir<0)。
// ---------------------------------------------------------------------------
function computeSwing(all) {
  const n = all.length;
  const tops = [], bots = [];
  if (n < 8) return { tops, bots };
  const PW = 3, PMM = 0.0012, PCAP = 120;
  const H = all.map(b => b.h), L = all.map(b => b.l);
  const pv = [];
  for (let i = PW; i < n - PW; i++) {
    const h = H[i], l = L[i]; let isT = true, isB = true;
    for (let k = 1; k <= PW; k++) {
      if (H[i - k] >= h || H[i + k] >= h) isT = false;
      if (L[i - k] <= l || L[i + k] <= l) isB = false;
      if (!isT && !isB) break;
    }
    if (isT || isB) pv.push({ i, p: isT ? h : l, top: isT });
  }
  const f = [];
  for (const c of pv) {
    if (!f.length) { f.push(c); continue; }
    const last = f[f.length - 1];
    if (c.top === last.top) {
      if ((c.top && c.p >= last.p) || (!c.top && c.p <= last.p)) f[f.length - 1] = c;
      continue;
    }
    if (Math.abs(c.p - last.p) < last.p * PMM) continue;
    f.push(c);
  }
  const pf = f.length > PCAP ? f.slice(f.length - PCAP) : f;
  for (const q of pf) (q.top ? tops : bots).push(q);
  return { tops, bots, f };
}

function computeChan(bars) {
  const all = bars || [];
  const sw = computeSwing(all);
  const n = all.length;
  // 最近10根(尾部)最高/最低
  let hi10 = 0, lo10 = 0, t10 = 0, tN = 0;
  if (n >= 1) {
    const w = Math.min(10, n), i0 = n - w;
    let hi = -Infinity, lo = Infinity;
    for (let i = i0; i < n; i++) { if (all[i].h > hi) hi = all[i].h; if (all[i].l < lo) lo = all[i].l; }
    hi10 = hi; lo10 = lo; t10 = all[i0].t; tN = all[n - 1].t;
  }
  // 斐波那契: 取尾部窗口最高/最低作锚, 回撤 0.382/0.5/0.618/0.786 + 扩展 1.618
  const fib = [];
  if (n >= 20) {
    const w = Math.min(200, n), i0 = n - w;
    let hi = -Infinity, lo = Infinity;
    for (let i = i0; i < n; i++) { if (all[i].h > hi) hi = all[i].h; if (all[i].l < lo) lo = all[i].l; }
    if (hi > lo) {
      const span = hi - lo;
      [0.382, 0.5, 0.618, 0.786].forEach(r => fib.push([+(hi - span * r).toFixed(4), r, 1]));
      fib.push([+(hi + span * 0.618).toFixed(4), 1.618, 2]);
    }
  }
  // 买卖点: ★2026-10-24 已全部删除 —— 现在只有 DIF/DEA 延长虚线交叉那一个新信号
  //   (由 modules/okx/engines/chan.js 的 macdSignals 产出, 与前端同口径)
  const pts = [];
  return { ok: true, tops: sw.tops, bots: sw.bots, hi10, lo10, t10, tN, fib, pts };
}

// ---------------------------------------------------------------------------
// 对外: kline(读本地+按需播种) / instruments(缓存)
// ---------------------------------------------------------------------------
const seeding = new Set();
async function kline(instId, bar, limit, beforeTs) {
  bar = OKX_BAR[bar] ? bar : '5m';
  touchWatch(instId, bar);                    // ★登记浏览: 保鲜员持续拉最新K线落库
  // 悬浮迷你窗: 指定 before(信号时间) → 只取该时点之前的K线
  let rows = loadLocal(instId, bar, limit, beforeTs || 0);
  // 本地不足 → 播种(首次访问该合约时自动拉真实行情)
  if (rows.length < 50) {
    const key = instId + '|' + bar + (beforeTs ? '|b' : '');
    if (!seeding.has(key)) {
      seeding.add(key);
      try {
        // 指定 before → 拉【该时点之前】的历史; 否则拉最新
        if (beforeTs) await pullBefore(instId, bar, beforeTs, 8);
        else await pull(instId, bar, 6);
      } catch (e) { /* 忽略, 下次再试 */ } finally { seeding.delete(key); }
      rows = loadLocal(instId, bar, limit, beforeTs || 0);
    }
  }
  if (!rows.length) return { ok: false, err: '该周期暂无本地数据, 点「补充数据」拉取', inst: instId, bar };
  const C = rows.map(r => r.c);
  const ind = calcInd(C);
  const chan = computeChan(rows);
  // 指标按窗口切片对齐(前端 drawKline 也按窗口切, 这里给全量即可)
  const out = rows.map((r, i) => ({
    t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v,
    e12: ind.e12[i], e26: ind.e26[i], dif: ind.dif[i], dea: ind.dea[i], macd: ind.macd[i]
  }));
  return { ok: true, inst: instId, bar, bars: out, chan, count: out.length, last_t: out[out.length - 1].t };
}

let instCache = null, instCacheAt = 0;
async function instrumentsRaw(force) {
  const now = Date.now();
  if (!force && instCache && now - instCacheAt < 6 * 3600 * 1000) return { ok: true, src: 'mem', list: instCache };
  if (!force && fs.existsSync(INST_CACHE)) {
    try {
      const j = JSON.parse(fs.readFileSync(INST_CACHE, 'utf8'));
      instCache = j.list; instCacheAt = now;
      return { ok: true, src: 'file', list: instCache };
    } catch (e) { /* 损坏缓存忽略 */ }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let list = [];
  try {
    const res = await fetch(INST_API, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await res.json();
    if (j && j.code === '0' && Array.isArray(j.data)) {
      list = j.data
        .filter(d => d.ctType === 'linear' && /USDT|USDC/.test(d.settleCcy || d.quoteCcy || ''))
        .filter(d => d.instCategory !== '3' && d.instCategory !== '4')   // ★剔除股票/ETF/指数/贵金属/能源
        .map(d => ({
          instId: d.instId, baseCcy: d.baseCcy, quoteCcy: d.quoteCcy,
          ctVal: d.ctVal, ctValCcy: d.ctValCcy, lever: d.lever,
          instFamily: d.instFamily || '', state: d.state,
          cat: d.instCategory || ''          // ★OKX官方分类: 3=股票 4=商品 其余=加密
        }))
        .sort((a, b) => a.instId.localeCompare(b.instId));
    }
  } catch (e) { /* 网络失败 */ } finally { clearTimeout(timer); }
  if (list.length) {
    instCache = list; instCacheAt = now;
    try { fs.mkdirSync(path.dirname(INST_CACHE), { recursive: true }); fs.writeFileSync(INST_CACHE, JSON.stringify({ list, at: now })); } catch (e) {}
  } else if (instCache) {
    return { ok: true, src: 'mem-fallback', list: instCache };
  }
  return { ok: true, src: list.length ? 'live' : 'empty', list };
}

/* ★给每个合约打【加密生态分类】标签：
 *   OKX SWAP 里混着 加密永续 + 代币化股票/ETF/指数/贵金属/能源，
 *   这里只保留加密货币：剔除 instCategory=3(股票)/4(商品) + 手工排除名单，
 *   其余按加密生态分类归板块。分类口径与 universe.universe() 一致。
 *   每次请求重算(开销可忽略)。 */
async function instruments(force) {
  const r = await instrumentsRaw(force);
  const list = r && r.list;
  if (list && list.length) {
    list.forEach(x => {
      const sym = x.baseCcy || String(x.instId).split('-')[0];
      x.sym = sym;
      x.sector = TF.sectorOf(sym);
    });
  }
  return r;
}

module.exports = { kline, pull, pullBefore, backfill, loadLocal, localCount, instruments, computeChan, calcInd, OKX_BAR, touchWatch, keepLatest, keepAllMarket, saveRows };
