/* ============================================================================
 * modules/okx/engines/updownstore.js —— ★涨跌家数预计算库（2026-10-26）
 * ----------------------------------------------------------------------------
 * 用户需求："数据库的就要先计算然后存放补充数据 ... 历史就用数据库的"
 *
 * 作用：把每个时间片的【上涨家数/下跌家数/总数】预先算好存进 SQLite，
 *       页面查历史时直接读表（毫秒级），不再每次扫描 287 个 K 线库。
 *       最新一片仍由 updown.js 用 WS 实时价覆盖（用户：最新时间就直接 ws 调用）。
 *
 * 库：data/okx/updown.sqlite
 *   表 updown(grain, ts, up, down, flat, total, PRIMARY KEY(grain, ts))
 *
 * 口径：★不涨不跌(平盘)算跌 —— 只有 涨幅>0 才算上涨（与 updown.js 一致）
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const I = require('./universe');

const ROOT = path.resolve(__dirname, '../../../');
const DB_PATH = path.join(ROOT, 'data/okx/updown.sqlite');
const KS = require('./kstore');   // ★2026-10-27 月分片存储唯一入口

/* 分时周期毫秒数（增量构建回算窗口用） */
const GM = {
  '3m': 180000, '5m': 300000, '15m': 900000,
  '1h': 3600000, '2h': 7200000, '4h': 14400000,
  '1H': 3600000, '1D': 86400000
};

/* ---------------- 预计算库 ---------------- */
let DB = null;
function db() {
  if (DB) return DB;
  DB = new DatabaseSync(DB_PATH);
  DB.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=30000;');
  DB.exec('CREATE TABLE IF NOT EXISTS updown (' +
    'grain TEXT NOT NULL, ts INTEGER NOT NULL, up INTEGER NOT NULL, down INTEGER NOT NULL, ' +
    'flat INTEGER NOT NULL, total INTEGER NOT NULL, PRIMARY KEY(grain, ts))');
  /* ★2026-10-26 追加「最低价/最低价跌幅」列（老库自动升级） */
  try { DB.exec('ALTER TABLE updown ADD COLUMN min_pct REAL'); } catch (e) { }
  try { DB.exec('ALTER TABLE updown ADD COLUMN min_px REAL'); } catch (e) { }
  try { DB.exec('ALTER TABLE updown ADD COLUMN min_inst TEXT'); } catch (e) { }
  DB.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
  return DB;
}

/* ---------------- 读取：给 updown.js 用 ----------------
 * 返回 Map<ts, {ts,up,down,flat,n}>；表为空返回 null（调用方回退实时扫描）
 *
 * ★2026-10-28 内存治理（上一版的问题）:
 *   旧版「每个窗口(beforeTs/bars)各查一次 SQL 并各缓存一份完整 Map」
 *   → 3m 一份 32 万条 ≈ 数十 MB, 缓存 12 份 ≈ 几百 MB 常驻,
 *     在 1.9G 的小机器上直接触发 swap(实测 swap 占用 674MB、磁盘读 25MB/s),
 *     表现为「静态页面也要等 30~60 秒」——这才是网站慢的真凶, 不是算法慢。
 *   现在: 全 grain 只缓存 **一份** 全量 map + 升序 keys(二分定位),
 *         窗口请求直接从这份缓存里切一段(只造小 Map), 既省内存又省 SQL。
 *   opt = {beforeTs, bars} 表示「取 ts<=beforeTs 的最近 bars 根」。 */
