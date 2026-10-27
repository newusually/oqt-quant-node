/* ============================================================================
 * modules/okx/engines/streak.js —— ★连续涨跌家数统计 + BTC 多空关系核实（2026-10-26）
 * ----------------------------------------------------------------------------
 * 用户需求："统计表格做一下 连续上涨家数大于100以上 和连续下跌家数大于100 以后的
 *            分时详细表格，并且核实连续下跌和连续上涨家数和BTC合约买多卖空之间的关系
 *            分析和表格写入"
 *
 * 做法：
 *   1) 取全市场涨跌家数序列（预计算库/实时扫描均可）
 *   2) 找出【连续 N 根 上涨家数 > thr】与【连续 N 根 下跌家数 > thr】的区段
 *   3) 每个区段结束后，用 BTC 真实K线算后续 1/3/5/10 根的收益
 *      → 做多收益 = (C(t+h)-C(t))/C(t)；做空收益 = -做多收益
 *   4) 汇总：两种信号下做多/做空的胜率与平均收益 → 判断"和市场共振还是反向"
 * ========================================================================== */
'use strict';
const UD = require('./updown');
const KL = require('./kline');

const LEAD_INST = 'BTC-USDT-SWAP';
const HOLDS = [1, 3, 5, 10];

async function streak(opt) {
  opt = opt || {};
  const grain = opt.grain || '15m';
  const thr = parseInt(opt.thr, 10) || 100;
  const minLen = Math.max(1, parseInt(opt.minLen, 10) || 2);
  const maxRows = parseInt(opt.maxRows, 10) || 400;

  const d = await UD.updown({ grain: grain, bars: parseInt(opt.bars, 10) || 18000, lead: 'BTC', sector: '' });
  if (!d || !d.ok || !d.bars) return { ok: false, err: (d && d.err) || '涨跌家数未就绪', rows: [] };
  const list = d.bars;
  if (list.length < 5) return { ok: false, err: '数据太少', rows: [] };

  /* BTC 收盘价序列（真实K线，用于算后续收益） */
  let candles = [];
  try { candles = KL.loadLocal(LEAD_INST, grain, 0) || []; } catch (e) { candles = []; }
  const pxOf = new Map();
  const tsArr = [];
  candles.forEach(function (k) { pxOf.set(k.t, k.c); tsArr.push(k.t); });
  tsArr.sort(function (a, b) { return a - b; });
  function pxAfter(ts, h) {
    /* 返回 ts 之后第 h 根的收盘价（按K线顺序，不是按时间加减） */
    let i = 0;
    /* 二分找 ts 位置 */
    let lo = 0, hi = tsArr.length - 1, pos = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tsArr[mid] === ts) { pos = mid; break; }
      if (tsArr[mid] < ts) lo = mid + 1; else hi = mid - 1;
    }
    if (pos < 0) { /* ts 不在K线里（可能被尾部剔除） → 找最近的 */
      for (i = 0; i < tsArr.length; i++) if (tsArr[i] >= ts) { pos = i; break; }
      if (pos < 0) return null;
    }
    const j = pos + h;
    if (j >= tsArr.length) return null;
    return { c0: pxOf.get(tsArr[pos]), c1: pxOf.get(tsArr[j]) };
  }

  /* ---------- 找连续段 ---------- */
  const segs = [];
  let cur = null;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const type = (b.up > thr) ? 'up' : ((b.down > thr) ? 'down' : null);
    if (!type) { if (cur) { segs.push(cur); cur = null; } continue; }
    if (cur && cur.type === type) { cur.n++; cur.end = i; }
    else { if (cur) segs.push(cur); cur = { type: type, start: i, end: i, n: 1 }; }
  }
  if (cur) segs.push(cur);

  /* ---------- 每段：后续收益 ---------- */
  const rows = [];
  segs.forEach(function (s) {
    if (s.n < minLen) return;
    const last = list[s.end];
    if (!last) return;
    const after = {};
    let ok = false;
    HOLDS.forEach(function (h) {
      const r = pxAfter(last.ts, h);
      if (r && isFinite(r.c0) && isFinite(r.c1) && r.c0 > 0) {
        const ret = (r.c1 - r.c0) / r.c0 * 100;
        after['h' + h] = +ret.toFixed(3);
        ok = true;
      } else after['h' + h] = null;
    });
    if (!ok) return;
    let upSum = 0, downSum = 0;
    for (let i = s.start; i <= s.end; i++) { upSum += (list[i].up || 0); downSum += (list[i].down || 0); }
    rows.push({
      type: s.type, len: s.n, startTs: list[s.start].ts, endTs: last.ts,
      upAvg: Math.round(upSum / s.n), downAvg: Math.round(downSum / s.n),
      total: last.total, leadPct: last.leadPct,
      after: after,
      /* 做多/做空收益（以持 3 根为主口径） */
      longRet: after.h3, shortRet: (after.h3 === null || after.h3 === undefined) ? null : -after.h3
    });
  });

  rows.sort(function (a, b) { return b.endTs - a.endTs; });
  const shown = rows.slice(0, maxRows);

  /* ---------- 汇总：做多/做空胜率与平均收益 ---------- */
  function stat(type) {
    const rs = rows.filter(function (r) { return r.type === type; });
    const out = { n: rs.length, winLong: 0, winShort: 0, avgLong: null, avgShort: null, best: null };
    if (!rs.length) return out;
    let sl = 0, ss = 0, nl = 0, ns = 0;
    const byHold = {};
    HOLDS.forEach(function (h) {
      const v = rs.map(function (r) { return r.after['h' + h]; }).filter(function (x) { return x !== null && x !== undefined; });
      if (v.length) byHold['h' + h] = {
        n: v.length,
        avgLong: +(v.reduce(function (a, b) { return a + b; }, 0) / v.length).toFixed(3),
        winLong: +(v.filter(function (x) { return x > 0; }).length / v.length * 100).toFixed(1),
        winShort: +(v.filter(function (x) { return x < 0; }).length / v.length * 100).toFixed(1)
      };
    });
    out.byHold = byHold;
    rs.forEach(function (r) {
      if (r.longRet !== null && r.longRet !== undefined) { sl += r.longRet; nl++; if (r.longRet > 0) out.winLong++; }
      if (r.longRet !== null && r.longRet !== undefined) { ss += -r.longRet; ns++; if (r.longRet < 0) out.winShort++; }
    });
    out.winLong = nl ? +(out.winLong / nl * 100).toFixed(1) : null;
    out.winShort = ns ? +(out.winShort / ns * 100).toFixed(1) : null;
    out.avgLong = nl ? +(sl / nl).toFixed(3) : null;
    out.avgShort = ns ? +(ss / ns).toFixed(3) : null;
    return out;
  }
  const su = stat('up'), sd = stat('down');
  /* 结论：连续上涨后做多是否优于做空（反之同理） */
  function concl(s, name) {
    if (!s.n) return name + '：样本不足';
    const a = s.avgLong || 0, b = s.avgShort || 0;
    const better = a >= b ? '做多' : '做空';
    return name + '（' + s.n + ' 段）：随后 3 根 做多均值 ' + (s.avgLong) + '% / 做空均值 ' + (s.avgShort) +
      '%，胜率 多 ' + s.winLong + '% / 空 ' + s.winShort + '% → 统计上更适合【' + better + '】';
  }
  return {
    ok: true, grain: grain, thr: thr, minLen: minLen, at: Date.now(),
    totalSlices: list.length, segs: segs.length, rows: shown, rowsAll: rows.length,
    summary: { up: su, down: sd },
    holds: HOLDS,
    concl: [concl(su, '连续上涨家数>' + thr), concl(sd, '连续下跌家数>' + thr)]
  };
}

module.exports = { streak: streak };