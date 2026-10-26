/* ============================================================================
 * modules/okx/engines/universe.js —— 合约 universe 引擎【数据层核心】
 * ----------------------------------------------------------------------------
 * ★范围：本引擎只保留【加密货币】合约
 *      · OKX 官方 instCategory = 3(股票/ETF/指数) / 4(商品/贵金属/能源) 的全部剔除
 *      · 少数被 OKX 误标 cat=1 的传统金融标的（见 EXCLUDE_SYMS）也手工剔除
 *      · 只剩 USDT 本位的 SWAP 永续（"能交易的"都是 USDT 永续）
 *
 * ★板块分类（sector）＝ 加密生态分类：
 *   按【加密生态】划分，让情绪/资金意愿/相关性/分布等板块分析面板
 *   继续有意义（全部内容都是加密货币）。
 *
 * ★实测事实（已用 OKX 公共接口逐一验证，勿凭字面臆断）：
 *   1. 分类钥匙 = instruments 的 instCategory 字段:
 *        cat=1 → 加密货币(289个，其中 LIT/CVX 被误标，实为 ETF/能源股)
 *        cat=3 → 股票/ETF/指数(209个)   cat=4 → 商品/大宗(9个)
 *   2. 【重要陷阱】SPX-USDT-SWAP 是【SPX6900 meme 币】(cat=1)，不是标普500!
 *   3. 当日涨跌幅(北京时间) = ticker 的 sodUtc8 字段（start of day, UTC+8 开盘价）
 *      实测 BTC: sodUtc8 与 1D K线开盘价 完全一致
 *      → pct1d = (last - sodUtc8) / sodUtc8 * 100
 *
 * 接口（全部公共接口，无需凭证）：
 *   GET /api/v5/public/instruments?instType=SWAP   → 合约+instCategory(分类钥匙)
 *   GET /api/v5/market/tickers?instType=SWAP       → 全市场实时价+open24h+sodUtc0+sodUtc8+vol24h
 *   GET /api/v5/market/candles?instId=X&bar=1m|5m → 分时涨跌幅
 * ========================================================================== */
'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const BASE = 'https://www.okx.com';
// ★统一 WebSocket 引擎（价格/当日涨跌从它读，零 REST 配额）
const WS = require('./okxws');

// WS 是否已就绪(已连接且收够数据)：就绪时所有取数走内存，毫秒级
function wsReady() { return WS.isStarted() && WS.count() > 50; }

/* ---------------- 手工剔除名单（被 OKX 误标 cat=1 的传统金融标的） ----------------
 *   LIT = Global X 锂电 ETF（价格 3.25，成交 765 万 → 是 ETF 不是币）
 *   CVX = 雪佛龙（价格 2.5，成交 26 万 → 是能源股不是币）
 *   实测这两者 cat=1，但按用户要求（删 ETF / 删能源）必须剔除 */
const EXCLUDE_SYMS = new Set([
  'LIT',   // 锂电池ETF
  'CVX'    // 雪佛龙(能源股)
]);

/* ---------------- 板块定义（加密生态分类，顺序即展示顺序） ---------------- */
const SECTORS = [
  { id: 'l1', name: '公链层', icon: '⛓', kind: 'chain' },
  { id: 'l2', name: '扩容层', icon: '🧱', kind: 'chain' },
  { id: 'defi', name: 'DeFi', icon: '🔗', kind: 'defi' },
  { id: 'meme', name: 'Meme', icon: '🐕', kind: 'meme' },
  { id: 'ai', name: 'AI', icon: '🤖', kind: 'ai' },
  { id: 'infra', name: '基础设施', icon: '🧰', kind: 'infra' },
  { id: 'nft', name: '链游与NFT', icon: '🎮', kind: 'nft' },
  { id: 'rwa', name: '实物资产与DePIN', icon: '🏗', kind: 'rwa' },
  { id: 'other', name: '其他加密', icon: '🪙', kind: 'other' }
];
const SECTOR_MAP = {};
SECTORS.forEach(s => { SECTOR_MAP[s.id] = s; });

/* ---------------- 符号 → 板块 显式名单 ----------------
 * 未收录的加密币一律归 other（"其他加密"），保证覆盖率 100% */
