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
 *   → 前端"最新15分钟"高频 AJAX 取实时值，老数据走长缓存不重复算
 * ★2026-10-28 两级结构：① 计算缓存(只认「数据窗口」) ② 请求级分页裁剪
 *   上一版把 page 写进 cacheKey → 每一页都各存一份「全量结果」, 翻 100 页
 *   就是 100 份副本(每份约 0.5MB) —— 既吃内存又毫无收益。
 *   现在: key = sector|grain|bars|beforeTs|lead(不含分页), 取出来再按 page 裁
 *         → 翻页零重算、零冗余副本, 且绝不可能串页(裁剪发生在缓存之后)。
 *   另: CACHE 加 LRU 条数上限 —— 1.9G 内存的小机器不能任由 Map 膨胀。 */
const CACHE = new Map();
const CACHE_MAX = 16;                  // ★最多缓存 16 个窗口, 超出按「最近使用」淘汰最老的
function cachePut(k, v) {
  if (CACHE.has(k)) CACHE.delete(k);   // 先删再插 → 排到队尾(=最近使用)
  CACHE.set(k, v);
  if (CACHE.size > CACHE_MAX) {
    for (const kk of Array.from(CACHE.keys())) {
      if (CACHE.size <= CACHE_MAX) break;
      const vv = CACHE.get(kk);
      if (vv && vv.refreshing) continue;   // 正在后台刷新的不删(删了 SWR 写入会重建旧对象)
      CACHE.delete(kk);
    }
  }
  /* 兜底: 全是刷新中 → 强制淘汰最陈旧的那个 */
  if (CACHE.size > CACHE_MAX) {
    let oldest = null;
    for (const e of CACHE) if (!oldest || e[1].at < oldest[1].at) oldest = e;
    if (oldest) CACHE.delete(oldest[0]);
  }
}
function cacheTouch(k) {               // LRU: 命中后提到队尾
  const v = CACHE.get(k);
  if (!v) return null;
  CACHE.delete(k); CACHE.set(k, v);
  return v;
}

/* ★2026-10-28 Redis 共享缓存(可选): Redis 不可用时 RC 为 null, 全走进程内缓存 */
let RC = null;
try { RC = require('./rediscache'); } catch (e) { RC = null; }
/* Redis 单 key 上限保护: 128MB 内存里不能塞进超大对象(3m bars=18000 约 4.3MB) */
const RC_MAX_BARS = 3000;

/* ★2026-10-28 「各合约库尾最后一根」缓存（WS 实时前收基准）
 *   原实现每次 calc 都要遍历 287 个 K线库取最后一根 —— 实测 ~450ms 的同步磁盘 IO,
 *   而每 30s 缓存过期就要重算 → 主线程被反复卡住, 表现为「每页都要等 0.5 秒」。
 *   它只在该周期「收线」时才会变化 → TTL 取「半个周期」天然安全(上限 60s)。 */
const LC_CACHE = new Map();        // grain → {at, map}
function fillLastClose(grain, list, lastClose) {
  const ms = GRAIN_MS[grain] || 900000;
  const ttl = Math.min(60000, Math.max(5000, Math.floor(ms / 2)));
  const hit = LC_CACHE.get(grain);
  if (hit && Date.now() - hit.at < ttl) {
    for (const kv of hit.map) lastClose.set(kv[0], kv[1]);
    return;
  }
  const map = new Map();
  for (const x of list) {
    const chain = KS.readChain(grain, x.instId, 0, 1);   // 只要最新片(+legacy 兜底)
    if (!chain.length) continue;
    const db = KS.roOpen(chain[0]);
    if (!db) continue;
    try {
      const r = db.prepare('SELECT ts,c FROM kline ORDER BY ts DESC LIMIT 1').get();
      if (r) map.set(x.instId, { ts: r.ts, c: r.c });
    } catch (e) { }
  }
  LC_CACHE.set(grain, { at: Date.now(), map: map });
  for (const kv of map) lastClose.set(kv[0], kv[1]);
}

