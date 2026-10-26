/* ============================================================================
 * modules/okx/engines/sentiment.js —— 市场情绪【按板块实时计算】
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）：
 *   "市场情绪 实时计算 要按板块分类 然后分别计算市场情绪才行"
 *
 * ★每个板块单独一个情绪分（0-100），因子（全部真实数据）：
 *   1) 涨跌家数比  weight 0.6 —— 板块内当日上涨合约占比
 *   2) 动量        weight 0.4 —— 板块成交额加权涨跌幅 → clamp(0.5+pctAvg/2)
 * 等级: ≥75 极贪婪 / ≥60 贪婪 / ≥40 中性 / ≥25 恐惧 / <25 极恐惧
 * 缓存 3 秒（WS 行情实时更新，无需外部请求）
 * [taker removed 2026-10-26] 主动买比因子及相关字段已移除
 * ========================================================================== */
'use strict';

const TTL = 3000;
let CACHE = null, CACHE_AT = 0;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function labelOf(score) {
  if (score >= 75) return { label: '极贪婪', color: '#f0334b' };
  if (score >= 60) return { label: '贪婪', color: '#f06a7a' };
  if (score >= 40) return { label: '中性', color: '#f0a020' };
  if (score >= 25) return { label: '恐惧', color: '#3d9be8' };
  return { label: '极恐惧', color: '#0bbf7a' };
}

/* 板块名称/图标（与 universe.SECTORS 一致的兜底副本，避免顶层循环依赖） */
const SECT_NAME = {
  l1: '公链层', l2: '扩容层', defi: 'DeFi', meme: 'Meme', ai: 'AI',
  infra: '基础设施', nft: '链游与NFT', rwa: '实物资产与DePIN', other: '其他加密'
};
const SECT_ICON = {
  l1: '⛓', l2: '🧱', defi: '🔗', meme: '🐕', ai: '🤖',
  infra: '🧰', nft: '🎮', rwa: '🏗', other: '🪙'
};

/* bars: 1=当前5m根(默认), 3=最近15分钟 */
async function compute(force, bars) {
  if (!force && CACHE && Date.now() - CACHE_AT < TTL) return CACHE;
  try {
    const [u, q] = await Promise.all([
      T_universe(),
      Promise.resolve(T_quotesAll())
    ]);
    if (!u.ok || !q.ok) return CACHE || { ok: false, sectors: [] };

    /* 板块聚合 */
    const by = {};
    let mUp = 0, mDn = 0, mTurn = 0;
    for (const x of u.list) {
      const t = q.map[x.instId];
      const sid = x.sector || 'other';
      (by[sid] = by[sid] || { sector: sid, count: 0, up: 0, down: 0, turn: 0, pctW: 0 });
      const b = by[sid];
      b.count++;
      if (t) {
        if (t.pct1d > 0) b.up++; else if (t.pct1d < 0) b.down++;
        b.turn += (t.turn || 0);
        b.pctW += (t.pct1d || 0) * (t.turn || 0);
        mUp += t.pct1d > 0 ? 1 : 0; mDn += t.pct1d < 0 ? 1 : 0;
        mTurn += (t.turn || 0);
      }
    }

    function scoreOf(b) {
      const dirTot = b.up + b.down;
      const upRatio = dirTot ? b.up / dirTot : 0.5;
      const pctAvg = b.turn > 0 ? b.pctW / b.turn : 0;
      const momentum = clamp(0.5 + pctAvg / 2, 0, 1);
      return {
        score: Math.round(100 * (0.6 * upRatio + 0.4 * momentum)),
        upRatio: +(upRatio * 100).toFixed(1),
        takerBuy: null,
        momentum: +momentum.toFixed(3),
        pctAvg: +pctAvg.toFixed(3)
      };
    }

    const sectors = Object.keys(by).map(sid => {
      const b = by[sid];
      const s = scoreOf(b);
      const lab = labelOf(s.score);
      return {
        sector: sid, name: (SECT_NAME[sid]) || sid,
        icon: (SECT_ICON[sid]) || '',
        count: b.count, up: b.up, down: b.down,
        turn: +b.turn.toFixed(0), takerCov: null,
        score: s.score, label: lab.label, color: lab.color,
        upRatio: s.upRatio, takerBuy: s.takerBuy, pctAvg: s.pctAvg
      };
    }).sort((a, b) => b.score - a.score);

    /* 全市场 pctW（成交额加权涨跌幅分子） */
    let pctWAll = 0;
    for (const x of u.list) { const t = q.map[x.instId]; if (t) pctWAll += (t.pct1d || 0) * (t.turn || 0); }
    const allPctAvg = mTurn > 0 ? pctWAll / mTurn : 0;
    const allScore = Math.round(100 * (0.6 * (mUp / Math.max(1, mUp + mDn)) + 0.4 * clamp(0.5 + allPctAvg / 2, 0, 1)));
    const allLab = labelOf(allScore);

    const data = {
      ok: true, at: Date.now(), bars: bars || 1,
      all: {
        score: allScore, label: allLab.label, color: allLab.color,
        count: u.list.length, up: mUp, down: mDn,
        takerCov: null, takerBuy: null,
        pctAvg: +allPctAvg.toFixed(3)
      },
      sectors
    };
    CACHE = data; CACHE_AT = Date.now();
    return data;
  } catch (e) {
    return CACHE || { ok: false, err: String(e && e.message || e), sectors: [] };
  }
}

/* 懒加载引擎（避免循环依赖：sentiment ← universe，反向无引用） */
let _T = null;
function T_universe() { if (!_T) _T = require('./universe'); return _T.universe(); }
function T_quotesAll() { if (!_T) _T = require('./universe'); return _T.quotesAll(); }

module.exports = { compute, labelOf };
