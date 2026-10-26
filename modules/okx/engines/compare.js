/* ============================================================================
 * modules/okx/engines/compare.js —— 【数字货币基准对比引擎】
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25 第五轮）：
 *   "多用曲线 多用K线 曲线和K线都开始双条跑"
 *   "多和数字货币比较 告诉我 所有指标和数据 和合约数字货币比较涨跌如何情况"
 *
 * ★基准（benchmark）定义：
 *   基准 = 数字货币，两个口径同时给：
 *     ① CRYPTO_EQ  crypto 板块【等权指数】(289 个加密合约，剔除缺失后按覆盖率加权)
 *     ② BTC       比特币单点（市场共识锚）
 *
 * ★保留（K线/涨跌对比，非 taker）：
 *   - benchmark(): crypto 等权指数 K 线 + BTC 单点 K 线
 *   - compareSectors(): 各板块 vs 基准的 涨跌幅/情绪分/成交额/合约数 对比
 *   - dualCurves(): 基准 vs 对比板块的 累计涨跌双曲线 + K线双跑
 *
 * [taker removed 2026-10-26] takervol 主动买比/净买/买卖力量 相关指标与双曲线已移除
 * ========================================================================== */
'use strict';

const SECT_NAME = {
  l1: '公链层', l2: '扩容层', defi: 'DeFi', meme: 'Meme', ai: 'AI',
  infra: '基础设施', nft: '链游与NFT', rwa: '实物资产与DePIN', other: '其他加密'
};
const SECT_ICON = {
  l1: '⛓', l2: '🧱', defi: '🔗', meme: '🐕', ai: '🤖',
  infra: '🧰', nft: '🎮', rwa: '🏗', other: '🪙'
};
const BENCH_SYM = 'BTC';

let _T = null, _KL = null;
function T() { if (!_T) _T = require('./universe'); return _T; }
function KL() { if (!_KL) _KL = require('./kline'); return _KL; }

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx <= 0 || dy <= 0) return 0;
  return +(num / Math.sqrt(dx * dy)).toFixed(3);
}

/* ============================================================================
 * 一、K 线：板块等权指数 + 单合约（本地 5m K 线库）
 * ========================================================================== */
function sectorCandles(list, limit) {
  const per = new Map();          // ts → {o:[],h:[],l:[],c:[],v:[],n}
  const total = list.length || 1;
  for (const x of list) {
    let kl;
    try { kl = KL().loadLocal(x.instId, '5m', limit || 200); } catch (e) { continue; }
    if (!kl || !kl.length) continue;
    for (const b of kl) {
      let a = per.get(b.t);
      if (!a) { a = { o: [], h: [], l: [], c: [], v: [] }; per.set(b.t, a); }
      a.o.push(b.o); a.h.push(b.h); a.l.push(b.l); a.c.push(b.c); a.v.push(b.v || 0);
    }
  }
  const minCov = Math.max(3, Math.ceil(total * 0.35));
  const keys = Array.from(per.keys()).sort((a, b) => a - b);
  const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const out = [];
  for (const t of keys) {
    const a = per.get(t);
    if (!a.c.length || a.c.length < minCov) continue;   // ★覆盖率门槛
    const c = avg(a.c);
    if (!c) continue;
    out.push({ t, o: +avg(a.o).toFixed(4), h: +avg(a.h).toFixed(4), l: +avg(a.l).toFixed(4), c: +c.toFixed(4), v: +a.v.reduce((s, x) => s + x, 0).toFixed(2), n: a.c.length });
  }
  return out;
}

/** 单合约 K 线 */
function instCandles(instId, limit) {
  try {
    const kl = KL().loadLocal(instId, '5m', limit || 200);
    if (!kl) return [];
    return kl.map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0, n: 1 }));
  } catch (e) { return []; }
}

/* ============================================================================
 * 二、基准定义（全市场加密货币等权 + BTC）
 * ========================================================================== */
