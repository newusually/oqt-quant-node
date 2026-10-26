// M4 modules/okx/engines · OKX 专属引擎（真实行情: 本地 kline 存储 + 指标 + 缠论 + 合约列表）
'use strict';
const cfg = require('../config/app_cfg.json');
const okxapi = require('./okxapi');
const klineEngine = require('./kline');
const chanEngine = require('./chan');
const btCore = require('../../../engines/btcurve-core');


// OKX K线(真实 OHLC + 指标 + 缠论); instId 缺省用配置默认合约
// beforeTs: 悬浮迷你窗按信号时间定位（只取该时点之前的K线）
async function kline(instId, tf, limit, beforeTs) {
  const inst = instId || cfg.inst;
  const tfm = (tf && klineEngine.OKX_BAR[tf]) ? tf : cfg.defaultTf;
  return await klineEngine.kline(inst, tfm, parseInt(limit || 1500, 10), parseInt(beforeTs || 0, 10) || 0);
}

// 合约列表(OKX 公共 instruments, 缓存)
async function instruments(force) { return await klineEngine.instruments(force); }

// 实时获取/补充数据: 拉取并落库
async function pull(instId, tf, pages) {
  const inst = instId || cfg.inst;
  const tfm = (tf && klineEngine.OKX_BAR[tf]) ? tf : cfg.defaultTf;
  return await klineEngine.pull(inst, tfm, parseInt(pages || 3, 10));
}

// 账户净值(真实 OKX API: /account/balance)
async function account() {
  const r = await okxapi.balance();
  if (!r.ok) return { ok: false, err: r.err };
  const d = (r.data && r.data[0]) || {};
  const totalEq = +d.totalEq || 0;
  const avail = +d.availBal || 0;
  // ★全币种折美元估值(账户里只有 BABYDOGE 等垃圾币时, totalEq(USDT口径)显示 0.00 像没显示)
  const details = d.details || [];
  let eqUsdTotal = 0;
  const holdings = [];
  for (const x of details) {
    const eq = +x.eq || 0, eqUsd = +x.eqUsd || 0, av = +x.availBal || 0;
    if (eq > 0 || eqUsd > 0) holdings.push({ ccy: x.ccy, eq, eqUsd, avail: av });
    eqUsdTotal += eqUsd;
  }
  holdings.sort((a, b) => b.eqUsd - a.eqUsd);
  return {
    ok: true, totalEq, avail, ccy: d.ccy || 'USDT', details,
    eqUsdTotal: Math.round(eqUsdTotal * 1e8) / 1e8, holdings: holdings.slice(0, 8),
    src: 'okx-api'
  };
}

// 累计盈亏(USDT): 由全量成交流水的已实现盈亏累加(真实 OKX API: fills-history 翻页取全量)
async function pnl() {
  const r = await okxapi.fillsAll(30);
  if (!r.ok) return { ok: false, err: r.err };
  const fills = (r.data || [])
    .map(f => ({ ts: +f.ts, pnl: (f.fillPnl !== null && f.fillPnl !== undefined) ? +f.fillPnl : 0 }))
    .filter(x => x.ts)
    .sort((a, b) => a.ts - b.ts);
  let cum = 0;
  const series = fills.map(f => { cum += f.pnl; return { ts: f.ts, cum }; });
  return { ok: true, total: cum, count: fills.length, series, src: 'okx-api' };
}

// 成交流水(真实 OKX API: fills-history 翻页取全量, 最多 500 条)
async function trades(limit) {
  const cap = Math.min(parseInt(limit || 200, 10) || 200, 500);
  const r = await okxapi.fillsAll(10);
  if (!r.ok) return { ok: false, err: r.err };
  let rows = (r.data || [])
    .map(f => ({
      time: +f.ts, inst: f.instId, side: f.side, posSide: f.posSide, fillPx: +f.fillPx, sz: +f.fillSz,
      fee: +f.fee, feeCcy: f.feeCcy, pnl: (f.fillPnl !== null && f.fillPnl !== undefined) ? +f.fillPnl : null, ccy: f.ccy,
      ordId: f.ordId, billId: f.billId
    }))
    .filter(r2 => r2.time)
    .sort((a, b) => b.time - a.time);
  if (rows.length > cap) rows = rows.slice(0, cap);
  const profit = rows.reduce((a, r2) => a + (r2.pnl || 0), 0);
  return { ok: true, rows, profit, count: rows.length, maxLimit: cap, src: 'okx-api' };
}

