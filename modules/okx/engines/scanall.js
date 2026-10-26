// M4 modules/okx/engines/scanall.js · 全市场合约信号扫描（500+ 个 SWAP 合约）
//   ★用户要求「同步 4000多股票 + 合约500多个 + NQ, 分时同步信号」
//   这里把 OKX 公共 instruments 的全部 SWAP 合约拉出来, 并发取K线算
//   DIF/DEA 延长虚线交叉信号, 结果落盘缓存(供 ajax 分时同步)。
'use strict';
const fs = require('fs');
const path = require('path');
const klineEngine = require('./kline');
const chanEngine = require('./chan');

const ROOT = path.resolve(__dirname, '../../../');
const CACHE_DIR = path.join(ROOT, 'data/okx');
const CACHE_MS = 10 * 60 * 1000;     // 10 分钟
const CONC = 10;

// ★缓存按周期分文件(5m/1h/1d 各一份) —— 混在一起会导致切换周期时读到别的周期的数据
function cachePath(tf) { return path.join(CACHE_DIR, 'sig_scan_' + String(tf || '5m').replace(/[^\w]/g, '') + '.json'); }

let inflight = null;

function readCache(tf) {
  try {
    const st = fs.statSync(cachePath(tf));
    if (Date.now() - st.mtimeMs < CACHE_MS) {
      const j = JSON.parse(fs.readFileSync(cachePath(tf), 'utf8'));
      return { rows: j.rows || [], scanned: j.scanned || 0, total: j.total || 0 };
    }
  } catch (e) { }
  return null;
}
function writeCache(tf, rows, scanned, total) {
  try {
    fs.mkdirSync(path.dirname(cachePath(tf)), { recursive: true });
    fs.writeFileSync(cachePath(tf), JSON.stringify({ at: Date.now(), count: rows.length, scanned: scanned || 0, total: total || 0, rows }));
  } catch (e) { }
}

async function pool(items, n, worker) {
  const out = [];
  let idx = 0;
  async function fn() {
    while (idx < items.length) {
      const i = idx++;
      try { const r = await worker(items[i]); if (r) out.push(r); } catch (e) { }
    }
  }
  const ps = [];
  for (let k = 0; k < Math.min(n, items.length); k++) ps.push(fn());
  await Promise.all(ps);
  return out;
}

// 全市场扫描(默认) 或 仅本地已有K线的合约
// opt: {tf, limit, max, force, conc, pull(是否自动补拉缺失合约的K线)}
async function scanAll(opt) {
  opt = opt || {};
  const tf = opt.tf || '5m';
  if (!opt.force) {
    const c = readCache(tf);
    if (c) return { ok: true, rows: c.rows, cached: true, scanned: c.scanned, total: c.total };
  }
  if (inflight) return inflight;
  inflight = (async () => {
    // ★用 instruments(false): 优先走内存/磁盘缓存(6小时), 避免每次扫描都重打 OKX 公共接口
    //   (force=true 时若网络抖动会返回空列表 → 扫了个寂寞)
    const ins = await klineEngine.instruments(false);
    // ★合约号形如 "ETH-USDT-SWAP" → 匹配 USDT 计价(结尾是 -SWAP, 不是 USDT)
    const list = (ins.list || []).filter(x => /USDT/.test(x.instId || ''));
    let pool_ = list.map(x => x.instId);
    if (opt.max && pool_.length > opt.max) pool_ = pool_.slice(0, opt.max);
    const rows = await pool(pool_, opt.conc || CONC, async (instId) => {
      // 没有本地K线 → 自动补拉(默认3页=300根, 让每个合约也有十几天历史信号)
      let bars = klineEngine.loadLocal(instId, tf, opt.limit || 800);
      if (bars.length < 60) {
        if (opt.pull === false) return null;
        try { await klineEngine.pull(instId, tf, opt.pages || 3); } catch (e) { return null; }
        bars = klineEngine.loadLocal(instId, tf, opt.limit || 800);
      }
      if (bars.length < 60) return null;
      const r = chanEngine.macdSignals(bars, { maxAngle: 40, tf: tf });
      if (!r.sigs.length) return null;
      // ★返回该合约的【全部历史信号】(前面一个月/几天的都要), 不只最新一条
      return r.sigs.map(s => ({ t: s.t, inst: instId, name: instId, side: s.side, px: s.px, ang: s.ang, tf }));
    });
    const flat = [].concat.apply([], rows);
    flat.sort((a, b) => b.t - a.t);
    writeCache(tf, flat, pool_.length, list.length);
    inflight = null;
    return { ok: true, rows: flat, cached: false, scanned: pool_.length, total: list.length };
  })();
  return inflight;
}

// 只用本地已有K线的合约做信号(快, 不打网络) —— 给页面 ajax 分时同步用
async function scanLocal(opt) {
  opt = opt || {};
  const tf = opt.tf || '5m';
  const dir = path.join(ROOT, 'data/okx/kline');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.sqlite')); } catch (e) { }
  const rows = await pool(files, opt.conc || CONC, async (f) => {
    const instId = f.replace(/_\w+\.sqlite$/, '').replace(/_/g, '-');
    if (f.indexOf('_' + tf + '.sqlite') < 0) return null;
    const bars = klineEngine.loadLocal(instId, tf, opt.limit || 800);
    if (bars.length < 60) return null;
    const r = chanEngine.macdSignals(bars, { maxAngle: 40, tf: tf });
    if (!r.sigs.length) return null;
    return r.sigs.map(s => ({ t: s.t, inst: instId, name: instId, side: s.side, px: s.px, ang: s.ang, tf }));
  });
  const flat = [].concat.apply([], rows);
  flat.sort((a, b) => b.t - a.t);
  return { ok: true, rows: flat, count: flat.length };
}

// 是否正在扫描(给 API 层用: 扫描中先返回旧缓存, 不让页面干等)
function isScanning() { return !!inflight; }
// 读缓存(不触发扫描)
function cached(tf) {
  const c = readCache(tf);
  return c ? { ok: true, rows: c.rows, cached: true, scanned: c.scanned, total: c.total } : { ok: true, rows: [], cached: false, scanned: 0, total: 0 };
}

module.exports = { scanAll, scanLocal, isScanning, cached, cachePath };
