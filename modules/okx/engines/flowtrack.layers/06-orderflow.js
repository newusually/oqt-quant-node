/* 06-orderflow.js — 诊断层：盘口指标 / 分钟价格桶（不参与买卖）
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
/* ============================== 盘口指标 / 分钟价格桶（仅诊断，不参与买卖） ============================== */
function takerRatio(inst, now) {
  const t = taker.get(inst);
  if (!t) return { r: 0, buy: 0, sell: 0 };
  const cutoff = now - CFG.TAKER_BUCKETS * CFG.SCAN_MS;
  let buy = 0, sell = 0;
  for (const b of t.b) { if (b.i * CFG.SCAN_MS >= cutoff) { buy += b.buy; sell += b.sell; } }
  const tot = buy + sell;
  return { r: tot > 0 ? (buy - sell) / tot : 0, buy, sell };
}

function imbOf(b) {
  if (!b || !b.bids.length || !b.asks.length) return 0;
  let bs = 0, as = 0;
  for (const x of b.bids) bs += +x[1] || 0;
  for (const x of b.asks) as += +x[1] || 0;
  const tot = bs + as;
  return tot > 0 ? (bs - as) / tot : 0;
}

function imbWOf(b) {
  if (!b || !b.bids.length || !b.asks.length) return 0;
  let bs = 0, as = 0;
  const d = CFG.WEIGHT_DECAY;
  for (let i = 0; i < b.bids.length; i++) bs += (+b.bids[i][1] || 0) / (1 + d * i);
  for (let i = 0; i < b.asks.length; i++) as += (+b.asks[i][1] || 0) / (1 + d * i);
  const tot = bs + as;
  return tot > 0 ? (bs - as) / tot : 0;
}

function spreadBpOf(b) {
  if (!b || !b.bids.length || !b.asks.length) return 0;
  const bid = +b.bids[0][0], ask = +b.asks[0][0];
  if (!(bid > 0) || !(ask > 0)) return 0;
  const mid = (bid + ask) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 10000 : 0;
}

/* 零波动兜底：近 20 个分钟价格桶的收益标准差 < 5bp 视为锚定标的，不参与买卖。
 *   样本不足时放行，避免服务刚启动把所有合约都挡掉。 */
function isZeroVolInst(inst) {
  const h = pxHist.get(inst);
  if (!h || !h.series || h.series.length < 20) return false;
  const s = h.series.slice(-20), rets = [];
  for (let i = 1; i < s.length; i++) {
    const a = +s[i - 1].px, b = +s[i].px;
    if (a > 0 && b > 0) rets.push(b / a - 1);
  }
  if (rets.length < 12) return false;
  const mean = rets.reduce(function (x, y) { return x + y; }, 0) / rets.length;
  const variance = rets.reduce(function (x, y) { return x + (y - mean) * (y - mean); }, 0) / rets.length;
  return Math.sqrt(variance) < 0.0005;
}

function recordPx(instId, px, ts, src) {
  if (!isFinite(px) || px <= 0) return;
  const m = Math.floor(ts / 60000);
  const isTrade = src !== 'mid';
  let h = pxHist.get(instId);
  if (!h) { h = { series: [] }; pxHist.set(instId, h); }
  const last = h.series[h.series.length - 1];
  if (last && last.m === m) {
    if (isTrade) { last.px = px; last.src = 'trade'; }
    else if (last.src !== 'trade') { last.px = px; last.src = 'mid'; }
    if (CFG.JUMP_PERSIST) persistPx(instId, m, last.px, last.src);
    /* 长期桶同步更新（同一分钟内也要更新，否则长期桶会停留在旧价） */
    let lh0 = longPxHist.get(instId);
    if (lh0) {
      const lL = lh0.series[lh0.series.length - 1];
      if (lL && lL.m === m) {
        if (isTrade) { lL.px = px; lL.src = 'trade'; }
        else if (lL.src !== 'trade') { lL.px = px; lL.src = 'mid'; }
      }
    }
    return;
  }
  h.series.push({ m: m, px: px, src: isTrade ? 'trade' : 'mid' });
  if (isTrade) jumpStat.filledTrade++; else jumpStat.filledMid++;
  /* 只保留 JUMP_HIST_MIN 分钟，够算 STEP_MIN 段 × 2 段 + 缓冲 */
  const cut = m - CFG.JUMP_HIST_MIN;
  while (h.series.length && h.series[0].m < cut) h.series.shift();
  /* 同时写入长期桶（130 分钟）*/
  let lh = longPxHist.get(instId);
  if (!lh) { lh = { series: [] }; longPxHist.set(instId, lh); }
  const lLast = lh.series[lh.series.length - 1];
  if (lLast && lLast.m === m) {
    if (isTrade) { lLast.px = px; lLast.src = 'trade'; }
    else if (lLast.src !== 'trade') { lLast.px = px; lLast.src = 'mid'; }
  } else {
    lh.series.push({ m: m, px: px, src: isTrade ? 'trade' : 'mid' });
    const lCut = m - CFG.JUMP_HIST_MIN_LONG;
    while (lh.series.length && lh.series[0].m < lCut) lh.series.shift();
  }
  /* 落库（供重启后回填） */
  if (CFG.JUMP_PERSIST) persistPx(instId, m, px, isTrade ? 'trade' : 'mid');
}

