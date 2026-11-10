// M4 modules/okx/engines · OKX 专属引擎（真实行情: 本地 kline 存储 + 指标 + 合约列表）
//   ★2026-10-31b 缠论引擎(./chan)与旧买卖信号(signals/btcurve)已按用户要求整体删除
//   ★2026-11-03 全部买卖信号引擎/组件/数据(含 sig.sqlite)已整体删除 → 本引擎不再产出任何买卖信号
'use strict';
const cfg = require('../config/app_cfg.json');
const okxapi = require('./okxapi');
const klineEngine = require('./kline');


// OKX K线(真实 OHLC + 指标); instId 缺省用配置默认合约
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

async function status() {
  const ins = await instruments();
  const k = await kline(cfg.inst, cfg.defaultTf, 1);
  const tr = await trades();
  return {
    ok: true, inst: cfg.inst, defaultTf: cfg.defaultTf,
    instruments: ins.ok ? ins.list.length : 0,
    bars: k.ok ? k.count : 0,
    trades: tr.ok ? tr.count : 0
  };
}

module.exports = { kline, instruments, pull, backfill, account, pnl, trades, status, cfg };
