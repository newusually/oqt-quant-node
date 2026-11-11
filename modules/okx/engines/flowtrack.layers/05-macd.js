/* 05-macd.js — 信号层：MACD(12,26,60) 计算、形态识别(孔雀开屏/V/W/M)与 15m 定时调度
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
/* ★K线形态缓存：inst|tf → {barTs, o,h,l,c,v}（正序，最多 MACD_BARS 根）
 *   用于孔雀开屏(MA5上穿全部均线) / V反转 / W双底 / M头 识别，驱动分级加仓。 */
const pyrBars = new Map();
/* ============================== MACD(12,26,60) 入场信号 · 只 15m ==============================
 * 口径同前端副图：EMA(n) k=2/(n+1)，首值作初值；DIF=EMA12-EMA26；
 *   DEA=EMA(DIF,60)；hist=(DIF-DEA)*2。
 * 买多：hist[最后一根] > 0 且往前连续 ≥20 根 < 0；卖空反之；其余 0。
 * 数据源：GET /api/v5/market/candles?instId=X&bar=15m&limit=100
 *   OKX 返回 data[0] 为最新（含进行中那根），reverse 成正序后取收盘价 [4]。
 * 调度：每根 15m K 线边界（:00/:15/:30/:45）跑一次全市场，周期内不重复刷新；
 *   信号用 barTs 锁定所在 K 线，过期或跨 K 线一律不给信号。 */
function emaArr(src, n) {
  const k = 2 / (n + 1);
  let p = null;
  const out = new Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (!isFinite(v)) { out[i] = p; continue; }
    p = (p === null) ? v : v * k + p * (1 - k);
    out[i] = p;
  }
  return out;
}
function macdHistSeries(closes) {
  const minBars = CFG.MACD_SIGNAL + CFG.MACD_MIN_PREV + 2;
  if (!closes || closes.length < minBars) return null;
  const ef = emaArr(closes, CFG.MACD_FAST);
  const es = emaArr(closes, CFG.MACD_SLOW);
  const dif = ef.map((v, i) => v - es[i]);
  const dea = emaArr(dif, CFG.MACD_SIGNAL);
  return dif.map((v, i) => (v - dea[i]) * 2);
}
/* 返回 1(买多)/-1(卖空)/0(无)，并给出翻转前连续反向柱数（诊断用） */
function macdFlip(hist) {
  if (!hist || hist.length < CFG.MACD_MIN_PREV + 1) return { dir: 0, prev: 0 };
  const cur = hist[hist.length - 1];
  if (!isFinite(cur) || cur === 0) return { dir: 0, prev: 0 };
  const wantNeg = cur > 0;       // 当前为正 → 要求前面连续为负
  let prev = 0;
  for (let i = hist.length - 2; i >= 0; i--) {
    const ok = wantNeg ? hist[i] < 0 : hist[i] > 0;
    if (!ok) break;
    prev++;
    if (prev >= CFG.MACD_MIN_PREV) break;   // ≥20 根即满足「20个最少」
  }
  if (prev < CFG.MACD_MIN_PREV) return { dir: 0, prev };
  return { dir: wantNeg ? 1 : -1, prev };
}
function macdDueTfs(now) {
  const due = [];
  for (const tf of PYR.TFS) {
    const bar = pyrBarStart(tf.id, now);
    if (now - bar < CFG.MACD_BOOT_DELAY_MS) continue;      // 等新K线生成，避免拿到上一根
    if (macdSched[tf.id] && macdSched[tf.id].lastBar === bar) continue;  // 同一根K线只跑一次
    due.push({ tf, bar });
  }
  return due;
}

/* 单合约·单周期刷新：写入该根 K 线的 MACD 信号缓存 */
async function macdFetchOne(inst, tf) {
  try {
    const r = await fetch(CFG.HTTP_BASE + '/api/v5/market/candles?instId=' +
      encodeURIComponent(inst) + '&bar=' + encodeURIComponent(tf.bar) + '&limit=' + CFG.MACD_BARS,
      { signal: AbortSignal.timeout(CFG.MACD_REQ_TIMEOUT_MS) });
    const j = await r.json();
    if (!j || j.code !== '0' || !Array.isArray(j.data) || !j.data.length) { macdStat.fail++; return; }
    const closes = j.data.map(x => +x[4]).reverse();       // 最新在前 → 转正序
    const hist = macdHistSeries(closes);
    const f = macdFlip(hist);
    /* data[0][0] = 当前（进行中）那根 K 线的起始毫秒；信号只允许在该根 K 线内生效 */
    const rawBar = +j.data[0][0];
    const barTs = rawBar > 0 ? rawBar : pyrBarStart(tf.id, Date.now());
    /* ★缓存 OHLCV（正序）：形态识别（孔雀开屏/V/W/M）用，避免重复拉取 K 线 */
    try {
      const asc = j.data.slice().reverse();                // [ts,o,h,l,c,vol,...]
      pyrBars.set(inst + '|' + tf.id, {
        barTs,
        o: asc.map(x => +x[1]), h: asc.map(x => +x[2]),
        l: asc.map(x => +x[3]), c: asc.map(x => +x[4]),
        v: asc.map(x => +x[5])
      });
    } catch (eP) { /* 形态缓存失败不影响 MACD 信号 */ }
    macdCache.set(inst + '|' + tf.id, {
      dir: f.dir, prev: f.prev, barTs,
      last: hist ? hist[hist.length - 1] : null,
      histTail: hist ? hist.slice(-4) : null,
      bars: closes.length, at: Date.now()
    });
    macdStat.ok++;
    if (f.dir > 0) macdStat.buy++;
    else if (f.dir < 0) macdStat.sell++;
    else macdStat.none++;
  } catch (e) { macdStat.fail++; }
}

