'use strict';
/* ============================================================================
 * bt/all_indicators_inverse.js —— 全指标库 × 去噪漏斗 × 反向回测
 * ----------------------------------------------------------------------------
 * 用户需求（2026-11-07）：「所有股票指标 期货指标统统测一遍」「90%以上亏损
 *   买多卖空」「去掉噪声反转，必须去噪声以后的亏损90%」「5分钟总是亏损核实原因」
 *   「每个月几万笔交易才行」。
 *
 * 【修掉上一版表格的两个问题】
 *   ① 旧 L1 把 layer:"hour"、oosN=0、activeDays=0 的 36 笔组合列为「统计层达标」，
 *      且每笔 -465bp 属极端异常 → 本版强制 IS/OOS 双样本量下限 + 跨月/跨合约分散
 *      + 去尾稳健 + OOS 一致性，缺一不达标。
 *   ② 旧基线 3.26 亿笔是把 1440 个粗组合的同一根 K 线重复下注 → 本版基线按
 *      「每个周期每根 bar 只下注一次」的无条件口径统计，不再跨组合累加。
 *
 * 【去噪】D1 双样本量 / D2 Wilson 上界 / D3 月度稳定 / D4 跨合约分散 /
 *         D5 去尾 1% 稳健 / D6 样本外一致(关键) / D7 反转扣费为正 /
 *         D8 Bonferroni 多重比较。通过 D1~D6 才叫「去噪后 90% 亏损」。
 * 【因果】指标只用 <=i 已收盘 bar；分位边界只用 IS 期采样；收益 = close[i+h]/close[i]-1。
 * 【硬约束】稳定币/零波动标的由 instrument_filter.js 加载后第一时间剔除。
 * 【数据限制】K 线无持仓量 OI / 无基差 / 无盘口，期货 OI 类指标无法真实计算。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const ROOT = __dirname + '/..';
const FILTER = require(__dirname + '/instrument_filter.js');
const IND = require(__dirname + '/indicators.js');
const WEBBT = ROOT + '/web/bt';
/* ★2026-11-07 用户要求彻底删除美股全线 → US_DB 已移除，只保留 OKX 数据源 */
const BUILD = '20261107i1';

const START_MS = Date.parse('2024-11-01T00:00:00Z');
const HARD_END = Date.parse('2026-11-06T00:00:00Z');
const END_MS = Math.min(HARD_END, Date.now());
const SPLIT_MS = Date.parse('2026-03-01T00:00:00Z');
const START_DAY = Math.floor(START_MS / 86400000);
const NDAYS = Math.ceil((END_MS - START_MS) / 86400000) + 2;
const NM = 27;                 /* 2024-11 .. 2026-11 */
const M0 = 2024 * 12 + 10;    /* 月份序号基准(2024-11 => 0) */
const WARM = 60;
const MAXH = 10;
const MAXI = 320;

const TFS = [
  { id: '5m', label: '5分钟', dir: '5m' },
  { id: '15m', label: '15分钟', dir: '15m' },
  { id: '1h', label: '1小时', dir: '1h' }
];
const OPS = [{ id: 'h1', h: 1, name: '次根平' }, { id: 'h5', h: 5, name: '持5根' }, { id: 'h10', h: 10, name: '持10根' }];
const NB = 6, NDIR = 2, NI = IND.NI, NO = OPS.length, NT = TFS.length;
const NK = NT * NI * NO * NB * NDIR;
const FEES = [-2, 0, 2, 5, 10, 20];
const FEE_LABEL = { '-2': 'maker返佣 −2bp', '0': '0bp', '2': '2bp', '5': '5bp', '10': 'taker全费 10bp', '20': '20bp(高费)' };
const SZ = 10; /* n,hit,flat,sum,isN,isHit,oosN,oosHit,isFlat,oosFlat */

/* 门槛（可在环境变量覆盖，便于小规模试跑） */
const LIMIT = +(process.env.AI_LIMIT || 0);       /* 0=全部合约 */
const ONLY_TF = process.env.AI_TF || '';
const STRIDE = Math.max(1, +(process.env.AI_STRIDE || 1));
const RS = 24000;                                  /* 分位采样上限/指标 */
const MIN_IS = 500, MIN_OOS = 300;                 /* D1 */
const MIN_MONTHS = 12, MONTH_LT20 = 0.8;           /* D3 */
const MIN_INSTS = 10, MAX_INST_SHARE = 0.5;        /* D4 */
const TRIM_TAIL = 0.01;                            /* D5 */
const OOS_TARGET = 10;                             /* D6 */
const PASS2_MAX = 1200000;                         /* 逐笔上限 */
const TRADE_JSON_CAP = 6000;

const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const r3 = x => Math.round(x * 1000) / 1000;
const monthIdx = t => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth() - M0; };
const monthKey = t => new Date(t).toISOString().slice(0, 7);
const dayKey = t => new Date(t).toISOString().slice(0, 10);
const dayIdx = t => Math.floor(t / 86400000) - START_DAY;