const MAP = {
  // ── 公链层（Layer-1）──
  l1: 'BTC ETH SOL BNB XRP ADA AVAX DOT ATOM NEAR APT SUI TRX TIA SEI ALGO HBAR XLM ETC EGLD ' +
      'ZIL KSM IOTA NEO CFX CELO ONE MINA FLOW ZEN ZETA LUNA TURBO',
  // ── 扩容层（Layer-2 / ZK / Rollup）──
  l2: 'ARB OP STRK ZK ZKP LINEA METIS AZTEC SCR MANTA BLAST',
  // ── DeFi（DEX / 借贷 / 收益 / 衍生品）──
  defi: 'AAVE COMP CRV DYDX ENA INJ LDO MORPHO PENDLE SKY SNX UNI SUSHI 1INCH GMX ETHFI EIGEN ' +
        'LQTY JUP JTO RAY BLEND YFI CAKE AXL OSMO WGM EDU SUPER',
  // ── Meme ──
  meme: 'DOGE SHIB PEPE WIF BONK FLOKI MEME TRUMP PNUT MOODENG PENGU FARTCOIN POPCAT BOME ' +
        'BRETT NEIRO SPX JELLYJELLY MEW BANANA RETARDIO MYRO TURBO',
  // ── AI ──
  ai: 'FET RENDER TAO VIRTUAL AIXBT AI WLD IRYS KAITO KGEN KII KITE DGAI',
  // ── 基础设施（预言机 / 数据 / 跨链 / 存储 / 媒体）──
  infra: 'LINK AR PYTH ARKM GRT NMR API3 FIL THETA LPT ENS UMA WCT ORDI SATS',
  // ── 链游与 NFT ──
  nft: 'AXS SAND MANA IMX GALA BIGTIME MAGIC BLUR PIXEL PRIME AUCTION',
  // ── 实物资产与 DePIN ──
  rwa: 'ONDO GRASS HNT SYRUP POL RLB'
};
// 反向索引
const OF = {};
Object.keys(MAP).forEach(sid => {
  MAP[sid].split(/\s+/).forEach(sym => { if (sym) OF[sym] = sid; });
});

/* 已知中文名（按实际标的实现，避免乱写；未列出的直接用符号） */
const NAMES = {
  BTC: '比特币', ETH: '以太坊', SOL: 'Solana', BNB: '币安币', XRP: '瑞波币',
  DOGE: '狗狗币', ADA: '艾达币', AVAX: '雪崩协议', DOT: '波卡', LINK: 'Chainlink',
  TRX: '波场', SUI: 'Sui', APT: 'Aptos', NEAR: 'NEAR', ATOM: 'Cosmos',
  TIA: 'Celestia', SEI: 'Sei', ALGO: 'Algorand', HBAR: 'Hedera', XLM: 'Stellar',
  ETC: '以太坊经典', EGLD: 'MultiversX', ZIL: 'Zilliqa', KSM: 'Kusama',
  IOTA: 'IOTA', NEO: 'NEO', CFX: 'Conflux', CELO: 'Celo', ONE: 'Harmony',
  MINA: 'Mina', FLOW: 'Flow', ZEN: 'Horizen', ZETA: 'ZetaChain', LUNA: 'Terra',
  ARB: 'Arbitrum', OP: 'Optimism', STRK: 'Starknet', ZK: 'zkSync', ZKP: 'zkSpace',
  LINEA: 'Linea', METIS: 'Metis', AZTEC: 'Aztec',
  AAVE: 'Aave', COMP: 'Compound', CRV: 'Curve', DYDX: 'dYdX', ENA: 'Ethena',
  INJ: 'Injective', LDO: 'Lido', MORPHO: 'Morpho', PENDLE: 'Pendle', SKY: 'Sky',
  SNX: 'Synthetix', UNI: 'Uniswap', SUSHI: 'SushiSwap', '1INCH': '1inch',
  GMX: 'GMX', ETHFI: 'Ether.fi', EIGEN: 'EigenLayer', LQTY: 'Liquidity',
  JUP: 'Jupiter', JTO: 'Jito', RAY: 'Raydium', BLEND: 'Blend', YFI: 'Yearn',
  PEPE: '佩佩蛙', SHIB: '柴犬币', WIF: 'dogwifhat', BONK: 'Bonk', FLOKI: 'Floki',
  MEME: 'Meme', TRUMP: '特朗普币', PENGU: 'Pudgy Penguins', FARTCOIN: 'Fartcoin',
  POPCAT: 'Popcat', BOME: 'Bome', BRETT: 'Brett', NEIRO: 'Neiro', SPX: 'SPX6900',
  MEW: 'cat in a dogs world', TURBO: 'Turbo',
  FET: 'Fetch.ai', RENDER: 'Render Network', TAO: 'Bittensor', VIRTUAL: 'Virtuals',
  AIXBT: 'AIXBT', AI: 'Sora', WLD: 'Worldcoin', IRYS: 'Iris',
  KAITO: 'KAITO', ARKM: 'Arkham', GRT: 'The Graph', NMR: 'Numeraire',
  API3: 'API3', FIL: 'Filecoin', THETA: 'Theta', LPT: 'Livepeer', ENS: 'ENS',
  UMA: 'UMA', ORDI: 'ORDI', SATS: 'SATS',
  AXS: 'Axie Infinity', SAND: 'The Sandbox', MANA: 'Decentraland', IMX: 'Immutable',
  GALA: 'Gala Games', MAGIC: 'Magic Eden', BLUR: 'Blur', PIXEL: 'Pixels',
  ONDO: 'Ondo Finance', GRASS: 'Grass', HNT: 'Helium', SYRUP: 'Maple Finance',
  POL: 'Polygon', RLB: 'Rollercoin'
};