/* 限速 worker：每批 MACD_CONCURRENCY 个并发，批间 MACD_TICK_MS，整轮跑完才退出 */
async function macdDrain() {
  if (macdRunning) return false;
  macdRunning = true;
  try {
    while (macdJobs.length) {
      const batch = macdJobs.splice(0, CFG.MACD_CONCURRENCY);
      await Promise.all(batch.map(j => macdFetchOne(j.inst, j.tf)));
      for (const j of batch) {
        const s = macdSched[j.tf.id];
        if (s) s.done++;
      }
      macdStat.refreshed += batch.length;
      if (macdJobs.length) await new Promise(r => setTimeout(r, CFG.MACD_TICK_MS));
    }
    for (const tf of PYR.TFS) {
      const s = macdSched[tf.id];
      if (s && s.done >= s.queued && !s.finishedAt) s.finishedAt = Date.now();
    }
  } finally { macdRunning = false; }
  return true;
}

/* 每秒检查 15m K 线边界；到期入队执行 */
function macdSchedTick() {
  const now = Date.now();
  const due = macdDueTfs(now);
  for (const { tf, bar } of due) {
    /* ★买卖/加仓边界窗口：本根 15m K 线边界后开启 ENTRY_WINDOW_MS 的入场窗口，
     *   窗口外 scan() 不再做信号驱动的买多/卖空/加仓（只平仓），节奏明确为每 15 分钟一次。 */
    if (tf.id === '15m') entryWindowUntil = bar + CFG.ENTRY_WINDOW_MS;
    /* 剔除该周期上一轮未跑完的残留任务，避免跨K线积压 */
    macdJobs = macdJobs.filter(j => j.tf.id !== tf.id);
    macdSched[tf.id] = {
      lastBar: bar, startedAt: now, finishedAt: 0,
      queued: macdQueue.length, done: 0,
      intervalMs: tf.step * 60000
    };
    for (const inst of macdQueue) macdJobs.push({ inst, tf });
    macdStat.cycles++;
  }
  if (due.length) {
    console.log(`[macd] 定时触发 ${due.map(d => d.tf.id).join('/')} @ ${new Date(now).toISOString()}（本轮 ${macdJobs.length} 个请求）`);
  }
  if (macdJobs.length && !macdRunning) return macdDrain();
  return Promise.resolve(false);
}

/* 供 scan() 读取：过期或跨 K 线的缓存一律不给信号（barTs 锁定当前这根） */
function pyrEntrySignal(inst, tf) {
  const c = macdCache.get(inst + '|' + tf.id);
  if (!c) return 0;
  const maxAge = (tf.step + CFG.MACD_STALE_EXTRA_MIN) * 60000;
  if (Date.now() - c.at > maxAge) return 0;
  if (c.barTs !== pyrBarStart(tf.id, Date.now())) return 0;
  return c.dir;
}

/* 加仓专用：当前这根 15m K 线的 MACD 柱方向（>0 买多方向 / <0 卖空方向）。
 * 与 pyrEntrySignal() 的「零轴翻转入场」不同：只看柱的正负，不要求前 20 根反向柱。
 * 同样要求缓存未过期且 barTs 锁定当前 K 线，避免用旧 K 线方向加仓。 */
function pyrMacdDir(inst, tf) {
  const c = macdCache.get(inst + '|' + tf.id);
  if (!c) return 0;
  const maxAge = (tf.step + CFG.MACD_STALE_EXTRA_MIN) * 60000;
  if (Date.now() - c.at > maxAge) return 0;
  if (c.barTs !== pyrBarStart(tf.id, Date.now())) return 0;
  if (!(c.last > 0) && !(c.last < 0)) return 0;
  return c.last > 0 ? 1 : -1;
}


