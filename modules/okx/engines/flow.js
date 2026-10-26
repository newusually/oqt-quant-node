/* ============================================================================
 * modules/okx/engines/flow.js —— 【资金意愿 & 相关性引擎】
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25 第三轮）：
 *   "各个合约 各个板块的情绪还有市场要买多还是卖空"
 *   "可以结合板块涨跌和takervol 做比较画图 ... 画曲线比较两个曲线是否一致"
 *   "整个市场的涨跌和takervol 是否有关系可以画曲线"
 *
 * ★核心能力（保留非 taker 部分）：
 *   1) priceHistory()  板块价格历史曲线（本地 5m K 线库，等权平均涨跌幅）
 *   2) warmPrice()     后台预热各板块价格曲线（避免首访冷读 9 秒）
 *   3) marketVerdict() 市场总判断（买多 / 卖空 / 震荡）—— 基于涨跌家数与加权动量
 *
 * ★相关性工具：pearson / correlate / corrText（通用，非 taker 专用）
 *
 * [taker removed 2026-10-26] takervol 主动买卖量/净买/买比相关序列与函数全部移除
 * ========================================================================== */
'use strict';

/* ---------------- 板块名称/图标（本地副本，避免循环依赖） ---------------- */
const SECT_NAME = {
  l1: '公链层', l2: '扩容层', defi: 'DeFi', meme: 'Meme', ai: 'AI',
  infra: '基础设施', nft: '链游与NFT', rwa: '实物资产与DePIN', other: '其他加密'
};
const SECT_ICON = {
  l1: '⛓', l2: '🧱', defi: '🔗', meme: '🐕', ai: '🤖',
  infra: '🧰', nft: '🎮', rwa: '🏗', other: '🪙'
};

let _T = null;
function T() { if (!_T) _T = require('./universe'); return _T; }

/* 板块价格曲线参数（预热与调用方必须一致，否则缓存不命中 → 又冷读 9 秒） */
const PX_LIMIT = 288;            // 约 24 小时 5m 数据
const PX_TTL = 600000;           // 10 分钟（= server.js 预热周期）

/* ============================================================================
 * 一、相关性工具（皮尔逊 + 方向一致率）—— 通用，非 taker 专用
 * ========================================================================== */

/** 皮尔逊相关系数 */
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

/** 相关性解读 */
function corrText(r, agree) {
  let s;
  if (r >= 0.6) s = '强同向';
  else if (r >= 0.25) s = '弱同向';
  else if (r > -0.25) s = '基本无关';
  else if (r > -0.6) s = '弱背离';
  else s = '强背离';
  let d;
  if (agree >= 0.65) d = '方向高度一致';
  else if (agree >= 0.55) d = '方向略偏一致';
  else if (agree >= 0.45) d = '方向互有';
  else if (agree >= 0.35) d = '方向常相反';
  else d = '方向持续相反';
  return { text: s + '·' + d, corr: r, agree: +agree.toFixed(3) };
}

/**
 * 通用相关性计算：两个 {ts|k, value} 序列对齐后算 r + 一致率
 */
function correlate(a, b, opt) {
  opt = opt || {};
  const useK = opt.byK || ((a && a.length && (a[0].k !== null && a[0].k !== undefined)) && (b && b.length && (b[0].k !== null && b[0].k !== undefined)));
  const keyOf = x => (useK ? x.k : x.ts);
  const map = new Map();
  for (const x of (a || [])) map.set(keyOf(x), x.value);
  const xs = [], ys = [];
  for (const y of (b || [])) {
    const k = keyOf(y);
    if (!map.has(k)) continue;
    xs.push(map.get(k)); ys.push(y.value);
  }
  if (xs.length < 3) return { ok: false, corr: 0, agree: 0, n: xs.length, text: '样本不足', samples: [] };
  const r = pearson(xs, ys);
  let same = 0, cnt = 0;
  for (let i = 1; i < xs.length; i++) {
    const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1];
    if (dx === 0 || dy === 0) continue;
    cnt++;
    if ((dx > 0) === (dy > 0)) same++;
  }
  const agree = cnt ? same / cnt : 0.5;
  const c = corrText(r, agree);
  return {
    ok: true, corr: c.corr, agree: c.agree, text: c.text, n: xs.length
  };
}

/* ============================================================================
 * 二、板块价格历史曲线（基于本地 5m K 线库，非 taker）
 * ========================================================================== */

/**
 * 板块价格历史曲线（等权平均涨跌幅，%）
 * 数据源：本地 5m K 线库（真实历史）
 *
 * ★性能（实测踩坑）：冷读 161 个库 = 9.1 秒 → 绝不能放在请求链路上
 *   解法：① 结果缓存 60 秒  ② 后台预热（服务启动后异步把各板块算好）
 *        ③ 单合约只保留最近 400 根，减少 SQLite 读取量
 */
