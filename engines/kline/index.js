// L4 engines/kline · K线引擎（原 cpp/kline 1:1 转换）
// 新浪 K线源 + 周期聚合（2H/4H/6H 由 60m 合并；周/月 由日线合并）
'use strict';

const SINA_K = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData';

// ★短期内存缓存(20秒): 总览/排行榜/A股页悬停弹 5 分钟K线时会反复取同一品种,
//   不走缓存每次都要打新浪(1~5秒), 悬浮窗半天出图。缓存后二次以后秒开。
const KCACHE = new Map();
const KCACHE_TTL = 20000;

// ★fresh=1 绕过 20s 内存缓存(悬浮窗自动刷新/定时对账重载要拿真 newest)
function sinaKlineRows(code, tf, limit, fresh) {
  const scaleMap = { '5m': 5, '15m': 15, '30m': 30, '60m': 60, '1d': 240 };
  const scale = scaleMap[tf] || 5;
  const key = String(code) + '|' + scale + '|' + (limit | 0);
  const c = KCACHE.get(key);
  if (!fresh && c && Date.now() - c.at < KCACHE_TTL) return Promise.resolve(c.rows);
  const url = `${SINA_K}?symbol=${encodeURIComponent(code)}&scale=${scale}&ma=no&datalen=${limit}`;
  return fetch(url).then(r => r.text()).then(txt => {
    const t = (txt || '').trim();
    let bars;
    try { bars = JSON.parse(t); }
    catch (e) {
      const m = t.match(/\(([\s\S]*)\)/);
      if (!m) return null;
      try { bars = JSON.parse(m[1]); } catch (e2) { return null; }
    }
    if (!Array.isArray(bars) || !bars.length) return null;
    const rows = bars.map(b => {
      const tsec = Math.floor(new Date(String(b.day).replace(/-/g, '/')).getTime() / 1000);
      return [tsec, +b.open, +b.high, +b.low, +b.close, +b.volume];
    });
    if (KCACHE.size > 600) KCACHE.clear();
    KCACHE.set(key, { at: Date.now(), rows });
    return rows;
  });
}

// 把 N 根相邻源 K线 合并成 1 根（2H/4H/6H）
function aggConsecutive(rows, n) {
  const out = [];
  for (let i = 0; i < rows.length; i += n) {
    const g = rows.slice(i, i + n);
    if (!g.length) break;
    let h = -Infinity, l = Infinity, v = 0;
    for (const r of g) { if (r[2] > h) h = r[2]; if (r[3] < l) l = r[3]; v += r[5]; }
    out.push([g[0][0], g[0][1], h, l, g[g.length - 1][4], v]);
  }
  return out;
}

// 按周/月聚合（周线/月线）
function aggPeriod(rows, kind) {
  const out = []; let cur = null;
  for (const r of rows) {
    const d = new Date(r[0] * 1000);
    let key;
    if (kind === 'w') { const day = (d.getDay() + 6) % 7; const mo = new Date(d); mo.setDate(d.getDate() - day); key = mo.getFullYear() + '-' + mo.getMonth() + '-' + mo.getDate(); }
    else { key = d.getFullYear() + '-' + d.getMonth(); }
    if (!cur || cur.key !== key) { cur = { key, t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }; out.push(cur); }
    else { cur.h = Math.max(cur.h, r[2]); cur.l = Math.min(cur.l, r[3]); cur.c = r[4]; cur.v += r[5]; }
  }
  return out.map(c => [c.t, c.o, c.h, c.l, c.c, c.v]);
}

// 统一取 K线：原生 5m/15m/30m/60m/1d + 聚合 2H/4H/6H(自60m) / 1W/1M(自1d)
//   fresh=1 绕过内存缓存(实时刷新场景)
async function getRows(code, tf, limit, fresh) {
  limit = Math.max(10, Math.min(3000, limit | 0));
  try {
    if (tf === '2H' || tf === '4H' || tf === '6H') {
      const n = tf === '2H' ? 2 : tf === '4H' ? 4 : 6;
      const base = await sinaKlineRows(code, '60m', Math.min(3000, limit * n), fresh);
      if (!base || !base.length) return null;
      return aggConsecutive(base, n);
    }
    if (tf === '1W' || tf === '1M') {
      const base = await sinaKlineRows(code, '1d', Math.min(3000, limit * (tf === '1W' ? 6 : 24)), fresh);
      if (!base || !base.length) return null;
      return aggPeriod(base, tf === '1W' ? 'w' : 'm');
    }
    return await sinaKlineRows(code, tf, limit, fresh);
  } catch (e) { return null; }
}

module.exports = { sinaKlineRows, aggConsecutive, aggPeriod, getRows };
