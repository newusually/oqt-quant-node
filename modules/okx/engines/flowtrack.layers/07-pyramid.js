/* 07-pyramid.js — 策略层：开仓 / 加仓 / 止盈主循环
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
function recordPyrEvent(p, event, ts, px, qty, cost, unreal, netBp, note) {
  pendingPyr.push([
    p.pid, p.instId, p.tf, p.dir, event, ts, px, qty, cost,
    unreal == null ? null : +unreal.toFixed(6),
    netBp == null ? null : +netBp.toFixed(6),
    note == null ? null : String(note).slice(0, 160)
  ]);
}


let openDirty = false;

/* 未平仓金字塔持久化（重启恢复） */
function persistOpen() {
  if (!db) return;
  try {
    const ins = db.prepare(`INSERT INTO pyr_open
      (pid,inst_id,tf,dir,entry_ts,entry_px,total_qty,total_cost,adds,last_add_ts,closed,adds_strong,strong)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(pid) DO UPDATE SET
        inst_id=excluded.inst_id,tf=excluded.tf,dir=excluded.dir,entry_ts=excluded.entry_ts,
        entry_px=excluded.entry_px,total_qty=excluded.total_qty,total_cost=excluded.total_cost,
        adds=excluded.adds,last_add_ts=excluded.last_add_ts,closed=excluded.closed,
        adds_strong=excluded.adds_strong,strong=excluded.strong`);
    for (const [pid, p] of pyramids) {
      if (p.closed) continue;
      ins.run(pid, p.instId, p.tf, p.dir, p.entryTs, p.entryPx, p.totalQty, p.totalCost, p.adds, p.lastAddTs, 0,
        p.addsStrong || 0, p.strong ? 1 : 0);
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
        adds: r.adds || 0, lastAddTs: r.last_add_ts || r.entry_ts, closed: false,
        addsStrong: r.adds_strong || 0, strong: !!r.strong
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
 * ② 加仓（两级，2026-11-11 升级）：
 *    · 强信号加仓：pyrPattern() 命中 孔雀开屏/倒孔雀开屏、V反转/倒V、W双底/M头、放量、MACD加速
 *      且与持仓同向 → 加仓 0.1 美金 × 倍数(2/2.5/3/4/5)，间隔 1 根K线，允许浮盈加仓；
 *      上限：单金字塔总投入 ≤ 2.5U、强加仓 ≤ 6 次、总加仓 ≤ 18 次、浮盈达止盈 60% 停加。
 *    · 基础加仓：满 1 小时 + 浮亏 > 0 + 零轴翻转同向 → 固定 0.1 美金（原口径保留）。
 * ③ 平仓：整仓浮盈 > 总投入 5% 止盈（强形态单 8%）；否则一直持有，不止损、不按时间平仓。
 * ★节奏约束：买多/卖空/加仓只在每根 15m K 线边界后的 ENTRY_WINDOW_MS 窗口内执行（窗口外只平仓），
 *   且平仓后同合约·同周期冷却 REOPEN_COOLDOWN_MS（1 根K线），彻底消除"每时每刻都在买卖"的观感。
 * 无限资金、无爆仓；数据自 2026-11-01 起永久保留。 */
function scan() {
  if (!db) return;
  const now = Date.now();
  const feeRate = PYR.FEE_BP / 10000;
  /* ★买卖/加仓边界窗口：仅窗口内允许信号驱动的买多/卖空/加仓；窗口外只做平仓判定。
   *   这样所有买卖/加仓都明确发生在每 15 分钟一次，绝不会"每时每刻"触发。 */
  const inWindow = entryWindowUntil > 0 && now <= entryWindowUntil;

  /* ---- 1) 遍历未平仓金字塔：满1小时+浮亏>0%+买卖信号(零轴翻转)同向加仓 / 浮盈>5%止盈平仓（不准按时间平仓）---- */
  for (const [pid, p] of pyramids) {
    if (p.closed) continue;
    const b = books.get(p.instId);
    if (!b || !b.bids.length || !b.asks.length) continue;
    const bid = +b.bids[0][0], ask = +b.asks[0][0];
    const px = p.dir > 0 ? bid : ask;            // 多:用买价估值/平仓；空:用卖价
    const avg = p.totalCost / p.totalQty;         // 成本均价（不含费）
    const grossUnreal = p.dir * (px - avg) * p.totalQty;

    /* ★止盈：整仓浮盈 > 总投入的 5%（强形态单放宽到 TP_PCT_STRONG=8%，让盈利单跑得更远） */
    const tpPct = p.strong ? PYR.TP_PCT_STRONG : PYR.TP_PCT;
    if (grossUnreal > p.totalCost * tpPct / 100) {
      const exitPx = p.dir > 0 ? bid : ask;
      const exitNotional = p.totalQty * exitPx;
      const exitFee = exitNotional * feeRate;
      const realizedGross = p.dir * (exitPx - avg) * p.totalQty;
      const realizedNet = realizedGross - p.totalFee - exitFee;
      p.closed = true;
      const pnlPct = p.totalCost > 0 ? (grossUnreal / p.totalCost * 100) : 0;
      recordPyrEvent(p, 'close', now, +exitPx.toFixed(6), +p.totalQty.toFixed(8),
        +p.totalCost.toFixed(6), +realizedGross.toFixed(6), +realizedNet.toFixed(6),
        '止盈平仓：浮盈 ' + pnlPct.toFixed(2) + '% ≥ ' + tpPct + '%' +
        (p.strong ? '（强形态单·放宽止盈）' : '') +
        '，加仓 ' + (p.adds || 0) + ' 次' + (p.addsStrong ? '（强信号 ' + p.addsStrong + ' 次）' : ''));
      pyrActive.delete(p.instId + '|' + p.tf + '|' + p.dir);
      pyrCloseAt.set(p.instId + '|' + p.tf, now);   // ★平仓后同合约·同周期冷却 1 根K线，避免反复开仓
      pyramids.delete(pid);                        // 已平仓移出内存，pyr_open 残留由 persistOpen 清理
      openDirty = true;
      continue;
    }

    /* ---- 加仓（两级）：① 强信号加权加仓（形态驱动，可浮盈加仓）② 基础浮亏加仓（原逻辑）----
     * 强信号 = pyrPattern() 命中 孔雀开屏/倒孔雀开屏、V反转/倒V、W双底/M头、放量、MACD加速，
     *   形态分 ≥ STRONG_MIN_SCORE 且与持仓同向 → 加仓量 = ADD_USD × 倍数（2/2.5/3/4/5 倍），
     *   间隔缩短到 1 根 K 线（15m），允许在浮盈阶段加（趋势确认才加，不等浮亏），
     *   但浮盈达止盈目标 60% 后不再加，且受 单金字塔总投入 / 强加仓次数 / 总加仓次数 三重上限约束。
     * 基础加仓保持原口径：浮亏 + 满 1 小时 + MACD 零轴翻转同向 → 0.1 美金。 */
    const loss = -grossUnreal;                     // 整仓毛浮亏（USD）
    const sinceTs = p.adds > 0 ? p.lastAddTs : p.entryTs;
    const sigTf = PYR.TFS.find(t => t.id === p.tf) || PYR.TFS[0];
    const sigDir = pyrEntrySignal(p.instId, sigTf);   // 入场同款买卖信号（零轴翻转）
    const sameDir = sigDir !== 0 && sigDir === p.dir;
    const macdDir = pyrMacdDir(p.instId, sigTf);      // 当前 15m MACD 柱方向（加仓用，不要求翻转）
    const pat = pyrPattern(p.instId, sigTf, p.dir);   // ★形态强度评分（孔雀开屏/V/W/M…）
    const strong = pat.score >= (PYR.STRONG_MIN_SCORE || 2) && pat.mult > 1;
    const tpUsd = p.totalCost * tpPct / 100;
    const profitRatio = tpUsd > 0 ? grossUnreal / tpUsd : 0;
    const barFree = !pyrBarTaken(p.instId, p.tf, now);
    const expoLeft = (PYR.MAX_EXPO_USD || 999) - p.totalCost;

    let addUsd = 0, addNote = '', isStrongAdd = false;
    if (inWindow && barFree && expoLeft > 0.01) {
      /* ① 强信号加权加仓：形态好+MACD同向+未接近止盈+次数/间隔达标 */
      if (strong && macdDir === p.dir &&
          (p.addsStrong || 0) < (PYR.ADD_STRONG_MAX || 6) &&
          (p.adds || 0) < (PYR.ADD_MAX_TIMES || 18) &&
          profitRatio < (PYR.ADD_STRONG_PROFIT_STOP || 60) / 100 &&
          (now - sinceTs) >= (PYR.ADD_STRONG_INTERVAL_MS || 900000)) {
        addUsd = Math.min(PYR.ADD_USD * pat.mult, expoLeft);
        addNote = '强信号×' + pat.mult + ' ' + pat.tags.join('+') + '（形态分' + pat.score + '）';
        isStrongAdd = true;
      }
      /* ② 基础浮亏加仓：保持原口径（浮亏 + 满 1 小时 + 零轴翻转同向） */
      else if (loss > p.totalCost * PYR.ADD_LOSS_PCT / 100 &&
          sameDir &&
          (p.adds || 0) < (PYR.ADD_MAX_TIMES || 18) &&
          (now - sinceTs) >= PYR.ADD_INTERVAL_MS) {
        addUsd = Math.min(PYR.ADD_USD, expoLeft);
        addNote = '浮亏加仓（浮亏' + (p.totalCost > 0 ? (loss / p.totalCost * 100).toFixed(1) : '0') + '%）';
      }
    }
    if (addUsd > 0) {
      const addPx = p.dir > 0 ? ask : bid;
      const addQty = addUsd / addPx;
      const addNotional = addQty * addPx;
      const addFee = addNotional * feeRate;
      p.totalQty += addQty;
      p.totalCost += addNotional;
      p.totalFee += addFee;
      p.adds += 1;
      if (isStrongAdd) { p.addsStrong = (p.addsStrong || 0) + 1; p.strong = true; }
      p.lastAddTs = now;
      const newAvg = p.totalCost / p.totalQty;
      const gU = p.dir * (px - newAvg) * p.totalQty;
      recordPyrEvent(p, 'add', now, +addPx.toFixed(6), +addQty.toFixed(8),
        +addNotional.toFixed(6), +gU.toFixed(6), +(gU - p.totalFee).toFixed(6), addNote);
      pyrBarMark(p.instId, p.tf, now);             // 占用本根K线事件槽
      openDirty = true;
      if (isStrongAdd) {
        console.log('[pyr] 强信号加仓 ' + p.instId + ' ' + (p.dir > 0 ? '多' : '空') +
          ' ×' + pat.mult + ' [' + pat.tags.join('+') + '] 本笔+' + addNotional.toFixed(3) +
          'U 累计投入' + p.totalCost.toFixed(2) + 'U 强加仓' + p.addsStrong + '/' + PYR.ADD_STRONG_MAX);
      }
    }
  }

  /* ---- 2) 新开仓：MACD 零轴翻转信号（★只 15m，买多+卖空都开）---- */
  /* ★只在边界窗口内执行：窗口外绝不新开仓，保证买卖节奏严格为每 15 分钟一次。 */
  if (inWindow) for (const inst of universe) {
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
      /* ★平仓后冷却：同合约·同周期 1 根K线内不再开仓，避免反复开仓/平仓抖动 */
      if (now - (pyrCloseAt.get(inst + '|' + tf.id) || 0) < CFG.REOPEN_COOLDOWN_MS) continue;
      if (pyrBarTaken(inst, tf.id, now)) continue; // ★同根K线只允许一次买多/卖空/加仓
      const entryPx = dir > 0 ? ask : bid;
      const initQty = PYR.ENTRY_USD / entryPx;
      const fee0 = PYR.ENTRY_USD * feeRate;
      const pid = 'P' + (++pyrSeq) + '_' + inst + '_' + tf.id + '_' + dir;
      /* 入场即打分：形态本来就强的（孔雀开屏/V/W/M），标 strong → 止盈放宽到 8%，后续强加仓立刻可触发 */
      const pat0 = pyrPattern(inst, tf, dir);
      const p = {
        pid, instId: inst, tf: tf.id, dir,
        entryTs: now, entryPx, initQty,
        totalQty: initQty, totalCost: PYR.ENTRY_USD, totalFee: fee0,
        adds: 0, addsStrong: 0, lastAddTs: now, closed: false,
        strong: pat0.score >= 3
      };
      pyramids.set(pid, p);
      pyrActive.set(key, pid);
      pyrBarMark(inst, tf.id, now);               // 占用本根K线事件槽
      /* 买多 / 卖空 入事件表（开仓即 0.1 美金），附形态说明 */
      recordPyrEvent(p, dir > 0 ? 'buy' : 'sell', now, +entryPx.toFixed(6),
        +initQty.toFixed(8), +PYR.ENTRY_USD.toFixed(6), 0, -fee0,
        'MACD零轴翻转' + (pat0.tags.length ? ' + ' + pat0.tags.join('+') + '（形态分' + pat0.score + '）' : ''));
      openDirty = true;
    }
  }

  /* ---- 3) 持仓状态增量落库（重启不丢未平仓金字塔）---- */
  if (openDirty) persistOpen();
}

