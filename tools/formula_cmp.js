#!/usr/bin/env node
/* formula_cmp.js — 涨跌幅预测公式跨合约横截面比较
 * 候选公式（每根K线、全合约同时计算）:
 *   F1  控制变量主式   r̂ = P·A_up − (1−P)·A_dn        (涨跌幅推导HTML 式2.x)
 *   F2  宽度量比(无符号) lnR̂ = κW + δ·lnV̂             (式3.4, κ=1 δ=0.5)
 *   F3  符号×宽度量比  sign(F1)·F2
 *   F4  纯动量         mom5 = C/C[-5]−1
 *   F5  纯宽度         W = (up−down)/(up+down)
 *   F6  前一根涨跌幅   rprev
 *   F7  z合成          z(F1)+z(mom5)+z(W)   (横截面等权)
 * 真实值: fwd5 = C[i+5]/C[i]−1 (5根K线, 与信号回测同口径)
 * 指标: 方向准确率 / Rank IC / |fwd|最大Top10捕捉率 / 最大涨幅(跌)合约Top1·Top5命中
 * 窗口: 5m→45天, 15m/1h→90天
 */
'use strict';
const CH = require('../modules/okx/engines/chan');
const T = require('../modules/okx/engines/universe');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const OUT = process.env.FC_ONLY ? 'data/analysis/formula-cmp-15m.json' : 'data/analysis/formula-cmp-report.json';
const KAPPA = 1.0, DELTA = 0.5;
const TASKS = (process.env.FC_ONLY
  ? [{ grain: process.env.FC_ONLY, days: 90, stride: 1800 }]
  : [
    { grain: '5m', days: 45 },
    { grain: '15m', days: 90 },
    { grain: '1h', days: 90 }
  ]);
const FN = ['F1控制变量', 'F2宽度量比', 'F3符号×宽度', 'F4动量5', 'F5纯宽度', 'F6前收涨跌', 'F7z合成'];

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
    console.log('  width[' + grain + '] ' + m.size + ' bars');
  } catch (e) { console.log('  width[' + grain + '] FAIL ' + e.message); }
  return m;
}

