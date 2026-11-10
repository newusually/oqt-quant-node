/* ============================================================================
 * modules/okx/engines/chan.js —— ★缠论·大级别转折点引擎（2026-10-28g MACD 分区智能识别版）
 * ----------------------------------------------------------------------------
 * 用户需求（原话要点）：
 *   "跟 DIFF/DEA 一样划线，画的是直线，但是是连接在一起的。
 *    自动识别最高点和最低点，在 MACD DIFF/DEA >0/<0 范围内操作，参数是 12 26 60，
 *    这样准确点。然后划线缠论，缠论的涨幅要 1% 左右跌幅也是，K线 10-20 根都可以，
 *    自动识别最高点最低点连接成缠论。重新修改信号表格和回测数据，要求智能划线缠论。"
 *
 * ★算法定义（MACD 分区极值识别 + 缠论连续划线 —— 纯划线、零预测、只复盘已收盘K线）：
 *   1) MACD(fast=12, slow=26, dea=60)：DIFF = EMA12 − EMA26，DEA = EMA(DIFF,60)；
 *      DIFF>DEA(多头区) / DIFF<DEA(空头区) 把行情切成交替分区；
 *   2) ★自动识别最高/最低点：每个多头分区取【区间最高价】= 顶(卖)，
 *      每个空头分区取【区间最低价】= 底(买) —— 顶/底天然交替，无需人工确认规则；
 *   3) 已收盘分区的极值 = 确认转折点；最后一个进行中分区 → 开放段(虚线, 端点可顺延)；
 *   4) ★缠论连线（像 DIFF/DEA 一样首尾相连的直线段, 生生不息永不断线）：
 *      相邻转折点全部相连；满足区间条件 → 红/绿实线信号段（先买后卖红/先卖后买绿）；
 *      不满足（间隔<minBars / 段幅<minAmp 等）→ 灰色虚线过渡段（如实区分, 不误导）。
 *   5) 区间条件（全部热插拔, data/chan.config.json）：
 *        间隔K线数 minBars~maxBars（默认 ≥10, 0=不限上限）
 *        段涨跌幅 minAmp%~maxAmp%（默认 ≥1%, 0=不限上限, 支持小数）
 *      MACD 参数 fast/slow/dea 同样热插拔（默认 12/26/60）。
 *
 * ★热插拔配置 data/chan.config.json（每次 analyze/seq 前按 mtime 自动重载）：
 *   { "minBars":10, "maxBars":0, "minAmp":1, "maxAmp":0,
 *     "macdFast":12, "macdSlow":26, "macdDea":60 }
 *   回测面板「✏ 修改条件」→ POST /api/boards/chan-save → 本文件落盘 + CACHE 清空
 *   → 所有分时/回测/K线下一次取数即用新条件，全站即时同步。
 *
 * ★每信号附带（纯划线字段，★2026-11-03 家数/买卖语义已移除）：
 *   segBars      与前一转折点连线的K线根数
 *   segAmp       连线涨跌幅%（带符号，底→顶为正）
 *   segBrk       true=该段未满足区间条件(K线图虚线过渡) / false=红绿实线段
 *   nextAmp      到下一个相反转折点的涨跌幅
 *   nextRetC     到下一个相反转折点的收盘收益率%
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const KS = require('./kstore');
/* ★2026-11-03 涨跌家数库(updownstore)已整体删除 → 缠论不再依赖家数, 只做纯划线。 */
const { DatabaseSync } = require('node:sqlite');
// ★2026-11-07 用户要求彻底删除美股全线 → US_DB / US_TF / loadCandlesUS 已全部移除，只保留 OKX 数据源

/* ★2026-11-07 用户要求彻底删除 5m/15m → 缠论周期选项卡移除 5m/15m
 *   保留 3m/1h/2h/4h（这些周期本地无历史库时会自动回落，不会重建 5m/15m） */
const GRANS = ['3m', '1h', '2h', '4h'];
const GM = { '3m': 180000, '5m': 300000, '15m': 900000, '1h': 3600000, '2h': 7200000, '4h': 14400000 };
const GRAN_LABEL = { '3m': '3分钟', '5m': '5分钟', '15m': '15分钟', '1h': '1小时', '2h': '2小时', '4h': '4小时' };

