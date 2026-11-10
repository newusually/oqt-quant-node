/* ============================================================================
 * migrate-kline-monthly.js —— K线旧单文件库 → 月分片零停机迁移（2026-10-27）
 * ----------------------------------------------------------------------------
 * 用户需求: "分时的3分钟5分钟等都要按分时保存数据, 分类分月, 不要全在一个文件避免锁住"
 *
 * 旧: data/okx/kline/{instSafe}_{bar}.sqlite        （单文件全历史, 3432 个文件 838MB）
 * 新: data/okx/kline/{bar}/{instSafe}/{ym}.sqlite   （按周期分目录 + 按月分片）
 *
 * 流程（服务不停止, 与保鲜/回填并发安全）:
 *   1. 新代码已先部署 —— 保鲜/回填只写新片, 不再碰旧库;
 *   2. 本工具只读旧库, 按 ym 分组写入新片:
 *        - 目标月片不存在 → 先写 .tmp 再原子 rename（防半写）;
 *        - 已存在（重跑/补差）→ INSERT OR REPLACE 幂等增量;
 *   3. 对账: Σ月片行数 == 旧库行数 → 旧库改名 .legacy（保留可回滚, 不删）;
 *      不等 → 打印差异跳过 rename, 人工介入。
 *
 * 用法: node migrate-kline-monthly.js [--bar 5m] [--max 20] [--dry]
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '../../../');
const KLINE_DIR = path.join(ROOT, 'data/okx/kline');

const args = process.argv.slice(2);
function argOf(k, dflt) { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : dflt; }
const ONLY_BAR = argOf('--bar', null);
const MAX_LIBS = parseInt(argOf('--max', '0'), 10) || 0;
const DRY = args.includes('--dry');

function safeInst(instId) { return String(instId).replace(/[^A-Za-z0-9_-]/g, '_'); }
function ymOfTs(ts) { const d = new Date(Number(ts)); return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1; }

function openRW(f) {
  const db = new DatabaseSync(f);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=30000; PRAGMA synchronous=NORMAL;');
  db.exec('CREATE TABLE IF NOT EXISTS kline (ts INTEGER PRIMARY KEY, d TEXT NOT NULL, ym INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v REAL)');
  return db;
}

function main() {
  let files;
  try {
    files = fs.readdirSync(KLINE_DIR).filter(f => /^.+_\d+[mhdwM]\.sqlite$/.test(f));
  } catch (e) { console.log('读目录失败: ' + e.message); process.exit(1); }
  if (ONLY_BAR) files = files.filter(f => f.endsWith('_' + ONLY_BAR + '.sqlite'));
  if (MAX_LIBS) files = files.slice(0, MAX_LIBS);
  console.log('待迁移旧库: ' + files.length + ' 个' + (DRY ? ' (dry-run)' : ''));

  const t0 = Date.now();
  let done = 0, renamed = 0, mismatch = 0, emptySkipped = 0, failed = 0;
  let rowsTotal = 0;
  const report = [];

  for (const f of files) {
    const m = f.match(/^(.+)_(\d+[mhdwM])\.sqlite$/);
    if (!m) continue;
    const instSafe = m[1], bar = m[2];
    const legacyPath = path.join(KLINE_DIR, f);
    const legacyDone = legacyPath + '.legacy';
    if (fs.existsSync(legacyDone)) { continue; }        // 已迁移过

    let src = null;
    try {
      src = new DatabaseSync(legacyPath, { readOnly: true });
      const rows = src.prepare('SELECT ts,d,ym,o,h,l,c,v FROM kline ORDER BY ts ASC').all();
      src.close(); src = null;
      if (!rows.length) { emptySkipped++; continue; }

      /* 按 ym 分组 */
      const groups = new Map();
      for (const r of rows) {
        const ym = r.ym || ymOfTs(r.ts);
        if (!groups.has(ym)) groups.set(ym, []);
        groups.get(ym).push(r);
      }

      if (!DRY) {
        const instDir = path.join(KLINE_DIR, bar, safeInstInst(instSafe));
        fs.mkdirSync(instDir, { recursive: true });
        for (const [ym, g] of groups) {
          const target = path.join(instDir, ym + '.sqlite');
          const tmp = target + '.tmp';
          const exists = fs.existsSync(target);
          const db = openRW(exists ? target : tmp);
          db.exec('BEGIN');
          try {
            const ins = db.prepare('INSERT OR REPLACE INTO kline (ts,d,ym,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)');
            for (const r of g) ins.run(r.ts, r.d, ym, r.o, r.h, r.l, r.c, r.v);
            db.exec('COMMIT');
          } catch (e) {
            try { db.exec('ROLLBACK'); } catch (_) { }
            db.close();
            throw e;
          }
          const wc = db.prepare('SELECT COUNT(*) c FROM kline').get().c;
          db.close();
          if (!exists) {
            fs.renameSync(tmp, target);                  // 原子落名
          }
          if (wc < g.length) throw new Error('月片 ' + ym + ' 行数 ' + wc + ' < 应写 ' + g.length);
        }
      }

      /* 对账（dry 时也统计）。
       * ★2026-10-27 修正: 迁移与保鲜并发 —— 保鲜会把更新的K线写进"当月新片",
       *   所以新片行数可能 > 旧库快照行数(只增不减, REPLACE 幂等不删行)。
       *   无损判据改为: Σ新片 >= 旧库行数 且 旧库 ts 范围被新片范围覆盖。 */
      let sum = 0, newMn = 0, newMx = 0;
      if (DRY) { sum = rows.length; newMn = rows[0].ts; newMx = rows[rows.length - 1].ts; }
      else {
        for (const ym of groups.keys()) {
          const target = path.join(KLINE_DIR, bar, safeInstInst(instSafe), ym + '.sqlite');
          if (!fs.existsSync(target)) throw new Error('月片缺失 ' + ym);
          const db = new DatabaseSync(target, { readOnly: true });
          const s = db.prepare('SELECT COUNT(*) c, MIN(ts) mn, MAX(ts) mx FROM kline').get();
          sum += s.c;
          if (s.mn && (!newMn || s.mn < newMn)) newMn = s.mn;
          if (s.mx > newMx) newMx = s.mx;
          db.close();
        }
      }
      const oldMn = rows[0].ts, oldMx = rows[rows.length - 1].ts;
      if (sum < rows.length) throw new Error('对账行数少: 旧库 ' + rows.length + ' vs 新片和 ' + sum);
      if (newMn > oldMn || newMx < oldMx) throw new Error('对账范围缺口: 旧库[' + oldMn + ',' + oldMx + '] 新片[' + newMn + ',' + newMx + ']');

      if (!DRY) {
        fs.renameSync(legacyPath, legacyPath + '.legacy');
        /* 清掉残留 wal/shm */
        for (const suf of ['-wal', '-shm']) {
          const p = legacyPath + suf;
          try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { }
        }
        renamed++;
      }
      done++;
      rowsTotal += rows.length;
      report.push({ file: f, rows: rows.length, months: groups.size });
      if (done % 100 === 0) console.log('  …' + done + ' 完成, 累计 ' + rowsTotal + ' 行, ' + Math.round((Date.now() - t0) / 1000) + 's');
    } catch (e) {
      failed++;
      mismatch++;
      console.log('  ✗ ' + f + ': ' + e.message);
      if (src) { try { src.close(); } catch (_) { } }
    }
  }

  console.log('================ 迁移报告 ================');
  console.log('成功: ' + done + '（其中改名 .legacy: ' + renamed + '）, 空库跳过: ' + emptySkipped +
    ', 失败: ' + failed + ', 总行数: ' + rowsTotal + ', 耗时: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  fs.writeFileSync(path.join(ROOT, 'data/okx/migrate-monthly-report.json'),
    JSON.stringify({ at: new Date().toISOString(), done, renamed, failed, rowsTotal, sample: report.slice(0, 20) }, null, 1));
  process.exit(failed ? 2 : 0);
}

/* 旧文件名 instSafe 与新目录名同规则 */
function safeInstInst(s) { return s; }

main();
