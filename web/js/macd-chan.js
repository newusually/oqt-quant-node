/* ============================================================================
 * web/js/macd-chan.js —— ★MA5 的 MACD 共享组件 + SubCharts 编排（2026-11-04 二轮定稿）
 * ----------------------------------------------------------------------------
 * 用户二轮定稿：总览上的两个 K 线图「只保留 macd ma5 的这个副图，其他都删除，不需要」。
 *   → 唯一挂载的副图组件：macd5
 *       · 参数固定 MACD(12, 26, 60)
 *       · 标的 = MA5 缠论线(ChanLun.series(bars, 5)，转折点直连的直线段插值序列)
 *       · 颜色 = MA5 缠论线红 #f0334b
 *   → macd20 / macd30 / macd60 组件已整体删除（不再定义、不再注册、不再挂载）。
 * 共享特性（保留）：
 *   - 统一注册表 MACDComponents（register/unregister/list，仍可热插拔挂别的副图）
 *   - 统一视口 viewOf（与主图 __geo/_kst 对齐）→ 拖动/缩放同步
 *   - 统一光标 setHover(mainCv, idx) → 主图 + 副图光标完全一致
 *
 * 暴露：global.MACD5
 *       global.MACDComponents = { register, unregister, list, get }
 *       global.SubCharts = { mount, sync, setHover, setBars, refreshAll, detach, components }
 * ========================================================================== */