// 历史回补(分页往前翻): 覆盖最近 years 年(默认2年) 的全部K线
// 历史回补（分页往前翻）
//   opt: {days: 回填最近N天, limit: 回填到本地共N根, rounds: 翻页轮数上限}
//   旧签名 (inst, tf, years, rounds) 仍兼容
async function backfill(instId, tf, opt, rounds) {
  const inst = instId || cfg.inst;
  const tfm = (tf && klineEngine.OKX_BAR[tf]) ? tf : cfg.defaultTf;
  let o = (opt && typeof opt === 'object') ? Object.assign({}, opt) : null;
  if (!o) o = { days: Math.max(0.2, parseFloat(opt || 2)) * 365, rounds: rounds || 40 };
  if (rounds && !o.rounds) o.rounds = rounds;
  const r = await klineEngine.backfill(inst, tfm, o);
  return r;
}

// 交易信号: 优先用 K线缠论买卖点(一买/一卖, 真实摆动极值, 无未来函数);
// 若原 trade_signal dump 有数据, 一并列出(历史信号)。
async function signals(instId, tf, limit) {
  const inst = instId || cfg.inst;
  const tfm = (tf && klineEngine.OKX_BAR[tf]) ? tf : cfg.defaultTf;
  // ★2026-10-24 只保留新的 DIF/DEA 延长虚线交叉信号(旧的缠论一买/一卖已删除)
  const rows = klineEngine.loadLocal(inst, tfm, 3000);
  if (!rows.length) return { ok: true, rows: [], count: 0, src: 'calc' };
  const r = chanEngine.macdSignals(rows, { maxAngle: 40, tf: tfm });
  const all = (r.sigs || []).map(s => ({
    ts: s.t, inst, kind: s.side > 0 ? 'buy' : 'sell', side: s.side, price: s.px,
    score: s.ang, note: 'DIF/DEA 延长线交叉 ' + s.ang.toFixed(0) + '°', ang: s.ang
  })).sort((a, b) => b.ts - a.ts);
  return { ok: true, rows: all.slice(0, limit || 200), count: all.length, src: 'calc' };
}

