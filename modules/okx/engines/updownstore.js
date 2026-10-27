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
 * 返回 Map<ts, {ts,up,down,flat,n}>；表为空返回 null（调用方回退实时扫描） */
const AGG_CACHE = new Map();     // grain → {at, agg}
const AGG_TTL = 60000;
function agg(grain) {
  const hit = AGG_CACHE.get(grain);
  if (hit && Date.now() - hit.at < AGG_TTL) return hit.agg;
  let d = null;
  try { d = db(); } catch (e) { return null; }
  let rows;
  try { rows = d.prepare('SELECT ts,up,down,flat,total,min_pct,min_px,min_inst FROM updown WHERE grain=? ORDER BY ts ASC').all(grain); }
  catch (e) { return null; }
  if (!rows || rows.length < 10) return null;
  const m = new Map();
  for (const r of rows) {
    m.set(r.ts, {
      ts: r.ts, up: r.up, down: r.down, flat: r.flat, n: r.total,
      worst: (r.min_inst && isFinite(r.min_pct)) ? { inst: r.min_inst, px: r.min_px, pct: r.min_pct } : null
    });
  }
  AGG_CACHE.set(grain, { at: Date.now(), agg: m });
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
  let cov = 0, rows = 0;
  const t0 = Date.now();

  for (const x of list) {
    /* ★月分片: 读该合约全部月片(升序拼接, 按 ts 去重); 预计算本来就是全表场景 */
    const chain = KS.readChain(gg, x.instId, 0, 0);
    if (!chain.length) continue;
    let rs = [];
    for (const f of chain) {
      const d = KS.roOpen(f);
      if (!d) continue;
      try { rs = rs.concat(d.prepare('SELECT ts,c FROM kline ORDER BY ts ASC').all()); }
      catch (e) { }
    }
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
    try { d.close(); } catch (e) { }
  }

  const d = db();
  d.exec('BEGIN');
  d.prepare('DELETE FROM updown WHERE grain=?').run(gg);
  const ins = d.prepare('INSERT OR REPLACE INTO updown (grain,ts,up,down,flat,total) VALUES (?,?,?,?,?,?)');
  const arr = Array.from(aggMap.values()).sort((a, b) => a.ts - b.ts);
  const ins2 = d.prepare('UPDATE updown SET min_pct=?, min_px=?, min_inst=? WHERE grain=? AND ts=?');
  for (const a of arr) {
    ins.run(gg, a.ts, a.up, a.down, a.flat, a.n);
    if (a.worst) ins2.run(a.worst.pct, a.worst.px, a.worst.inst, gg, a.ts);
  }
  d.prepare('INSERT OR REPLACE INTO meta (k,v) VALUES (?,?)').run('built:' + gg, String(Date.now()));
  d.exec('COMMIT');
  AGG_CACHE.delete(gg);
  return {
    ok: true, grain: gg, contracts: cov, klineRows: rows, slices: arr.length,
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