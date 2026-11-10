#!/usr/bin/env node
/* ============================================================================
 * tools/backfill_deep.js —— ★深度历史回补（2026-10-26）
 * ----------------------------------------------------------------------------
 * 用户需求：1小时/2小时/4小时没有详细数据，要求下载并放入数据库，补充两年历史。
 *
 * 作用：把 universe 全量合约的 K 线补到指定天数（默认两年=730天），
 *       写入 data/okx/kline/<instId>_<grain>.sqlite（与 kline.js 同一 schema）。
 *
 * 用法：
 *   node tools/backfill_deep.js --grains=1h,2h,4h --days=730 --conc=6
 *   node tools/backfill_deep.js --grains=15m --days=730 --conc=6 --limit=5
 *
 * 断点续传：进度写 data/okx/backfill_deep_state.json；
 * 实时进度写 data/okx/backfill_progress.json（页面「回补进度」面板读取）。
 * ========================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const KL = require(path.join(ROOT, 'modules/okx/engines/kline'));
const U = require(path.join(ROOT, 'modules/okx/engines/universe'));

const OKX_BAR = KL.OKX_BAR;
const API = 'https://www.okx.com/api/v5/market/history-candles';
const PAGE = 300;
const GAP = 70;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const STATE_FILE = path.join(ROOT, 'data/okx/backfill_deep_state.json');
const PROGRESS_FILE = path.join(ROOT, 'data/okx/backfill_progress.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 参数 ---------------- */
function arg(k, dft) {
  const m = process.argv.slice(2).find(a => a.startsWith('--' + k + '='));
  return m ? m.split('=').slice(1).join('=') : dft;
}
const GRAINS = (arg('grains', '1h,2h,4h')).split(',').map(s => s.trim()).filter(Boolean);
const DAYS = parseInt(arg('days', '730'), 10) || 730;
const CONC = Math.max(1, Math.min(8, parseInt(arg('conc', '6'), 10) || 6));
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;
const FORCE = arg('force', '0') === '1';

/* ---------------- 断点状态 ---------------- */
let STATE = {};
try { if (fs.existsSync(STATE_FILE)) STATE = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { STATE = {}; }
if (!STATE.done) STATE.done = {};
function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(STATE)); } catch (e) { } }

/* ---------------- 实时进度（页面进度面板读取） ---------------- */
let PROG = {};
try { if (fs.existsSync(PROGRESS_FILE)) PROG = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch (e) { PROG = {}; }
if (!PROG.cur) PROG.cur = {};
if (!PROG.grain) PROG.grain = {};
if (!PROG.startedAt) PROG.startedAt = Date.now();
function saveProg() { try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(PROG)); } catch (e) { } }

/* ---------------- HTTP ---------------- */
async function jget(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 25000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const j = await r.json();
    return { code: j.code, msg: j.msg, data: Array.isArray(j.data) ? j.data : [] };
  } catch (e) {
    return { code: '-1', msg: String((e && e.message) || e), data: [] };
  } finally { clearTimeout(t); }
}

/* ---------------- 单合约单粒度回补 ---------------- */
async function deepOne(instId, grain, target) {
  const MAXP = 500;
  const FLUSH = 4500;
  let after = 0, pages = 0, added = 0, oldest = 0, buf = [];
  let reachedEnd = false;
  const pkey = grain + ':' + instId;
  const tStart = Date.now();
  for (let p = 0; p < MAXP; p++) {
    let url = API + '?instId=' + encodeURIComponent(instId) + '&bar=' + (OKX_BAR[grain] || grain) + '&limit=' + PAGE;
    if (after) url += '&after=' + after;
    let j = await jget(url, 25000);
    if (j.code === '50011' || j.code === '50013' || j.code === '-1') { await sleep(1200); j = await jget(url, 25000); }
    if (j.code !== '0' || !j.data.length) { reachedEnd = true; break; }
    const rows = j.data.map(r => ({
      ts: parseInt(r[0], 10), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5]
    })).filter(r => isFinite(r.ts) && r.ts > 0).sort((a, b) => a.ts - b.ts);
    if (!rows.length) { reachedEnd = true; break; }
    buf = buf.concat(rows);
    oldest = rows[0].ts;
    pages++;
    PROG.cur[pkey] = { inst: instId, grain: grain, pages: pages, rows: pages * PAGE, oldest: oldest, at: Date.now() };
    if (p % 3 === 0) saveProg();
    if (oldest <= target) break;
    if (after && oldest >= after) { reachedEnd = true; break; }
    after = oldest;
    if (buf.length >= FLUSH) { const s = await KL.saveRows(instId, grain, buf); added += s.added || 0; buf = []; }
    await sleep(GAP);
  }
  if (buf.length) { const s = await KL.saveRows(instId, grain, buf); added += s.added || 0; }
  delete PROG.cur[pkey];
  saveProg();
  return { inst: instId, grain: grain, pages: pages, added: added, oldest: oldest, reachedEnd: reachedEnd, ms: Date.now() - tStart };
}

/* ---------------- 并发池 ---------------- */
async function pool(items, worker, conc) {
  let idx = 0;
  const runners = [];
  for (let w = 0; w < conc; w++) {
    runners.push((async () => {
      for (;;) {
        const i = idx++;
        if (i >= items.length) break;
        try { await worker(items[i], i); } catch (e) { }
      }
    })());
  }
  await Promise.all(runners);
}

/* ---------------- 主流程 ---------------- */
(async function main() {
  const u = await U.universe();
  if (!u.ok || !u.list) { console.log('universe 未就绪'); process.exit(1); }
  let list = u.list.slice();
  if (LIMIT > 0) list = list.slice(0, LIMIT);
  const target = Date.now() - DAYS * 86400000;
  console.log('[deep] 合约 ' + list.length + ' 个 · 粒度 ' + GRAINS.join('/') + ' · 回补 ' + DAYS + ' 天(至 ' + new Date(target).toISOString().slice(0, 10) + ') · 并发 ' + CONC);

  for (const grain of GRAINS) {
    const t0 = Date.now();
    let n = 0, added = 0, fail = 0;
    const todo = FORCE ? list : list.filter(x => !STATE.done[grain + ':' + x.instId]);
    const skip = list.length - todo.length;
    const g = PROG.grain[grain] || (PROG.grain[grain] = { startedAt: Date.now(), total: 0, done: 0, added: 0, ms: 0 });
    g.total = list.length; g.days = DAYS; g.running = true; g.todo = todo.length; g.skip = skip;
    saveProg();
    await pool(todo, async (x) => {
      const r = await deepOne(x.instId, grain, target);
      n++; added += r.added;
      if (r.pages === 0) fail++;
      STATE.done[grain + ':' + x.instId] = { at: Date.now(), pages: r.pages, added: r.added, oldest: r.oldest, end: !!r.reachedEnd };
      g.cur = n; g.done = skip + n; g.added = (g.added || 0) + r.added; g.ms = Date.now() - t0;
      if (n % 5 === 0) saveProg();
      if (n % 20 === 0) { saveState(); console.log('[' + grain + '] ' + n + '/' + todo.length + ' 新增 ' + added + ' 根 · ' + Math.round((Date.now() - t0) / 1000) + 's'); }
    }, CONC);
    g.running = false; g.ms = Date.now() - t0; g.done = list.length; g.cur = todo.length;
    saveProg(); saveState();
    console.log('[' + grain + '] 完成 ' + n + ' 个 · 新增 ' + added + ' 根 · 跳过(已完成) ' + skip + ' · 空/失败 ' + fail + ' · 用时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  }
  console.log('[deep] 全部完成');
})();