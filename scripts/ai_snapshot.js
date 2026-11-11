#!/usr/bin/env node
/* ai_snapshot.js — 每日 AI 分析快照（只读，不写库）
 * 所有时间字段一律输出北京时间字符串，不向模型暴露 13 位毫秒时间戳。 */
'use strict';
const { DatabaseSync } = require('node:sqlite');
const DB = process.argv[2] || '/home/ubuntu/oqt-quant-node/data/flowtrack/flowtrack.sqlite';
const d = new DatabaseSync(DB, { readOnly: true });

const bjFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});
function bj(ts) {
  if (!ts) return null;
  return bjFmt.format(new Date(ts)).replace(/\//g, '-').replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1 ') + ' (北京时间)';
}
function rows(sql) { try { return d.prepare(sql).all(); } catch (e) { return []; } }
function one(sql) { try { return d.prepare(sql).get() || {}; } catch (e) { return {}; } }

const range = one('SELECT MIN(ts) a, MAX(ts) b, COUNT(*) n FROM pyr');
const events = rows('SELECT event, COUNT(*) n FROM pyr GROUP BY event');
const byTf = rows('SELECT tf, COUNT(*) n FROM pyr GROUP BY tf');
const closes = rows("SELECT ts, inst_id, dir, net_bp, cost, qty, px FROM pyr WHERE event='close' ORDER BY ts, id");

let cum = 0, peak = 0, maxDd = 0, win = 0, loss = 0, grossProfit = 0, grossLoss = 0;
const curve = [];
for (const c of closes) {
  const p = +c.net_bp || 0;
  cum += p; peak = Math.max(peak, cum); maxDd = Math.max(maxDd, peak - cum);
  if (p > 0) { win++; grossProfit += p; } else if (p < 0) { loss++; grossLoss += -p; }
  curve.push({ t: bj(+c.ts), cum: +cum.toFixed(6), p: +p.toFixed(6) });
}

const open = one('SELECT COUNT(*) n, SUM(total_cost) cost FROM pyr_open WHERE closed=0');
const adds = rows("SELECT inst_id, COUNT(*) n FROM pyr WHERE event='add' GROUP BY inst_id ORDER BY n DESC LIMIT 10");
const topInst = rows('SELECT inst_id, COUNT(*) n FROM pyr GROUP BY inst_id ORDER BY n DESC LIMIT 10');
const openEvents = rows("SELECT ts, cost FROM pyr WHERE event IN ('buy','sell','add') ORDER BY ts, id");
let cumCost = 0;
const costCurve = openEvents.map(function (r) {
  cumCost += +r.cost || 0;
  return { t: bj(+r.ts), cum: +cumCost.toFixed(6) };
}).slice(-200);
const cfg = {
  tfs: ['15m'], entryUsd: 0.1, addUsd: 0.1, tpPct: 5,
  addLossPct: 0, addIntervalMs: 3600000, feeBp: 10,
  macd: [12, 26, 60], macdMinPrev: 20,
  entryRule: 'MACD 零轴翻转（前≥20根反向柱后翻出方向）开仓',
  addRule: '满1小时 + 浮亏>0(亏损即触发) + 出现买卖信号(零轴翻转)且与持仓同向（有信号才加仓）',
  keepFrom: '2026-11-01 00:00:00 (北京时间)', keepForever: true
};

/* ===== 全量 Forensic 数据：逐轮交易明细 / 全部买卖信号 / 回测汇总（供 AI 强制归因 + 前端完整报表） ===== */
const allRows = rows("SELECT id, pid, inst_id, tf, dir, event, ts, px, qty, cost, unreal, net_bp, note FROM pyr ORDER BY pid, ts, id");
const byPid = {};
for (const r of allRows) { (byPid[r.pid] = byPid[r.pid] || []).push(r); }
const trades = [];
for (const pid of Object.keys(byPid)) {
  const rs = byPid[pid];
  const entry = rs.find(function (x) { return x.event === 'buy' || x.event === 'sell'; });
  if (!entry) continue;
  const close = rs.find(function (x) { return x.event === 'close'; });
  const addList = rs.filter(function (x) { return x.event === 'add'; });
  const dir = +entry.dir > 0 ? '多' : '空';
  const entryPx = +entry.px, entryCost = +entry.cost;
  const exitPx = close ? +close.px : null;
  const net = close ? (+(close.net_bp || 0)) : null;
  const gross = close ? (+(close.unreal || 0)) : null;
  const totalCost = rs.filter(function (x) { return x.event !== 'close'; }).reduce(function (s, x) { return s + (+x.cost || 0); }, 0);
  const holdMin = (close && entry) ? Math.round((+close.ts - +entry.ts) / 60000) : null;
  const outcome = !close ? '持仓中' : (net > 0 ? '盈利' : '亏损');
  /* 持仓中：取该 pid 最后一行事件记录的 unreal 作为实时浮盈/浮亏（USD） */
  const lastRow = rs[rs.length - 1];
  const floatUsd = !close ? +(+(lastRow.unreal || 0).toFixed(6)) : null;
  const floatPct = (!close && totalCost > 0) ? +((floatUsd / totalCost) * 100).toFixed(4) : null;
  trades.push({
    pid: String(pid), inst: String(entry.inst_id), dir: dir, tf: entry.tf,
    entryAt: bj(+entry.ts), entryPx: +entryPx.toFixed(6), entryCost: +entryCost.toFixed(6),
    adds: addList.length, addPx: addList.map(function (x) { return +(+x.px).toFixed(6); }),
    exitAt: close ? bj(+close.ts) : null, exitPx: exitPx == null ? null : +exitPx.toFixed(6),
    totalCost: +totalCost.toFixed(6),
    netUsd: net == null ? null : +net.toFixed(6),
    grossUsd: gross == null ? null : +gross.toFixed(6),
    floatUsd: floatUsd, floatPct: floatPct,
    holdMin: holdMin, outcome: outcome
  });
}
const signals = allRows.map(function (r) {
  return {
    t: bj(+r.ts), pid: String(r.pid), inst: String(r.inst_id),
    ev: r.event, dir: (+r.dir > 0 ? '多' : '空'),
    px: +(+r.px).toFixed(6), qty: +(+r.qty).toFixed(8),
    cost: +(+r.cost).toFixed(6),
    net: r.event === 'close' ? +(+r.net_bp).toFixed(6) : null,
    note: r.note || ''
  };
});
const closed = trades.filter(function (t) { return t.outcome !== '持仓中'; });
const winT = closed.filter(function (t) { return t.outcome === '盈利'; });
const lossT = closed.filter(function (t) { return t.outcome === '亏损'; });
const byInst = {};
for (const t of closed) {
  const k = t.inst; byInst[k] = byInst[k] || { n: 0, net: 0, w: 0 };
  byInst[k].n++; byInst[k].net += (t.netUsd || 0); if (t.outcome === '盈利') byInst[k].w++;
}
const byDir = { '多': { n: 0, net: 0 }, '空': { n: 0, net: 0 } };
for (const t of closed) { byDir[t.dir].n++; byDir[t.dir].net += (t.netUsd || 0); }
const backtest = {
  totalRounds: trades.length,
  closed: closed.length,
  open: trades.filter(function (t) { return t.outcome === '持仓中'; }).length,
  wins: winT.length, losses: lossT.length,
  winRate: closed.length ? +(winT.length / closed.length * 100).toFixed(2) : 0,
  netUsd: +closed.reduce(function (s, t) { return s + (t.netUsd || 0); }, 0).toFixed(6),
  grossProfit: +winT.reduce(function (s, t) { return s + (t.netUsd || 0); }, 0).toFixed(6),
  grossLoss: +lossT.reduce(function (s, t) { return s + (t.netUsd || 0); }, 0).toFixed(6),
  byDirection: {
    '多': { n: byDir['多'].n, net: +byDir['多'].net.toFixed(6) },
    '空': { n: byDir['空'].n, net: +byDir['空'].net.toFixed(6) }
  },
  byInstrument: Object.keys(byInst).map(function (k) {
    return { inst: k, n: byInst[k].n, net: +byInst[k].net.toFixed(6), winRate: +(byInst[k].w / byInst[k].n * 100).toFixed(2) };
  }).sort(function (a, b) { return b.net - a.net; }),
  withAdds: closed.filter(function (t) { return t.adds > 0; }).length,
  noAdds: closed.filter(function (t) { return t.adds === 0; }).length,
  totalSignals: allRows.length
};

/* 每小时浮亏归因数据源：当前持仓按实时浮亏排序（最差在前），供 AI floatingLossAnalysis 使用 */
const openPositions = trades
  .filter(function (t) { return t.outcome === '持仓中'; })
  .slice()
  .sort(function (a, b) { return (a.floatUsd || 0) - (b.floatUsd || 0); })
  .slice(0, 50);

const evMap = {};
for (const e of events) evMap[e.event] = e.n;

console.log(JSON.stringify({
  generatedAtBj: bj(Date.now()),
  period: {
    from: bj(range.a), to: bj(range.b), events: range.n || 0,
    spanText: range.a && range.b ? (Math.round((range.b - range.a) / 60000) + ' 分钟') : '无数据'
  },
  events, byTf,
  realized: {
    closes: closes.length, netUsd: +cum.toFixed(6),
    win, loss, winRate: closes.length ? +(win / closes.length * 100).toFixed(2) : 0,
    grossProfitUsd: +grossProfit.toFixed(6), grossLossUsd: +grossLoss.toFixed(6),
    maxDrawdownUsd: +maxDd.toFixed(6),
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(4) : null
  },
  positions: { open: open.n || 0, costUsd: +(open.cost || 0).toFixed(6) },
  trades, signals, backtest, openPositions,
  topAddInstruments: adds, topInstruments: topInst,
  curveTail: curve.slice(-200),
  chartSource: {
    pie: [
      { name: '买多', value: evMap.buy || 0 },
      { name: '卖空', value: evMap.sell || 0 },
      { name: '加仓', value: evMap.add || 0 },
      { name: '平仓', value: evMap.close || 0 }
    ],
    bars: topInst.slice(0, 8).map(x => ({ name: String(x.inst_id).replace('-USDT-SWAP', ''), value: x.n })),
    tfBars: byTf.map(x => ({ name: x.tf, value: x.n })),
    metricsBars: [
      { name: '已实现净', value: +cum.toFixed(6) },
      { name: '毛利', value: +grossProfit.toFixed(6) },
      { name: '毛损', value: +grossLoss.toFixed(6) },
      { name: '最大回撤', value: +maxDd.toFixed(6) },
      { name: '未平仓投入', value: +(open.cost || 0).toFixed(6) }
    ],
    costCurve
  },
  cfg
}, null, 2));
