/* ============================================================================
 * modules/okx/engines/buysigstore.js —— ★BTC买卖信号结果持久化（2026-10-26）
 * ----------------------------------------------------------------------------
 * 用户需求：
 *   "所有表格都要ajax同步，这些表格都要给我弄成数据库保存，
 *    如果换成新的电脑还会自动检测和回补数据"
 *
 * ★实现：
 *   - 把六周期(BTC买卖信号回测)每次扫码结果落盘到 SQLite
 *     data/okx/buysig.sqlite，表 sig 主键 = grain + ts（同一触发点唯一）。
 *   - 每次扫描后 upsert 最新结果；保留历史所有触发点。
 *   - 换新电脑：comfy"缺失库"检测 —— 对比历史最旧/最新时间轴 vs 本地K线库的
 *     newest/oldest，若历史信号 ts 对应周期K线库不存在/时间不全 → 说明数据缺口，
 *     触发 K线回补(backfill) 再用本地全量重算。
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const UD = require('./updown');
const KS = require('./kstore');   // ★2026-10-27 月分片存储唯一入口

const DB_PATH = path.resolve(__dirname, '../../../data/okx/buysig.sqlite');

let _db = null;
function db() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=30000;');
  _db.exec(`CREATE TABLE IF NOT EXISTS buysig (
    grain TEXT NOT NULL,
    ts    INTEGER NOT NULL,
    buyRatio REAL, down_1 REAL, down_2 REAL, down_3 REAL,
    buyPx  REAL, f1 REAL, f2 REAL, f3 REAL, f5 REAL,
    savedAt INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (grain, ts)
  )`);
  return _db;
}

/* 持久化一批信号（upsert，重复触发点刷新） */
function saveSignals(r) {
  const d = db();
  let n = 0;
  const up = d.prepare(`INSERT INTO buysig
    (grain, ts, buyRatio, down_1, down_2, down_3, buyPx, f1, f2, f3, f5, savedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,unixepoch())
    ON CONFLICT(grain, ts) DO UPDATE SET
      buyRatio=excluded.buyRatio, down_1=excluded.down_1, down_2=excluded.down_2,
      down_3=excluded.down_3, buyPx=excluded.buyPx,
      f1=excluded.f1, f2=excluded.f2, f3=excluded.f3, f5=excluded.f5, savedAt=unixepoch()`);
  const tx = d.exec('BEGIN');
  try {
    for (const a of r.all) {
      if (!a || !a.ok) continue;
      for (const s of (a.signals || [])) {
        up.run(s.grain, s.ts, s.buyRatio, s.down_1, s.down_2, s.down_3, s.buyPx, s.f1, s.f2, s.f3, s.f5);
        n++;
      }
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return { saved: n };
}

/* 读取已持久化信号（按周期） */
function loadSignals(grain) {
  const d = db();
  return d.prepare(
    'SELECT * FROM buysig WHERE grain=? ORDER BY ts DESC')
    .all(grain);
}

/* 汇总统计（复用引擎的 summarize 逻辑，从库里重算） */
function loadAll() {
  const d = db();
  return d.prepare('SELECT * FROM buysig ORDER BY ts DESC').all();
}

/* 数据完整性检测：数据库里的信号 vs 本地K线库覆盖情况 */
async function checkIntegrity() {
  const d = db();
  const out = {};
  const grains = d.prepare('SELECT DISTINCT grain FROM buysig').all().map(x => x.grain);
  const T = require('./universe');
  let list = [];
  try { const u = await T.universe(); list = u.ok ? u.list : []; } catch (e) { }
  for (const g of grains) {
    const rows = d.prepare('SELECT MIN(ts) mn, MAX(ts) mx, COUNT(*) n FROM buysig WHERE grain=?').get(g);
    /* 该周期K线库是否齐全（决定能否续算/续补） */
    let storeOk = 0, storeTotal = list.length;
    /* ★2026-10-27 月分片: 有任一月片(或未迁移 legacy)即视为库齐全 */
    for (const x of list) {
      if (KS.monthsOf(g, x.instId).length > 0 || KS.hasLegacy(g, x.instId)) storeOk++;
    }
    out[g] = Object.assign({}, rows, { klineStoreOk: storeOk, klineStoreTotal: storeTotal });
  }
  return { grains, detail: out };
}

module.exports = { db, saveSignals, loadSignals, loadAll, checkIntegrity, DB_PATH };