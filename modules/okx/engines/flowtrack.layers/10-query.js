/* 10-query.js — 查询层：统计 / 分页明细 / 持仓 / stats
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
/* ============================== 金字塔统计与查询 ============================== */
/* 总结面板核心数据：总模拟盈利(已实现净USD) / 仓位USD(未平仓投入) / 持有USD(未平仓市值) / 亏损USD(未平仓浮亏) */
function pyrSummaryCalc() {
  const byTf = {};
  for (const tf of PYR.TFS) byTf[tf.id] = { open: 0, closed: 0, profitUSD: 0, positionUSD: 0, holdingUSD: 0, lossUSD: 0 };
  const eventCounts = { buy: 0, sell: 0, add: 0, close: 0 };
  let totalProfitUSD = 0, positionUSD = 0, holdingUSD = 0, lossUSD = 0, openCount = 0, closedCount = 0;
  if (db) {
    const evRows = db.prepare('SELECT event, COUNT(*) c FROM pyr GROUP BY event').all();
    for (const r of evRows) eventCounts[r.event] = r.c;
    const cl = db.prepare("SELECT tf, net_bp FROM pyr WHERE event='close'").all();
    for (const r of cl) {
      closedCount++;
      totalProfitUSD += (+r.net_bp || 0);
      const t = byTf[r.tf]; if (t) { t.closed++; t.profitUSD += (+r.net_bp || 0); }
    }
  }
  for (const [, p] of pyramids) {
    if (p.closed) continue;
    openCount++;
    positionUSD += p.totalCost;
    const b = books.get(p.instId);
    const px = b && b.bids.length && b.asks.length ? (p.dir > 0 ? +b.bids[0][0] : +b.asks[0][0]) : p.entryPx;
    const avg = p.totalCost / p.totalQty;
    const grossU = p.dir * (px - avg) * p.totalQty;
    const netU = grossU - p.totalFee;
    holdingUSD += p.totalQty * px;
    if (netU < 0) lossUSD += (-netU);
    const t = byTf[p.tf]; if (t) { t.open++; t.positionUSD += p.totalCost; t.holdingUSD += p.totalQty * px; if (netU < 0) t.lossUSD += (-netU); }
  }
  return {
    totalProfitUSD: +totalProfitUSD.toFixed(6), positionUSD: +positionUSD.toFixed(6),
    holdingUSD: +holdingUSD.toFixed(6), lossUSD: +lossUSD.toFixed(6),
    openCount, closedCount, eventCounts, byTf
  };
}

/* 合约榜：按金字塔事件数排序（供 K 线标记 + 明细表 + 合约下拉） */
function pyrInsts(limit) {
  if (!db) return { ok: false, err: '数据库未初始化' };
  limit = Math.max(1, Math.min(200, parseInt(limit || 50, 10) || 50));
  const rows = db.prepare(
    `SELECT inst_id inst, COUNT(*) n,
        SUM(CASE WHEN event='close' THEN net_bp ELSE 0 END) net,
        SUM(CASE WHEN event='buy' OR event='sell' THEN 1 ELSE 0 END) opens,
        SUM(CASE WHEN event='add' THEN 1 ELSE 0 END) adds,
        SUM(CASE WHEN event='close' THEN 1 ELSE 0 END) closes
     FROM pyr WHERE ${STABLE_EXCL} GROUP BY inst_id ORDER BY n DESC LIMIT ?`).all(limit);
  return { ok: true, insts: rows };
}

/* ★行级富化：补充「开仓价格 entryPx」与「浮盈浮亏% unrealPct」。
 *   - 未平仓：从内存 pyramids 直接取实时 entryPx 与实时浮亏%（净浮盈/总投入）。
 *   - 已平仓：从 pyr 表取该 pid 的平仓净USD与成本，反推已实现%（开仓价取首笔买多/卖空事件价）。
 *   每页最多 15 个 pid，额外 2 条查询，开销极小。 */