(function (global) {
  'use strict';

  var FAST = 12, SLOW = 26, SIGNAL = 60;      // ★用户指定 12 / 26 / 60
  var H_SUB = 104;                            // 单个 MACD 副图高度
  var RED = '#f0334b', GREEN = '#0bbf7a', BLUE = '#3d7bff', DIM = '#9fb0cc';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmtNum(v) {
    if (v == null || !isFinite(v)) return '-';
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return v.toFixed(1);
  }

  /* ================================================================ 视口（与主图几何一致，副图共用） */
  function viewOf(mainCv) {
    var geo = mainCv.__geo || {};
    var st = mainCv._kst || {};
    var total = mainCv.__total || 0;
    var vis = (st.vis | 0) > 0 ? (st.vis | 0) : 200;
    var off = (st.off | 0) > 0 ? (st.off | 0) : 0;
    var endI = total - off;
    var startI = Math.max(0, endI - vis);
    var W = mainCv.clientWidth || 600;
    var l = geo.l != null ? geo.l : 8;
    var r = 62;
    var plotW = Math.max(10, W - l - r);
    var bw = geo.bw || (plotW / Math.max(1, endI - startI));
    return { W: W, l: l, r: r, bw: bw, startI: startI, endI: endI, count: endI - startI };
  }
  function xAt(view, idx) { return view.l + (idx - view.startI + 0.5) * view.bw; }

  function prep(cv, W, H) {
    var dpr = global.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = '100%'; cv.style.height = H + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return ctx;
  }

  /* ================================================================ MACD 计算（每个组件独立调用） */
  function emaS(per, series) {
    var k = 2 / (per + 1), p = null;
    return series.map(function (xv) {
      if (xv === null || xv === undefined || !isFinite(xv)) return (p === null ? null : p);
      p = (p === null) ? xv : xv * k + p * (1 - k);
      return p;
    });
  }

  function computeFor(bars, period) {
    /* 标的 = 该周期缠论线（直线段插值的逐根序列） */
    var src;
    if (global.ChanLun && typeof global.ChanLun.series === 'function') {
      try { src = global.ChanLun.series(bars || [], period); } catch (e) { src = null; }
    }
    if (!src || !src.length) src = (bars || []).map(function (b) { return +b.c; });
    var n = src.length;
    var e12 = emaS(FAST, src), e26 = emaS(SLOW, src);
    var dif = e12.map(function (v, i) { return (v === null || e26[i] === null) ? null : (v - e26[i]); });
    var kS = 2 / (SIGNAL + 1), dea = null;
    var deaS = dif.map(function (xv) {
      if (xv === null || xv === undefined) return null;
      dea = (dea === null) ? xv : xv * kS + dea * (1 - kS);
      return dea;
    });
    var hist = dif.map(function (v, i) { return (v === null || deaS[i] === null) ? null : (v - deaS[i]) * 2; });
    return {
      n: n, dif: dif, dea: deaS, hist: hist, src: src,
      period: period, fast: FAST, slow: SLOW, signal: SIGNAL,
      onChanLun: true
    };
  }

  /* ================================================================ 单个 MACD 组件绘制 */
  function drawOne(comp, cv, data, view, hoverIdx) {
    var W = view.W, H = H_SUB;
    var ctx = prep(cv, W, H);
    var padT = 15, padB = 6, plotH = Math.max(20, H - padT - padB);
    var startI = view.startI, endI = view.endI, i;

    if (!data || data.n < 3) {
      ctx.fillStyle = DIM; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(comp.title + ' 数据不足', view.l, 11);
      return;
    }

    var mn = Infinity, mx = -Infinity;
    for (i = startI; i < endI; i++) {
      var a = data.dif[i], b = data.dea[i], c = data.hist[i];
      if (a != null && isFinite(a)) { if (a < mn) mn = a; if (a > mx) mx = a; }
      if (b != null && isFinite(b)) { if (b < mn) mn = b; if (b > mx) mx = b; }
      if (c != null && isFinite(c)) { if (c < mn) mn = c; if (c > mx) mx = c; }
    }
    if (!isFinite(mn)) { mn = -1; mx = 1; }
    if (mx - mn < 1e-9) { mn -= 1; mx += 1; }
    var pad = (mx - mn) * 0.12; mn -= pad; mx += pad;
    function Y(val) { return padT + (1 - (val - mn) / (mx - mn)) * plotH; }
    var zeroY = Y(0);

    /* 标题：组件 id + 标的缠论线 + 参数 */
    ctx.textAlign = 'left'; ctx.font = '11px sans-serif';
    ctx.fillStyle = comp.color;
    ctx.fillText(comp.id + ' (' + FAST + ',' + SLOW + ',' + SIGNAL + ') · 标的=MA' + comp.period + '缠论线', view.l, 11);

    if (hoverIdx != null && hoverIdx >= startI && hoverIdx < endI) {
      var dv = data.dif[hoverIdx], de = data.dea[hoverIdx], hv = data.hist[hoverIdx];
      var txt = 'DIF ' + (dv == null ? '-' : dv.toFixed(2)) +
        '  DEA ' + (de == null ? '-' : de.toFixed(2)) +
        '  MACD ' + (hv == null ? '-' : hv.toFixed(2));
      ctx.fillStyle = '#cfe0ff';
      ctx.fillText(txt, view.l + 235, 11);
    }

    /* 零线 */
    ctx.strokeStyle = 'rgba(140,148,173,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(view.l, zeroY); ctx.lineTo(W - view.r, zeroY); ctx.stroke();

    /* HIST 柱（涨红跌绿） */
    var cw = Math.max(1, Math.min(12, view.bw * 0.62));
    for (i = startI; i < endI; i++) {
      var h = data.hist[i]; if (h == null || !isFinite(h)) continue;
      var y1 = Y(h);
      ctx.fillStyle = (h >= 0) ? 'rgba(240,51,75,.75)' : 'rgba(11,191,122,.75)';
      ctx.fillRect(xAt(view, i) - cw / 2, Math.min(y1, zeroY), cw, Math.max(1, Math.abs(y1 - zeroY)));
    }

    /* DIF / DEA 曲线（副图内允许曲线；缠论线在主图是纯直线，不冲突） */
    function poly(arr, color) {
      ctx.beginPath();
      var started = false;
      for (i = startI; i < endI; i++) {
        var v = arr[i]; if (v == null || !isFinite(v)) { started = false; continue; }
        var x = xAt(view, i), y = Y(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.stroke();
    }
    poly(data.dif, comp.color);      // DIF 用组件色（各副图不同）
    poly(data.dea, BLUE);

    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(159,176,204,.75)'; ctx.font = '10px sans-serif';
    ctx.fillText(fmtNum(mx), W - view.r + 4, padT + 8);
    ctx.fillText(fmtNum(mn), W - view.r + 4, padT + plotH);

    /* ★统一光标：与主图同一个 hoverIdx 画竖线 → 主图 + 副图光标一致 */
    if (hoverIdx != null && hoverIdx >= startI && hoverIdx < endI) {
      var hx = xAt(view, hoverIdx);
      ctx.strokeStyle = 'rgba(200,214,255,.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = comp.color;
      ctx.beginPath(); ctx.arc(hx, Y(data.dif[hoverIdx] == null ? 0 : data.dif[hoverIdx]), 2.8, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ================================================================ 组件工厂（可 register 扩展，默认仅 macd5） */
  function makeComponent(id, period, color, title) {
    var comp = {
      id: id, period: period, color: color, title: title,
      canvasClass: 'sc-' + id,
      height: H_SUB,
      fast: FAST, slow: SLOW, signal: SIGNAL,
      compute: function (bars) { return computeFor(bars, comp.period); },
      draw: function (cv, data, view, hoverIdx) { return drawOne(comp, cv, data, view, hoverIdx); }
    };
    return comp;
  }

  /* ★2026-11-04 二轮定稿：只保留 MA5 的 MACD 副图，其余 3 个组件整体删除 */
  var MACD5 = makeComponent('macd5', 5, '#f0334b', 'MACD5 · MA5 缠论线');

  /* 独立全局：唯一挂载的副图组件 */
  global.MACD5 = MACD5;

  /* 统一注册表（热插拔）：增删组件后 refreshAll 即全站生效 */
  var registry = {}, order = [];
  function register(comp) {
    if (!comp || !comp.id || typeof comp.compute !== 'function' || typeof comp.draw !== 'function') return null;
    if (!registry[comp.id]) order.push(comp.id);
    registry[comp.id] = comp;
    return comp;
  }
  function unregister(id) { if (!registry[id]) return false; delete registry[id]; order = order.filter(function (x) { return x !== id; }); return true; }
  function list() { return order.map(function (id) { return registry[id]; }); }
  function get(id) { return registry[id] || null; }
  [MACD5].forEach(register);          // ★只挂载 macd5，其他副图全部删除
  global.MACDComponents = { register: register, unregister: unregister, list: list, get: get };

  /* ================================================================ SubCharts 编排 */
  var MOUNTED = [];

  function ensureCanvas(container, comp) {
    var cv = container.querySelector('canvas.' + comp.canvasClass);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.className = 'sc-cv ' + comp.canvasClass;
      cv.style.cssText = 'width:100%;height:' + comp.height + 'px;display:block;background:#0e1422;border-radius:8px;margin-top:6px';
      container.appendChild(cv);
    }
    return cv;
  }

  /* 删除旧副图（能量 / 旧单 MACD / 能量工具栏 / 已废弃的 macd20/30/60） */
  function cleanupOld(container) {
    var sels = ['canvas.sc-energy', 'canvas.sc-macd', 'canvas.energy-widget-cv', '.energy-toolbar',
      'canvas.sc-macd20', 'canvas.sc-macd30', 'canvas.sc-macd60'];
    for (var i = 0; i < sels.length; i++) {
      var nodes = container.querySelectorAll(sels[i]);
      for (var k = 0; k < nodes.length; k++) {
        try { nodes[k].parentNode.removeChild(nodes[k]); } catch (e) { }
      }
    }
  }

  function buildComps(container, bars) {
    return list().map(function (comp) {
      var cv = ensureCanvas(container, comp);
      return { comp: comp, cv: cv, data: comp.compute(bars) };
    });
  }

  function mount(mainCv, container, bars, opt) {
    if (!mainCv || !container) return null;
    var o = opt || {};
    /* ★优先用主图归一化后的 bars（drawKline 的 normBars 去重结果）→ 主/副图索引与光标完全一致 */
    var B = mainCv.__barsAll && mainCv.__barsAll.length ? mainCv.__barsAll : (bars || []);
    cleanupOld(container);
    if (container.style && (!container.style.position || container.style.position === 'static')) {
      container.style.position = 'relative';
    }
    var comps = buildComps(container, B);
    /* ★hover 持久化在 canvas 上：KChart 每次 _mountSub 会重建 __sub，不能让光标丢失 */
    var S = {
      mainCv: mainCv, container: container, bars: B, opt: o,
      comps: comps, hover: (mainCv.__hover != null ? mainCv.__hover : null)
    };
    mainCv.__sub = S;
    if (MOUNTED.indexOf(S) < 0) MOUNTED.push(S);
    sync(mainCv);
    return S;
  }

  function setBars(mainCv, bars, opt) {
    if (!mainCv || !mainCv.__sub) return mount(mainCv, mainCv.__sub && mainCv.__sub.container, bars, opt);
    var S = mainCv.__sub;
    /* ★同样优先用主图归一化 bars，保证索引/光标一致 */
    S.bars = (mainCv.__barsAll && mainCv.__barsAll.length) ? mainCv.__barsAll : (bars || S.bars);
    if (opt) S.opt = opt;
    /* 组件注册表可能变了，重建 comps */
    S.comps = buildComps(S.container, S.bars);
    sync(mainCv);
    return S;
  }

  /* sync：一个视口 + 一个 hover 广播给全部组件 → 光标一致 */
  function sync(mainCv) {
    var S = mainCv && mainCv.__sub;
    if (!S || !S.comps) return;
    /* ★统一以 canvas 上的 __hover 为准（主图 + 副图共用同一个光标索引） */
    var hv = (mainCv.__hover != null) ? mainCv.__hover : S.hover;
    S.hover = hv;
    var view = viewOf(mainCv);
    for (var i = 0; i < S.comps.length; i++) {
      var c = S.comps[i];
      try { c.comp.draw(c.cv, c.data, view, hv); } catch (e) { }
    }
  }

  function setHover(mainCv, idx) {
    if (!mainCv) return;
    var S = mainCv.__sub;
    var v = (idx == null) ? null : (idx | 0);
    mainCv.__hover = v;                       // ★持久化：__sub 重建后仍能恢复
    if (S) S.hover = v;
    sync(mainCv);
  }

  function refreshAll() {
    for (var i = 0; i < MOUNTED.length; i++) {
      var S = MOUNTED[i];
      if (!S || !S.container) continue;
      cleanupOld(S.container);
      S.comps = buildComps(S.container, S.bars);
      sync(S.mainCv);
    }
  }

  function detach(mainCv) {
    if (mainCv) delete mainCv.__sub;
    for (var i = MOUNTED.length - 1; i >= 0; i--) {
      if (!MOUNTED[i].mainCv || MOUNTED[i].mainCv.__sub !== MOUNTED[i]) MOUNTED.splice(i, 1);
    }
  }

  global.SubCharts = {
    mount: mount, sync: sync, setHover: setHover, setBars: setBars,
    refreshAll: refreshAll, detach: detach,
    viewOf: viewOf, computeMacd: computeFor,
    components: global.MACDComponents,
    FAST: FAST, SLOW: SLOW, SIGNAL: SIGNAL
  };
})(typeof window !== 'undefined' ? window : globalThis);
