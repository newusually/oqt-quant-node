#!/usr/bin/env node
/* ============================================================================
 * tools/formula_res.js — 公式共振指标实测（用户: 共振能不能更准, 可叠加）
 * ----------------------------------------------------------------------------
 * 候选(每根K横截面, 全合约):
 *   基线   F3=sign(F1)·(κW+δlnV̂)   F4=mom5   W   rprev   F7=z(F1)+z(mom)+z(W)
 *   R2双票 F3与mom同向才出信号(否则0)          score=agree? F3 : 0
 *   R3三票 f3/mom/W 多数≥2                     score=符号票数和(-3..3)
 *   R4四票 f3/mom/W/rprev 多数≥3               score=符号票数和
 *   R5全票 4/4 同向才出信号                    score=符号票数和(±4)
 *   ZW叠加 z(f3)+2·z(mom)+z(W)                连续满覆盖
 *   AMP共振 幅度榜|mom|Top10 ∩ 方向共振(R3支持mom方向) → 大波动捕捉提升?
 * 指标: dirAcc(仅非零) / 覆盖率 / IC / IC非零 / ampTop10 / ampTop1 / 涨跌Top1·Top5
 * 窗口: 5m/45天(每10分钟抽样) + 15m/90天 + 1h/90天
 * 输出: data/analysis/formula-res-report.json
 * ========================================================================== */
'use strict';
const CH = require('../modules/okx/engines/chan');
const T = require('../modules/okx/engines/universe');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const OUT = 'data/analysis/formula-res-report.json';
const KAPPA = 1.0, DELTA = 0.5;
const TASKS = [
  { grain: '5m', days: 45, stride: 600 },
  { grain: '15m', days: 90 },
  { grain: '1h', days: 90 }
];
/* 输出顺序 */
const CN = ['F3符号宽度', 'F4动量', 'F7z合成', 'R2双票', 'R3三票', 'R4四票', 'R5全票', 'ZW叠加', 'AMP共振'];
const NF = CN.length;

function widthMap(grain, sinceMs) {
  const m = new Map();
  try {
    const db = new DatabaseSync('data/okx/updown.sqlite', { readOnly: true });
    const rows = db.prepare('SELECT ts,up,down FROM updown WHERE grain=? AND ts>=?').all(grain, sinceMs);
    for (const r of rows) {
      const n = (r.up || 0) + (r.down || 0);
      if (n > 0) m.set(Math.round(r.ts / 1000), (r.up - r.down) / n);
    }
    db.close();
  } catch (e) { }
  return m;
}
function rank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(arr.length);
  for (let i = 0; i < idx.length; i++) r[idx[i][1]] = i + 1;
  return r;
}
function spearman(a, b) {
  const n = a.length;
  if (n < 8) return 0;
  const ra = rank(a), rb = rank(b);
  let sa = 0, sb = 0, sab = 0;
  for (let i = 0; i < n; i++) { sa += ra[i]; sb += rb[i]; sab += ra[i] * rb[i]; }
  const cov = sab / n - (sa / n) * (sb / n);
  const va = ra.reduce((s, x) => s + x * x, 0) / n - (sa / n) ** 2;
  const vb = rb.reduce((s, x) => s + x * x, 0) / n - (sb / n) ** 2;
  return (va > 0 && vb > 0) ? cov / Math.sqrt(va * vb) : 0;
}
function orderIdx(arr, desc) {
  return arr.map((v, i) => i).sort((a, b) => desc ? arr[b] - arr[a] : arr[a] - arr[b]);
}
function zscore(arr) {
  const n = arr.length;
  let m = 0; for (const x of arr) m += x; m /= n;
  let v = 0; for (const x of arr) v += (x - m) * (x - m);
  const sd = Math.sqrt(v / n);
  return arr.map(x => sd > 0 ? (x - m) / sd : 0);
}
const sg = x => x > 0 ? 1 : (x < 0 ? -1 : 0);