/* ★2026-10-28 愈合「刚收线」碎片片(WS 实时价重算 up/down + 合成 BTC 蜡烛)。
 *   根因: build() 收线后首次重建时该片 K线常未全量落库(仅 41/179/206 等部分合约),
 *   且 BTC 自身 K线在该 ts 也常缺失 → 预聚合库存了「样本偏低 / 缺 BTC 蜡烛 / 最高最低收盘错位」脏片,
 *   顶行下方出现错行。此处用「K线真实收盘(有则用) + WS 实时价(缺则补)」把紧邻实时片之前的
 *   1~2 个碎片片重算成满覆盖, 并合成其 BTC 蜡烛, 与实时片同源。仅当覆盖健康时才覆盖原值。 */
function healRecentWS(grain, list, arr, leadCandles, livePx, GM) {
  if (!arr.length || !leadCandles || typeof livePx !== 'function') return;
  const MINCOV = Math.floor(list.length * 0.4);
  const FULL = Math.floor(list.length * 0.9);     // ≥90% 视为满覆盖, 不必再愈合
  /* ★愈合窗口: 仅最近 12 个周期内的碎片片才重算(3m→36min, 5m→60min)。
   *   缘起: 3m 刚收线片在 build 时 K线未全量落库, 被存成 41/206 等碎片; 下一次 build 重聚合
   *   时若该片 K线已补齐则自愈, 但补齐前(24~27 分钟内)仍显示成错行 → 此处即时愈合。
   *   超出 12 周期的历史碎片(多为真实低覆盖/已下架合约)不重算, 保持原值, 避免 WS 现价污染旧片。 */
  const WIN = GM * 12;
  const now = Date.now();
  let healed = 0, scanned = 0;
  /* 从末尾往回扫: 跳过「进行中实时片(由 a 覆盖)」与已健康片, 愈合紧邻实时片之前的
   * 若干「刚收线」碎片片(覆盖偏低 → 用 WS 现价补缺失收盘 + K线前收基准重算 up/down)。
   * ★不 break 健康片: 已健康片用 continue 跳过, 才能抵达其前方仍残缺的片(如 5m 04:40满→04:30/04:25残)。 */
  for (let k = arr.length - 1; k >= 0 && healed < 8 && scanned < 30; k--) {
    scanned++;
    const b = arr[k];
    if (b.ts >= now - GM) continue;               // 当前进行中片 → 由实时片 a 负责, 跳过
    if (b.ts < now - WIN) break;                   // 超出愈合窗口, 不再愈合(边界)
    if (b.n >= FULL) continue;                     // 已接近满覆盖 → 跳过(不阻断前方残缺片)
    const baseTs = b.ts - GM;
    let up = 0, down = 0, flat = 0, n = 0, worst = null;
    for (const x of list) {
      let c = null;
      try { const ch = KS.readChain(grain, x.instId, 0, 1); if (ch.length) { const db = KS.roOpen(ch[0]); if (db) { const r = db.prepare('SELECT c FROM kline WHERE ts=?').get(b.ts); if (r && isFinite(r.c) && r.c > 0) c = r.c; } } } catch (e) { }
      if (c == null) c = livePx(x.instId);                   // 缺 K线真实收盘 → 用 WS 现价补
      let base = null;
      try { const ch = KS.readChain(grain, x.instId, 0, 1); if (ch.length) { const db = KS.roOpen(ch[0]); if (db) { const r = db.prepare('SELECT c FROM kline WHERE ts=?').get(baseTs); if (r && isFinite(r.c) && r.c > 0) base = r.c; } } } catch (e) { }
      if (c == null || base == null) continue;
      const pct = (c - base) / base; n++;
      if (pct > 0) up++; else { down++; if (pct === 0) flat++; }
      if (!worst || pct < worst.pct) worst = { inst: x.instId, px: c, pct: pct };
    }
    if (n < MINCOV) continue;                       // 该片 WS/K线仍冷 → 保原值(诚实), 继续往前找
    b.up = up; b.down = down; b.flat = flat; b.n = n; b.worst = worst;   // b.n 即 out 里的 total
    /* 合成 BTC 蜡烛(若该 ts 缺 BTC K线): open=前收, 高低收=WS 现价 */
    const lead = list.find(x => x.sym === 'BTC') || null;
    if (lead) {
      let has = false;
      for (const c of leadCandles) { if (c.ts === b.ts) { has = true; break; } }
      if (!has) {
        let lc = null;
        try { const ch = KS.readChain(grain, lead.instId, 0, 1); if (ch.length) { const db = KS.roOpen(ch[0]); if (db) { const r = db.prepare('SELECT c FROM kline WHERE ts=?').get(baseTs); if (r && isFinite(r.c) && r.c > 0) lc = r.c; } } } catch (e) { }
        const c = livePx(lead.instId);
        if (lc && c) leadCandles.push({ ts: b.ts, o: lc, h: Math.max(lc, c), l: Math.min(lc, c), c: c, v: 0 });
      }
    }
    healed++;
  }
}

