/* 纯山寨 EW 指数 × 涨跌幅推导HTML 公式比较
 * 指数: 全市场合约等权(剔除 BTC/ETH), 收益率聚合净值bar (O/H/L/C/V)
 * W: updown.sqlite 涨跌家数宽度 (up-down)/(up+down) 每根ts
 * 公式 (与横截面版同口径):
 *   F1 控制变量主式  r̂ = P·A_up − (1−P)·A_dn
 *   F2 宽度量比      lnR̂ = κW + δ·lnV̂  (κ=1 δ=0.5 固定)
 *   F3 符号×宽度量比 sign(F1)·F2
 *   F4 动量5         C/C[-5]−1
 *   F5 纯宽度        W
 *   F6 前收涨跌      rprev
 *   F7 z合成         z(F1)+z(F4)+z(F5)
 *   F2r 宽度量比·标定 滚动回归 ln|fwd1|~W+lnV̂ → κ,δ 实测值
 *   F3r 符号×标定宽度 sign(F1)·F2r
 * 评估: 指数下一根 方向% / 增量IC / 幅度Top10捕捉 / fwd5 / 五分位条件概率
 */
'use strict';
const CH = require('../modules/okx/engines/chan');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const GRAINS = [['5m', 365], ['15m', 730], ['1h', 730], ['4h', 400]];
const NF = 9;
const FN = ['F1控制变量', 'F2宽度量比', 'F3符号×宽度', 'F4动量5', 'F5纯宽度', 'F6前收涨跌', 'F7z合成', 'F2r标定宽度', 'F3r符号标定'];
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

function widthSeries(grain) {
  const m = new Map();
  try {
    const db = new DatabaseSync('data/okx/updown.sqlite', { readOnly: true });
    const rows = db.prepare('SELECT ts,up,down FROM updown WHERE grain=?').all(grain);
    for (const r of rows) { const t = r.up + r.down; m.set(r.ts, t > 0 ? (r.up - r.down) / t : 0); }
  } catch (e) { console.warn('width err', e.message); }
  return m;
}

function buildIndex(grain, days) {
  const since = Date.now() - days * 86400000;
  const dir = path.resolve(__dirname, '../data/okx/kline/' + grain);
  let insts = [];
  try { insts = fs.readdirSync(dir).filter(d => d.endsWith('-USDT-SWAP') && d !== 'BTC-USDT-SWAP' && d !== 'ETH-USDT-SWAP'); } catch (e) { }
  /* BTC 轴 */
  const btc = CH.loadCandles(grain, since, 'BTC-USDT-SWAP') || [];
  if (btc.length < 500) return null;
  const T = btc.length, step = btc[1].ts - btc[0].ts;
  const tsAxis = btc.map(b => b.ts);
  const oArr = new Float64Array(T), hArr = new Float64Array(T), lArr = new Float64Array(T), cArr = new Float64Array(T), vArr = new Float64Array(T), nArr = new Float64Array(T);
  for (const s of insts) {
    const b = CH.loadCandles(grain, since, s);
    if (!b || b.length < 200) continue;
    const mp = new Map(b.map(x => [x.ts, x]));
    for (let i = 1; i < T; i++) {
      const cur = mp.get(tsAxis[i]), prev = mp.get(tsAxis[i - 1]);
      if (!cur || !prev || !prev.c) continue;
      oArr[i] += cur.o / prev.c - 1; hArr[i] += cur.h / prev.c - 1; lArr[i] += cur.l / prev.c - 1; cArr[i] += cur.c / prev.c - 1;
      vArr[i] += cur.v || 0; nArr[i]++;
    }
  }
  /* 净值 bar */
  const nav = new Float64Array(T); nav[0] = 100;
  const eo = new Float64Array(T), eh = new Float64Array(T), el = new Float64Array(T), ec = new Float64Array(T), ev = new Float64Array(T), en = new Float64Array(T);
  for (let i = 0; i < T; i++) {
    const n = nArr[i];
    en[i] = n;
    if (i === 0) { ec[i] = nav[i]; continue; }
    if (n < 20) { /* 样本不足: 指数平盘延续 */
      eo[i] = eh[i] = el[i] = ec[i] = nav[i - 1]; nav[i] = nav[i - 1]; ev[i] = 0; continue;
    }
    const base = nav[i - 1];
    eo[i] = base * (1 + oArr[i] / n); eh[i] = base * (1 + hArr[i] / n);
    el[i] = base * (1 + lArr[i] / n); ec[i] = base * (1 + cArr[i] / n);
    ev[i] = vArr[i] / n;
    nav[i] = ec[i];
  }
  console.log(`  [${grain}] 轴${T}根 山寨合约数≈${mean(Array.from(nArr).filter(x => x > 0)).toFixed(0)}`);
  return { T, step, tsAxis, eo, eh, el, ec, ev, en };
}

