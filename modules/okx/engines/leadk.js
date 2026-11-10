'use strict';
/* ============================================================================
 * modules/okx/engines/leadk.js —— ★主力合约K线引擎（2026-11-03 重构）
 * ----------------------------------------------------------------------------
 * 职责: 主力合约(BTC)K线 —— 深历史回填 + 实时合成 + 两级缓存(SWR)
 *   (2026-11-03 从原 updown 引擎中剥离出的纯 K 线部分, 功能不变)
 *
 * 本模块只做 K 线:
 *   - tailCandles(): 按月分片(kstore)读主力合约最近 N 根 OHLCV
 *   - deepBackfill(): 左移到本地尽头时, 实时从 OKX history-candles 回补更早数据入库
 *   - liveSynth():    用 WS 实时价合成「形成中」的一根 + 补齐滞后片
 *   - 两级缓存(进程内 LRU + Redis) + SWR(stale-while-revalidate)
 *
 * 暴露: leadk(opt) → { ok, grain, lead, instId, candles:[{ts,o,h,l,c,v}], count, from, to }
 * ========================================================================== */

const I = require('./universe');
const KS = require('./kstore');
const RC = (function () { try { return require('./rediscache'); } catch (e) { return null; } })();

/* 分时周期毫秒数 */
const GRAIN_MS = {
  '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
  '1h': 3600000, '2h': 7200000, '4h': 14400000,
  '1H': 3600000, '1D': 86400000
};

/* ============================================================================
 * ① 读主力合约K线（月分片 kstore → 跨片拼接 + 去重 + 排序）
 * ========================================================================== */
function tailCandles(instId, grain, bars, beforeTs, cols) {
  const chain = KS.readChain(grain, instId, beforeTs || 0, bars + 1);
  let out = [];
  for (const f of chain) {                    // chain 从新到旧
    const db = KS.roOpen(f);
    if (!db) continue;
    try {
      const part = beforeTs
        ? db.prepare('SELECT ' + cols + ' FROM kline WHERE ts <= ? ORDER BY ts DESC LIMIT ?').all(beforeTs, bars + 1)
        : db.prepare('SELECT ' + cols + ' FROM kline ORDER BY ts DESC LIMIT ?').all(bars + 1);
      out = out.concat(part);
    } catch (e) { }
    if (out.length >= bars + 1) break;
  }
  if (!out.length) return [];
  out.sort((a, b) => a.ts - b.ts);
  if (chain.length > 1) {
    const seen = new Set();
    out = out.filter(r => (seen.has(r.ts) ? false : (seen.add(r.ts), true)));
  }
  if (out.length > bars + 1) out = out.slice(out.length - (bars + 1));
  return out;
}

/* ============================================================================
 * ② 进程内缓存（LRU）
 * ========================================================================== */
const CACHE = new Map();
const CACHE_MAX = 16;
function cachePut(k, v) {
  if (CACHE.has(k)) CACHE.delete(k);
  CACHE.set(k, v);
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    CACHE.delete(oldest);
  }
}
function cacheTouch(k) {
  const v = CACHE.get(k);
  if (!v) return null;
  CACHE.delete(k); CACHE.set(k, v);
  return v;
}

/* ============================================================================
 * ③ 深历史按需回填（OKX history-candles → kstore 月分片，INSERT OR REPLACE 幂等）
 *    缘起: 用户「往左移动K线只能看到10月」→ 本地到头时实时补更早数据。
 * ========================================================================== */
