// M4 modules/okx/engines/kline.js · OKX 真实行情引擎（一比一承接 tools/okx_pull.py + cpp/okx 指标）
//   功能: 从 OKX 公共行情接口拉真实 OHLC K线(无需凭证) → 本地 node:sqlite 存储
//        → 本地算 EMA12/26/DIF/DEA/MACD → 算缠论(摆动顶/底 + 10根高低 + 斐波那契 + 买卖点)
//        → 合约列表(instruments SWAP, 缓存)。
//   涨红跌绿(中国惯例); 无未来函数(摆动点需右侧 PW 根确认)。
'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '../../../');
const KLINE_DIR = path.join(ROOT, 'data/okx/kline');
const INST_CACHE = path.join(ROOT, 'data/okx/instruments/instruments.json');

// OKX bar 口径: 库/接口统一用小写键, 接口 bar 用 OKX 要求的大写(H/D/W/M)
const OKX_BAR = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H',
  '1d': '1D', '2d': '2D', '3d': '3D', '1w': '1W', '1M': '1M'
};

function safeName(instId, bar) { return (instId + '_' + bar).replace(/[^A-Za-z0-9_-]/g, '_'); }
function storePath(instId, bar) { return path.join(KLINE_DIR, safeName(instId, bar) + '.sqlite'); }

function openStore(instId, bar) {
  fs.mkdirSync(KLINE_DIR, { recursive: true });
  const db = new DatabaseSync(storePath(instId, bar));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=30000;');
  db.exec('CREATE TABLE IF NOT EXISTS kline (' +
    'ts INTEGER PRIMARY KEY, d TEXT NOT NULL, ym INTEGER NOT NULL, ' +
    'o REAL, h REAL, l REAL, c REAL, v REAL)');
  return db;
}

/* ---------------- ★只读连接池（2026-10-25）
 *   实测：每次 loadLocal 都 open+close 一个 SQLite 文件 → 503 个库 = 29 秒
 *   （open/close 开销远大于 SELECT 本身）。
 *   修法：常驻只读句柄复用，LRU 上限控制。
 *   ★WAL 模式下读写可共存，不会锁住写侧。
 *
 * ★★ 上限从 600 调整为 120（2026-10-25 内存审计）：
 *   每个常驻 DatabaseSync 句柄约占 2MB 堆内存，600 个 → RSS 冲到 1.3GB。
 *   合约总数已从 507 降到 287，且 keepLatest 保鲜只刷新"最近浏览过"的合约，
 *   LRU 120 足以覆盖热区；命中率实测不受影响，内存降约 75%。 */
const RO_POOL = new Map();        // path → DatabaseSync
const RO_MAX = 120;
function roStore(instId, bar) {
  const sp = storePath(instId, bar);
  let db = RO_POOL.get(sp);
  if (db) {                       // LRU：命中后移到末尾
    RO_POOL.delete(sp); RO_POOL.set(sp, db);
    return db;
  }
  try {
    db = new DatabaseSync(sp, { readOnly: true });
    db.exec('PRAGMA busy_timeout=30000;');
  } catch (e) { return null; }
  RO_POOL.set(sp, db);
  while (RO_POOL.size > RO_MAX) {   // 淘汰最久未用
    const oldest = RO_POOL.keys().next().value;
    const od = RO_POOL.get(oldest);
    RO_POOL.delete(oldest);
    try { if (od) od.close(); } catch (e) { }
  }
  return db;
}

const CANDLES_API = 'https://www.okx.com/api/v5/market/history-candles';
const INST_API = 'https://www.okx.com/api/v5/public/instruments?instType=SWAP';
const TF = require('./universe');   // ★合约生态分类映射（公链/扩容/DeFi/Meme/AI/基础设施/链游/实物资产/其他）

