/* ============================================================================
 * modules/okx/engines/chan.js —— ★缠论·大级别转折点引擎（2026-10-28）
 * ----------------------------------------------------------------------------
 * 用户需求（原话要点）：
 *   "用缠论写出大范围转折底部和顶部的买卖点，要求这个缠论有别于其他缠论，
 *    真正的大底部和大顶点才算，没有预测功能，是直接划线得来，
 *    底部和顶部连接最少40-100根K线的距离，并且连接在一起的涨跌幅在10%范围以上，
 *    底部是买，顶部是卖。……新的缠论信号变成新的共享组件，
 *    可以共享回测+K线上的买卖点信号计算公式，组件内可以有多种算法和公式，
 *    只要原理相同就行。"
 *
 * ★算法定义（双约束确认式 ZigZag —— 纯划线、零预测、只复盘已收盘K线）：
 *   1) 全市场只看 BTC 本级别K线，一条折线连接交替的【底(买)】与【顶(卖)】；
 *   2) 相邻两点必须同时满足：
 *        ① 距离约束：两点间隔 ≥ MIN_BARS 根K线（默认 40，可调 40~100）
 *        ② 幅度约束：两点涨跌幅 ≥ MIN_AMP %（默认 10%）
 *      ——不满足就"不画线"：中间的小顶小底全部无视，这才是"真正的大底大顶"；
 *   3) 确认规则（无未来函数，纯属事后划线）：
 *        · 找顶中：候选顶 = 段内最高点；当自候选顶回撤 ≥ MIN_AMP%（或跌破前底）
 *          且 距离/幅度约束满足 → 顶确认，回撤最低点成为新底候选；
 *        · 找底中：完全对称（反弹 ≥ MIN_AMP% 或升破前顶 → 底确认）；
 *        · 若价格创新高/新低导致候选点顺延（重锚定），说明旧候选只是途中波折，
 *          大级别转折点永远取极值本身。
 *   4) 组件内多公式（原理相同，都是"双约束极值划线"）：
 *        mode=pct  固定百分比阈值（默认，10% & 40根）
 *        mode=atr  阈值 = max(MIN_AMP%, k*ATR%) —— 波动放大时自动抬高门槛
 *      回测与K线图共用本引擎同一个 analyze() 输出 —— 算法只有这一份。
 *
 * ★每信号附带（用户要求的涨跌家数统计）：
 *   segBars      与前一信号连线的K线根数
 *   segAmp       连线涨跌幅%（带符号，底→顶为正）
 *   segAvgRatio  连线区间平均上涨家数占比%
 *   segFirst/Second/segTrend  区间前半段均占比 / 后半段均占比 / 规律(升/降/平)
 *   nextAmp      到下一个相反信号的涨跌幅（买点=持有到下一点的真实收益）
 *   逐根比例序列（seqNo/ts/up/down/total/upRatio/收盘）由 chan-seq 接口按段懒加载。
 * ========================================================================== */
'use strict';
const KS = require('./kstore');
const ST = require('./updownstore');

const GRANS = ['3m', '5m', '15m', '1h', '2h', '4h'];
const GM = { '3m': 180000, '5m': 300000, '15m': 900000, '1h': 3600000, '2h': 7200000, '4h': 14400000 };
const GRAN_LABEL = { '3m': '3分钟', '5m': '5分钟', '15m': '15分钟', '1h': '1小时', '2h': '2小时', '4h': '4小时' };

/* ---------------- ① 纯算法：双约束确认式 ZigZag ----------------
 * candles: 升序 [{ts,o,h,l,c,v}]
 * 返回: [{i, type:'B'|'T', px}] 交替排列。
 *   ★不变量: 每相邻两点 (a→b) 满足
 *       距离 b.i-a.i ≥ minBars  且  段涨跌幅(按段起点计) |b.px/a.px-1| ≥ minAmp
 *   ★末点 provisional: 末点极值仍可能被后续更极端价格顺延(重锚定),
 *     但「点已确认成立」—— 它的反向回撤/突破证据已满足, 无预测、纯复盘。 */
