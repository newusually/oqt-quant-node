/* 05-macd.js — 信号层：MACD(12,26,60) 计算与 15m 定时调度
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
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
    macdCache.set(inst + '|' + tf.id, {
      dir: f.dir, prev: f.prev, barTs,
      last: hist ? hist[hist.length - 1] : null,
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