const _deepBusy = new Map();
const DEEP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
async function deepBackfill(instId, grain, wantTs, maxPages) {
  const key = instId + '|' + grain;
  if (_deepBusy.has(key)) { try { return await _deepBusy.get(key); } catch (e) { return false; } }
  let KL = null;
  try { KL = require('./kline'); } catch (e) { return false; }
  if (!KL || !KL.OKX_BAR || !KL.OKX_BAR[grain]) return false;
  const GATE = require('./okxgate');
  const p = (async () => {
    let oldest = 0;
    for (const db of KS.openAllRO(grain, instId)) {
      try { const r = db.prepare('SELECT MIN(ts) m FROM kline').get(); if (r && r.m && (!oldest || r.m < oldest)) oldest = r.m; } catch (e) { }
    }
    if (!oldest || oldest <= wantTs) return false;   // 本地已覆盖
    let after = oldest, added = 0, pages = 0;
    const pagesMax = Math.max(2, Math.min(8, parseInt(maxPages, 10) || 6));
    for (let pi = 0; pi < pagesMax; pi++) {
      await GATE.wait();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      let j = null;
      try {
        const resp = await fetch('https://www.okx.com/api/v5/market/history-candles?instId=' + encodeURIComponent(instId) +
          '&bar=' + KL.OKX_BAR[grain] + '&limit=300&after=' + after, { headers: { 'User-Agent': DEEP_UA }, signal: ctrl.signal });
        j = await resp.json();
      } catch (e) { j = null; } finally { clearTimeout(timer); }
      if (!j || j.code !== '0' || !Array.isArray(j.data) || !j.data.length) break;
      const rows = j.data.map(row => ({ ts: parseInt(row[0], 10), o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5] }))
        .filter(r => isFinite(r.ts) && r.ts > 0 && r.ts < after).sort((a, b) => a.ts - b.ts);
      if (!rows.length) break;
      try { const sv = await KL.saveRows(instId, grain, rows); added += (sv && sv.added) || 0; } catch (e) { break; }
      pages++;
      after = rows[0].ts;
      if (after <= wantTs) break;
    }
    if (pages) console.log('[leadk] 深历史回填 ' + instId + ' ' + grain + ': ' + pages + ' 页 +' + added + ' 根 → ' + new Date(after).toISOString().slice(0, 16));
    return added > 0;
  })().catch(() => false).finally(() => _deepBusy.delete(key));
  _deepBusy.set(key, p);
  return p;
}

/* ============================================================================
 * ④ WS 实时价：合成「形成中」的一根 + 补齐滞后片
 * ========================================================================== */
function livePriceFn() {
  let WS = null, WSF = null;
  try { WS = require('./okxws'); } catch (e) { }
  try { WSF = require('./wsfeed'); } catch (e) { }
  let wsfMap = null, wsfAt = 0;
  return function (id) {
    if (WS) { try { const t = WS.snap(id); if (t && isFinite(t.px) && t.px > 0) return t.px; } catch (e) { } }
    if (WSF && typeof WSF.snapshot === 'function') {
      if (!wsfMap || Date.now() - wsfAt > 30000) {
        wsfMap = {}; wsfAt = Date.now();
        try { const s = WSF.snapshot(); (s.list || []).forEach(x => { const v = +x.last; if (x.instId && isFinite(v) && v > 0) wsfMap[x.instId] = v; }); } catch (e) { }
      }
      return wsfMap[id] || null;
    }
    return null;
  };
}

/* 库尾最后一根（{ts,c}）—— 实时合成的前收基准 */
function lastCloseOf(grain, instId) {
  const chain = KS.readChain(grain, instId, 0, 1);
  if (!chain.length) return null;
  const db = KS.roOpen(chain[0]);
  if (!db) return null;
  try {
    const r = db.prepare('SELECT ts,c FROM kline ORDER BY ts DESC LIMIT 1').get();
    return (r && isFinite(r.ts)) ? { ts: r.ts, c: r.c } : null;
  } catch (e) { return null; }
}

/* ============================================================================
 * ⑤ 主入口
 * ========================================================================== */
async function leadk(opt) {
  opt = opt || {};
  const grain = opt.grain || '1h';   // ★2026-11-07 15m 已禁用，默认改 1h
  const maxBars = 30000;
  const bars = Math.max(1, Math.min(maxBars, parseInt(opt.bars, 10) || 2000));
  const beforeTs = parseInt(opt.beforeTs, 10) || 0;
  const lead = (opt.lead || 'BTC').toUpperCase();
  /* ★2026-11-09：优先按【完整 instId】定位合约（前端合约列表传的就是 instId）。
   *   旧版只按 sym 查、查不到就静默回退 BTC —— 正是「选了 A 却显示 B 的 K线」的根因。 */
  const instId = String(opt.instId || '').toUpperCase();

  const tiny = bars <= 60;
  const CACHE_TTL = tiny ? 5000 : 30000;
  const baseKey = [grain, bars, beforeTs, instId || lead].join('|');
  const hit = cacheTouch(baseKey);

  /* Redis 共享缓存 */
  if (RC && !hit && bars <= 3000) {
    try {
      const rj = await RC.getJSON('lk:v1:' + baseKey);
      if (rj && rj.candles && rj.candles.length) {
        cachePut(baseKey, { at: Date.now(), refreshing: false, data: rj });
        return Object.assign({}, rj, { fromRedis: true });
      }
    } catch (e) { }
  }

  /* SWR：过期即返旧数据，后台重算 */
  if (hit) {
    const fresh = Date.now() - hit.at < CACHE_TTL;
    if (!fresh && !hit.refreshing) {
      hit.refreshing = true;
      const key = baseKey;
      calc(grain, bars, beforeTs, lead, instId).then(function (d) {
        const dd = Object.assign({ ok: true, at: Date.now() }, d);
        cachePut(key, { at: Date.now(), refreshing: false, data: dd });
        if (RC && bars <= 3000) { try { RC.setJSON('lk:v1:' + key, 60, dd); } catch (e) { } }
      }).catch(function () {
        const h = CACHE.get(key); if (h) h.refreshing = false;
      });
    }
    const served = Object.assign({}, hit.data, { stale: !fresh, staleAgeMs: Date.now() - hit.at });
    return served;
  }

  const data = await calc(grain, bars, beforeTs, lead, instId);
  const out = Object.assign({ ok: true, at: Date.now() }, data);
  cachePut(baseKey, { at: Date.now(), refreshing: false, data: out });
  if (RC && bars <= 3000) {
    try { RC.setJSON('lk:v1:' + baseKey, 60, out); } catch (e) { }
  }
  return out;
}