// ---------------------------------------------------------------------------
// 拉取: OKX history-candles 降序返回, after 翻更早; 限流 20req/2s → 每请求 sleep 0.13s
// ---------------------------------------------------------------------------
async function fetchCandles(instId, bar, pages, afterTs) {
  const out = new Map();
  let after = afterTs || null;
  for (let p = 0; p < (pages || 2); p++) {
    let url = CANDLES_API + '?instId=' + encodeURIComponent(instId) + '&bar=' + (OKX_BAR[bar] || bar) + '&limit=100';
    if (after) url += '&after=' + after;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let data;
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j = await res.json();
      if (!j || j.code !== '0' || !Array.isArray(j.data)) break;
      data = j.data;
    } catch (e) { break; } finally { clearTimeout(timer); }
    if (!data.length) break;
    let oldest = null;
    for (const row of data) {
      const ts = parseInt(row[0], 10);
      if (!isFinite(ts)) continue;
      if (oldest === null || ts < oldest) oldest = ts;
      out.set(ts, { ts, o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5] });
    }
    after = oldest;
    await new Promise(r => setTimeout(r, 130));
  }
  return [...out.values()].sort((a, b) => a.ts - b.ts);
}

function tsParts(ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { d: y + '-' + m + '-' + day, ym: y * 100 + (+m) };
}

// pull: 拉取并落库(INSERT OR REPLACE 幂等); 返回新增/总数
async function pull(instId, bar, pages) {
  const rows = await fetchCandles(instId, bar, pages || 2, null);
  return await saveRows(instId, bar, rows);
}

/* ---------------- ★全市场 K线保鲜（2026-10-25）
 *   背景：keepLatest 只保鲜「被浏览过」的 ≤12 个合约，其余 495 个库的
 *   最新 ts 可能比 taker 库早好几小时 → ts 无交集 → 相关性分析样本只剩 69 个。
 *   实测 NVDA：kline 到 10-24T11:20，taker 已到 23:50 → 交集 0。
 *   修法：每轮为全市场拉 1 页(100 根 ≈ 8.3 小时) 5m K线，
 *        串行 0.13s 间隔 → 507 请求约 66 秒，远小于 10 分钟周期。
 *   ★只补最新（history-candles 降序返回），不会回补历史，省流量。 */
const ALL_KEEP_GAP = 150000;     // 同一合约同周期 2.5 分钟内不重复拉（轮次间隔 3 分钟）
const ALL_KEEP_AT = new Map();
let allKeepRunning = false;
let keepRound = 0;               // 轮次（奇偶交替正反序, 避免列表头部合约(如BTC)每轮都最先拉=永远最旧）

async function keepAllMarket(instIds, bar) {
  if (allKeepRunning) return { ok: false, err: 'busy' };
  allKeepRunning = true;
  const now = Date.now();
  let n = 0, fail = 0;
  const barN = bar || '5m';
  const ids = (instIds || []).slice();
  if (++keepRound % 2 === 0) ids.reverse();      // ★奇偶轮换: BTC 等头部合约不再永远滞后一轮
  try {
    for (const id of ids) {
      /* ★2026-10-26 key 按「合约|周期」隔离: 原来只按合约记时间戳,
       *   5m 保鲜刚拉过 → 15m 保鲜同 id 被跳过, 15m 库永远不更新(统计/信号全陈旧) */
      const k = id + '|' + barN;
      const at = ALL_KEEP_AT.get(k) || 0;
      if (now - at < ALL_KEEP_GAP) continue;
      ALL_KEEP_AT.set(k, now);
      try {
        await pull(id, barN, 1);
        n++;
      } catch (e) { fail++; }
      await new Promise(r => setTimeout(r, 130));   // OKX 限流 20req/2s
    }
  } finally { allKeepRunning = false; }
  return { ok: true, got: n, fail, at: Date.now() };
}

/* ---------------- ★K线保鲜员（2026-10-24 用户: "OKX K线图 居然不动 毫秒级ws"） ----------------
 * 主图实时由【前端 SSE 拼形成中K线】负责; 这里负责把【已收线】的K线持续落库,
 * 让定时对账重载(60s)能拿到真实的新K线, 回测/历史也保持完整。
 * 只保鲜「最近被浏览过」的合约(页面调 kline() 即登记), 最多 12 个, 串行拉取限流。 */