const PX_CACHE = new Map();      // sectorKey → {at, bars}
const PX_WARM = new Set();       // 正在预热的板块（防重复）
async function priceHistory(list, limit) {
  const key = list.map(x => x.sym).join(',');
  const hit = PX_CACHE.get(key);
  if (hit && Date.now() - hit.at < PX_TTL) return hit.bars;

  const KL = require('./kline');
  const per = new Map();         // ts → {sum, n}
  for (const x of list) {
    let rows;
    try { rows = KL.loadLocal(x.instId, '5m', limit || 400); } catch (e) { continue; }
    if (!rows || rows.length < 2) continue;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].c, cur = rows[i].c;
      if (!prev || !cur) continue;
      const pct = (cur - prev) / prev * 100;
      let b = per.get(rows[i].t);
      if (!b) { b = { sum: 0, n: 0 }; per.set(rows[i].t, b); }
      b.sum += pct; b.n++;
    }
  }
  const keys = Array.from(per.keys()).sort((a, b) => a - b);
  const bars = keys.map(k => {
    const b = per.get(k);
    return { ts: k, pct: +(b.sum / b.n).toFixed(4), n: b.n };
  });
  PX_CACHE.set(key, { at: Date.now(), bars });
  return bars;
}

/**
 * 后台预热：把各板块的价格曲线提前算好（避免首访等 9 秒）
 * @param {string[]} sids 板块 id 列表
 */
async function warmPrice(sids) {
  const u = await T().universe();
  if (!u.ok) return 0;
  let n = 0;
  for (const sid of (sids || [])) {
    if (PX_WARM.has(sid)) continue;
    PX_WARM.add(sid);
    try {
      const list = (u.list || []).filter(x => x.sector === sid);
      if (list.length) { await priceHistory(list, PX_LIMIT); n++; }
    } catch (e) { /* 单板块失败不影响其他 */ }
  }
  /* ★全市场也要预热（冷读 507 个文件较慢，不预热则首访长时间挂起） */
  if (!PX_WARM.has('__all__')) {
    PX_WARM.add('__all__');
    try {
      const all = (u.list || []);
      if (all.length) { await priceHistory(all, PX_LIMIT); n++; }
    } catch (e) { /* 忽略 */ }
  }
  return n;
}

/* ============================================================================
 * 三、市场总判断（买多还是卖空）—— 基于价格涨跌与加权动量（非 taker）
 * ========================================================================== */

async function marketVerdict() {
  const u = await T().universe();
  const q = await T().quotesAll();
  if (!u.ok || !q.ok) return { ok: false, err: '行情未就绪' };

  let up = 0, down = 0, flat = 0, turn = 0, pctW = 0;
  for (const x of u.list) {
    const t = q.map[x.instId];
    if (!t) continue;
    const pct = t.pct1d || 0;
    if (pct > 0) up++; else if (pct < 0) down++; else flat++;
    turn += (t.turn || 0);
    pctW += pct * (t.turn || 0);
  }
  const total = up + down + flat;
  const upRatio = total > 0 ? up / total * 100 : 50;
  const pctAvg = turn > 0 ? pctW / turn : 0;

  let action, color, reason;
  if (upRatio >= 60 && pctAvg > 0) {
    action = '买多'; color = '#f0334b';
    reason = '全市场上涨家数占比 ' + upRatio.toFixed(1) + '%，加权涨跌为正';
  } else if (upRatio <= 40 && pctAvg < 0) {
    action = '卖空'; color = '#0bbf7a';
    reason = '全市场下跌家数占比 ' + (100 - upRatio).toFixed(1) + '%，加权涨跌为负';
  } else if (upRatio >= 55) {
    action = '偏多'; color = '#f06a7a';
    reason = '上涨家数略占优（' + upRatio.toFixed(1) + '%），动能温和';
  } else if (upRatio <= 45) {
    action = '偏空'; color = '#3d9be8';
    reason = '下跌家数略占优（' + (100 - upRatio).toFixed(1) + '%），动能偏弱';
  } else {
    action = '震荡'; color = '#f0a020';
    reason = '涨跌家数基本均衡，多空拉锯';
  }
  return {
    ok: true, at: Date.now(),
    action, color, reason,
    up: +up.toFixed(0), down: +down.toFixed(0), flat: +flat.toFixed(0),
    upRatio: +upRatio.toFixed(1),
    pctAvg: +pctAvg.toFixed(3),
    text: '市场' + action + '：' + reason + '（涨跌家数 ' + up + '涨 / ' + down + '跌，加权涨跌 ' + pctAvg.toFixed(2) + '%）'
  };
}

module.exports = {
  marketVerdict, warmPrice, priceHistory,
  pearson, correlate, corrText, SECT_NAME, SECT_ICON
};