// ---------------------------------------------------------------------------
// ★信号盈利曲线（1:1 移植 latest astock/web/btcurve.php）
//   口径: 只统计【买入】信号 → 每笔按固定金额模拟
//        信号后第一根【开盘价】入场 → 逐根判止盈/止损(同一根同时触及按保守止损)
//        → 未触发则按最后一根收盘平仓
//        曲线: X=出场时间, Y=累计盈亏
//   统计: 笔数/胜率/净盈亏/总盈/总亏/盈亏比/最大回撤
//   ★days: 回测窗口(天), 默认 30 = 一个月; 0 = 本地全部数据
// ---------------------------------------------------------------------------
async function btcurve(instId, tf, opt) {
  opt = opt || {};
  const inst = instId || cfg.inst;
  const tfm = (tf && klineEngine.OKX_BAR[tf]) ? tf : cfg.defaultTf;
  // ★回测窗口: 默认一个月(30天), 页面工具条可改
  const days = Math.max(0, Math.min(730, parseInt((opt.days === null || opt.days === undefined) ? 30 : opt.days, 10) || 0));
  // 止盈/止损默认值: 按周期给合理档位(5m 用 1%, 日线用 10%), 页面工具条可改
  const dflt = { '1m': 0.01, '3m': 0.01, '5m': 0.01, '15m': 0.015, '30m': 0.02, '1h': 0.03, '2h': 0.04, '4h': 0.05, '6h': 0.06, '12h': 0.08, '1d': 0.10, '1w': 0.15 };
  const dp = (dflt[tfm] !== null && dflt[tfm] !== undefined) ? dflt[tfm] : 0.10;
  const tp = (opt.tp === null || opt.tp === undefined) ? dp : +opt.tp;        // 止盈比例
  const sl = (opt.sl === null || opt.sl === undefined) ? dp : +opt.sl;        // 止损比例
  const amt = (opt.amt === null || opt.amt === undefined) ? 100 : +opt.amt;    // 每笔固定投入(USDT)
  // ★持仓上限: 超过 maxHold 根仍未触发止盈/止损 → 按该根收盘平仓("到期")
  //   否则所有"仍持仓"的交易都会挤在最后一根K线上, 曲线退化成一条竖线(看不到时间跨度)
  //   默认按周期给: 分钟级 300 根 / 小时级 200 / 日线 60 / 周线 26 / 月线 12
  const mhDefault = { '1m': 300, '3m': 300, '5m': 300, '15m': 300, '30m': 300, '1h': 200, '2h': 200, '4h': 150, '6h': 150, '12h': 120, '1d': 60, '1w': 26, '1M': 12 };
  const maxHold = ((opt.maxHold !== null && opt.maxHold !== undefined) && +opt.maxHold > 0) ? Math.round(+opt.maxHold) : (mhDefault[tfm] || 200);
  // ★bar 数按回测窗口算: 30天 5m 需 8640 根 / 1m 需 43200 根(封顶 5万, 避免内存爆炸)
  const needBars = days > 0 ? btCore.barsForDays(tfm, days) : 3000;
  const limitBars = Math.min(50000, Math.max(200, needBars, parseInt(opt.bars || 0, 10) || 0));
  let rows = klineEngine.loadLocal(inst, tfm, limitBars);
  // ★本地历史覆盖不够一个窗口 → 自动回补(有限轮数, 不让页面干等)
  if (days > 0 && btCore.coveredDays(rows) < days * 0.7) {
    try { await klineEngine.backfill(inst, tfm, { days: days + 2, rounds: 24 }); } catch (e) { /* 忽略 */ }
    rows = klineEngine.loadLocal(inst, tfm, limitBars);
  }
  if (!rows.length) return { ok: false, err: '该合约/周期暂无本地K线数据, 点「补充数据」拉取' };
  // ★窗口口径: 信号用全量K线算(MACD 有前置上下文), 只统计窗口内【出场】的交易
  const cutoff = btCore.windowStart(rows, days);
  const winBars = cutoff ? rows.filter(b => b.t >= cutoff) : rows;
  if (!winBars.length) return { ok: false, err: '该合约/周期暂无本地K线数据, 点「补充数据」拉取' };
  // 买入信号(与前端 1:1 同口径: DIF/DEA 延长虚线交叉, 夹角<40°)
  const cs = chanEngine.macdSignals(rows, { maxAngle: 40, tf: tfm });
  const buys = cs.sigs.filter(s => s.side > 0).map(s => ({ i: s.base, t: s.t, p: s.px, dir: s.side, ang: s.ang }));
  const pts = [];
  for (const s of buys) {
    if ((s.i === null || s.i === undefined) || s.i >= rows.length - 1) continue;   // 无后续K线 → 不结算
    const r = btCore.simulate(rows, s.i, s.p, tp, sl, amt, maxHold);
    if (!r) continue;
    if (cutoff && r.t < cutoff) continue;                  // 窗口外出场 → 不计入本月回测
    r.et = s.t; r.inst = inst; r.name = inst; r.sigAng = s.ang;
    pts.push(r);
  }
  // 按出场时间排序 + 累计 + 统计（与 btcurve.php 一致）
  const win = {
    days, tf: tfm, inst,
    bars: winBars.length,
    from: cutoff || rows[0].t, to: rows[rows.length - 1].t,
    covered: btCore.coveredDays(winBars),
    tp, sl, amt, maxHold
  };
  const stats = btCore.summarize(pts, win);
  return { ok: true, stats, pts, sigN: cs.sigs.length, buyN: buys.length, bars: winBars.length, src: 'calc' };
}

async function status() {
  const ins = await instruments();
  const k = await kline(cfg.inst, cfg.defaultTf, 1);
  const tr = await trades();
  const sg = await signals(cfg.inst, cfg.defaultTf);
  return {
    ok: true, inst: cfg.inst, defaultTf: cfg.defaultTf,
    instruments: ins.ok ? ins.list.length : 0,
    bars: k.ok ? k.count : 0,
    trades: tr.ok ? tr.count : 0,
    signals: sg.ok ? sg.count : 0
  };
}

module.exports = { kline, instruments, pull, backfill, account, pnl, trades, signals, btcurve, status, cfg };
