/* ============================================================================
 * modules/okx/engines/updown.js —— ★全市场涨跌家数统计引擎（2026-10-26）
 * ----------------------------------------------------------------------------
 * 用户需求："首页播报下面 画图 画表格 要求详细时间 要求总共三个月 每15分钟计算
 *           OKX 合约 200 多合约 上涨多少家/下跌多少家 比例 差额
 *           根据这些 和主力合约涨幅 15分钟内涨幅 进行比较 画曲线 画表格"
 *
 * ★数据源：本地 15m K 线库（data/okx/kline/*_15m.sqlite）
 *   - 三个月 15m = 90 天 × 96 根/天 = 8640 根/合约
 *   - 需先回填（backfill.runBatch kind=kline grain=15m days=90）
 *   - 未回填前只有最近几十根 → 面板显示"覆盖范围"并持续积累
 *
 * ★口径：
 *   - 每个 15m 时间片统计：up=收盘>前一根收盘 的合约数；down=……；total=有数据的合约数
 *   - upRatio = up/total（上涨比例）；diff = up - down（差额）
 *   - 主力合约(sym，默认 BTC)：该15m的涨幅 pct（相对前一根收盘）
 *   - 返回按时间升序的 bars 序列
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const I = require('./universe');
const KS = require('./kstore');   // ★2026-10-27 月分片存储唯一入口({bar}/{inst}/{ym}.sqlite)

/* ★月分片: 从最新片往旧凑"最近 bars+1 根"(beforeTs 限定历史窗口), 升序返回。
 *   每片都带 WHERE ts<=beforeTs(旧片无副作用, 新片正确截断); 跨片按 ts 去重。 */
function tailCandles(instId, grain, bars, beforeTs, cols) {
  const chain = KS.readChain(grain, instId, beforeTs || 0, bars + 1);
  let out = [];
  for (const f of chain) {                    // chain 从新到旧
    const db = KS.roOpen(f);
    if (!db) continue;
    try {
      const part = beforeTs
        ? db.prepare('SELECT ' + cols + ' FROM kline WHERE ts <= ? ORDER BY ts DESC LIMIT ?').all(beforeTs, bars + 1)
        : db.prepare('SELECT ' + cols + ' FROM kline ORDER BY ts DESC LIMIT ?').all(bars + 1);
      out = out.concat(part);
    } catch (e) { }
    if (out.length >= bars + 1) break;
  }
  if (!out.length) return [];
  out.sort((a, b) => a.ts - b.ts);
  if (chain.length > 1) {
    const seen = new Set();
    out = out.filter(r => (seen.has(r.ts) ? false : (seen.add(r.ts), true)));
  }
  if (out.length > bars + 1) out = out.slice(out.length - (bars + 1));
  return out;
}

/* 分时周期毫秒数（进行中片的 liveTs 对齐用） */
const GRAIN_MS = {
  '3m': 180000, '5m': 300000, '15m': 900000,
  '1h': 3600000, '2h': 7200000, '4h': 14400000,
  '1H': 3600000, '1D': 86400000
};

/* ---------------- 只读连接池已收敛到 kstore.js（月分片版共用 LRU） ---------------- */

/* ---------------- 缓存（读全部库重，必须缓存） ----------------
 * ★2026-10-26: 最近几根(实时)用小 TTL，历史大窗口用长 TTL
 *   → 前端"最新15分钟"高频 AJAX 取实时值，老数据走长缓存不重复算 */
const CACHE = new Map();

async function updown(opt) {
  opt = opt || {};
  const sector = opt.sector || '';
  const grain = opt.grain || '15m';
  const maxBars = 20000;   // ★两年(1h=17520根/2h=8760/4h=4380) 需要更大的窗口
  const bars = Math.max(1, Math.min(maxBars, parseInt(opt.bars, 10) || 9000));
  /* ★按请求窗口决定缓存时长：窗口小=要实时 → 短缓存 */
  const tiny = bars <= 60;
  const CACHE_TTL = tiny ? 5000 : 30000;
  const beforeTs = parseInt(opt.beforeTs, 10) || 0;
  const lead = (opt.lead || 'BTC').toUpperCase();
  const cacheKey = [sector, grain, bars, beforeTs, lead].join('|');
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
  const data = await calc(sector, grain, bars, beforeTs, lead);
  const out = Object.assign({ ok: true, at: Date.now(), cached: !!hit && Date.now() - hit.at < CACHE_TTL * 2 }, data);
  CACHE.set(cacheKey, { at: Date.now(), data: out });
  return out;
}

