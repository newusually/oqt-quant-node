'use strict';
/* ============================================================================
 * bt/inverse_strategy.js —— 低胜率组合「反向做」回测（2026-11-07 · 用户指定）
 * ----------------------------------------------------------------------------
 * 需求：总结之前几个版本的所有回测 → 只挑胜率 <20%（最好 <10%）的亏损组合，
 *       买多腿与卖空腿都必须 <20%，然后反向（买多→卖空、卖空→买多）重新回测，
 *       验证反转后成功率是否更高；5m/15m/1h 三周期，输出面板曲线与明细。
 *
 * ★ 诚实前提（写进报告，避免自欺）：
 *   反转后「样本内胜率」= 100% − 原胜率（数学恒等式，不是发现）。
 *   真正有价值的检验是三项：① 样本外(OOS)反转胜率是否仍高；
 *   ② 扣 taker 全费(10bp) 后净额是否转正；③ 从 420 组里挑极值 = 多重比较偏差。
 *   本引擎三项全部实算并写进 verdict，不做美化。
 *
 * 纯因果（无未来函数）：
 *   线 = ChanLun.ma(bars,5/20) 滚动均值，第 i 根只含 close[0..i]
 *   段角度 = 最近已确认转折点(j ≤ i−1) → i（causalAngles，只用 ≤i）
 *   交叉角 = |θMA5(i) − θMA20(i)|
 *   面积 = Σ_{k=i−24}^{i−1}|MA5(k)−MA20(k)|/close(k)×10000（只用 < i 的根）
 *   MACD = 因果 EMA12/26/9 递推（只用 ≤i）；确认 = 买多 hist>0 / 卖空 hist<0
 *   信号 = d=MA5−MA20 首次 ≤0→>0 买多 / ≥0→<0 卖空，bar i 收盘确认
 *   收益 = close[i] → close[i+1]，ret=(C1−C0)/C0×10000×dir [bp]，hit=ret>0
 *   反向 = dir'=−dir，ret'=−ret，hit'=ret'>0（信号时点不变，仅方向取反）
 *
 * 网格：交叉角 7 档 × 面积 Q5 × MACD 2 × 方向 2 × 周期 3 = 420 组
 * 输出：
 *   web/bt/inverse_strategy.json          面板数据（含历史版本总结）
 *   web/bt/inverse_strategy_trades.csv   反转后逐笔全量
 *   web/bt/inverse_grid.csv              420 组全网格筛选证据
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname + '/..';
const FILTER = require(__dirname + '/instrument_filter.js'); /* 硬约束：稳定币/零波动标的过滤器 */
require(ROOT + '/web/js/chanlun.js');
const CL = globalThis.ChanLun;
if (!CL || typeof CL.ma !== 'function') throw new Error('chanlun.js not loaded');

const RAD = 180 / Math.PI;
const WARM = 120;
const START_MS = Date.parse('2024-11-01T00:00:00Z');
const HARD_END = Date.parse('2026-11-06T00:00:00Z');
const END_MS = Math.min(HARD_END, Date.now());
const SPLIT_MS = Date.parse('2026-03-01T00:00:00Z');
const WEBBT = ROOT + '/web/bt';
/* ★2026-11-07 用户要求彻底删除美股全线 → US_DB 已移除，只保留 OKX 数据源 */
const BUILD = '20261107g1';
const MIN_N = 30;          /* 粗网格(不含合约维度)最小样本 */
const MIN_N_FINE = 20;     /* 细分网格(含合约维度)最小样本；样本小→必须单独做样本外验证 */
const TRADE_JSON_CAP = 20000; /* 面板逐笔明细上限（完整仍在 CSV） */

const TFS = [
  { id: '5m', label: '5分钟', dir: '5m', step: 300000 },
  { id: '15m', label: '15分钟', dir: '15m', step: 900000 },
  { id: '1h', label: '1小时', dir: '1h', step: 3600000 }
];
const FEES = [-2, 0, 5, 10];  /* maker返佣 / 0bp / 半费 / taker全费 */
const FEE_LABEL = { '-2': 'maker返佣 −2bp', '0': '0bp', '5': '5bp', '10': 'taker全费 10bp' };
const BANDS = [
  { lo: 0, hi: 5, label: '0~5°' }, { lo: 5, hi: 10, label: '5~10°' },
  { lo: 10, hi: 15, label: '10~15°' }, { lo: 15, hi: 20, label: '15~20°' },
  { lo: 20, hi: 35, label: '20~35°' }, { lo: 35, hi: 60, label: '35~60°' },
  { lo: 60, hi: Infinity, label: '>60°' }
];

const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const r3 = x => Math.round(x * 1000) / 1000;
const nz = (x, d) => (isFinite(x) ? x : (d === undefined ? 0 : d));