function analyze(grain, days) {
  const IX = buildIndex(grain, days);
  if (!IX) return null;
  const { T, eo, eh, el, ec, ev, en } = IX;
  const wm = widthSeries(grain);
  const tsAxis = IX.tsAxis;
  /* 派生序列 */
  const ret = new Float64Array(T), retPrev = new Float64Array(T).fill(NaN);
  const P = new Float64Array(T).fill(NaN), W = new Float64Array(T).fill(NaN), lv = new Float64Array(T).fill(NaN);
  const mom5 = new Float64Array(T).fill(NaN);
  const fwd1 = new Float64Array(T).fill(NaN), fwd5 = new Float64Array(T).fill(NaN);
  for (let i = 1; i < T; i++) {
    ret[i] = ec[i] / ec[i - 1] - 1;
    if (i >= 2) retPrev[i] = ret[i - 1];
    const rng = eh[i] - el[i];
    P[i] = rng > 1e-12 ? (ec[i] - el[i]) / rng : 0.5;
    W[i] = wm.has(tsAxis[i]) ? wm.get(tsAxis[i]) : NaN;
    lv[i] = ev[i] > 0 ? Math.log(ev[i]) : NaN;
    if (i >= 5) mom5[i] = ec[i] / ec[i - 5] - 1;
    if (i < T - 5) fwd5[i] = ec[i + 5] / ec[i] - 1;
  }
  /* fwd1 必须在 ret 填满后二次填 (前向引用 bug: 循环内 ret[i+1] 尚未赋值恒 0) */
  for (let i = 0; i < T - 1; i++) fwd1[i] = ret[i + 1];
  /* A_up / A_dn 滚动 200 根 */
  const AUP = new Float64Array(T).fill(NaN), ADN = new Float64Array(T).fill(NaN);
  let sUp = 0, nUp = 0, sDn = 0, nDn = 0;
  for (let i = 1; i < T; i++) {
    const r = ret[i];
    if (r > 0) { sUp += r; nUp++; } else if (r < 0) { sDn += -r; nDn++; }
    if (i > 200) { const old = ret[i - 200]; if (old > 0) { sUp -= old; nUp--; } else if (old < 0) { sDn -= -old; nDn--; } }
    if (i >= 100 && nUp > 5 && nDn > 5) { AUP[i] = sUp / nUp; ADN[i] = sDn / nDn; }
  }
  /* F1/F2/F3 */
  const F1 = new Float64Array(T).fill(NaN), F2 = new Float64Array(T).fill(NaN), F3 = new Float64Array(T).fill(NaN);
  for (let i = 0; i < T; i++) {
    if (!isNaN(AUP[i]) && !isNaN(P[i])) F1[i] = P[i] * AUP[i] - (1 - P[i]) * ADN[i];
    if (!isNaN(W[i]) && !isNaN(lv[i])) F2[i] = W[i] + 0.5 * lv[i];
    if (!isNaN(F1[i]) && !isNaN(F2[i])) F3[i] = Math.sign(F1[i]) * F2[i];
  }
  /* z 滚动 (500根) */
  function zOf(src) {
    const z = new Float64Array(T).fill(NaN);
    let s = 0, s2 = 0, n = 0;
    const vals = [];
    for (let i = 0; i < T; i++) {
      const v = src[i];
      if (!isNaN(v)) { vals.push(v); s += v; s2 += v * v; n++; }
      if (vals.length > 500) { const o = vals.shift(); s -= o; s2 -= o * o; n--; }
      if (n >= 100) { const mu = s / n, sd = Math.sqrt(Math.max(1e-18, s2 / n - mu * mu)); z[i] = (v - mu) / sd; }
    }
    return z;
  }
  const z1 = zOf(F1), z4 = zOf(mom5), z5 = zOf(W);
  /* F2r: 滚动回归 ln|fwd1| ~ a + b·W + c·lnV (窗 1000, 步长 50 更新) */
  const kap = new Float64Array(T).fill(NaN), del = new Float64Array(T).fill(NaN);
  const F2r = new Float64Array(T).fill(NaN), F3r = new Float64Array(T).fill(NaN);
  let kLast = 1, dLast = 0.5;
  for (let i = 1000; i < T; i++) {
    if ((i - 1000) % 50 === 0) {
      const xs = [], ys = [];
      for (let k = i - 1000; k < i; k++) { if (!isNaN(W[k]) && !isNaN(lv[k]) && !isNaN(fwd1[k]) && fwd1[k] !== 0) { xs.push([1, W[k], lv[k]]); ys.push(Math.log(Math.abs(fwd1[k]))); } }
      if (xs.length > 300) {
        /* OLS 3参 */
        const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
        for (let q = 0; q < xs.length; q++) {
          for (let a = 0; a < 3; a++) { b[a] += xs[q][a] * ys[q]; for (let c2 = 0; c2 < 3; c2++) S[a][c2] += xs[q][a] * xs[q][c2]; }
        }
        /* 高斯消元 */
        const M = [[S[0][0], S[0][1], S[0][2], b[0]], [S[1][0], S[1][1], S[1][2], b[1]], [S[2][0], S[2][1], S[2][2], b[2]]];
        for (let a = 0; a < 3; a++) {
          let pv = a; for (let rr = a + 1; rr < 3; rr++) if (Math.abs(M[rr][a]) > Math.abs(M[pv][a])) pv = rr;
          if (Math.abs(M[pv][a]) < 1e-12) break;
          [M[a], M[pv]] = [M[pv], M[a]];
          for (let rr = 0; rr < 3; rr++) { if (rr === a) continue; const f = M[rr][a] / M[a][a]; for (let cc = a; cc < 4; cc++) M[rr][cc] -= f * M[a][cc]; }
        }
        const sol = [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
        if (isFinite(sol[1]) && isFinite(sol[2])) { kLast = sol[1]; dLast = sol[2]; }
      }
    }
    kap[i] = kLast; del[i] = dLast;
    if (!isNaN(W[i]) && !isNaN(lv[i])) { F2r[i] = kLast * W[i] + dLast * lv[i]; if (!isNaN(F1[i])) F3r[i] = Math.sign(F1[i]) * F2r[i]; }
  }
  const F7 = new Float64Array(T).fill(NaN);
  for (let i = 0; i < T; i++) if (!isNaN(z1[i]) && !isNaN(z4[i]) && !isNaN(z5[i])) F7[i] = z1[i] + z4[i] + z5[i];
  const FS = [F1, F2, F3, mom5, W, retPrev, F7, F2r, F3r];

  /* 评估 */
  const acc = FS.map(() => ({ dirN: 0, dirHit: 0, C: { n: 0, sx: 0, sy: 0, sxy: 0, sx2: 0, sy2: 0 }, q: [0, 0, 0, 0, 0].map(() => ({ n: 0, up: 0, sum: 0 })), f5: { n: 0, win: 0, sum: 0 } }));
  let kapMed = null;
  const kaps = [];
  for (let i = 60; i < T - 5; i++) {
    const f = fwd1[i];
    if (isNaN(f)) continue;
    kaps.push(kap[i]);
    for (let fi = 0; fi < NF; fi++) {
      const x = FS[fi][i];
      if (isNaN(x)) continue;
      const A = acc[fi];
      A.dirN++; if ((x > 0) === (f > 0)) A.dirHit++;
      A.C.n++; A.C.sx += x; A.C.sy += f; A.C.sxy += x * f; A.C.sx2 += x * x; A.C.sy2 += f * f;
      /* 幅度分位: 五分位按当前滚动窗(500根)分位近似 — 用增量分位太贵, 用 |x| 相对窗内已算z的简化: 分位由全期分位数预计算 */
    }
  }
  /* 全期 |x| 分位用于幅度Top10捕捉: 滚动窗快照 */
  const SNAP = 24, WIN = 480;
  const top10 = FS.map(() => ({ hit: 0, n: 0, t1: 0 }));
  for (let i0 = WIN; i0 < T - 5; i0 += SNAP) {
    const af = [];
    for (let k = i0 - WIN; k < i0; k++) { if (!isNaN(fwd1[k])) af.push([Math.abs(fwd1[k]), k]); }
    if (af.length < 100) continue;
    af.sort((a, b) => b[0] - a[0]);
    const actual = new Set(af.slice(0, 10).map(x => x[1]));
    const t1 = af[0][1];
    for (let fi = 0; fi < NF; fi++) {
      const pf = [];
      for (let k = i0 - WIN; k < i0; k++) { const x = FS[fi][k]; if (!isNaN(x)) pf.push([Math.abs(x), k]); }
      if (pf.length < 50) continue;
      pf.sort((a, b) => b[0] - a[0]);
      const p10 = pf.slice(0, 10).map(x => x[1]);
      let hit = 0; for (const k of p10) if (actual.has(k)) hit++;
      top10[fi].hit += hit / 10; top10[fi].n++;
      if (p10[0] === t1) top10[fi].t1++;
    }
  }
  /* 五分位条件概率 + fwd5 (按全期分位) */
  const qs = FS.map(src => {
    const arr = []; for (let i = 60; i < T - 5; i++) if (!isNaN(src[i])) arr.push(src[i]);
    arr.sort((a, b) => a - b);
    return [0.2, 0.4, 0.6, 0.8].map(p => arr[Math.floor(p * arr.length)]);
  });
  for (let i = 60; i < T - 5; i++) {
    const f = fwd1[i]; if (isNaN(f)) continue;
    for (let fi = 0; fi < NF; fi++) {
      const x = FS[fi][i]; if (isNaN(x)) continue;
      const th = qs[fi];
      let qi = x < th[0] ? 0 : x < th[1] ? 1 : x < th[2] ? 2 : x < th[3] ? 3 : 4;
      acc[fi].q[qi].n++; acc[fi].q[qi].sum += f; if (f > 0) acc[fi].q[qi].up++;
      const f5v = fwd5[i];
      if (!isNaN(f5v) && qi === 4) { acc[fi].f5.n++; acc[fi].f5.sum += f5v; if (f5v > 0) acc[fi].f5.win++; }
    }
  }
  kaps.sort((a, b) => a - b);
  kapMed = kaps.length ? kaps[Math.floor(kaps.length / 2)] : null;
  const delMed = null; /* δ 中位数: 简化取最后值 */
  const baseTop10 = 10 / WIN;
  const out = {
    grain, days, axis: T, altCnt: +(mean(Array.from(en).filter(x => x > 0))).toFixed(0),
    kappaMed: kapMed == null ? null : +kapMed.toFixed(3), deltaLast: +dLast.toFixed(3),
    baseTop10: +(100 * baseTop10).toFixed(2),
    formulas: acc.map((A, fi) => ({
      name: FN[fi],
      dirAcc: A.dirN ? +(100 * A.dirHit / A.dirN).toFixed(2) : 0, n: A.dirN,
      ic: (() => { const C = A.C; const d = Math.sqrt((C.n * C.sx2 - C.sx * C.sx) * (C.n * C.sy2 - C.sy * C.sy)); return d > 1e-15 ? +((C.n * C.sxy - C.sx * C.sy) / d).toFixed(4) : 0; })(),
      ampTop10: top10[fi].n ? +(100 * top10[fi].hit / top10[fi].n).toFixed(1) : 0,
      ampTop1: top10[fi].n ? +(100 * top10[fi].t1 / top10[fi].n).toFixed(1) : 0,
      quintiles: A.q.map(q => ({ n: q.n, pUp: q.n ? +(100 * q.up / q.n).toFixed(1) : 0, avg: q.n ? +(q.sum / q.n).toFixed(4) : 0 })),
      fwd5TopQ: A.f5.n ? { n: A.f5.n, avg: +(A.f5.sum / A.f5.n).toFixed(4), win: +(100 * A.f5.win / A.f5.n).toFixed(1) } : null
    }))
  };
  return out;
}

function main() {
  const R = {};
  for (const [g, d] of GRAINS) {
    console.log('[grain]', g, d + '天');
    R[g] = analyze(g, d);
    if (R[g]) {
      console.log('  κ标定=' + R[g].kappaMed, 'δ=' + R[g].deltaLast);
      for (const f of R[g].formulas) console.log('  ', f.name.padEnd(10), 'dir', String(f.dirAcc).padStart(6), 'IC', String(f.ic).padStart(8), 'top10', String(f.ampTop10).padStart(5), 'top1', String(f.ampTop1).padStart(5), 'Q5→pUp', f.quintiles[4].pUp);
    }
  }
  const out = path.resolve(__dirname, '../data/analysis/ew-formula-report.json');
  fs.writeFileSync(out, JSON.stringify(R, null, 1));
  console.log('[done] ->', out);
}
main();
