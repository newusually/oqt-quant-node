/* 07-pyramid.js — 策略层：开仓 / 加仓 / 止盈主循环
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
function recordPyrEvent(p, event, ts, px, qty, cost, unreal, netBp) {
  pendingPyr.push([
    p.pid, p.instId, p.tf, p.dir, event, ts, px, qty, cost,
    unreal == null ? null : +unreal.toFixed(6),
    netBp == null ? null : +netBp.toFixed(6)
  ]);
}


let openDirty = false;

/* 未平仓金字塔持久化（重启恢复） */
function persistOpen() {
  if (!db) return;
  try {
    const ins = db.prepare(`INSERT INTO pyr_open
      (pid,inst_id,tf,dir,entry_ts,entry_px,total_qty,total_cost,adds,last_add_ts,closed)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(pid) DO UPDATE SET
        inst_id=excluded.inst_id,tf=excluded.tf,dir=excluded.dir,entry_ts=excluded.entry_ts,
        entry_px=excluded.entry_px,total_qty=excluded.total_qty,total_cost=excluded.total_cost,
        adds=excluded.adds,last_add_ts=excluded.last_add_ts,closed=excluded.closed`);
    for (const [pid, p] of pyramids) {
      if (p.closed) continue;
      ins.run(pid, p.instId, p.tf, p.dir, p.entryTs, p.entryPx, p.totalQty, p.totalCost, p.adds, p.lastAddTs, 0);
    }
    /* 清理已平仓残留 */
    const stale = db.prepare('SELECT pid FROM pyr_open').all();
    const del = db.prepare('DELETE FROM pyr_open WHERE pid=?');
    let removed = 0;
    for (const r of stale) { if (!pyramids.has(r.pid)) { del.run(r.pid); removed++; } }
    openDirty = false;
    if (removed) { /* 已平仓残留已清除 */ }
  } catch (e) {
    console.error('[pyr] 持仓持久化失败:', e.message);
  }
}

/* 重启恢复未平仓金字塔（从 pyr_open 表）；不读取旧 openpos 多窗口持仓。 */
function restoreOpen() {
  if (!db) return 0;
  let n = 0;
  try {
    const rows = db.prepare('SELECT * FROM pyr_open WHERE closed=0').all();
    for (const r of rows) {
      if (!r || !r.pid || !r.inst_id) continue;
      const initQty = PYR.ENTRY_USD / (r.entry_px > 0 ? r.entry_px : 1);
      const p = {
        pid: r.pid, instId: r.inst_id, tf: r.tf, dir: r.dir,
        entryTs: r.entry_ts, entryPx: r.entry_px, initQty: initQty,
        totalQty: r.total_qty, totalCost: r.total_cost, totalFee: 0,
        adds: r.adds || 0, lastAddTs: r.last_add_ts || r.entry_ts, closed: false
      };
      pyramids.set(p.pid, p);
      pyrActive.set(p.instId + '|' + p.tf + '|' + p.dir, p.pid);
      n++;
    }
  } catch (e) { console.error('[pyr] 持仓恢复失败:', e.message); }
  /* 续接自增序号，避免重启后新 pid 与库内历史 pid 冲突 */
  if (pyrSeq < n) pyrSeq = n + 1;
  console.log(`[pyr] 恢复未平仓金字塔 ${n} 个（inst|tf|dir 防重复开仓已重建）`);
  return n;
}

/* ============================== 金字塔主循环（第五版） ==============================
 * 每个合约·方向只允许一个金字塔（pyrActive 防重），只 15m。
 * ① 入场：MACD(12,26,60) 零轴翻转；同根 K 线槽已占用则不开仓；每笔 0.1 美金。
 * ② 加仓：满 1 小时 + 浮亏 > 总投入 1% + 当前 MACD 柱方向同向 + 同根 K 线槽空闲 → 0.1 美金。
 * ③ 平仓：整仓浮盈 > 总投入 10% 止盈；否则一直持有，不止损、不按时间平仓。
 * 无限资金、无爆仓；数据自 2026-11-01 起永久保留。 */