/* ---------------------------------------------------------------- 历史版本总结（原文口径，来自工作记忆） */
const HISTORY = [
  { v: '旧缠论全网格 420 组合', date: '2026-11-05', scope: '1h / 2年 / 290标的 / 839,255次交叉；6交叉对×7角度×5Q×2MACD', n: '839,255', win: '47.42%', oos: '47.02%', net: '按合理成本无可稳定盈利组合', note: '两焦点 73.35%→55.00%(OOS 40.51%)、72.58%→46.07%；CME 50.54% > OKX 47.39%', data: '原始逐笔已删' },
  { v: '三周期多因子 d1 · 360组合', date: '2026-11-05', scope: '5m/15m/1h 三周期；角度7→6档(>35°合并)、面积按高角度样本重分位', n: '全网格', win: '—', oos: '—', net: '仅作筛选参考', note: '5m/15m 数据非全两年；净值须按日等权分散复利，不能按日合计bp复利', data: '原始逐笔已删' },
  { v: '单组合专项 e2', date: '2026-11-05', scope: 'ma5-ma20|2~5°|Q3|MACD不确认（360组里挑出的样本内最高胜率）', n: '144笔(5m8/15m9/1h127)', win: '1h 65.35%', oos: '69.70%', net: '1h +6131.8bp / 扣10bp +4861.8bp', note: '净值 +57.822% / MDD 5.91% / PF 2.288；65.35% 是多重比较挑出的最大值，5m/15m 仅 8/9 笔', data: '原始逐笔已删' },
  { v: '只留两档位 a2', date: '2026-11-06', scope: '只准出现 5~10° 与 Q1；三组 angle/q1/both；5m/15m/1h', n: '781,865行', win: '≈48%', oos: '—', net: '5m三组全亏；15m/1h毛正但扣10bp全转负', note: 'Q1 是 24 根 MA5/MA20 夹出的带状面积，不是竖线；买卖信号默认隐藏', data: '原始逐笔已删' },
  { v: '角度组合策略 f1（上一版面板）', date: '2026-11-06', scope: '10~15° down-cross 卖空 + 35~40° up-cross 买多；MA5/MA20', n: '41,618', win: '47.79%', oos: '—', net: '毛 +62,074.9bp / maker净 +145,310.9bp / taker净 −354,105.1bp', note: '复合 +11.33% / MDD 4.9%；盈利完全依赖 maker 返佣，taker 实盘必亏', data: '★ 逐笔仍在 (angle_strategy_trades.csv)' },
  { v: '最强买卖信号全市场(90天)', date: '2026-11-04', scope: '287合约 × 90天；买多/卖空信号分周期准确率', n: '287合约', win: '卖空 54.78% > 买多 51.25%', oos: '—', net: '5m/15m/1h/2h 卖空领先，仅 4h 买多领先', note: '大波动行情卖空更准；整体 52.19% vs 买入 48.27%', data: 'HTML 报告仍在' },
  { v: '涨跌幅公式推导(控制变量×市场宽度)', date: '2026-11-04', scope: 'r = A_O·P − A_dn；σ ≈ 0.627·A/√Δt；W=(N↑−N↓)/N', n: '公式推导', win: '—', oos: '—', net: 'R̂_max=[R̄↑+σ↑z(N↑)]·e^{κW}·(V̂/V̄)^δ', note: '量能平方根律 Clark 混合分布；E[A]≈1.596·σ√Δt；宽度受振幅上界 Â 约束', data: 'HTML 报告仍在' },
  { v: '跨信号族分散回测', date: '2026-11-05', scope: '交叉角 Pool A + 缠论最优 + ma5-ma30|10~20°|Q2|MACD确认，成本 ~0bp', n: '多信号族', win: '—', oos: '—', net: '月度收益相加(上界估计)平滑权益、提高绿盘月占比', note: '分散只能降波动，不能凭空创造正期望；本质是「选对合约子集」', data: '原始逐笔已删' },
  { v: '四模块交集 · 合约盈亏特征', date: '2026-11-07', scope: '289合约按 σ/趋势分桶聚合多空腿', n: '41,618', win: '各桶≈48%', oos: '—', net: '空头腿 maker净 +116,529.3bp / taker净 −314,690.7bp', note: '波动率/趋势不能分离盈亏；无过滤器能保证盈利', data: '★ JSON 仍在 (contract_analysis.json)' }
];