/* ---------------- 核心计算：只取K线 ---------------- */
async function calc(grain, bars, beforeTs, lead, instId) {
  const u = await I.universe();
  if (!u || !u.ok) return { ok: false, err: 'universe 未就绪', candles: [] };
  const list = u.list || [];
  if (!list.length && !instId) return { ok: false, err: 'universe 为空', candles: [] };

  /* ★按完整 instId 精确匹配；即使该合约不在 universe 快照里，也直接用该 instId 读 K线，
   *   绝不静默回退 BTC。用户选择哪个合约，就返回哪个合约的 K线。 */
  var leadInst;
  if (instId) {
    leadInst = list.find(x => String(x.instId).toUpperCase() === instId) ||
      { instId: instId, sym: String(instId).split('-')[0] };
  } else {
    leadInst = list.find(x => x.sym === lead) ||
      { instId: lead + '-USDT-SWAP', sym: lead };
  }
  if (!leadInst || !leadInst.instId) return { ok: false, err: '未找到合约 ' + (instId || lead), candles: [] };

  let candles = tailCandles(leadInst.instId, grain, bars, beforeTs, 'ts,o,h,l,c,v');
  if (!candles || candles.length < 2) candles = [];

  /* 深历史回填：本地到头时实时补更早数据（仅历史窗口 beforeTs>0） */
  if (beforeTs && candles.length && candles.length < Math.max(50, bars * 0.6)) {
    const GM = GRAIN_MS[grain] || 900000;
    const wantTs = beforeTs - bars * GM * 0.5;
    try { await deepBackfill(leadInst.instId, grain, wantTs); } catch (e) { }
    const full2 = tailCandles(leadInst.instId, grain, bars, beforeTs, 'ts,o,h,l,c,v');
    if (full2 && full2.length >= 2) candles = full2;
  }

  /* 实时合成：仅最新窗口（beforeTs=0）才补「形成中」的一根 */
  if (!beforeTs && candles.length) {
    try {
      const GM = GRAIN_MS[grain] || 900000;
      const liveTs = Math.floor(Date.now() / GM) * GM;
      const livePx = livePriceFn();
      const lc = lastCloseOf(grain, leadInst.instId);
      const px = livePx(leadInst.instId);
      const lastTs = candles[candles.length - 1].ts;
      if (lc && px && liveTs > lc.ts && liveTs - lc.ts <= GM * 60) {
        if (lastTs < liveTs) {
          candles.push({ ts: liveTs, o: lc.c, h: Math.max(lc.c, px), l: Math.min(lc.c, px), c: px, v: 0 });
        } else if (lastTs === liveTs) {
          const last = candles[candles.length - 1];
          last.c = px; last.h = Math.max(last.h || 0, px); last.l = Math.min(last.l || px, px);
        }
      }
    } catch (e) { }
  }

  if (candles.length > 1) candles.sort((a, b) => a.ts - b.ts);

  return {
    ok: true,
    grain: grain,
    lead: leadInst.sym,
    instId: leadInst.instId,
    candles: candles,
    count: candles.length,
    from: candles.length ? candles[0].ts : 0,
    to: candles.length ? candles[candles.length - 1].ts : 0,
    computeMs: Date.now() - 0
  };
}

module.exports = { leadk: leadk, tailCandles: tailCandles, deepBackfill: deepBackfill };