async function main() {
  const u = await T.universe();
  const rawList = u && Array.isArray(u.list) ? u.list : (Array.isArray(u) ? u : []);
  const insts = rawList.map(it => it && (it.instId || it.code)).filter(Boolean);
  if (!insts.length) { console.log('EMPTY UNIVERSE'); process.exit(1); }
  console.log('universe', insts.length);
  const report = { generatedAt: Math.floor(Date.now() / 1000), grains: {} };

  for (const task of TASKS) {
    const { grain, days, stride } = task;
    const since = Date.now() - days * 86400000;
    const wmap = widthMap(grain, since);
    const cross = new Map();
    let nSeries = 0;
    for (const instId of insts) {
      let bars;
      try { bars = CH.loadCandles(grain, since, instId); } catch (e) { continue; }
      if (!bars || bars.length < 40) continue;
      nSeries++;
      const n = bars.length;
      let vsum = 0; const vq = [];
      for (let i = 0; i < n; i++) { vq.push(bars[i].v); vsum += bars[i].v; if (vq.length > 20) vsum -= vq.shift(); }
      for (let i = 0; i < n; i++) {
        if (i + 5 >= n || i < 21) continue;
        const b = bars[i];
        if (!(b.h > 0) || !(b.o > 0) || !(b.c > 0)) continue;
        const rng = b.h - b.l;
        const P = rng > 0 ? (b.c - b.l) / rng : 0.5;
        const f1 = P * (b.h - b.o) / b.o - (1 - P) * (b.o - b.l) / b.o;
        const ma20 = vq.length ? vsum / vq.length : b.v;
        const vhat = Math.max(ma20 > 0 ? b.v / ma20 : 1, 0.05);
        const W = wmap.get(Math.round(b.ts / 1000)) || 0;
        const f3 = (f1 >= 0 ? 1 : -1) * (KAPPA * W + DELTA * Math.log(vhat));
        const mom = b.c / bars[i - 5].c - 1;
        const rprev = b.c / bars[i - 1].c - 1;
        const fwd = bars[i + 5].c / b.c - 1;
        if (!isFinite(fwd)) continue;
        const ts = Math.round(b.ts / 1000);
        if (stride && ts % stride !== 0) continue;
        let cell = cross.get(ts);
        if (!cell) { cell = []; cross.set(ts, cell); }
        cell.push([f1, f3, mom, W, rprev, fwd]);
      }
      if (nSeries % 60 === 0) await new Promise(r => setImmediate(r));
    }
    console.log(grain, 'series=' + nSeries, 'ts=' + cross.size);

    const acc = {
      dir: new Array(NF).fill(0), nz: new Array(NF).fill(0), tot: 0,
      ic: new Array(NF).fill(0), icNZ: new Array(NF).fill(0), icN: 0,
      ampTop10: new Array(NF).fill(0), ampTop1: new Array(NF).fill(0),
      upTop1: new Array(NF).fill(0), upTop5: new Array(NF).fill(0),
      dnTop1: new Array(NF).fill(0), dnTop5: new Array(NF).fill(0),
      nCs: 0, nRows: 0, baseTop10: 0
    };

    for (const [, cell] of cross) {
      const n = cell.length;
      if (n < 30) continue;
      acc.nCs++; acc.nRows += n; acc.baseTop10 += Math.min(10, n) / n;
      const f1 = cell.map(r => r[0]), f3 = cell.map(r => r[1]), mom = cell.map(r => r[2]);
      const W = cell.map(r => r[3]), rp = cell.map(r => r[4]), fwd = cell.map(r => r[5]);
      const zf1 = zscore(f1), zmom = zscore(mom), zw = zscore(W), zf3 = zscore(f3);
      const f7 = zf1.map((z, k) => z + zmom[k] + zw[k]);
      /* 共振票 */
      const s3 = f3.map(sg), sm = mom.map(sg), sw = W.map(sg), sr = rp.map(sg);
      const r2 = f3.map((v, k) => (s3[k] === sm[k] && s3[k] !== 0) ? v : 0);                     /* 双票: F3与mom同向 */
      const r3 = f3.map((v, k) => { const c = s3[k] + sm[k] + sw[k]; return Math.abs(c) >= 2 ? c : 0; });  /* 三票多数 */
      const r4 = f3.map((v, k) => { const c = s3[k] + sm[k] + sw[k] + sr[k]; return Math.abs(c) >= 3 ? c : 0; });
      const r5 = f3.map((v, k) => { const c = s3[k] + sm[k] + sw[k] + sr[k]; return Math.abs(c) === 4 ? c : 0; });
      const zwS = zf3.map((z, k) => z + 2 * zmom[k] + zw[k]);                                    /* z加权叠加 */
      /* AMP共振: 幅度榜 |mom|, 但要求 R3 多数票支持 mom 方向 */
      const amp = mom.map((m, k) => (r3[k] !== 0 && sg(r3[k]) === sg(m)) ? Math.abs(m) * sg(m) : 0);
      const preds = [f3, mom, f7, r2, r3, r4, r5, zwS, amp];

      for (let f = 0; f < NF; f++) {
        const p = preds[f];
        let icA = [], icB = [], nzA = [], nzB = [];
        for (let k = 0; k < n; k++) {
          const s = sg(p[k]), a = sg(fwd[k]);
          if (a === 0) continue;
          acc.tot += (f === 0 ? 1 : 0);
          if (p[k] !== 0) { acc.nz[f]++; if (s === a) acc.dir[f]++; icA.push(p[k]); icB.push(fwd[k]); }
        }
        if (icA.length >= 8) { acc.ic[f] += spearman(icA, icB) * icA.length / n; acc.icNZ[f] += spearman(icA, icB); }
      }
      acc.icN++;

      const af = fwd.map(Math.abs);
      const afOrd = orderIdx(af, true);
      const actualTop = new Set(afOrd.slice(0, Math.min(10, n)));
      const actualTop1 = afOrd[0];
      const upOrd = orderIdx(fwd, true), dnOrd = orderIdx(fwd, false);
      for (let f = 0; f < NF; f++) {
        const pf = preds[f].map(Math.abs);
        const pTop = orderIdx(pf, true).slice(0, Math.min(10, n));
        let hit = 0; for (const k of pTop) if (actualTop.has(k)) hit++;
        acc.ampTop10[f] += hit / Math.min(10, n);
        acc.ampTop1[f] += pTop[0] === actualTop1 ? 1 : 0;
        const pOrd = orderIdx(preds[f], true);
        const p5 = new Set(pOrd.slice(0, 5)), pB5 = new Set(pOrd.slice(-5));
        if (pOrd[0] === upOrd[0]) acc.upTop1[f]++;
        if (p5.has(upOrd[0])) acc.upTop5[f]++;
        if (pOrd[pOrd.length - 1] === dnOrd[0]) acc.dnTop1[f]++;
        if (pB5.has(dnOrd[0])) acc.dnTop5[f]++;
      }
    }

    const g = {
      windowDays: days, series: nSeries, tsEval: acc.nCs, rows: acc.nRows,
      baseAmpTop10: acc.nCs ? +(100 * acc.baseTop10 / acc.nCs).toFixed(2) : 0,
      formulas: CN.map((name, f) => ({
        name,
        dirAcc: acc.nz[f] ? +(100 * acc.dir[f] / acc.nz[f]).toFixed(2) : 0,
        coverage: acc.tot ? +(100 * acc.nz[f] / acc.tot).toFixed(1) : 0,
        ic: acc.nCs ? +(acc.ic[f] / acc.nCs).toFixed(4) : 0,
        icNZ: acc.nCs ? +(acc.icNZ[f] / acc.nCs).toFixed(4) : 0,
        ampTop10: acc.nCs ? +(100 * acc.ampTop10[f] / acc.nCs).toFixed(2) : 0,
        ampTop1: acc.nCs ? +(100 * acc.ampTop1[f] / acc.nCs).toFixed(2) : 0,
        upTop1: acc.nCs ? +(100 * acc.upTop1[f] / acc.nCs).toFixed(2) : 0,
        upTop5: acc.nCs ? +(100 * acc.upTop5[f] / acc.nCs).toFixed(2) : 0,
        dnTop1: acc.nCs ? +(100 * acc.dnTop1[f] / acc.nCs).toFixed(2) : 0,
        dnTop5: acc.nCs ? +(100 * acc.dnTop5[f] / acc.nCs).toFixed(2) : 0
      }))
    };
    report.grains[grain] = g;
    console.log(grain, 'done. R3 dirAcc=' + g.formulas[4].dirAcc + '% cov=' + g.formulas[4].coverage + '%');
  }

  fs.mkdirSync('data/analysis', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log('SAVED ' + OUT);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