let BENCH = null;
async function benchmark() {
  if (BENCH && Date.now() - BENCH.at < 60000) return BENCH;
  const u = await T().universe();
  if (!u.ok) return { ok: false, err: 'universe 未就绪' };
  const cryptoList = u.list;          // ★universe 已只含加密货币
  const eq = sectorCandles(cryptoList, 200);
  const btc = instCandles(BENCH_SYM + '-USDT-SWAP', 200);
  const eqPct = eq.length ? eq.map(b => ({
    ts: b.t,
    pct: eq[0].c ? +((b.c - eq[0].c) / eq[0].c * 100).toFixed(4) : 0
  })) : [];
  const btcPct = btc.length ? btc.map(b => ({
    ts: b.t,
    pct: btc[0].c ? +((b.c - btc[0].c) / btc[0].c * 100).toFixed(4) : 0
  })) : [];
  BENCH = {
    ok: true, at: Date.now(),
    sym: BENCH_SYM, name: '比特币', icon: '₿',
    eq: { name: '数字货币等权', icon: '₿', count: cryptoList.length, candles: eq, pct: eqPct },
    btc: { name: '比特币', icon: '₿', instId: BENCH_SYM + '-USDT-SWAP', candles: btc, pct: btcPct }
  };
  return BENCH;
}

/* ============================================================================
 * 三、各板块 / 全市场 vs 数字货币基准 的指标对比（涨跌/成交/情绪，非 taker）
 * ========================================================================== */
async function compareSectors(opt) {
  opt = opt || {};
  const u = await T().universe();
  const q = await T().quotesAll();
  if (!u.ok || !q.ok) return { ok: false, err: '行情未就绪' };

  const bench = await benchmark();
  if (!bench.ok) return { ok: false, err: bench.err };

  // ── 实时指标聚合（各板块） ──
  const agg = {};
  for (const x of u.list) {
    const t = q.map[x.instId];
    const sid = x.sector || 'other';
    const a = agg[sid] || (agg[sid] = {
      sector: sid, name: SECT_NAME[sid] || sid, icon: SECT_ICON[sid] || '',
      count: 0, up: 0, down: 0, pctSum: 0, pctW: 0, turn: 0
    });
    a.count++;
    if (t) {
      const pct = t.pct1d || 0;
      if (pct > 0) a.up++; else if (pct < 0) a.down++;
      a.pctSum += pct;
      a.pctW += pct * (t.turn || 0);
      a.turn += (t.turn || 0);
    }
  }
  // ── 全市场 ──
  const all = {
    sector: 'all', name: '全市场', icon: '🌐', count: u.list.length,
    up: 0, down: 0, pctSum: 0, pctW: 0, turn: 0
  };
  for (const x of u.list) {
    const t = q.map[x.instId];
    if (t) {
      const pct = t.pct1d || 0;
      if (pct > 0) all.up++; else if (pct < 0) all.down++;
      all.pctSum += pct; all.pctW += pct * (t.turn || 0); all.turn += (t.turn || 0);
    }
  }
  const groups = Object.keys(agg).map(k => agg[k]).concat([all]);

  function metrics(a) {
    const pctAvg = a.turn > 0 ? a.pctW / a.turn : (a.count ? a.pctSum / a.count : 0);
    const upRatio = (a.up + a.down) > 0 ? a.up / (a.up + a.down) * 100 : 50;
    // 情绪分（仅由涨跌家数 + 动量构成，taker 因子已移除）
    const momentum = Math.max(0, Math.min(1, 0.5 + pctAvg / 2));
    const score = Math.round(100 * (0.6 * (upRatio / 100) + 0.4 * momentum));
    return {
      sector: a.sector, name: a.name, icon: a.icon, count: a.count,
      up: a.up, down: a.down, upRatio: +upRatio.toFixed(1),
      pctAvg: +pctAvg.toFixed(2),
      buyRatio: null, cumBuyRatio: null, cumNetRatio: null, net: null, netRatio: null,
      turn: Math.round(a.turn),
      score,
      label: score >= 75 ? '极贪婪' : score >= 60 ? '贪婪' : score >= 40 ? '中性' : score >= 25 ? '恐惧' : '极恐惧',
      takerCov: null
    };
  }

  const base = metrics(all);                // ★基准 = 全市场
  const list = groups.map(a => {
    const m = metrics(a);
    return Object.assign({}, m, {
      // 与基准的差值（超额）
      dPct: +(m.pctAvg - base.pctAvg).toFixed(2),
      dScore: m.score - base.score,
      dTurn: m.turn - base.turn,
      // 比值倍数
      xTurn: base.turn > 0 ? +(m.turn / base.turn).toFixed(2) : null,
      // 方向是否与基准一致
      sameDir: (m.pctAvg >= 0) === (base.pctAvg >= 0),
      strength: 0
    });
  });
  list.sort((a, b) => b.dPct - a.dPct);
  list.forEach((x, i) => { x.strength = i + 1; x.rank = list.length; });

  return {
    ok: true, at: Date.now(),
    benchmark: {
      name: base.name, icon: base.icon, pctAvg: base.pctAvg,
      score: base.score, turn: base.turn, count: base.count
    },
    list
  };
}