function scan() {
  if (!db) return;
  const now = Date.now();
  const feeRate = PYR.FEE_BP / 10000;

  /* ---- 1) 遍历未平仓金字塔：满1小时+浮亏>1%+MACD柱方向同向加仓 / 浮盈>10%止盈平仓（不准按时间平仓）---- */
  for (const [pid, p] of pyramids) {
    if (p.closed) continue;
    const b = books.get(p.instId);
    if (!b || !b.bids.length || !b.asks.length) continue;
    const bid = +b.bids[0][0], ask = +b.asks[0][0];
    const px = p.dir > 0 ? bid : ask;            // 多:用买价估值/平仓；空:用卖价
    const avg = p.totalCost / p.totalQty;         // 成本均价（不含费）
    const grossUnreal = p.dir * (px - avg) * p.totalQty;

    /* ★止盈：整仓浮盈 > 总投入的 10% → 平仓（只允许止盈，不准止损/按时间平仓） */
    if (grossUnreal > p.totalCost * PYR.TP_PCT / 100) {
      const exitPx = p.dir > 0 ? bid : ask;
      const exitNotional = p.totalQty * exitPx;
      const exitFee = exitNotional * feeRate;
      const realizedGross = p.dir * (exitPx - avg) * p.totalQty;
      const realizedNet = realizedGross - p.totalFee - exitFee;
      p.closed = true;
      recordPyrEvent(p, 'close', now, +exitPx.toFixed(6), +p.totalQty.toFixed(8),
        +p.totalCost.toFixed(6), +realizedGross.toFixed(6), +realizedNet.toFixed(6));
      pyrActive.delete(p.instId + '|' + p.tf + '|' + p.dir);
      pyramids.delete(pid);                        // 已平仓移出内存，pyr_open 残留由 persistOpen 清理
      openDirty = true;
      continue;
    }

    /* 加仓四条件：距开仓/上次加仓满 1 小时；整仓毛浮亏 > 总投入 1%（多空对称）；
     *   当前 15m K 线 MACD 柱方向与持仓同向（不要求零轴翻转）；同根 K 线事件槽空闲。
     *   加仓量固定 0.1 美金。 */
    const loss = -grossUnreal;                     // 整仓毛浮亏（USD）
    const sinceTs = p.adds > 0 ? p.lastAddTs : p.entryTs;
    const sigTf = PYR.TFS.find(t => t.id === p.tf) || PYR.TFS[0];
    const sigDir = pyrMacdDir(p.instId, sigTf);
    const sameDir = sigDir !== 0 && sigDir === p.dir;
    if (loss > p.totalCost * PYR.ADD_LOSS_PCT / 100 &&
        sameDir &&
        (now - sinceTs) >= PYR.ADD_INTERVAL_MS &&
        !pyrBarTaken(p.instId, p.tf, now)) {
      const addPx = p.dir > 0 ? ask : bid;
      const addQty = PYR.ADD_USD / addPx;          // ★固定加仓 0.1 美金
      const addNotional = addQty * addPx;
      const addFee = addNotional * feeRate;
      p.totalQty += addQty;
      p.totalCost += addNotional;
      p.totalFee += addFee;
      p.adds += 1;
      p.lastAddTs = now;
      const newAvg = p.totalCost / p.totalQty;
      const gU = p.dir * (px - newAvg) * p.totalQty;
      recordPyrEvent(p, 'add', now, +addPx.toFixed(6), +addQty.toFixed(8),
        +addNotional.toFixed(6), +gU.toFixed(6), +(gU - p.totalFee).toFixed(6));
      pyrBarMark(p.instId, p.tf, now);             // 占用本根K线事件槽
      openDirty = true;
    }
  }

  /* ---- 2) 新开仓：MACD 零轴翻转信号（★只 15m，买多+卖空都开）---- */
  for (const inst of universe) {
    if (isStableInst(inst) || isZeroVolInst(inst)) continue;
    const b = books.get(inst);
    if (!b || !b.bids.length || !b.asks.length) continue;
    const bid = +b.bids[0][0], ask = +b.asks[0][0];
    if (!(bid > 0) || !(ask > 0)) continue;
    /* 用盘口中价补齐分钟价格桶（诊断用，跨重启连续） */
    if (CFG.JUMP_FILL_MID) {
      const midPx = (bid + ask) / 2;
      if (midPx > 0) recordPx(inst, midPx, now, 'mid');
    }
    for (const tf of PYR.TFS) {
      const dir = pyrEntrySignal(inst, tf);
      if (!dir) continue;
      const key = inst + '|' + tf.id + '|' + dir;
      if (pyrActive.has(key)) continue;           // 同一合约·周期·方向只允许一个金字塔
      if (pyrBarTaken(inst, tf.id, now)) continue; // ★同根K线只允许一次买多/卖空/加仓
      const entryPx = dir > 0 ? ask : bid;
      const initQty = PYR.ENTRY_USD / entryPx;
      const fee0 = PYR.ENTRY_USD * feeRate;
      const pid = 'P' + (++pyrSeq) + '_' + inst + '_' + tf.id + '_' + dir;
      const p = {
        pid, instId: inst, tf: tf.id, dir,
        entryTs: now, entryPx, initQty,
        totalQty: initQty, totalCost: PYR.ENTRY_USD, totalFee: fee0,
        adds: 0, lastAddTs: now, closed: false
      };
      pyramids.set(pid, p);
      pyrActive.set(key, pid);
      pyrBarMark(inst, tf.id, now);               // 占用本根K线事件槽
      /* 买多 / 卖空 入事件表（开仓即 0.1 美金） */
      recordPyrEvent(p, dir > 0 ? 'buy' : 'sell', now, +entryPx.toFixed(6),
        +initQty.toFixed(8), +PYR.ENTRY_USD.toFixed(6), 0, -fee0);
      openDirty = true;
    }
  }

  /* ---- 3) 持仓状态增量落库（重启不丢未平仓金字塔）---- */
  if (openDirty) persistOpen();
}

