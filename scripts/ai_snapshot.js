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
  tfs: ['15m'], entryUsd: 0.1, addUsd: 0.1, tpPct: 10,
  addLossPct: 1, addIntervalMs: 3600000, feeBp: 10,
  macd: [12, 26, 60], macdMinPrev: 20,
  addRule: '满1小时 + 浮亏>1% + 当前15m MACD柱方向与持仓同向（不要求零轴翻转）',
  keepFrom: '2026-11-01 00:00:00 (北京时间)', keepForever: true
};

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