/* ---------------- 请求级分页裁剪 ----------------
 * page 语义: 1 = 最早一页; **负数 = 从末尾倒数(-1 = 最新一页)**。
 *   前端表格「最新在上」的首屏可直接取 -1, 不必先知道总页数。
 * ★只裁 bars(表格行); leadCandles(K线) 始终返回「满窗口(≤bars)」——
 *   用户明确要求 "K线保持全量 / leadCandles 仍全量(K线需要)"。
 *   表格响应里带满窗 K线 ≈100KB, 但 bars(表格) 部分仅 ~2KB(原 4.3MB),
 *   两者分开计费, 与用户 "传输从 4.3MB → 2KB(bars 部分)" 的口径一致。
 * stats / oldest / newest / spanDays 一律保持全窗口口径(顶部统计条不随翻页变化)。 */
function pageSlice(res, rqPage, rqSize) {
  if (!rqPage || !rqSize) { res.pageInfo = null; return res; }   // 不传 = 全量, 行为完全不变
  const all = res.bars || [];
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / rqSize));
  let p, start, end;
  if (rqPage < 0) {
    /* ★2026-10-28 修复: 「最新窗口」(page<0) 直接取末尾 rqSize 行,
     *   不再按固定页对齐 —— 否则当 total 不是 rqSize 整数倍时(如 2001 行/页10),
     *   末页只剩 1 行, 表现为"详细表格只有一行"(3m/15m 均踩中, 默认 tgrain=15m)。
     *   p 记为最后一页(UI 页码=pages), 翻页器据此正确显示。 */
    start = Math.max(0, total - rqSize);
    end = total;
    p = pages;
  } else {
    p = rqPage;
    if (p < 1) p = 1;
    if (p > pages) p = pages;
    start = (p - 1) * rqSize;
    end = start + rqSize;
  }
  res.bars = all.slice(start, end);            // 仅表格行分页
  /* ★leadCandles 不裁: K线需要满窗口, 由前端按 s.bars 自行 slice */
  res.pageInfo = { page: p, pageSize: rqSize, total: total, pages: pages, hasPrev: p > 1, hasNext: p < pages };
  return res;
}