/* ============================================================================
 * ★⓪ 热插拔配置（data/chan.config.json）—— 回测面板保存即改, 全站分时/K线同步
 * ========================================================================== */
const CFG_PATH = path.join(__dirname, '..', '..', '..', 'data', 'chan.config.json');
const CFG_DEFAULT = { minBars: 10, maxBars: 0, minAmp: 1, maxAmp: 0, macdFast: 12, macdSlow: 26, macdDea: 60 };
let _cfgCache = { mtimeMs: -1, cfg: null };

function _intv(v, d, lo, hi) { let n = parseInt(v, 10); if (!isFinite(n)) n = d; return Math.min(hi, Math.max(lo, n)); }
function _numv(v, d, lo, hi) { let n = parseFloat(v); if (!isFinite(n)) n = d; return Math.min(hi, Math.max(lo, n)); }

/* 归一化 + 越界保护（maxBars/maxAmp=0 表示不限制上限） */
function normCfg(o) {
  o = o || {};
  const c = {
    minBars: _intv(o.minBars, CFG_DEFAULT.minBars, 2, 2000),
    maxBars: _intv(o.maxBars, CFG_DEFAULT.maxBars, 0, 100000),
    minAmp: _numv(o.minAmp, CFG_DEFAULT.minAmp, 0.05, 90),
    maxAmp: _numv(o.maxAmp, CFG_DEFAULT.maxAmp, 0, 99),
    macdFast: _intv(o.macdFast, CFG_DEFAULT.macdFast, 2, 200),
    macdSlow: _intv(o.macdSlow, CFG_DEFAULT.macdSlow, 3, 500),
    macdDea: _intv(o.macdDea, CFG_DEFAULT.macdDea, 2, 500),
    mode: (o.mode === 'atr') ? 'atr' : 'pct',      // 兼容旧配置字段(2026-10-28g 起不参与计算)
    updatedAt: +o.updatedAt || 0
  };
  if (c.macdSlow <= c.macdFast) c.macdSlow = c.macdFast + 1;
  if (c.maxBars > 0 && c.maxBars < c.minBars) c.maxBars = c.minBars;
  if (c.maxAmp > 0 && c.maxAmp < c.minAmp) c.maxAmp = c.minAmp;
  return c;
}

function saveConfigFile(cfg) {
  const tmp = CFG_PATH + '.tmp';
  const out = Object.assign({}, cfg, { updatedAt: Date.now() });
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
  fs.renameSync(tmp, CFG_PATH);                       // 原子替换
  _cfgCache = { mtimeMs: fs.statSync(CFG_PATH).mtimeMs, cfg: normCfg(out) };
}

/* 读配置：按文件 mtime 热重载；文件不存在 → 落盘默认值（让 json 真实可见可改） */
function getConfig() {
  try {
    const st = fs.statSync(CFG_PATH);
    if (_cfgCache.cfg && st.mtimeMs === _cfgCache.mtimeMs) return _cfgCache.cfg;
    const j = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    _cfgCache = { mtimeMs: st.mtimeMs, cfg: normCfg(j) };
  } catch (e) {
    if (!_cfgCache.cfg) {
      _cfgCache = { mtimeMs: 0, cfg: normCfg(CFG_DEFAULT) };
      try { saveConfigFile(_cfgCache.cfg); } catch (e2) { }
    }
  }
  return _cfgCache.cfg;
}

/* 保存配置（undefined/null/空串 字段自动忽略, 只改传入的项）→ 原子落盘 + 清缓存 */
function saveConfig(patch) {
  patch = patch || {};
  const cur = getConfig();
  const p = {};
  ['minBars', 'maxBars', 'minAmp', 'maxAmp', 'macdFast', 'macdSlow', 'macdDea'].forEach(function (k) {
    if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') p[k] = patch[k];
  });
  const next = normCfg(Object.assign({}, cur, p));
  saveConfigFile(next);
  CACHE.clear();                                      // 全站缓存失效 → 下次取数即新条件
  console.log('[chan] 配置已保存:', JSON.stringify({ minBars: next.minBars, maxBars: next.maxBars, minAmp: next.minAmp, maxAmp: next.maxAmp, macd: next.macdFast + '/' + next.macdSlow + '/' + next.macdDea }));
  return next;
}

