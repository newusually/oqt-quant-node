'use strict';
/* ============================================================================
 * bt/instrument_filter.js —— 【硬约束】稳定币/零波动标的过滤器（所有回测引擎必须接入）
 * ----------------------------------------------------------------------------
 * 用户 2026-11-07 明确要求：「删除所有稳定币合约回测，以后不要再有了」。
 *
 * 为什么必须过滤：
 *   USDC-USDT-SWAP 这类稳定币对价格恒定≈1，close 几乎不变 →
 *   ① 产生大量 ret=0 平局（曾占某次回测 30.94%，其中 97% 来自 USDC）；
 *   ② 方向收益只剩报价噪声，能刷出「胜率 19.68%」这类虚假低胜率组合；
 *   ③ 该组合一度占 1h 回测 789/995 笔，把整体结论完全带偏。
 *   历史所有版本（含 angle_strategy / analyze_profit_contracts）均未做此清洗。
 *
 * 判定（双保险，任一命中即剔除）：
 *   ① base 是法币锚定稳定币 → isStableInstrument()
 *   ② 单根收益标准差 < MIN_SD_BP(5bp) → 零波动标的，抓漏网稳定币/停牌合约
 *
 * 规则：任何新建/修改的回测、扫描、信号引擎，加载标的后第一件事就是调用
 *       shouldExclude(inst, bars)；禁止把稳定币合约数据写入任何 JSON/CSV/面板。
 * ========================================================================== */
const MIN_SD = 0.0005;      /* 单根收益标准差下限 = 5bp */
const MIN_SD_BP = MIN_SD * 10000;

/* 法币锚定稳定币 base 名单（大写；覆盖 OKX / Binance / 主流链上稳定币） */
const STABLE_BASES = new Set([
  'USDC', 'USDT', 'DAI', 'FDUSD', 'TUSD', 'BUSD', 'USDE', 'USDG', 'PYUSD',
  'EURC', 'USDP', 'USDD', 'FRAX', 'LUSD', 'GUSD', 'SUSD', 'USDB', 'CRVUSD',
  'RLUSD', 'XUSD', 'USDX', 'EURT', 'AEUR', 'EURR', 'USDS', 'SUSDS', 'FDUSD',
  'USDP', 'USDK', 'HUSD', 'PAX', 'BUSD', 'USTC', 'USDN', 'MIM', 'ALUSD',
  'DOLA', 'USDD', 'USP', 'USK', 'USDC.E', 'USDT.E'
]);

/* 附加特征词：含这些词的 base 视为稳定/锚定资产（防止名单漏项） */
const STABLE_HINTS = /(^|_)(USD|USDT|USDC|EUR|STABLE|INDEX)(_|$)/i;

function baseOf(inst) {
  const s = String(inst || '').toUpperCase().trim();
  const parts = s.split(/[-_/:]/);
  return parts[0] || s;
}
function isStableInstrument(inst) {
  const base = baseOf(inst);
  if (STABLE_BASES.has(base)) return true;
  /* 无分隔符写法，如 USDCUSDT-SWAP / USDCUSDT */
  for (const b of STABLE_BASES) {
    if (base.length > b.length && base.indexOf(b) === 0 && /^[A-Z.]*$/.test(base.slice(b.length))) {
      /* USDCUSDT 这种「稳定币+稳定币」组合，剩余部分也是稳定币名才算 */
      const rest = base.slice(b.length);
      if (STABLE_BASES.has(rest)) return true;
    }
  }
  return false;
}
/* 单根简单收益的标准差（只用 close，不含未来函数，仅做标的级过滤） */
function returnStd(bars) {
  let s = 0, s2 = 0, n = 0;
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1].c, b = bars[i].c;
    if (!(a > 0 && b > 0)) continue;
    const r = (b - a) / a;
    s += r; s2 += r * r; n++;
  }
  const mean = n ? s / n : 0;
  return n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : 0;
}
/* 统一入口：返回 null 表示可交易；否则返回剔除原因（供日志/面板留痕） */
function shouldExclude(inst, bars) {
  if (isStableInstrument(inst)) return { inst: inst, reason: '稳定币合约', sdBp: null };
  const sd = returnStd(bars);
  if (sd < MIN_SD) return { inst: inst, reason: '零波动标的', sdBp: Math.round(sd * 10000 * 100) / 100 };
  return null;
}
module.exports = {
  MIN_SD: MIN_SD, MIN_SD_BP: MIN_SD_BP,
  STABLE_BASES: STABLE_BASES, STABLE_HINTS: STABLE_HINTS,
  isStableInstrument: isStableInstrument, returnStd: returnStd, shouldExclude: shouldExclude
};