function detect(candles, opt) {
  opt = opt || {};
  const minBars = Math.max(5, (opt.minBars | 0) || 40);
  const minAmp = Math.max(0.5, +opt.minAmp || 10);
  const mode = opt.mode || 'pct';
  const atrK = +opt.atrK || 3;                    // atr 模式: 阈值 = max(minAmp, atrK*ATR%)
  const n = candles.length;
  if (n < minBars + 3) return [];

  /* 阈值函数: pct 固定; atr 按当前位置波动自适应(只用已收盘历史) */
  const TR = new Array(n);
  TR[0] = 0;
  for (let i = 1; i < n; i++) {
    const pc = candles[i - 1].c;
    TR[i] = pc > 0 ? Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - pc), Math.abs(candles[i].l - pc)) / pc * 100 : 0;
  }
  let atrSum = 0, atrN = 0;
  function thr() {
    if (mode !== 'atr') return minAmp;
    return Math.max(minAmp, atrK * (atrN ? atrSum / atrN : minAmp / atrK));
  }

  /* pts 末点可变(provisional), 倒数第二点起全部 immutable */
  const pts = [{ i: 0, type: 'B', px: candles[0].l }];
  let candI = 0, candP = candles[0].h;            // 相反极值候选(顶/底)
  let runI = 0, runP = candles[0].l;              // 自候选极值以来的反向极值(确认证据)
  for (let i = 1; i < n; i++) {
    const th = thr();
    atrSum += TR[i]; atrN++; if (atrN > 50) atrSum -= TR[i - 50];
    const H = candles[i].h, L = candles[i].l;
    const last = pts[pts.length - 1];
    if (last.type === 'B') {
      /* 锚是底 → 找顶 */
      if (H > candP) { candP = H; candI = i; runP = Infinity; runI = -1; }
      if (L < runP) { runP = L; runI = i; }
      const retrace = (candP - runP) / candP * 100;       // 自候选顶的回撤%
      const dist = candI - last.i;
      const amp = (candP / last.px - 1) * 100;            // 上升段涨幅(按起点底计)
      if ((retrace >= th || L <= last.px) && dist >= minBars && amp >= minAmp) {
        pts.push({ i: candI, type: 'T', px: candP });     // 顶确认(旧底 immutable 化)
        candI = runI >= 0 ? runI : i;                     // 回撤最低点成为新底候选
        candP = runP < Infinity ? runP : L;
        runP = -Infinity; runI = -1;
        continue;
      }
      if (L <= last.px) {
        /* 跌破前底但连线不合格 → 底重锚(末点下移), 候选顶作废 */
        last.i = i; last.px = L;
        candI = i; candP = H;
        runP = Infinity; runI = -1;
      }
    } else {
      /* 锚是顶 → 找底 */
      if (L < candP) { candP = L; candI = i; runP = -Infinity; runI = -1; }
      if (H > runP) { runP = H; runI = i; }
      const bounce = (runP - candP) / candP * 100;        // 自候选底的反弹%
      const dist = candI - last.i;
      const amp = (last.px - candP) / last.px * 100;      // 下跌段跌幅(按起点顶计)
      if ((bounce >= th || H >= last.px) && dist >= minBars && amp >= minAmp) {
        pts.push({ i: candI, type: 'B', px: candP });     // 底确认
        candI = runI >= 0 ? runI : i;
        candP = runP > -Infinity ? runP : H;
        runP = Infinity; runI = -1;
        continue;
      }
      if (H >= last.px) {
        /* 升破前顶但连线不合格 → 顶重锚(末点上移), 候选底作废 */
        last.i = i; last.px = H;
        candI = i; candP = L;
        runP = -Infinity; runI = -1;
      }
    }
  }
  /* ★开放段(未确认): 最后确认点 → 当前相反极值候选。纯事实划线(当前价格所在),
   *   不满足双约束也不影响已确认段 —— 前端画虚线区分。 */
  let openLeg = null;
  {
    const last = pts[pts.length - 1];
    if (candI > last.i && isFinite(candP)) {
      openLeg = {
        fromTs: candles[last.i].ts, fromPx: last.px, fromType: last.type,
        toTs: candles[candI].ts, toPx: candP,
        toType: last.type === 'B' ? 'T' : 'B',
        bars: candI - last.i,
        amp: +((candP / last.px - 1) * 100).toFixed(2)
      };
    }
  }
  return { pts: pts, openLeg: openLeg };
}

/* ---------------- ② 数据装载 ---------------- */
function loadCandles(grain, sinceTs) {
  const files = [];
  try { for (const db of KS.openAllRO(grain, 'BTC-USDT-SWAP')) files.push(db); } catch (e) { }
  const m = new Map();
  for (const db of files) {
    let rows = null;
    try { rows = db.prepare('SELECT ts,o,h,l,c,v FROM kline WHERE ts>=? ORDER BY ts ASC').all(sinceTs || 0); } catch (e) { }
    if (!rows) continue;
    for (const r of rows) {
      if (!isFinite(r.ts) || !isFinite(r.c) || r.c <= 0) continue;
      m.set(r.ts, { ts: r.ts, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v });
    }
  }
  const arr = Array.from(m.values());
  m.clear();
  arr.sort((a, b) => a.ts - b.ts);
  return arr;
}