function pyrEnrich(rows) {
  if (!rows || !rows.length) return;
  const openMap = {};
  for (const [, p] of pyramids) if (!p.closed) openMap[p.pid] = p;
  const pids = rows.map(r => r.pid).filter(Boolean);
  const closeMap = {};
  if (pids.length && db) {
    const ph = pids.map(() => '?').join(',');
    const cls = db.prepare(`SELECT pid, net_bp, cost, qty, px FROM pyr WHERE event='close' AND pid IN (${ph})`).all(...pids);
    for (const c of cls) closeMap[c.pid] = c;
    const ops = db.prepare(`SELECT pid, px FROM pyr WHERE event IN ('buy','sell') AND pid IN (${ph}) ORDER BY ts ASC`).all(...pids);
    for (const o of ops) if (closeMap[o.pid] && closeMap[o.pid]._openPx == null) closeMap[o.pid]._openPx = +o.px;
  }
  for (const r of rows) {
    const op = openMap[r.pid];
    if (op) {
      const b = books.get(op.instId);
      const px = b && b.bids.length && b.asks.length ? (op.dir > 0 ? +b.bids[0][0] : +b.asks[0][0]) : op.entryPx;
      const avg = op.totalCost / op.totalQty;
      const gU = op.dir * (px - avg) * op.totalQty;
      const nU = gU - op.totalFee;
      r.entryPx = +op.entryPx.toFixed(6);
      r.unrealPct = op.totalCost > 0 ? +(nU / op.totalCost * 100).toFixed(2) : 0;
    } else if (closeMap[r.pid]) {
      const c = closeMap[r.pid];
      const cost = +c.cost || 0;
      r.entryPx = c._openPx != null ? +c._openPx.toFixed(6) : (cost > 0 && +c.qty > 0 ? +(cost / +c.qty).toFixed(6) : 0);
      r.unrealPct = cost > 0 ? +((+c.net_bp || 0) / cost * 100).toFixed(2) : 0;
    } else {
      r.entryPx = null; r.unrealPct = null;
    }
  }
}