/* ============================================================================
 * 双曲线：基准 vs 对比对象（同网格）—— 累计涨跌对比（K 线，非 taker）
 * ========================================================================== */
async function dualCurves(sid, opt) {
  opt = opt || {};
  const bench = await benchmark();
  if (!bench.ok) return { ok: false, err: bench.err };
  const u = await T().universe();
  if (!u.ok) return { ok: false, err: 'universe 未就绪' };

  const list = (u.list || []).filter(x => !sid || sid === 'all' || x.sector === sid);
  if (!list.length) return { ok: false, err: '板块无标的' };
  const objCandles = sectorCandles(list, 200);
  const objName = (sid && sid !== 'all') ? (SECT_NAME[sid] || sid) : '全市场';

  // 累计涨跌序列（各自归一到 0）
  function cumPct(candles) {
    if (!candles.length || !candles[0].c) return [];
    const b = candles[0].c;
    return candles.map(c => ({ ts: c.t, value: +((c.c - b) / b * 100).toFixed(4) }));
  }
  const benchPct = cumPct(bench.eq.candles);
  const objPct = cumPct(objCandles);

  // 双曲线（相对序号 k 对齐到最近 N 根）
  const N = Math.min(benchPct.length, objPct.length, 240);
  const toRel = arr => arr.slice(-N).map((p, i) => ({ k: i, value: p.value }));
  const benchRel = toRel(benchPct);
  const objRel = toRel(objPct);
  const rPx = pearson(benchRel.map(x => x.value), objRel.map(x => x.value));

  return {
    ok: true, at: Date.now(),
    bench: { name: bench.eq.name, icon: bench.eq.icon, sym: bench.sym },
    obj: { name: objName, icon: (!sid || sid === 'all') ? '🌐' : (SECT_ICON[sid] || ''), sector: sid || 'all' },
    // 涨跌双曲线（相对序号 k 升序）
    px: {
      bench: benchRel.sort((a, b) => a.k - b.k),
      obj: objRel.sort((a, b) => a.k - b.k)
    },
    // takervol 双曲线（已移除）
    tk: null,
    corr: { px: rPx, tk: null },
    // K 线（供 candlestick 双跑）
    candles: (() => {
      const L = Math.min(bench.eq.candles.length, objCandles.length, 240);
      return {
        bench: bench.eq.candles.slice(-L),
        obj: objCandles.slice(-L),
        benchBtc: bench.btc.candles.slice(-L),
        length: L
      };
    })()
  };
}

/* ============================================================================
 * 组合入口
 * ========================================================================== */
async function all(opt) {
  opt = opt || {};
  const [cs, dc] = await Promise.all([
    compareSectors(opt),
    dualCurves(opt.sector || '', opt)
  ]);
  return { ok: cs.ok && dc.ok, at: Date.now(), sectors: cs, dual: dc, err: cs.err || dc.err || '' };
}

module.exports = { benchmark, compareSectors, dualCurves, sectorCandles, instCandles, all, pearson, BENCH_SYM, SECT_NAME, SECT_ICON };