/* ---------------- ③ 分析主入口（回测+K线共用同一份输出） ---------------- */
const CACHE = new Map();                      // key → {at, data, pts}
const CACHE_TTL = 120000;

function clampOpt(opt) {
  opt = opt || {};
  return {
    grain: GRANS.indexOf(opt.grain) >= 0 ? opt.grain : '5m',
    days: Math.min(760, Math.max(30, parseInt(opt.days, 10) || 730)),
    minBars: Math.min(100, Math.max(40, parseInt(opt.minBars, 10) || 40)),
    minAmp: Math.min(50, Math.max(5, parseFloat(opt.minAmp) || 10)),
    mode: (opt.mode === 'atr') ? 'atr' : 'pct'
  };
}

function ratioOf(a) {
  if (!a || !a.n) return null;
  return +(a.up / a.n * 100).toFixed(2);
}

async function analyze(opt) {
  const o = clampOpt(opt);
  const key = o.grain + '|' + o.days + '|' + o.minBars + '|' + o.minAmp + '|' + o.mode;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  const sinceTs = Date.now() - o.days * 86400000;
  const candles = loadCandles(o.grain, sinceTs);
  if (candles.length < o.minBars + 10) {
    return { ok: false, err: 'K线不足(' + candles.length + '根), 无法划线', grain: o.grain };
  }
  const agg = ST.agg(o.grain, null) || new Map();   // Map<ts,{up,down,flat,n,worst}>

  const t0 = Date.now();
  const det = detect(candles, { minBars: o.minBars, minAmp: o.minAmp, mode: o.mode });
  const pts = det.pts;
  const GMi = GM[o.grain];

  /* 逐信号统计（含与前一点连线区间的涨跌家数比例规律） */
  const signals = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const cd = candles[p.i];
    const a = agg.get(cd.ts) || null;
    const sig = {
      idx: k,
      ts: cd.ts,
      type: p.type,                               // 'B'=底=买 / 'T'=顶=卖
      px: +p.px.toFixed(2),                       // 转折极值价(画线端点)
      close: +cd.c.toFixed(2),                    // 该根收盘
      up: a ? a.up : null,
      down: a ? a.down : null,
      total: a ? a.n : null,
      upRatio: ratioOf(a),
      segBars: 0, segAmp: null,
      segAvgRatio: null, segFirst: null, segSecond: null, segTrend: '',
      segMinRatio: null, segMaxRatio: null,
      nextAmp: null, nextRetC: null
    };
    if (k > 0) {
      const q = pts[k - 1];
      sig.segBars = p.i - q.i;
      /* ★段涨跌幅(带符号, 按段起点计): 底→顶为正(涨), 顶→底为负(跌) */
      sig.segAmp = +((p.px / q.px - 1) * 100).toFixed(2);
      /* 连线区间 = (前一点, 本点] 的逐根占比统计 */
      let s = 0, sn = 0, mn = Infinity, mx = -Infinity;
      let s1 = 0, n1 = 0, s2 = 0, n2 = 0;
      const half = q.i + Math.floor((p.i - q.i) / 2);
      for (let i = q.i + 1; i <= p.i; i++) {
        const r = ratioOf(agg.get(candles[i].ts));
        if (r === null) continue;
        s += r; sn++;
        if (r < mn) mn = r;
        if (r > mx) mx = r;
        if (i <= half) { s1 += r; n1++; } else { s2 += r; n2++; }
      }
      if (sn) {
        sig.segAvgRatio = +(s / sn).toFixed(2);
        sig.segMinRatio = +mn.toFixed(2);
        sig.segMaxRatio = +mx.toFixed(2);
        if (n1 && n2) {
          const f = s1 / n1, sec = s2 / n2;
          sig.segFirst = +f.toFixed(2);
          sig.segSecond = +sec.toFixed(2);
          const d = sec - f;
          sig.segTrend = d > 3 ? '前低后高(升)' : d < -3 ? '前高后低(降)' : '平稳';
        }
      }
    }
    signals.push(sig);
  }
  /* nextAmp / nextRetC（到下一个相反信号） */
  for (let k = 0; k + 1 < signals.length; k++) {
    const cur = signals[k], nx = signals[k + 1];
    cur.nextAmp = nx.segAmp;
    cur.nextRetC = +((nx.close / cur.close - 1) * 100).toFixed(2);
  }

  /* 汇总 */
  let nB = 0, nT = 0, sb = 0, sa = 0, sr = 0, sn = 0;
  const trendCnt = { '前低后高(升)': 0, '前高后低(降)': 0, '平稳': 0, '无': 0 };
  for (const sg of signals) {
    if (sg.type === 'B') nB++; else nT++;
    sb += sg.segBars;
    if (sg.segAmp !== null) { sa += Math.abs(sg.segAmp); sn++; }
    if (sg.segAvgRatio !== null) sr += sg.segAvgRatio;
    trendCnt[sg.segTrend || '无'] = (trendCnt[sg.segTrend || '无'] || 0) + 1;
  }
  const nb = signals.length ? Math.max(1, signals.length) : 1;
  const data = {
    ok: true,
    grain: o.grain, label: GRAN_LABEL[o.grain] || o.grain,
    mode: o.mode, minBars: o.minBars, minAmp: o.minAmp, days: o.days,
    candles: candles.length,
    from: candles.length ? candles[0].ts : 0,
    to: candles.length ? candles[candles.length - 1].ts : 0,
    computeMs: Date.now() - t0,
    signals: signals,                            // 升序(最早→最新)
    openLeg: det.openLeg,                        // 进行中未确认段(虚线)
    stats: {
      total: signals.length, buy: nB, sell: nT,
      avgSegBars: signals.length ? +(sb / nb).toFixed(1) : 0,
      avgSegAmp: sn ? +(sa / sn).toFixed(2) : 0,
      avgSegRatio: signals.length ? +(sr / nb).toFixed(2) : null,
      trendCnt: trendCnt
    },
    at: Date.now()
  };
  CACHE.set(key, { at: Date.now(), data: data, pts: pts, candles: candles });
  if (CACHE.size > 24) {
    const oldest = CACHE.keys().next().value;
    const old = CACHE.get(oldest);
    if (old) old.candles = null;                  // 释放大数组引用
    CACHE.delete(oldest);
  }
  return data;
}