/* 某合约的金字塔事件（买多/卖空/加仓/平仓）：marks=1 返回全部供 K线叠加，否则分页供明细表 */
function pyrTrades(inst, page, marks) {
  if (!db) return { ok: false, err: '数据库未初始化' };
  if (!inst) return { ok: false, err: 'inst required' };
  inst = String(inst).toUpperCase();
  const where = `inst_id=? AND ${STABLE_EXCL}`;
  const toRow = function (r) {
    return {
      id: r.id, ts: r.ts, pid: r.pid, inst: r.inst_id, tf: r.tf,
      dir: r.dir > 0 ? '多' : '空',
      event: r.event,
      eventLabel: pyrEventLabel(r),
      px: +(+r.px).toFixed(6), qty: +(+r.qty).toFixed(8),
      cost: +(+r.cost).toFixed(6),
      unreal: r.unreal == null ? null : +(+r.unreal).toFixed(6),
      netBp: r.net_bp == null ? null : +(+r.net_bp).toFixed(6),
      note: r.note || ''
    };
  };
  if (marks) {
    const rows = db.prepare(
      `SELECT id, ts, pid, inst_id, tf, dir, event, px, qty, cost, unreal, net_bp, note
       FROM pyr WHERE ${where} ORDER BY ts ASC LIMIT 4000`).all(inst);
    return { ok: true, inst: inst, marks: true, count: rows.length, rows: rows.map(toRow) };
  }
  const PER = 15; page = Math.max(1, parseInt(page || 1, 10) || 1);
  const total = (db.prepare(`SELECT COUNT(*) c FROM pyr WHERE ${where}`).get(inst) || {}).c || 0;
  const totalPages = Math.max(1, Math.ceil(total / PER));
  page = Math.min(page, totalPages);
  const off = (page - 1) * PER;
  const rows = db.prepare(
    `SELECT id, ts, pid, inst_id, tf, dir, event, px, qty, cost, unreal, net_bp, note
     FROM pyr WHERE ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(inst, PER, off);
  const sum = db.prepare(
    `SELECT COUNT(*) n,
        SUM(CASE WHEN event='close' THEN net_bp ELSE 0 END) net,
        SUM(CASE WHEN event='buy' OR event='sell' THEN 1 ELSE 0 END) opens
     FROM pyr WHERE ${where}`).get(inst) || { n: 0, net: 0, opens: 0 };
  const mapped = rows.map(toRow);
  pyrEnrich(mapped);
  return {
    ok: true, inst: inst, page: page, per: PER, total: total, totalPages: totalPages,
    summary: { n: sum.n, netBp: +(+sum.net).toFixed(1), opens: sum.opens },
    rows: mapped
  };
}

/* K线叠加标记：返回某合约（可选指定周期）的全部金字塔事件（买多/卖空/加仓/平仓） */
function pyrMarks(inst, tf) {
  if (!db) return { ok: false, err: '数据库未初始化' };
  if (!inst) return { ok: false, err: 'inst required' };
  inst = String(inst).toUpperCase();
  const where = tf ? `inst_id=? AND tf=? AND ${STABLE_EXCL}` : `inst_id=? AND ${STABLE_EXCL}`;
  const stmt = db.prepare(
    `SELECT ts, inst_id, tf, dir, event, px FROM pyr WHERE ${where} ORDER BY ts ASC LIMIT 6000`);
  const rows = tf ? stmt.all(inst, tf) : stmt.all(inst);
  return { ok: true, inst: inst, tf: tf || '', count: rows.length, rows: rows };
}

/* 所有合约未平仓持仓（分页）：实时以盘口价重估浮盈/净浮盈，全部以美金计，无 bp */
function pyrPositions(page, tf, ev) {
  if (!db) return { ok: false, err: '数据库未初始化' };
  const PER = 15;
  page = Math.max(1, parseInt(page || 1, 10) || 1);
  const all = [];
  for (const [, p] of pyramids) {
    if (p.closed) continue;
    const b = books.get(p.instId);
    const px = b && b.bids.length && b.asks.length ? (p.dir > 0 ? +b.bids[0][0] : +b.asks[0][0]) : p.entryPx;
    const avg = p.totalCost / p.totalQty;
    const grossU = p.dir * (px - avg) * p.totalQty;
    const netU = grossU - p.totalFee;
    all.push({
      pid: p.pid, inst: p.instId, tf: p.tf, dir: p.dir > 0 ? '多' : '空',
      entryPx: +p.entryPx.toFixed(6), avgPx: +avg.toFixed(6),
      px: +px.toFixed(6),
      totalQty: +p.totalQty.toFixed(8), totalCost: +p.totalCost.toFixed(6),
      adds: p.adds, unrealGross: +grossU.toFixed(6), netUnreal: +netU.toFixed(6),
      unrealPct: p.totalCost > 0 ? +(netU / p.totalCost * 100).toFixed(2) : 0,
      holdingUSD: +(p.totalQty * px).toFixed(6),
      underwater: (p.dir > 0 ? px < avg : px > avg),
      entryTs: p.entryTs, lastAddTs: p.lastAddTs
    });
  }
  /* ★周期 / 事件(方向 + 加仓) 筛选全部在后端做，分页按筛选后的总数计算 */
  const t = String(tf || '').toLowerCase(), e = String(ev || '').toLowerCase();
  const filtered = all.filter(function (p) {
    if ((t === '15m' || t === '30m' || t === '1h') && p.tf !== t) return false;
    if (e === 'buy' || e === 'long') { if (p.dir !== '多') return false; }
    else if (e === 'sell' || e === 'short') { if (p.dir !== '空') return false; }
    else if (e === 'add' || e === 'add_long' || e === 'add_short') {
      if (!(p.adds > 0)) return false;               // 只显示真正发生过加仓的持仓
      if (e === 'add_long' && p.dir !== '多') return false;
      if (e === 'add_short' && p.dir !== '空') return false;
    } else if (e === 'close') return false;          // 持仓面板没有「平仓」状态
    return true;
  });
  /* ★最新在前：开仓时间倒序，同秒按最后加仓时间倒序 */
  filtered.sort((a, b) => b.entryTs - a.entryTs || b.lastAddTs - a.lastAddTs);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PER));
  page = Math.min(page, totalPages);
  const off = (page - 1) * PER;
  const rows = filtered.slice(off, off + PER);
  let sumProfit = 0, sumCost = 0, sumHolding = 0, sumLoss = 0, under = 0;
  for (const p of filtered) {
    sumProfit += p.netUnreal; sumCost += p.totalCost; sumHolding += p.holdingUSD;
    if (p.netUnreal < 0) sumLoss += (-p.netUnreal);
    if (p.underwater) under++;
  }
  return {
    ok: true, page, per: PER, total, totalPages, tf: t, ev: e,
    summary: {
      count: total, profitUSD: +sumProfit.toFixed(6), costUSD: +sumCost.toFixed(6),
      holdingUSD: +sumHolding.toFixed(6), lossUSD: +sumLoss.toFixed(6), underwater: under
    },
    rows
  };
}

/* ★周期 + 事件筛选条件（SQL 片段 + 位置参数）：所有列表共用，
 *   保证「分页总数 / 页脚统计」都按筛选后的集合计算，而不是先取 15 行再前端 filter。 */
function pyrFilterSql(tf, ev) {
  const parts = [STABLE_EXCL], args = [];
  const t = String(tf || '').toLowerCase();
  if (t === '15m' || t === '30m' || t === '1h') { parts.push('tf=?'); args.push(t); }
  const e = String(ev || '').toLowerCase();
  if (e === 'buy' || e === 'sell' || e === 'close' || e === 'add') { parts.push('event=?'); args.push(e); }
  else if (e === 'add_long') parts.push("event='add' AND dir>0");
  else if (e === 'add_short') parts.push("event='add' AND dir<0");
  return { where: parts.join(' AND '), args, tf: t, ev: e };
}

/* 全部金字塔事件分页（15 行/页、最新在前；周期 + 事件类型后端筛选） */
function pyrAll(page, sort, order, tf, ev) {
  if (!db) return { ok: false, err: '数据库未初始化' };
  const PER = 15; page = Math.max(1, parseInt(page || 1, 10) || 1);
  let orderBy = 'id DESC';                       // ★默认最新在前
  if (sort === 'net') orderBy = (order === 'asc') ? 'net_bp ASC' : 'net_bp DESC';
  const f = pyrFilterSql(tf, ev);
  const where = f.where;
  const total = (db.prepare(`SELECT COUNT(*) c FROM pyr WHERE ${where}`).get(...f.args) || {}).c || 0;
  const totalPages = Math.max(1, Math.ceil(total / PER));
  page = Math.min(page, totalPages);
  const off = (page - 1) * PER;
  const rows = db.prepare(
    `SELECT id, ts, pid, inst_id, tf, dir, event, px, qty, cost, unreal, net_bp, note
     FROM pyr WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...f.args, PER, off);
  const sum = db.prepare(
    `SELECT COUNT(*) n,
        SUM(CASE WHEN event='close' THEN net_bp ELSE 0 END) net,
        SUM(CASE WHEN event='buy' OR event='sell' THEN 1 ELSE 0 END) opens,
        SUM(CASE WHEN event='add' THEN 1 ELSE 0 END) adds,
        SUM(CASE WHEN event='add' AND dir>0 THEN 1 ELSE 0 END) addLong,
        SUM(CASE WHEN event='add' AND dir<0 THEN 1 ELSE 0 END) addShort,
        SUM(CASE WHEN event='close' THEN 1 ELSE 0 END) closes
     FROM pyr WHERE ${where}`).get(...f.args) || { n: 0, net: 0, opens: 0, adds: 0, addLong: 0, addShort: 0, closes: 0 };
  const list = rows.map(r => ({
    id: r.id, ts: r.ts, pid: r.pid, inst: r.inst_id, tf: r.tf, dir: r.dir > 0 ? '多' : '空',
    event: r.event, eventLabel: pyrEventLabel(r),
    px: +(+r.px).toFixed(6), qty: +(+r.qty).toFixed(8), cost: +(+r.cost).toFixed(6),
    unreal: r.unreal == null ? null : +(+r.unreal).toFixed(6),
    netBp: r.net_bp == null ? null : +(+r.net_bp).toFixed(6),
    note: r.note || ''
  }));
  pyrEnrich(list);
  return {
    ok: true, page, per: PER, total, totalPages, sort: sort || '', order: order || '',
    tf: f.tf, ev: f.ev,
    summary: {
      n: sum.n, netBp: +(+sum.net).toFixed(1), opens: sum.opens || 0,
      adds: sum.adds || 0, addLong: sum.addLong || 0, addShort: sum.addShort || 0,
      closes: sum.closes || 0
    },
    rows: list
  };
}

