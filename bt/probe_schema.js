'use strict';
/* 数据字段 + 时间覆盖 + 5m 质量诊断（只读，部署到远程 bt/ 下执行） */
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const ROOT = __dirname + '/..';
const SPLIT = Date.parse('2026-03-01T00:00:00Z');
const TFS = ['5m', '15m', '1h'];

function files(tf) {
  const base = path.join(ROOT, 'data/okx/kline', tf);
  const out = [];
  if (!fs.existsSync(base)) return out;
  for (const inst of fs.readdirSync(base)) {
    const d = path.join(base, inst);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) if (/^\d{6}\.sqlite$/.test(f)) out.push({ inst, f: path.join(d, f) });
  }
  return out;
}
function schemaSample(p) {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const tabs = db.prepare('SELECT name,sql FROM sqlite_master').all();
    const tname = (tabs.find(t => t.name === 'kline') || tabs.find(t => /k/i.test(t.name)) || {}).name;
    const cols = tname ? db.prepare('SELECT * FROM ' + tname + ' LIMIT 1').all() : [];
    return { sql: tabs.map(t => t.sql).join(' | '), sample: cols[0] || null };
  } finally { db.close(); }
}
const out = { schema: null, tf: {}, diag5m: {} };
const fl = files('5m');
if (fl.length) out.schema = schemaSample(fl[0].f);

for (const tf of TFS) {
  const list = files(tf);
  let n = 0, isN = 0, oosN = 0, minT = Infinity, maxT = -Infinity;
  const byMonth = {}, byInstMonth = {};
  const quality = { dupClose: 0, zeroVol: 0, badOHLC: 0, extreme: 0, gapBig: 0, bars: 0 };
  let prevTs = 0;
  const stepMs = tf === '5m' ? 300000 : tf === '15m' ? 900000 : 3600000;
  const retSum = [], instSet = new Set();
  for (const it of list) {
    instSet.add(it.inst);
    let db;
    try {
      db = new DatabaseSync(it.f, { readOnly: true });
      const rows = db.prepare('SELECT ts,o,h,l,c,v FROM kline ORDER BY ts').all();
      let prevC = null;
      for (const r of rows) {
        const t = +r.ts, c = +r.c, o = +r.o, h = +r.h, l = +r.l, v = +r.v;
        if (!(t > 0 && c > 0)) continue;
        n++;
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
        if (t < SPLIT) isN++; else oosN++;
        const m = new Date(t).toISOString().slice(0, 7);
        byMonth[m] = (byMonth[m] || 0) + 1;
        byInstMonth[it.inst] = byInstMonth[it.inst] || {};
        byInstMonth[it.inst][m] = (byInstMonth[it.inst][m] || 0) + 1;
        quality.bars++;
        if (prevC !== null) {
          if (c === prevC) quality.dupClose++;
          const rr = (c - prevC) / prevC * 10000;
          if (Math.abs(rr) > 1000) quality.extreme++;
          if (tf === '5m' && retSum.length < 3000000) retSum.push(rr);
        }
        if (!(v > 0)) quality.zeroVol++;
        if (!(h >= Math.max(o, c) && l <= Math.min(o, c) && l > 0)) quality.badOHLC++;
        if (prevTs && t - prevTs > stepMs * 1.5) quality.gapBig++;
        prevTs = t; prevC = c;
      }
    } catch (e) { }
    finally { try { if (db) db.close(); } catch (_) { } }
  }
  retSum.sort((a, b) => a - b);
  const q = p => retSum.length ? +retSum[Math.floor(p * (retSum.length - 1))].toFixed(2) : null;
  const mean = retSum.length ? retSum.reduce((a, b) => a + b, 0) / retSum.length : 0;
  const topInst = Object.entries(byInstMonth).map(([k, v]) => [k, Object.values(v).reduce((a, b) => a + b, 0), Object.keys(v).length])
    .sort((a, b) => b[1] - a[1]).slice(0, 10);
  out.tf[tf] = {
    files: list.length, insts: instSet.size, bars: n, isBars: isN, oosBars: oosN,
    isPct: n ? +(isN / n * 100).toFixed(2) : 0,
    from: minT < Infinity ? new Date(minT).toISOString() : null,
    to: maxT > -Infinity ? new Date(maxT).toISOString() : null,
    byMonth: byMonth, quality: quality,
    retQuantiles: tf === '5m' ? { p1: q(.01), p5: q(.05), p25: q(.25), p50: q(.5), p75: q(.75), p95: q(.95), p99: q(.99), mean: +mean.toFixed(3), n: retSum.length } : null,
    topInst: topInst
  };
}
console.log(JSON.stringify(out, null, 1));