async function updown(opt) {
  opt = opt || {};
  const sector = opt.sector || '';
  const grain = opt.grain || '15m';
  const maxBars = 20000;   // ★两年(1h=17520根/2h=8760/4h=4380) 需要更大的窗口
  /* ★默认窗口 2000 根(原 9000): 15m≈21天/3m≈4天, 表格一屏 20 行 = 100 页, 足够用;
   *   更长的历史由前端「« 更早」按 beforeTs 回溯, 不必一次传全量。
   *   K线同样受此窗口约束 —— 用户要求"K线也应该限制窗口, 默认 2000 足够"。 */
  const bars = Math.max(1, Math.min(maxBars, parseInt(opt.bars, 10) || 2000));
  /* ★按请求窗口决定缓存时长：窗口小=要实时 → 短缓存 */
  const tiny = bars <= 60;
  const CACHE_TTL = tiny ? 5000 : 30000;
  const beforeTs = parseInt(opt.beforeTs, 10) || 0;
  const lead = (opt.lead || 'BTC').toUpperCase();
  const rqPage = parseInt(opt.page, 10) || 0;
  const rqSize = parseInt(opt.pageSize, 10) || 0;
  /* ★计算 key **不含分页**（含了会每页存一份全量副本, 见上方说明） */
  const baseKey = [sector, grain, bars, beforeTs, lead].join('|');
  const hit = CACHE.get(baseKey);

  /* ★2026-10-28 Redis 共享缓存: 存/取的都是「基础全窗结果」, 分页在取出之后裁。
   *   多进程(cluster)部署时各 worker 共享同一份结果, 不用各自算一遍全市场扫描。 */
  if (RC && !hit && bars <= RC_MAX_BARS) {
    try {
      const rj = await RC.getJSON('ud:v3:' + baseKey);
      if (rj && rj.bars && rj.bars.length) {
        cachePut(baseKey, { at: Date.now(), refreshing: false, data: rj });
        return pageSlice(Object.assign({}, rj, { fromRedis: true }), rqPage, rqSize);
      }
    } catch (e) { }
  }

  /* ★2026-10-28 SWR（stale-while-revalidate）: 缓存过期但存在 → 立刻返回旧数据,
   *   同时在后台重算刷新, 下一个请求就是新的。
   *   缘起: 预聚合未启用时单次全市场扫描 3m 需 ~40 秒, 用户切一次分时白屏干等 40 秒;
   *         切回来发现又是新 key 又要 40 秒 → "切换分时特别慢"。
   *   SWR 后: 首次仍慢(后台预聚合完成后会消失), 之后任何切换都是毫秒级出数据。 */
  if (hit) {
    cacheTouch(baseKey);
    const fresh = Date.now() - hit.at < CACHE_TTL;
    if (!fresh && !hit.refreshing) {
      hit.refreshing = true;
      const key = baseKey;
      calc(sector, grain, bars, beforeTs, lead, opt).then(function (d) {
        const dd = Object.assign({ ok: true, at: Date.now() }, d);
        cachePut(key, { at: Date.now(), refreshing: false, data: dd });
        if (RC && bars <= RC_MAX_BARS) { try { RC.setJSON('ud:v3:' + key, 60, dd); } catch (e) { } }
      }).catch(function () {
        const h = CACHE.get(key);
        if (h) h.refreshing = false;      // 失败: 解除标记, 下次请求可再次触发刷新
      });
    }
    const served = Object.assign({}, hit.data, { stale: !fresh, staleAgeMs: Date.now() - hit.at });
    return pageSlice(served, rqPage, rqSize);
  }

  const data = await calc(sector, grain, bars, beforeTs, lead, opt);
  const out = Object.assign({ ok: true, at: Date.now() }, data);
  cachePut(baseKey, { at: Date.now(), refreshing: false, data: out });
  /* ★写回 Redis(异步不等待, TTL 60s 与进程内缓存一致) */
  if (RC && bars <= RC_MAX_BARS) {
    try { RC.setJSON('ud:v3:' + baseKey, 60, out); } catch (e) { }
  }
  return pageSlice(Object.assign({}, out), rqPage, rqSize);
}

