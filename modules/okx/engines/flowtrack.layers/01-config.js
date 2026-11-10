/* 01-config.js — 配置层：CFG / PYR 策略参数 / 事件标签
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
/* ============================================================================
 * modules/okx/engines/flowtrack.js —— 马丁格尔金字塔模拟引擎（2026-11-10 第五版）
 *
 * 入场：MACD(12,26,60) 零轴翻转，只 15m；每根 K 线边界（:00/:15/:30/:45）定时判定。
 * 资金：买多 / 卖空 / 加仓 每笔 0.1 美金；无限资金、无爆仓、无止损。
 * 加仓：满 1 小时 + 整仓浮亏 > 0（只要亏损）+ 当前 15m MACD 柱方向同向（同向加仓）→ 加仓 0.1 美金。
 * 平仓：整仓浮盈 > 5% 止盈；否则一直持有。
 * 硬性：同一合约·同一根K线只允许一次买多/卖空/加仓。
 * 数据：自 2026-11-01(北京时间) 起永久保留，不自动删除。
 *
 * 数据源：OKX 公共 WS books5 / trades（盘口与估值）+ REST candles（MACD）。
 * 撮合：开仓用吃单价（多 ask1 / 空 bid1），平仓用反向吃单价，往返计 10bp 手续费。
 * 存储：data/flowtrack/flowtrack.sqlite（独立库），由 server 常驻加载。
 * AI：data/ai_strategy.json 由服务器 CodeBuddy / Hy4 每日零点回写，仅白名单参数可热加载。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const CFG = {
  WS_URL: 'wss://ws.okx.com:8443/ws/v5/public',
  HTTP_BASE: 'https://www.okx.com',
  SUB_PER_CONN: 80,
  PING_MS: 20000,
  SCAN_MS: 5000,
  TAKER_BUCKETS: 13,                 // 13 × 5s = 65s 主动买卖滚动窗口
  THRESHOLDS: [0.1, 0.2, 0.3, 0.4],  // 并行模拟 4 档信号阈值
  PRIMARY_THR: 0.2,
  HOLD_WINDOWS: [60, 300, 900],      // 1m / 5m / 15m 三个持有窗口（对照）
  SEL_WINDOWS: [60, 900, 1800],
  SEL_PRIMARY_WIN: 60,
  FEE_BP: 10,                        // taker 手续费 0.05%/边 往返合计
  DEEP_N: 30,                        // REST 全深度重点合约数
  DEEP_POLL_MS: 10000,
  DEEP_GAP_MS: 130,
  WEIGHT_DECAY: 0.6,
  WEIGHT_THR: 0.2,                   // 加权口径只跑主阈值(控样本量与持仓数)
  SEL_THR: 0.4,
  SEL_MAX_SPREAD_BP: 3,
  SEL_REQUIRE_SAME_SIGN: true,
  SEL2_THR: 0.6,                      // 信号强度门槛
  SEL2_MIN_IMBW: 0.5,                // 近端加权盘口强度门槛
  JUMP_STEP_MIN: 5,                  // 跃迁判定窗口（分钟）：前后各一段 5 分钟
  JUMP_BP: 30,                        // 跃迁阈值(bp)：5 分钟尺度。
  JUMP_WINDOWS: [300, 900, 1800],    // 跃迁口径持有窗口（5m/15m/30m）
  JUMP_PRIMARY_WIN: 300,              // 主持仓窗口（5m 快速释放，避免锁死合约）
  JUMP_BP2: 60,                       // 宽松档跃迁阈值（并行采集，做阈值敏感性对照）
  JUMP_HIST_MIN: 30,                  // 价格历史保留分钟数
  JUMP_MOM_THR: 30,                   // 动量对照阈值(bp) —— 5分钟尺度，与 JUMP_BP 对齐
  JUMP_STEP_MIN_1H: 60,               // 1 小时尺度跃迁窗口（分钟）
  JUMP_HIST_MIN_LONG: 130,            // 长尺度（1h）判定所需历史分钟数 = 120 + 缓冲
  JUMP_WINDOWS_LONG: [900, 1800, 3600, 14400, 18000, 36000],  // 15分/30分/1h/4h/5h/10h
  JUMP_LONG_PRIMARY_WIN: 900,           // 主持仓窗口 = 15分钟（用户列的第一个窗口）
  JUMP_USER_WINDOWS: [900, 1800, 3600],
  JUMP_PROFIT_WINDOWS: [14400, 18000, 36000],
  MACD_INST_MAX: 1200,
  /* 入场：MACD(12,26,60) 零轴翻转，只 15m；取 REST candles 100 根收盘价。
   *   买多：当前柱 >0 且往前连续 ≥20 根 <0；卖空反之。
   *   口径同前端副图：DIF=EMA12-EMA26，DEA=EMA(DIF,60)，柱=(DIF-DEA)*2。 */
  MACD_FAST: 12, MACD_SLOW: 26, MACD_SIGNAL: 60,
  MACD_MIN_PREV: 20,                  // 翻转前至少连续 20 根反向柱
  MACD_BARS: 100,                     // 每次拉取的 K 线根数（≥ signal+20+预热）
  MACD_BOOT_DELAY_MS: 1500,           // 边界后延迟，等 OKX 生成新K线（避免拿到上一根）
  MACD_SCHED_TICK_MS: 1000,           // 边界检查间隔（ms）
  MACD_CONCURRENCY: 5,                // 每批并发 REST 请求数
  MACD_TICK_MS: 400,                  // 每批间隔 → 约 12.5 req/s（叠加旧诊断仍低于 OKX 限流）
  MACD_REQ_TIMEOUT_MS: 8000,          // 单请求超时，防止个别合约拖垮整轮
  MACD_STALE_EXTRA_MIN: 2,            // 缓存有效期 = 该周期步长 + 2 分钟余量
  JUMP_PERSIST: true,                 // 是否把分钟价格桶落库并跨重启回填
  JUMP_FILL_MID: true,                // 是否用盘口中价补齐无成交的分钟
  JUMP_MIN_SPAN_MIN: 10,              // 判定所需最小时间跨度（分钟）= STEP_MIN×2
  JUMP_MIN_BUCKETS: 3,                // 判定所需最少分钟桶数
  PROFIT_WIN: 900,                    // ★盈利基准窗口 = 15分钟(大间隔)
  EXTREME_WIN: 1800,                  // ★极限对照窗口 = 30分钟（验证持有越久是否越有利）
  PROFIT_MODE: 'sel',                 // ★盈利基准口径 = 精选口径(正向)
  MAIN_WIN: 300,                      // ★对照窗口 = 5分钟(历史主口径)
  SETTLE_MS: 30 * 60 * 1000,        // 每 30 分钟自动结算一次（与曲线分桶同频，及时反馈）
  RUN_MS: 0,                          // 0 = 一直运行（不设观察期上限）
  DB_DIR: path.join(__dirname, '..', '..', '..', 'data', 'flowtrack'),
  DB_FILE: path.join(__dirname, '..', '..', '..', 'data', 'flowtrack', 'flowtrack.sqlite'),
  FLUSH_MS: 5000,                    // 批量落库周期
  MAX_TRADES: 20000000,
  /* 数据自 2026-11-01(北京时间) 起永久保留；无 DELETE / VACUUM 定时器。
   *   KEEP_FROM_TS 仅作展示标记。 */
  KEEP_FROM_TS: Date.parse('2026-11-01T00:00:00+08:00'),
  KEEP_FOREVER: true,
  CLEANUP_MS: 0,                      // ★已废止：不再注册任何清理定时器
  CURVE_BUCKET_MS: 30 * 60 * 1000,   // 曲线分桶 30 分钟
  /* ★实时持仓曲线采样：每 30 秒落一次所有未平仓金字塔的实时净浮盈 USD（永久保留） */
  EQUITY_MS: 30000,
  /* ★买卖/加仓严格按 15m K 线边界后窗口执行：边界后 ENTRY_WINDOW_MS 内才允许信号驱动的
   *   买多/卖空/加仓，窗口外只做平仓判定。彻底消除「每时每刻都在买卖」的观感，节奏明确为每 15 分钟一次。 */
  ENTRY_WINDOW_MS: 2 * 60 * 1000,
  /* 平仓后同合约·同周期冷却 1 根 K 线（15 分钟），避免反复开仓/平仓抖动。 */
  REOPEN_COOLDOWN_MS: 15 * 60 * 1000
};