/* ---------------- HTTP ---------------- */
async function jget(path, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout || 15000);
  try {
    const r = await fetch(BASE + path, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const j = await r.json();
    if (!j || j.code !== '0') return { ok: false, err: (j && j.msg) || ('http ' + r.status), data: [] };
    return { ok: true, data: j.data || [] };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e), data: [] };
  } finally { clearTimeout(timer); }
}

/* ★分层采样: 每个板块各取成交额 top N, 再按成交额汇总
 *   不能简单按成交额全局排序 —— 低价币成交额数值天然大,
 *   会把热门板块挤出榜外; 必须保证每个板块都有样本 */
function hotPick(pool, qMap, perSector, total) {
  const byS = {};
  for (const x of pool) {
    const t = qMap[x.instId];
    if (!t) continue;
    (byS[x.sector] = byS[x.sector] || []).push({ x, t, turn: t.turn });
  }
  const keys = Object.keys(byS);
  keys.forEach(k => byS[k].sort((a, b) => b.turn - a.turn));
  // ★轮转取(round-robin): 各板块第1名→第2名→第3名... 而不是按成交额全局排序后截断
  const out = [];
  for (let i = 0; i < perSector; i++) {
    for (let k = 0; k < keys.length; k++) {
      const it = byS[keys[k]][i];
      if (it) out.push(it);
    }
  }
  return total && total < out.length ? out.slice(0, total) : out;
}

// 并发受限流的批量拉取（★保守: 并发6 + 间隔350ms，卡在 OKX 40次/2s 限流以内）
async function batch(paths, size, gapMs) {
  const out = [];
  const sz = size || 6, gap = (gapMs === null || gapMs === undefined) ? 350 : gapMs;
  for (let i = 0; i < paths.length; i += sz) {
    const slice = paths.slice(i, i + sz);
    const rs = await Promise.all(slice.map(p => jget(p, 12000)));
    rs.forEach((r, k) => out.push({ path: slice[k], r }));
    if (gap && i + sz < paths.length) await sleep(gap);
  }
  return out;
}
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

/* rubik 接口限流极严: 实测串行 120ms 间隔就 429(Too Many Requests)
 * → 必须串行 + 260ms 间隔; 撞 429 则退避 900ms 后重试一次 */
// [taker removed 2026-10-26] takerBatch 已删除

