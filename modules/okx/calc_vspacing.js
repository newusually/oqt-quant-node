/* calc_vspacing.js —— 统计"垂直虚线间距"(15m · 两年 · 与线上图表同一算法/同一窗口)
 * 垂直虚线位置 = 缠论顶底点序列中 k 与 k+2 连线的中点(与线上 fib-vlines 组件完全一致),
 * 间距 = 相邻两条垂直虚线的 K 线根数差。
 * 顶底点序列 = chan.detect(candles).pts 的 i + openLeg 终点(与 chan-major links/pts 一致)。
 * 用法: cd modules/okx && node calc_vspacing.js → /tmp/vspacing.json + stdout */
'use strict';
const fs = require('fs');
const path = require('path');
const CH = require('./engines/chan');
const KS = require('./engines/kstore');

const GRAIN = '1h';   // ★2026-11-07 15m 已禁用，改用 1h
const DAYS = 730;                       // ★两年, 与线上 DAYS 默认一致
const OUT = '/tmp/vspacing.json';
const PROG = '/tmp/vspacing-progress.json';

function main() {
  const sinceTs = Date.now() - DAYS * 86400000;
  const cfg = CH.getConfig();
  const dir15 = path.join(KS.KLINE_DIR, GRAIN);
  const insts = fs.readdirSync(dir15).filter(d => d.endsWith('-USDT-SWAP')).sort();
  const allSp = [];
  let btc = null;
  let contracts = 0;
  const t0 = Date.now();
  for (const inst of insts) {
    let candles = null;
    try { candles = CH.loadCandles(GRAIN, sinceTs, inst); } catch (e) { }
    if (!candles || candles.length < 300) continue;
    let det = null;
    try { det = CH.detect(candles, cfg); } catch (e) { }
    if (!det || !det.pts || det.pts.length < 3) continue;
    /* 顶底点序列(bar index): detect.pts + openLeg 终点 */
    const idxs = det.pts.map(p => p.i);
    if (det.openLeg) {
      const ots = det.openLeg.toTs;
      let lo = 0, hi = candles.length - 1, oi = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (candles[mid].ts <= ots) { oi = mid; lo = mid + 1; } else hi = mid - 1; }
      if (oi >= 0 && oi > idxs[idxs.length - 1]) idxs.push(oi);
    }
    if (idxs.length < 3) continue;
    /* 垂直虚线中点序列 + 相邻间距 */
    const mids = [];
    for (let k = 0; k + 2 < idxs.length; k++) mids.push((idxs[k] + idxs[k + 2]) / 2);
    const sp = [];
    for (let k = 0; k + 1 < mids.length; k++) { const d = mids[k + 1] - mids[k]; if (d > 0) sp.push(d); }
    if (!sp.length) continue;
    allSp.push.apply(allSp, sp);
    contracts++;
    const mean = sp.reduce((a, b) => a + b, 0) / sp.length;
    const rec = { inst, pivots: idxs.length, vlines: mids.length, spacings: sp.length, meanBars: +mean.toFixed(2), meanHours: +(mean * 0.25).toFixed(2) };
    if (inst === 'BTC-USDT-SWAP') btc = rec;
    try { fs.writeFileSync(PROG, JSON.stringify({ done: contracts, total: insts.length, last: inst })); } catch (e) { }
    if (contracts % 25 === 0) console.log('progress ' + contracts + '/' + insts.length + ' (' + ((Date.now() - t0) / 1000 | 0) + 's)');
  }
  const meanAll = allSp.length ? allSp.reduce((a, b) => a + b, 0) / allSp.length : 0;
  const sorted = allSp.slice().sort((a, b) => a - b);
  const med = sorted.length ? sorted[sorted.length >> 1] : 0;
  const out = {
    grain: GRAIN, days: DAYS,
    btc15m: btc,
    contracts: contracts,
    totalSpacings: allSp.length,
    meanAllBars: +meanAll.toFixed(2),
    meanAllHours: +(meanAll * 0.25).toFixed(3),
    meanAllDays: +(meanAll / 96).toFixed(3),
    medianAllBars: +med.toFixed(2),
    p25: sorted.length ? +sorted[Math.floor(sorted.length * 0.25)].toFixed(2) : 0,
    p75: sorted.length ? +sorted[Math.floor(sorted.length * 0.75)].toFixed(2) : 0,
    elapsedSec: +((Date.now() - t0) / 1000).toFixed(1)
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('====RESULT====');
  console.log(JSON.stringify(out, null, 2));
}
main();
