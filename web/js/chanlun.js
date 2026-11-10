/* ============================================================================
 * web/js/chanlun.js —— ★共享「缠论线」组件 ChanLun（2026-11-07 重写 · 纯因果）
 * ----------------------------------------------------------------------------
 * 本轮重写（用户要求：删除未来函数 + 按公式画 + MA 角度可尖锐可很小）：
 *
 *   ★ 1. 完全去除未来函数（look-ahead）：
 *      转折点检测只用「已收盘」的 bar（≤ 当前 i），不使用 a[i+1]。
 *      旧版 slope(a,i)=sign(a[i+1]-a[i]) 需要下一根才能确认顶点 → 1 根前视，
 *      现改为 dirAt(k)=sign(a[k]-a[k-1])，方向在 k 根收盘即确认，顶点落在 k-1。
 *      信号/画图在 bar i 只用 ≤i 的已确认转折点，严格因果。
 *
 *   ★ 2. 角度按公式算（与 angle_strategy.js / qa-marks.js 完全一致）：
 *      段角度 θ = atan( (MA_i − MA_j) / |MA_j| / (i−j) × 100 ) × 180/π
 *      pivots 每段带 deg；angles() 暴露逐段 {i0,i1,pct,deg} 供标注/分析。
 *
 *   ★ 3. MA 角度「可尖锐可很小」：
 *      minBars 默认降到 2（旧 3），更短的反转也成转折点 → 段更密、角度谱系更全
 *      （既有接近 90° 的尖锐段，也有几度的极小角）；setParam({minBars:1}) 可全显。
 *      开启 showAngles 后每段标注度数（红弧同款数学角文字）。
 *
 *   ★ 4. 根据公式画线：相邻转折点直连 = 段内线性插值（公式），不逐根取点 → 纯直线。
 *      覆盖 5-60 任意 MA 周期（register 任意 period 即可，默认 4 条 5/20/30/60）。
 *
 * 组件化 + 热插拔：register/unregister/list/onChange；默认注册 4 条。
 * 对外： ma() / pivots() / series() / angles() / draw()
 * 缓存： WeakMap<bars, cache> + cacheVer 失效；暴露 global.ChanLun
 * ========================================================================== */
