// L4 engines/ind · 指标引擎（原 cpp/ind 1:1 转换）
// 提供 MA / EMA / MACD / KDJ / RSI，全部纯函数，数组输入、数组输出。
'use strict';
const { sma, ema } = require('../../core/mathx');

// MACD 全量（与原 cpp/ind macd 一致：EMA12/26 + 9 信号）
function macdFull(cl, fast = 12, slow = 26, sig = 9) {
  const e12 = ema(cl, fast);
  const e26 = ema(cl, slow);
  const dif = cl.map((_, i) => ((e12[i] === null || e12[i] === undefined) || (e26[i] === null || e26[i] === undefined)) ? 0 : e12[i] - e26[i]);
  const dea = ema(dif, sig);
  const hist = dif.map((v, i) => ((dea[i] === null || dea[i] === undefined)) ? 0 : (v - dea[i]) * 2);
  return { dif, dea, hist, e12, e26 };
}

// KDJ(9,3,3)
function kdj(high, low, close, n = 9, kp = 3, dp = 3) {
  const len = close.length;
  const K = new Array(len).fill(50), D = new Array(len).fill(50), J = new Array(len).fill(50);
  for (let i = 0; i < len; i++) {
    if (i < n - 1) continue;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { if (high[j] > hh) hh = high[j]; if (low[j] < ll) ll = low[j]; }
    const rsv = hh === ll ? 0 : (close[i] - ll) / (hh - ll) * 100;
    K[i] = (i === n - 1 ? 50 : K[i - 1]) * (1 - 1 / kp) + rsv / kp;
    D[i] = (i === n - 1 ? 50 : D[i - 1]) * (1 - 1 / dp) + K[i] / dp;
    J[i] = 3 * K[i] - 2 * D[i];
  }
  return { k: K, d: D, j: J };
}

// RSI(n)
function rsi(close, n = 14) {
  const len = close.length;
  const out = new Array(len).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < len; i++) {
    const ch = close[i] - close[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
    if (i < n) continue;
    if (i === n) { gain /= n; loss /= n; }
    else { gain = (gain * (n - 1) + Math.max(ch, 0)) / n; loss = (loss * (n - 1) + Math.max(-ch, 0)) / n; }
    const rs = loss === 0 ? 100 : gain / loss;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + rs);
  }
  return out;
}

module.exports = { sma, ema, macdFull, kdj, rsi };
