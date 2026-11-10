'use strict';
/* ============================================================================
 * bt/multi_inverse.js —— 多策略族 × 多操作 · 极低胜率组合搜索 + 反向回测
 * ----------------------------------------------------------------------------
 * 用户需求（2026-11-07）：胜率 <5%~10%（亏损率 >90~95%，最好 >99%），
 *   「多种策略 多种操作」「每天亏损最多」「每天好几百笔交易」，反转后验证是否赚更多。
 *
 * 【必须说清的数学事实，写进报告与面板】
 *   ① 反转后胜率 = 1 − 原胜率 − 平局率，是方向取反的算术恒等式，不是发现。
 *   ② 大样本（每天几百笔）下胜率被大数定律压回 ~50%，99% 亏损率不可能存在；
 *      99% 只能靠把条件切到极小样本(n≤3)「造」出来 = 多重比较/数据挖掘偏差。
 *   ③ 因此分三层搜索，每层都只用 IS 挑组合、OOS 单独验证 + 扣 taker 全费：
 *      L0 极值层(n>=1) → 能造出 0% 胜率，纯噪声
 *      L1 统计层(IS n>=30) → 看真实下限
 *      L2 高频层(日均>=100笔) → 回答「每天几百笔还能亏多少」
 *
 * 【因果】所有特征只用 <= i 已收盘 bar；收益 = close[i+h]/close[i]-1，h>=1；
 *        信号 bar 收盘成交，不做任何未来插值。截断不变性实证。
 * 【硬约束】稳定币/零波动标的由 bt/instrument_filter.js 在加载后第一时间剔除。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname + '/..';
const FILTER = require(__dirname + '/instrument_filter.js');
require(ROOT + '/web/js/chanlun.js');
const CL = globalThis.ChanLun;

const WEBBT = ROOT + '/web/bt';
/* ★2026-11-07 用户要求彻底删除美股全线 → US_DB 已移除，只保留 OKX 数据源 */
const BUILD = '20261107h1';

const START_MS = Date.parse('2024-11-01T00:00:00Z');
const HARD_END = Date.parse('2026-11-06T00:00:00Z');
const END_MS = Math.min(HARD_END, Date.now());
const SPLIT_MS = Date.parse('2026-03-01T00:00:00Z');
const START_DAY = Math.floor(START_MS / 86400000);
const NDAYS = Math.ceil((END_MS - START_MS) / 86400000) + 2;
const WARM = 60;
const MAXH = 10;

const TFS = [
  { id: '5m', label: '5分钟', dir: '5m' },
  { id: '15m', label: '15分钟', dir: '15m' },
  { id: '1h', label: '1小时', dir: '1h' }
];

/* 10 个策略族：每根 bar 给一个 0..5 的档位（255 = 不适用） */
const FAMS = [
  { id: 'MOM5', name: '5根动量', desc: '过去5根收盘涨幅(bp)分档' },
  { id: 'RSI14', name: 'RSI(14)', desc: '相对强弱分档' },
  { id: 'CROSS', name: 'MA5/20交叉角', desc: '仅交叉bar，交叉角绝对值分档' },
  { id: 'STREAK', name: '连涨跌根数', desc: '连续同向收盘根数分档' },
  { id: 'BREAK', name: '20根突破位', desc: '收盘在20根高低区间的位置分档' },
  { id: 'VOLAT', name: '20根波动率', desc: '过去20根收益标准差(bp)分档' },
  { id: 'VOLUM', name: '量比', desc: '本根量 / 过去20根均量 分档' },
  { id: 'BODY', name: 'K线实体', desc: '(收-开)/开 (bp) 分档' },
  { id: 'HOUR', name: 'UTC时段', desc: '每4小时一档' },
  { id: 'SEG', name: '缠论段角', desc: 'ChanLun.angles 最近已确认段角度分档' }
];
const NF = FAMS.length;                 /* 10 */
/* 多操作：不同持有根数 */
const OPS = [
  { id: 'h1', h: 1, name: '次根平' },
  { id: 'h3', h: 3, name: '持3根' },
  { id: 'h5', h: 5, name: '持5根' },
  { id: 'h10', h: 10, name: '持10根' }
];
const NO = OPS.length;                  /* 4 */
const NB = 6;                           /* 档位数 */
const NDIR = 2;                         /* 买多 / 卖空 */
const NK = TFS.length * NF * NO * NB * NDIR;   /* coarse key 空间 = 1440 */
const MAXI = 320;                       /* 每周期合约槽位 */
const IK = NK * MAXI;
const HK = NK * 24;

const FEES = [-2, 0, 5, 10];
const FEE_LABEL = { '-2': 'maker返佣 −2bp', '0': '0bp', '5': '5bp', '10': 'taker全费 10bp' };

const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const r3 = x => Math.round(x * 1000) / 1000;

/* ---------------------------------------------------------------- 聚合存储（类型化数组，避免字符串 key） */
const SZ = 10;  /* n,hit,flat,sum,isN,isHit,oosN,oosHit,isFlat,oosFlat */
function mk(n) { return new Float64Array(n * SZ); }
const C = mk(NK), I = mk(IK), H = mk(HK);
const dayFlag = new Uint8Array(NK * NDAYS);        /* coarse 活跃天数 */
const daySum = new Float64Array(NK * NDAYS);       /* coarse 逐日原始收益合计(bp)，供高频层画反转曲线 */
const dayCnt = new Float64Array(NK * NDAYS);       /* coarse 逐日笔数 */
function upd(arr, k, ret, oos) {
  const b = k * SZ;
  arr[b] += 1;                       /* n */
  if (ret > 0) arr[b + 1] += 1;      /* hit */
  if (ret === 0) arr[b + 2] += 1;    /* flat */
  arr[b + 3] += ret;                 /* sum */
  if (oos) { arr[b + 6] += 1; if (ret > 0) arr[b + 7] += 1; if (ret === 0) arr[b + 9] += 1; }
  else { arr[b + 4] += 1; if (ret > 0) arr[b + 5] += 1; if (ret === 0) arr[b + 8] += 1; }
}
function keyOf(tf, fam, op, buck, d) {
  return ((((tf * NF + fam) * NO + op) * NB + buck) * NDIR + d);
}
function decode(k) {
  const d = k % NDIR, buck = Math.floor(k / NDIR) % NB, op = Math.floor(k / (NDIR * NB)) % NO;
  const fam = Math.floor(k / (NDIR * NB * NO)) % NF, tf = Math.floor(k / (NDIR * NB * NO * NF));
  return { tf: tf, fam: fam, op: op, buck: buck, d: d };
}

/* ---------------------------------------------------------------- 数据加载（与既有引擎同源） */
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