/* ---------------- ① 纯算法：MACD 分区极值识别 + 缠论连续划线（2026-10-28g 第七版） ----------------
 * candles: 升序 [{ts,o,h,l,c,v}]
 * 返回: { pts:[{i,type:'B'|'T',px,brk}], openLeg }
 *
 * ★识别方式（用户 2026-10-28g 指定）："自动识别最高点和最低点，在 MACD DIFF/DEA
 *   >0/<0 范围内操作，参数 12 26 60，这样准确点" ——
 *   ① DIFF = EMA(close,fast) − EMA(close,slow)，DEA = EMA(DIFF,dea)；
 *      DIFF>DEA = 多头区 / DIFF<DEA = 空头区，行情被切成交替分区；
 *   ② 每个多头分区取【区间最高价】= 顶(卖)，每个空头分区取【区间最低价】= 底(买)
 *      —— 顶/底天然交替；已收盘分区 = 确认转折点，最后进行中分区 = 开放段(虚线)；
 *   ③ 缠论连线：相邻转折点全部首尾相连（像 DIFF/DEA 一样连续直线段, 生生不息）：
 *      满足双区间(间隔∈[minBars,maxBars] 且 |段幅|∈[minAmp,maxAmp]) → 红/绿实线信号段；
 *      不满足 → brk 虚线过渡段（线永不断, 如实区分信号/过渡）。
 *   —— 不变量：折线连续覆盖全部转折点；红/绿实线段 100% 满足双区间。 */
function detect(candles, opt) {
  opt = opt || {};
  const minBars = Math.max(2, (opt.minBars | 0) || 10);
  const maxBars = (opt.maxBars | 0) || 0;             // 0 = 不限上限
  const minAmp = Math.max(0.05, +opt.minAmp || 1);
  const maxAmp = +opt.maxAmp || 0;                    // 0 = 不限上限
  let fast = Math.max(2, (opt.macdFast | 0) || 12);
  let slow = Math.max(3, (opt.macdSlow | 0) || 26);
  if (slow <= fast) slow = fast + 1;
  const deaP = Math.max(2, (opt.macdDea | 0) || 60);
  const n = candles.length;
  if (n < slow + deaP + 5) return { pts: [], openLeg: null };

  /* ① MACD 序列（标准 EMA 递推, 只用已收盘K线, 无未来函数） */
  const kF = 2 / (fast + 1), kS = 2 / (slow + 1), kD = 2 / (deaP + 1);
  let eF = candles[0].c, eS = candles[0].c, eD = 0;
  const sign = new Int8Array(n);                      // +1 多头区 / -1 空头区
  for (let i = 0; i < n; i++) {
    const c = candles[i].c;
    eF = c * kF + eF * (1 - kF);
    eS = c * kS + eS * (1 - kS);
    const diff = eF - eS;
    eD = i === 0 ? diff : diff * kD + eD * (1 - kD);
    sign[i] = diff > eD ? 1 : (diff < eD ? -1 : (i > 0 ? sign[i - 1] : 1));
  }

  /* ② 分区扫描: 连续同号 = 一个分区; 多头区取区间最高价=顶 / 空头区取区间最低价=底。
   *    最后一个分区仍在进行中 → 不确认为转折点, 留作开放段(虚线, 端点可顺延)。 */
  const pivots = [];
  let zSign = sign[0], zExtI = 0, zExtP = sign[0] > 0 ? candles[0].h : candles[0].l;
  for (let i = 1; i < n; i++) {
    if (sign[i] !== zSign && sign[i] !== 0) {
      pivots.push({ i: zExtI, type: zSign > 0 ? 'T' : 'B', px: zExtP });   // 上一分区收盘 → 确认转折点
      zSign = sign[i];
      zExtI = i; zExtP = zSign > 0 ? candles[i].h : candles[i].l;
    } else if (zSign > 0) {
      if (candles[i].h > zExtP) { zExtP = candles[i].h; zExtI = i; }
    } else {
      if (candles[i].l < zExtP) { zExtP = candles[i].l; zExtI = i; }
    }
  }

  /* ③ 相邻转折点连线段评估: 合格 → 红/绿实线信号段; 不合格 → brk 虚线过渡段 */
  function segFail(a, b) {
    const dist = b.i - a.i;
    if (dist < minBars) return true;
    if (maxBars && dist > maxBars) return true;
    const amp = Math.abs(b.px / a.px - 1) * 100;
    return amp < minAmp || (!!maxAmp && amp > maxAmp);
  }
  const pts = [];
  for (let k = 0; k < pivots.length; k++) {
    pts.push({
      i: pivots[k].i, type: pivots[k].type, px: pivots[k].px,
      brk: k > 0 ? segFail(pivots[k - 1], pivots[k]) : false
    });
  }

  /* ④ 开放段(未确认): 最后确认点 → 进行中分区的极值(虚线展示, 不参与信号过滤) */
  let openLeg = null;
  if (pts.length && zExtI > pts[pts.length - 1].i) {
    const last = pts[pts.length - 1];
    openLeg = {
      fromTs: candles[last.i].ts, fromPx: last.px, fromType: last.type,
      toTs: candles[zExtI].ts, toPx: zExtP,
      toType: last.type === 'B' ? 'T' : 'B',
      bars: zExtI - last.i,
      amp: +((zExtP / last.px - 1) * 100).toFixed(2)
    };
  }
  return { pts: pts, openLeg: openLeg };
}

