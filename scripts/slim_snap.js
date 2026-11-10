#!/usr/bin/env node
/* slim_snap.js — 为 AI 提示词抽取精简快照（避免整份 245KB 快照超命令行长度上限 ARG_MAX）。
 * 保留：period / events(分组) / realized / positions / trades(每轮明细, 去掉 addPx 列表) / backtest / cfg。
 * 丢弃：signals(394条原始事件, 由 ai_apply 透传到前端报表) / curveTail / costCurve / chartSource / tops。
 * 用法: node slim_snap.js <snapshot.json> <out.json> */
'use strict';
const fs = require('fs');
const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const trades = (src.trades || []).map(function (t) {
  return {
    pid: t.pid, inst: t.inst, dir: t.dir, entryPx: t.entryPx, adds: t.adds,
    exitPx: t.exitPx, netUsd: t.netUsd, outcome: t.outcome, holdMin: t.holdMin
  };
});
const out = {
  period: src.period,
  events: src.events,
  realized: src.realized,
  positions: src.positions,
  trades: trades,
  backtest: src.backtest,
  openPositions: src.openPositions || [],
  cfg: src.cfg
};
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log('[slim] 精简快照已生成: trades=' + trades.length + ' bytes=' + fs.statSync(process.argv[3]).size);