(function (global) {
  'use strict';
  var RAD = 180 / Math.PI;

  /* ================================================================ 线组件注册表（热插拔） */
  var lines = {};
  var order = [];
  var listeners = [];

  function register(spec) {
    if (!spec || !spec.id || !spec.period) return null;
    if (!lines[spec.id]) order.push(spec.id);
    lines[spec.id] = {
      id: spec.id,
      period: Math.max(2, spec.period | 0),
      name: spec.name || ('MA' + spec.period),
      color: spec.color || '#f0334b',
      dash: spec.dash || [],
      width: spec.width || 1.7,
      enabled: spec.enabled !== false
    };
    clearCache(); fire();
    return lines[spec.id];
  }
  function unregister(id) {
    if (!lines[id]) return false;
    delete lines[id];
    order = order.filter(function (x) { return x !== id; });
    clearCache(); fire();
    return true;
  }
  function list() {
    return order.map(function (id) { return lines[id]; })
      .filter(function (l) { return l && l.enabled !== false; });
  }
  function get(id) { return lines[id] || null; }
  function setEnabled(id, on) {
    if (!lines[id]) return false;
    lines[id].enabled = !!on; fire(); return true;
  }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function offChange(fn) { listeners = listeners.filter(function (x) { return x !== fn; }); }
  function fire() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](list()); } catch (e) { } } }

  /* 默认 4 条线：MA5 红实线，其余虚线且颜色各不相同（覆盖 5-60 区间） */
  [
    { id: 'ma5', period: 5, name: 'MA5', color: '#f0334b', dash: [], width: 2.0 },
    { id: 'ma20', period: 20, name: 'MA20', color: '#3d7bff', dash: [7, 4], width: 1.6 },
    { id: 'ma30', period: 30, name: 'MA30', color: '#0bbf7a', dash: [7, 4], width: 1.6 },
    { id: 'ma60', period: 60, name: 'MA60', color: '#e06c9f', dash: [7, 4], width: 1.6 }
  ].forEach(register);

  /* ================================================================ 缓存 */
  var WM = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function cacheOf(bars) {
    if (!bars || !bars.length) return null;
    if (WM) {
      var m = WM.get(bars);
      if (!m) { m = {}; WM.set(bars, m); }
      return m;
    }
    if (!bars.__chanlunCache) bars.__chanlunCache = {};
    return bars.__chanlunCache;
  }
  function clearCache() { cacheVer++; }
  var cacheVer = 0;

  /* 参数：转折点最小间隔（越小越密、角度谱系越全：既有尖锐也有很小角）；可选标注角度 */
  var params = { minBars: 2, showAngles: false };
  function setParam(p) {
    if (!p) return params;
    if (p.minBars) params.minBars = Math.max(1, p.minBars | 0);
    if (typeof p.showAngles === 'boolean') params.showAngles = p.showAngles;
    clearCache(); fire();
    return params;
  }
  function getParams() { return params; }

  /* ================================================================ MA 序列（仅用于找转折点，不用于画线；因果） */
  function ma(bars, period) {
    var c = cacheOf(bars), key = 'ma' + period + '_v' + cacheVer;
    if (c && c[key]) return c[key];
    var n = bars.length, out = new Array(n), s = 0;
    for (var i = 0; i < n; i++) {
      var v = +bars[i].c;
      if (!isFinite(v)) v = (i ? out[i - 1] : 0);
      s += v;
      if (i >= period) s -= +bars[i - period].c;
      out[i] = (i >= period - 1) ? s / period : s / (i + 1);
    }
    if (c) c[key] = out;
    return out;
  }

  /* 段方向（因果）：dirAt(k)=sign(a[k]-a[k-1])，只用已收盘 bar ≤k */
  function dirAt(a, k) { var d = a[k] - a[k - 1]; return d > 0 ? 1 : (d < 0 ? -1 : 0); }

  /* ================================================================ 转折点（纯直线段的端点，严格因果） */
  function pivots(bars, period) {
    var c = cacheOf(bars);
    var key = 'pv' + period + '_' + params.minBars + '_' + (params.showAngles ? 1 : 0) + '_v' + cacheVer;
    if (c && c[key]) return c[key];
    var a = ma(bars, period), n = bars.length, out = [];

    if (n < period + 2) {
      out = [{ i: 0, px: a[0] || 0, type: 'B', deg: 0 }];
      if (n > 1) out.push({ i: n - 1, px: a[n - 1] || 0, type: (a[n - 1] >= a[0] ? 'T' : 'B'), deg: 0 });
      if (c) c[key] = out;
      return out;
    }

    /* ① 起点锚（因果：用 a[start] 与 a[start-1] 比，不向前看） */
    var start = Math.min(period - 1, n - 1);
    var firstUp = start > 0 ? (a[start] >= a[start - 1]) : true;
    out.push({ i: 0, px: a[0] || 0, type: firstUp ? 'B' : 'T', deg: 0 });

    /* ② 因果局部极值：k 根方向变号 → 顶点在 k-1（只用 ≤k 的数据） */
    var raw = [];
    var prevDir = 0;
    for (var k = 1; k <= n - 1; k++) {
      var dir = dirAt(a, k);
      if (prevDir !== 0 && dir !== 0 && prevDir !== dir) {
        raw.push({ i: k - 1, px: a[k - 1], type: (prevDir > 0 ? 'T' : 'B') });
      }
      if (dir !== 0) prevDir = dir;
    }

    /* ③ 最小间隔过滤（同类型取更极端），保证每段都是一条够长的直线 */
    for (var r = 0; r < raw.length; r++) {
      var pt = raw[r], last = out[out.length - 1];
      if (pt.i - last.i < params.minBars) {
        if (pt.type === last.type) {
          if ((pt.type === 'T' && pt.px > last.px) || (pt.type === 'B' && pt.px < last.px)) out[out.length - 1] = pt;
        }
        continue;
      }
      out.push(pt);
    }

    /* ④ 末点：延伸到最新一根（进行中的直线，用最新收盘，因果） */
    var li = out[out.length - 1].i;
    if (n - 1 > li) out.push({ i: n - 1, px: a[n - 1], type: out[out.length - 1].type === 'T' ? 'B' : 'T', deg: 0 });

    /* ⑤ 每段角度（公式 θ=atan((MA_i−MA_j)/|MA_j|/(i−j)×100)×180/π） */
    for (var q = 1; q < out.length; q++) {
      var p0 = out[q - 1], p1 = out[q];
      var base = Math.abs(p0.px) > 1e-12 ? Math.abs(p0.px) : 1;
      var span = Math.max(1, p1.i - p0.i);
      var pct = (p1.px - p0.px) / base / span * 100;
      p1.deg = Math.atan(pct / 100) * RAD;
    }

    if (c) c[key] = out;
    return out;
  }

  /* ================================================================ 逐段角度（公式口径，供标注/分析） */
  function angles(bars, period) {
    var pv = pivots(bars, period), out = [];
    for (var k = 1; k < pv.length; k++) {
      var p0 = pv[k - 1], p1 = pv[k];
      var base = Math.abs(p0.px) > 1e-12 ? Math.abs(p0.px) : 1;
      var span = Math.max(1, p1.i - p0.i);
      var pct = (p1.px - p0.px) / base / span * 100;
      out.push({ i0: p0.i, i1: p1.i, px0: p0.px, px1: p1.px, span: span, pct: pct, deg: p1.deg });
    }
    return out;
  }

  /* ================================================================ 缠论线 → 逐根插值序列（MACD 标的，因果）
   *   相邻转折点之间是【一条直线】，段内按线性插值取每根的值。长度 === bars.length。 */
  function series(bars, period) {
    var c = cacheOf(bars);
    var key = 'sr' + period + '_' + params.minBars + '_v' + cacheVer;
    if (c && c[key]) return c[key];
    var pts = pivots(bars, period), n = bars.length, out = new Array(n);
    if (!pts.length) { out.fill(0); if (c) c[key] = out; return out; }
    var i, k;
    for (i = 0; i < pts[0].i; i++) out[i] = pts[0].px;
    for (k = 1; k < pts.length; k++) {
      var a = pts[k - 1], b = pts[k];
      var span = Math.max(1, b.i - a.i);
      for (i = a.i; i < b.i; i++) out[i] = a.px + (b.px - a.px) * (i - a.i) / span;
    }
    out[n - 1] = pts[pts.length - 1].px;
    if (c) c[key] = out;
    return out;
  }

  /* ================================================================ 主图绘制：4 条纯直线 + 图例（可选逐段角度标注）
   * env = { bars, startI, endI, x(absIdx)->cssX, y(price)->cssY,
   *         clip:{l,t,w,h}, legend:{x,y}, showAngles? } */
  function draw(ctx, env) {
    if (!ctx || !env || !env.bars || !env.bars.length) return;
    var bars = env.bars, sI = env.startI, eI = env.endI;
    var showA = (typeof env.showAngles === 'boolean') ? env.showAngles : params.showAngles;
    var Ls = list();
    if (!Ls.length) return;

    ctx.save();
    if (env.clip) {
      ctx.beginPath();
      ctx.rect(env.clip.l, env.clip.t, env.clip.w, env.clip.h);
      ctx.clip();
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    for (var q = 0; q < Ls.length; q++) {
      var L = Ls[q];
      var pts = pivots(bars, L.period);
      if (pts.length < 2) continue;
      ctx.strokeStyle = L.color;
      ctx.lineWidth = L.width;
      ctx.setLineDash(L.dash || []);

      var lo = 0, hi = pts.length - 1;
      while (lo < pts.length - 1 && pts[lo + 1].i < sI - 2) lo++;
      while (hi > 0 && pts[hi - 1].i > eI + 2) hi--;
      if (hi <= lo) continue;

      ctx.beginPath();
      var started = false;
      for (var k = lo; k <= hi; k++) {
        var px = env.x(pts[k].i), py = env.y(pts[k].px);
        if (!isFinite(px) || !isFinite(py)) continue;
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      if (started) ctx.stroke();
      ctx.setLineDash([]);

      /* 逐段角度标注（公式口径；开启后显示度数） */
      if (showA) {
        ctx.fillStyle = L.color;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (var m = Math.max(1, lo + 1); m <= hi; m++) {
          var p0 = pts[m - 1], p1 = pts[m];
          var mx = (env.x(p0.i) + env.x(p1.i)) / 2;
          var my = (env.y(p0.px) + env.y(p1.px)) / 2;
          if (!isFinite(mx) || !isFinite(my)) continue;
          var txt = (p1.deg >= 0 ? '+' : '') + p1.deg.toFixed(1) + '°';
          ctx.fillStyle = 'rgba(8,15,28,.78)';
          var w = ctx.measureText(txt).width + 6;
          ctx.fillRect(mx - w / 2, my - 7, w, 14);
          ctx.fillStyle = L.color;
          ctx.fillText(txt, mx, my);
        }
      }
    }
    ctx.restore();

    /* 图例（clip 外） */
    if (env.legend) {
      var lx = env.legend.x, ly = env.legend.y;
      ctx.save();
      ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (var m2 = 0; m2 < Ls.length; m2++) {
        var LL = Ls[m2], ox = lx + m2 * 88;
        ctx.strokeStyle = LL.color; ctx.lineWidth = 2; ctx.setLineDash(LL.dash || []);
        ctx.beginPath(); ctx.moveTo(ox, ly); ctx.lineTo(ox + 16, ly); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = LL.color; ctx.fillText(LL.name, ox + 20, ly);
      }
      ctx.restore();
    }
  }

  global.ChanLun = {
    register: register, unregister: unregister, list: list, get: get,
    setEnabled: setEnabled, onChange: onChange, offChange: offChange,
    setParam: setParam, getParams: getParams,
    ma: ma, pivots: pivots, angles: angles, series: series, draw: draw
  };
})(typeof window !== 'undefined' ? window : globalThis);
