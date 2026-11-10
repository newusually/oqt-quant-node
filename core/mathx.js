// L2 core · 数学（原 cpp/core 数值工具 1:1 转换）
'use strict';

// 简单移动平均
function sma(arr, n) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

// 指数移动平均
function ema(arr, n) {
  const out = new Array(arr.length).fill(null);
  if (!arr.length) return out;
  const k = 2 / (n + 1);
  let prev = arr[0];
  out[0] = arr[0];
  for (let i = 1; i < arr.length; i++) {
    prev = arr[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function round(v, d = 3) {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

// 百分比
function pct(a, b) { return b ? (a - b) / b * 100 : 0; }

module.exports = { sma, ema, round, pct };
