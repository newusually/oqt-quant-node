/* 08-persist.js — 持久化层：WAL / 批量落库 / 结算
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
/* ============================== 数据保留：永久 ==============================
 * 只做 WAL checkpoint 回收文件体积；绝不 DELETE 任何表、绝不 VACUUM 重建。
 * KEEP_FROM_TS 仅作面板/AI 展示标记。 */
function walCheckpointOnly() {
  if (!db) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (e) { console.error('[ft] WAL checkpoint 失败:', e.message); }
}

/* ============================== 落库 ============================== */
/* 批量落库金字塔事件（买多/卖空/加仓/平仓）到 pyr 表 */
function flush() {
  if (!db || !pendingPyr.length) return;
  const ins = db.prepare('INSERT INTO pyr(pid,inst_id,tf,dir,event,ts,px,qty,cost,unreal,net_bp) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  let ok = 0, skipped = 0;
  try {
    db.exec('BEGIN');
    for (const t of pendingPyr) {
      /* 单行坏数据不拖垮整批：跳过该行并记录，其余正常落库 */
      let bad = null;
      for (let i = 0; i < t.length; i++) {
        const v = t[i];
        if (v === undefined || (typeof v === 'number' && !isFinite(v))) { bad = { i: i, v: v }; break; }
      }
      if (bad) { skipped++; continue; }
      try { ins.run(t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10]); ok++; }
      catch (e) { skipped++; }
    }
    db.exec('COMMIT');
    pendingPyr = [];
    if (skipped) console.error(`[pyr] 落库跳过 ${skipped} 条坏数据（已正常入库 ${ok} 条）`);
    if (ok) broadcast();
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (e2) { }
    console.error('[pyr] 落库失败:', e.message);
    pendingPyr = [];
  }
}

/* ============================== 统计（全部由 SQL 聚合） ============================== */
function agg(where, args) {
  const sql = `SELECT COUNT(*) n,
      SUM(CASE WHEN net_bp>0 THEN 1 ELSE 0 END) wins,
      SUM(gross_bp) gross, SUM(net_bp) net, AVG(net_bp) exp,
      SUM(CASE WHEN net_bp>0 THEN net_bp ELSE 0 END) ngw,
      SUM(CASE WHEN net_bp<0 THEN -net_bp ELSE 0 END) ngl,
      AVG(CASE WHEN net_bp>0 THEN net_bp END) aw,
      AVG(CASE WHEN net_bp<0 THEN -net_bp END) al
    FROM trades ${where}`;
  const r = db.prepare(sql).get(...(args || [])) || {};
  const n = r.n || 0, wins = r.wins || 0;
  const ngw = r.ngw || 0, ngl = r.ngl || 0;
  const pf = ngl > 0 ? ngw / ngl : (ngw > 0 ? null : 0);
  const payoff = (r.aw && r.al) ? r.aw / r.al : 0;
  return {
    n, wins,
    winRate: n ? +(wins / n * 100).toFixed(2) : 0,
    grossBp: +(r.gross || 0).toFixed(1),
    netBp: +(r.net || 0).toFixed(1),
    expBp: r.exp == null ? 0 : +(+r.exp).toFixed(3),
    pf: pf == null ? null : +pf.toFixed(3),
    payoff: +payoff.toFixed(3),
    avgWin: r.aw == null ? 0 : +(+r.aw).toFixed(6),
    avgLoss: r.al == null ? 0 : +(+r.al).toFixed(6)
  };
}

function settle() {
  if (!db) return null;
  const now = Date.now();
  const s = pyrSummaryCalc();
  settleSeq++;
  lastSettleAt = now;
  const note = s.openCount === 0
    ? '当前无未平仓金字塔'
    : ('未平仓 ' + s.openCount + ' · 浮亏 ' + s.lossUSD.toFixed(6) + ' USD · 已平仓盈利 ' + s.totalProfitUSD.toFixed(6) + ' USD');
  try {
    db.prepare('INSERT INTO snapshots(ts,seq,n,wins,win_rate,gross_bp,net_bp,exp_bp,pf,payoff,active_hours,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(now, settleSeq, s.closedCount, 0, 0, 0, +s.totalProfitUSD.toFixed(6), 0, 0, 0, 0, note);
  } catch (e) { console.error('[pyr] 快照写入失败:', e.message); }
  console.log('[pyr] 第 ' + settleSeq + ' 次结算: ' + note);
  broadcast();          // ★结算完成立即推送，前端立刻显示最新结算
  return { seq: settleSeq, at: now, summary: s, note };
}

