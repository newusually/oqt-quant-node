// L4 engines/btcurve-core · 信号盈利曲线回测核心（OKX / A股 共用组件）
//   1:1 移植 latest astock/web/btcurve.php 的 btc_sim + 统计口径
//   【口径】只统计【买入】信号 → 每笔按固定金额模拟
//        信号后第一根【开盘价】入场 → 逐根判止盈/止损(同一根同时触及按保守止损)
//        → 超过 maxHold 根未触发 → 按该根收盘平仓(why='到期')
//        曲线: X=出场时间, Y=累计盈亏
//   统计: 笔数/胜率/净盈亏/总盈/总亏/盈亏比/最大回撤
'use strict';

// 单笔模拟
//   bars: [{t,o,h,l,c,v}] 按时间升序; sigIdx: 信号所在K线下标
//   入场 = 该根开盘价(开盘价<=0 时回退信号价); tp/sl 为比例(0.01=1%)
function simulate(bars, sigIdx, fallbackPx, tp, sl, amt, maxHold) {
  const n = bars.length;
  if (n < 2) return null;
  const idx = Math.max(0, Math.min(n - 1, sigIdx | 0));
  if (idx >= n - 1) return null;                      // 无后续K线 → 不结算
  let ep = bars[idx].o > 0 ? bars[idx].o : fallbackPx;
  if (!(ep > 0)) ep = fallbackPx;
  if (!(ep > 0)) return null;
  const tpPx = ep * (1 + tp), slPx = ep * (1 - sl);
  let xp = null, outT = null, why = '到期', held = 0;
  const lim = Math.min(n, idx + (maxHold || 200));
  for (let i = idx; i < lim; i++) {
    const b = bars[i]; held++;
    if (b.l <= slPx) { xp = slPx; outT = b.t; why = '止损'; break; }   // 保守: 同根双触按止损
    if (b.h >= tpPx) { xp = tpPx; outT = b.t; why = '止盈'; break; }
    if (held >= (maxHold || 200)) { xp = b.c; outT = b.t; why = '到期'; break; }
  }
  if (xp === null) { const last = bars[lim - 1]; xp = last.c; outT = last.t; why = '到期'; }
  const ret = (xp - ep) / ep;
  return {
    t: outT, ep: Math.round(ep * 1e8) / 1e8, xp: Math.round(xp * 1e8) / 1e8,
    ret: Math.round(ret * 100000) / 1000, amt: Math.round(amt * ret * 100) / 100,
    why, bars: held
  };
}

// 按出场时间排序 + 累计 + 统计（与 btcurve.php 一致）
//   extra: 附加到 stats 的字段(如窗口信息)
function summarize(pts, extra) {
  pts.sort((a, b) => a.t - b.t);
  let cum = 0, peak = 0, mdd = 0, gain = 0, loss = 0, win = 0;
  for (const p of pts) {
    cum += p.amt;
    p.cum = Math.round(cum * 100) / 100;
    if (p.cum > peak) peak = p.cum;
    const dd = peak - p.cum; if (dd > mdd) mdd = dd;
    if (p.amt > 0) { win++; gain += p.amt; } else loss += p.amt;
  }
  const n = pts.length;
  const stats = {
    n, win, wr: n ? Math.round(win / n * 1000) / 10 : 0,
    net: Math.round(cum * 100) / 100,
    gain: Math.round(gain * 100) / 100,
    loss: Math.round(loss * 100) / 100,
    pf: loss !== 0 ? Math.round(Math.abs(gain / loss) * 100) / 100 : (gain > 0 ? 999 : 0),
    mdd: Math.round(mdd * 100) / 100
  };
  if (extra) Object.assign(stats, extra);
  return stats;
}

// 取K线时间戳: 兼容对象行 {t,...} 与数组行 [ts,o,h,l,c,v]
function tOf(b) { return Array.isArray(b) ? +b[0] : +b.t; }

// 时间戳单位自动识别: >1e11 视为毫秒, 否则秒 → 返回「一天」在该单位下的长度
function dayLen(bars) {
  if (!bars || !bars.length) return 86400000;
  return tOf(bars[bars.length - 1]) > 1e11 ? 86400000 : 86400;
}

// 窗口起点: 最近 days 天的起始时间戳(0/负数=不限, 用全部数据)
//   ★用法: 信号用全量K线算(有足够MACD前置上下文), 模拟时只保留窗口内【出场】的交易
function windowStart(bars, days) {
  const d = +days;
  if (!bars || !bars.length || !d || d <= 0) return 0;
  const dm = dayLen(bars);
  return tOf(bars[bars.length - 1]) - d * dm;
}

// 按天数裁剪: 只保留最近 days 天的K线(0/负数=不裁剪)
function cutByDays(bars, days) {
  if (!bars || !bars.length) return [];
  const d = +days;
  if (!d || d <= 0) return bars;
  const cutoff = windowStart(bars, d);
  const out = bars.filter(b => tOf(b) >= cutoff);
  return out.length ? out : bars;
}

// 实际覆盖天数(首末根跨度)
function coveredDays(bars) {
  if (!bars || bars.length < 2) return 0;
  const dm = dayLen(bars);
  return Math.round((tOf(bars[bars.length - 1]) - tOf(bars[0])) / dm * 10) / 10;
}

// 每周期一根的秒数(用于估算需要多少根K线才够 days 天)
const BAR_SEC = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200, '1d': 86400, '2d': 172800, '3d': 259200, '1w': 604800, '1W': 604800, '1M': 2592000 };

function barsForDays(tf, days) {
  const sec = BAR_SEC[tf] || BAR_SEC[tf && tf.toLowerCase()] || 86400;
  return Math.ceil(days * 86400 / sec) + 600;      // +600 根余量(信号需要前置K线)
}

module.exports = { simulate, summarize, cutByDays, coveredDays, dayLen, windowStart, barsForDays, BAR_SEC };
