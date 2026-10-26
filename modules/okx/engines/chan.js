// M4 modules/okx/engines/chan.js · 缠论信号(与前端 1:1 同口径)
//   ★前端 web/js/chan-core.js 与本模块共用同一套算法(前端 require 同一个文件)，
//     所以「图上画的买卖点」与「盈利曲线回测用的买卖点」永远是同一批。
'use strict';
const path = require('path');
const ChanCore = require(path.resolve(__dirname, '../../../web/js/chan-core.js'));

// 摆动顶/底(与前端 chanNew 口径完全一致: PW=3 / PMM=0.0012 / PCAP=120)
function swingTops(bars) {
  const n = bars.length;
  const tops = [], bots = [];
  if (n < 8) return { tops, bots };
  const PW = 3, PMM = 0.0012, PCAP = 120;
  const pv = [];
  for (let i = PW; i < n - PW; i++) {
    const h = bars[i].h, l = bars[i].l;
    let isT = true, isB = true;
    for (let k = 1; k <= PW; k++) {
      if (bars[i - k].h >= h || bars[i + k].h >= h) isT = false;
      if (bars[i - k].l <= l || bars[i + k].l <= l) isB = false;
      if (!isT && !isB) break;
    }
    if (isT || isB) pv.push({ i, p: isT ? h : l, top: isT });
  }
  const f = [];
  for (const c of pv) {
    if (!f.length) { f.push(c); continue; }
    const last = f[f.length - 1];
    if (c.top === last.top) {
      if ((c.top && c.p >= last.p) || (!c.top && c.p <= last.p)) f[f.length - 1] = c;
      continue;
    }
    if (Math.abs(c.p - last.p) < last.p * PMM) continue;
    f.push(c);
  }
  const pf = f.length > PCAP ? f.slice(f.length - PCAP) : f;
  for (const q of pf) (q.top ? tops : bots).push(q);
  return { tops, bots };
}

// 周期自适应"极值确认窗口" revBars（1:1 移植 cpp/signal/signal_chan.cpp）
//   按K线中位间隔(分钟)分档: 1m:400 5m:200 15m:150 1h:100 1d:45 1w/1mo:30
function revBarsFor(bars) {
  const n = bars.length;
  if (n < 20) return 100;
  const dts = [];
  for (let i = 1; i < n; i++) { const d = bars[i].t - bars[i - 1].t; if (d > 0) dts.push(d); }
  if (!dts.length) return 100;
  dts.sort((a, b) => a - b);
  const medDt = dts[dts.length >> 1];
  const mins = medDt / 60000;
  if (mins <= 1.6) return 400;
  if (mins <= 6.5) return 200;
  if (mins <= 20) return 150;
  if (mins <= 70) return 100;
  if (mins <= 300) return 45;
  return 30;
}

// 大笔跨度下限 dmin（1:1 移植 C++: bfDur>0 用绝对值, 否则 revBars × cs_bf_dur_ratio(0.3)）
//   ★用自适应口径: 周线/月线用固定 40 根会把信号几乎全过滤掉(用户反馈"一周/一个月没信号")
function bfDurFor(bars, explicit) {
  if ((explicit !== null && explicit !== undefined) && explicit !== '' && +explicit > 0) return Math.round(+explicit);
  return Math.max(4, Math.round(revBarsFor(bars) * 0.3));
}

// 缠论买卖信号: 60° 夹角 + 落在两条缠论线交叉处
// opt: {maxAngle, bfDur, minGap, tol}
// 返回 [{i(全局下标), t, p(价), dir(+1买/-1卖), ang(度)}]
function calcSignals(bars, opt) {
  opt = opt || {};
  if (!bars || bars.length < 40) return { sigs: [], bis: [], lines: null, tops: [], bots: [] };
  const sw = swingTops(bars);
  const closes = bars.map(b => b.c);
  const L = ChanCore.clLines(closes, 12, 26, 9);
  const bis = ChanCore.toBis(sw.tops, sw.bots);
  const cross = ChanCore.crossings(L.f, L.s);
  const crossIdx = cross.map(c => c.i);
  const raw = ChanCore.signalsAtCrossings(bis, crossIdx, {
    maxAngle: (opt.maxAngle === null || opt.maxAngle === undefined) ? 60 : opt.maxAngle,
    bfDur: bfDurFor(bars, opt.bfDur),
    minGap: (opt.minGap === null || opt.minGap === undefined) ? 5 : opt.minGap,
    tol: (opt.tol === null || opt.tol === undefined) ? 14 : opt.tol
  });
  const sigs = raw.map(s => ({
    i: s.i, t: bars[s.i] ? bars[s.i].t : 0, p: s.p,
    dir: s.dir, ang: s.ang, cv: s.cv || 1
  })).filter(s => s.t);
  return { sigs, bis, lines: L, tops: sw.tops, bots: sw.bots, revBars: revBarsFor(bars), bfDur: bfDurFor(bars, opt.bfDur) };
}

// ★DIF/DEA 延长虚线交叉信号（2026-10-24 新规）—— Node 端与前端同一套算法
//   取最近两根 DIF/DEA 相同处 → 各画延长虚线 → 交叉: 向上开口=买 / 向下开口=卖, 夹角<40°
// 返回 [{t, px, side, ang, x}]
function macdSignals(bars, opt) {
  opt = opt || {};
  const r = ChanCore.macdCrossSignals(bars || [], {
    maxAngle: (opt.maxAngle === null || opt.maxAngle === undefined) ? 40 : opt.maxAngle,
    minGap: (opt.minGap === null || opt.minGap === undefined) ? minGapFor(opt.tf) : opt.minGap
  });
  const sigs = (r.sigs || []).map(s => ({
    t: s.t, px: s.p, side: s.dir, ang: s.ang, x: s.x, base: s.base
  }));
  return { sigs, base: r.base, lines: r.lines };
}
// 信号最小间隔(根) —— 按周期给, 避免同一波行情刷出成堆信号
function minGapFor(tf) {
  const g = { '1m': 60, '3m': 50, '5m': 20, '15m': 15, '30m': 12, '1h': 10, '2h': 8, '4h': 6, '6h': 5, '12h': 4, '1d': 4, '1w': 2, '1M': 1 };
  return (g[tf] !== null && g[tf] !== undefined) ? g[tf] : 10;
}
module.exports = { calcSignals, macdSignals, minGapFor, swingTops, revBarsFor, bfDurFor, ChanCore };