/* ---------------------------------------------------------------- 数据加载 */
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
    } catch (e) { }
    finally { try { if (db) db.close(); } catch (_) { } }
  }
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}
function listOkxInsts(tfDir) {
  const dir = path.join(ROOT, 'data/okx/kline', tfDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(x => fs.statSync(path.join(dir, x)).isDirectory()).sort();
}
function eachBars(cfg, handler, instLimit, stride) {
  const list = listOkxInsts(cfg.dir).slice(0, instLimit || 1e9);
  for (const inst of list) {
    const bars = loadOkxInst(cfg.dir, inst, END_MS);
    if (!bars.length) continue;
    const ex = FILTER.shouldExclude(inst, bars);
    if (ex) { excluded.push({ tf: cfg.id, inst: inst, src: 'OKX永续', reason: ex.reason, sdBp: ex.sdBp }); continue; }
    handler(inst, 'OKX永续', bars, stride || 1);
  }
  return list.length;
}
const excluded = [];
const instNames = [[], [], []];

/* ---------------------------------------------------------------- Pass0：IS 期采样求分位边界（无前视） */
function quantile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}
function buildBounds() {
  const samples = [], counts = [];
  for (let tf = 0; tf < NT; tf++) { samples.push([]); counts.push(new Uint32Array(NI)); for (let k = 0; k < NI; k++) samples[tf].push(new Float64Array(RS)); }
  for (let ti = 0; ti < NT; ti++) {
    const cfg = TFS[ti];
    if (ONLY_TF && cfg.id !== ONLY_TF && cfg.dir !== ONLY_TF) continue;
    /* 抽样 45 个合约即可稳定求 6 分位，避免重复全量计算 */
    const all = listOkxInsts(cfg.dir);
    const pick = all.filter((_, i) => i % Math.max(1, Math.floor(all.length / 45)) === 0).slice(0, 45);
    for (const inst of pick) {
      const bars = loadOkxInst(cfg.dir, inst, SPLIT_MS);   /* 只用 IS 期 */
      if (bars.length < WARM + 20) continue;
      if (FILTER.shouldExclude(inst, bars)) continue;
      const R = IND.compute(bars, null);
      for (let i = WARM; i < R.n; i += 3) {
        for (let k = 0; k < NI; k++) {
          const cnt = counts[ti][k], a = samples[ti][k], v = R.inds[k][i];
          if (cnt < RS) a[cnt] = v;
          else { const j = (Math.random() * (cnt + 1)) | 0; if (j < RS) a[j] = v; }
          counts[ti][k] = cnt + 1;
        }
      }
    }
  }
  const bounds = [];
  for (let tf = 0; tf < NT; tf++) {
    const per = [];
    for (let k = 0; k < NI; k++) {
      const n = Math.min(counts[tf][k], RS);
      const a = Array.from(samples[tf][k].subarray(0, Math.max(1, n))).sort((x, y) => x - y);
      per.push([1, 2, 3, 4, 5].map(q => quantile(a, q / NB)));
    }
    bounds.push(per);
  }
  return bounds;
}
function bucketsAt(R, i, bounds, tf) {
  const out = new Uint8Array(NI);
  for (let k = 0; k < NI; k++) {
    const v = R.inds[k][i], b = bounds[tf][k];
    let q = 0;
    while (q < 5 && v > b[q]) q++;
    out[k] = q;
  }
  return out;
}

/* ---------------------------------------------------------------- 直方图（在线分布，不存逐笔） */
const HB = 4001, HC = 2000;                 /* -2000..+2000 bp, 1bp */
function mkHist() { return new Float64Array(HB); }
function histAdd(h, v) { let x = Math.round(v) + HC; if (x < 0) x = 0; if (x >= HB) x = HB - 1; h[x] += 1; }
function histQ(h, p) {
  let tot = 0; for (let i = 0; i < HB; i++) tot += h[i];
  if (!tot) return null;
  let acc = 0; const target = p * tot;
  for (let i = 0; i < HB; i++) { acc += h[i]; if (acc >= target) return i - HC; }
  return HB - 1 - HC;
}
function histMean(h) { let s = 0, n = 0; for (let i = 0; i < HB; i++) { s += h[i] * (i - HC); n += h[i]; } return n ? s / n : 0; }
function histN(h) { let n = 0; for (let i = 0; i < HB; i++) n += h[i]; return n; }
function histFlat(h) { return h[HC]; }

/* ---------------------------------------------------------------- Pass1：全量粗聚合 + 诊断 */
const C = new Float64Array(NK * SZ);
const mN = new Float64Array(NK * NM), mHit = new Float64Array(NK * NM);
const dN = new Float64Array(NK * NDAYS);
/* 诊断：tf × op × dir 的 ret 直方图；每 tf 的数据质量；每 tf×op 的无条件基线 */
const diagHist = [], diagQual = [], diagMonth = [], diagBase = [];
for (let t = 0; t < NT; t++) {
  diagHist.push([]); diagMonth.push([]); diagBase.push([]);
  for (let o = 0; o < NO; o++) {
    diagHist[t].push([mkHist(), mkHist(), mkHist()]);   /* 0=原始pr, 1=买多ret, 2=卖空ret */
    diagMonth[t].push({}); diagBase[t].push({ n: 0, sum: 0, h: mkHist() });
  }
  diagQual.push({ bars: 0, dupClose: 0, zeroVol: 0, badOHLC: 0, extreme: 0, gapBig: 0, isBars: 0, oosBars: 0, minT: Infinity, maxT: -Infinity, byMonth: {} });
}
let totalBars = 0, instCount = 0;

function keyOf(tf, k, op, buck, d) { return ((((tf * NI + k) * NO + op) * NB + buck) * NDIR + d); }
function decode(k) {
  const d = k % NDIR, buck = Math.floor(k / NDIR) % NB, op = Math.floor(k / (NDIR * NB)) % NO;
  const ind = Math.floor(k / (NDIR * NB * NO)) % NI, tf = Math.floor(k / (NDIR * NB * NO * NI));
  return { tf: tf, ind: ind, op: op, buck: buck, d: d };
}
function updC(k, ret, oos, mi, di) {
  const b = k * SZ;
  C[b] += 1;
  if (ret > 0) C[b + 1] += 1; else if (ret === 0) C[b + 2] += 1;
  C[b + 3] += ret;
  if (oos) { C[b + 6] += 1; if (ret > 0) C[b + 7] += 1; else if (ret === 0) C[b + 9] += 1; }
  else { C[b + 4] += 1; if (ret > 0) C[b + 5] += 1; else if (ret === 0) C[b + 8] += 1; }
  if (mi >= 0 && mi < NM) { mN[k * NM + mi] += 1; if (ret > 0) mHit[k * NM + mi] += 1; }
  if (di >= 0 && di < NDAYS) dN[k * NDAYS + di] += 1;
}