/* ============================== 形态识别 · 加仓强度分级 ==============================
 * 背景（用户 2026-11-11 要求）：原加仓只看「浮亏 + 满 1 小时」，完全不看形态强度，
 *   真正马上要起涨/起跌的位置不敢加，赚得慢。本引擎识别三类高胜率结构，命中即按倍数加仓：
 *   ① 缠论孔雀开屏：MA5 上穿并站上 MA10/MA20/MA60，形成多头排列（空头对称=倒孔雀开屏）
 *   ② V 形反转 / 倒 V 形：单点急跌急拉（或冲高回落），收盘收复，MACD 同步转向
 *   ③ W 双底突破 / M 头破位：两个等高低点 + 颈线突破
 *   加分项：放量（最新量 > 前 5 根均量 1.5 倍）、MACD 柱加速
 * 输出 {score, mult, tags[]}；score 越高 mult 越大（1/2/2.5/3/4/5 倍）。
 * 方向约定：dir>0 只认多头形态，dir<0 只认空头形态（形态与持仓方向不符直接返回 0 分）。 */
function maSeries(src, n) {
  const out = new Array(src.length);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= n) sum -= src[i - n];
    out[i] = i >= n - 1 ? sum / n : null;
  }
  return out;
}
function okNum(x) { return typeof x === 'number' && isFinite(x); }

/* 形态评分：返回 { score, mult, tags } */
function pyrPattern(inst, tf, dir) {
  const res = { score: 0, mult: 1, tags: [] };
  if (!dir) return res;
  const b = pyrBars.get(inst + '|' + tf.id);
  if (!b || !b.c || b.c.length < 70) return res;
  /* 缓存必须属于当前这根 K 线，避免用上一根的形态加仓 */
  if (b.barTs !== pyrBarStart(tf.id, Date.now())) return res;
  const c = b.c, h = b.h, l = b.l, v = b.v;
  const n = c.length, i = n - 1, p = n - 2;
  const lastC = c[i], prevC = c[p];
  if (!okNum(lastC) || !okNum(prevC) || !(lastC > 0)) return res;
  const ma5 = maSeries(c, 5), ma10 = maSeries(c, 10), ma20 = maSeries(c, 20), ma60 = maSeries(c, 60);
  const bull = dir > 0;

  /* ---- ① 孔雀开屏 / 倒孔雀开屏：MA5 站上全部均线且多头排列 ----
   * 刚开屏（最近 3 根内完成上穿）给最高分——这正是「马上要大涨」的起点，要重仓；
   * 已开屏但仍在排列中给次高分（趋势延续，可继续加）。 */
  const stacked = (k) => okNum(ma5[k]) && okNum(ma10[k]) && okNum(ma20[k]) && okNum(ma60[k]) &&
    (bull ? (ma5[k] > ma10[k] && ma10[k] > ma20[k] && ma20[k] > ma60[k])
          : (ma5[k] < ma10[k] && ma10[k] < ma20[k] && ma20[k] < ma60[k]));
  const nowStack = stacked(i);
  const aboveAll = bull ? (lastC > ma60[i] && lastC > ma5[i]) : (lastC < ma60[i] && lastC < ma5[i]);
  /* 找最近一次「由未排列 → 排列」的交叉根 */
  let crossK = -1;
  for (let k = i; k >= Math.max(1, i - 6); k--) {
    if (stacked(k) && !stacked(k - 1)) { crossK = k; break; }
  }
  if (nowStack && aboveAll && crossK >= 0 && (i - crossK) <= 2) {
    res.score += 3; res.tags.push(bull ? '孔雀开屏' : '倒孔雀开屏');
  } else if (nowStack && aboveAll) {
    res.score += 2; res.tags.push(bull ? '多头排列' : '空头排列');
  }

  /* ---- ② V 形反转 / 倒 V 形：近 8 根极值点 + 快速收复 ---- */
  let exIdx = i, exPx = bull ? l[i] : h[i];
  for (let k = i; k >= i - 8 && k >= 0; k--) {
    if (bull ? (l[k] < exPx) : (h[k] > exPx)) { exPx = bull ? l[k] : h[k]; exIdx = k; }
  }
  const move = bull ? (lastC - exPx) / exPx : (exPx - lastC) / exPx;   // 从极值反弹/回落幅度
  const freshEx = exIdx >= i - 4 && exIdx <= i - 1;                    // 极值出现在最近 4 根内且非当前根
  const ctTurn = bull ? (lastC > prevC) : (lastC < prevC);
  if (freshEx && move >= 0.007 && ctTurn) { res.score += 2; res.tags.push(bull ? 'V反转' : '倒V反转'); }

  /* ---- ③ W 双底突破 / M 头破位：两个等高低点 + 颈线突破 ---- */
  const W = 24;                                  // 回看窗口
  const lo = Math.max(0, i - W + 1);
  const piv = [];                                // 极值点（局部最低/最高）
  for (let k = lo + 1; k <= i - 1; k++) {
    if (bull) { if (l[k] <= l[k - 1] && l[k] <= l[k + 1]) piv.push({ k, px: l[k] }); }
    else { if (h[k] >= h[k - 1] && h[k] >= h[k + 1]) piv.push({ k, px: h[k] }); }
  }
  if (piv.length >= 2) {
    const a = piv[piv.length - 2], z = piv[piv.length - 1];
    const gap = Math.abs(z.k - a.k) >= 3;
    const same = Math.abs(a.px - z.px) / Math.max(a.px, z.px) < (bull ? 0.0045 : 0.0045);
    /* 颈线：两底之间的最高点（M 头为最低点） */
    let neck = bull ? -Infinity : Infinity;
    for (let k = a.k; k <= z.k; k++) {
      if (bull) { if (h[k] > neck) neck = h[k]; } else { if (l[k] < neck) neck = l[k]; }
    }
    const broke = bull ? (lastC > neck) : (lastC < neck);
    if (gap && same && broke) { res.score += 3; res.tags.push(bull ? 'W双底突破' : 'M头破位'); }
  }

  /* ---- 加分：放量 / MACD 柱加速 ---- */
  if (v && v.length > 6) {
    let sv = 0, cnt = 0;
    for (let k = i - 5; k <= i - 1; k++) { if (okNum(v[k])) { sv += v[k]; cnt++; } }
    if (cnt && okNum(v[i]) && sv > 0 && v[i] > (sv / cnt) * 1.5) { res.score += 1; res.tags.push('放量'); }
  }
  const mc = macdCache.get(inst + '|' + tf.id);
  if (mc && mc.histTail && mc.histTail.length >= 3) {
    const t = mc.histTail, L = t.length;
    const accel = bull ? (t[L - 1] > t[L - 2] && t[L - 2] > t[L - 3])
                       : (t[L - 1] < t[L - 2] && t[L - 2] < t[L - 3]);
    if (accel) { res.score += 1; res.tags.push('MACD加速'); }
  }

  /* 倍数映射：2→2x / 3→2.5x / 4→3x / 5→4x / 6+→5x（score 0-1 不加倍） */
  const s = res.score;
  res.mult = s >= 6 ? 5 : s === 5 ? 4 : s === 4 ? 3 : s === 3 ? 2.5 : s === 2 ? 2 : 1;
  return res;
}