function fp(v, d) {
  v = +v;
  if (!isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(2);
  if (a >= 1) return v.toFixed((d === null || d === undefined) ? 4 : d);
  if (a >= 0.01) return v.toFixed(4);
  if (a >= 0.0001) return v.toFixed(6);
  return v.toFixed(8);
}
function pctTxt(p) { return (p >= 0 ? '+' : '') + p.toFixed(2) + '%'; }

/* ---------------- 1. 合约 universe（分类） ----------------
 * 只保留 USDT 本位的 SWAP 永续（用户要的"能交易的"都是 USDT 永续） */
let UNIV = null, UNIV_AT = 0;
const UNIV_TTL = 6 * 3600 * 1000;

async function universe(force) {
  if (!force && UNIV && Date.now() - UNIV_AT < UNIV_TTL) return UNIV;
  const r = await jget('/api/v5/public/instruments?instType=SWAP', 25000);
  if (!r.ok || !r.data.length) return UNIV || { ok: false, at: 0, list: [], sectors: [] };
  const list = [];
  for (const it of r.data) {
    if (it.instType !== 'SWAP') continue;
    if (!/-USDT-SWAP$/.test(it.instId)) continue;     // 只要 USDT 本位永续
    if (it.state && it.state !== 'live') continue;
    const sym = it.instId.replace('-USDT-SWAP', '');
    const cat = it.instCategory;
    if (cat === '3' || cat === '4') continue;          // ★剔除股票/ETF/指数/贵金属/能源
    if (EXCLUDE_SYMS.has(sym)) continue;               // ★剔除被误标 cat=1 的传统金融标的
    list.push({
      instId: it.instId, sym, sector: sectorOf(sym), cat,
      name: NAMES[sym] || sym,
      tickSz: it.tickSz, lotSz: it.lotSz, lever: it.lever,
      listTime: +it.listTime || 0
    });
  }
  // 统计每个板块数量
  const cnt = {};
  list.forEach(x => { cnt[x.sector] = (cnt[x.sector] || 0) + 1; });
  const sectors = SECTORS.filter(s => cnt[s.id]).map(s => ({
    id: s.id, name: s.name, icon: s.icon, kind: s.kind, count: cnt[s.id] || 0
  }));
  UNIV = { ok: true, at: Date.now(), list, sectors };
  UNIV_AT = Date.now();
  return UNIV;
}

/* ---------------- 2. 全市场实时行情（一次请求拿全部） ----------------
 * ★关键: tickers 接口自带 sodUtc8(北京时间当日开盘) → 当日1D涨跌幅 */
let QUO = null, QUO_AT = 0;
const QUO_TTL = 1200;

async function quotesAll(force) {
  if (!force && QUO && Date.now() - QUO_AT < QUO_TTL) return QUO;
  // ★WS 就绪 → 直接读内存快照(零 REST 请求、毫秒级、不受限流)
  if (wsReady()) {
    const map = {};
    for (const id of WS.allIds()) {
      const s = WS.snap(id);
      if (!s || !s.px) continue;
      map[id] = {
        instId: id,
        last: s.px, pxText: fp(s.px),
        open1d: s.sodUtc8,
        pct1d: s.pct1d, pct1dText: pctTxt(s.pct1d),
        pct24: s.pct24, pct24Text: pctTxt(s.pct24),
        pct5m: s.pct5m, pct1m: s.pct1m,          // ★WS 本地快照算出的分时涨跌
        vol24: s.vol24, volCcy24: s.volCcy,
        turn: s.turn,
        ts: s.ts
      };
    }
    if (Object.keys(map).length) {
      QUO = { ok: true, at: Date.now(), map, src: 'ws' };
      QUO_AT = Date.now();
      return QUO;
    }
  }
  const r = await jget('/api/v5/market/tickers?instType=SWAP', 20000);
  if (!r.ok || !r.data.length) return QUO || { ok: false, at: 0, map: {} };
  const map = {};
  for (const t of r.data) {
    const last = +t.last;
    if (!isFinite(last) || last <= 0) continue;
    const o24 = +t.open24h;
    const sod8 = +t.sodUtc8;                 // ★北京时间当日开盘
    const c1d = sod8 > 0 ? (last - sod8) / sod8 * 100 : 0;
    const c24 = o24 > 0 ? (last - o24) / o24 * 100 : 0;
    // ★成交额(USD) = 成交币数 × 价格 —— 不能用 vol24h(张数)排序,
    //   否则低价币张数虚高, 会把热门板块全部挤出去(实测踩过)
    const volCcy = +t.volCcy24h || 0;
    map[t.instId] = {
      instId: t.instId,
      last, pxText: fp(last),
      open1d: sod8,
      pct1d: c1d, pct1dText: pctTxt(c1d),
      pct24: c24, pct24Text: pctTxt(c24),
      vol24: +t.vol24h || 0,
      volCcy24: volCcy,
      turn: volCcy * last,                 // ★USD 成交额(活跃度唯一正确口径)
      ts: +t.ts || Date.now()
    };
  }
  QUO = { ok: true, at: Date.now(), map };
  QUO_AT = Date.now();
  return QUO;
}

/* ---------------- 3. 板块行情（按板块切片 + 当日1D涨跌幅） ---------------- */
async function sectorQuotes(sid, limit) {
  const [u, q] = await Promise.all([universe(), quotesAll()]);
  if (!u.ok || !q.ok) return { ok: false, list: [] };
  let rows = u.list.filter(x => x.sector === sid).map(x => {
    const t = q.map[x.instId];
    if (!t) return null;
    return {
      code: x.instId, sym: x.sym, name: x.name, sector: sid,
      px: t.last, pxText: t.pxText,
      pct: t.pct1d, pctText: t.pct1dText,        // ★当日1D(北京时间)
      pct24: t.pct24, pct24Text: t.pct24Text,
      vol: t.vol24, turn: t.turn
    };
  }).filter(Boolean);
  rows.sort((a, b) => b.pct - a.pct);
  if (limit) rows = rows.slice(0, limit);
  return { ok: true, at: Date.now(), list: rows };
}

/* ---------------- 4. 涨跌幅双榜（1D当日 / 5m / 1m） ----------------
 * kind: '1d'(用tickers的sodUtc8,零额外请求) | '5m' | '1m'(用K线,只拉活跃topN)
 * 左右对称并列: 返回 gain(涨幅榜) + lose(跌幅榜) */
async function boards(kind, opt) {
  opt = opt || {};
  const sid = opt.sector || '';
  const n = opt.limit || 30;
  const [u, q] = await Promise.all([universe(), quotesAll()]);
  if (!u.ok || !q.ok) return { ok: false, kind, gain: [], lose: [] };

  let pool = u.list;
  if (sid && sid !== 'all') pool = pool.filter(x => x.sector === sid);

  // 1D: 直接用 tickers 的 sodUtc8（一次请求已拿到全部，无需额外请求）
  if (kind === '1d') {
    const rows = pool.map(x => {
      const t = q.map[x.instId];
      if (!t) return null;
      return {
        code: x.instId, sym: x.sym, name: x.name, sector: x.sector,
        px: t.last, pxText: t.pxText, pct: t.pct1d, pctText: t.pct1dText, vol: t.vol24, turn: t.turn
      };
    }).filter(Boolean);
    return sliceBoards(rows, n, '1d');
  }

  // ★5m/1m: WS 就绪时直接用内存价格快照算(零请求、实时);
  //   快照不满(pct5m/pct1m 为 null)的标的自动跳过 → 刚启动的前几分钟数据逐步补全
  if (wsReady()) {
    const rows = [];
    for (const x of pool) {
      const s = WS.snap(x.instId);
      if (!s || !s.px) continue;
      const pct = kind === '1m' ? s.pct1m : (kind === '30s' ? s.pct1m : s.pct5m);
      if ((pct === null || pct === undefined)) continue;
      rows.push({
        code: x.instId, sym: x.sym, name: x.name, sector: x.sector,
        px: s.px, pxText: fp(s.px), pct, pctText: pctTxt(pct),
        vol: s.vol24, turn: s.turn
      });
    }
    /* ★★WS 价格缓冲要跑满 5 分钟才有 pct5m（服务启动初期全为 null）
     *   → 覆盖率不足时用【本地 5m K 线库】补齐（K线保鲜后是最新的）
     *   否则 5 分钟榜在启动初期整榜为空 */
    if (kind !== '1m' && rows.length < pool.length * 0.5) {
      const extra = localBarsPct(pool, kind);
      const seen = new Set(rows.map(r => r.code));
      for (const r of extra) if (!seen.has(r.code)) rows.push(r);
    }
    return sliceBoards(rows, n, kind);
  }

  // 回退(WS 未就绪): ★优先用本地 K 线库（零外部请求，连接池后 ~100ms）
  if (kind !== '1m') {
    const local = localBarsPct(pool, kind);
    if (local.length) return sliceBoards(local, n, kind);
  }

  // 最后回退: REST K线，分层采样(每板块 top N) 避免几百次请求
  const hot = hotPick(pool, q.map, opt.perSector || 6, opt.scan || 60);

  const bar = kind === '1m' ? '1m' : '5m';
  const paths = hot.map(h => '/api/v5/market/candles?instId=' + h.x.instId + '&bar=' + bar + '&limit=2');
  const rs = await batch(paths, 6, 350);
  const rows = [];
  rs.forEach((o, i) => {
    if (!o.r.ok || o.r.data.length < 2) return;
    // K线: [ts,o,h,l,c,vol,...] 返回按时间倒序 → data[0] 最新(含形成中), data[1] 上一根
    const c0 = +o.r.data[0][4], c1 = +o.r.data[1][4];
    if (!isFinite(c0) || !isFinite(c1) || c1 <= 0) return;
    const h = hot[i];
    const pct = (c0 - c1) / c1 * 100;
    const t = q.map[h.x.instId];
    rows.push({
      code: h.x.instId, sym: h.x.sym, name: h.x.name, sector: h.x.sector,
      px: c0, pxText: fp(c0), pct, pctText: pctTxt(pct),
      vol: t ? t.vol24 : 0
    });
  });
  return sliceBoards(rows, n, kind);
}

function sliceBoards(rows, n, kind) {
  rows.sort((a, b) => b.pct - a.pct);
  const gain = rows.slice(0, n);
  const lose = rows.slice(-n).reverse();
  return {
    ok: true, kind, at: Date.now(), gain, lose,
    scanned: rows.length, total: rows.length,
    src: wsReady() ? 'ws' : 'rest'
  };
}

/* ★本地 5m K 线算涨跌幅（WS 快照未就绪时的兜底）
 *   读每合约本地 5m 库最后 2 根 → (最新-上一根)/上一根
 *   ★依赖 kline.js 的只读连接池：读全部库实测 ~100ms（open/close 版要 29 秒） */
function localBarsPct(pool, kind) {
  const rows = [];
  let KL = null;
  try { KL = require('./kline'); } catch (e) { return rows; }
  const bar = kind === '1m' ? '1m' : '5m';
  for (const x of pool) {
    let kl;
    try { kl = KL.loadLocal(x.instId, bar, 3); } catch (e) { continue; }
    if (!kl || kl.length < 2) continue;
    const c0 = kl[kl.length - 1].c, c1 = kl[kl.length - 2].c;
    if (!isFinite(c0) || !isFinite(c1) || c1 <= 0) continue;
    const pct = (c0 - c1) / c1 * 100;
    rows.push({
      code: x.instId, sym: x.sym, name: x.name, sector: x.sector,
      px: c0, pxText: fp(c0), pct, pctText: pctTxt(pct),
      vol: 0, turn: 0, src: 'local'
    });
  }
  return rows;
}

/* ---------------- 7. 板块总览（给首页大盘用：每块代表品种+均值） ---------------- */
async function sectorSummary() {
  const [u, q] = await Promise.all([universe(), quotesAll()]);
  if (!u.ok || !q.ok) return { ok: false, sectors: [] };
  const agg = {};
  for (const x of u.list) {
    const t = q.map[x.instId];
    if (!t) continue;
    const a = agg[x.sector] || (agg[x.sector] = { pctSum: 0, n: 0, up: 0, vol: 0, top: null });
    a.pctSum += t.pct1d; a.n++; a.vol += t.turn;
    if (t.pct1d > 0) a.up++;
    // 代表品种 = 该板块成交额最大的(最有代表性)
    if (!a.top || t.turn > a.top.turn) a.top = {
      code: x.instId, sym: x.sym, name: x.name, px: t.last, pxText: t.pxText,
      pct: t.pct1d, pctText: t.pct1dText, vol: t.vol24, turn: t.turn
    };
  }
  const sectors = SECTORS.map(s => {
    const a = agg[s.id];
    if (!a) return null;
    return {
      id: s.id, name: s.name, icon: s.icon, kind: s.kind,
      count: a.n, up: a.up, down: a.n - a.up,
      pctAvg: a.pctSum / a.n,
      pctAvgText: pctTxt(a.pctSum / a.n),
      vol: a.vol,
      top: a.top
    };
  }).filter(Boolean);
  return { ok: true, at: Date.now(), sectors };
}

/* ---------------- 板块归属（符号 → 加密生态板块） ---------------- */
function sectorOf(sym) {
  return OF[sym] || 'other';
}

module.exports = {
  SECTORS, SECTOR_MAP, NAMES, sectorOf,
  universe, quotesAll, sectorQuotes, boards, sectorSummary,
  jget, fp, pctTxt,
  universeSync: function () { return UNIV || null; },   // 同步读缓存(供上层取板块数量)
  wsReady: wsReady
};