function runPass1(bounds) {
  for (let ti = 0; ti < NT; ti++) {
    const cfg = TFS[ti];
    if (ONLY_TF && cfg.id !== ONLY_TF && cfg.dir !== ONLY_TF) continue;
    const nInst = eachBars(cfg, (inst, src, bars, stride) => {
      const n = bars.length;
      if (n < WARM + MAXH + 5) return;
      instCount++; totalBars += n;
      if (instNames[ti].length < MAXI) instNames[ti].push(inst);
      const Q = diagQual[ti];
      const stepMs = cfg.id === '5m' ? 300000 : cfg.id === '15m' ? 900000 : 3600000;
      for (let i = 0; i < n; i++) {
        const b = bars[i], t = b.t;
        Q.bars++;
        if (t < SPLIT_MS) Q.isBars++; else Q.oosBars++;
        if (t < Q.minT) Q.minT = t; if (t > Q.maxT) Q.maxT = t;
        const mk = monthKey(t); Q.byMonth[mk] = (Q.byMonth[mk] || 0) + 1;
        if (i > 0) { if (b.c === bars[i - 1].c) Q.dupClose++; if (t - bars[i - 1].t > stepMs * 1.5) Q.gapBig++; }
        if (!(b.v > 0)) Q.zeroVol++;
        if (!(b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c) && b.l > 0)) Q.badOHLC++;
      }
      const R = IND.compute(bars, null);
      for (let i = WARM; i < n - MAXH - 1; i += stride) {
        const ci = R.c[i];
        if (!(ci > 0)) continue;
        const t = bars[i].t, oos = t >= SPLIT_MS, mi = monthIdx(t), di = dayIdx(t), mk = monthKey(t);
        const bk = bucketsAt(R, i, bounds, ti);
        for (let o = 0; o < NO; o++) {
          const j = i + OPS[o].h;
          if (!(R.c[j] > 0)) continue;
          const pr = (R.c[j] - ci) / ci * 10000;
          /* 诊断：每根 bar 每个持仓只记一次（不再跨组合重复下注） */
          const H = diagHist[ti][o];
          histAdd(H[0], pr); histAdd(H[1], pr); histAdd(H[2], -pr);
          const DB = diagBase[ti][o]; DB.n++; DB.sum += pr; histAdd(DB.h, pr);
          const mm = diagMonth[ti][o][mk] || (diagMonth[ti][o][mk] = { n: 0, sum: 0, hit: 0 });
          mm.n++; mm.sum += pr; if (pr > 0) mm.hit++;
          if (Math.abs(pr) > 1000) Q.extreme++;
          for (let d = 0; d < NDIR; d++) {
            const ret = d === 0 ? pr : -pr;
            for (let k = 0; k < NI; k++) {
              const key = keyOf(ti, k, o, bk[k], d);
              updC(key, ret, oos, mi, di);
            }
          }
        }
      }
    }, LIMIT || 1e9, STRIDE);
    console.log('PASS1 tf=%s insts=%d bars=%d', cfg.id, nInst, totalBars);
  }
}
function mkOf(t) { return new Date(t).toISOString().slice(0, 7); }

/* ---------------------------------------------------------------- coarse rows */
function coarseRows() {
  const rows = [];
  for (let k = 0; k < NK; k++) {
    const n = C[k * SZ]; if (n < 1) continue;
    const q = decode(k), b = k * SZ;
    const hit = C[b + 1], flat = C[b + 2], sum = C[b + 3];
    const isN = C[b + 4], isHit = C[b + 5], oosN = C[b + 6], oosHit = C[b + 7], isFlat = C[b + 8], oosFlat = C[b + 9];
    let activeMonths = 0, activeDays = 0; const mw = [];
    for (let m = 0; m < NM; m++) { const nn = mN[k * NM + m]; if (nn > 0) { activeMonths++; mw.push(r1(mHit[k * NM + m] / nn * 100)); } }
    for (let d = 0; d < NDAYS; d++) if (dN[k * NDAYS + d] > 0) activeDays++;
    rows.push({
      key: k, tf: TFS[q.tf].id, ind: IND.DEFS[q.ind][0], indName: IND.DEFS[q.ind][1], cat: IND.DEFS[q.ind][2],
      op: OPS[q.op].id, opName: OPS[q.op].name, buck: q.buck, dir: q.d, dirLabel: q.d === 0 ? '买多' : '卖空',
      n: n, hit: hit, flat: flat, sumRet: r1(sum),
      winRate: r2(hit / n * 100), invWinRate: r2((n - hit - flat) / n * 100),
      isN: isN, isHit: isHit, isFlat: isFlat, isWinRate: isN ? r2(isHit / isN * 100) : 0,
      oosN: oosN, oosHit: oosHit, oosFlat: oosFlat, oosWinRate: oosN ? r2(oosHit / oosN * 100) : null,
      invOosWinRate: oosN ? r2((oosN - oosHit - oosFlat) / oosN * 100) : null,
      activeMonths: activeMonths, activeDays: activeDays, perMonth: activeMonths ? r1(n / activeMonths) : 0,
      perDay: activeDays ? r1(n / activeDays) : 0, monthWinRates: mw
    });
  }
  return rows;
}

