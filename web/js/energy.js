/* ============================================================================
 * web/js/energy.js —— ★共享副图组件（2026-11-03 重构）
 * ----------------------------------------------------------------------------
 * 一份代码，BTC 总览 / 美股指数 / OKX 页 三处共用；每个面板在 K 线下方挂两个独立副图：
 *   ① MACD 副图   —— 参数固定 12/26/60；★标的 = 能量组件算出的能量序列 E
 *   ② 能量副图     —— 段能量 E_seg(段级 E=mc²) + 段速度/段质量 + 定积分面积 + 背驰标
 *
 * ★能量公式（用户 2026-11-03 指定，引擎在 web/js/energy-engine.js）：
 *   段速度  c_seg = (P₁−P₀)/P₀ ÷ Δt
 *   段质量  m_seg = mean(V_段)/mean(V_全)
 *   段能量  E_seg = m_seg · (c_seg×10000)²
 *   段来自共享缠论组件 global.Chan.segments()，段能量摊平到段内每根 → 逐根能量序列 E。
 *
 * ★热插拔：副图右上角有「模型 / Δt单位」两个下拉，切换即重算重绘（无刷新）；
 *   任何脚本也可 EnergyEngines.register({id,compute}) 注入新模型。
 *
 * 暴露：global.SubCharts  = { mount, sync, setHover, setBars, computeMacd, computeEnergy }
 *       global.Energy     = { compute, draw, mount, sync, setBars, detach }   (兼容旧调用)
 *       global.EnergyWidget = { create(container, opts) }                     (独立能量组件)
 * ========================================================================== */