const WATCH = new Map();          // 'inst|bar' → 最后浏览时间
const KEEP_AT = new Map();        // 'inst|bar' → 最后拉取时间
const WATCH_MAX = 12;
const WATCH_TTL = 10 * 60000;     // 10 分钟没人看就停止保鲜
const KEEP_GAP = 25000;           // 同一合约 25s 内不重复拉

function touchWatch(instId, bar) {
  const k = instId + '|' + bar;
  WATCH.set(k, Date.now());
  if (WATCH.size > WATCH_MAX) {
    let oldK = null, oldT = Infinity;
    for (const [kk, vv] of WATCH) if (vv < oldT) { oldT = vv; oldK = kk; }
    if (oldK) WATCH.delete(oldK);
  }
}

async function keepLatest() {
  const now = Date.now();
  const jobs = [];
  for (const [k, at] of WATCH) {
    if (now - at > WATCH_TTL) { WATCH.delete(k); KEEP_AT.delete(k); continue; }
    if (now - (KEEP_AT.get(k) || 0) < KEEP_GAP) continue;
    KEEP_AT.set(k, now);
    const i = k.lastIndexOf('|');
    jobs.push([k.slice(0, i), k.slice(i + 1)]);
  }
  let n = 0;
  for (const [inst, bar] of jobs) {
    try { await pull(inst, bar, 1); n++; } catch (e) { /* 单合约失败不影响其他 */ }
  }
  return n;
}

// pullBefore: 拉取【指定时间之前】的历史K线(悬浮迷你窗定位老成交用)
//   OKX history-candles 的 after 参数 = "返回比 after 时间戳更早的记录"
async function pullBefore(instId, bar, beforeTs, pages) {
  const rows = await fetchCandles(instId, bar, pages || 6, beforeTs);
  return await saveRows(instId, bar, rows);
}

// backfill: 往回【分页回补】历史K线, 直到覆盖 untilTs 或没有更多数据
//   每页用 after=当前最老一根 继续往前翻(OKX history-candles 单页上限100根)
//   返回 {added, total, oldest, newest, rounds, done}
// backfill: 分页往前翻历史K线
//   opt 优先用:
//     {days: 3}          → 只回填最近 N 天（首屏轻量）
//     {limit: 1000}      → 一直往前翻, 直到本地总数 >= limit 根（或翻完）
//     {untilTs}          → 翻到该时间戳为止
//   旧接口 years 保留兼容（内部换算成 days）
async function backfill(instId, bar, opt) {
  opt = (opt && typeof opt === 'object') ? opt : { years: opt };
  const days = (opt.days !== null && opt.days !== undefined) ? +opt.days : (opt.years ? Math.round(+opt.years * 365) : null);
  const limit = (opt.limit !== null && opt.limit !== undefined) ? parseInt(opt.limit, 10) : 0;
  const untilTs = opt.untilTs || 0;
  const maxRounds = Math.max(1, Math.min(parseInt(opt.rounds || 40, 10) || 40, 300));

  let added = 0, after = null, done = false, oldest = 0;
  for (let r = 0; r < maxRounds; r++) {
    // ★每次翻页前先看本地已有多少根 —— limit 模式到量就停（移动K线回补1000根）
    if (limit > 0) {
      const cur = localCount(instId, bar);
      if (cur >= limit) { done = true; break; }
    }
    const rows = await fetchCandles(instId, bar, 1, after);
    if (!rows.length) { done = true; break; }
    const sv = await saveRows(instId, bar, rows);
    added += sv.added;
    const o = rows[0].ts;
    if (!oldest) oldest = o;
    if (untilTs && o <= untilTs) { done = true; break; }   // 已覆盖到目标时间
    if ((days !== null && days !== undefined) && o <= Date.now() - days * 86400000) { done = true; break; }  // 已回填够 N 天
    if (after && o >= after) { done = true; break; }     // 没有更早的数据
    after = o;
    if (rows.length < 100) { done = true; break; }        // 最后一页
    await new Promise(r => setTimeout(r, 130));            // 限流
  }
  const db = openStore(instId, bar);
  let stats = null;
  try { stats = db.prepare('SELECT COUNT(*) c, MIN(ts) mn, MAX(ts) mx FROM kline').get(); }
  finally { db.close(); }
  return {
    ok: true, inst: instId, bar, added, rounds: maxRounds, done,
    total: stats ? stats.c : 0, oldest: stats ? stats.mn : 0, newest: stats ? stats.mx : 0
  };
}