/* ---------------- ② 数据装载 ---------------- */
function loadCandles(grain, sinceTs) {
  const files = [];
  try { for (const db of KS.openAllRO(grain, 'BTC-USDT-SWAP')) files.push(db); } catch (e) { }
  const m = new Map();
  for (const db of files) {
    let rows = null;
    try { rows = db.prepare('SELECT ts,o,h,l,c,v FROM kline WHERE ts>=? ORDER BY ts ASC').all(sinceTs || 0); } catch (e) { }
    if (!rows) continue;
    for (const r of rows) {
      if (!isFinite(r.ts) || !isFinite(r.c) || r.c <= 0) continue;
      m.set(r.ts, { ts: r.ts, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v });
    }
  }
  const arr = Array.from(m.values());
  m.clear();
  arr.sort((a, b) => a.ts - b.ts);
  return arr;
}

/* ★2026-11-07 用户要求彻底删除美股全线 → loadCandlesUS 已移除，只保留 OKX 装载器 */
function loadCandlesFor(o, sinceTs) {
  return loadCandles(o.grain, sinceTs);
}

/* ---------------- ③ 分析主入口（回测+K线共用同一份输出） ---------------- */
const CACHE = new Map();                      // key → {at, data, pts, candles}
const CACHE_TTL = 120000;

function clampOpt(opt) {
  opt = opt || {};
  const source = 'okx';   // ★2026-11-07 用户要求彻底删除美股全线 → 只保留 OKX 数据源
  const grain = GRANS.indexOf(opt.grain) >= 0 ? opt.grain : '1h';   // ★2026-11-07 兜底改 1h（GRANS 已无 5m/15m）
  const days = Math.min(760, Math.max(30, parseInt(opt.days, 10) || 730));
  const instId = opt.instId || 'BTC-USDT-SWAP';
  return { source: source, grain: grain, days: days, instId: instId };
}

function ratioOf(a) {
  if (!a || !a.n) return null;
  return +(a.up / a.n * 100).toFixed(2);
}