/* ---------------------------------------------------------------- 统计工具 */
function wilsonUpper(h, n, z) {
  z = z || 1.96;
  if (!n) return 100;
  const p = h / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const e = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return Math.min(100, (c + e) * 100);
}
/* 二项左尾 P(X<=h | n,p0) 正态近似（n>=500 足够） */
function binomLeftTail(h, n, p0) {
  if (!n) return 1;
  const mu = n * p0, sd = Math.sqrt(n * p0 * (1 - p0));
  if (sd < 1e-9) return h <= mu ? 1 : 0;
  const z = (h + 0.5 - mu) / sd;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

/* ---------------------------------------------------------------- Pass2：候选逐笔 + 漏斗在线聚合 */
function runPass2(bounds, pickKeys) {
  const want = new Set(pickKeys);
  const A = new Map();       /* key -> 在线聚合对象 */
  const trades = [];
  for (const k of want) A.set(k, {
    key: k, n: 0, hit: 0, flat: 0, sum: 0, isN: 0, isHit: 0, oosN: 0, oosHit: 0,
    mN: new Float64Array(NM), mHit: new Float64Array(NM), instCnt: new Uint32Array(MAXI),
    absHist: mkHist(), retHist: mkHist(), daySum: new Float64Array(NDAYS), dayCnt: new Float64Array(NDAYS)
  });
  /* 反查索引：ti -> Map( (ind*NO + op)*NDIR + d -> Map(buck -> [key]) )
     避免每根 bar 对 74 指标 × 3 操作 × 2 方向做全量 Map.get */
  const wantByTf = [new Map(), new Map(), new Map()];
  for (const k of want) {
    const q = decode(k);
    const eid = (q.ind * NO + q.op) * NDIR + q.d;
    let bm = wantByTf[q.tf].get(eid);
    if (!bm) { bm = new Map(); wantByTf[q.tf].set(eid, bm); }
    let arr = bm.get(q.buck);
    if (!arr) { arr = []; bm.set(q.buck, arr); }
    arr.push(k);
  }
  const candList = wantByTf.map(m => Array.from(m.entries()).map(([eid, bm]) => ({
    ind: Math.floor(eid / (NO * NDIR)), op: Math.floor((eid % (NO * NDIR)) / NDIR),
    d: eid % NDIR, bm: bm
  })));
  for (let ti = 0; ti < NT; ti++) {
    const cfg = TFS[ti];
    if (ONLY_TF && cfg.id !== ONLY_TF && cfg.dir !== ONLY_TF) continue;
    if (!candList[ti].length) continue;
    eachBars(cfg, (inst, src, bars) => {
      const n = bars.length;
      if (n < WARM + MAXH + 5) return;
      const slot = instNames[ti].indexOf(inst);
      const R = IND.compute(bars, null);
      for (let i = WARM; i < n - MAXH - 1; i++) {
        const ci = R.c[i]; if (!(ci > 0)) continue;
        const t = bars[i].t, oos = t >= SPLIT_MS, mi = monthIdx(t), di = dayIdx(t);
        const bk = bucketsAt(R, i, bounds, ti);
        const pr = new Float64Array(NO), cj = new Float64Array(NO);
        for (let o = 0; o < NO; o++) { const j = i + OPS[o].h; cj[o] = R.c[j]; pr[o] = cj[o] > 0 ? (cj[o] - ci) / ci * 10000 : 0; }
        const iso = new Date(t).toISOString(), mk = monthKey(t), dk = dayKey(t);
        for (const cd of candList[ti]) {
          if (!(cj[cd.op] > 0)) continue;
          const keys = cd.bm.get(bk[cd.ind]); if (!keys) continue;
          const orig = cd.d === 0 ? pr[cd.op] : -pr[cd.op], ret = -orig;
          for (const kk of keys) {
            const a = A.get(kk);
            a.n++; if (ret > 0) a.hit++; else if (ret === 0) a.flat++;
            a.sum += ret;
            if (oos) { a.oosN++; if (ret > 0) a.oosHit++; }
            else { a.isN++; if (ret > 0) a.isHit++; }
            if (mi >= 0 && mi < NM) { a.mN[mi]++; if (ret > 0) a.mHit[mi]++; }
            if (slot >= 0 && slot < MAXI) a.instCnt[slot]++;
            histAdd(a.absHist, Math.abs(ret)); histAdd(a.retHist, ret);
            if (di >= 0 && di < NDAYS) { a.dayCnt[di]++; a.daySum[di] += ret; }
            if (trades.length < PASS2_MAX) trades.push({
              t: t, iso: iso, day: dk, month: mk,
              tf: cfg.id, inst: inst, src: src, ind: IND.DEFS[cd.ind][0], indName: IND.DEFS[cd.ind][1],
              cat: IND.DEFS[cd.ind][2], op: OPS[cd.op].id, h: OPS[cd.op].h, buck: bk[cd.ind],
              dir: cd.d, dirLabel: cd.d === 0 ? '买多' : '卖空', origRet: r2(orig), ret: r2(ret),
              c0: ci, c1: cj[cd.op], oos: oos, key: kk
            });
          }
        }
      }
    }, LIMIT || 1e9, 1);
  }
  return { A: A, trades: trades, truncated: trades.length >= PASS2_MAX };
}

/* ---------------------------------------------------------------- 去噪漏斗 */
/* 口径说明：coarse row 记的是「原方向」逐笔（未反转），a 记的是「反转后」逐笔。
   D1/D2/D6/D8 一律用 coarse row 的精确原方向统计；D3/D4/D5 用 Pass2 在线聚合。 */
function denoise(row, a, nTests) {
  const isN = row.isN, oosN = row.oosN;
  const origIsWin = row.isWinRate, origOosWin = row.oosWinRate;
  /* D1 双样本量：杜绝旧版 oosN=0 / isN=2 的伪极值 */
  const d1 = isN >= MIN_IS && oosN >= MIN_OOS;
  /* D2 Wilson 95% 上界：原方向 IS 胜率统计上确实 <10% */
  const wUpOrig = wilsonUpper(row.isHit, isN, 1.96);
  const d2 = d1 && wUpOrig < 10;
  /* D3 月度稳定：≥12 个月有样本，且 ≥80% 月份「原方向胜率<20%」
     （a.mHit 是反转后命中，反转胜率≥80% 是原胜率≤20% 的保守判定，平局计入未达标） */
  let months = 0, monthsOrigLow = 0;
  for (let m = 0; m < NM; m++) if (a.mN[m] > 0) {
    months++;
    if (a.mHit[m] / a.mN[m] * 100 >= 80) monthsOrigLow++;
  }
  const d3 = months >= MIN_MONTHS && monthsOrigLow / Math.max(1, months) >= MONTH_LT20;
  /* D4 跨合约分散：不能被单个极端合约带偏 */
  let insts = 0, maxShare = 0, tot = 0;
  for (let s = 0; s < MAXI; s++) if (a.instCnt[s] > 0) { insts++; tot += a.instCnt[s]; if (a.instCnt[s] > maxShare) maxShare = a.instCnt[s]; }
  const d4 = insts >= MIN_INSTS && (tot ? maxShare / tot : 1) < MAX_INST_SHARE;
  /* D5 去尾稳健：剔除 |收益| 最大 1% 后，原方向胜率仍 <15%（排除单位跳变/异常报价） */
  const hn = histN(a.absHist);
  let cut = HC, acc = 0; const target = hn * (1 - TRIM_TAIL);
  for (let i = 0; i < HB; i++) { acc += a.absHist[i]; if (acc >= target) { cut = i - HC; break; } }
  let trimN = 0, trimHit = 0, trimFlat = 0;
  for (let i = Math.max(0, HC - cut); i <= Math.min(HB - 1, HC + cut); i++) {
    const c = a.retHist[i]; if (!c) continue;
    trimN += c; if (i > HC) trimHit += c; else if (i === HC) trimFlat += c;
  }
  const trimOrigWin = trimN ? (trimN - trimHit - trimFlat) / trimN * 100 : 100;
  const d5 = trimN > 0 && trimOrigWin < 15;
  /* D6 样本外一致性（最关键）：原方向 OOS 胜率必须也 <10% */
  const d6 = oosN >= MIN_OOS && origOosWin !== null && origOosWin < OOS_TARGET;
  /* D7 反转扣费：由后续反向回测精确给出，此处占位 */
  const d7 = false;
  /* D8 Bonferroni：二项左尾检验「原方向 IS 胜率显著低于 10%」 */
  const p = binomLeftTail(row.isHit, isN, 0.10);
  const alpha = 0.05 / Math.max(1, nTests);
  const d8 = p < alpha;
  const passed = [d1, d2, d3, d4, d5, d6, d8];
  return {
    key: row.key, tf: row.tf, ind: row.ind, indName: row.indName, cat: row.cat, op: row.op, buck: row.buck,
    dirLabel: row.dirLabel, isN: isN, oosN: oosN,
    origIsWin: origIsWin, origOosWin: origOosWin,
    invIsWin: r2((isN - row.isHit - row.isFlat) / Math.max(1, isN) * 100),
    invOosWin: row.invOosWinRate === null ? null : row.invOosWinRate,
    wilsonOrigUpper: r2(wUpOrig), months: months, monthsOrigLow: monthsOrigLow,
    insts: insts, maxInstShare: r2(tot ? maxShare / tot * 100 : 100),
    trimN: trimN, trimOrigWin: r2(trimOrigWin), trimInvWin: r2(trimN ? trimHit / trimN * 100 : 0),
    binomP: p, bonferroniAlpha: alpha,
    D1: d1, D2: d2, D3: d3, D4: d4, D5: d5, D6: d6, D7: d7, D8: d8,
    passedCount: passed.filter(Boolean).length,
    strict: d1 && d2 && d3 && d4 && d5 && d6 && d8,
    near: d1 && d2 && d3 && d4 && d5 && !d6
  };
}

/* ---------------------------------------------------------------- 反向回测打包 */
function kpiOf(tr) {
  const n = tr.length; if (!n) return null;
  let hit = 0, flat = 0, sum = 0, isN = 0, isHit = 0, oosN = 0, oosHit = 0, oosSum = 0, win = 0, loss = 0;
  for (const t of tr) {
    if (t.ret > 0) { hit++; win += t.ret; } else if (t.ret === 0) flat++; else loss += t.ret;
    sum += t.ret;
    if (t.oos) { oosN++; if (t.ret > 0) oosHit++; oosSum += t.ret; }
    else { isN++; if (t.ret > 0) isHit++; }
  }
  const feeNets = {}; for (const f of FEES) feeNets[f] = r1(sum - f * n);
  const oosFeeNets = {}; for (const f of FEES) oosFeeNets[f] = r1(oosSum - f * oosN);
  return {
    n: n, hit: hit, flat: flat, winRate: r2(hit / n * 100), sumBp: r1(sum), avgBp: r3(sum / n),
    profitFactor: loss < 0 ? r2(win / -loss) : null, maxWinBp: 0, maxLossBp: 0,
    isN: isN, isWinRate: isN ? r2(isHit / isN * 100) : null,
    oosN: oosN, oosWinRate: oosN ? r2(oosHit / oosN * 100) : null,
    oosSumBp: r1(oosSum), feeNets: feeNets, oosFeeNets: oosFeeNets,
    netMakerBp: feeNets[-2], netTakerBp: feeNets[10], checksum: r1(sum)
  };
}
function curveOf(tr) {
  const byDay = new Map();
  for (const t of tr) { const o = byDay.get(t.day) || { n: 0, sum: 0 }; o.n++; o.sum += t.ret; byDay.set(t.day, o); }
  const days = Array.from(byDay.keys()).sort();
  const points = [], feePoints = {}, cumN = [];
  for (const f of FEES) feePoints[f] = [];
  let cum = 0, equity = 100, peak = 100, mdd = 0, accN = 0;
  for (const d of days) {
    const o = byDay.get(d);
    cum += o.sum; accN += o.n;
    const dayRet = o.n ? (o.sum / o.n) / 10000 : 0;   /* 当日等权分散，不是全仓串行 */
    equity *= (1 + dayRet);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak * 100 : 0;
    if (dd > mdd) mdd = dd;
    points.push({ d: d, n: o.n, cumBp: r1(cum), equity: r3(equity) });
    cumN.push(accN);
    for (const f of FEES) feePoints[f].push({ d: d, cumBp: r1(cum - f * accN) });
  }
  return { points: points, feePoints: feePoints, days: days.length,
    finalBp: r1(cum), compoundPct: r2(equity - 100), maxDrawdownPct: r2(mdd),
    avgPerDay: days.length ? r1(tr.length / days.length) : 0, maxPerDay: Math.max(...Array.from(byDay.values()).map(x => x.n)) };
}
function pack(tr, label) {
  const k = kpiOf(tr);
  if (!k) return { label: label, kpi: null, curve: null, monthlyBars: [], tradeBars: [], trades: [], tradesTotal: 0 };
  const byMonth = new Map();
  for (const t of tr) { const o = byMonth.get(t.month) || { n: 0, sum: 0, hit: 0 }; o.n++; o.sum += t.ret; if (t.ret > 0) o.hit++; byMonth.set(t.month, o); }
  const months = Array.from(byMonth.keys()).sort();
  const monthlyBars = []; let mc = 0;
  for (const m of months) { const o = byMonth.get(m); mc += o.sum; monthlyBars.push({ d: m, n: o.n, winRate: r2(o.hit / o.n * 100), ret: r1(o.sum), cumBp: r1(mc) }); }
  const sorted = tr.slice().sort((a, b) => a.t - b.t);
  const step = Math.max(1, Math.ceil(sorted.length / 400));
  const tradeBars = []; let tc = 0, idx = 0;
  for (let i = 0; i < sorted.length; i++) {
    tc += sorted[i].ret;
    if (i % step === 0 || i === sorted.length - 1) tradeBars.push({ i: idx++, d: sorted[i].iso, ret: r1(sorted[i].ret), cumBp: r1(tc) });
  }
  return { label: label, kpi: k, curve: curveOf(sorted), monthlyBars: monthlyBars, tradeBars: tradeBars,
    trades: sorted.slice(0, TRADE_JSON_CAP).map(t => ({ iso: t.iso, tf: t.tf, inst: t.inst, ind: t.ind, op: t.op, buck: t.buck,
      dirLabel: t.dirLabel, c0: t.c0, c1: t.c1, origRet: t.origRet, ret: t.ret, oos: t.oos })),
    tradesTotal: tr.length, tradesTruncated: tr.length > TRADE_JSON_CAP, checksum: k.checksum };
}

/* ---------------------------------------------------------------- 5m 诊断 */
function tfDiagnostics() {
  const out = [];
  for (let ti = 0; ti < NT; ti++) {
    const cfg = TFS[ti], Q = diagQual[ti];
    const h1 = diagHist[ti][0][0];
    const prQ = { p1: histQ(h1, .01), p5: histQ(h1, .05), p25: histQ(h1, .25), p50: histQ(h1, .5), p75: histQ(h1, .75), p95: histQ(h1, .95), p99: histQ(h1, .99) };
    const feeSens = FEES.map(f => ({ fee: f, perTradeNetBp: r3(histMean(h1) - f), totalNetBp: r1((histMean(h1) - f) * histN(h1)) }));
    const monthly = Object.keys(diagMonth[ti][0]).sort().map(m => ({ m: m, n: diagMonth[ti][0][m].n, sumBp: r1(diagMonth[ti][0][m].sum), winRate: r2(diagMonth[ti][0][m].hit / diagMonth[ti][0][m].n * 100) }));
    out.push({
      tf: cfg.id, label: cfg.label, bars: Q.bars, isBars: Q.isBars, oosBars: Q.oosBars,
      isPct: Q.bars ? r2(Q.isBars / Q.bars * 100) : 0,
      from: Q.minT < Infinity ? new Date(Q.minT).toISOString() : null,
      to: Q.maxT > -Infinity ? new Date(Q.maxT).toISOString() : null,
      retMeanBp: r3(histMean(h1)), retMedianBp: histQ(h1, .5), retP25Bp: histQ(h1, .25), retP75Bp: histQ(h1, .75),
      retP1Bp: prQ.p1, retP99Bp: prQ.p99, retQuantiles: prQ,
      flatRatePct: r2(histFlat(h1) / Math.max(1, histN(h1)) * 100),
      dupClosePct: r2(Q.dupClose / Math.max(1, Q.bars) * 100),
      zeroVolPct: r2(Q.zeroVol / Math.max(1, Q.bars) * 100),
      extremePct: r2(Q.extreme / Math.max(1, Q.bars) * 100),
      gapBig: Q.gapBig, badOHLC: Q.badOHLC,
      feeSensitivity: feeSens, monthly: monthly,
      byMonthBars: Q.byMonth,
      buyMeanBp: r3(histMean(diagHist[ti][0][1])), sellMeanBp: r3(histMean(diagHist[ti][0][2]))
    });
  }
  return out;
}

/* ---------------------------------------------------------------- Pareto 前沿 */
function pareto(rows) {
  const bands = [
    { id: '<1k', lo: 0, hi: 1000 }, { id: '1k~1w', lo: 1000, hi: 10000 },
    { id: '1w~3w', lo: 10000, hi: 30000 }, { id: '3w~10w', lo: 30000, hi: 100000 },
    { id: '>10w', lo: 100000, hi: Infinity }
  ];
  const out = bands.map(b => {
    const s = rows.filter(r => r.perMonth >= b.lo && r.perMonth < b.hi && r.n >= 100);
    const min = s.length ? Math.min.apply(null, s.map(r => r.winRate)) : null;
    return { band: b.id, minPerMonth: b.lo, maxPerMonth: b.hi === Infinity ? null : b.hi,
      combos: s.length, minWinRate: min === null ? null : r2(min),
      combosLt10: s.filter(r => r.winRate < 10).length,
      combosLt5: s.filter(r => r.winRate < 5).length };
  });
  const hf = rows.filter(r => r.perMonth >= 30000 && r.n >= 100);
  const frontier = [];
  const sorted = rows.filter(r => r.n >= 100).slice().sort((a, b) => b.perMonth - a.perMonth);
  let best = 100;
  for (const r of sorted) { if (r.winRate < best) best = r.winRate; }
  /* 累积前沿：按频次阈值给出可达最低胜率 */
  for (const th of [0, 100, 1000, 5000, 10000, 20000, 30000, 50000, 100000, 300000]) {
    const s = rows.filter(r => r.perMonth >= th && r.n >= 100);
    frontier.push({ atLeastPerMonth: th, combos: s.length, minWinRate: s.length ? r2(Math.min.apply(null, s.map(r => r.winRate))) : null });
  }
  return { bands: out, frontier: frontier,
    tensOfThousands: { requiredPerMonth: 30000, combos: hf.length,
      minWinRate: hf.length ? r2(Math.min.apply(null, hf.map(r => r.winRate))) : null,
      combosLt10: hf.filter(r => r.winRate < 10).length },
    note: '月均笔数 = 组合总笔数 / 有交易的月份数（每个周期每根 bar 只下注一次；不同指标族是同一批交易的不同切分，不可相加）。' };
}

/* ---------------------------------------------------------------- 主流程 */
const T0 = Date.now();
console.log('BUILD %s | NI=%d NK=%d STRIDE=%d LIMIT=%s TF=%s', BUILD, NI, NK, STRIDE, LIMIT || 'ALL', ONLY_TF || 'ALL');
const bounds = buildBounds();
console.log('BOUNDS built in %ss', Math.round((Date.now() - T0) / 1000));
runPass1(bounds);
console.log('PASS1 done %ss bars=%d inst=%d', Math.round((Date.now() - T0) / 1000), totalBars, instCount);
const rows = coarseRows();
console.log('COARSE rows=%d', rows.length);

const diag = tfDiagnostics();
const par = pareto(rows);

/* 候选：IS<10% 且双样本量达标；另取 raw(无约束极值) 与 highFreq(月均>=3w) 代表做对照 */
const isSorted = rows.slice().sort((a, b) => a.isWinRate - b.isWinRate);
const candStrict = isSorted.filter(r => r.isWinRate < 10 && r.isN >= MIN_IS && r.oosN >= MIN_OOS).slice(0, 80);
const candNear = isSorted.filter(r => r.isWinRate < 20 && r.isN >= 200 && r.oosN >= 100 && !candStrict.includes(r)).slice(0, 60);
const rawTop = isSorted.filter(r => r.isWinRate < 5).slice(0, 24);
const hfTop = rows.filter(r => r.perMonth >= 30000).sort((a, b) => a.winRate - b.winRate).slice(0, 8);
const pickKeys = Array.from(new Set([].concat(candStrict, candNear, rawTop, hfTop).map(r => r.key)));
console.log('PICK strictCand=%d nearCand=%d raw=%d hf=%d keys=%d', candStrict.length, candNear.length, rawTop.length, hfTop.length, pickKeys.length);

const P2 = runPass2(bounds, pickKeys);
console.log('PASS2 trades=%d truncated=%s in %ss', P2.trades.length, P2.truncated, Math.round((Date.now() - T0) / 1000));

const denRows = [];
for (const k of pickKeys) {
  const a = P2.A.get(k), row = rows.find(r => r.key === k);
  if (!a || !row || a.n < 1) continue;
  denRows.push(denoise(row, a, rows.length));
}
const strictRows = denRows.filter(d => d.strict);
const nearRows = denRows.filter(d => d.near);
console.log('DENOISE strict=%d near=%d of %d', strictRows.length, nearRows.length, denRows.length);

/* 四组反向回测（逐笔来自 Pass2；反转后 ret 已取反） */
const byKey = new Map();
for (const t of P2.trades) { const arr = byKey.get(t.key) || []; arr.push(t); byKey.set(t.key, arr); }
function groupTrades(keys) { const out = []; for (const k of keys) { const a = byKey.get(k); if (a) out.push.apply(out, a); } return out; }
const groups = {
  strict: { label: '去噪后达标（D1~D6+D8 全过）', keys: strictRows.map(d => d.key), rows: strictRows },
  near: { label: 'IS 达标但样本外回归（对照）', keys: nearRows.map(d => d.key), rows: nearRows },
  raw: { label: '未去噪极值（对照·噪声）', keys: rawTop.map(r => r.key), rows: [] },
  highFreq: { label: '每月几万笔（对照·大数定律）', keys: hfTop.map(r => r.key), rows: [] }
};
const strategies = {};
for (const g of Object.keys(groups)) {
  const tr = groupTrades(groups[g].keys);
  strategies[g] = pack(tr, groups[g].label);
  strategies[g].comboCount = groups[g].keys.length;
  console.log('GROUP %s combos=%d n=%d win=%s oos=%s taker=%s', g, groups[g].keys.length,
    strategies[g].kpi ? strategies[g].kpi.n : 0,
    strategies[g].kpi ? strategies[g].kpi.winRate : 'NA',
    strategies[g].kpi ? strategies[g].kpi.oosWinRate : 'NA',
    strategies[g].kpi ? strategies[g].kpi.netTakerBp : 'NA');
}

/* 每周期分组（面板 5m/15m/1h Tab） */
const periods = {};
for (const cfg of TFS) {
  const pk = pickKeys.filter(k => rows.find(r => r.key === k && r.tf === cfg.id));
  const tr = groupTrades(pk);
  periods[cfg.id] = pack(tr, cfg.label + ' · 全部候选反转');
  periods[cfg.id].comboCount = pk.length;
  periods[cfg.id].diagnostics = diag.find(d => d.tf === cfg.id) || null;
}

/* 诚实结论 */
const d5 = diag.find(d => d.tf === '5m'), d1h = diag.find(d => d.tf === '1h');
const strictN = strictRows.length;
const verdict = {
  target: '买多/卖空双腿均需 原方向胜率<10%（亏损率>90%），且必须通过 D1~D6+D8 去噪漏斗',
  totalCombosTested: rows.length,
  indicatorCount: NI, opsCount: NO, tfCount: NT, searchSpace: NT * NI * NO * NB * NDIR,
  denoiseFunnel: [
    { id: 'D1', name: '双样本量下限', rule: 'IS≥' + MIN_IS + ' 且 OOS≥' + MIN_OOS + ' 笔' },
    { id: 'D2', name: 'Wilson 95% 置信上界', rule: '原方向 IS 胜率上界 <10%' },
    { id: 'D3', name: '月度稳定性', rule: '≥' + MIN_MONTHS + ' 个月有样本，且 ≥80% 月份原胜率 <20%' },
    { id: 'D4', name: '跨合约分散', rule: '≥' + MIN_INSTS + ' 个合约，最大单合约占比 <50%' },
    { id: 'D5', name: '去尾稳健', rule: '剔除 |收益| 最大 1% 后反转胜率仍 >85%' },
    { id: 'D6', name: '样本外一致性(关键)', rule: '原方向 OOS 胜率 <10%' },
    { id: 'D7', name: '反转扣费为正', rule: '反转后 OOS 扣 taker 10bp 净额 >0（由回测给出）' },
    { id: 'D8', name: 'Bonferroni 多重比较', rule: '二项检验 p < 0.05 / ' + rows.length }
  ],
  strictCount: strictN,
  nearCount: nearRows.length,
  rawLt5Count: rows.filter(r => r.isWinRate < 5 && r.isN >= 30).length,
  rawLt10Count: rows.filter(r => r.isWinRate < 10 && r.isN >= 30).length,
  minIsWinRate: isSorted.length ? isSorted[0].isWinRate : null,
  paretoAt30k: par.tensOfThousands,
  guarantee: '否。去噪后仍存在的 90% 亏损必须通过 D6 样本外一致性与 D7 扣费检验；样本内低胜率由方向取反的算术恒等式保证，不是预测能力。',
  conclusion: ''
};
verdict.conclusion =
  '全库 ' + rows.length + ' 个组合（' + NI + ' 指标 × ' + NO + ' 持仓操作 × ' + NB + ' 档 × 双腿 × ' + NT + ' 周期）中，' +
  '未去噪 IS<10% 的有 ' + verdict.rawLt10Count + ' 个，通过完整去噪漏斗(D1~D6+D8)的只有 ' + strictN + ' 个。' +
  (strictN === 0 ? '即「去掉噪声之后仍 90% 亏损」的组合一个都不存在。' : '达标组合反转后表现见「去噪达标」组。') +
  ' 月均≥3万笔的组合最低胜率 ' + (par.tensOfThousands.minWinRate === null ? 'N/A' : par.tensOfThousands.minWinRate + '%') +
  '，其中 <10% 的有 ' + par.tensOfThousands.combosLt10 + ' 个 —— 大数定律下「每月几万笔 + 亏 90%」不可兼得。';

const meta = {
  title: '全指标库 · 去噪 90% 亏损组合 · 反向回测',
  build: BUILD, generated: new Date().toISOString(),
  scope: NI + ' 个股票/期货技术指标 × ' + NO + ' 持仓操作 × ' + NB + ' 档 × 买多/卖空 × ' + NT + ' 周期',
  start: new Date(START_MS).toISOString(), end: new Date(END_MS).toISOString(), split: new Date(SPLIT_MS).toISOString(),
  fees: FEES, feeLabels: FEE_LABEL, bars: totalBars, instruments: instCount,
  stride: STRIDE, limit: LIMIT || null, onlyTf: ONLY_TF || null,
  dataCleaning: { module: 'bt/instrument_filter.js', minSdBp: FILTER.MIN_SD_BP, excludedCount: excluded.length, excluded: excluded },
  dataLimit: 'K 线表只有 ts,o,h,l,c,v —— 无持仓量 OI、无基差、无盘口，期货 OI/期限结构/量仓类指标无法真实计算，已用价量派生族替代。',
  causal: '所有指标只用 <=i 已收盘 bar；分位边界只用 IS 期采样求得；收益 = close[i+h]/close[i]-1（h>=1）；指标库已做截断不变性实证（突变未来 bar，历史指标值全不变）。',
  indicators: IND.DEFS.map(d => ({ id: d[0], name: d[1], cat: d[2], desc: d[3] })),
  ops: OPS, fixedProblems: [
    '旧 L1 混入 layer=hour、oosN=0、activeDays=0 的 36 笔异常组合（每笔 -465bp）→ 本版强制 IS/OOS 双样本量下限 + 跨月/跨合约分散 + 去尾稳健。',
    '旧基线 3.26 亿笔为跨组合重复下注 → 本版每周期每根 bar 只下注一次，基线量级回到真实 K 线数。',
    '旧版段角把 n-1 当段终点导致前视 → 本版指标库改为逐根递推的因果段角。'
  ]
};

const result = {
  meta: meta, rows: rows, denoise: denRows, strictRows: strictRows, nearRows: nearRows,
  strategies: strategies, periods: periods, diagnostics: diag, pareto: par, verdict: verdict,
  rawTop: rawTop.slice(0, 40), highFreqTop: hfTop,
  categoryStats: (() => {
    const m = new Map();
    for (const r of rows) { const o = m.get(r.cat) || { cat: r.cat, combos: 0, minWinRate: 100, lt10: 0, n: 0 }; o.combos++; o.n += r.n; if (r.winRate < o.minWinRate) o.minWinRate = r.winRate; if (r.winRate < 10) o.lt10++; m.set(r.cat, o); }
    return Array.from(m.values()).map(o => ({ ...o, minWinRate: r2(o.minWinRate) }));
  })()
};

const json = JSON.stringify(result);
fs.writeFileSync(path.join(WEBBT, 'all_indicators_inverse.json'), json);

/* 逐笔 CSV（反转后） */
const tv = P2.trades.slice().sort((a, b) => a.t - b.t);
const csv = ['周期,指标,类别,操作,档位,原方向,信号UTC,标的,市场,收盘,平仓收盘,原收益bp,反转收益bp,反转命中,样本外,组合KEY'];
for (const t of tv) csv.push([t.tf, t.ind, t.cat, t.op, 'B' + t.buck, t.dirLabel, t.iso, t.inst, t.src,
  t.c0, t.c1, t.origRet, t.ret, t.ret > 0 ? 1 : 0, t.oos ? 1 : 0, t.key].join(','));
fs.writeFileSync(path.join(WEBBT, 'all_indicators_trades.csv'), csv.join('\n') + '\n');
/* 全组合 CSV */
const gc = ['周期,指标,类别,操作,档位,方向,笔数,命中,平局,胜率%,反转胜率%,IS笔数,IS胜率%,OOS笔数,OOS胜率%,反转OOS胜率%,毛收益bp,活跃月,月均笔数,日均笔数'];
for (const r of rows.slice().sort((a, b) => a.tf < b.tf ? -1 : (a.tf > b.tf ? 1 : a.winRate - b.winRate)))
  gc.push([r.tf, r.ind, r.cat, r.op, 'B' + r.buck, r.dirLabel, r.n, r.hit, r.flat, r.winRate, r.invWinRate,
    r.isN, r.isWinRate, r.oosN, r.oosWinRate === null ? '' : r.oosWinRate, r.invOosWinRate === null ? '' : r.invOosWinRate,
    r.sumRet, r.activeMonths, r.perMonth, r.perDay].join(','));
fs.writeFileSync(path.join(WEBBT, 'all_indicators_grid.csv'), gc.join('\n') + '\n');
/* 去噪漏斗 CSV */
const dc = ['组合KEY,周期,指标,操作,档位,方向,IS笔数,OOS笔数,原IS胜率%,原OOS胜率%,反转IS胜率%,反转OOS胜率%,Wilson上界%,月数,原胜率低的月数,合约数,最大合约占比%,去尾笔数,去尾反转胜率%,二项p,Bonferroniα,D1,D2,D3,D4,D5,D6,D8,严格达标,近达标'];
for (const d of denRows) dc.push([d.key, d.tf, d.ind, d.op, 'B' + d.buck, d.dirLabel, d.isN, d.oosN, d.origIsWin,
  d.origOosWin === null ? '' : d.origOosWin, r2(d.invIsWin), r2(d.invOosWin), d.wilsonOrigUpper, d.months, d.monthsOrigLow,
  d.insts, d.maxInstShare, d.trimN, d.trimInvWin, d.binomP, d.bonferroniAlpha,
  +d.D1, +d.D2, +d.D3, +d.D4, +d.D5, +d.D6, +d.D8, +d.strict, +d.near].join(','));
fs.writeFileSync(path.join(WEBBT, 'all_indicators_denoise.csv'), dc.join('\n') + '\n');

console.log('=== ALL DONE elapsed=%ss jsonBytes=%d', Math.round((Date.now() - T0) / 1000), json.length);
console.log('STRICT=%d NEAR=%d RAW_LT10=%d MIN_IS_WIN=%s', strictN, nearRows.length, verdict.rawLt10Count, verdict.minIsWinRate);
console.log('PARETO >=30k/month combos=%d minWin=%s lt10=%d', par.tensOfThousands.combos, par.tensOfThousands.minWinRate, par.tensOfThousands.combosLt10);
console.log('5m diag: IS%%=%s dupClose%%=%s flat%%=%s medianRet=%s meanRet=%s taker10 net/trade=%s',
  d5 ? d5.isPct : 'NA', d5 ? d5.dupClosePct : 'NA', d5 ? d5.flatRatePct : 'NA',
  d5 ? d5.retMedianBp : 'NA', d5 ? d5.retMeanBp : 'NA', d5 ? d5.feeSensitivity.find(f => f.fee === 10).perTradeNetBp : 'NA');
console.log('VERDICT', verdict.conclusion);