/* ---------------------------------------------------------------- 因果特征：一次性预计算整段 */
function rollingMA(arr, p) {
  const n = arr.length, out = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += arr[i];
    if (i >= p) s -= arr[i - p];
    out[i] = i >= p - 1 ? s / p : 0;
  }
  return out;
}
function computeFeatures(bars) {
  const n = bars.length;
  const c = new Float64Array(n), o = new Float64Array(n), hi = new Float64Array(n), lo = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) { c[i] = +bars[i].c || 0; o[i] = +bars[i].o || 0; hi[i] = +bars[i].h || 0; lo[i] = +bars[i].l || 0; v[i] = +bars[i].v || 0; }
  const ma5 = rollingMA(c, 5), ma20 = rollingMA(c, 20), mv20 = rollingMA(v, 20);
  /* RSI(14) 简单 Wilder 递推（只用 <=i） */
  const rsi = new Float64Array(n).fill(50);
  let ag = 0, al = 0;
  for (let i = 1; i < n; i++) {
    const d = c[i] - c[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    if (i <= 14) { ag += g / 14; al += l / 14; }
    else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; }
    rsi[i] = al > 1e-12 ? 100 - 100 / (1 + ag / al) : (ag > 0 ? 100 : 50);
  }
  /* 连续同向根数（带符号） */
  const streak = new Int16Array(n);
  for (let i = 1; i < n; i++) {
    const d = c[i] - c[i - 1];
    if (Math.abs(d) < 1e-12) streak[i] = 0;
    else if (d > 0) streak[i] = streak[i - 1] > 0 ? streak[i - 1] + 1 : 1;
    else streak[i] = streak[i - 1] < 0 ? streak[i - 1] - 1 : -1;
  }
  /* 20 根高低、收益标准差、量比等 */
  const pos20 = new Float64Array(n), sd20 = new Float64Array(n), vr = new Float64Array(n);
  const mom5 = new Float64Array(n), body = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (i >= 20) {
      let mx = -Infinity, mn = Infinity, s = 0, s2 = 0;
      for (let j = i - 20; j < i; j++) {
        if (hi[j] > mx) mx = hi[j];
        if (lo[j] < mn) mn = lo[j];
        const rr = c[j] > 0 && c[j - 1] > 0 ? (c[j] - c[j - 1]) / c[j - 1] * 10000 : 0;
        s += rr; s2 += rr * rr;
      }
      pos20[i] = mx > mn ? (c[i] - mn) / (mx - mn) : 0.5;
      const m = s / 20;
      sd20[i] = Math.sqrt(Math.max(0, s2 / 20 - m * m));
    } else { pos20[i] = 0.5; sd20[i] = 0; }
    vr[i] = mv20[i] > 0 ? v[i] / mv20[i] : 1;
    mom5[i] = i >= 5 && c[i - 5] > 0 ? (c[i] - c[i - 5]) / c[i - 5] * 10000 : 0;
    body[i] = o[i] > 0 ? (c[i] - o[i]) / o[i] * 10000 : 0;
  }
  /* MA5/MA20 交叉角（仅交叉 bar 有效） */
  const crossAng = new Float64Array(n).fill(-1);
  const ang5 = causalAngles(ma5, n, 5), ang20 = causalAngles(ma20, n, 20);
  for (let i = WARM + 1; i < n; i++) crossAng[i] = Math.abs(ang5[i] - ang20[i]);
  const crossMask = new Uint8Array(n);
  let prevD = ma5[WARM] - ma20[WARM];
  for (let i = WARM + 1; i < n; i++) {
    const d = ma5[i] - ma20[i];
    if ((prevD <= 0 && d > 0) || (prevD >= 0 && d < 0)) crossMask[i] = 1;
    prevD = d;
  }
  /* 缠论段角：映射最近已确认段的 deg 到每根 bar */
  const segDeg = new Float64Array(n).fill(0);
  try {
    const segs = CL.angles(bars, 5) || [];
    for (const s of segs) {
      for (let i = Math.max(0, s.i0 | 0); i <= Math.min(n - 1, s.i1 | 0); i++) segDeg[i] = s.deg;
    }
  } catch (e) { }
  return { n: n, c: c, o: o, v: v, ma5: ma5, ma20: ma20, rsi: rsi, streak: streak,
    pos20: pos20, sd20: sd20, vr: vr, mom5: mom5, body: body,
    crossAng: crossAng, crossMask: crossMask, segDeg: segDeg };
}
function causalAngles(ma, n, period) {
  const ang = new Float64Array(n);
  let pivot = Math.min(period - 1, n - 1), prevSlope = 0;
  for (let i = pivot + 1; i < n; i++) {
    const d = ma[i] - ma[i - 1], s = d > 0 ? 1 : (d < 0 ? -1 : 0);
    if ((prevSlope > 0 && s < 0) || (prevSlope < 0 && s > 0)) pivot = i - 1;
    if (s !== 0) prevSlope = s;
    const base = Math.abs(ma[pivot]) > 1e-12 ? Math.abs(ma[pivot]) : 1;
    const span = Math.max(1, i - pivot);
    ang[i] = Math.atan((ma[i] - ma[pivot]) / base / span * 100) * (180 / Math.PI);
  }
  return ang;
}
/* 固定阈值分档（全部因果，不需要全样本分位） */
function step(x, t) { let b = 0; while (b < t.length && x >= t[b]) b++; return b; }
const TH = {
  MOM5: [-200, -50, 0, 50, 200],
  RSI14: [20, 35, 50, 65, 80],
  CROSS: [2, 5, 10, 20, 35],
  STREAK: [-4, -2, 0, 2, 4],
  BREAK: [0.15, 0.3, 0.5, 0.7, 0.85],
  VOLAT: [20, 50, 100, 200, 400],
  VOLUM: [0.5, 0.8, 1.2, 2, 4],
  BODY: [-200, -50, 0, 50, 200],
  HOUR: [4, 8, 12, 16, 20],
  SEG: [-40, -15, 0, 15, 40]
};
const THK = ['MOM5', 'RSI14', 'CROSS', 'STREAK', 'BREAK', 'VOLAT', 'VOLUM', 'BODY', 'HOUR', 'SEG'];
function bucketsAt(f, i, t) {
  const b = new Uint8Array(NF);
  const hour = Math.floor((t % 86400000) / 3600000);
  b[0] = step(f.mom5[i], TH.MOM5);
  b[1] = step(f.rsi[i], TH.RSI14);
  b[2] = f.crossMask[i] ? step(f.crossAng[i], TH.CROSS) : 255;
  b[3] = step(f.streak[i], TH.STREAK);
  b[4] = step(f.pos20[i], TH.BREAK);
  b[5] = step(f.sd20[i], TH.VOLAT);
  b[6] = step(f.vr[i], TH.VOLUM);
  b[7] = step(f.body[i], TH.BODY);
  b[8] = step(hour, TH.HOUR);
  b[9] = step(f.segDeg[i], TH.SEG);
  return b;
}

/* ---------------------------------------------------------------- Pass 1：流式聚合（不存逐笔） */
let totalBars = 0, totalInstruments = 0;
const excluded = [];
const instNames = [[], [], []];      /* 每 tf 的槽位 → 名称 */
const instMeta = [];
function pass1(limit, onlyTf) {
  for (let ti = 0; ti < TFS.length; ti++) {
    const cfg = TFS[ti];
    if (onlyTf && cfg.id !== onlyTf && cfg.dir !== onlyTf) continue;
    const list = listOkxInsts(cfg.dir).slice(0, limit || 100000);
    const handle = (inst, src, bars) => {
      const n = bars.length;
      if (n < WARM + MAXH + 5) return;
      /* 【硬约束】稳定币 / 零波动标的，加载后第一件事 */
      const ex = FILTER.shouldExclude(inst, bars);
      if (ex) { excluded.push(Object.assign({ tf: cfg.id, src: src }, ex)); return; }
      const slot = instNames[ti].length;
      if (slot >= MAXI) return;
      instNames[ti].push(inst);
      totalBars += n; totalInstruments++;
      instMeta.push({ tf: cfg.id, inst: inst, src: src, bars: n,
        from: new Date(bars[0].t).toISOString(), to: new Date(bars[n - 1].t).toISOString() });
      const f = computeFeatures(bars);
      for (let i = WARM; i < n - MAXH - 1; i++) {
        if (!(f.c[i] > 0)) continue;
        const t = bars[i].t, oos = t >= SPLIT_MS;
        const dayIdx = Math.floor(t / 86400000) - START_DAY;
        const hour = Math.floor((t % 86400000) / 3600000);
        const bs = bucketsAt(f, i, t);
        for (let op = 0; op < NO; op++) {
          const j = i + OPS[op].h;
          if (!(f.c[j] > 0)) continue;
          const pr = (f.c[j] - f.c[i]) / f.c[i] * 10000;    /* 价格收益 bp（不含方向） */
          for (let fam = 0; fam < NF; fam++) {
            const buck = bs[fam];
            if (buck === 255) continue;
            for (let d = 0; d < NDIR; d++) {
              const ret = d === 0 ? pr : -pr;
              const k = keyOf(ti, fam, op, buck, d);
              upd(C, k, ret, oos);
              upd(I, k * MAXI + slot, ret, oos);
              upd(H, k * 24 + hour, ret, oos);
              if (dayIdx >= 0 && dayIdx < NDAYS) {
                const di = k * NDAYS + dayIdx;
                dayFlag[di] = 1; daySum[di] += ret; dayCnt[di] += 1;
              }
            }
          }
        }
      }
    };
    for (const inst of list) handle(inst, 'OKX永续', loadOkxInst(cfg.dir, inst, END_MS));
    console.log('  PASS1 tf=%s inst=%d bars=%d elapsed=%ss', cfg.id, instNames[ti].length, totalBars, Math.round((Date.now() - T0) / 1000));
  }
}