/* ============================== 顺势过滤（入场质量闸门） ==============================
 * 背景（2026-11-11 实测）：近 36h 671 笔入场中 663 笔（98.8%）形态分为 0 —— 纯 MACD 零轴翻转硬开，
 *   完全不看趋势位置。结果风控上线后首小时出现「止盈 5 笔 / 止损类 94 笔」的灾难比例。
 * 判定（v2，2026-11-11 修正）：零轴翻转是「趋势反转」信号，天然发生在价格尚未站上 MA20 时，
 *   若要求 px>MA20 会把入场全部堵死（实测 16:45 窗口 0 笔新开仓）。故改用两条更本质的判据：
 *     · 大方向不深跌/不暴涨：px 不跌破 MA60 的 1%（多头），空头对称 → 挡下跌途中抄底
 *     · 中期斜率转向：MA20 近 3 根不再下行（多头），空头对称 → 挡逆势硬扛
 *   这允许"反转初期（px 刚穿过 MA60、MA20 转平）"入场，同时拒绝"深跌中的反弹"。
 * 数据不足（<65 根）或缓存非当前K线时放行，避免新上市合约与刚刷新时完全不开仓。
 * 开关：PYR.TREND_FILTER；加仓同理见 PYR.ADD_LOSS_TREND_ONLY。 */
function pyrTrendOk(inst, tf, dir) {
  const b = pyrBars.get(inst + '|' + tf.id);
  if (!b || !b.c || b.c.length < 65) return true;                 // 数据不足：不拦
  if (b.barTs !== pyrBarStart(tf.id, Date.now())) return true;    // 缓存非当前K线：不拦
  const c = b.c, i = c.length - 1;
  const ma20 = maSeries(c, 20), ma60 = maSeries(c, 60);
  if (!okNum(ma20[i]) || !okNum(ma60[i]) || !okNum(ma20[i - 3])) return true;
  const px = c[i];
  if (dir > 0) {
    return px > ma60[i] * 0.99 && ma20[i] >= ma20[i - 3];
  }
  return px < ma60[i] * 1.01 && ma20[i] <= ma20[i - 3];
}
