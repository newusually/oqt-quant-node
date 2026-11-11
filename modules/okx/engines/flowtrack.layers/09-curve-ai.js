/* 09-curve-ai.js — 曲线层：逐笔盈利曲线 + AI 策略热加载
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
/* ============================== 盈利曲线（逐笔平仓点） ==============================
 * 每点 = 一笔止盈平仓；cum/net 为累计已实现净 USD。
 * tpPx = 成本均价 ×(1 ± TP_PCT%)，tpUsd = 总投入 × TP_PCT%。 */
function curve() {
  if (!db) return [];
  const rows = db.prepare(`SELECT id, ts, inst_id, dir, px, qty, cost, unreal, net_bp, pid
    FROM pyr WHERE event='close' ORDER BY ts ASC, id ASC`).all();
  let cn = 0, cg = 0;
  return rows.map(r => {
    const profit = +r.net_bp || 0, gross = +r.unreal || 0;
    cn += profit; cg += gross;
    const qty = +r.qty || 0, cost = +r.cost || 0;
    const avgPx = qty > 0 ? cost / qty : (+r.px || 0);
    const dir = +r.dir > 0 ? 1 : -1;
    const tpUsd = cost * PYR.TP_PCT / 100;
    return {
      t: r.ts, ts: r.ts, inst: r.inst_id, pid: r.pid,
      dir: dir > 0 ? '多' : '空',
      net: +cn.toFixed(6), cum: +cn.toFixed(6), profit: +profit.toFixed(6),
      gross: +cg.toFixed(6), n: 1, winRate: profit > 0 ? 100 : 0,
      exitPx: +(+r.px).toFixed(6), avgPx: +avgPx.toFixed(6),
      tpPx: +(avgPx * (1 + dir * PYR.TP_PCT / 100)).toFixed(6),
      tpUsd: +tpUsd.toFixed(6), cost: +cost.toFixed(6), qty: +qty.toFixed(8)
    };
  });
}

/* ============================== 实时持仓曲线（逐点采样） ==============================
 * 每点 = 某一采样时刻全部未平仓金字塔的【实时净浮盈 USD】（含亏损与盈利）。
 * 用于前端「实时持仓曲线」，展示持仓期间的真实盈亏走势，而非仅平仓曲线。 */
