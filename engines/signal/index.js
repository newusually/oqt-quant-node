// L4 engines/signal · 缠论买卖点引擎（原 cpp/signal 1:1 转换）
// 买卖点 = EMA12/26 金叉(side=1 买) / 死叉(side=-1 卖)
'use strict';
const { ema } = require('../../core/mathx');

function chanSignals(close, limit) {
  const e12 = ema(close, 12);
  const e26 = ema(close, 26);
  const sigs = [];
  for (let i = 1; i < close.length; i++) {
    const up = e12[i - 1] <= e26[i - 1] && e12[i] > e26[i];
    const dn = e12[i - 1] >= e26[i - 1] && e12[i] < e26[i];
    if (!up && !dn) continue;
    sigs.push({ t: null, px: close[i], side: up ? 1 : -1, cv: 1, rs: 1 });
  }
  if (limit && sigs.length > limit) sigs.splice(0, sigs.length - limit);
  return sigs;
}

module.exports = { chanSignals };