/* ---------------------------------------------------------------- 数据加载（与 angle_strategy.js 同源） */
/* ★2026-11-07 美股已彻底删除 → loadFutures(CME NQ/ES/YM) 已移除 */
function loadOkxInst(tfDir, inst, endMs) {
  const dir = path.join(ROOT, 'data/okx/kline', tfDir, inst);
  const map = new Map();
  if (!fs.existsSync(dir)) return [];
  for (const f of fs.readdirSync(dir)) {
    if (!/^\d{6}\.sqlite$/.test(f)) continue;
    let db;
    try {
      db = new DatabaseSync(path.join(dir, f));
      for (const r of db.prepare('SELECT ts,o,h,l,c,v FROM kline').all()) {
        const t = +r.ts;
        if (t < START_MS || t >= endMs) continue;
        map.set(t, { t: t, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v });
      }
    } catch (e) { /* 损坏/并发写入的月度库跳过 */ }
    finally { try { if (db) db.close(); } catch (_) { } }
  }
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}
function listOkxInsts(tfDir) {
  const dir = path.join(ROOT, 'data/okx/kline', tfDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(x => fs.statSync(path.join(dir, x)).isDirectory()).sort();
}

/* ---------------------------------------------------------------- 纯因果指标 */
function causalAngles(ma, n, period) {
  const ang = new Float64Array(n);
  let pivot = Math.min(period - 1, n - 1);
  let prevSlope = 0;
  for (let i = pivot + 1; i < n; i++) {
    const d = ma[i] - ma[i - 1];
    const s = d > 0 ? 1 : (d < 0 ? -1 : 0);
    if ((prevSlope > 0 && s < 0) || (prevSlope < 0 && s > 0)) pivot = i - 1;
    if (s !== 0) prevSlope = s;
    const base = Math.abs(ma[pivot]) > 1e-12 ? Math.abs(ma[pivot]) : 1;
    const span = Math.max(1, i - pivot);
    ang[i] = Math.atan((ma[i] - ma[pivot]) / base / span * 100) * RAD;
  }
  return ang;
}
function ema(arr, p) {
  const out = new Float64Array(arr.length), k = 2 / (p + 1);
  let e = isFinite(arr[0]) ? arr[0] : 0;
  out[0] = e;
  for (let i = 1; i < arr.length; i++) {
    const v = isFinite(arr[i]) ? arr[i] : e;   /* 注意：dif 常为 0/负，不能用 || 兜底 */
    e = v * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}
function bandOf(cross) {
  for (let i = 0; i < BANDS.length; i++) if (cross >= BANDS[i].lo && cross < BANDS[i].hi) return i;
  return BANDS.length - 1;
}
/* 标的过滤统一委托 bt/instrument_filter.js（稳定币 + 零波动双保险），本引擎不再自带判定。 */

/* ---------------------------------------------------------------- 单标的全交叉事件扫描（不做任何档位过滤） */
function scanBars(tf, inst, src, bars) {
  const n = bars.length, E = [];
  if (n < WARM + 30) return E;
  const ma5 = CL.ma(bars, 5), ma20 = CL.ma(bars, 20);
  const a5 = causalAngles(ma5, n, 5), a20 = causalAngles(ma20, n, 20);
  const closes = new Float64Array(n);
  for (let i = 0; i < n; i++) closes[i] = +bars[i].c || 0;
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const dif = new Float64Array(n);
  for (let i = 0; i < n; i++) dif[i] = e12[i] - e26[i];
  const dea = ema(dif, 9);
  /* 面积：过去 24 根 MA5/MA20 夹出的带状面积（只用 < i 的根） */
  const area = new Float64Array(n);
  let run = 0;
  for (let i = 0; i < n; i++) {
    const gap = i > 0 ? Math.abs(ma5[i - 1] - ma20[i - 1]) / (closes[i - 1] || 1) * 10000 : 0;
    run += gap;
    if (i >= 25) run -= Math.abs(ma5[i - 25] - ma20[i - 25]) / (closes[i - 25] || 1) * 10000;
    area[i] = run;
  }
  let prevD = ma5[WARM] - ma20[WARM];
  for (let i = WARM + 1; i < n - 1; i++) {
    const d = ma5[i] - ma20[i];
    let dir = 0;
    if (prevD <= 0 && d > 0) dir = 1;
    else if (prevD >= 0 && d < 0) dir = -1;
    prevD = d;
    if (!dir) continue;
    const c0 = bars[i].c, c1 = bars[i + 1].c;
    if (!(c0 > 0 && c1 > 0)) continue;
    const cross = Math.abs(a5[i] - a20[i]);
    const hist = dif[i] - dea[i];
    const macdOk = dir > 0 ? hist > 0 : hist < 0;
    const ret = (c1 - c0) / c0 * 10000 * dir;
    const iso = new Date(bars[i].t).toISOString();
    E.push({
      i: i, t: bars[i].t, iso: iso, inst: inst, src: src, tf: tf, dir: dir,
      cross: cross, band: bandOf(cross), area: area[i], macdOk: macdOk,
      ret: ret, hit: ret > 0 ? 1 : 0, oos: bars[i].t >= SPLIT_MS,
      month: iso.slice(0, 7), day: iso.slice(0, 10), c0: c0, c1: c1
    });
  }
  return E;
}

/* ---------------------------------------------------------------- 因果自检：截断未来 bar 不影响历史事件 */
function causalSelfTest(tf, inst, bars) {
  const K = Math.min(bars.length - 2, 400);
  if (K < WARM + 20) return null;
  const A = scanBars(tf, inst, 'test', bars).filter(e => e.i <= K - 2);
  const B = scanBars(tf, inst, 'test', bars.slice(0, K)).filter(e => e.i <= K - 2);
  if (A.length !== B.length) return { pass: false, reason: 'count', full: A.length, cut: B.length };
  for (let j = 0; j < A.length; j++) {
    const x = A[j], y = B[j];
    if (x.i !== y.i || x.dir !== y.dir || Math.abs(x.ret - y.ret) > 1e-9 ||
      Math.abs(x.cross - y.cross) > 1e-9 || Math.abs(x.area - y.area) > 1e-9 || x.macdOk !== y.macdOk) {
      return { pass: false, reason: 'value', at: j };
    }
  }
  return { pass: true, tf: tf, inst: inst, checkedEvents: A.length, cutAtBar: K };
}

/* ---------------------------------------------------------------- 统计工具 */
function curveFromTrades(tr) {
  const days = new Map();
  for (const t of tr) {
    let d = days.get(t.day);
    if (!d) { d = { day: t.day, bp: 0, n: 0, f: [0, 0, 0, 0] }; days.set(t.day, d); }
    d.bp += t.ret; d.n++;
    for (let j = 0; j < FEES.length; j++) d.f[j] += t.ret - FEES[j];
  }
  const ks = Array.from(days.keys()).sort();
  let cum = 0, eq = 100, peak = 100, mdd = 0;
  const cf = [0, 0, 0, 0], pts = [];
  for (const k of ks) {
    const d = days.get(k);
    cum += d.bp;
    for (let j = 0; j < FEES.length; j++) cf[j] += d.f[j];
    const rr = d.n ? d.bp / d.n / 10000 : 0;
    eq *= 1 + rr;
    peak = Math.max(peak, eq);
    mdd = Math.max(mdd, (peak - eq) / peak * 100);
    const p = { d: k, bp: r1(cum), pct: r1(cum / 100), eq: r3(eq), n: d.n };
    for (let j = 0; j < FEES.length; j++) p['f' + j] = r1(cf[j]);
    pts.push(p);
  }
  return { points: pts, finalBp: r1(cum), finalPct: r1(cum / 100), compoundPct: r3((eq / 100 - 1) * 100), maxDrawdownPct: r2(mdd), days: pts.length };
}
function bucket(arr, keyFn) {
  const m = new Map();
  for (const t of arr) {
    const k = keyFn(t);
    let o = m.get(k);
    if (!o) { o = { key: k, n: 0, hit: 0, sumRet: 0, isN: 0, isHit: 0, oosN: 0, oosHit: 0 }; m.set(k, o); }
    o.n++; if (t.hit) o.hit++; o.sumRet += t.ret;
    if (t.oos) { o.oosN++; if (t.hit) o.oosHit++; }
    else { o.isN++; if (t.hit) o.isHit++; }
  }
  return Array.from(m.values()).map(o => ({
    key: o.key, n: o.n, winRate: o.n ? r2(o.hit / o.n * 100) : 0,
    sumRet: r1(o.sumRet), sumRetRaw: o.sumRet,  /* 累加必须用原始值，先取整会漂移 */
    isN: o.isN, isWinRate: o.isN ? r2(o.isHit / o.isN * 100) : 0,
    oosN: o.oosN, oosWinRate: o.oosN ? r2(o.oosHit / o.oosN * 100) : 0
  }));
}
function buildKpi(trades) {
  const n = trades.length;
  let hit = 0, flat = 0, sumRaw = 0, sumWin = 0, sumLoss = 0, win = 0, loss = 0;
  let isN = 0, isHit = 0, oosN = 0, oosHit = 0, oosSum = 0;
  let maxWin = 0, maxLoss = 0;
  for (const t of trades) {
    if (t.hit) hit++;
    if (t.ret === 0) flat++;
    sumRaw += t.ret;
    if (t.ret > 0) { win++; sumWin += t.ret; maxWin = Math.max(maxWin, t.ret); }
    else if (t.ret < 0) { loss++; sumLoss += t.ret; maxLoss = Math.min(maxLoss, t.ret); }
    if (t.oos) { oosN++; if (t.hit) oosHit++; oosSum += t.ret; }
    else { isN++; if (t.hit) isHit++; }
  }
  const curve = curveFromTrades(trades);
  const cost = FEES.map(c => ({ cost: c, label: FEE_LABEL[String(c)] || (c + 'bp'), netBp: r1(sumRaw - n * c), netPct: r1((sumRaw - n * c) / 100) }));
  return {
    n: n, hit: hit, flat: flat, winRate: n ? r2(hit / n * 100) : 0,
    isN: isN, isWinRate: isN ? r2(isHit / isN * 100) : 0,
    oosN: oosN, oosWinRate: oosN ? r2(oosHit / oosN * 100) : 0,
    totalProfitBp: r1(sumRaw), totalProfitPct: r1(sumRaw / 100),
    grossWinBp: r1(sumWin), grossLossBp: r1(sumLoss), avgRetBp: r3(sumRaw / (n || 1)),
    profitFactor: sumLoss !== 0 ? r3(Math.abs(sumWin / sumLoss)) : 0,
    payoff: (win && loss) ? r3((sumWin / win) / Math.abs(sumLoss / loss)) : 0,
    cost: cost,
    netMakerBp: r1(sumRaw - n * (-2)), netTakerBp: r1(sumRaw - n * 10),
    netMakerPct: r1((sumRaw - n * (-2)) / 100), netTakerPct: r1((sumRaw - n * 10) / 100),
    oosProfitBp: r1(oosSum), oosNetTakerBp: r1(oosSum - oosN * 10),
    compoundPct: curve.compoundPct, maxDrawdownPct: curve.maxDrawdownPct,
    maxWinBp: r1(maxWin), maxLossBp: r1(maxLoss),
    checksum: r1(sumRaw)
  };
}
function packTrades(trades, byMonth) {
  const n = trades.length;
  let tradeBars, barMode;
  if (n <= 600) {
    let cum = 0;
    tradeBars = trades.map((t, i) => { cum += t.ret; return { i: i + 1, t: t.t, iso: t.iso, ret: r1(t.ret), cumBp: r1(cum), inst: t.inst, src: t.src, dir: t.dir, hit: t.hit, cross: r2(t.cross), c0: t.c0, c1: t.c1, oos: t.oos }; });
    barMode = 'trade';
  } else {
    const B = 300, per = Math.ceil(n / B);
    tradeBars = []; let cum = 0;
    for (let s = 0; s < n; s += per) {
      const seg = trades.slice(s, s + per);
      let bp = 0, h = 0;
      for (const t of seg) { bp += t.ret; if (t.hit) h++; cum += t.ret; }
      tradeBars.push({ i: s + 1, iEnd: Math.min(n, s + per), t: seg[0].t, iso: seg[0].iso, isoEnd: seg[seg.length - 1].iso, ret: r1(bp), cumBp: r1(cum), n: seg.length, winRate: r2(h / seg.length * 100), bucketed: true });
    }
    barMode = 'bucket';
  }
  /* 坑：累计必须用原始 ret 累加后再取整；先 r1() 再累加会漂移（历史踩过） */
  const monthlyBars = byMonth.map(m => ({ d: m.key, n: m.n, winRate: m.winRate, ret: r1(m.sumRetRaw), cumBp: 0 }));
  let mc = 0;
  for (let i = 0; i < monthlyBars.length; i++) { mc += byMonth[i].sumRetRaw; monthlyBars[i].cumBp = r1(mc); }
  const list = trades.slice(0, TRADE_JSON_CAP).map(t => ({
    t: t.t, iso: t.iso, inst: t.inst, src: t.src, dir: t.dir, origDir: t.origDir,
    ret: r1(t.ret), origRet: r1(t.origRet), hit: t.hit, cross: r2(t.cross),
    c0: t.c0, c1: t.c1, oos: t.oos, key: t.gridKey
  }));
  return {
    monthlyBars: monthlyBars, tradeBars: tradeBars, barMode: barMode,
    trades: list, tradesTotal: n, tradesTruncated: n > TRADE_JSON_CAP
  };
}
function buildPeriod(tf, before, after, selected, tier, instMeta) {
  const ab = buildKpi(before), aa = buildKpi(after);
  const curve = curveFromTrades(after);
  const isK = buildKpi(after.filter(t => !t.oos));
  const oosK = buildKpi(after.filter(t => t.oos));
  const byMonth = bucket(after, t => t.month).sort((a, b) => a.key < b.key ? -1 : 1);
  const ext = packTrades(after, byMonth);
  const slimK = k => ({ n: k.n, winRate: k.winRate, grossBp: k.totalProfitBp, netMakerBp: k.netMakerBp, netTakerBp: k.netTakerBp, avgRetBp: k.avgRetBp, profitFactor: k.profitFactor });
  return {
    tf: tf, tier: tier, selectedKeys: selected.map(s => s.key), selected: selected,
    before: { kpi: { n: ab.n, winRate: ab.winRate, isWinRate: ab.isWinRate, oosWinRate: ab.oosWinRate, totalProfitBp: ab.totalProfitBp, netMakerBp: ab.netMakerBp, netTakerBp: ab.netTakerBp, avgRetBp: ab.avgRetBp, profitFactor: ab.profitFactor } },
    isOnly: slimK(isK), oosOnly: slimK(oosK),
    kpi: aa, curve: curve,
    byMonth: byMonth, bySource: bucket(after, t => t.src),
    byInst: bucket(after, t => t.inst).sort((a, b) => b.sumRet - a.sumRet).slice(0, 20),
    monthlyBars: ext.monthlyBars, tradeBars: ext.tradeBars, barMode: ext.barMode,
    trades: ext.trades, tradesTotal: ext.tradesTotal, tradesTruncated: ext.tradesTruncated,
    meta: {
      instruments: instMeta.length,
      coverage: instMeta.length ? { from: instMeta.map(x => x.from).sort()[0], to: instMeta.map(x => x.to).sort().pop() } : null
    }
  };
}

/* ---------------------------------------------------------------- 主流程 */
function main() {
  const t0 = Date.now();
  if (!fs.existsSync(WEBBT)) fs.mkdirSync(WEBBT, { recursive: true });
  const only = process.env.BT_TF || '';
  const tfs = only ? TFS.filter(t => t.id === only) : TFS;
  const LIMIT = parseInt(process.env.BT_LIMIT || '0', 10);

  const allEvents = [];       /* 全交叉事件（未过滤） */
  const instMetaAll = {};
  const causalTests = [];
  const causalDone = new Set();  /* 每个周期至少做一次截断不变性实证 */
  const excludedInstruments = []; /* 被判为零波动/稳定币对而剔除的标的（透明留痕） */

  for (const cfg of tfs) {
    console.log('=== SCAN', cfg.id, cfg.label, '===');
    const ts = Date.now();
    let totalBars = 0, insts = 0;
    const instsBars = [];
    const collect = (inst, src, bars) => {
      const n = bars.length;
      if (n < WARM + 30) return;
      /* 【硬约束】稳定币/零波动标的永不进入回测（bt/instrument_filter.js） */
      const ex = FILTER.shouldExclude(inst, bars);
      if (ex) {
        excludedInstruments.push({ tf: cfg.id, inst: inst, src: src, sdBp: ex.sdBp, reason: ex.reason });
        return;
      }
      totalBars += n; insts++;
      instsBars.push({ inst: inst, src: src, bars: n, from: new Date(bars[0].t).toISOString(), to: new Date(bars[n - 1].t).toISOString() });
      const E = scanBars(cfg.id, inst, src, bars);
      for (const e of E) allEvents.push(e);
      if (!causalDone.has(cfg.id) && src === 'OKX永续' && n > WARM + 60) {
        const ct = causalSelfTest(cfg.id, inst, bars);
        if (ct) { causalTests.push(ct); causalDone.add(cfg.id); }
      }
    };
    let list = listOkxInsts(cfg.dir);
    if (LIMIT > 0) list = list.slice(0, LIMIT);
    for (const inst of list) collect(inst, 'OKX永续', loadOkxInst(cfg.dir, inst, END_MS));
    instMetaAll[cfg.id] = instsBars;
    console.log('  SCAN tf=%s bars=%d insts=%d events=%d elapsed=%ds',
      cfg.id, totalBars, insts, allEvents.reduce((a, e) => a + (e.tf === cfg.id ? 1 : 0), 0), Math.round((Date.now() - ts) / 1000));
  }

  /* ---- 面积 Q 分位边界：每个周期单独在「全部交叉事件」上求 20/40/60/80 分位 ---- */
  const qBounds = {};
  for (const cfg of tfs) {
    const vals = allEvents.filter(e => e.tf === cfg.id).map(e => e.area).sort((a, b) => a - b);
    const q = [0.2, 0.4, 0.6, 0.8].map(p => vals.length ? r2(vals[Math.floor(vals.length * p)]) : 0);
    qBounds[cfg.id] = q;
  }
  const qOf = (tf, a) => { const q = qBounds[tf]; for (let i = 0; i < 4; i++) if (a <= q[i]) return i + 1; return 5; };
  for (const e of allEvents) {
    e.areaQ = qOf(e.tf, e.area);
    e.bandLabel = BANDS[e.band].label;
    e.macdLabel = e.macdOk ? 'MACD确认' : 'MACD不确认';
    e.dirLabel = e.dir > 0 ? '买多' : '卖空';
    e.gridKey = [e.tf, e.dirLabel, e.bandLabel, 'Q' + e.areaQ, e.macdLabel].join('|');
    /* 细分组合：加入「合约」维度（上一轮四模块交集发现的唯一显著分层维度） */
    e.fineKey = [e.tf, e.inst, e.dirLabel, e.bandLabel, 'Q' + e.areaQ, e.macdLabel].join('|');
    e.day = e.day || e.iso.slice(0, 10);
  }

  /* ---- 证据 A：粗网格（不含合约维度，全期统计） ---- */
  const gm = new Map();
  for (const e of allEvents) {
    let g = gm.get(e.gridKey);
    if (!g) { g = { key: e.gridKey, tf: e.tf, dir: e.dir, dirLabel: e.dirLabel, band: e.bandLabel, q: e.areaQ, macd: e.macdLabel, n: 0, hit: 0, flat: 0, sumRet: 0, isN: 0, isHit: 0, oosN: 0, oosHit: 0, oosFlat: 0 }; gm.set(e.gridKey, g); }
    g.n++; if (e.hit) g.hit++; if (e.ret === 0) g.flat++; g.sumRet += e.ret;
    if (e.oos) { g.oosN++; if (e.hit) g.oosHit++; if (e.ret === 0) g.oosFlat++; }
    else { g.isN++; if (e.hit) g.isHit++; }
  }
  /* 反转后命中 = 原亏损笔数 = n − hit − flat（平局 ret=0 反转后仍不命中） */
  const coarseRows = Array.from(gm.values()).map(g => ({
    ...g, winRate: g.n ? r2(g.hit / g.n * 100) : 0, sumRetBp: r1(g.sumRet),
    isWinRate: g.isN ? r2(g.isHit / g.isN * 100) : 0,
    oosWinRate: g.oosN ? r2(g.oosHit / g.oosN * 100) : 0,
    invWinRate: g.n ? r2((g.n - g.hit - g.flat) / g.n * 100) : 0,
    invOosWinRate: g.oosN ? r2((g.oosN - g.oosHit - g.oosFlat) / g.oosN * 100) : 0
  }));
  const coarseValid = coarseRows.filter(g => g.n >= MIN_N);
  const coarseStats = {
    rows: coarseRows.length,
    lt10: coarseValid.filter(g => g.winRate < 10).length,
    lt20: coarseValid.filter(g => g.winRate < 20).length,
    minWinRate: coarseValid.length ? Math.min.apply(null, coarseValid.map(g => g.winRate)) : null
  };

  /* ---- 证据 B / 主策略：细分网格（含合约维度）★ 只用样本内(IS)挑组合 ----
   * 严格样本外：筛选绝不触碰 OOS 数据；OOS 只用于事后验证。 */
  const fm = new Map();
  for (const e of allEvents) {
    if (e.oos) continue;
    let g = fm.get(e.fineKey);
    if (!g) {
      g = { key: e.fineKey, tf: e.tf, inst: e.inst, src: e.src, dir: e.dir, dirLabel: e.dirLabel,
        band: e.bandLabel, q: e.areaQ, macd: e.macdLabel, n: 0, hit: 0, flat: 0, sumRet: 0,
        oosN: 0, oosHit: 0, oosFlat: 0 };
      fm.set(e.fineKey, g);
    }
    g.n++; if (e.hit) g.hit++; if (e.ret === 0) g.flat++; g.sumRet += e.ret;
  }
  const fineRows = Array.from(fm.values()).map(g => ({
    ...g, winRate: g.n ? r2(g.hit / g.n * 100) : 0, sumRetBp: r1(g.sumRet),
    invWinRate: g.n ? r2((g.n - g.hit - g.flat) / g.n * 100) : 0,
    oosWinRate: 0, invOosWinRate: 0, chosen: false, tier: ''
  }));
  const fineByKey = new Map(fineRows.map(g => [g.key, g]));
  for (const e of allEvents) {
    if (!e.oos) continue;
    const g = fineByKey.get(e.fineKey);
    if (!g) continue;
    g.oosN++; if (e.hit) g.oosHit++; if (e.ret === 0) g.oosFlat++;
  }
  for (const g of fineRows) {
    g.oosWinRate = g.oosN ? r2(g.oosHit / g.oosN * 100) : 0;
    g.invOosWinRate = g.oosN ? r2((g.oosN - g.oosHit - g.oosFlat) / g.oosN * 100) : 0;
  }

  /* ---- 筛选：每周期每腿，IS 胜率 <20%（优先 <10%），n>=MIN_N_FINE ---- */
  const chosenByTf = {};
  for (const cfg of tfs) {
    const chosen = [];
    const tierByDir = {};
    for (const dir of [1, -1]) {
      const cands = fineRows.filter(g => g.tf === cfg.id && g.dir === dir && g.n >= MIN_N_FINE).sort((a, b) => a.winRate - b.winRate);
      const t1 = cands.filter(g => g.winRate < 10);
      const t2 = cands.filter(g => g.winRate < 20);
      let pick, tier;
      if (t1.length) { pick = t1; tier = '<10%'; }
      else if (t2.length) { pick = t2; tier = '<20%'; }
      else if (cands.length) { pick = [cands[0]]; tier = 'fallback(IS未达20%)'; }
      else { pick = []; tier = 'no-data'; }
      tierByDir[dir > 0 ? '买多' : '卖空'] = tier;
      for (const g of pick) { g.chosen = true; g.tier = tier; chosen.push(g); }
    }
    chosenByTf[cfg.id] = { rows: chosen, tiers: tierByDir };
    console.log('  PICK tf=%s long=%s short=%s chosen=%d (minISWin=%s)', cfg.id,
      tierByDir['买多'], tierByDir['卖空'], chosen.length,
      chosen.length ? Math.min.apply(null, chosen.map(g => g.winRate)).toFixed(2) + '%' : 'NA');
  }

  /* ---- 反转：dir'=−dir, ret'=−ret；信号时点完全不变 ---- */
  const chosenKeys = new Set(fineRows.filter(g => g.chosen).map(g => g.key));
  const picked = allEvents.filter(e => chosenKeys.has(e.fineKey));
  const inverted = picked.map(e => ({
    ...e, origDir: e.dir, origRet: e.ret, origHit: e.hit,
    dir: -e.dir, ret: -e.ret, hit: -e.ret > 0 ? 1 : 0
  }));

  /* ---- 分周期 + 合并 ---- */
  const periods = {};
  const compareRows = [];
  for (const cfg of tfs) {
    const ch = chosenByTf[cfg.id];
    const before = picked.filter(e => e.tf === cfg.id).sort((a, b) => a.t - b.t || (a.inst < b.inst ? -1 : 1));
    const after = inverted.filter(e => e.tf === cfg.id).sort((a, b) => a.t - b.t || (a.inst < b.inst ? -1 : 1));
    periods[cfg.id] = buildPeriod(cfg.id, before, after, ch.rows, ch.tiers, instMetaAll[cfg.id]);
    const p = periods[cfg.id], b = p.before.kpi, a = p.kpi;
    compareRows.push({
      tf: cfg.id, label: cfg.label, tier: ch.tiers['买多'] + ' / ' + ch.tiers['卖空'],
      groups: ch.rows.length, n: a.n, beforeWin: b.winRate, afterWin: a.winRate,
      afterOosWin: a.oosWinRate, grossBp: a.totalProfitBp, netMakerBp: a.netMakerBp, netTakerBp: a.netTakerBp,
      compoundPct: a.compoundPct, maxDD: a.maxDrawdownPct, pf: a.profitFactor
    });
    console.log('  RESULT tf=%s n=%d beforeWin=%s afterWin=%s afterOOS=%s gross=%s maker=%s taker=%s',
      cfg.id, a.n, b.winRate, a.winRate, a.oosWinRate, a.totalProfitBp, a.netMakerBp, a.netTakerBp);
  }
  const allBefore = picked.slice().sort((a, b) => a.t - b.t || (a.inst < b.inst ? -1 : 1));
  const allAfter = inverted.slice().sort((a, b) => a.t - b.t || (a.inst < b.inst ? -1 : 1));
  const mergedSelected = tfs.reduce((a, c) => a.concat(chosenByTf[c.id].rows), []);
  const combined = buildPeriod('合并', allBefore, allAfter, mergedSelected, { '买多': '合并', '卖空': '合并' },
    tfs.reduce((a, c) => a.concat(instMetaAll[c.id]), []));
  const cb = combined.before.kpi, ca = combined.kpi;
  compareRows.push({
    tf: '合并', label: '合并(三周期)', tier: '—', groups: mergedSelected.length,
    n: ca.n, beforeWin: cb.winRate, afterWin: ca.winRate, afterOosWin: ca.oosWinRate,
    grossBp: ca.totalProfitBp, netMakerBp: ca.netMakerBp, netTakerBp: ca.netTakerBp,
    compoundPct: ca.compoundPct, maxDD: ca.maxDrawdownPct, pf: ca.profitFactor
  });

  /* ---- 诚实验证 verdict（严格：IS 挑组合 → OOS 单独验证） ---- */
  const selRows = fineRows.filter(g => g.chosen);
  const minSelWin = selRows.length ? Math.min.apply(null, selRows.map(g => g.winRate)) : null;
  const nLt10 = selRows.filter(g => g.winRate < 10).length;
  const nLt20 = selRows.filter(g => g.winRate < 20).length;
  const nFallback = selRows.filter(g => g.winRate >= 20).length;
  const OOS_MIN = 200;
  const oosV = combined.oosOnly;
  const isV = combined.isOnly;
  const allOos = allEvents.filter(e => e.oos);
  /* 基线：全部 OOS 交叉事件「无条件反向」的胜率（≈50%，用来衡量筛选是否真带来提升） */
  const oosBaselineInvWin = allOos.length ? r2(allOos.filter(e => e.ret < 0).length / allOos.length * 100) : 0;
  const oosLift = r2(oosV.winRate - oosBaselineInvWin);
  const oosSampleSufficient = oosV.n >= OOS_MIN;
  const oosHolds = oosSampleSufficient && oosV.winRate > oosBaselineInvWin + 3; /* 至少跑赢基线 3pp */
  const takerOk = oosV.netTakerBp > 0;   /* 严格：只看样本外扣 taker 全费 */
  const verdict = {
    identity: '反转后胜率 = (n − 原命中 − 平局ret=0)/n ≈ 100% − 原胜率 − 平局率；样本内大幅提高是方向取反的算术结果，不是发现。信号时点/标的/成交价不变，仅方向取反。',
    coarseGrid: {
      rows: coarseStats.rows, lt10: coarseStats.lt10, lt20: coarseStats.lt20,
      minWinRate: coarseStats.minWinRate,
      note: '不含合约维度的 420 组粗网格中，一个胜率<20%的组合都没有——单技术信号方向收益近似随机，不可能产生 80%+ 的反向预测性。'
    },
    fineGrid: {
      rows: fineRows.length, selected: selRows.length,
      groupsLt10: nLt10, groupsLt20: nLt20, groupsFallback: nFallback,
      minSelectedWinRate: minSelWin,
      note: '加入「合约」维度后细分组合变多，能筛出 <20%/<10% 胜率组合，但这些是小样本极值，属多重比较偏差高发区。'
    },
    filterIsOnly: true,
    isAfterWinRate: isV.winRate,
    combinedAfterWinRate: ca.winRate,
    strictOos: {
      n: oosV.n, winRate: oosV.winRate, baselineInvWinRate: oosBaselineInvWin, lift: oosLift,
      grossBp: oosV.grossBp, netMakerBp: oosV.netMakerBp, netTakerBp: oosV.netTakerBp,
      avgRetBp: oosV.avgRetBp, sampleSufficient: oosSampleSufficient, holds: oosHolds,
      takerProfitable: takerOk
    },
    combinedNetTakerBp: ca.netTakerBp,
    combinedNetMakerBp: ca.netMakerBp,
    multipleComparisons: '从 ' + fineRows.length + ' 个细分组合里挑低胜率极值 = 多重比较/数据挖掘偏差；样本内极值在样本外大概率向全体基线回归。',
    guarantee: '否。样本内高胜率由方向取反的算术恒等式保证；只有「样本外样本量足够且显著跑赢无条件反向基线」+「样本外扣 taker 全费后为正」两条同时成立，才算真有可交易优势。',
    conclusion: ''
  };
  verdict.conclusion =
    '粗网格 ' + coarseStats.rows + ' 组中胜率<20%的组合 ' + coarseStats.lt20 + ' 个（最低 ' + coarseStats.minWinRate + '%）——' +
    '你要求的「买多/卖空都<20%（最好<10%）」在不含合约维度时根本不存在。' +
    '加入合约维度后，用样本内数据筛出 ' + nLt20 + ' 个 <20% 组合（其中 <10% 有 ' + nLt10 + ' 个，最低 ' + minSelWin + '%）。' +
    '样本内反转胜率 ' + isV.winRate + '%（恒等式，必然高）；严格样本外 ' + oosV.n + ' 笔反转胜率 ' + oosV.winRate +
    '%，无条件反向基线 ' + oosBaselineInvWin + '%，超额 ' + oosLift + 'pp。' +
    (oosSampleSufficient ? (oosHolds ? '样本外显著跑赢基线。' : '样本外未跑赢基线，低胜率是样本内噪声、向均值回归。')
      : '样本外样本不足，无法判定。') +
    '样本外扣 taker 全费净 ' + oosV.netTakerBp + 'bp。' +
    (oosHolds && takerOk ? '两项均通过，但来自极值筛选，仍须实盘验证。' : '反转策略不构成稳定盈利保证。');

  const causalPass = causalTests.length > 0 && causalTests.every(t => t.pass);
  const meta = {
    generatedAt: new Date().toISOString(), build: BUILD,
    title: '低胜率组合反向策略回测 · 买多/卖空双腿 <20%（优先 <10%）',
    scope: '两层网格：① 粗网格（交叉角7档×面积Q5×MACD2×方向2×周期3=420组，全期统计）→ 核实是否真有 <20% 胜率组合；② 细分网格（再加「合约」维度，只用样本内 IS 挑组合）→ 筛出买多与卖空胜率均<20%（优先<10%）的亏损组合，反向后重新回测，样本外 OOS 单独验证。本面板完全替代上一版角度组合策略的全部曲线与明细。',
    tfs: TFS.map(t => ({ id: t.id, label: t.label, stepMs: t.step })),
    window: { from: new Date(START_MS).toISOString(), to: new Date(END_MS).toISOString() },
    splitIS: '2024-11-01 ~ 2026-02-28', splitOOS: '2026-03-01 ~ 数据末端',
    fees: FEES, feeLabels: FEES.map(f => FEE_LABEL[String(f)]),
    bands: BANDS.map(b => b.label), qBounds: qBounds, minN: MIN_N, minNFine: MIN_N_FINE,
    gridSize: coarseRows.length, gridTheorySize: BANDS.length * 5 * 2 * 2 * tfs.length,
    fineGridSize: fineRows.length, selectedFineGroups: selRows.length,
    methodology: {
      lines: 'ChanLun.ma(bars,5/20) 滚动均值，第 i 根只含 close[0..i]；唯一交叉对 MA5/MA20',
      angle: '最近一个已确认转折点(j ≤ i−1) → i：atan((MA_i−MA_j)/|MA_j|/(i−j)×100)×180/π',
      crossAngle: '交叉角 = |θMA5(i) − θMA20(i)|，7 档：' + BANDS.map(b => b.label).join(' / '),
      area: '面积 area(i)=Σ_{k=i−24}^{i−1}|MA5(k)−MA20(k)|/close(k)×10000；按每周期全部交叉事件求 20/40/60/80 分位 → Q1~Q5',
      macd: '因果 EMA12/EMA26 → dif → EMA9(dif)=dea → hist=dif−dea；买多 hist>0 / 卖空 hist<0 记「MACD确认」',
      signal: 'd=MA5−MA20 首次 ≤0→>0 买多 / ≥0→<0 卖空；bar i 收盘确认。全交叉事件均入网格，不预设角度档',
      target: 'close[i] → close[i+1]，ret=(C1−C0)/C0×10000×dir [bp]，hit=ret>0',
      inverse: 'dir′=−dir，ret′=−ret，hit′=ret′>0；信号时点/标的/成交价完全不变，仅方向取反',
      filter: '细分组合 = 周期×合约×方向×交叉角档×面积Q×MACD；★ 只用样本内(IS)统计胜率，n≥' + MIN_N_FINE + ' 且胜率<20%（优先<10%）；每周期买多/卖空两腿分别筛；若无 <20% 则取该腿最低胜率组合并标注 fallback。样本外(OOS)数据绝不参与筛选，只用于事后验证。',
      verification: '反转后胜率分 IS/OOS 分别统计；OOS 与「全部 OOS 事件无条件反向」基线比较得出超额 lift；OOS 单独扣 taker 全费；并做截断不变性实证。',
      dataCleaning: '【硬约束】所有稳定币合约永久禁止进入回测：base 命中稳定币名单即排除；另对单根收益标准差 < ' + FILTER.MIN_SD_BP + 'bp 的零波动标的兜底剔除。统一走 bt/instrument_filter.js。历史各版本未做此清洗，USDC-USDT-SWAP 曾贡献 30.94% 的 ret=0 平局与虚假「低胜率」组合。',
      curve: '累计盈利 = Σ 每笔方向 bp；净值 = 当日资金等权分散到当日全部信号，日收益=当日合计bp÷当日笔数÷10000，逐日复利，起始 100；扣费曲线 = 逐日累计(每笔 ret − 成本)',
      cost: '1bp = 0.01%；净额 = 累计 bp − 笔数 × 每笔成本；maker 返佣 −2bp、taker 全 10bp',
      futureFunction: '无未来函数：所有指标与信号均用 bar i 收盘前可知量；已做截断不变性实证（突变未来 bar，历史事件逐条不变）'
    },
    dataCaveat: '1h 有 OKX 全部合约（★2026-11-07 美股全线已删除，只含 OKX）。周期间样本量不可直接比较。',
    dataCleaning: { minSdBp: FILTER.MIN_SD_BP, stableBases: Array.from(FILTER.STABLE_BASES), excludedCount: excludedInstruments.length, excluded: excludedInstruments },
    causalTest: { pass: causalPass, tests: causalTests },
    historyVersions: HISTORY
  };

  const result = {
    meta: meta,
    grid: {
      coarseRows: coarseRows, coarseStats: coarseStats,
      fineRows: fineRows.filter(g => g.chosen), fineTotal: fineRows.length,
      qBounds: qBounds, bands: BANDS.map(b => b.label), minN: MIN_N, minNFine: MIN_N_FINE
    },
    periods: periods, combined: combined, compare: { rows: compareRows }, verdict: verdict
  };

  const outPath = path.join(WEBBT, 'inverse_strategy.json');
  const tmpPath = '/tmp/inverse_strategy.json';
  const json = JSON.stringify(result);
  try { fs.writeFileSync(outPath, json); }
  catch (e) { console.log('  WARN write web/bt failed:', e.message, '-> fallback', tmpPath); }
  fs.writeFileSync(tmpPath, json);

  /* ---- 反转后逐笔 CSV（全量，不受 JSON cap 限制） ---- */
  const csv = ['周期,细分组合KEY,原方向,反向方向,信号UTC,标的,市场,收盘,次收,原收益bp,反转收益bp,反转命中,交叉角度,面积Q,MACD,样本外'];
  for (const e of inverted.slice().sort((a, b) => a.t - b.t || (a.inst < b.inst ? -1 : 1))) {
    csv.push([e.tf, e.fineKey, e.origDir > 0 ? '买多' : '卖空', e.dir > 0 ? '买多' : '卖空',
      e.iso, e.inst, e.src, e.c0, e.c1, r1(e.origRet), r1(e.ret), e.hit,
      r2(e.cross), 'Q' + e.areaQ, e.macdLabel, e.oos ? 1 : 0].join(','));
  }
  fs.writeFileSync(path.join(WEBBT, 'inverse_strategy_trades.csv'), csv.join('\n') + '\n');

  /* ---- 证据 A：粗网格全表 ---- */
  const gc = ['周期,方向,交叉角档,面积Q,MACD,笔数,命中数,平局数,胜率%,反转后胜率%,IS笔数,IS胜率%,OOS笔数,OOS胜率%,反转后OOS胜率%,毛收益bp'];
  for (const g of coarseRows.slice().sort((a, b) => a.tf < b.tf ? -1 : (a.tf > b.tf ? 1 : a.winRate - b.winRate))) {
    gc.push([g.tf, g.dirLabel, g.band, 'Q' + g.q, g.macd, g.n, g.hit, g.flat, g.winRate, g.invWinRate,
      g.isN, g.isWinRate, g.oosN, g.oosWinRate, g.invOosWinRate, g.sumRetBp].join(','));
  }
  fs.writeFileSync(path.join(WEBBT, 'inverse_grid.csv'), gc.join('\n') + '\n');

  /* ---- 证据 B：被选中的细分低胜率组合（含严格 OOS 验证） ---- */
  const fc = ['周期,标的,市场,方向,交叉角档,面积Q,MACD,IS笔数,IS命中,IS平局,IS胜率%,反转后IS胜率%,OOS笔数,OOS胜率%,反转后OOS胜率%,IS毛收益bp,选中层级'];
  for (const g of selRows.slice().sort((a, b) => a.tf < b.tf ? -1 : (a.tf > b.tf ? 1 : a.winRate - b.winRate))) {
    fc.push([g.tf, g.inst, g.src, g.dirLabel, g.band, 'Q' + g.q, g.macd,
      g.n, g.hit, g.flat, g.winRate, g.invWinRate, g.oosN, g.oosWinRate, g.invOosWinRate,
      g.sumRetBp, g.tier].join(','));
  }
  fs.writeFileSync(path.join(WEBBT, 'inverse_fine_grid.csv'), fc.join('\n') + '\n');

  console.log('=== ALL DONE elapsed=%ss jsonBytes=%d', Math.round((Date.now() - t0) / 1000), json.length);
  console.log('COARSE rows=%d lt10=%d lt20=%d minWin=%s', coarseStats.rows, coarseStats.lt10, coarseStats.lt20, coarseStats.minWinRate);
  console.log('FINE total=%d chosen=%d lt10=%d lt20=%d fallback=%d minISWin=%s',
    fineRows.length, selRows.length, nLt10, nLt20, nFallback, minSelWin);
  console.log('COMBINED before=%s%% after=%s%% ISafter=%s%% OOSafter=%s%% (n=%d) gross=%s maker=%s taker=%s compound=%s MDD=%s',
    cb.winRate, ca.winRate, isV.winRate, oosV.winRate, oosV.n, ca.totalProfitBp, ca.netMakerBp, ca.netTakerBp, ca.compoundPct, ca.maxDrawdownPct);
  console.log('STRICT_OOS baselineInv=%s%% lift=%spp oosNetTaker=%s holds=%s takerOk=%s',
    oosBaselineInvWin, oosLift, oosV.netTakerBp, oosHolds, takerOk);
  console.log('CAUSAL_TEST %s (%d cases)', causalPass ? 'PASS' : 'FAIL', causalTests.length);
  console.log('VERDICT_TEXT', verdict.conclusion);
}
main();