/* Spearman 相关 (简单秩, n>=8) */
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
function rank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(arr.length);
  for (let i = 0; i < idx.length; i++) r[idx[i][1]] = i + 1;
  return r;
}
/* 返回升序排序后原索引数组 */
function orderIdx(arr, desc) {
  const idx = arr.map((v, i) => i).sort((a, b) => desc ? arr[b] - arr[a] : arr[a] - arr[b]);
  return idx;
}
function zscore(arr) {
  const n = arr.length;
  let m = 0; for (const x of arr) m += x; m /= n;
  let v = 0; for (const x of arr) v += (x - m) * (x - m);
  const sd = Math.sqrt(v / n);
  return arr.map(x => sd > 0 ? (x - m) / sd : 0);
}

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
    /* cross: ts → { rows:[[f1,f5,mom,w,rprev,fwd,instIdx],...] } */
    const cross = new Map();
    let nSeries = 0;
    for (const instId of insts) {
      let bars;
      try { bars = CH.loadCandles(grain, since, instId); } catch (e) { continue; }
      if (!bars || bars.length < 40) continue;
      nSeries++;
      const n = bars.length;
      const idx0 = insts.indexOf(instId);
      /* 预计算量MA20(前20根) */
      let vsum = 0;
      const vq = [];
      for (let i = 0; i < n; i++) {
        const b = bars[i];
        vq.push(b.v); vsum += b.v;
        if (vq.length > 20) vsum -= vq.shift();
      }
      for (let i = 0; i < n; i++) {
        if (i + 5 >= n) break;
        if (i < 21) continue;                       /* 需要MA20与前5根 */
        const b = bars[i];
        const H = b.h, L = b.l, C = b.c, O = b.o, V = b.v;
        if (!(H > 0) || !(O > 0) || !(C > 0)) continue;
        const rng = H - L;
        const P = rng > 0 ? (C - L) / rng : 0.5;
        const Aup = (H - O) / O, Adn = (O - L) / O;
        const f1 = P * Aup - (1 - P) * Adn;
        const ma20 = vq.length ? vsum / vq.length : V;
        const vhat = Math.max(ma20 > 0 ? V / ma20 : 1, 0.05);
        const W = wmap.get(Math.round(b.ts / 1000)) || 0;
        const f2 = KAPPA * W + DELTA * Math.log(vhat);
        const f3 = (f1 >= 0 ? 1 : -1) * f2;
        const mom = C / bars[i - 5].c - 1;
        const rprev = C / bars[i - 1].c - 1;
        const fwd = bars[i + 5].c / C - 1;
        if (!isFinite(fwd)) continue;
        const ts = Math.round(b.ts / 1000);
        if (stride && ts % stride !== 0) continue;
        if (grain === '5m' && ts % 600 !== 0) continue;   /* 5m 每10分钟取一个横截面, 控内存 */
        let cell = cross.get(ts);
        if (!cell) { cell = []; cross.set(ts, cell); }
        cell.push([f1, f2, f3, mom, W, rprev, fwd, idx0]);
      }
      if (nSeries % 60 === 0) await new Promise(r => setImmediate(r));
    }
    console.log(grain, 'series=' + nSeries, 'ts=' + cross.size);

    /* 横截面指标累加器 */
    const NF = 7;
    const acc = {
      dir: new Array(NF).fill(0), tot: 0, icSum: new Array(NF).fill(0), icN: 0,
      icAbsSum: new Array(NF).fill(0),
      ampTop10: new Array(NF).fill(0), ampTop1: new Array(NF).fill(0),
      upTop1: new Array(NF).fill(0), upTop5: new Array(NF).fill(0),
      dnTop1: new Array(NF).fill(0), dnTop5: new Array(NF).fill(0),
      nCs: 0, nRows: 0, baseTop10: 0
    };
    /* 每合约方向计数: per formula [signOK, n] */
    const perInst = insts.map(() => Array.from({ length: NF }, () => [0, 0]));

    for (const [ts, cell] of cross) {
      const n = cell.length;
      if (n < 30) continue;
      acc.nCs++; acc.nRows += n;
      acc.baseTop10 += Math.min(10, n) / n;
      const f1 = cell.map(r => r[0]), f2 = cell.map(r => r[1]), f3 = cell.map(r => r[2]);
      const mom = cell.map(r => r[3]), W = cell.map(r => r[4]), rp = cell.map(r => r[5]);
      const fwd = cell.map(r => r[6]), ii = cell.map(r => r[7]);
      const zf1 = zscore(f1), zmom = zscore(mom), zw = zscore(W);
      const f7 = zf1.map((z, k) => z + zmom[k] + zw[k]);
      const preds = [f1, f2, f3, mom, W, rp, f7];
      /* 方向 */
      for (let f = 0; f < NF; f++) {
        const p = preds[f];
        for (let k = 0; k < n; k++) {
          const s = p[k] > 0 ? 1 : (p[k] < 0 ? -1 : 0);
          const a = fwd[k] > 0 ? 1 : (fwd[k] < 0 ? -1 : 0);
          if (a === 0) continue;
          acc.tot += (f === 0 ? 1 : 0);   /* 只累计一次总样本 */
          if (s === a) { acc.dir[f]++; perInst[ii[k]][f][0]++; }
          perInst[ii[k]][f][1]++;
        }
      }
      /* IC */
      for (let f = 0; f < NF; f++) acc.icSum[f] += spearman(preds[f], fwd);
      acc.icN++;
      /* 幅度IC: |预测| vs |真实| */
      const afwd = fwd.map(Math.abs);
      for (let f = 0; f < NF; f++) acc.icAbsSum[f] += spearman(preds[f].map(Math.abs), afwd);
      /* |fwd| 大波动 Top10 捕捉: 实际 |fwd| 前10 vs 预测 |score| 前10 */
      const af = fwd.map(Math.abs);
      const afOrd = orderIdx(af, true);
      const actualTop = new Set(afOrd.slice(0, Math.min(10, n)));
      const actualTop1 = afOrd[0];
      for (let f = 0; f < NF; f++) {
        const pf = preds[f].map(Math.abs);
        const pTop = orderIdx(pf, true).slice(0, Math.min(10, n));
        let hit = 0; for (const k of pTop) if (actualTop.has(k)) hit++;
        acc.ampTop10[f] += hit / Math.min(10, n);
        acc.ampTop1[f] += pTop[0] === actualTop1 ? 1 : 0;
      }
      /* 最大涨幅合约: 实际 argmax(fwd) vs 预测 argmax(score) */
      const upOrd = orderIdx(fwd, true);
      const dnOrd = orderIdx(fwd, false);
      for (let f = 0; f < NF; f++) {
        const pOrd = orderIdx(preds[f], true);
        if (pOrd[0] === upOrd[0]) acc.upTop1[f]++;
        const p5 = new Set(pOrd.slice(0, 5));
        if (p5.has(upOrd[0])) acc.upTop5[f]++;
        if (pOrd[pOrd.length - 1] === dnOrd[0]) acc.dnTop1[f]++;
        const pB5 = new Set(pOrd.slice(-5));
        if (pB5.has(dnOrd[0])) acc.dnTop5[f]++;
      }
    }

    const dirBase = acc.tot / (NF ? 1 : 1); /* 总样本 */
    const fmt = arr => arr.map(x => x);
    const g = {
      windowDays: days, series: nSeries, tsEval: acc.nCs, rows: acc.nRows,
      dirSample: acc.tot / 1,
      formulas: FN.map((name, f) => ({
        name: name,
        dirAcc: acc.tot ? +(100 * acc.dir[f] / acc.tot).toFixed(2) : 0,
        ic: acc.icN ? +(acc.icSum[f] / acc.icN).toFixed(4) : 0,
        icAbs: acc.icN ? +(acc.icAbsSum[f] / acc.icN).toFixed(4) : 0,
        ampTop10: acc.nCs ? +(100 * acc.ampTop10[f] / acc.nCs).toFixed(2) : 0,
        ampTop1: acc.nCs ? +(100 * acc.ampTop1[f] / acc.nCs).toFixed(2) : 0,
        upTop1: acc.nCs ? +(100 * acc.upTop1[f] / acc.nCs).toFixed(2) : 0,
        upTop5: acc.nCs ? +(100 * acc.upTop5[f] / acc.nCs).toFixed(2) : 0,
        dnTop1: acc.nCs ? +(100 * acc.dnTop1[f] / acc.nCs).toFixed(2) : 0,
        dnTop5: acc.nCs ? +(100 * acc.dnTop5[f] / acc.nCs).toFixed(2) : 0
      })),
      baseAmpTop10: acc.nCs ? +(100 * acc.baseTop10 / acc.nCs).toFixed(2) : 0,
      perInstWinner: {}
    };
    /* 每合约最优公式(方向准确率, 需≥30样本) */
    const winCnt = new Array(NF).fill(0);
    const winners = [];
    for (let s = 0; s < insts.length; s++) {
      let best = -1, bv = -1;
      for (let f = 0; f < NF; f++) {
        const [ok, nn] = perInst[s][f];
        if (nn < 30) continue;
        const r = ok / nn;
        if (r > bv) { bv = r; best = f; }
      }
      if (best >= 0) { winCnt[best]++; winners.push({ instId: insts[s], best: FN[best], acc: +(100 * bv).toFixed(1) }); }
    }
    FN.forEach((name, f) => { g.perInstWinner[name] = winCnt[f]; });
    winners.sort((a, b) => b.acc - a.acc);
    g.winnersTop = winners.slice(0, 10);
    g.winnersAcc = { ge55: winners.filter(w => w.acc >= 55).length, ge60: winners.filter(w => w.acc >= 60).length, ge80: winners.filter(w => w.acc >= 80).length, total: winners.length };
    report.grains[grain] = g;
    console.log(grain, 'dirBase≈50%; F1 dirAcc=' + g.formulas[0].dirAcc + '% IC=' + g.formulas[0].ic);
  }

  fs.mkdirSync('data/analysis', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report));
  console.log('SAVED ' + OUT);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