// 落库 + 统计
async function saveRows(instId, bar, rows) {
  if (!rows.length) return { ok: true, inst: instId, bar, added: 0, total: 0, empty: true };
  const db = openStore(instId, bar);
  const ins = db.prepare('INSERT OR REPLACE INTO kline (ts,d,ym,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)');
  const get = db.prepare('SELECT ts FROM kline WHERE ts=?');
  let added = 0;
  for (const r of rows) {
    const ex = get.get(r.ts);
    const pp = tsParts(r.ts);
    ins.run(r.ts, pp.d, pp.ym, r.o, r.h, r.l, r.c, r.v);
    if (!ex) added++;
  }
  const total = db.prepare('SELECT COUNT(*) c FROM kline').get().c;
  db.close();
  return { ok: true, inst: instId, bar, added, total, last_ts: rows[rows.length - 1].ts };
}

function loadLocal(instId, bar, limit, beforeTs) {
  const sp = storePath(instId, bar);
  if (!fs.existsSync(sp)) return [];
  // ★用常驻只读句柄（避免每次 open/close，实测 503 库 29s → 大幅下降）
  const db = roStore(instId, bar);
  if (!db) return [];
  let rows;
  try {
    // beforeTs: 只取该时间戳之前的K线（悬浮迷你窗按信号时间定位用）
    if (beforeTs) {
      // ★同样要 LIMIT —— 否则单合约全表读（1h 库可达 2000+ 根 × 287 合约）
      if (limit && limit > 0) {
        rows = db.prepare('SELECT ts,o,h,l,c,v FROM kline WHERE ts <= ? ORDER BY ts DESC LIMIT ?')
          .all(beforeTs, limit).reverse();
      } else {
        rows = db.prepare('SELECT ts,o,h,l,c,v FROM kline WHERE ts <= ? ORDER BY ts ASC').all(beforeTs);
      }
    } else if (limit && limit > 0) {
      // ★性能: 只要最近 N 根就别全表 SELECT —— ORDER BY ts DESC LIMIT N 再反序
      rows = db.prepare('SELECT ts,o,h,l,c,v FROM kline ORDER BY ts DESC LIMIT ?').all(limit).reverse();
    } else {
      rows = db.prepare('SELECT ts,o,h,l,c,v FROM kline ORDER BY ts ASC').all();
    }
  }
  catch (e) { return []; }
  let arr = rows.map(r => ({ t: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
  if (limit && arr.length > limit) arr = arr.slice(arr.length - limit);
  return arr;
}

function localCount(instId, bar) {
  const sp = storePath(instId, bar);
  if (!fs.existsSync(sp)) return 0;
  const db = new DatabaseSync(sp);
  try { return db.prepare('SELECT COUNT(*) c FROM kline').get().c; } finally { db.close(); }
}

// ---------------------------------------------------------------------------
// 指标: EMA12/26 → DIF/DEA/MACD(本地算, 不依赖过期 dump)
// ---------------------------------------------------------------------------
function ema(arr, n) { const k = 2 / (n + 1); let p = null; return arr.map(x => (p = (p === null || p === undefined) ? x : x * k + p * (1 - k))); }
function calcInd(C) {
  const e12 = ema(C, 12), e26 = ema(C, 26);
  const dif = e12.map((v, i) => v - e26[i]);
  const k9 = 2 / 10; let dea = null;
  const deaF = dif.map(x => (dea = (dea === null || dea === undefined) ? x : x * k9 + dea * (1 - k9)));
  const macd = dif.map((v, i) => (v - deaF[i]) * 2);
  return { e12, e26, dif, dea: deaF, macd };
}

// ---------------------------------------------------------------------------
// 缠论: 摆动顶/底(分型窗口确认, 无未来函数) + 最近10根高低 + 斐波那契 + 买卖点
//   摆点算法与原 astock app.js chanNew() 完全一致(同源口径)。
//   买卖点: 一买·大趋势底 = 下跌后的摆动底(dir>0); 一卖·大趋势顶 = 上涨后的摆动顶(dir<0)。
// ---------------------------------------------------------------------------
function computeSwing(all) {
  const n = all.length;
  const tops = [], bots = [];
  if (n < 8) return { tops, bots };
  const PW = 3, PMM = 0.0012, PCAP = 120;
  const H = all.map(b => b.h), L = all.map(b => b.l);
  const pv = [];
  for (let i = PW; i < n - PW; i++) {
    const h = H[i], l = L[i]; let isT = true, isB = true;
    for (let k = 1; k <= PW; k++) {
      if (H[i - k] >= h || H[i + k] >= h) isT = false;
      if (L[i - k] <= l || L[i + k] <= l) isB = false;
      if (!isT && !isB) break;
    }
    if (isT || isB) pv.push({ i, p: isT ? h : l, top: isT });
  }
  const f = [];
  for (const c of pv) {
    if (!f.length) { f.push(c); continue; }
    const last = f[f.length - 1];
    if (c.top === last.top) {
      if ((c.top && c.p >= last.p) || (!c.top && c.p <= last.p)) f[f.length - 1] = c;
      continue;
    }
    if (Math.abs(c.p - last.p) < last.p * PMM) continue;
    f.push(c);
  }
  const pf = f.length > PCAP ? f.slice(f.length - PCAP) : f;
  for (const q of pf) (q.top ? tops : bots).push(q);
  return { tops, bots, f };
}

function computeChan(bars) {
  const all = bars || [];
  const sw = computeSwing(all);
  const n = all.length;
  // 最近10根(尾部)最高/最低
  let hi10 = 0, lo10 = 0, t10 = 0, tN = 0;
  if (n >= 1) {
    const w = Math.min(10, n), i0 = n - w;
    let hi = -Infinity, lo = Infinity;
    for (let i = i0; i < n; i++) { if (all[i].h > hi) hi = all[i].h; if (all[i].l < lo) lo = all[i].l; }
    hi10 = hi; lo10 = lo; t10 = all[i0].t; tN = all[n - 1].t;
  }
  // 斐波那契: 取尾部窗口最高/最低作锚, 回撤 0.382/0.5/0.618/0.786 + 扩展 1.618
  const fib = [];
  if (n >= 20) {
    const w = Math.min(200, n), i0 = n - w;
    let hi = -Infinity, lo = Infinity;
    for (let i = i0; i < n; i++) { if (all[i].h > hi) hi = all[i].h; if (all[i].l < lo) lo = all[i].l; }
    if (hi > lo) {
      const span = hi - lo;
      [0.382, 0.5, 0.618, 0.786].forEach(r => fib.push([+(hi - span * r).toFixed(4), r, 1]));
      fib.push([+(hi + span * 0.618).toFixed(4), 1.618, 2]);
    }
  }
  // 买卖点: ★2026-10-24 已全部删除 —— 现在只有 DIF/DEA 延长虚线交叉那一个新信号
  //   (由 modules/okx/engines/chan.js 的 macdSignals 产出, 与前端同口径)
  const pts = [];
  return { ok: true, tops: sw.tops, bots: sw.bots, hi10, lo10, t10, tN, fib, pts };
}

// ---------------------------------------------------------------------------
// 对外: kline(读本地+按需播种) / instruments(缓存)
// ---------------------------------------------------------------------------
const seeding = new Set();
async function kline(instId, bar, limit, beforeTs) {
  bar = OKX_BAR[bar] ? bar : '5m';
  touchWatch(instId, bar);                    // ★登记浏览: 保鲜员持续拉最新K线落库
  // 悬浮迷你窗: 指定 before(信号时间) → 只取该时点之前的K线
  let rows = loadLocal(instId, bar, limit, beforeTs || 0);
  // 本地不足 → 播种(首次访问该合约时自动拉真实行情)
  if (rows.length < 50) {
    const key = instId + '|' + bar + (beforeTs ? '|b' : '');
    if (!seeding.has(key)) {
      seeding.add(key);
      try {
        // 指定 before → 拉【该时点之前】的历史; 否则拉最新
        if (beforeTs) await pullBefore(instId, bar, beforeTs, 8);
        else await pull(instId, bar, 6);
      } catch (e) { /* 忽略, 下次再试 */ } finally { seeding.delete(key); }
      rows = loadLocal(instId, bar, limit, beforeTs || 0);
    }
  }
  if (!rows.length) return { ok: false, err: '该周期暂无本地数据, 点「补充数据」拉取', inst: instId, bar };
  const C = rows.map(r => r.c);
  const ind = calcInd(C);
  const chan = computeChan(rows);
  // 指标按窗口切片对齐(前端 drawKline 也按窗口切, 这里给全量即可)
  const out = rows.map((r, i) => ({
    t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v,
    e12: ind.e12[i], e26: ind.e26[i], dif: ind.dif[i], dea: ind.dea[i], macd: ind.macd[i]
  }));
  return { ok: true, inst: instId, bar, bars: out, chan, count: out.length, last_t: out[out.length - 1].t };
}

let instCache = null, instCacheAt = 0;
async function instrumentsRaw(force) {
  const now = Date.now();
  if (!force && instCache && now - instCacheAt < 6 * 3600 * 1000) return { ok: true, src: 'mem', list: instCache };
  if (!force && fs.existsSync(INST_CACHE)) {
    try {
      const j = JSON.parse(fs.readFileSync(INST_CACHE, 'utf8'));
      instCache = j.list; instCacheAt = now;
      return { ok: true, src: 'file', list: instCache };
    } catch (e) { /* 损坏缓存忽略 */ }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let list = [];
  try {
    const res = await fetch(INST_API, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await res.json();
    if (j && j.code === '0' && Array.isArray(j.data)) {
      list = j.data
        .filter(d => d.ctType === 'linear' && /USDT|USDC/.test(d.settleCcy || d.quoteCcy || ''))
        .filter(d => d.instCategory !== '3' && d.instCategory !== '4')   // ★剔除股票/ETF/指数/贵金属/能源
        .map(d => ({
          instId: d.instId, baseCcy: d.baseCcy, quoteCcy: d.quoteCcy,
          ctVal: d.ctVal, ctValCcy: d.ctValCcy, lever: d.lever,
          instFamily: d.instFamily || '', state: d.state,
          cat: d.instCategory || ''          // ★OKX官方分类: 3=股票 4=商品 其余=加密
        }))
        .sort((a, b) => a.instId.localeCompare(b.instId));
    }
  } catch (e) { /* 网络失败 */ } finally { clearTimeout(timer); }
  if (list.length) {
    instCache = list; instCacheAt = now;
    try { fs.mkdirSync(path.dirname(INST_CACHE), { recursive: true }); fs.writeFileSync(INST_CACHE, JSON.stringify({ list, at: now })); } catch (e) {}
  } else if (instCache) {
    return { ok: true, src: 'mem-fallback', list: instCache };
  }
  return { ok: true, src: list.length ? 'live' : 'empty', list };
}

/* ★给每个合约打【加密生态分类】标签：
 *   OKX SWAP 里混着 加密永续 + 代币化股票/ETF/指数/贵金属/能源，
 *   这里只保留加密货币：剔除 instCategory=3(股票)/4(商品) + 手工排除名单，
 *   其余按加密生态分类归板块。分类口径与 universe.universe() 一致。
 *   每次请求重算(开销可忽略)。 */
async function instruments(force) {
  const r = await instrumentsRaw(force);
  const list = r && r.list;
  if (list && list.length) {
    list.forEach(x => {
      const sym = x.baseCcy || String(x.instId).split('-')[0];
      x.sym = sym;
      x.sector = TF.sectorOf(sym);
    });
  }
  return r;
}

module.exports = { kline, pull, pullBefore, backfill, loadLocal, localCount, instruments, computeChan, calcInd, OKX_BAR, touchWatch, keepLatest, keepAllMarket, saveRows };
