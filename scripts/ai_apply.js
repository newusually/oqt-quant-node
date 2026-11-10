#!/usr/bin/env node
/* ai_apply.js — 校验 AI 输出并原子写入 data/ai_strategy.json
 * 用法: node ai_apply.js <cli输出> <目标json> <模型名> [快照json]
 * 护栏: 字段完整性 / 白名单参数 / 数值范围 / 原子替换；图表数据只取自真实快照。 */
'use strict';
const fs = require('fs');
const path = require('path');
const [, , RAW, OUT, MODEL, SNAP] = process.argv;

const RULES = {
  tpPct:         { min: 1,          max: 200 },
  addLossPct:    { min: 0,          max: 200 },
  addIntervalMs: { min: 15 * 60000, max: 7 * 86400000 }
};
const LOCKED = ['ENTRY_USD', 'ADD_USD', 'TFS', 'KEEP_FOREVER', 'KEEP_FROM_TS'];
const LEVELS = ['danger', 'warn', 'ok', 'info'];

const bjFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});
function bj(ts) {
  if (!ts) return null;
  return bjFmt.format(new Date(ts)).replace(/\//g, '-') + ' (北京时间)';
}
function str(x) { return typeof x === 'string' ? x.trim() : ''; }
function fail(msg) { console.error('[ai] 校验失败: ' + msg); process.exit(1); }
function parseLoose(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function reportFrom(s) {
  let t = String(s || '').trim();
  let r = parseLoose(t);
  if (r && typeof r === 'object' && !Array.isArray(r) && (r.verdict || r.report)) return r.report || r;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { r = parseLoose(fence[1].trim()); if (r) return r; t = fence[1].trim(); }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { r = parseLoose(t.slice(a, b + 1)); if (r) return r; }
  return fail('报告 JSON 解析失败');
}
function extract(text) {
  const t = String(text || '').trim();
  let j = parseLoose(t);
  if (!j) {
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!fence) return fail('CLI 输出不是 JSON，也没有代码块');
    j = { result: fence[1].trim() };
  }
  if (Array.isArray(j)) {
    const r = j.slice().reverse().find(x => x && (x.type === 'result' || x.type === 'assistant') && (x.result || x.text));
    if (!r) return fail('stream-json 中未找到 result 帧');
    j = { result: String(r.result || r.text) };
  }
  if (j && typeof j.result === 'string') return reportFrom(j.result);
  if (j && (j.verdict || j.report)) return j.report || j;
  return fail('CLI 输出中未找到报告正文');
}

function normHighlights(rep) {
  const out = [];
  for (const h of (Array.isArray(rep.highlights) ? rep.highlights : [])) {
    const t = str(h && (h.text || h.title));
    if (!t) continue;
    out.push({ level: LEVELS.indexOf(h && h.level) >= 0 ? h.level : 'info', text: t.slice(0, 200) });
    if (out.length >= 6) break;
  }
  if (!out.length && str(rep.verdict)) out.push({ level: 'info', text: str(rep.verdict).slice(0, 200) });
  return out;
}
function normSteps(rep) {
  return (Array.isArray(rep.steps) ? rep.steps : []).slice(0, 10).map(function (s) {
    if (typeof s === 'string') return { title: s.slice(0, 60), detail: '' };
    return { title: str(s && (s.title || s.name)).slice(0, 60), detail: str(s && (s.detail || s.text)).slice(0, 400) };
  }).filter(x => x.title || x.detail);
}
function normStrings(arr, max, len) {
  return (Array.isArray(arr) ? arr : []).slice(0, max)
    .map(x => str(typeof x === 'string' ? x : (x && (x.text || x.title || x.desc))))
    .filter(Boolean).map(s => s.slice(0, len));
}
function normTradeAnalysis(arr, max) {
  return (Array.isArray(arr) ? arr : []).slice(0, max).map(function (x) {
    if (typeof x === 'string') return { pid: '', inst: '', why: x.slice(0, 600) };
    return {
      pid: str(x && x.pid).slice(0, 48),
      inst: str(x && x.inst).slice(0, 32),
      why: str(x && (x.why || x.text || x.reason || x.detail)).slice(0, 600)
    };
  }).filter(function (x) { return x.why; });
}
function normSignalReport(arr, max) {
  return (Array.isArray(arr) ? arr : []).slice(0, max).map(function (x) {
    if (typeof x === 'string') return { ev: '', inst: '', pnl: '', why: x.slice(0, 300) };
    return {
      ev: str(x && x.ev).slice(0, 16),
      inst: str(x && x.inst).slice(0, 32),
      pnl: str(x && x.pnl).slice(0, 32),
      why: str(x && (x.why || x.text || x.reason)).slice(0, 300)
    };
  }).filter(function (x) { return x.why || x.ev; });
}
function normCodeChanges(arr, max) {
  return (Array.isArray(arr) ? arr : []).slice(0, max).map(function (x) {
    if (typeof x === 'string') return { title: '', code: '', desc: x.slice(0, 400) };
    return {
      title: str(x && (x.title || x.name)).slice(0, 80),
      code: str(x && x.code).slice(0, 1200),
      desc: str(x && (x.desc || x.text || x.detail)).slice(0, 400)
    };
  }).filter(function (x) { return x.desc || x.code; });
}

if (!RAW || !OUT) fail('缺少参数');
if (!fs.existsSync(RAW)) fail('CLI 输出文件不存在');
const rep = extract(fs.readFileSync(RAW, 'utf8'));
if (!rep || typeof rep !== 'object') fail('报告不是对象');
if (typeof rep.verdict !== 'string' || !rep.verdict.trim()) fail('缺少 verdict');
if (!Array.isArray(rep.steps)) fail('缺少 steps[]');
if (!Array.isArray(rep.conclusions)) fail('缺少 conclusions[]');

const rejected = [];
const params = {};
const raw = (rep.params && typeof rep.params === 'object') ? rep.params : {};
for (const k of Object.keys(raw)) {
  const r = RULES[k];
  if (!r) { rejected.push(k + '(非白名单，已忽略)'); continue; }
  const v = +raw[k];
  if (!Number.isFinite(v)) { rejected.push(k + '(非数值，已忽略)'); continue; }
  const cv = Math.min(r.max, Math.max(r.min, v));
  params[k] = cv;
  if (cv !== v) rejected.push(k + '(越界，钳制为 ' + cv + ')');
}
for (const k of LOCKED) if (k in raw) rejected.push(k + '(锁定项，已忽略)');

let snap = null;
if (SNAP && fs.existsSync(SNAP)) {
  try { snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')); } catch (e) { }
}
const cs = (snap && snap.chartSource) || {};
function pairs(arr, max) {
  return (Array.isArray(arr) ? arr : []).slice(0, max).map(x => ({
    name: str(x && x.name), value: +(x && x.value) || 0
  })).filter(x => x.name);
}
const charts = {
  curve: (snap && Array.isArray(snap.curveTail) ? snap.curveTail : []).slice(-200)
    .map(x => ({ t: str(x && x.t), v: +(x && x.cum) || 0 })).filter(x => x.t),
  pie: pairs(cs.pie, 8),
  bars: pairs(cs.bars, 10),
  tfBars: pairs(cs.tfBars, 8),
  metricsBars: pairs(cs.metricsBars, 8),
  costCurve: (Array.isArray(cs.costCurve) ? cs.costCurve : []).slice(-200)
    .map(x => ({ t: str(x && x.t), v: +(x && x.cum) || 0 })).filter(x => x.t)
};
const sp = (snap && snap.period) || null;

const out = {
  generatedAt: Date.now(),
  generatedAtBj: bj(Date.now()),
  source: 'CodeBuddy CLI / ' + (MODEL || 'unknown'),
  engine: rep.engine || (MODEL || 'unknown'),
  verdict: rep.verdict.trim().slice(0, 300),
  highlights: normHighlights(rep),
  steps: normSteps(rep),
  profitAnalysis: normTradeAnalysis(rep.profitAnalysis, 300),
  lossAnalysis: normTradeAnalysis(rep.lossAnalysis, 300),
  signalReport: normSignalReport(rep.signalReport, 300),
  rootCause: str(rep.rootCause).slice(0, 4000),
  backtestText: (rep.backtest && typeof rep.backtest === 'object') ? rep.backtest : null,
  metrics: (Array.isArray(rep.metrics) ? rep.metrics : []).slice(0, 100),
  charts,
  periodBj: sp ? { from: sp.from || null, to: sp.to || null, spanText: sp.spanText || null, events: sp.events || 0 } : null,
  conclusions: normStrings(rep.conclusions, 8, 200),
  params,
  codeChanges: normCodeChanges(rep.codeChanges, 16),
  audit: { model: MODEL || 'unknown', rejected, locked: LOCKED, appliedAt: bj(Date.now()) }
};
/* ===== 透传快照全量 Forensic 数据（保证前端报表 100% 完整，不依赖模型输出长度） ===== */
if (snap) {
  if (Array.isArray(snap.trades)) out.trades = snap.trades;
  if (Array.isArray(snap.signals)) out.signals = snap.signals;
  if (snap.backtest) out.backtest = snap.backtest;
}

const tmp = OUT + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
fs.renameSync(tmp, OUT);
console.log('[ai] 已写入 ' + path.basename(OUT) + ' · 模型=' + out.source +
  ' · 参数=' + JSON.stringify(params) + ' · 拒绝=' + JSON.stringify(rejected) +
  ' · 重点=' + out.highlights.length + ' · 图=' + Object.keys(charts).join('/'));