/* ---------------- ④ 单段逐根比例序列（懒加载给明细表） ----------------
 * 返回「信号 ts 之前的那条连线」区间: (前一点, 本点] 逐根K线。 */
async function seq(opt) {
  const o = clampOpt(opt);
  const key = o.grain + '|' + o.days + '|' + o.minBars + '|' + o.minAmp + '|' + o.mode;
  let e = CACHE.get(key);
  if (!e || Date.now() - e.at >= CACHE_TTL) { const r = await analyze(o); if (!r.ok) return r; e = CACHE.get(key); }
  const data = e.data;
  const sigs = data.signals;
  let idx = -1;
  const ts = parseInt(opt.ts, 10) || 0;
  for (let k = 0; k < sigs.length; k++) if (sigs[k].ts === ts) { idx = k; break; }
  if (idx < 0) return { ok: false, err: 'signal not found', grain: o.grain };
  if (idx === 0) return { ok: true, grain: o.grain, ts: ts, rows: [], head: null };

  const candles = (e && e.candles && e.candles.length) ? e.candles : loadCandles(o.grain, Date.now() - o.days * 86400000);
  const agg = ST.agg(o.grain, null) || new Map();
  /* 找信号在 candles 中的下标(与 pts 对齐): 用 ts 精确匹配 */
  let ci = -1;
  {
    /* candles 已是升序, 二分 */
    let lo = 0, hi = candles.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].ts === ts) { ci = mid; break; }
      if (candles[mid].ts < ts) lo = mid + 1; else hi = mid - 1;
    }
  }
  if (ci < 0) return { ok: false, err: 'candle not found', grain: o.grain };
  const prevSig = sigs[idx - 1];
  let pi = -1;
  {
    let lo = 0, hi = Math.min(ci, candles.length - 1);
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].ts === prevSig.ts) { pi = mid; break; }
      if (candles[mid].ts < prevSig.ts) lo = mid + 1; else hi = mid - 1;
    }
  }
  if (pi < 0) pi = Math.max(0, ci - (prevSig.segBars || 0));

  const rows = [];
  let seqNo = 0;
  for (let i = pi + 1; i <= ci; i++) {
    const cd = candles[i];
    const a = agg.get(cd.ts) || null;
    rows.push({
      seqNo: ++seqNo,
      ts: cd.ts,
      up: a ? a.up : null,
      down: a ? a.down : null,
      total: a ? a.n : null,
      upRatio: ratioOf(a),
      c: +cd.c.toFixed(2)
    });
  }
  const sg = sigs[idx];
  return {
    ok: true, grain: o.grain, label: data.label,
    ts: ts, type: sg.type, px: sg.px,
    segBars: sg.segBars, segAmp: sg.segAmp,
    segAvgRatio: sg.segAvgRatio, segFirst: sg.segFirst, segSecond: sg.segSecond,
    segTrend: sg.segTrend, segMinRatio: sg.segMinRatio, segMaxRatio: sg.segMaxRatio,
    rows: rows, at: Date.now()
  };
}

module.exports = { detect, analyze, seq, loadCandles, GRANS, GM, GRAN_LABEL };
