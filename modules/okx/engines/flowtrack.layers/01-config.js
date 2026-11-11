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
  TP_PCT: 5.5,                     // 止盈阈值：浮盈 > 总投入的 5.5%（配 3.5% 止损 → 盈亏比 1.57，胜率 39% 即可盈利）
  ADD_LOSS_PCT: 0,                 // ★加仓亏损阈值：浮亏 > 0 即触发（只要处于亏损就同向加仓；AI 可调）
  ADD_INTERVAL_MS: 60 * 60 * 1000, // ★加仓间隔：每 1 小时（AI 可调）
  /* ★分级加仓（用户 2026-11-11 要求）：形态越强加得越多，让盈利更快更大。
   *   强信号 = 孔雀开屏(MA5上穿全部均线) / V反转 / W双底 / M头 / 倒V / 放量 / MACD加速，
   *   命中后按 2~5 倍加仓，且允许在浮盈中加仓（趋势确认才加，不等浮亏）。
   *   安全边界：单金字塔总投入 ≤ MAX_EXPO_USD，强加仓次数 ≤ ADD_STRONG_MAX，总加仓次数 ≤ ADD_MAX_TIMES。 */
  STRONG_MIN_SCORE: 3,                     // 触发强加仓的最低形态分（0-6）★实测 2 分太松：1h 触发 419 笔加仓、敞口翻倍无产出
  ADD_STRONG_INTERVAL_MS: 15 * 60 * 1000,  // 强信号加仓最短间隔：1 根 15m K 线
  ADD_STRONG_MAX: 3,                       // 单个金字塔最多强信号加仓次数（实测 6 次过频，加仓摊厚均价反而更难止盈）
  ADD_MAX_TIMES: 18,                       // 单个金字塔加仓总次数上限
  MAX_EXPO_USD: 1.5,                       // 单个金字塔总投入上限（USD），防止无限加仓
  ADD_STRONG_PROFIT_STOP: 60,              // 浮盈达止盈目标的 60% 后不再加仓（避免加在顶/底）
  STRONG_ADD_MIN_PNL_PCT: -1.5,            // ★强加仓要求当前浮亏不深于 1.5%（禁止越亏越加，那是摊薄陷阱）
  TP_PCT_STRONG: 8,                        // 强形态金字塔止盈放宽到 8%（让盈利单跑得更远）

  /* ★风控与资金效率（用户 2026-11-11：赚得多、快 —— 实测 589 仓 100U 摊薄、54% 浮亏、无止损导致死仓占资金）
   *   核心矛盾：仓位铺得越散，单笔绝对收益越小，而手续费固定，资金周转越慢。
   *   四条纪律：① 并发上限强制集中资金 ② 硬止损砍掉明显做错的单 ③ 时间止损回收僵死资金
   *   ④ 移动止盈锁住"涨上去又回落"的利润（原来只认 5%/8% 一次性止盈，回撤就白赚）。 */
  MAX_OPEN_POS: 150,                 // 并发未平仓金字塔上限（超过则淘汰最弱仓位，集中资金）
  MAX_OPEN_HARD: 600,                // 硬上限：仅防无界扩张的兜底（必须高于当前实际并发，否则新信号会被直接挡死）
  PRUNE_PER_SCAN: 4,                 // 每次扫描最多淘汰几个弱仓（scan 每 5 秒一次）
  PRUNE_PER_WINDOW: 20,              // 每个开仓窗口（2 分钟）最多淘汰几个（≈80 个/小时；用于快速清理历史死仓）
  PRUNE_MIN_HOLD_MS: 60 * 60 * 1000, // 可淘汰仓位的最小持仓时长（1 小时，不砍刚开的）
  PRUNE_MIN_LOSS_PCT: 1,             // 可淘汰仓位的最低浮亏（%），浮盈仓永不淘汰

  STOP_LOSS_PCT: 3.5,                // 硬止损：整仓浮亏 ≥ 3.5% → 平仓（配 5.5% 止盈，盈亏比 1.57）
  STOP_LOSS_MIN_HOLD_MS: 15 * 60 * 1000, // 止损最小持仓（1 根K线，避免刚开仓被噪声打掉）
  TIME_STOP_MS: 24 * 3600 * 1000,    // 时间止损：持仓满 24 小时
  TIME_STOP_LOSS_PCT: 1,             // 且浮亏 ≥ 1% → 平仓（浮盈仓不受影响，继续跑止盈）

  /* ★快速试错（用户 2026-11-11 实测口径）：近 36h 671 笔入场中 663 笔（98.8%）形态分为 0，
   *   纯 MACD 翻转硬开 → 54% 仓位浮亏、资金周转停滞。改为「小仓试单 + 一根K线内证伪即撤」：
   *   入场 1 根 K 线后若仍浮亏且形态分 ≤ FAST_FAIL_MAX_SCORE（无任何形态支撑），立刻平仓换下一个信号，
   *   单笔试错成本 ≈ 0.1U × 2.5% = 0.0025U。有形态支撑的仓位不受影响（继续走浮亏加仓/强加仓）。 */
  FAST_FAIL_ENABLE: true,
  FAST_FAIL_MS: 15 * 60 * 1000,      // 试错观察期：1 根 15m K 线
  FAST_FAIL_LOSS_PCT: 2.5,           // 观察期满浮亏 ≥ 2.5% 才判失败（正常噪声不砍）
  FAST_FAIL_MAX_SCORE: 1,            // 且形态分 ≤ 1（无形态支撑）才算失败

  TRAIL_ARM_PCT: 3,                  // 移动止盈：浮盈曾达 3% 才开始跟踪
  TRAIL_BACK_PCT: 1.5,               // 从最高浮盈回落至 ≤ 1.5% → 锁利平仓（保住利润，不坐过山车）

  /* ★顺势过滤（2026-11-11 实测后加）：入场必须顺势，挡掉逆势单。
   *   实测依据：671 笔入场 98.8% 无形态，风控上线首小时止盈 5 笔 vs 止损类 94 笔。 */
  TREND_FILTER: true,                // 入场要求：价格/MA5/MA20 与方向一致（MA20 相对 MA60 允许 0.5% 缠绕）
  ADD_LOSS_TREND_ONLY: true,         // 浮亏加仓也要求顺势（逆势亏损单不再摊薄，直接交给止损）

  FEE_BP: 10                       // taker 往返手续费（bp）
};

/* 事件标签：加仓区分买多/卖空方向 */
function pyrEventLabel(r) {
  const ev = r && r.event;
  if (ev === 'add') return (+r.dir < 0) ? '卖空加仓' : '买多加仓';
  return ({ buy: '买多', sell: '卖空', close: '平仓' })[ev] || ev;
}