async function calc(sector, grain, bars, beforeTs, lead, opt) {
  const u = await I.universe();
  if (!u.ok) return { ok: false, err: 'universe 未就绪', bars: [] };
  let list = u.list;
  if (sector && sector !== 'all') list = list.filter(x => x.sector === sector);
  if (!list.length) return { ok: false, err: '板块无标的', bars: [] };

  opt = opt || {};
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
    if (!sector && (!lead || String(lead).toUpperCase() === 'BTC')) {
      /* ★2026-10-28 历史窗口(beforeTs)也走预聚合: 主键 (grain,ts) 索引直接取
       *   ts<=beforeTs 的最近 bars 行 → 不必再退化成 287 个 K线库的实时扫描。 */
      pre = ST.agg(grain, beforeTs ? { beforeTs: beforeTs, bars: bars + 1 } : null);
    }
  } catch (e) { pre = null; }

  if (pre && pre.size) {
    for (const a of pre.values()) agg.set(a.ts, a);
    cov = list.length;
    /* ★只有「最新窗口」才需要 WS 实时前收基准(历史窗口不发实时行情) */
    if (!beforeTs) fillLastClose(grain, list, lastClose);
    if (leadInst && !leadCandles) {
      const full = tailCandles(leadInst.instId, grain, bars, beforeTs, 'ts,o,h,l,c,v');
      if (full && full.length >= 2) leadCandles = full;
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
    /* ★2026-10-28 修复「最近记录总有 0 / 空白」:
     *   根因: build() 在「合约 K线尚未落库完毕」时就聚合了正在写入的进行中 bar,
     *   导致最近若干片只聚合到 5/287 等极低覆盖(实测 3m 末 03:45~03:54 连续 n=5,
     *   其中 03:54 直接 up=0/down=5 → 表格顶行出现 0 与空白)。这些片随回填推进会在
     *   下个 5 分钟重建时愈合(同窗口 5m 已由 16 愈合到 287), 但愈合前显示成 0/空白会误导。
     *   修法: 仅剔除「最近 ~6 个周期窗口内、且覆盖低于阈值」的碎片——
     *     · 覆盖达标(≥max(20, 全市场10%))的片一律保留(如前一片 n=177);
     *     · 超出最近窗口(历史段/回填期低覆盖)一律不剔除 →
     *       不会重现此前「minN=172 把最近 12h 整段剔成空白」的问题。
     *   用「过滤」而非「尾部回退」: 因为愈合后的满覆盖最新片(如 n=252)会停在尾部,
     *   挡住对前面低覆盖进行中片的剔除, 必须用窗口+覆盖双重条件直接过滤。 */
    const minN = Math.max(20, Math.floor(list.length * 0.1));
    const GM_MS = GRAIN_MS[grain] || 900000;
    const winStart = Date.now() - GM_MS * 6;   // 仅最近 ~6 个周期内的低覆盖片可剔除
    arr = arr.filter(b => !(b.ts >= winStart && cnt(b) < minN));
  }

  /* ★2026-10-28 刚收线碎片片的愈合在下方「实时片」分支内(ws 实时价已就绪)统一处理,
   *   见 healRecentWS(): 紧邻实时片之前的 1~2 个低覆盖片, 用 WS 实时价重算 up/down 并合成 BTC 蜡烛。 */

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
    /* ★历史窗口(beforeTs)不拼实时片: 否则会在历史序列末尾凭空多一根"现在"的行情,
     *   表现为翻到更早历史时表格第一格时间突然跳回今天 */
    if (isLive && lastTs && liveTs >= lastTs && !beforeTs) {
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
      /* ★实时补 BTC(主力)本片涨幅: 实时价 vs 上一根「已收盘」收盘 ——
       *   避免 BTC K线滞后导致顶行 BTC% 整片空白(lead=-%)。取 ts<liveTs 的最后一根收盘作基准,
       *   无论 K线是否含进行中片都能给出正确本片涨幅。 */
      let liveBtcPct = null;
      if (leadInst) {
        try {
          const bchain = KS.readChain(grain, leadInst.instId, 0, 1);
          if (bchain.length) {
            const bdb = KS.roOpen(bchain[0]);
            if (bdb) {
              const br = bdb.prepare('SELECT ts,c FROM kline WHERE ts < ? ORDER BY ts DESC LIMIT 1').get(liveTs);
              const bpx = livePx(leadInst.instId);
              if (br && isFinite(br.c) && br.c > 0 && bpx && bpx > 0) {
                liveBtcPct = +((bpx - br.c) / br.c * 100).toFixed(2);
              }
            }
          }
        } catch (e) { }
      }
      a.liveBtcPct = liveBtcPct;
      /* ★愈合「刚收线」碎片片: 紧邻实时片之前的 1~2 个低覆盖片, 用 WS 实时价重算 up/down
       *   并合成其 BTC 蜡烛(若该 ts 缺 BTC K线) → 顶行下方不再出现错行/空白。 */
      healRecentWS(grain, list, arr, leadCandles, livePx, GM);
      /* ★合成「缺 BTC K线」的最近行: 若某行 ts 在 leadCandles 中缺 BTC 蜡烛
       *   (BTC 自身 K线滞后于其它合约, 常见于最尖端 1~2 根) → 用 WS 现价合成一根
       *   (开=前收/现价差, 高/低/收=现价), 表格「最高/最低/收盘/涨幅」不再空白。
       *   仅对最近 ~8 周期内的已收线生效(liveTs 由下方实时块负责, 不在此合成)。 */
      (function synthMissingLead() {
        if (!leadCandles || !leadInst) return;
        const have = new Set(leadCandles.map(c => c.ts));
        const since = Date.now() - GM * 8;
        for (const b of arr) {
          if (b.ts < since || b.ts >= liveTs) continue;     // 仅最近窗口的已收线
          if (have.has(b.ts)) continue;
          let base = null;
          try { const ch = KS.readChain(grain, leadInst.instId, 0, 1); if (ch.length) { const db = KS.roOpen(ch[0]); if (db) { const r = db.prepare('SELECT c FROM kline WHERE ts=?').get(b.ts - GM); if (r && isFinite(r.c) && r.c > 0) base = r.c; } } } catch (e) { }
          const c = livePx(leadInst.instId);
          if (!c || c <= 0) continue;
          leadCandles.push({ ts: b.ts, o: base || c, h: Math.max(base || c, c), l: Math.min(base || c, c), c: c, v: 0 });
          have.add(b.ts);
        }
      })();
      /* 覆盖≥30% 合约才纳入（WS 快照刚启动时避免残缺统计） */
      if (a.n >= Math.max(2, Math.floor(list.length * 0.3))) {
        arr = arr.filter(b => b.ts !== liveTs);       // 库内快照片 → WS 现价片覆盖
        arr.push(a);
      }
      /* 主力K线补「形成中」一根: 开=库尾收盘, 高低收=WS现价
       *   ★断层也补: 放松到 60 个周期(覆盖 BTC K线滞后到 18 分钟仍画得出实时蜡烛,
       *   否则顶行 BTC 蜡烛/涨幅整片空白); 视觉按序画无空洞感。 */
      if (leadInst && leadCandles && leadCandles.length) {
        const lc = lastClose.get(leadInst.instId);
        const px = livePx(leadInst.instId);
        if (lc && px && liveTs > lc.ts && liveTs - lc.ts <= GM * 60) {
          leadCandles.push({ ts: liveTs, o: lc.c, h: Math.max(lc.c, px), l: Math.min(lc.c, px), c: px, v: 0 });
        }
      }
    }
  } catch (e) { }

  /* ★合成/补根蜡烛按 ts 排序, 保证 leadMap 与 K线主轴严格有序(愈合片可能在中间插入) */
  if (leadCandles && leadCandles.length > 1) leadCandles.sort((a, b) => a.ts - b.ts);

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
    const lpRaw = leadMap.get(b.ts);
    /* ★实时片(顶行)若 leadCandles 尚未含该 ts(主力K线滞后), 用 liveBtcPct 兜底, 避免顶行 BTC% 空白 */
    const lp = (lpRaw === null || lpRaw === undefined)
      ? (b.liveBtcPct !== undefined ? b.liveBtcPct : null)
      : lpRaw;
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
  /* ★2026-10-28 主轴对齐：K线(leadCandles) 与 统计(bars) 取交集, 消除"空白行"
   *   缘起: 前端 buildTableRows 以 leadCandles 为主轴逐根渲染, 每个 ts 去 bars 里取
   *         涨跌家数; 而尾部碎片剔除会砍掉覆盖不足的时间片(如 143/287)。
   *         → 被砍掉的 ts 仍在 leadCandles 里 → 表格出现「价格有值、家数全 -」的空行,
   *           用户看到的就是"最近几笔的数据总是空白"。
   *   修法: 只保留两边都有的 ts。宁可少显示一根, 也不显示残缺行。
   *   兜底: 交集为空(极端异常)时保留原序列, 避免K线图整个消失。 */
  const outTs = new Set(out.map(b => b.ts));
  let leadAligned = (leadCandles || []).filter(r => outTs.has(r.ts));
  if (!leadAligned.length && leadCandles && leadCandles.length) leadAligned = leadCandles;

  /* ★2026-10-28 服务端分页已上移到 pageSlice(): 缓存里永远只存「全窗结果」,
   *   分页只发生在响应出口 —— 故这里 bars/leadCandles 一律返回全窗(=全量行为不变)。
   *   leadCandles 同时带 pc(前一根收盘): 表格翻页后, 每页第一行不能靠数组邻居取前收,
   *   否则会出现「最新几笔涨跌幅全 -」的假空白 —— 由服务端下发真实前收避免。 */
  const leadOut = leadAligned.map((r, i) => ({
    ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v,
    pc: i > 0 ? leadAligned[i - 1].c : null
  }));

  return {
    ok: true, grain, sector, lead,
    count: list.length, covCount: cov,
    bars: out,
    pageInfo: null,
    /* ★主力合约 K线（OHLCV，受 bars 窗口约束 ≈ 默认 2000 根）供前端叠加到BTC K线图 */
    leadCandles: leadOut,
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