/* ============================== 金字塔策略配置（第五版） ==============================
 * 入场：MACD(12,26,60) 零轴翻转，只 15m。
 * 资金：买多 / 卖空 / 加仓 每笔 0.1 美金；无限资金、无止损、无爆仓。
 * 加仓：① 距开仓/上次加仓满 1 小时 ② 整仓浮亏 > 0（只要亏损即加仓，多空对称）
 *       ③ 当前 15m MACD 柱方向与持仓同向（买多仓需柱>0 / 卖空仓需柱<0，不要求零轴翻转）→ 同向加仓
 *       ④ 同根 K 线事件槽空闲 → 加仓 0.1 美金。
 * 硬性：同一合约·同一根 K 线只允许一次买多/卖空/加仓。
 * 平仓：整仓浮盈 > 总投入 5% 止盈；否则一直持有。
 * AI：白名单参数可热更新；ENTRY_USD / ADD_USD / TFS / KEEP_FOREVER 为锁定项。 */
const PYR = {
  TFS: [
    { id: '15m', step: 15, bar: '15m', thr: 100 }
  ],
  ENTRY_USD: 0.1,                  // ★买多/卖空每笔 0.1 美金（锁定项）
  ADD_USD: 0.1,                    // ★加仓每笔 0.1 美金（锁定项）
  TP_PCT: 5,                       // 止盈阈值：浮盈 > 总投入的 5%（AI 可调；用户2026-11-10要求由10%改为5%）
  ADD_LOSS_PCT: 0,                 // ★加仓亏损阈值：浮亏 > 0 即触发（只要处于亏损就同向加仓；AI 可调）
  ADD_INTERVAL_MS: 60 * 60 * 1000, // ★加仓间隔：每 1 小时（AI 可调）
  FEE_BP: 10                       // taker 往返手续费（bp）
};

/* 事件标签：加仓区分买多/卖空方向 */
function pyrEventLabel(r) {
  const ev = r && r.event;
  if (ev === 'add') return (+r.dir < 0) ? '卖空加仓' : '买多加仓';
  return ({ buy: '买多', sell: '卖空', close: '平仓' })[ev] || ev;
}

