#!/usr/bin/env node
/* ============================================================================
 * tools/formula_stack.js — 分工叠加实测: 动量选大波动候选 → 宽度公式定方向
 *   每根K横截面: A=|mom|Top10 候选内 F3方向准确率(对比 mom自身方向)
 *               B=宽度量比f2log Top10 候选内 F3方向准确率
 *   完整链路命中率 = 捕捉率(26%) × 方向准确率
 * 窗口: 5m/45天(stride600) + 15m/90天; 输出 data/analysis/formula-stack.json
 * ========================================================================== */
'use strict';
const CH = require('../modules/okx/engines/chan');
const T = require('../modules/okx/engines/universe');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const OUT = 'data/analysis/formula-stack.json';
const KAPPA = 1.0, DELTA = 0.5;
const TASKS = [
  { grain: '5m', days: 45, stride: 600 },
  { grain: '15m', days: 90 },
  { grain: '1h', days: 90 }
];
const sg = x => x > 0 ? 1 : (x < 0 ? -1 : 0);
function widthMap(grain, sinceMs) {
  const m = new Map();
  try {
    const db = new DatabaseSync('data/okx/updown.sqlite', { readOnly: true });
    for (const r of db.prepare('SELECT ts,up,down FROM updown WHERE grain=? AND ts>=?').all(grain, sinceMs)) {
      const n = (r.up || 0) + (r.down || 0);
      if (n > 0) m.set(Math.round(r.ts / 1000), (r.up - r.down) / n);
    }
    db.close();
  } catch (e) { }
  return m;
}
function orderIdx(arr, desc) { return arr.map((v, i) => i).sort((a, b) => desc ? arr[b] - arr[a] : arr[a] - arr[b]); }

async function main() {
  const u = await T.universe();
  const rawList = u && Array.isArray(u.list) ? u.list : (Array.isArray(u) ? u : []);
  const insts = rawList.map(it => it && (it.instId || it.code)).filter(Boolean);
  const report = { generatedAt: Math.floor(Date.now() / 1000), grains: {} };
  for (const task of TASKS) {
    const { grain, days, stride } = task;
    const since = Date.now() - days * 86400000;
    const wmap = widthMap(grain, since);
    const cross = new Map();
    let nSeries = 0;
    for (const instId of insts) {
      let bars; try { bars = CH.loadCandles(grain, since, instId); } catch (e) { continue; }
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
        const f2log = KAPPA * W + DELTA * Math.log(vhat);
        const mom = b.c / bars[i - 5].c - 1;
        const fwd = bars[i + 5].c / b.c - 1;
        if (!isFinite(fwd)) continue;
        const ts = Math.round(b.ts / 1000);
        if (stride && ts % stride !== 0) continue;
        let cell = cross.get(ts);
        if (!cell) { cell = []; cross.set(ts, cell); }
        cell.push([f3, f2log, mom, fwd]);
      }
      if (nSeries % 60 === 0) await new Promise(r => setImmediate(r));
    }
    /* 统计 */
    let nCs = 0;
    const st = {
      ampN: 0, ampF3ok: 0, ampMomOk: 0,            /* |mom|Top10 内: 样本数/F3方向对/mom方向对 */
      widN: 0, widF3ok: 0, widMomOk: 0,            /* f2logTop10 内 */
      allN: 0, allF3ok: 0                          /* 全样本 F3 方向(对照) */
    };
    for (const [, cell] of cross) {
      const n = cell.length;
      if (n < 30) continue;
      nCs++;
      const f3 = cell.map(r => r[0]), f2 = cell.map(r => r[1]), mom = cell.map(r => r[2]), fwd = cell.map(r => r[3]);
      const tick = (idx, a, b) => {
        for (const k of idx) {
          if (fwd[k] === 0) continue;
          a.n++; if (sg(f3[k]) === sg(fwd[k])) a.ok1++;
          if (sg(mom[k]) === sg(fwd[k])) a.ok2++;
        }
      };
      const boxA = { n: 0, ok1: 0, ok2: 0 }, boxB = { n: 0, ok1: 0, ok2: 0 };
      tick(orderIdx(mom.map(Math.abs), true).slice(0, Math.min(10, n)), boxA);
      tick(orderIdx(f2, true).slice(0, Math.min(10, n)), boxB);
      st.ampN += boxA.n; st.ampF3ok += boxA.ok1; st.ampMomOk += boxA.ok2;
      st.widN += boxB.n; st.widF3ok += boxB.ok1; st.widMomOk += boxB.ok2;
      for (let k = 0; k < n; k++) { if (fwd[k] === 0) continue; st.allN++; if (sg(f3[k]) === sg(fwd[k])) st.allF3ok++; }
    }
    report.grains[grain] = {
      windowDays: days, series: nSeries, tsEval: nCs,
      momTop10: { n: st.ampN, dirF3: +(100 * st.ampF3ok / Math.max(1, st.ampN)).toFixed(2), dirMom: +(100 * st.ampMomOk / Math.max(1, st.ampN)).toFixed(2) },
      widTop10: { n: st.widN, dirF3: +(100 * st.widF3ok / Math.max(1, st.widN)).toFixed(2), dirMom: +(100 * st.widMomOk / Math.max(1, st.widN)).toFixed(2) },
      allSample: { n: st.allN, dirF3: +(100 * st.allF3ok / Math.max(1, st.allN)).toFixed(2) }
    };
    console.log(grain, 'done', JSON.stringify(report.grains[grain].momTop10));
  }
  fs.mkdirSync('data/analysis', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log('SAVED ' + OUT);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
