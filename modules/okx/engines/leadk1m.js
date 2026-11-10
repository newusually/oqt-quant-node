/* ============================================================================
 * modules/okx/engines/leadk1m.js —— ★主力合约「分时」1m K线（2026-11-04）
 * ----------------------------------------------------------------------------
 * 背景：本地 SQLite 只落了 5m / 15m / 1h，/api/boards/leadk?grain=1m 返回 0 根，
 *   导致总览主力合约图的「分时」按钮是死按钮。用户要求买卖点「所有K线图和分时都要有」。
 * 方案：1m 直接走 OKX 官方公共 REST（无需密钥）：
 *   /api/v5/market/candles?bar=1m&limit=300            → 最近 300 根(含形成中)
 *   /api/v5/market/history-candles?bar=1m&after=<最旧ts> → 每页 100 根向前翻 4 页
 *   合计约 700 根(≈12 小时)，足够 MA60 预热 + MA5×MA60 买卖点有密度。
 * 缓存：15 秒内存缓存，按 instId 隔离；失败时降级返回上一次缓存，避免分时图空白。
 * 输出格式与 modules/okx/engines/leadk.js 完全一致：{ok, grain, candles:[{ts,o,h,l,c,v}]}
 * ========================================================================== */
'use strict';

const BASE = 'https://www.okx.com/api/v5/market';
const TTL = 15000;
const PAGES = 4;
const CACHE = new Map();          // instId -> { at, candles }

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'oqt-quant-node/1.0', 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

/* OKX candle: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm] */
function toBar(a) {
  return { ts: +a[0], o: +a[1], h: +a[2], l: +a[3], c: +a[4], v: +a[5] };
}

async function pull(instId) {
  const now = Date.now();
  const hit = CACHE.get(instId);
  if (hit && now - hit.at < TTL && hit.candles.length) return hit.candles;

  const j = await getJson(BASE + '/candles?instId=' + encodeURIComponent(instId) + '&bar=1m&limit=300');
  if (!j || String(j.code) !== '0' || !Array.isArray(j.data) || !j.data.length) {
    throw new Error('okx candles code=' + (j && j.code));
  }
  let list = j.data.map(toBar);
  let after = list[list.length - 1].ts;
  for (let k = 0; k < PAGES && after; k++) {
    let jj;
    try {
      jj = await getJson(BASE + '/history-candles?instId=' + encodeURIComponent(instId) +
        '&bar=1m&limit=100&after=' + after);
    } catch (e) { break; }                       // 翻页失败不拖累已有数据
    if (!jj || String(jj.code) !== '0' || !Array.isArray(jj.data) || !jj.data.length) break;
    const more = jj.data.map(toBar);
    const next = more[more.length - 1].ts;
    if (!isFinite(next) || next >= after) break;
    list = list.concat(more);
    after = next;
  }

  const map = new Map();
  for (const x of list) if (isFinite(x.ts) && isFinite(x.c) && x.c > 0) map.set(x.ts, x);
  const out = Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  if (!out.length) throw new Error('empty 1m candles');
  CACHE.set(instId, { at: now, candles: out });
  return out;
}

module.exports = async function leadk1m(opt) {
  opt = opt || {};
  const lead = String(opt.lead || 'BTC').toUpperCase();
  const instId = lead.indexOf('-') >= 0 ? lead : (lead + '-USDT-SWAP');
  const bars = Math.max(1, Math.min(3000, +opt.bars || 2000));
  const beforeTs = +opt.beforeTs || 0;
  try {
    let c = await pull(instId);
    if (beforeTs > 0) c = c.filter(x => x.ts < beforeTs);
    return {
      ok: true, grain: '1m', lead: lead, instId: instId,
      candles: c.slice(-bars), source: 'okx-rest-1m'
    };
  } catch (e) {
    const old = CACHE.get(instId);
    if (old && old.candles.length) {
      let c = old.candles;
      if (beforeTs > 0) c = c.filter(x => x.ts < beforeTs);
      return { ok: true, grain: '1m', lead: lead, instId: instId, candles: c.slice(-bars), source: 'okx-rest-1m-cache', stale: true };
    }
    return { ok: false, err: String(e && e.message || e), candles: [] };
  }
};