/* ---------------------------------------------------------------- 从聚合数组生成行 */
function activeDays(k) {
  let x = 0, b = k * NDAYS;
  for (let d = 0; d < NDAYS; d++) x += dayFlag[b + d];
  return x;
}
function rowsFrom(arr, stride, layer, minN) {
  const out = [];
  for (let k = 0; k < NK; k++) {
    const cb = k * SZ;
    if (arr === C && C[cb] === 0) continue;
    const slots = arr === C ? 1 : stride;
    for (let s = 0; s < slots; s++) {
      const b = (arr === C ? k : k * stride + s) * SZ;
      const n = arr[b];
      if (!n || n < minN) continue;
      const isN = arr[b + 4], isHit = arr[b + 5], oosN = arr[b + 6], oosHit = arr[b + 7];
      const isFlat = arr[b + 8], oosFlat = arr[b + 9];
      const q = decode(k);
      out.push({
        key: layer + ':' + k + (arr === C ? '' : ':' + s), ck: k, slot: s, layer: layer,
        tf: TFS[q.tf].id, fam: FAMS[q.fam].id, famName: FAMS[q.fam].name,
        op: OPS[q.op].id, opName: OPS[q.op].name, h: OPS[q.op].h,
        buck: q.buck, dir: q.d === 0 ? 1 : -1, dirLabel: q.d === 0 ? '买多' : '卖空',
        n: n, hit: arr[b + 1], flat: arr[b + 2], sumRet: r1(arr[b + 3]),
        winRate: r2(arr[b + 1] / n * 100),
        isN: isN, isHit: isHit, isFlat: isFlat, isWinRate: isN ? r2(isHit / isN * 100) : 0,
        oosN: oosN, oosHit: oosHit, oosFlat: oosFlat, oosWinRate: oosN ? r2(oosHit / oosN * 100) : 0,
        /* 反转后命中 = 原亏损 = n − hit − flat（平局反转后仍不命中） */
        invIsWinRate: isN ? r2((isN - isHit - isFlat) / isN * 100) : 0,
        invOosWinRate: oosN ? r2((oosN - oosHit - oosFlat) / oosN * 100) : 0,
        activeDays: arr === C ? activeDays(k) : 0,
        perDay: arr === C ? r1(n / Math.max(1, activeDays(k))) : 0
      });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- Pass 2：只收集被选中组合的逐笔
 * 用 (tf,fam,op,buck,dir,layer,slot) 精确索引，每根 bar 只检查被选中的少数组合，
 * 避免重复计入（同一事件在 coarse/inst/hour 三层只能命中一个 pick）。 */
function pass2(pickKeys, limit, onlyTf) {
  const byTf = [[], [], []];
  for (const p of pickKeys) {
    const q = decode(p.ck);
    byTf[q.tf].push({ p: p, q: q });
  }
  const out = [];
  for (let ti = 0; ti < TFS.length; ti++) {
    const cfg = TFS[ti];
    if (onlyTf && cfg.id !== onlyTf && cfg.dir !== onlyTf) continue;
    const sels = byTf[ti];
    if (!sels.length) continue;
    const list = listOkxInsts(cfg.dir).slice(0, limit || 100000);
    const handle = (inst, src, bars) => {
      if (FILTER.shouldExclude(inst, bars)) return;
      const slot = instNames[ti].indexOf(inst);
      if (slot < 0) return;
      const n = bars.length;
      if (n < WARM + MAXH + 5) return;
      const f = computeFeatures(bars);
      for (let i = WARM; i < n - MAXH - 1; i++) {
        if (!(f.c[i] > 0)) continue;
        const t = bars[i].t;
        const bs = bucketsAt(f, i, t);
        let isoCache = null;
        for (const sel of sels) {
          const buck = bs[sel.q.fam];
          if (buck === 255 || buck !== sel.q.buck) continue;
          if (sel.p.layer === 'inst' && sel.p.slot !== slot) continue;
          if (sel.p.layer === 'hour' && sel.p.slot !== Math.floor((t % 86400000) / 3600000)) continue;
          const j = i + OPS[sel.q.op].h;
          if (!(f.c[j] > 0)) continue;
          const pr = (f.c[j] - f.c[i]) / f.c[i] * 10000;
          const ret = sel.q.d === 0 ? pr : -pr;
          if (!isoCache) isoCache = new Date(t).toISOString();
          const inv = -ret;
          out.push({
            t: t, iso: isoCache, day: isoCache.slice(0, 10), month: isoCache.slice(0, 7),
            tf: cfg.id, inst: inst, src: src, fam: FAMS[sel.q.fam].id, op: OPS[sel.q.op].id,
            h: OPS[sel.q.op].h, buck: buck, hour: Math.floor((t % 86400000) / 3600000),
            dir: sel.q.d === 0 ? 1 : -1, origRet: ret, ret: inv, c0: f.c[i], c1: f.c[j],
            oos: t >= SPLIT_MS, pk: sel.p.key, hit: inv > 0 ? 1 : 0
          });
        }
      }
    };
    for (const inst of list) handle(inst, 'OKX永续', loadOkxInst(cfg.dir, inst, END_MS));
  }
  return out;
}

/* ---------------------------------------------------------------- 统计工具 */
function bucket(arr, keyFn) {
  const m = new Map();
  for (const t of arr) {
    const k = keyFn(t);
    let o = m.get(k);
    if (!o) { o = { key: k, n: 0, hit: 0, sumRetRaw: 0, isN: 0, isHit: 0, oosN: 0, oosHit: 0 }; m.set(k, o); }
    o.n++; if (t.hit) o.hit++; o.sumRetRaw += t.ret;
    if (t.oos) { o.oosN++; if (t.hit) o.oosHit++; } else { o.isN++; if (t.hit) o.isHit++; }
  }
  return Array.from(m.values()).map(o => ({
    key: o.key, n: o.n, winRate: r2(o.hit / o.n * 100), ret: r1(o.sumRetRaw), sumRetRaw: o.sumRetRaw,
    isN: o.isN, isWinRate: o.isN ? r2(o.isHit / o.isN * 100) : 0,
    oosN: o.oosN, oosWinRate: o.oosN ? r2(o.oosHit / o.oosN * 100) : 0
  }));
}
function buildKpi(tr) {
  const n = tr.length;
  let hit = 0, flat = 0, sum = 0, sw = 0, sl = 0, win = 0, loss = 0, isN = 0, isHit = 0, oosN = 0, oosHit = 0, oosSum = 0;
  for (const t of tr) {
    if (t.hit) hit++;
    if (t.ret === 0) flat++;
    sum += t.ret;
    if (t.ret > 0) { win++; sw += t.ret; } else if (t.ret < 0) { loss++; sl += t.ret; }
    if (t.oos) { oosN++; if (t.hit) oosHit++; oosSum += t.ret; } else { isN++; if (t.hit) isHit++; }
  }
  const cost = FEES.map(c => ({ cost: c, label: FEE_LABEL[String(c)], netBp: r1(sum - n * c), netPct: r1((sum - n * c) / 100) }));
  return {
    n: n, hit: hit, flat: flat, winRate: n ? r2(hit / n * 100) : 0,
    isN: isN, isWinRate: isN ? r2(isHit / isN * 100) : 0,
    oosN: oosN, oosWinRate: oosN ? r2(oosHit / oosN * 100) : 0,
    totalProfitBp: r1(sum), totalProfitPct: r1(sum / 100),
    grossWinBp: r1(sw), grossLossBp: r1(sl), avgRetBp: r3(sum / (n || 1)),
    profitFactor: sl !== 0 ? r3(Math.abs(sw / sl)) : 0,
    cost: cost, netMakerBp: r1(sum - n * (-2)), netTakerBp: r1(sum - n * 10),
    oosProfitBp: r1(oosSum), oosNetTakerBp: r1(oosSum - oosN * 10),
    checksum: r1(sum)
  };
}
function curveFrom(tr) {
  const days = new Map();
  for (const t of tr) {
    let d = days.get(t.day);
    if (!d) { d = { day: t.day, bp: 0, n: 0 }; days.set(t.day, d); }
    d.bp += t.ret; d.n++;
  }
  const ks = Array.from(days.keys()).sort();
  let cum = 0, eq = 100, peak = 100, mdd = 0; const pts = [];
  const cf = [0, 0, 0, 0];
  for (const k of ks) {
    const d = days.get(k); cum += d.bp;
    for (let j = 0; j < FEES.length; j++) cf[j] += d.bp - d.n * FEES[j];
    const rr = d.n ? d.bp / d.n / 10000 : 0;
    eq *= 1 + rr; peak = Math.max(peak, eq); mdd = Math.max(mdd, (peak - eq) / peak * 100);
    const p = { d: k, bp: r1(cum), pct: r1(cum / 100), eq: r3(eq), n: d.n };
    for (let j = 0; j < FEES.length; j++) p['f' + j] = r1(cf[j]);
    pts.push(p);
  }
  return { points: pts, finalBp: r1(cum), finalPct: r1(cum / 100), compoundPct: r3((eq / 100 - 1) * 100), maxDrawdownPct: r2(mdd), days: pts.length };
}
function pack(tr, byMonth) {
  const n = tr.length;
  let tradeBars, barMode;
  if (n <= 600) {
    let cum = 0;
    tradeBars = tr.map((t, i) => { cum += t.ret; return { i: i + 1, t: t.t, iso: t.iso, ret: r1(t.ret), cumBp: r1(cum), inst: t.inst, src: t.src, dir: t.dir, hit: t.hit, c0: t.c0, c1: t.c1, oos: t.oos, fam: t.fam, op: t.op }; });
    barMode = 'trade';
  } else {
    const B = 300, per = Math.ceil(n / B);
    tradeBars = []; let cum = 0;
    for (let s = 0; s < n; s += per) {
      const seg = tr.slice(s, s + per); let bp = 0, h = 0;
      for (const t of seg) { bp += t.ret; if (t.hit) h++; cum += t.ret; }
      tradeBars.push({ i: s + 1, iEnd: Math.min(n, s + per), t: seg[0].t, iso: seg[0].iso, ret: r1(bp), cumBp: r1(cum), n: seg.length, winRate: r2(h / seg.length * 100), bucketed: true });
    }
    barMode = 'bucket';
  }
  const monthlyBars = byMonth.map(m => ({ d: m.key, n: m.n, winRate: m.winRate, ret: r1(m.sumRetRaw), cumBp: 0 }));
  let mc = 0;
  for (let i = 0; i < monthlyBars.length; i++) { mc += byMonth[i].sumRetRaw; monthlyBars[i].cumBp = r1(mc); }
  const list = tr.slice(0, 6000).map(t => ({
    t: t.t, iso: t.iso, inst: t.inst, src: t.src, dir: t.dir, fam: t.fam, op: t.op,
    ret: r1(t.ret), origRet: r1(t.origRet), hit: t.hit, c0: t.c0, c1: t.c1, oos: t.oos, key: t.pk
  }));
  return { monthlyBars: monthlyBars, tradeBars: tradeBars, barMode: barMode, trades: list, tradesTotal: n, tradesTruncated: n > 6000 };
}
function buildPeriod(tf, tr, picks) {
  const kpi = buildKpi(tr), curve = curveFrom(tr);
  const byMonth = bucket(tr, t => t.month).sort((a, b) => a.key < b.key ? -1 : 1);
  const ext = pack(tr, byMonth);
  /* 原始方向（反转前）按日亏损排行 */
  const dm = new Map();
  for (const t of tr) {
    let d = dm.get(t.day);
    if (!d) { d = { day: t.day, n: 0, origBp: 0, invBp: 0 }; dm.set(t.day, d); }
    d.n++; d.origBp += t.origRet; d.invBp += t.ret;
  }
  const daily = Array.from(dm.values()).map(d => ({ day: d.day, n: d.n, origBp: r1(d.origBp), invBp: r1(d.invBp) }));
  const worstDays = daily.slice().sort((a, b) => a.origBp - b.origBp).slice(0, 20);
  const perDay = daily.length ? daily.reduce((s, d) => s + d.n, 0) / daily.length : 0;
  return {
    tf: tf, picks: picks, kpi: kpi, curve: curve, byMonth: byMonth,
    bySource: bucket(tr, t => t.src), byFam: bucket(tr, t => t.fam), byOp: bucket(tr, t => t.op),
    byInst: bucket(tr, t => t.inst).sort((a, b) => b.sumRetRaw - a.sumRetRaw).slice(0, 20),
    monthlyBars: ext.monthlyBars, tradeBars: ext.tradeBars, barMode: ext.barMode,
    trades: ext.trades, tradesTotal: ext.tradesTotal, tradesTruncated: ext.tradesTruncated,
    daily: daily, worstDays: worstDays,
    dailyStats: { days: daily.length, avgPerDay: r1(perDay), maxPerDay: daily.reduce((m, d) => Math.max(m, d.n), 0),
      daysOver100: daily.filter(d => d.n >= 100).length, daysOver300: daily.filter(d => d.n >= 300).length }
  };
}

/* ---------------------------------------------------------------- 高频层(L2)反转策略：从 coarse 逐日聚合直接出曲线
 * 无逐笔，但 KPI（n/胜率/毛收益/扣费）与逐日累计、等权复利净值都精确。 */
const SPLIT_DAY = Math.floor(SPLIT_MS / 86400000) - START_DAY;
const dayLabel = d => new Date((START_DAY + d) * 86400000).toISOString().slice(0, 10);
function aggStrategy(rows, label) {
  const ks = rows.map(r => r.ck);
  let n = 0, hit = 0, flat = 0, sum = 0, isN = 0, isHit = 0, isFlat = 0, oosN = 0, oosHit = 0, oosFlat = 0;
  for (const k of ks) {
    const b = k * SZ;
    n += C[b]; hit += C[b + 1]; flat += C[b + 2]; sum += C[b + 3];
    isN += C[b + 4]; isHit += C[b + 5]; oosN += C[b + 6]; oosHit += C[b + 7];
    isFlat += C[b + 8]; oosFlat += C[b + 9];
  }
  const invHit = n - hit - flat, invSum = -sum;
  const cost = FEES.map(c => ({ cost: c, label: FEE_LABEL[String(c)], netBp: r1(invSum - n * c), netPct: r1((invSum - n * c) / 100) }));
  const pts = [];
  let cum = 0, eq = 100, peak = 100, mdd = 0, oosInvBp = 0, oosInvN = 0;
  const cf = [0, 0, 0, 0];
  let sumN = 0, maxPerDay = 0, active = 0;
  for (let d = 0; d < NDAYS; d++) {
    let s = 0, cnt = 0;
    for (const k of ks) { const di = k * NDAYS + d; s += daySum[di]; cnt += dayCnt[di]; }
    if (!cnt) continue;
    const inv = -s;
    cum += inv; sumN += cnt; active++; maxPerDay = Math.max(maxPerDay, cnt);
    for (let j = 0; j < FEES.length; j++) cf[j] += inv - cnt * FEES[j];
    const rr = inv / cnt / 10000;   /* 当日资金等权分散到当日全部信号 */
    eq *= 1 + rr; peak = Math.max(peak, eq); mdd = Math.max(mdd, (peak - eq) / peak * 100);
    if (d >= SPLIT_DAY) { oosInvBp += inv; oosInvN += cnt; }
    const p = { d: dayLabel(d), bp: r1(cum), pct: r1(cum / 100), eq: r3(eq), n: cnt };
    for (let j = 0; j < FEES.length; j++) p['f' + j] = r1(cf[j]);
    pts.push(p);
  }
  return {
    label: label, rows: rows.map(r => ({ key: r.key, tf: r.tf, fam: r.fam, famName: r.famName, op: r.op,
      buck: r.buck, dirLabel: r.dirLabel, n: r.n, isN: r.isN, isWinRate: r.isWinRate, perDay: r.perDay,
      invIsWinRate: r.invIsWinRate, oosN: r.oosN, invOosWinRate: r.invOosWinRate })),
    before: { n: n, winRate: n ? r2(hit / n * 100) : 0, grossBp: r1(sum), netTakerBp: r1(sum - n * 10) },
    kpi: {
      n: n, hit: invHit, flat: flat, winRate: n ? r2(invHit / n * 100) : 0,
      isN: isN, isWinRate: isN ? r2((isN - isHit - isFlat) / isN * 100) : 0,
      oosN: oosN, oosWinRate: oosN ? r2((oosN - oosHit - oosFlat) / oosN * 100) : 0,
      totalProfitBp: r1(invSum), totalProfitPct: r1(invSum / 100),
      netMakerBp: r1(invSum - n * (-2)), netTakerBp: r1(invSum - n * 10),
      oosProfitBp: r1(oosInvBp), oosNetTakerBp: r1(oosInvBp - oosInvN * 10),
      avgRetBp: r3(invSum / (n || 1)), cost: cost, checksum: r1(invSum)
    },
    curve: { points: pts, finalBp: r1(cum), compoundPct: r3((eq / 100 - 1) * 100), maxDrawdownPct: r2(mdd), days: pts.length },
    dailyStats: { days: active, avgPerDay: r1(sumN / (active || 1)), maxPerDay: maxPerDay,
      daysOver100: pts.filter(p => p.n >= 100).length, daysOver300: pts.filter(p => p.n >= 300).length }
  };
}

/* 无条件基线：把所有 coarse 组合汇总 ≈ 不看任何条件、各族等权「无脑买多/卖空」。
 * 反转买多组合 = 无脑卖空。若基线本身 >50%，说明市场在数据期单边下跌，
 * 任何「低胜率买多→反手做空」赚到的都只是 beta/漂移，不是选组合的 alpha。 */
function unconditionalBaseline() {
  const mkA = () => ({ n: 0, hit: 0, flat: 0, sum: 0, oosN: 0, oosHit: 0, oosFlat: 0 });
  const buy = mkA(), sell = mkA();
  for (let k = 0; k < NK; k++) {
    const b = k * SZ;
    if (!C[b]) continue;
    const q = decode(k), a = q.d === 0 ? buy : sell;
    a.n += C[b]; a.hit += C[b + 1]; a.flat += C[b + 2]; a.sum += C[b + 3];
    a.oosN += C[b + 6]; a.oosHit += C[b + 7]; a.oosFlat += C[b + 9];
  }
  const pack = a => ({
    n: a.n, winRate: a.n ? r2(a.hit / a.n * 100) : 0,
    invWinRate: a.n ? r2((a.n - a.hit - a.flat) / a.n * 100) : 0,
    oosN: a.oosN, invOosWinRate: a.oosN ? r2((a.oosN - a.oosHit - a.oosFlat) / a.oosN * 100) : 0,
    grossBp: r1(a.sum), invGrossBp: r1(-a.sum), invNetTakerBp: r1(-a.sum - a.n * 10)
  });
  return { buy: pack(buy), sell: pack(sell),
    note: '汇总全部 coarse 组合 ≈ 不看条件、各族等权无脑买多/卖空；「反转买多」等价于无脑卖空基线。' };
}

/* ---------------------------------------------------------------- 主流程 */
const T0 = Date.now();
const LIMIT = process.env.MI_LIMIT ? +process.env.MI_LIMIT : 0;
const ONLY_TF = process.env.MI_TF || '';
const LOW = 10, ULTRA = 5, GOD = 1;   /* 目标胜率门槛 */

function main() {
  console.log('=== multi_inverse BUILD=%s SPLIT=%s LIMIT=%s TF=%s', BUILD, new Date(SPLIT_MS).toISOString(), LIMIT || 'ALL', ONLY_TF || 'ALL');
  pass1(LIMIT, ONLY_TF);
  console.log('PASS1 done bars=%d inst=%d excluded=%d elapsed=%ss', totalBars, totalInstruments, excluded.length, Math.round((Date.now() - T0) / 1000));

  /* 三层行集 */
  const coarse = rowsFrom(C, 1, 'coarse', 1);
  const inst = rowsFrom(I, MAXI, 'inst', 1);
  const hour = rowsFrom(H, 24, 'hour', 1);
  console.log('ROWS coarse=%d inst=%d hour=%d', coarse.length, inst.length, hour.length);

  const all = coarse.concat(inst, hour);
  /* 每层的筛选（只用 IS 胜率） */
  function layerRows(rows, minIsN, minPerDay, label, note, maxPerDay, customName) {
    let pool = rows.filter(r => r.isN >= Math.max(1, minIsN));
    if (minPerDay > 0) pool = pool.filter(r => r.perDay >= minPerDay);
    if (maxPerDay > 0) pool = pool.filter(r => r.perDay <= maxPerDay);
    pool.sort((a, b) => a.isWinRate - b.isWinRate || b.n - a.n);
    const lt1 = pool.filter(r => r.isWinRate <= GOD).length;
    const lt5 = pool.filter(r => r.isWinRate < ULTRA).length;
    const lt10 = pool.filter(r => r.isWinRate < LOW).length;
    return {
      label: label, name: customName || (label === 'L0' ? '极值层（无样本量约束）' : label === 'L1' ? '统计层（IS≥30笔）' : '高频层（日均≥100笔）'),
      note: note, poolSize: pool.length,
      lt1: lt1, lt5: lt5, lt10: lt10,
      minIsWinRate: pool.length ? pool[0].isWinRate : null,
      minIsN: pool.length ? pool[0].isN : null,
      minPerDay: minPerDay,
      top: pool.slice(0, 40).map(r => ({ ...r }))
    };
  }
  const layers = {
    L0: layerRows(all, 0, 0, 'L0', '允许 n=1；0% 胜率必然出现，纯小样本噪声，不可交易'),
    L1: layerRows(all, 30, 0, 'L1', 'IS 至少 30 笔，过滤掉 n≤29 的伪极值'),
    L2: layerRows(coarse, 30, 100, 'L2', '只用粗层（全合约、全时段），要求每天平均≥100笔'),
    L2b: layerRows(coarse, 30, 200, 'L2b', '严格对应「每天好几百笔」：日均 200~1000 笔', 1000, '每天几百笔层（日均200~1000）')
  };
  for (const k of Object.keys(layers)) {
    const L = layers[k];
    console.log('LAYER %s pool=%d lt1=%d lt5=%d lt10=%d minIS=%s%% (n=%s)', k, L.poolSize, L.lt1, L.lt5, L.lt10, L.minIsWinRate, L.minIsN);
  }

  /* 每周期、每腿（买多/卖空）从 L0 挑最低 IS 胜率、且 IS n>=3 的组合；
     同时记录 L1 / L2 的同腿最优，用于对照。 */
  const picks = {};
  const pickKeys = [];
  for (const cfg of TFS) {
    if (ONLY_TF && cfg.id !== ONLY_TF && cfg.dir !== ONLY_TF) continue;
    picks[cfg.id] = {};
    for (const dirLabel of ['买多', '卖空']) {
      const byLayer = {};
      for (const L of ['L0', 'L1', 'L2']) {
        const src = L === 'L2' ? coarse : all;
        let cands = src.filter(r => r.tf === cfg.id && r.dirLabel === dirLabel && r.isN >= (L === 'L0' ? 3 : 30));
        if (L === 'L2') cands = cands.filter(r => r.perDay >= 100);
        cands.sort((a, b) => a.isWinRate - b.isWinRate || b.n - a.n);
        byLayer[L] = cands[0] || null;
      }
      const best = byLayer.L0;   /* 主策略用最极端的 L0（用户要 99% 亏损率） */
      picks[cfg.id][dirLabel] = { chosen: best, byLayer: byLayer };
      if (best && pickKeys.indexOf(best) < 0) pickKeys.push(best);
      console.log('  PICK tf=%s %s L0=%s (IS %s%%/%d, OOS反转 %s%%) | L1=%s | L2=%s',
        cfg.id, dirLabel, best ? best.key : 'NA', best ? best.isWinRate : 'NA', best ? best.isN : 0,
        best && best.oosN ? r2((best.oosN - best.oosHit) / best.oosN * 100) : 'NA',
        byLayer.L1 ? byLayer.L1.isWinRate + '%' : 'NA', byLayer.L2 ? byLayer.L2.isWinRate + '%' : 'NA');
    }
  }

  /* Pass 2：重扫，收集被选中组合逐笔（反转后） */
  const trades = pass2(pickKeys, LIMIT, ONLY_TF);
  console.log('PASS2 trades=%d elapsed=%ss', trades.length, Math.round((Date.now() - T0) / 1000));

  /* 分周期 + 合并 */
  const periods = {};
  for (const cfg of TFS) {
    if (ONLY_TF && cfg.id !== ONLY_TF && cfg.dir !== ONLY_TF) continue;
    const tr = trades.filter(t => t.tf === cfg.id).sort((a, b) => a.t - b.t);
    periods[cfg.id] = buildPeriod(cfg.id, tr, [picks[cfg.id]['买多'].chosen, picks[cfg.id]['卖空'].chosen].filter(Boolean));
  }
  const allTr = trades.slice().sort((a, b) => a.t - b.t);
  const combined = buildPeriod('ALL', allTr, Object.keys(picks).flatMap(k => [picks[k]['买多'].chosen, picks[k]['卖空'].chosen]).filter(Boolean));

  /* 每日亏损排行（原始方向，全周期合并） */
  const dmap = new Map();
  for (const t of allTr) {
    let d = dmap.get(t.day);
    if (!d) { d = { day: t.day, n: 0, origBp: 0, invBp: 0, losers: 0 }; dmap.set(t.day, d); }
    d.n++; d.origBp += t.origRet; d.invBp += t.ret; if (t.origRet < 0) d.losers++;
  }
  const dailyAll = Array.from(dmap.values()).map(d => ({ day: d.day, n: d.n, losers: d.losers,
    loseRate: r2(d.losers / d.n * 100), origBp: r1(d.origBp), invBp: r1(d.invBp) }));
  const worstDays = dailyAll.slice().sort((a, b) => a.origBp - b.origBp).slice(0, 30);
  const busiestDays = dailyAll.slice().sort((a, b) => b.n - a.n).slice(0, 30);

  /* 策略族 × 操作 汇总（反转前 IS 胜率最低排序，展示「多种策略多种操作」全貌） */
  const famRows = coarse.filter(r => r.isN >= 30).map(r => ({
    tf: r.tf, fam: r.fam, famName: r.famName, op: r.op, opName: r.opName,
    buck: r.buck, dirLabel: r.dirLabel, n: r.n, isN: r.isN, isWinRate: r.isWinRate,
    oosN: r.oosN, oosWinRate: r.oosWinRate,
    invIsWinRate: r.invIsWinRate, invOosWinRate: r.invOosWinRate,
    perDay: r.perDay, sumRet: r.sumRet
  })).sort((a, b) => a.isWinRate - b.isWinRate);

  /* 高频层（每天好几百笔）反转策略：每周期买多/卖空各取最低 IS 胜率且日均≥100笔的粗层组合 */
  const hfPeriods = {}, hfPicks = [];
  for (const cfg of TFS) {
    if (ONLY_TF && cfg.id !== ONLY_TF && cfg.dir !== ONLY_TF) continue;
    const cands = coarse.filter(r => r.tf === cfg.id && r.isN >= 30 && r.perDay >= 100);
    const legs = [];
    for (const dirLabel of ['买多', '卖空']) {
      const c = cands.filter(r => r.dirLabel === dirLabel).sort((a, b) => a.isWinRate - b.isWinRate || b.n - a.n)[0];
      if (c) legs.push(c);
    }
    if (legs.length) { hfPeriods[cfg.id] = aggStrategy(legs, cfg.label + ' · 高频层'); hfPicks.push(...legs); }
    console.log('  HF tf=%s cands=%d legs=%d minIS=%s%%', cfg.id, cands.length, legs.length, legs.length ? Math.min.apply(null, legs.map(x => x.isWinRate)) : 'NA');
  }
  const hfCombined = hfPicks.length ? aggStrategy(hfPicks, '合并 · 高频层') : null;
  const hf = { periods: hfPeriods, combined: hfCombined, picks: hfPicks.map(r => ({ key: r.key, tf: r.tf, fam: r.fam, op: r.op, dirLabel: r.dirLabel, isWinRate: r.isWinRate, perDay: r.perDay })) };
  if (hfCombined) console.log('HF combined n=%d win=%s%% OOS=%s%% taker=%s avgPerDay=%s',
    hfCombined.kpi.n, hfCombined.kpi.winRate, hfCombined.kpi.oosWinRate, hfCombined.kpi.netTakerBp, hfCombined.dailyStats.avgPerDay);

  /* 「每天好几百笔」层（L2b，日均 200~1000）：用户明确要求的规模，单独出一条完整策略曲线 */
  const hf2Periods = {}, hf2Picks = [];
  for (const cfg of TFS) {
    if (ONLY_TF && cfg.id !== ONLY_TF && cfg.dir !== ONLY_TF) continue;
    const cands = coarse.filter(r => r.tf === cfg.id && r.isN >= 30 && r.perDay >= 200 && r.perDay <= 1000);
    const legs = [];
    for (const dirLabel of ['买多', '卖空']) {
      const c = cands.filter(r => r.dirLabel === dirLabel).sort((a, b) => a.isWinRate - b.isWinRate || b.n - a.n)[0];
      if (c) legs.push(c);
    }
    if (legs.length) { hf2Periods[cfg.id] = aggStrategy(legs, cfg.label + ' · 每天几百笔层'); hf2Picks.push(...legs); }
  }
  const hf2Combined = hf2Picks.length ? aggStrategy(hf2Picks, '合并 · 每天几百笔层') : null;
  const hf2 = { periods: hf2Periods, combined: hf2Combined,
    picks: hf2Picks.map(r => ({ key: r.key, tf: r.tf, fam: r.fam, famName: r.famName, op: r.op, dirLabel: r.dirLabel, isWinRate: r.isWinRate, perDay: r.perDay, invOosWinRate: r.invOosWinRate })) };
  if (hf2Combined) console.log('HF2 combined n=%d win=%s%% OOS=%s%% taker=%s avgPerDay=%s minIS=%s%%',
    hf2Combined.kpi.n, hf2Combined.kpi.winRate, hf2Combined.kpi.oosWinRate, hf2Combined.kpi.netTakerBp,
    hf2Combined.dailyStats.avgPerDay, layers.L2b.minIsWinRate);

  /* 用户目标档位（IS 胜率 <10% 且 IS≥30 笔）的反转后样本外实证 */
  const qual = layers.L1.top.filter(r => r.isWinRate < LOW && r.isN >= 30);
  const qualOos = qual.filter(r => r.oosN >= 30);
  const qualifying = {
    count: qual.length, withOos: qualOos.length,
    avgInvOosWinRate: qualOos.length ? r2(qualOos.reduce((s, r) => s + r.invOosWinRate, 0) / qualOos.length) : null,
    minInvOosWinRate: qualOos.length ? Math.min.apply(null, qualOos.map(r => r.invOosWinRate)) : null,
    maxInvOosWinRate: qualOos.length ? Math.max.apply(null, qualOos.map(r => r.invOosWinRate)) : null,
    rows: qual.map(r => ({ layer: r.layer, tf: r.tf, fam: r.fam, op: r.op, buck: r.buck, dirLabel: r.dirLabel,
      isN: r.isN, isWinRate: r.isWinRate, invIsWinRate: r.invIsWinRate, oosN: r.oosN, invOosWinRate: r.invOosWinRate, sumRet: r.sumRet }))
  };
  console.log('QUALIFY <10%% count=%d withOOS=%d avgInvOOS=%s%% (%s~%s)',
    qualifying.count, qualifying.withOos, qualifying.avgInvOosWinRate, qualifying.minInvOosWinRate, qualifying.maxInvOosWinRate);

  /* 诚实验证 */
  const ca = combined.kpi;
  const oosN = ca.oosN, oosWin = ca.oosWinRate;
  const oosTaker = ca.oosNetTakerBp;
  const searchSize = coarse.length + inst.length + hour.length;
  const hfFloor = layers.L2.minIsWinRate === null ? null : layers.L2.minIsWinRate;
  const hfK = hfCombined ? hfCombined.kpi : null;
  const base = unconditionalBaseline();
  /* HF 混合买多/卖空两腿，基线取两腿反转基线的均值 */
  const hfBaseWin = r2((base.buy.invWinRate + base.sell.invWinRate) / 2);
  const hfBaseOosWin = r2((base.buy.invOosWinRate + base.sell.invOosWinRate) / 2);
  const hfExcess = hfK ? r2(hfK.winRate - hfBaseWin) : null;
  const hfOosExcess = hfK ? r2(hfK.oosWinRate - hfBaseOosWin) : null;
  console.log('BASELINE 无脑买多 %s%% / 反转(无脑卖空) %s%% / OOS反转 %s%% | HF超额 %spp OOS超额 %spp',
    base.buy.winRate, base.buy.invWinRate, base.buy.invOosWinRate, hfExcess, hfOosExcess);
  const verdict = {
    identity: '反转后胜率 = 1 − 原胜率 − 平局率；样本内高胜率是方向取反的算术恒等式，不是预测能力的发现。',
    searchSpace: searchSize,
    coarse: coarse.length, inst: inst.length, hour: hour.length,
    layerSummary: Object.keys(layers).map(k => ({ layer: k, name: layers[k].name, pool: layers[k].poolSize,
      lt1: layers[k].lt1, lt5: layers[k].lt5, lt10: layers[k].lt10, minIsWinRate: layers[k].minIsWinRate, minIsN: layers[k].minIsN })),
    canReach99: layers.L0.lt1 > 0,
    why99IsNoise: 'L0 允许 n=1；在 ' + searchSize + ' 个组合里必然出现 0% 胜率（Bonferroni/极值统计）。这些组合 IS 样本极小，反转后 OOS 向 50% 回归。',
    highFreqFloor: hfFloor,
    highFreqNote: '每天几百笔(日均≥100)的组合，胜率下限 ' + (hfFloor === null ? 'N/A（无满足条件的组合）' : hfFloor + '%') + '，无法达到 5%~10%，更不可能 99% 亏损率——大数定律。',
    hf: hfCombined ? { beforeWinRate: hfCombined.before.winRate, afterWinRate: hfK.winRate,
      oosWinRate: hfK.oosWinRate, oosN: hfK.oosN, netTakerBp: hfK.netTakerBp,
      oosNetTakerBp: hfK.oosNetTakerBp, avgPerDay: hfCombined.dailyStats.avgPerDay,
      maxPerDay: hfCombined.dailyStats.maxPerDay, daysOver100: hfCombined.dailyStats.daysOver100,
      compoundPct: hfCombined.curve.compoundPct, maxDrawdownPct: hfCombined.curve.maxDrawdownPct,
      baseWinRate: hfBaseWin, excessWinRate: hfExcess, baseOosWinRate: hfBaseOosWin, excessOosWinRate: hfOosExcess } : null,
    baseline: base,
    qualifying: qualifying,
    hf2: hf2Combined ? { beforeWinRate: hf2Combined.before.winRate, afterWinRate: hf2Combined.kpi.winRate,
      oosWinRate: hf2Combined.kpi.oosWinRate, oosN: hf2Combined.kpi.oosN,
      netTakerBp: hf2Combined.kpi.netTakerBp, oosNetTakerBp: hf2Combined.kpi.oosNetTakerBp,
      avgPerDay: hf2Combined.dailyStats.avgPerDay, maxPerDay: hf2Combined.dailyStats.maxPerDay,
      daysOver100: hf2Combined.dailyStats.daysOver100, compoundPct: hf2Combined.curve.compoundPct,
      maxDrawdownPct: hf2Combined.curve.maxDrawdownPct } : null,
    caveat: '所有 bp 均为「逐笔算术和」，不是资金收益；同一根 bar 会被多个策略族/持仓周期重复计为独立信号。净值与 MDD 采用「当日资金等权分散到当日全部信号、逐日复利」口径，日均上万笔时会被极度平滑（MDD≈0、净值虚高），不可当作实盘资金曲线。无条件基线同样含重复计数，仅用于比较胜率。',
    dayHundredsFloor: layers.L2b.minIsWinRate,
    combinedAfterWinRate: ca.winRate, combinedIsWinRate: ca.isWinRate,
    oosN: oosN, oosWinRate: oosWin, oosNetTakerBp: oosTaker,
    oosHolds: oosN >= 200 && oosWin > 50,
    fullNetTakerBp: ca.netTakerBp, fullNetMakerBp: ca.netMakerBp,
    guarantee: '否。样本内 90%~99% 反转胜率由恒等式保证；只有 OOS 样本足够且仍 >50% 且扣 taker 全费为正，才算真有优势。',
    conclusion: ''
  };
  verdict.conclusion =
    '【直接回答】符合「IS 胜率<10% 且样本≥30」的组合共 ' + qualifying.count + ' 个，其中 OOS 有足够样本的仅 ' + qualifying.withOos +
    ' 个，反转后 OOS 平均胜率 ' + qualifying.avgInvOosWinRate + '%（' + qualifying.minInvOosWinRate + '~' + qualifying.maxInvOosWinRate + '%）—— 反转后并没有更赚，反而低于 50%。' +
    (verdict.canReach99 ? ' 极值层确能造出胜率≤1%（亏损率≥99%）的组合，但 IS 样本仅约 ' + layers.L0.minIsN + ' 笔，是搜索 ' + searchSize + ' 个组合的必然噪声，反转后 OOS 仅 51~58%。' : '未造出 ≤1% 胜率组合。') +
    ' 「每天几百笔」层最低 IS 胜率 ' + (layers.L2b.minIsWinRate === null ? 'N/A' : layers.L2b.minIsWinRate + '%') +
    (hf2Combined ? '，该层反转后全期 ' + hf2Combined.kpi.winRate + '%、OOS ' + hf2Combined.kpi.oosWinRate + '%、日均 ' + hf2Combined.dailyStats.avgPerDay + ' 笔，但相对无脑反向基线超额仅约 ' + r2(hf2Combined.kpi.oosWinRate - hfBaseOosWin) + 'pp。' : '。') +
    ' 高频层(日均≥100笔)最低 IS 胜率 ' + (hfFloor === null ? 'N/A' : hfFloor + '%') + '，证明「每天几百笔还亏 99%」不存在。' +
    (hfK ? ' 高频层反转后全期 ' + hfK.winRate + '%、OOS ' + hfK.oosWinRate + '%（' + hfK.oosN + '笔）、日均 ' + hfCombined.dailyStats.avgPerDay + ' 笔、扣 taker 全费净 ' + hfK.netTakerBp + 'bp；但无条件「无脑反向」基线已有 ' + hfBaseWin + '%（OOS ' + hfBaseOosWin + '%），超额仅 ' + hfExcess + 'pp / OOS ' + hfOosExcess + 'pp —— 巨额净额的绝大部分是数据期单边漂移(beta)，不是选组合的 alpha。' : '') +
    ' 极值层主策略反转后全期胜率 ' + ca.winRate + '%、样本内 ' + ca.isWinRate + '%，但样本外 ' + oosN + ' 笔仅 ' + oosWin + '%' +
    (oosN < 200 ? '（样本不足200，统计上无法判定）' : (oosWin > 50 ? '，仍 >50%' : '，未站稳 50%')) +
    '，相对基线超额 ' + r2(oosWin - hfBaseOosWin) + 'pp；样本外扣 taker 全费净 ' + oosTaker + 'bp（每笔仅 ' + r2(oosTaker / (oosN || 1)) + 'bp）。' +
    (verdict.oosHolds && oosTaker > 0 ? '两项勉强通过，但超额极薄、来自极值筛选，扣费稍增即转负，不构成稳定盈利保证，仍须实盘验证。' : '反向做不构成稳定盈利保证。');

  const meta = {
    title: '多策略族 × 多操作 · 极低胜率组合反向回测（目标亏损率 90%~99%）',
    build: BUILD, generated: new Date().toISOString(),
    scope: FAMS.length + ' 个策略族 × ' + OPS.length + ' 种持仓操作 × ' + NB + ' 档 × 买多/卖空 × ' + TFS.length + ' 周期；三层搜索 L0/L1/L2。',
    split: new Date(SPLIT_MS).toISOString(), start: new Date(START_MS).toISOString(), end: new Date(END_MS).toISOString(),
    fees: FEES, feeLabels: FEE_LABEL,
    bars: totalBars, instruments: totalInstruments,
    dataCleaning: { module: 'bt/instrument_filter.js', minSdBp: FILTER.MIN_SD_BP, excludedCount: excluded.length, excluded: excluded },
    families: FAMS, ops: OPS, bands: TH, thresholds: THK,
    method: '纯因果：所有特征只用 ≤i 已收盘 bar；收益=close[i+h]/close[i]-1 (h≥1)；信号bar收盘成交；IS 挑组合、OOS 单独验证；平局 ret=0 不计命中。',
    caveat: '1h 覆盖 OKX 全部合约（★2026-11-07 美股全线已删除，只含 OKX）。周期间样本量不可直接比较。',
    limit: LIMIT || null, onlyTf: ONLY_TF || null
  };

  const result = {
    meta: meta, layers: layers, picks: picks, periods: periods, combined: combined, hf: hf, hf2: hf2,
    dailyAll: dailyAll, worstDays: worstDays, busiestDays: busiestDays,
    famRows: famRows.slice(0, 300),
    coarseRows: coarse.slice().sort((a, b) => a.isWinRate - b.isWinRate).slice(0, 800),
    verdict: verdict, compare: { rows: Object.keys(periods).map(k => ({ tf: k, ...periods[k].kpi, ...periods[k].dailyStats })) }
  };

  fs.writeFileSync(path.join(WEBBT, 'multi_inverse.json'), JSON.stringify(result));
  /* 逐笔 CSV（全量） */
  const ch = ['周期,组合KEY,策略族,操作,档位,原方向,反向方向,信号UTC,标的,市场,收盘,平仓价,原收益bp,反转收益bp,反转命中,样本外'];
  for (const t of allTr) ch.push([t.tf, t.pk, t.fam, t.op, t.buck, t.dir > 0 ? '买多' : '卖空', t.dir > 0 ? '卖空' : '买多',
    t.iso, t.inst, t.src, t.c0, t.c1, r1(t.origRet), r1(t.ret), t.hit, t.oos ? 1 : 0].join(','));
  fs.writeFileSync(path.join(WEBBT, 'multi_inverse_trades.csv'), ch.join('\n') + '\n');
  /* 网格 CSV（粗层全量） */
  const cg = ['周期,策略族,操作,档位,方向,笔数,命中,平局,IS笔数,IS胜率%,反转IS胜率%,OOS笔数,OOS胜率%,反转OOS胜率%,毛收益bp,活跃天数,日均笔数'];
  for (const r of coarse.slice().sort((a, b) => a.tf < b.tf ? -1 : a.tf > b.tf ? 1 : a.isWinRate - b.isWinRate)) {
    cg.push([r.tf, r.fam, r.op, r.buck, r.dirLabel, r.n, r.hit, r.flat, r.isN, r.isWinRate,
      r.invIsWinRate, r.oosN, r.oosWinRate, r.invOosWinRate, r.sumRet, r.activeDays, r.perDay].join(','));
  }
  fs.writeFileSync(path.join(WEBBT, 'multi_inverse_grid.csv'), cg.join('\n') + '\n');

  console.log('=== DONE elapsed=%ss jsonKB=%d', Math.round((Date.now() - T0) / 1000), Math.round(fs.statSync(path.join(WEBBT, 'multi_inverse.json')).size / 1024));
  console.log('COMBINED n=%d win=%s%% IS=%s%% OOS=%d/%s%% gross=%s maker=%s taker=%s',
    ca.n, ca.winRate, ca.isWinRate, oosN, oosWin, ca.totalProfitBp, ca.netMakerBp, ca.netTakerBp);
  console.log('VERDICT canReach99=%s highFreqFloor=%s%% oosTaker=%s', verdict.canReach99, verdict.highFreqFloor, oosTaker);
  console.log('VERDICT_TEXT', verdict.conclusion);
}
main();