async function calc(sector, grain, bars, beforeTs, lead) {
  const u = await I.universe();
  if (!u.ok) return { ok: false, err: 'universe 未就绪', bars: [] };
  let list = u.list;
  if (sector && sector !== 'all') list = list.filter(x => x.sector === sector);
  if (!list.length) return { ok: false, err: '板块无标的', bars: [] };

  const agg = new Map();          // ts -> {ts,up,down,flat,n}
  const leadInst = list.find(x => x.sym === lead) || null;   // ★主力合约(默认BTC)
  let leadCandles = null;        // 主力合约全量 OHLCV（画K线，K线在bars对应历史内）
  let cov = 0;
  const lastClose = new Map();    // ★instId → 库尾最后一根 {ts,c}（WS 进行中片聚合的"前收"基准）

  /* ★2026-10-26 预计算库优先：历史直接读表（毫秒级），不再每次扫描 287 个 K 线库。
   *   启用条件: 全市场(无板块筛选) + 主力BTC + 不翻历史(beforeTs=0) —— 即默认场景；
   *   其余组合（板块/其它主力/翻历史）仍走实时扫描，结果一致。 */
  let pre = null;
  try {
    const ST = require('./updownstore');
    if (!sector && (!lead || String(lead).toUpperCase() === 'BTC') && !beforeTs) pre = ST.agg(grain);
  } catch (e) { pre = null; }

  if (pre && pre.size) {
    for (const a of pre.values()) agg.set(a.ts, a);
    cov = list.length;
    for (const x of list) {
      const chain = KS.readChain(grain, x.instId, 0, 1);   // 只要最新片(+legacy 兜底)
      if (!chain.length) continue;
      const db = KS.roOpen(chain[0]);
      if (!db) continue;
      try {
        const r = db.prepare('SELECT ts,c FROM kline ORDER BY ts DESC LIMIT 1').get();
        if (r) lastClose.set(x.instId, { ts: r.ts, c: r.c });
      } catch (e) { }
      if (leadInst && x.instId === leadInst.instId && !leadCandles) {
        const full = tailCandles(x.instId, grain, bars, 0, 'ts,o,h,l,c,v');
        if (full && full.length >= 2) leadCandles = full;
      }
    }
  } else {
  for (const x of list) {
    const rows = tailCandles(x.instId, grain, bars, beforeTs, 'ts,c');
    if (!rows || rows.length < 2) continue;
    cov++;
    /* ★记录每合约库尾（WS 进行中片聚合的前收基准） */
    lastClose.set(x.instId, { ts: rows[rows.length - 1].ts, c: rows[rows.length - 1].c });
    /* ★主力合约额外取完整 OHLCV（画K线用），与涨跌家数同轴 */
    if (leadInst && x.instId === leadInst.instId && !leadCandles) {
      const full = tailCandles(x.instId, grain, bars, beforeTs, 'ts,o,h,l,c,v');
      if (full && full.length >= 2) leadCandles = full;
    }
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].c, cur = rows[i].c;
      if (!isFinite(prev) || !isFinite(cur) || prev <= 0) continue;
      const pct = (cur - prev) / prev;
      const ts = rows[i].ts;
      let a = agg.get(ts);
      if (!a) { a = { ts, up: 0, down: 0, flat: 0, n: 0 }; agg.set(ts, a); }
      a.n++;
      /* ★2026-10-26 用户口径：不涨不跌(平盘)也算跌 → 只有 pct>0 才算涨
       *   flat 仍单独计数（备查），但 down 已包含平盘，保证 up + down = total */
      if (pct > 0) a.up++; else { a.down++; if (pct === 0) a.flat++; }
      /* ★该时间片跌得最狠的合约 → 表格「最低价 / 最低价跌幅」两列 */
      if (!a.worst || pct < a.worst.pct) a.worst = { inst: x.instId, px: cur, pct: pct };
    }
  }
  }

  let arr = Array.from(agg.values()).sort((a, b) => a.ts - b.ts).slice(-bars);

  /* ★2026-10-26 尾部碎片剔除（用户实测: bars 尾部出现 total=9/287 的碎片片,
   *   统计噪音极大 → 顶部统计条显示 4涨/5跌/44% 与表格(287全覆盖)对不上,
   *   且会误触发买卖信号"连跌≥50%"）
   *   原因: 回填推进中, 只有少数合约的库更新到最新时间片 → 该片只聚合到 9 个合约。
   *   修法: 以全序列 P90 覆盖数为基准, 从尾部连续剔除 total < P60 的片（遇达标片即停,
   *   不动历史中间段——历史覆盖只与当时上市数有关, 是真实口径） */
  if (arr.length >= 10) {
    /* 注意: 此处 arr 元素是原始聚合对象(字段 n), out 映射后才有 total */
    const cnt = b => (b.n !== undefined && b.n !== null) ? b.n : (b.total || 0);
    const sorted = arr.map(cnt).sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
    const minN = Math.max(2, Math.ceil(p90 * 0.6));
    let cut = arr.length;
    while (cut > 0 && cnt(arr[cut - 1]) < minN) cut--;
    if (cut < arr.length) arr = arr.slice(0, cut);
  }

  /* ★2026-10-26 最新一根用 WS 实时价计算（用户: "最新的数据是ws 计算的这样就行"）
   *   双源兜底: okxws(核心订阅/页面活跃时全量) → wsfeed(250 tickers 常驻)。
   *   okxws 空闲断开时 wsfeed 仍在线 → 进行中片/补根不失效。 */
  try {
    const WS = require('./okxws');
    let WSF = null;
    try { WSF = require('./wsfeed'); } catch (e) { }
    let wsfMap = null, wsfAt = 0;
    const livePx = function (id) {
      const t = WS.snap(id);
      if (t && isFinite(t.px) && t.px > 0) return t.px;
      if (WSF && typeof WSF.snapshot === 'function') {
        if (!wsfMap || Date.now() - wsfAt > 30000) {
          wsfMap = {}; wsfAt = Date.now();
          try {
            const s = WSF.snapshot();
            (s.list || []).forEach(x => {
              const v = +x.last;
              if (x.instId && isFinite(v) && v > 0) wsfMap[x.instId] = v;
            });
          } catch (e) { }
        }
        return wsfMap[id] || null;
      }
      return null;
    };
    const GM = GRAIN_MS[grain] || 900000;
    const liveTs = Math.floor(Date.now() / GM) * GM;
    const lastTs = arr.length ? arr[arr.length - 1].ts : 0;
    const isLive = (WS.isStarted && WS.isStarted()) || (WSF && typeof WSF.snapshot === 'function');
    /* ★liveTs >= lastTs 即执行: 保鲜拉取跨片边界时部分合约库内已有 liveTs
     *   进行中根(快照) → WS 现价更实时, 达标时覆盖; BTC 等库尾落后的合约则补根 */
    if (isLive && lastTs && liveTs >= lastTs) {
      const a = { ts: liveTs, up: 0, down: 0, flat: 0, n: 0 };
      for (const x of list) {
        const px = livePx(x.instId);
        const lc = lastClose.get(x.instId);
        if (!px || !lc || !isFinite(lc.c) || lc.c <= 0) continue;
        const p = (px - lc.c) / lc.c;
        a.n++;
        /* ★同上口径(实时WS片)：平盘算跌 */
        if (p > 0) a.up++; else { a.down++; if (p === 0) a.flat++; }
        if (!a.worst || p < a.worst.pct) a.worst = { inst: x.instId, px: px, pct: p };
      }
      /* 覆盖≥30% 合约才纳入（WS 快照刚启动时避免残缺统计） */
      if (a.n >= Math.max(2, Math.floor(list.length * 0.3))) {
        arr = arr.filter(b => b.ts !== liveTs);       // 库内快照片 → WS 现价片覆盖
        arr.push(a);
      }
      /* 主力K线补「形成中」一根: 开=库尾收盘, 高低收=WS现价
       *   ★断层≤3根也补(保持末根=末片同轴优先; 视觉按序画无空洞感), 断更多等保鲜 */
      if (leadInst && leadCandles && leadCandles.length) {
        const lc = lastClose.get(leadInst.instId);
        const px = livePx(leadInst.instId);
        if (lc && px && liveTs > lc.ts && liveTs - lc.ts <= GM * 3) {
          leadCandles.push({ ts: liveTs, o: lc.c, h: Math.max(lc.c, px), l: Math.min(lc.c, px), c: px, v: 0 });
        }
      }
    }
  } catch (e) { }

  // 主力涨幅序列（由 leadCandles 相邻收盘计算，与K线共用同一序列 → K线与pct严格对齐）
  const leadMap = new Map();
  if (leadCandles && leadCandles.length >= 2) {
    for (let i = 1; i < leadCandles.length; i++) {
      const prev = leadCandles[i - 1].c, cur = leadCandles[i].c;
      if (isFinite(prev) && isFinite(cur) && prev > 0) leadMap.set(leadCandles[i].ts, (cur - prev) / prev * 100);
    }
  }

  const out = arr.map(b => {
    const ratio = b.n ? b.up / b.n : 0;
    const lp = leadMap.get(b.ts);
    /* ★『主力×差额 共振强度指数』（2026-10-26，用户要求精确到 2 位小数）
     *   方向 = 主力涨跌(±)，强度 = 涨跌家数差额 × 主力涨跌幅(小数)
     *   → 主力大涨(正)同时市场普遍上涨(diff正) → 强正；主力跌但市场涨 → 背离(负) */
    const diff = b.up - b.down;
    const total = Math.max(1, b.n || 1);
    let idx = null;
    if (lp !== null && lp !== undefined && isFinite(lp)) {
      idx = +( (lp / 100) * (diff / total) * 100 ).toFixed(2);
    }
    return {
      ts: b.ts, up: b.up, down: b.down, flat: b.flat, total: b.n,
      /* ★最低价 / 最低价跌幅（该时间片跌得最狠的合约） */
      lowPx: b.worst ? b.worst.px : null,
      lowPct: b.worst ? +(b.worst.pct * 100).toFixed(2) : null,
      lowInst: b.worst ? b.worst.inst : null,
      upRatio: +((ratio * 100).toFixed(2)), diff: diff,
      leadPct: (lp === null || lp === undefined) ? null : +lp.toFixed(2),
      idx: idx                       // ★主力×差额 共振强度指数
    };
  });

  // 统计：上涨比例 vs 主力涨幅 相关性
  const valid = out.filter(b => b.leadPct !== null && isFinite(b.upRatio));
  let r = 0, agree = 0;
  if (valid.length >= 4) {
    const n = valid.length;
    const mx = valid.reduce((s, b) => s + b.upRatio, 0) / n;
    const my = valid.reduce((s, b) => s + b.leadPct, 0) / n;
    let sxy = 0, sxx = 0, syy = 0, same = 0;
    for (const b of valid) {
      const dx = b.upRatio - mx, dy = b.leadPct - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
      if ((b.upRatio > 50) === (b.leadPct > 0)) same++;
    }
    if (sxx > 0 && syy > 0) r = +(sxy / Math.sqrt(sxx * syy)).toFixed(4);
    agree = +(same / n * 100).toFixed(1);
  }

  /* ★2026-10-26 统计条与表格/K线严格同轴（用户实测: 统计条取 bars 末根,
   *   而 bars 末根可能是其它合约超前的片 → 与表格首行(leadCandles 主轴)数字不一致）
   *   修法: lastUp/lastDown/lastRatio/lastDiff/lastLead/lastIdx 一律取
   *   「leadCandles 最后一根 ts 对应的片」，与详细表格第一行、K线悬浮完全同源 */
  const cdLastTs = (leadCandles && leadCandles.length) ? leadCandles[leadCandles.length - 1].ts : 0;
  let last = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].ts === cdLastTs) { last = out[i]; break; }
  }
  if (!last) last = out[out.length - 1] || {};     // 兜底: BTC 缺该片时退回 bars 末根
  let prevBar = null;
  if (last) {
    const li = out.indexOf(last);
    prevBar = li > 0 ? out[li - 1] : {};
  } else prevBar = {};
  return {
    ok: true, grain, sector, lead,
    count: list.length, covCount: cov,
    bars: out,
    /* ★主力合约 K线全量（OHLCV），供前端叠加到BTC K线图 */
    leadCandles: (leadCandles || []).map(r => ({
      ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v
    })),
    oldest: out.length ? out[0].ts : 0, newest: out.length ? out[out.length - 1].ts : 0,
    spanDays: out.length ? +(((out[out.length - 1].ts - out[0].ts) / 86400000).toFixed(1)) : 0,
    leadName: (leadCandles && leadCandles.length) ? lead : '',
    stats: {
      lastUp: last.up, lastDown: last.down, lastTotal: last.total,
      lastRatio: last.upRatio, lastDiff: last.diff, lastLead: last.leadPct,
      lastIdx: last.idx,                     // ★最新主力×差额 共振强度指数
      lastClose: (leadCandles && leadCandles.length) ? leadCandles[leadCandles.length - 1].c : null,
      prevRatio: prevBar.upRatio,
      corr: r, agree
    }
  };
}

module.exports = { updown };