async function analyze(opt) {
  const o = clampOpt(opt);
  const cfg = getConfig();                    // ★热插拔: 每次计算前读最新划线条件
  const key = o.source + '|' + o.instId + '|' + o.grain + '|' + o.days + '|' + cfg.minBars + '|' + cfg.maxBars + '|' + cfg.minAmp + '|' + cfg.maxAmp + '|' + cfg.macdFast + '|' + cfg.macdSlow + '|' + cfg.macdDea;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

  const sinceTs = Date.now() - o.days * 86400000;
  const candles = loadCandlesFor(o, sinceTs);
  if (candles.length < cfg.minBars + 10) {
    return { ok: false, err: 'K线不足(' + candles.length + '根), 无法划线', grain: o.grain };
  }
  /* ★2026-11-03 涨跌家数已删除 → agg 恒为空 Map（纯划线, 不含家数派生字段） */
  const agg = new Map();

  const t0 = Date.now();
  const det = detect(candles, cfg);
  const pts = det.pts;

  /* 逐转折点统计（★2026-11-03 涨跌家数/买卖语义已删除, 只保留纯划线字段） */
  const signals = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const cd = candles[p.i];
    const sig = {
      idx: k,
      ts: cd.ts,
      type: p.type,                               // 'B'=底 / 'T'=顶（纯转折点, 无买卖语义）
      px: +p.px.toFixed(2),                       // 转折极值价(画线端点)
      close: +cd.c.toFixed(2),                    // 该根收盘
      segBars: 0, segAmp: null,
      segBrk: !!p.brk,                              // ★与前一转折点之间断链(无合格连线)
      nextAmp: null, nextRetC: null
    };
    if (k > 0) {
      const q = pts[k - 1];
      sig.segBars = p.i - q.i;
      /* ★段涨跌幅(带符号, 按段起点计): 底→顶为正(涨), 顶→底为负(跌) */
      sig.segAmp = +((p.px / q.px - 1) * 100).toFixed(2);
    }
    signals.push(sig);
  }
  /* nextAmp / nextRetC（到下一个相反信号） */
  for (let k = 0; k + 1 < signals.length; k++) {
    const cur = signals[k], nx = signals[k + 1];
    cur.nextAmp = nx.segAmp;
    cur.nextRetC = +((nx.close / cur.close - 1) * 100).toFixed(2);
  }

  /* 汇总（★2026-11-03 去除买卖/家数派生统计） */
  let nB = 0, nT = 0, sb = 0, sa = 0, sn = 0, nBrk = 0;
  let nSeg = 0;
  for (const sg of signals) {
    if (sg.type === 'B') nB++; else nT++;
    if (sg.segBrk) { nBrk++; continue; }            // 断链段不计入均段统计
    if (sg.segBars > 0) { sb += sg.segBars; nSeg++; }
    if (sg.segAmp !== null) { sa += Math.abs(sg.segAmp); sn++; }
  }
  const data = {
    ok: true,
    grain: o.grain, label: GRAN_LABEL[o.grain] || o.grain,
    cfg: { minBars: cfg.minBars, maxBars: cfg.maxBars, minAmp: cfg.minAmp, maxAmp: cfg.maxAmp, macdFast: cfg.macdFast, macdSlow: cfg.macdSlow, macdDea: cfg.macdDea, updatedAt: cfg.updatedAt },
    days: o.days,
    candles: candles.length,
    from: candles.length ? candles[0].ts : 0,
    to: candles.length ? candles[candles.length - 1].ts : 0,
    computeMs: Date.now() - t0,
    signals: signals,                            // 升序(最早→最新)
    openLeg: det.openLeg,                        // 进行中未确认段(虚线)
    stats: {
      total: signals.length, bottom: nB, top: nT, brk: nBrk,
      avgSegBars: nSeg ? +(sb / nSeg).toFixed(1) : 0,
      avgSegAmp: sn ? +(sa / sn).toFixed(2) : 0
    },
    at: Date.now()
  };
  CACHE.set(key, { at: Date.now(), data: data, pts: pts, candles: candles });
  if (CACHE.size > 24) {
    const oldest = CACHE.keys().next().value;
    const old = CACHE.get(oldest);
    if (old) old.candles = null;                  // 释放大数组引用
    CACHE.delete(oldest);
  }
  return data;
}

/* ---------------- ④ 单段逐根比例序列(seq) —— ★2026-11-03 已删除 ---------------
 *   原用途: 返回「转折点之前那条连线区间」的逐根K线 + 逐根涨跌家数比例。
 *   涨跌家数整体删除后该接口无意义 → 一并移除。 */

module.exports = { detect, analyze, loadCandles, getConfig, saveConfig, normCfg, GRANS, GM, GRAN_LABEL };