/* ★把分钟价格桶写入 px_hist 表（幂等：同 (inst,m) 用 UPSERT 更新价格）
 *   写入走内存缓冲 + 定时批量 flush，避免高频成交时每次都同步落盘造成 I/O 抖动。 */
function persistPx(instId, m, px, src) {
  if (!db) return;
  try {
    if (!pxIns) {
      db.exec(`CREATE TABLE IF NOT EXISTS px_hist(
        inst_id TEXT, m INTEGER, px REAL, src TEXT,
        PRIMARY KEY(inst_id, m))`);
      /* ★条件 UPSERT：保持"成交价优先"优先级，避免中价补齐把成交价冲掉。
       *   规则：新值是成交价 → 总是覆盖；新值是中价 → 仅当旧值也是中价才覆盖。 */
      pxIns = db.prepare('INSERT INTO px_hist(inst_id,m,px,src) VALUES(?,?,?,?) ' +
        'ON CONFLICT(inst_id,m) DO UPDATE SET px=excluded.px, src=excluded.src ' +
        "WHERE excluded.src='trade' OR px_hist.src!='trade'");
    }
    /* src 标记：'trade'=成交价 'mid'=盘口中价。回填时按此还原优先级
     *   同样遵循"成交价优先"：中价不覆盖已缓冲的成交价 */
    const k = instId + '|' + m;
    const prev = pxBuf.get(k);
    const isMid = (src === 'mid');
    if (!prev || !isMid || prev[3] !== 'trade') {
      pxBuf.set(k, [instId, m, px, isMid ? 'mid' : 'trade']);
    }
    jumpStat.persisted++;
  } catch (e) { /* 落库失败不阻断行情链路 */ }
}

/* ★批量把 pxBuf 中的分钟价格桶落库（由 flush 定时调用） */
function flushPx() {
  if (!db || !pxIns || !pxBuf.size) return;
  const rows = Array.from(pxBuf.values());
  pxBuf.clear();
  try {
    db.exec('BEGIN');
    for (const r of rows) {
      try { pxIns.run(r[0], r[1], r[2], r[3]); } catch (e) { }
    }
    db.exec('COMMIT');
  } catch (e) { /* 落库失败不阻断行情链路 */ }
}