function equityCurve() {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT ts, n_open, net_unreal, holding_usd, position_usd
     FROM pyr_equity ORDER BY ts ASC, id ASC`).all();
  return rows.map(r => ({
    t: r.ts, ts: r.ts, n: r.n_open || 0,
    net: +(+r.net_unreal || 0).toFixed(6),
    gross: +(+r.net_unreal || 0).toFixed(6),
    holdingUSD: +(+r.holding_usd || 0).toFixed(6),
    positionUSD: +(+r.position_usd || 0).toFixed(6)
  }));
}

/* ============================== AI 策略面板（CodeBuddy / Hy4 每日零点回写） ==============================
 * 文件：data/ai_strategy.json（与 data/flowtrack 同级）。由服务器每日 00:00 的 CodeBuddy CLI 生成。
 * 结构：{ generatedAt, verdict, steps[], mindmap{}, metrics[], curve[], conclusions[],
 *         params{ tpPct, addLossPct, addIntervalMs }, codeChanges[], audit[] }
 * ★白名单参数热加载：每 30 秒检查文件 mtime，只接受白名单字段、做范围钳制；
 *   锁定项 ENTRY_USD / ADD_USD / TFS / KEEP_FOREVER / KEEP_FROM_TS 一律忽略（金额与周期不可被 AI 改）。
 * ★AI 改代码不在本引擎内执行，由服务器受控脚本按「node --check + 桩测试 + 备份 + 失败回滚」护栏处理。 */
const AI_FILE = path.join(__dirname, '..', '..', '..', 'data', 'ai_strategy.json');
const AI_PARAM_RULES = {
  tpPct:         { apply: v => { PYR.TP_PCT = v; },          min: 1,         max: 200 },
  addLossPct:    { apply: v => { PYR.ADD_LOSS_PCT = v; },    min: 0,         max: 200 },
  addIntervalMs: { apply: v => { PYR.ADD_INTERVAL_MS = v; }, min: 15 * 60000, max: 7 * 86400000 }
};
const AI_LOCKED = ['ENTRY_USD', 'ADD_USD', 'TFS', 'KEEP_FOREVER', 'KEEP_FROM_TS'];
const aiCache = { at: 0, mtime: 0, data: null, applied: {}, rejected: [], error: null };

function aiRead(force) {
  const now = Date.now();
  if (!force && aiCache.data && now - aiCache.at < 30000) return aiCache;
  aiCache.at = now;
  try {
    if (!fs.existsSync(AI_FILE)) { aiCache.error = '尚无 AI 策略文件（等待每日零点首次分析）'; return aiCache; }
    const st = fs.statSync(AI_FILE);
    if (aiCache.data && st.mtimeMs === aiCache.mtime) return aiCache;
    const j = JSON.parse(fs.readFileSync(AI_FILE, 'utf8'));
    aiCache.data = j; aiCache.mtime = st.mtimeMs; aiCache.error = null;
    const applied = {}, rejected = [];
    const p = (j && j.params) || {};
    for (const k of Object.keys(p)) {
      const rule = AI_PARAM_RULES[k];
      if (!rule) { rejected.push(k + '(非白名单，已忽略)'); continue; }
      const v = +p[k];
      if (!Number.isFinite(v)) { rejected.push(k + '(非数值，已忽略)'); continue; }
      const cv = Math.min(rule.max, Math.max(rule.min, v));
      rule.apply(cv); applied[k] = cv;
      if (cv !== v) rejected.push(k + '(越界，已钳制为 ' + cv + ')');
    }
    aiCache.applied = applied; aiCache.rejected = rejected;
    if (Object.keys(applied).length) console.log('[ai] 策略参数热加载:', JSON.stringify(applied));
  } catch (e) { aiCache.error = 'AI 策略文件读取失败: ' + e.message; }
  return aiCache;
}

function aiStrategy() {
  const c = aiRead(false);
  return {
    ok: true,
    filePath: AI_FILE,
    generatedAt: c.data ? (c.data.generatedAt || null) : null,
    report: c.data || null,
    applied: c.applied || {}, rejected: c.rejected || [],
    locked: AI_LOCKED,
    effective: {
      tpPct: PYR.TP_PCT, addLossPct: PYR.ADD_LOSS_PCT, addIntervalMs: PYR.ADD_INTERVAL_MS,
      entryUsd: PYR.ENTRY_USD, addUsd: PYR.ADD_USD, tfs: PYR.TFS.map(t => t.id),
      /* 风控回显（2026-11-11）：只读展示，不参与 AI 参数白名单校验 */
      stopLossPct: PYR.STOP_LOSS_PCT, trailArmPct: PYR.TRAIL_ARM_PCT, trailBackPct: PYR.TRAIL_BACK_PCT,
      timeStopHours: PYR.TIME_STOP_MS / 3600000, timeStopLossPct: PYR.TIME_STOP_LOSS_PCT,
      fastFailMin: PYR.FAST_FAIL_MS / 60000, fastFailLossPct: PYR.FAST_FAIL_LOSS_PCT,
      maxOpenPos: PYR.MAX_OPEN_POS
    },
    error: c.error || null
  };
}

let statCache = { at: 0, data: null };

/* ★每小时 AI 总结历史：data/ai_history/ai_YYYYMMDD_HHMMSS.json，由 ai_apply.js 每次分析后落盘。
 *   aiHistory(page,per) 返回分页摘要列表；aiHistoryDetail(id) 返回单份完整报告（前端弹窗看详情）。 */
const AI_HIST_DIR = path.join(__dirname, '..', '..', '..', 'data', 'ai_history');
function aiHistFiles() {
  try {
    if (!fs.existsSync(AI_HIST_DIR)) return [];
    return fs.readdirSync(AI_HIST_DIR)
      .filter(function (f) { return /^ai_\d{8}_\d{6}\.json$/.test(f); })
      .sort().reverse();
  } catch (e) { return []; }
}
function aiHistSummary(id, j) {
  const bt = j.backtest || {};
  return {
    id: id,
    generatedAtBj: j.generatedAtBj || null,
    engine: j.engine || j.source || '',
    verdict: String(j.verdict || '').slice(0, 120),
    netUsd: bt.netUsd != null ? bt.netUsd : null,
    winRate: bt.winRate != null ? bt.winRate : null,
    closed: bt.closed || 0, open: bt.open || 0,
    floats: (j.floatingLossAnalysis || []).length,
    codes: (j.codeChanges || []).length,
    autoFixApplied: (j.autoFix && j.autoFix.applied) || 0,
    trades: Array.isArray(j.trades) ? j.trades.length : 0
  };
}
function aiHistory(page, per) {
  page = Math.max(1, +page || 1);
  per = Math.min(100, Math.max(5, +per || 10));
  const files = aiHistFiles();
  const total = files.length;
  const pages = Math.max(1, Math.ceil(total / per));
  if (page > pages) page = pages;
  const items = [];
  for (const f of files.slice((page - 1) * per, (page - 1) * per + per)) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(AI_HIST_DIR, f), 'utf8'));
      items.push(aiHistSummary(f.replace(/^ai_/, '').replace(/\.json$/, ''), j));
    } catch (e) { }
  }
  return { ok: true, page: page, per: per, total: total, pages: pages, items: items };
}
function aiHistoryDetail(id) {
  const idStr = String(id || '').replace(/[^0-9_]/g, '');
  const f = 'ai_' + idStr + '.json';
  if (!/^ai_\d{8}_\d{6}\.json$/.test(f) || !fs.existsSync(path.join(AI_HIST_DIR, f))) {
    return { ok: false, err: '历史不存在: ' + idStr };
  }
  try {
    const j = JSON.parse(fs.readFileSync(path.join(AI_HIST_DIR, f), 'utf8'));
    j.historyId = idStr;
    return { ok: true, report: j };
  } catch (e) { return { ok: false, err: '历史读取失败: ' + e.message }; }
}
/* base 为法币锚定稳定币的合约永久排除，不参与任何信号/记录/合约列表。 */
const STABLE_BASES = ['USDC','USDT','DAI','FDUSD','TUSD','BUSD','USDE','USDG','PYUSD','EURC','USDP','USDD','FRAX','LUSD','GUSD','SUSD','USDB','CRVUSD','RLUSD','XUSD','USDX','EURT','AEUR','EURR','USDS'];
const STABLE_EXCL = STABLE_BASES.map(function (b) { return "inst_id NOT GLOB '" + b + "-*-SWAP'"; }).join(' AND ');

