/* 11-start.js — 启动层：SSE 推送 / 定时器装配 / 导出
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
/* ============================== SSE 实时推送 ==============================
 * 用户要求「ajax 实时，不要手动刷新」→ 由 server 的 /api/okx/flowtrack/stream
 * 建立 EventSource 长连接，引擎每次落库/结算后主动推一帧统计，浏览器零轮询。 */
const listeners = new Set();

function subscribe(fn) {
  listeners.add(fn);
  try { fn(JSON.stringify(stats())); } catch (e) { }
  return function () { listeners.delete(fn); };
}

function broadcast() {
  if (!listeners.size) return;
  let payload;
  try { payload = JSON.stringify(stats()); } catch (e) { return; }
  for (const fn of Array.from(listeners)) {
    try { fn(payload); } catch (e) { listeners.delete(fn); }
  }
}

/* ============================== 启动 ============================== */
async function start() {
  if (started) return;
  started = true;
  try { initDb(); } catch (e) { console.error('[ft] 数据库初始化失败:', e.message); return; }
  if (!startedAt) { startedAt = Date.now(); metaSet('startedAt', startedAt); }
  endAt = CFG.RUN_MS > 0 ? startedAt + CFG.RUN_MS : 0;
  lastSettleAt = startedAt;
  try { totalTrades = db.prepare('SELECT COUNT(*) c FROM trades').get().c; } catch (e) { }
  console.log(`[ft] 引擎启动 · 独立库 ${CFG.DB_FILE} · 已有明细 ${totalTrades} 笔`);

  universe.push(...await loadUniverse());
  if (!universe.length) { console.error('[ft] 合约列表为空，引擎退出'); started = false; return; }
  console.log(`[ft] 合约 ${universe.length} 个`);
  try { restoreOpen(); } catch (e) { console.error('[ft] 恢复持仓异常:', e.message); }
  try { restorePx(); } catch (e) { console.error('[ft] 恢复跃迁价格历史异常:', e.message); }
  /* ★回填同根K线事件槽（重启不绕过「同根K线只允许一次买卖/加仓」硬性规定） */
  try { restoreBarUsed(); } catch (e) { console.error('[ft] 回填K线事件槽异常:', e.message); }

  try {
    const r = await fetch(CFG.HTTP_BASE + '/api/v5/market/tickers?instType=SWAP');
    const j = await r.json();
    if (j && j.code === '0' && j.data) {
      deepList = j.data
        .filter(x => x.instType === 'SWAP' && String(x.instId || '').indexOf('-USDT-SWAP') > 0)
        .sort((a, b) => (+b.volCcy24h || 0) - (+a.volCcy24h || 0))
        .slice(0, CFG.DEEP_N).map(x => x.instId);
    }
  } catch (e) { console.error('[ft] tickers 失败:', e.message); }
  console.log(`[ft] 重点全深度合约 ${deepList.length} 个`);

  console.log('[ft] 旧 1H 大跃迁诊断刷新已停用（不参与买卖判定，无 REST 轮转请求）');
  /* MACD 入场信号：按 15m K 线边界定时运行 */
  macdQueue = universe.slice(0, CFG.MACD_INST_MAX);
  const estSec = Math.round(macdQueue.length / CFG.MACD_CONCURRENCY * CFG.MACD_TICK_MS / 1000);
  console.log(`[ft] MACD(${CFG.MACD_FAST},${CFG.MACD_SLOW},${CFG.MACD_SIGNAL}) 定时刷新: ${macdQueue.length} 个合约；` +
    `★只 15m，每15分钟(:00/:15/:30/:45) 按K线边界跑一次全市场（约 ${estSec} 秒）`);
  console.log(`[ft] 数据保留：自 ${new Date(CFG.KEEP_FROM_TS).toISOString()} 起【永久保留】，无自动删除/VACUUM`);
  console.log(`[ft] 交易规则：买多/卖空/加仓 每笔 ${PYR.ENTRY_USD} 美金；满1小时+浮亏>${PYR.ADD_LOSS_PCT}%(亏损)+出现买卖信号(零轴翻转)同向 加仓；浮盈>${PYR.TP_PCT}% 止盈`);

  /* AI 策略文件热加载：启动读一次，之后每 30 秒检查 mtime */
  aiRead(true);
  setInterval(() => aiRead(false), 30000);

  startWs();
  setInterval(scan, CFG.SCAN_MS);
  /* 对当前这根 K 线做一次性预热，之后按边界定时触发 */
  macdSchedTick();
  setInterval(macdSchedTick, CFG.MACD_SCHED_TICK_MS);
  setInterval(flush, CFG.FLUSH_MS);
  /* 分钟价格桶单独批量落库（flush 无成交时会提前 return） */
  setInterval(flushPx, CFG.FLUSH_MS);
  setInterval(pollDeep, CFG.DEEP_POLL_MS);
  setInterval(settle, CFG.SETTLE_MS);
  /* ★实时持仓曲线采样：每 30 秒落一次当前所有未平仓金字塔的实时净浮盈 USD */
  try { recordEquity(); } catch (e) { }
  setInterval(recordEquity, CFG.EQUITY_MS);
  /* 兜底心跳：无新成交时每 10 秒推一帧 */
  setInterval(broadcast, 10000);
  /* 永久保留：仅每 30 分钟做一次 WAL checkpoint，不丢任何数据。 */
  setInterval(walCheckpointOnly, 30 * 60 * 1000);
  setInterval(() => {
    if (CFG.RUN_MS > 0 && Date.now() >= endAt && ws.conns.length) {
      console.log('[ft] 观察期结束，停止采集');
      for (const c of ws.conns) { try { if (c && c.ping) clearInterval(c.ping); c.sock.close(); } catch (e) { } }
      ws.conns = [];
      flush();
    }
  }, 60000);
}

module.exports = {
  start, stats, settle, subscribe,
  jumpHistory, jumpInsts, jumpTradesByInst,   // 保留旧路由名（委托到金字塔）
  pyrSummary: pyrSummaryCalc, pyrInsts, pyrTrades, pyrMarks, pyrAll, pyrPositions,
  aiStrategy, aiRead, curve, equityCurve, recordEquity,   // AI 策略面板 / 曲线数据
  STABLE_BASES
};

