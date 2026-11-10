/* ============================================================================
 * modules/okx/engines/okxgate.js —— ★OKX history-candles 全局限流协调器
 * ----------------------------------------------------------------------------
 * 背景（2026-10-27 实测翻车）：
 *   OKX history-candles 限流 = 20 次/2秒/IP（约 10 req/s）。
 *   服务里同时有多个调用方共享这一个接口：
 *     - kline.js keepAllMarket / keepLatest（保鲜, 原 130ms 间隔 ≈ 7.7 req/s）
 *     - backfill.js 历史回填（原 2 worker × 70ms ≈ 28 req/s）
 *   两者同时跑 = 36 req/s ≫ 10 req/s → 全线 50011 → 保鲜 186 失败 +
 *   回填 287 合约全 FAIL → 详细表格/回测无数据、补充进度永远 0。
 *
 * 方案：所有 history-candles 调用方接入本模块：
 *   - 请求前 await wait()：全局统一节流（相邻请求 ≥ GAP_MS）+ 若处于
 *     全局暂停（刚被限流）则等待暂停解除
 *   - 收到 50011/50013 → punish()：全局暂停几秒，所有模块一起退避
 *   → 挤兑从根上消除；单个模块无需再各自 sleep 猜安全间隔。
 * ========================================================================== */
'use strict';

/* 全局最小请求间隔: 105ms ≈ 9.5 req/s（19 req/2s < 20 req/2s 限流上限, 留 5% 余量）。
 * ★2026-10-27 提速: 150ms(6.6req/s) → 105ms —— 香港服务器到 OKX 直连 69ms,
 *   实测限流线 20req/2s 从未触顶, 105ms 下全量回补一轮 76342 页从 4.5h → 2.2h。
 *   若出现 50011 频发可回退 150ms。 */
const GAP_MS = 105;
/* 被限流后的全局暂停时长（OKX 限流窗口 2s, 取 3 倍余量） */
const PUNISH_MS = 6000;

let pauseUntil = 0;     // 全局暂停截止时刻
let lastReq = 0;        // 上一次放行时刻

/* 请求前调用: 保证全局间隔并等待暂停解除后放行 */
async function wait() {
  for (;;) {
    const now = Date.now();
    const ready = Math.max(pauseUntil, lastReq + GAP_MS);
    if (ready <= now) { lastReq = Date.now(); return; }
    let d = ready - now;
    if (d > 1000) d = 1000;
    await new Promise(r => setTimeout(r, d));
  }
}

/* 收到限流(50011/50013)时调用: 全局暂停 ms 毫秒 */
function punish(ms) {
  const until = Date.now() + (ms || PUNISH_MS);
  if (until > pauseUntil) pauseUntil = until;
}

/* 观测用: 剩余暂停毫秒 */
function status() {
  return { pauseLeftMs: Math.max(0, pauseUntil - Date.now()), gapMs: GAP_MS };
}

module.exports = { wait, punish, status };