(function (global) {
  'use strict';

  var RED = '#f0334b', GREEN = '#0bbf7a', BLUE = '#3d7bff', DIM = '#9fb0cc';
  var MACD_FAST = 12, MACD_SLOW = 26, MACD_SIGNAL = 60;   // ★用户指定 12/26/60
  var H_MACD = 110, H_ENERGY = 190;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmtNum(v) {
    if (v == null || !isFinite(v)) return '-';
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return v.toFixed(1);
  }
  function engines() { return global.EnergyEngines || null; }

  /* ================================================================ 能量计算（委托引擎） */
  function compute(bars, opt) {
    var EE = engines();
    if (EE) return EE.compute(bars || [], opt || {});
    return { empty: true, n: (bars || []).length };
  }

  /* ================================================================ MACD 计算 */
  // ★标的 = 能量序列 E（不是价格/涨家数）→ 对动能本身做 MACD(12/26/60)
  function computeMacd(bars, opt) {
    opt = opt || {};
    var energy = (opt && opt.energy && opt.energy.E) ? opt.energy : compute(bars, opt);
    var src = energy.E || [];
    var n = src.length;
    var emaS = function (per, series) {
      var k = 2 / (per + 1), p = null;
      return series.map(function (xv) {
        if (xv === null || xv === undefined || !isFinite(xv)) return (p === null ? null : p);
        p = (p === null) ? xv : xv * k + p * (1 - k);
        return p;
      });
    };
    var e12 = emaS(MACD_FAST, src), e26 = emaS(MACD_SLOW, src);
    var dif = e12.map(function (v, i) { return (v === null || e26[i] === null) ? null : (v - e26[i]); });
    var kS = 2 / (MACD_SIGNAL + 1), dea = null;
    var deaS = dif.map(function (xv) {
      if (xv === null || xv === undefined) return null;
      dea = (dea === null) ? xv : xv * kS + dea * (1 - kS);
      return dea;
    });
    var hist = dif.map(function (v, i) { return (v === null || deaS[i] === null) ? null : (v - deaS[i]) * 2; });
    return {
      n: n, dif: dif, dea: deaS, hist: hist, src: src,
      onEnergy: true,
      fast: MACD_FAST, slow: MACD_SLOW, signal: MACD_SIGNAL
    };
  }

  /* ================================================================ 绘制工具 */
  function prep(cv, W, H) {
    var dpr = global.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = '100%'; cv.style.height = H + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return ctx;
  }

  // 视图信息：与主图几何一致
  function viewOf(mainCv, sub) {
    var geo = mainCv.__geo || {};
    var st = mainCv._kst || {};
    var total = mainCv.__total || (sub && sub.data ? sub.data.n : 0);
    var vis = (st.vis | 0) > 0 ? (st.vis | 0) : 200;
    var off = (st.off | 0) > 0 ? (st.off | 0) : 0;
    var endI = total - off;
    var startI = Math.max(0, endI - vis);
    var W = mainCv.clientWidth || 600;
    var l = geo.l != null ? geo.l : 8;
    var r = 62;
    var plotW = Math.max(10, W - l - r);
    var bw = geo.bw || (plotW / Math.max(1, endI - startI));
    return { W: W, l: l, r: r, bw: bw, startI: startI, endI: endI, count: endI - startI, padL: l, padR: r };
  }

  function xAt(view, idx) { return view.l + (idx - view.startI + 0.5) * view.bw; }

  /* ================================================================ MA5 成分线（缠论 = MA5）
   * 把 MA5 按自身可见区范围归一化后画成斜率着色直线（涨红/跌绿），作能量/MACD 副图的成分叠加。
   * bars 缺失（独立组件未给 bars）时静默跳过。 */
  function ma5Overlay(ctx, bars, view, H, padT, padB, label) {
    if (!bars || !global.Chan || typeof global.Chan.ma5 !== 'function') return;
    var ma = global.Chan.ma5(bars);
    if (!ma || !ma.length) return;
    var startI = view.startI, endI = view.endI, i;
    var mn = Infinity, mx = -Infinity;
    for (i = startI; i < endI; i++) { var v = ma[i]; if (v == null || !isFinite(v)) continue; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (!isFinite(mn)) return;
    if (mx - mn < 1e-12) { mn -= 1; mx += 1; }
    var pT = padT + 2, pB = H - padB - 2;
    function Ym(val) { return pB - (val - mn) / (mx - mn) * (pB - pT); }
    ctx.save();
    ctx.lineWidth = 1.3; ctx.lineJoin = 'round';
    var started = false, prevX = 0, prevY = 0, prevV = 0;
    for (i = Math.max(0, startI); i < endI; i++) {
      var vv = ma[i]; if (vv == null || !isFinite(vv)) { started = false; continue; }
      var xx = xAt(view, i), yy = Ym(vv);
      if (!started) { prevX = xx; prevY = yy; prevV = vv; started = true; continue; }
      ctx.strokeStyle = (vv >= prevV) ? RED : GREEN;   // 涨红/跌绿（按 MA5 斜率）
      ctx.beginPath(); ctx.moveTo(prevX, prevY); ctx.lineTo(xx, yy); ctx.stroke();
      prevX = xx; prevY = yy; prevV = vv;
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(240,51,75,.9)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(label || 'MA5·缠论', view.l, padT + 8);
  }

  /* ------------------------------------------------------- MACD 副图绘制 */
  function drawMacd(cv, data, view, hoverIdx, bars) {
    var W = view.W, H = H_MACD;
    var ctx = prep(cv, W, H);
    var padT = 15, padB = 6;
    var plotH = Math.max(20, H - padT - padB);
    var i, startI = view.startI, endI = view.endI;

    if (!data || data.n < 3) {
      ctx.fillStyle = DIM; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('MACD 数据不足', view.l, 11);
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

    ctx.textAlign = 'left'; ctx.font = '11px sans-serif';
    ctx.fillStyle = DIM;
    ctx.fillText('MACD(' + data.fast + ',' + data.slow + ',' + data.signal + ') · 标的=能量E', view.l, 11);

    if (hoverIdx != null && hoverIdx >= startI && hoverIdx < endI) {
      var dv = data.dif[hoverIdx], de = data.dea[hoverIdx], hv = data.hist[hoverIdx];
      var txt = 'DIF ' + (dv == null ? '-' : dv.toFixed(2)) +
        '  DEA ' + (de == null ? '-' : de.toFixed(2)) +
        '  MACD ' + (hv == null ? '-' : hv.toFixed(2));
      ctx.fillStyle = '#cfe0ff';
      ctx.fillText(txt, view.l + 205, 11);
    }

    ctx.strokeStyle = 'rgba(140,148,173,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(view.l, zeroY); ctx.lineTo(W - view.r, zeroY); ctx.stroke();

    var cw = Math.max(1, Math.min(12, view.bw * 0.62));
    for (i = startI; i < endI; i++) {
      var h = data.hist[i]; if (h == null || !isFinite(h)) continue;
      var y1 = Y(h);
      ctx.fillStyle = (h >= 0) ? 'rgba(240,51,75,.75)' : 'rgba(11,191,122,.75)';
      ctx.fillRect(xAt(view, i) - cw / 2, Math.min(y1, zeroY), cw, Math.max(1, Math.abs(y1 - zeroY)));
    }
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
    poly(data.dif, '#f0a020');
    poly(data.dea, BLUE);

    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(159,176,204,.75)'; ctx.font = '10px sans-serif';
    ctx.fillText(fmtNum(mx), W - view.r + 4, padT + 8);
    ctx.fillText(fmtNum(mn), W - view.r + 4, padT + plotH);

    if (hoverIdx != null && hoverIdx >= startI && hoverIdx < endI) {
      var hx = xAt(view, hoverIdx);
      ctx.strokeStyle = 'rgba(200,214,255,.45)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
    }

    /* ★MA5·缠论 成分线（归一化叠加，涨红跌绿） */
    ma5Overlay(ctx, bars, view, H, padT, padB, 'MA5·缠论');
  }

  /* ------------------------------------------------------ 能量副图绘制（段级） */
  function drawEnergy(cv, data, view, hoverIdx, bars) {
    var W = view.W, H = H_ENERGY;
    var ctx = prep(cv, W, H);
    var padT = 16, padB = 8;
    var plotH = Math.max(20, H - padT - padB);
    var i, startI = view.startI, endI = view.endI;

    if (!data || data.empty) {
      ctx.fillStyle = DIM; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('⚡ 能量数据不足', view.l, 12);
      return;
    }

    /* ---- 上区：段能量柱 + 段速度线 ---- */
    var eH = Math.round(plotH * 0.58);
    var eTop = padT, eBase = padT + eH;
    var eMax = 0;
    for (i = startI; i < endI; i++) if (data.E[i] > eMax) eMax = data.E[i];
    if (!(eMax > 0)) eMax = 1;
    var cw = Math.max(1, Math.min(14, view.bw * 0.66));

    /* 段速度范围（右轴） */
    var cMin = Infinity, cMax = -Infinity;
    for (i = startI; i < endI; i++) {
      var cvv = data.cSeg ? data.cSeg[i] : 0;
      if (!isFinite(cvv)) continue;
      if (cvv < cMin) cMin = cvv; if (cvv > cMax) cMax = cvv;
    }
    if (!isFinite(cMin)) { cMin = -1; cMax = 1; }
    if (cMax - cMin < 1e-12) { cMin -= 1; cMax += 1; }
    var cPad = (cMax - cMin) * 0.12; cMin -= cPad; cMax += cPad;
    function Yc(val) { return eTop + (1 - (val - cMin) / (cMax - cMin)) * (eH - 2); }

    /* ---- 下区：定积分面积 ---- */
    var aTop = eBase + 6, aBot = padT + plotH;
    var aH = Math.max(10, aBot - aTop);
    var mn = Infinity, mx = -Infinity;
    for (i = startI; i < endI; i++) { if (data.cum[i] < mn) mn = data.cum[i]; if (data.cum[i] > mx) mx = data.cum[i]; }
    if (!isFinite(mn)) { mn = -1; mx = 1; }
    if (mx - mn < 1e-9) { mn -= 1; mx += 1; }
    var pd = (mx - mn) * 0.08; mn -= pd; mx += pd;
    function Y(val) { return aTop + (1 - (val - mn) / (mx - mn)) * aH; }
    var zeroY = Y(0);

    /* ---- 标题 ---- */
    ctx.textAlign = 'left'; ctx.fillStyle = DIM; ctx.font = '11px sans-serif';
    var mName = data.modelName || data.model || '';
    ctx.fillText('⚡ 能量 ' + mName + ' · E_seg=m_seg·(c_seg×10000)² · c_seg=(P₁−P₀)/P₀÷Δt', view.l, 11);
    ctx.textAlign = 'right';
    var z = data.z != null ? data.z : 0;
    ctx.fillStyle = z >= 0 ? RED : GREEN;
    ctx.fillText((z >= 0 ? '▲偏涨' : '▼偏跌') + ' z=' + (z >= 0 ? '+' : '') + z.toFixed(2) +
      '  净能 ' + fmtNum(data.net), W - 6, 11);

    /* 上区基线 */
    ctx.strokeStyle = 'rgba(140,148,173,.30)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(view.l, eBase + 0.5); ctx.lineTo(W - view.r, eBase + 0.5); ctx.stroke();

    /* 段能量柱（段能量摊平到段内每根） */
    for (i = startI; i < endI; i++) {
      var val = data.E[i]; if (!(val > 0)) continue;
      var up = (data.cSeg ? data.cSeg[i] : 0) >= 0;
      var hgt = (val / eMax) * (eH - 2);
      ctx.fillStyle = up ? 'rgba(240,51,75,.55)' : 'rgba(11,191,122,.55)';
      ctx.fillRect(xAt(view, i) - cw / 2, eBase - hgt, cw, hgt);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(159,176,204,.75)'; ctx.font = '10px sans-serif';
    ctx.fillText('E' + fmtNum(eMax), W - view.r + 4, eTop + 9);

    /* 段速度线（右轴） */
    if (data.cSeg) {
      ctx.beginPath();
      var started = false;
      for (i = startI; i < endI; i++) {
        var cs = data.cSeg[i];
        if (cs == null || !isFinite(cs)) { started = false; continue; }
        var xs = xAt(view, i), ys = Yc(cs);
        if (!started) { ctx.moveTo(xs, ys); started = true; } else ctx.lineTo(xs, ys);
      }
      ctx.strokeStyle = '#f0a020'; ctx.lineWidth = 1.3; ctx.stroke();
    }
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(240,160,32,.85)'; ctx.font = '10px sans-serif';
    ctx.fillText('c' + fmtNum(cMax * 10000), W - view.r + 4, eTop + 21);

    /* 下区零线 + 面积 */
    ctx.strokeStyle = 'rgba(140,148,173,.35)';
    ctx.beginPath(); ctx.moveTo(view.l, zeroY); ctx.lineTo(W - view.r, zeroY); ctx.stroke();
    for (i = Math.max(startI, 1); i < endI; i++) {
      var x0 = xAt(view, i - 1), y0 = Y(data.cum[i - 1]), x1 = xAt(view, i), y1 = Y(data.cum[i]);
      ctx.beginPath();
      ctx.moveTo(x0, zeroY); ctx.lineTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1, zeroY); ctx.closePath();
      ctx.fillStyle = (data.cum[i] >= 0) ? 'rgba(240,51,75,.18)' : 'rgba(11,191,122,.18)';
      ctx.fill();
    }
    ctx.beginPath();
    for (i = startI; i < endI; i++) {
      var xx = xAt(view, i), yy = Y(data.cum[i]);
      if (i === startI) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.strokeStyle = BLUE; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(159,176,204,.75)'; ctx.font = '10px sans-serif';
    ctx.fillText('S' + fmtNum(data.cum[endI - 1]), W - view.r + 4, aTop + 9);

    /* 背驰标 */
    ctx.font = '10px sans-serif';
    for (i = 0; i < (data.divs || []).length; i++) {
      var dv = data.divs[i];
      if (dv.idx < startI || dv.idx >= endI) continue;
      var dx = xAt(view, dv.idx), col = dv.dir > 0 ? RED : GREEN;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(dx, eBase - 6, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(dx, eBase - 6); ctx.lineTo(dx, aTop + 6); ctx.stroke();
      ctx.textAlign = (dx > W - view.r - 40) ? 'right' : 'left';
      ctx.fillText(dv.type, dx + (ctx.textAlign === 'right' ? -5 : 5), eTop + 9);
    }

    /* 悬停读数 */
    if (hoverIdx != null && hoverIdx >= startI && hoverIdx < endI) {
      var hx = xAt(view, hoverIdx);
      ctx.strokeStyle = 'rgba(200,214,255,.45)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      var hE = data.E[hoverIdx], hS = data.cum[hoverIdx];
      var hC = data.cSeg ? data.cSeg[hoverIdx] : null;
      var hM = data.mSeg ? data.mSeg[hoverIdx] : null;
      ctx.textAlign = (hx > W - 240) ? 'right' : 'left';
      ctx.fillStyle = '#cfe0ff'; ctx.font = '10px sans-serif';
      ctx.fillText('E ' + (hE == null ? '-' : hE.toFixed(1)) +
        '  c_seg ' + (hC == null ? '-' : (hC * 10000).toFixed(2)) +
        '  m_seg ' + (hM == null ? '-' : hM.toFixed(2)) +
        '  S ' + (hS == null ? '-' : hS.toFixed(2)), hx + (ctx.textAlign === 'right' ? -5 : 5), padT + 11);
    }

    /* ★MA5·缠论 成分线（归一化叠加，涨红跌绿） */
    ma5Overlay(ctx, bars, view, H, padT, padB, 'MA5·缠论');
  }

  /* ================================================================ 挂载/同步 */
  var MOUNTED = [];                     // 已挂载的 mainCv 列表（模型切换时全部重算）

  function ensureCanvas(container, cls, h) {
    var cv = container.querySelector('canvas.' + cls);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.className = 'sc-cv ' + cls;
      cv.style.cssText = 'width:100%;height:' + h + 'px;display:block;background:#0e1422;border-radius:8px;margin-top:6px';
      container.appendChild(cv);
    }
    return cv;
  }

  /* ★热插拔控件：模型下拉 + Δt单位下拉（切换即重算全部已挂载副图） */
  function ensureToolbar(container) {
    var EE = engines();
    if (!EE) return null;
    if (container.__enTool) return container.__enTool;
    var bar = document.createElement('div');
    bar.className = 'energy-toolbar';
    /* ★放在容器右下角(能量副图底部空白区) —— 顶部会遮挡 MACD/能量副图的标题与读数 */
    bar.style.cssText = 'position:absolute;right:68px;bottom:2px;z-index:8;display:flex;gap:5px;align-items:center;font-size:11px;line-height:18px';
    var sel = document.createElement('select');
    sel.className = 'energy-model-sel';
    sel.style.cssText = SEL_STYLE;
    var usel = document.createElement('select');
    usel.className = 'energy-unit-sel';
    usel.style.cssText = SEL_STYLE;
    bar.appendChild(sel); bar.appendChild(usel);
    container.appendChild(bar);

    function fillModels() {
      var cur = EE.currentId();
      sel.innerHTML = '';
      var lst = EE.list();
      for (var i = 0; i < lst.length; i++) {
        var o = document.createElement('option');
        o.value = lst[i].id; o.textContent = lst[i].name;
        if (lst[i].id === cur) o.selected = true;
        sel.appendChild(o);
      }
      /* ★单一能量组件时隐藏「模型」下拉（将来热插拔新模型后自动出现） */
      sel.style.display = (lst.length <= 1) ? 'none' : '';
    }
    function fillUnits() {
      var cur = (EE.getParams() || {}).dtUnit || 'h';
      usel.innerHTML = '';
      var units = [{ k: 'h', t: 'Δt=时' }, { k: 'min', t: 'Δt=分' }, { k: 's', t: 'Δt=秒' }, { k: 'd', t: 'Δt=日' }];
      for (var i = 0; i < units.length; i++) {
        var o = document.createElement('option');
        o.value = units[i].k; o.textContent = units[i].t;
        if (units[i].k === cur) o.selected = true;
        usel.appendChild(o);
      }
    }
    fillModels(); fillUnits();

    sel.addEventListener('change', function () {
      EE.use(sel.value);
      refreshAll();
    });
    usel.addEventListener('change', function () {
      EE.setParam('dtUnit', usel.value);
      refreshAll();
    });

    container.__enTool = { bar: bar, sel: sel, usel: usel, fill: function () { fillModels(); fillUnits(); } };
    return container.__enTool;
  }
  var SEL_STYLE = 'background:#131a2b;color:#cfe0ff;border:1px solid #2b3a55;border-radius:5px;font-size:11px;padding:1px 3px;cursor:pointer;max-width:130px';

  /* 全部已挂载副图重算重绘 */
  function refreshAll() {
    for (var i = 0; i < MOUNTED.length; i++) {
      var S = MOUNTED[i];
      if (!S) continue;
      S.energy.data = compute(S.bars, S.opt);
      S.macd.data = computeMacd(S.bars, { energy: S.energy.data });
      sync(S.mainCv);
    }
    /* 热插拔新模型后刷新各工具栏下拉（模型数变化时显示/隐藏模型选择器） */
    for (var k = 0; k < MOUNTED.length; k++) {
      var box = MOUNTED[k] && MOUNTED[k].container;
      if (box && box.__enTool && box.__enTool.fill) box.__enTool.fill();
    }
    if (global.EnergyWidget && typeof global.EnergyWidget.refreshAll === 'function') global.EnergyWidget.refreshAll();
  }

  // mount(mainCv, container, bars, opt) —— opt: {label}
  function mount(mainCv, container, bars, opt) {
    if (!mainCv || !container) return null;
    var o = opt || {};
    var macdCv = ensureCanvas(container, 'sc-macd', H_MACD);
    var enCv = ensureCanvas(container, 'sc-energy', H_ENERGY);
    /* 工具栏需相对定位容器 */
    if (container.style && (!container.style.position || container.style.position === 'static')) {
      container.style.position = 'relative';
    }
    ensureToolbar(container);
    var enData = compute(bars || [], o);
    var macdData = computeMacd(bars || [], { energy: enData });
    mainCv.__sub = {
      mainCv: mainCv,
      container: container,
      bars: bars || [],
      opt: o,
      macd: { cv: macdCv, data: macdData },
      energy: { cv: enCv, data: enData },
      hover: null
    };
    if (MOUNTED.indexOf(mainCv.__sub) < 0) MOUNTED.push(mainCv.__sub);
    sync(mainCv);
    return mainCv.__sub;
  }

  function setBars(mainCv, bars, opt) {
    if (!mainCv || !mainCv.__sub) return null;
    var S = mainCv.__sub;
    S.bars = bars || [];
    if (opt) S.opt = opt;
    S.energy.data = compute(S.bars, S.opt);
    S.macd.data = computeMacd(S.bars, { energy: S.energy.data });
    sync(mainCv);
    return S;
  }

  // sync(mainCv) —— 主图每次重绘后调用，按主图视口重画两副图
  function sync(mainCv) {
    var S = mainCv && mainCv.__sub;
    if (!S) return;
    var view = viewOf(mainCv, S.energy);
    drawMacd(S.macd.cv, S.macd.data, view, S.hover, S.bars);
    drawEnergy(S.energy.cv, S.energy.data, view, S.hover, S.bars);
    /* ★共享买多/卖空信号：在每个主图重绘后叠加（基于能量副图背驰，所有页面/合约/指数共用） */
    if (global.Signals && typeof global.Signals.drawOnChart === 'function') {
      try { global.Signals.drawOnChart(mainCv, S.bars); } catch (e) { /* 信号不影响主图 */ }
    }
  }

  // setHover(mainCv, idx) —— 光标联动（idx 为全量索引；null 取消）
  function setHover(mainCv, idx) {
    var S = mainCv && mainCv.__sub;
    if (!S) return;
    if (S.hover === idx) return;
    S.hover = (idx == null) ? null : (idx | 0);
    sync(mainCv);
  }

  function detach(mainCv) {
    if (mainCv) delete mainCv.__sub;
    for (var i = MOUNTED.length - 1; i >= 0; i--) if (!MOUNTED[i].mainCv || MOUNTED[i].mainCv.__sub !== MOUNTED[i]) MOUNTED.splice(i, 1);
  }

  /* ================================================================ 独立能量组件
   * global.EnergyWidget.create(container, opts)
   *   container: 任意 DOM 容器（组件自建 canvas + 工具栏）
   *   opts: { bars, label, height, onChange }
   */
  var WIDGETS = [];
  var EnergyWidget = {
    create: function (container, opts) {
      if (!container) return null;
      opts = opts || {};
      var H = opts.height || H_ENERGY;
      var cv = document.createElement('canvas');
      cv.className = 'sc-cv energy-widget-cv';
      cv.style.cssText = 'width:100%;height:' + H + 'px;display:block;background:#0e1422;border-radius:8px';
      container.appendChild(cv);
      if (container.style && (!container.style.position || container.style.position === 'static')) {
        container.style.position = 'relative';
      }
      var tool = ensureToolbar(container);
      var w = {
        cv: cv, container: container, bars: opts.bars || [], opt: opts, hover: null,
        setBars: function (bars) {
          w.bars = bars || [];
          w.redraw();
          return w;
        },
        redraw: function () {
          var data = compute(w.bars, w.opt);
          var view = { W: cv.clientWidth || 600, l: 8, r: 62, bw: 4, startI: 0, endI: data.n || 0, count: data.n || 0 };
          var bw = (view.W - view.l - view.r) / Math.max(1, view.count);
          view.bw = Math.max(1, bw);
          drawEnergy(cv, data, view, w.hover, w.bars);
          w.data = data;
          if (opts.onChange) { try { opts.onChange(data); } catch (e) { } }
          return w;
        },
        setHover: function (idx) { w.hover = idx; w.redraw(); },
        destroy: function () {
          try { container.removeChild(cv); } catch (e) { }
          var i = WIDGETS.indexOf(w); if (i >= 0) WIDGETS.splice(i, 1);
        }
      };
      WIDGETS.push(w);
      w.redraw();
      return w;
    },
    refreshAll: function () {
      for (var i = 0; i < WIDGETS.length; i++) { try { WIDGETS[i].redraw(); } catch (e) { } }
    }
  };

  global.SubCharts = {
    mount: mount, sync: sync, setHover: setHover, setBars: setBars,
    computeMacd: computeMacd, computeEnergy: compute,
    refreshAll: refreshAll,
    MACD_FAST: MACD_FAST, MACD_SLOW: MACD_SLOW, MACD_SIGNAL: MACD_SIGNAL
  };
  global.Energy = {
    compute: compute, draw: drawEnergy,
    mount: function (mainCv, ecv, bars, opt) {
      if (!mainCv) return null;
      var box = ecv.parentNode;
      if (!box) return null;
      return mount(mainCv, box, bars, opt);
    },
    sync: sync, setBars: setBars, detach: detach, refreshAll: refreshAll
  };
  global.EnergyWidget = EnergyWidget;

  /* 引擎变化 → 全部副图重算（热插拔的最后一环） */
  var EE = engines();
  if (EE && typeof EE.onChange === 'function') {
    EE.onChange(function () { refreshAll(); });
  }
})(typeof window !== 'undefined' ? window : globalThis);