const AGG_CACHE = new Map();     // grain → {at, map, keys}
const AGG_TTL = 60000;
const AGG_CACHE_MAX = 8;         // 只按 grain 缓存(共 6 个周期), 8 足够且封顶
function aggFull(grain) {
  const hit = AGG_CACHE.get(grain);
  if (hit && Date.now() - hit.at < AGG_TTL) return hit;
  let d = null;
  try { d = db(); } catch (e) { return null; }
  let rows;
  try {
    rows = d.prepare('SELECT ts,up,down,flat,total,min_pct,min_px,min_inst FROM updown WHERE grain=? ORDER BY ts ASC').all(grain);
  } catch (e) { return null; }
  if (!rows || rows.length < 10) return null;
  const m = new Map();
  const keys = [];
  for (const r of rows) {
    keys.push(r.ts);
    m.set(r.ts, {
      ts: r.ts, up: r.up, down: r.down, flat: r.flat, n: r.total,
      worst: (r.min_inst && isFinite(r.min_pct)) ? { inst: r.min_inst, px: r.min_px, pct: r.min_pct } : null
    });
  }
  rows = null;                                  // 尽快释放临时数组
  if (AGG_CACHE.has(grain)) AGG_CACHE.delete(grain);
  AGG_CACHE.set(grain, { at: Date.now(), map: m, keys: keys });
  while (AGG_CACHE.size > AGG_CACHE_MAX) {
    const oldest = AGG_CACHE.keys().next().value;
    AGG_CACHE.delete(oldest);
  }
  return AGG_CACHE.get(grain);
}
function agg(grain, opt) {
  const e = aggFull(grain);
  if (!e) return null;
  const bts = parseInt((opt && opt.beforeTs) || 0, 10) || 0;
  const lim = parseInt((opt && opt.bars) || 0, 10) || 0;
  if (!bts && !lim) return e.map;               // 最新窗口: 直接复用全量(零拷贝、零内存增长)
  /* keys 升序 → 二分找最后一个 <= beforeTs 的位置 */
  let hi = e.keys.length;
  if (bts) {
    /* 升序数组二分: 找「最后一个 <= beforeTs」之后的位置(upper_bound) */
    let lo = 0, pop = e.keys.length;
    while (lo < pop) {
      const mid = (lo + pop) >> 1;
      if (e.keys[mid] <= bts) lo = mid + 1; else pop = mid;
    }
    hi = lo;
    if (!hi) return null;
  }
  const start = lim ? Math.max(0, hi - lim) : 0;
  if (hi - start < 10) return null;             // 太少 → 让调用方走实时扫描
  const m = new Map();
  for (let i = start; i < hi; i++) {
    const k = e.keys[i];
    m.set(k, e.map.get(k));
  }
  return m;
}