/* ★启动时从 px_hist 回填最近 JUMP_HIST_MIN 分钟的价格桶 → 消除重启空窗 */
function restorePx() {
  if (!db || !CFG.JUMP_PERSIST) return;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS px_hist(
      inst_id TEXT, m INTEGER, px REAL, src TEXT,
      PRIMARY KEY(inst_id, m))`);
    const cut = Math.floor(Date.now() / 60000) - CFG.JUMP_HIST_MIN_LONG;
    const rows = db.prepare('SELECT inst_id, m, px, src FROM px_hist WHERE m >= ?').all(cut);
    for (const r of rows) {
      if (!(+r.px > 0)) continue;
      let src = r.src;
      if (src === 'mid' || src === 'm' || src === 'x') src = 'mid';
      else src = 'trade';
      let h = pxHist.get(r.inst_id);
      if (!h) { h = { series: [] }; pxHist.set(r.inst_id, h); }
      h.series.push({ m: +r.m, px: +r.px, src: src });
      /* 同时回填长期桶 */
      let lh = longPxHist.get(r.inst_id);
      if (!lh) { lh = { series: [] }; longPxHist.set(r.inst_id, lh); }
      lh.series.push({ m: +r.m, px: +r.px, src: src });
    }
    const nowM = Math.floor(Date.now() / 60000);
    for (const [, h] of pxHist) {
      h.series.sort((a, b) => a.m - b.m);
      const c = nowM - CFG.JUMP_HIST_MIN;
      while (h.series.length && h.series[0].m < c) h.series.shift();
    }
    for (const [, lh] of longPxHist) lh.series.sort((a, b) => a.m - b.m);
    jumpStat.restored = rows.length;
    console.log(`[ft] 跃迁价格历史回填: ${rows.length} 个分钟桶 / ${pxHist.size} 合约`);
  } catch (e) { console.error('[ft] 跃迁价格历史回填失败:', e.message); }
}

function jumpCalc(series, step, TH) {
  const out = { dir: 0, chgA: 0, chgB: 0, state: 'flat', ready: false };
  if (!series || series.length < 3) return out;
  const s = series;
  const lastM = s[s.length - 1].m;
  if (lastM - s[0].m < step * 2) return out;      // 跨度不足
  const pxAt = (targetM) => {
    for (let i = s.length - 1; i >= 0; i--) if (s[i].m <= targetM) return s[i].px;
    return 0;
  };
  const b1 = pxAt(lastM);                  // 最新价
  const b0 = pxAt(lastM - step);           // 一段前
  const a0 = pxAt(lastM - step * 2);       // 两段前
  if (!(b0 > 0) || !(a0 > 0)) return out;
  out.chgB = (b1 - b0) / b0 * 10000;
  out.chgA = (b0 - a0) / a0 * 10000;
  out.ready = true;
  if (out.chgA <= -TH && out.chgB >= TH) { out.dir = 1; out.state = 'rev'; }
  else if (out.chgA >= TH && out.chgB <= -TH) { out.dir = -1; out.state = 'rev'; }
  else if (out.chgB >= TH) out.state = 'up';
  else if (out.chgB <= -TH) out.state = 'down';
  else out.state = 'flat';
  return out;
}

function jumpState(instId) {
  const h = pxHist.get(instId);
  const step = CFG.JUMP_STEP_MIN;
  const out = { dir: 0, dir2: 0, mom: 0, chgA: 0, chgB: 0, state: 'flat',
    dir1h: 0, chgA1h: 0, chgB1h: 0, state1h: 'flat' };
  jumpStat.scanned++;
  if (!h || !h.series.length) { jumpStat.nohist++; jumpStat.nohist_none++; return out; }
  const s = h.series;
  const lastM = s[s.length - 1].m;
  if (s.length > jumpStat.maxSeriesLen) jumpStat.maxSeriesLen = s.length;
  const span = lastM - s[0].m;
  if (span > jumpStat.maxSpanMin) jumpStat.maxSpanMin = span;
  /* 桶数不足 → 数据未就绪（需要至少 3 个分钟桶） */
  if (s.length < CFG.JUMP_MIN_BUCKETS) { jumpStat.nohist++; jumpStat.nohist_short++; return out; }
  /* 跨度不足 → 需要覆盖完整的两段 STEP_MIN */
  if (span < CFG.JUMP_MIN_SPAN_MIN) { jumpStat.nohist++; jumpStat.nohist_span++; return out; }

  /* ---- 5 分钟尺度（严档 30bp / 宽松档 60bp）---- */
  const c5 = jumpCalc(s, step, CFG.JUMP_BP);
  if (!c5.ready) { jumpStat.nohist++; jumpStat.nohist_px++; return out; }
  out.chgA = c5.chgA; out.chgB = c5.chgB; out.dir = c5.dir; out.state = c5.state;
  const c5b = jumpCalc(s, step, CFG.JUMP_BP2);
  out.dir2 = c5b.dir;
  if (c5.chgB >= CFG.JUMP_MOM_THR) out.mom = 1;
  else if (c5.chgB <= -CFG.JUMP_MOM_THR) out.mom = -1;
  if (out.mom !== 0) jumpStat.mom++;


  /* 状态分布统计 */
  jumpStat[out.state] = (jumpStat[out.state] || 0) + 1;
  const mx = Math.max(Math.abs(out.chgA), Math.abs(out.chgB));
  if (mx > jumpStat.maxChgBp) jumpStat.maxChgBp = mx;
  return out;
}


/* 记录一笔金字塔事件（买多/卖空/加仓/平仓），先入 pendingPyr，flush 批量落库 */