/* 保留旧路由名（/api/okx/flowtrack_jumphist 等），委托到金字塔数据，避免前端断链 */
function jumpInsts(limit) { return pyrInsts(limit); }
function jumpTradesByInst(inst, page, marks) { return pyrTrades(inst, page, marks); }
function jumpHistory(cat, page, sort, order) { return pyrAll(page, sort, order); }

function stats() {
  if (!db) return { ok: false, err: '数据库未初始化' };
  if (statCache.data && Date.now() - statCache.at < 3000) return statCache.data;
  const now = Date.now();
  const summary = pyrSummaryCalc();
  /* ★未平仓金字塔明细（实时估值，含均价/浮盈/是否水下/持有市值） */
  const open = [];
  for (const [, p] of pyramids) {
    if (p.closed) continue;
    const b = books.get(p.instId);
    const px = b && b.bids.length && b.asks.length ? (p.dir > 0 ? +b.bids[0][0] : +b.asks[0][0]) : p.entryPx;
    const avg = p.totalCost / p.totalQty;
    const grossU = p.dir * (px - avg) * p.totalQty;
    const netU = grossU - p.totalFee;
    open.push({
      pid: p.pid, inst: p.instId, tf: p.tf, dir: p.dir > 0 ? '多' : '空',
      entryPx: +p.entryPx.toFixed(6), avgPx: +avg.toFixed(6),
      px: +px.toFixed(6),
      totalQty: +p.totalQty.toFixed(8), totalCost: +p.totalCost.toFixed(6),
      adds: p.adds, unrealGross: +grossU.toFixed(6), netUnreal: +netU.toFixed(6),
      unrealPct: p.totalCost > 0 ? +(netU / p.totalCost * 100).toFixed(2) : 0,
      holdingUSD: +(p.totalQty * px).toFixed(6),
      underwater: (p.dir > 0 ? px < avg : px > avg),
      entryTs: p.entryTs, lastAddTs: p.lastAddTs
    });
  }
  const recent = db.prepare('SELECT * FROM pyr ORDER BY id DESC LIMIT 120').all()
    .map(r => ({
      id: r.id, ts: r.ts, inst: r.inst_id, tf: r.tf, dir: r.dir > 0 ? '多' : '空',
      event: r.event, eventLabel: pyrEventLabel(r),
      px: +(+r.px).toFixed(6), qty: +(+r.qty).toFixed(8), cost: +(+r.cost).toFixed(6),
      unreal: r.unreal == null ? null : +(+r.unreal).toFixed(6),
      netBp: r.net_bp == null ? null : +(+r.net_bp).toFixed(6)
    }));
  const snaps = db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT 40').all().reverse();
  const out = {
    ok: true, at: now,
    startedAt, uptimeSec: startedAt ? Math.round((now - startedAt) / 1000) : 0,
    cfg: {
      feeBp: PYR.FEE_BP, entryUsd: PYR.ENTRY_USD, addUsd: PYR.ADD_USD,
      tpPct: PYR.TP_PCT,
      addLossPct: PYR.ADD_LOSS_PCT,
      addIntervalMs: PYR.ADD_INTERVAL_MS, addIntervalMin: PYR.ADD_INTERVAL_MS / 60000,
      addRule: '两级加仓：①强信号（孔雀开屏/倒孔雀开屏·MA5上穿全部均线、V反转/倒V、W双底/M头、放量、MACD加速，形态分≥' +
        PYR.STRONG_MIN_SCORE + '）→ 加仓 ' + PYR.ADD_USD + 'U ×2~5倍，间隔 ' +
        (PYR.ADD_STRONG_INTERVAL_MS / 60000) + ' 分钟，允许浮盈加仓；上限：强加仓 ≤' + PYR.ADD_STRONG_MAX +
        ' 次、总投入 ≤' + PYR.MAX_EXPO_USD + 'U、浮盈达止盈目标 ' + PYR.ADD_STRONG_PROFIT_STOP + '% 停加；' +
        '②浮亏加仓（原口径）：满 1 小时 + 浮亏>' + PYR.ADD_LOSS_PCT + '% + MACD 柱同向 → ' + PYR.ADD_USD + 'U。同根K线只允许一次买多/卖空/加仓',
      strongAdd: {
        minScore: PYR.STRONG_MIN_SCORE, intervalMin: PYR.ADD_STRONG_INTERVAL_MS / 60000,
        maxTimes: PYR.ADD_STRONG_MAX, maxExpoUsd: PYR.MAX_EXPO_USD,
        profitStopPct: PYR.ADD_STRONG_PROFIT_STOP, tpPctStrong: PYR.TP_PCT_STRONG,
        patterns: ['孔雀开屏', '倒孔雀开屏', '多头排列', '空头排列', 'V反转', '倒V反转', 'W双底突破', 'M头破位', '放量', 'MACD加速'],
        multTable: { 2: 2, 3: 2.5, 4: 3, 5: 4, 6: 5 }
      },
      entryRule: 'MACD(12,26,60) 柱：当前>0 且之前连续≥20根<0 → 买多；当前<0 且之前连续≥20根>0 → 卖空（★只 15m，按K线边界每15分钟定时判定）',
      keepForever: CFG.KEEP_FOREVER, keepFromTs: CFG.KEEP_FROM_TS,
      keepFrom: new Date(CFG.KEEP_FROM_TS).toISOString(),
      ai: { locked: AI_LOCKED, applied: aiCache.applied, error: aiCache.error,
            lastGenerated: aiCache.data ? (aiCache.data.generatedAt || null) : null },
      macd: {
        fast: CFG.MACD_FAST, slow: CFG.MACD_SLOW, signal: CFG.MACD_SIGNAL,
        minPrev: CFG.MACD_MIN_PREV, bars: CFG.MACD_BARS,
        cached: macdCache.size, stat: { ...macdStat },
        schedMode: '只 15m：每 15 分钟（:00/:15/:30/:45）按K线边界定时刷新一次全市场 MACD',
        tickMs: CFG.MACD_SCHED_TICK_MS, concurrency: CFG.MACD_CONCURRENCY,
        batchGapMs: CFG.MACD_TICK_MS, bootDelayMs: CFG.MACD_BOOT_DELAY_MS,
        pending: macdJobs.length,
        schedule: PYR.TFS.map(tf => {
          const s = macdSched[tf.id] || {};
          return {
            tf: tf.id, intervalMs: tf.step * 60000,
            boundary: tf.step === 15 ? ':00/:15/:30/:45' : tf.step === 30 ? ':00/:30' : '整点',
            lastBar: s.lastBar || 0, lastStart: s.startedAt || 0, lastFinish: s.finishedAt || 0,
            queued: s.queued || 0, done: s.done || 0,
            nextBar: pyrBarStart(tf.id, now) + tf.step * 60000,
            pending: macdJobs.filter(j => j.tf.id === tf.id).length
          };
        })
      },
      tfs: PYR.TFS.map(t => t.id), scanMs: CFG.SCAN_MS
    },
    ws: {
      conns: ws.conns.length, alive: ws.conns.filter(c => c && c.alive).length,
      subs: ws.subs, msgs: ws.msgs, err: ws.err, reconnect: ws.reconnect,
      booksCovered: books.size, tradeCovered: taker.size
    },
    universe: { count: universe.length },
    jumpStat: {
      rev: jumpStat.rev || 0, rev1h: jumpStat.rev1h || 0,
      longPxInstruments: longPxHist.size, hourPxInstruments: 0,
      nohist: jumpStat.nohist || 0, nohist1h: jumpStat.nohist1h || 0
    },
    /* ★总结面板：总模拟盈利 / 仓位USD / 持有USD / 亏损USD */
    summary,
    open,
    curve: curve(),
    equity: equityCurve(),
    recent,
    snapshots: snaps
  };
  statCache = { at: now, data: out };
  return out;
}

