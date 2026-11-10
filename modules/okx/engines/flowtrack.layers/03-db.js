/* 03-db.js — 存储层：建表与 meta
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
/* ============================== 数据库 ============================== */
function initDb() {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(CFG.DB_DIR, { recursive: true });
  db = new DatabaseSync(CFG.DB_FILE);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec(`CREATE TABLE IF NOT EXISTS trades(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER, inst_id TEXT, thr REAL, dir INTEGER, score REAL, imb REAL, tkr REAL,
      entry REAL, exit REAL, hold_sec INTEGER, win_ms INTEGER, gross_bp REAL, net_bp REAL)`);
  db.exec('CREATE INDEX IF NOT EXISTS ix_trades_win_thr ON trades(win_ms, thr)');
  db.exec('CREATE INDEX IF NOT EXISTS ix_trades_inst ON trades(inst_id)');
  db.exec('CREATE INDEX IF NOT EXISTS ix_trades_ts ON trades(ts)');
  try { db.exec("ALTER TABLE trades ADD COLUMN mode TEXT DEFAULT 'sig'"); } catch (e) { }
  try { db.exec("ALTER TABLE trades ADD COLUMN imbw REAL"); } catch (e) { }
  try { db.exec("ALTER TABLE trades ADD COLUMN spread_bp REAL"); } catch (e) { }
  try { db.exec("ALTER TABLE depth ADD COLUMN imb10w REAL"); } catch (e) { }
  db.exec(`CREATE TABLE IF NOT EXISTS snapshots(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER, seq INTEGER, n INTEGER, wins INTEGER, win_rate REAL,
      gross_bp REAL, net_bp REAL, exp_bp REAL, pf REAL, payoff REAL,
      active_hours REAL, note TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS depth(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER, inst_id TEXT, imb10 REAL, bid10 REAL, ask10 REAL, imb10w REAL)`);
  db.exec('CREATE INDEX IF NOT EXISTS ix_depth_ts ON depth(ts)');
  db.exec(`CREATE TABLE IF NOT EXISTS openpos(
      k TEXT PRIMARY KEY, inst_id TEXT, thr REAL, dir INTEGER,
      entry REAL, entry_ts INTEGER, score REAL, imb REAL, imbw REAL,
      spread_bp REAL, tkr REAL, mode TEXT, win_ms INTEGER,
      is_shadow INTEGER, done TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS pyr(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pid TEXT, inst_id TEXT, tf TEXT, dir INTEGER, event TEXT,
      ts INTEGER, px REAL, qty REAL, cost REAL, unreal REAL, net_bp REAL)`);
  db.exec('CREATE INDEX IF NOT EXISTS ix_pyr_inst ON pyr(inst_id)');
  db.exec('CREATE INDEX IF NOT EXISTS ix_pyr_pid ON pyr(pid)');
  db.exec('CREATE INDEX IF NOT EXISTS ix_pyr_ts ON pyr(ts)');
  /* 金字塔未平仓状态（重启恢复，无需重跑时间窗口） */
  db.exec(`CREATE TABLE IF NOT EXISTS pyr_open(
      pid TEXT PRIMARY KEY, inst_id TEXT, tf TEXT, dir INTEGER,
      entry_ts INTEGER, entry_px REAL, total_qty REAL, total_cost REAL,
      adds INTEGER, last_add_ts INTEGER, closed INTEGER)`);
  /* ★实时持仓曲线采样：每 30 秒落一次全部未平仓金字塔的实时净浮盈 USD（永久保留，不删） */
  db.exec(`CREATE TABLE IF NOT EXISTS pyr_equity(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER, n_open INTEGER, net_unreal REAL, holding_usd REAL, position_usd REAL)`);
  db.exec('CREATE INDEX IF NOT EXISTS ix_equity_ts ON pyr_equity(ts)');
  try { db.exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)'); } catch (e) { }
  const row = db.prepare("SELECT v FROM meta WHERE k='startedAt'").get();
  if (row && row.v) startedAt = +row.v;
}

function metaSet(k, v) {
  try { db.prepare('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)').run(k, String(v)); } catch (e) { }
}