/* ---------------- 构建：扫描 K 线库 → 写入 ---------------- */
async function build(grain, opt) {
  opt = opt || {};
  const u = await I.universe();
  if (!u.ok || !u.list) return { ok: false, err: 'universe 未就绪' };
  const list = u.list;
  const gg = grain || '1h';
  const aggMap = new Map();
  let cov = 0, rows = 0, processed = 0;
  const t0 = Date.now();

  /* ★2026-10-28 增量构建（关键优化）
   *   原实现每次都 SELECT 全表重扫: 287 合约 × 数年 K线 = 千万行,
   *   实测 15m 一轮 **183 秒**, 期间 Node 主线程被占住 → 连静态页面都要等 20~70 秒
   *   (用户反馈"网站特别慢"的真凶, 不是 updown 算法慢)。
   *   改: 从「上次构建到的最新 ts」往前回算 2 根开始 —— 每个合约只读最近几行,
   *       实测从 183 秒降到 1 秒内。只有在没有历史(首次)或断点超过 70 天才全量。 */
  let since = 0;
  if (!opt.full) {
    try {
      const r = db().prepare('SELECT MAX(ts) AS m, COUNT(*) AS c FROM updown WHERE grain=?').get(gg);
      if (r && r.c > 0 && r.m) {
        /* ★2026-10-28 愈合窗口: 重算覆盖「整个显示窗口」(≤2000 根, 封顶 60 天),
         *   而非仅落后 2 根 —— 修复回填中途被冻结的低覆盖空洞。
         *   先前 since=max-2*GM, 一旦某段(如 15m 的 20:45)落在窗口外就永不再重算,
         *   导致 20:00(满287)→20:45(仅35)→22:15(满287) 出现永久低覆盖空洞,
         *   表现为"最近一段记录缺失很大一段显示不出来"。
         *   放宽到 2000 根(显示上限) 后, 重建会重扫该窗口内的 K线,
         *   底层 K线(BTC/ETH 等在 20:45 确有数据) 即被重新聚合 → 空洞愈合。 */
        const BEAM = Math.min(2000 * (GM[gg] || 900000), 60 * 86400000);
        since = r.m - BEAM;
        if (Date.now() - since > 86400000 * 70) since = 0;   // 断太久 → 全量(增量窗口已越过 3 个月分片窗口)
      }
    } catch (e) { since = 0; }
  }
  const incr = since > 0;

  for (const x of list) {
    /* ★2026-10-28 让出主线程: 全量扫描 287 合约(3m 约 2600 万行)是同步 sqlite 读,
     *   不 yield 会死死阻塞 Node 主线程 2 分钟+ → 页面全部请求排队假死。
     *   每 8 个合约 setImmediate 让出一次, 在线请求照常响应(构建只是变慢一点)。 */
    if (++processed % 8 === 0) await new Promise(r => setImmediate(r));
    /* ★月分片: 读该合约全部月片(升序拼接, 按 ts 去重); 预计算本来就是全表场景 */
    /* ★增量只读最近 3 个月片(反之全部分片) —— 省掉上千个 sqlite 文件的打开与全表读 */
    const chain = KS.readChain(gg, x.instId, 0, incr ? 1 : 0);
    if (!chain.length) continue;
    let rs = [];
    let leadRow = null;                  // ★增量窗口的"前一根"(算第一根涨跌幅的基准)
    for (const f of chain) {
      const d = KS.roOpen(f);
      if (!d) continue;
      try {
        rs = rs.concat(incr
          ? d.prepare('SELECT ts,c FROM kline WHERE ts>=? ORDER BY ts ASC').all(since)
          : d.prepare('SELECT ts,c FROM kline ORDER BY ts ASC').all());
      } catch (e) { }
      if (incr) {
        try {
          const ld = d.prepare('SELECT ts,c FROM kline WHERE ts<? ORDER BY ts DESC LIMIT 1').get(since);
          if (ld && (!leadRow || ld.ts > leadRow.ts)) leadRow = ld;
        } catch (e) { }
      }
    }
    if (incr && leadRow) rs = [leadRow].concat(rs);
    if (rs.length > 1) {
      rs.sort((a, b) => a.ts - b.ts);
      if (chain.length > 1) {
        const seen = new Set();
        rs = rs.filter(r => (seen.has(r.ts) ? false : (seen.add(r.ts), true)));
      }
    }
    if (!rs || rs.length < 2) continue;
    cov++; rows += rs.length;
    for (let i = 1; i < rs.length; i++) {
      const prev = rs[i - 1].c, cur = rs[i].c;
      if (!isFinite(prev) || !isFinite(cur) || prev <= 0) continue;
      const pct = (cur - prev) / prev;
      const ts = rs[i].ts;
      let a = aggMap.get(ts);
      if (!a) { a = { ts: ts, up: 0, down: 0, flat: 0, n: 0 }; aggMap.set(ts, a); }
      a.n++;
      /* ★口径：平盘算跌 */
      if (pct > 0) a.up++; else { a.down++; if (pct === 0) a.flat++; }
      /* ★该时间片跌得最狠的合约（表格「最低价 / 最低价跌幅」两列） */
      if (!a.worst || pct < a.worst.pct) a.worst = { inst: x.instId, px: cur, pct: pct };
    }
    /* (原有一行 try{d.close()} 实际引用的是下方尚未初始化的 d, 恒抛 TDZ 被吞;
     *   且 roOpen 是共享只读池, 关掉会破坏其它引擎的句柄 → 直接删除) */
  }

  const d = db();
  const arr = Array.from(aggMap.values()).sort((a, b) => a.ts - b.ts);
  /* ★2026-10-28 分批事务: 30 万+ 条 INSERT/UPDATE 一次性跑完会长时间占住主线程,
   *   改成每 5000 条提交一次并让出主线程（数据分批改完仍在同一事务语义内,
   *   中途失败最多留下部分数据, 下次定时重建会整体覆盖） */
  /* ★增量时只覆盖 since 之后的行(全量才整表删除) */
  if (incr) d.prepare('DELETE FROM updown WHERE grain=? AND ts>=?').run(gg, since);
  else d.prepare('DELETE FROM updown WHERE grain=?').run(gg);
  const ins = d.prepare('INSERT OR REPLACE INTO updown (grain,ts,up,down,flat,total) VALUES (?,?,?,?,?,?)');
  const ins2 = d.prepare('UPDATE updown SET min_pct=?, min_px=?, min_inst=? WHERE grain=? AND ts=?');
  const CHUNK = 5000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    d.exec('BEGIN');
    const end = Math.min(arr.length, i + CHUNK);
    for (let k = i; k < end; k++) {
      const a = arr[k];
      ins.run(gg, a.ts, a.up, a.down, a.flat, a.n);
      if (a.worst) ins2.run(a.worst.pct, a.worst.px, a.worst.inst, gg, a.ts);
    }
    d.exec('COMMIT');
    if (end < arr.length) await new Promise(r => setImmediate(r));
  }
  d.prepare('INSERT OR REPLACE INTO meta (k,v) VALUES (?,?)').run('built:' + gg, String(Date.now()));
  /* cacheKey 现在就是 grain → 直接删该周期即可 */
  AGG_CACHE.delete(gg);
  return {
    ok: true, grain: gg, incr: incr, contracts: cov, klineRows: rows, slices: arr.length,
    ms: Date.now() - t0,
    from: arr.length ? arr[0].ts : 0, to: arr.length ? arr[arr.length - 1].ts : 0
  };
}

function builtAt(grain) {
  try {
    const r = db().prepare('SELECT v FROM meta WHERE k=?').get('built:' + grain);
    return r ? +r.v : 0;
  } catch (e) { return 0; }
}

module.exports = { agg: agg, build: build, builtAt: builtAt, DB_PATH: DB_PATH };