/* ============================================================================
 * modules/okx/engines/kstore.js —— K线月分片存储唯一入口（2026-10-27）
 * ----------------------------------------------------------------------------
 * 用户需求: "数据库要分类分页分月 不要全部都在一个文件避免锁住
 *            分时的3分钟 5分钟等都要按分时保存数据"
 *
 * 布局:
 *   新: data/okx/kline/{bar}/{instSafe}/{ym}.sqlite    ym = UTC 年月(YYYYMM)
 *       历史月片只读, 只有当月片接收写 → 写锁窗口最小化;
 *       删旧数据/压缩/备份按月片直接操作文件即可。
 *   旧: data/okx/kline/{instSafe}_{bar}.sqlite          (迁移前)
 *       → migrate-kline-monthly.js 拆片完成后改名 .legacy 保底可回滚。
 *
 * 此前 5 个文件(kline/updown/updownstore/backfillprogress/market)各自复制一份
 * storePath, 布局一变就要改 5 处 —— 现在路径逻辑只有这一份。
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '../../../');
const KLINE_DIR = path.join(ROOT, 'data/okx/kline');

function safeInst(instId) { return String(instId).replace(/[^A-Za-z0-9_-]/g, '_'); }
function ymOf(ts) { const d = new Date(Number(ts)); return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1; }

function instDir(bar, instId) { return path.join(KLINE_DIR, String(bar), safeInst(instId)); }
function monthFile(bar, instId, ym) { return path.join(instDir(bar, instId), String(ym) + '.sqlite'); }
function legacyFile(bar, instId) { return path.join(KLINE_DIR, safeInst(instId) + '_' + bar + '.sqlite'); }

const DDL = 'CREATE TABLE IF NOT EXISTS kline (' +
  'ts INTEGER PRIMARY KEY, d TEXT NOT NULL, ym INTEGER NOT NULL, ' +
  'o REAL, h REAL, l REAL, c REAL, v REAL)';

/* 已落地的月片(升序 YYYYMM) */
function monthsOf(bar, instId) {
  try {
    return fs.readdirSync(instDir(bar, instId))
      .filter(f => /^\d{6}\.sqlite$/.test(f))
      .map(f => parseInt(f, 10)).sort((a, b) => a - b);
  } catch (e) { return []; }
}
function hasLegacy(bar, instId) { return fs.existsSync(legacyFile(bar, instId)); }

/* ---------------- 只读 LRU 句柄池（自 kline.js 移入, 全引擎共用） ----------------
 * 月片比单文件更多更小, 池上限 120→160; 每句柄 ~2MB 堆, 160 ≈ 320MB 上限可控。 */
const RO_POOL = new Map();
const RO_MAX = 160;
function roOpen(file) {
  let db = RO_POOL.get(file);
  if (db) { RO_POOL.delete(file); RO_POOL.set(file, db); return db; }
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA busy_timeout=30000;');
  } catch (e) { return null; }
  RO_POOL.set(file, db);
  while (RO_POOL.size > RO_MAX) {
    const oldest = RO_POOL.keys().next().value;
    try { RO_POOL.get(oldest).close(); } catch (e) { }
    RO_POOL.delete(oldest);
  }
  return db;
}

/* 写连接(月片): 建目录+建表+PRAGMA; 用完必须 close(写句柄不常驻, 保鲜/回填轮流写) */
function openMonth(bar, instId, ym) {
  const f = monthFile(bar, instId, ym);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const db = new DatabaseSync(f);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=30000; PRAGMA synchronous=NORMAL;');
  db.exec(DDL);
  return db;
}

/* 读取链: 返回"从新到旧"应读取的文件路径数组
 *   beforeTs>0 → 从 beforeTs 所在月开始往旧
 *   limit>0    → 最多 3 个月片(5m 月片≈8640根, 3 片足以覆盖常规窗口;
 *                1h/2h/4h 月片几十根, 3 片也够常用回看; 全量回测走 limit=0 分支全开)
 *   都不传     → 全部月片(+legacy) */
function readChain(bar, instId, beforeTs, limit) {
  const months = monthsOf(bar, instId);
  const chain = [];
  if (months.length) {
    let startIdx = months.length - 1;                       // 默认最新片
    if (beforeTs > 0) {
      const bm = ymOf(beforeTs);
      for (let i = months.length - 1; i >= 0; i--) { if (months[i] <= bm) { startIdx = i; break; } }
    }
    if (limit > 0) {
      const endIdx = Math.max(0, startIdx - 2);             // 3 片窗口
      for (let i = startIdx; i >= endIdx; i--) chain.push(monthFile(bar, instId, months[i]));
    } else {
      for (let i = startIdx; i >= 0; i--) chain.push(monthFile(bar, instId, months[i]));
    }
  }
  /* legacy fallback: 完全未迁移(只有 legacy), 或迁移中 legacy 与月片并存(读时按 ts 去重) */
  if (hasLegacy(bar, instId)) chain.push(legacyFile(bar, instId));
  return chain;
}

/* 统计连接: 月片优先; legacy 只补"比月片最旧还早"的部分(避免迁移期间双算) */
function openAllRO(bar, instId) {
  const out = [];
  for (const ym of monthsOf(bar, instId)) {
    const db = roOpen(monthFile(bar, instId, ym));
    if (db) out.push(db);
  }
  if (hasLegacy(bar, instId)) {
    const db = roOpen(legacyFile(bar, instId));
    if (db) out.push(db);
  }
  return out;
}

module.exports = {
  ROOT, KLINE_DIR, safeInst, ymOf, instDir, monthFile, legacyFile,
  monthsOf, hasLegacy, roOpen, openMonth, readChain, openAllRO
};
