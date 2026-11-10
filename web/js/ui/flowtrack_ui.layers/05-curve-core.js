  /* ======================= 盈利曲线：自绘 Canvas 视口组件 ======================= */
  function cclamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function curveMinOff() { return -RIGHT_PAD; }
  function curveMaxOff() { return Math.max(0, lastCurve.length - (curveState.vis | 0)); }
  function curveStep() { return Math.max(3, Math.round((curveState.vis | 0) / 2)); }

  function curvePan(n) {
    curveState.off = cclamp((curveState.off | 0) + n, curveMinOff(), curveMaxOff());
    drawCurve();
  }
  /* ★以【光标所在数据点】为圆心缩放：缩放后该点仍停在同一屏幕位置（与 K线组件一致）。
   *   工具按钮/键盘不传 clientX 时沿用最近一次鼠标位置；从未悬停则退化为视口中心。 */
  function curveZoom(f, clientX) {
    var total = lastCurve.length, cur = curveState.vis | 0;
    var nv = cclamp(Math.round(cur * f), 5, Math.max(5, total));
    if (nv === cur) return;
    if (clientX != null) curveState.anchorX = clientX;
    var x = curveState.anchorX, ratio = 0.5;
    if (x != null && cv && cv.getBoundingClientRect) {
      var r = cv.getBoundingClientRect();
      ratio = cclamp((x - r.left - 70) / Math.max(1, r.width - 70 - 24), 0, 1);
    }
    var startI = Math.max(0, total - (curveState.off | 0) - cur);
    var bi = cclamp(Math.round(startI + ratio * cur), 0, Math.max(0, total - 1));
    var ns = bi - Math.round(ratio * nv);
    curveState.vis = nv;
    curveState.off = cclamp(total - (ns + nv), curveMinOff(), Math.max(0, total - nv));
    drawCurve();
  }
  function curveReset() { curveState.off = 0; curveState.vis = DEF_VIS; drawCurve(); }
  function curveLatest() { curveState.off = 0; drawCurve(); }
  function curveShowAll() { curveState.vis = Math.max(5, lastCurve.length); curveState.off = 0; drawCurve(); }

  function curveTools() {
    var box = document.getElementById('ftc-tools');
    if (!box || box.getAttribute('data-done')) return;
    box.setAttribute('data-done', '1');
    var defs = [
      ['⏮ 最新', '回到最新（视口右端）', curveLatest],
      ['← 历史', '看更早的数据', function () { curvePan(+curveStep()); }],
      ['→ 更新', '看更新的数据（可越过最新留白）', function () { curvePan(-curveStep()); }],
      ['＋', '放大（减少可见点数）', function () { curveZoom(1 / 1.25); }],
      ['－', '缩小（增加可见点数）', function () { curveZoom(1.25); }],
      ['⤢ 全部', '显示全部点', curveShowAll]
    ];
    defs.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = d[0]; b.title = d[1];
      b.onclick = function (e) { e.preventDefault(); d[2](); };
      box.appendChild(b);
    });
    var info = document.createElement('span');
    info.className = 'ftc-info'; info.id = 'ftc-info';
    box.appendChild(info);
  }

  function fmtShort(ms) {
    var d = new Date(ms);
    function p(n) { return String(n).padStart(2, '0'); }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function curveIndexAt(mx) {
    var g = cv && cv.__geo;
    if (!g || !g.pts || !g.pts.length) return -1;
    var best = -1, bd = 1e9;
    for (var k = 0; k < g.pts.length; k++) {
      var dd = Math.abs(g.X(g.startI + k) - mx);
      if (dd < bd) { bd = dd; best = g.startI + k; }
    }
    return (bd <= g.step * 1.6) ? best : -1;
  }

  /* 曲线浮层：逐笔平仓详情（合约 / 本笔盈利 / 累计 / 止盈价 / 平仓价），
   *   固定在图表右上角、可交互，合约名是超链接。 */
  function showCurveTip(mx, my) {
    if (!cvTip) return;
    var r = lastCurve[curveHover];
    if (curveHover < 0 || !r) { cvTip.style.display = 'none'; return; }
    var up = r.profit >= 0;
    var inst = r.inst ? '<span class="ftc-inst" data-inst="' + esc(r.inst) + '" title="点击弹出共享K线">' + esc(r.inst) + ' ↗</span>' : '—';
    cvTip.innerHTML =
      '时间：<b>' + esc(dt(r.t)) + '</b><br>' +
      '合约：' + inst + (r.dir ? ' <span style="color:#8b9abc">(' + esc(r.dir) + ')</span>' : '') + '<br>' +
      '本笔净盈利：<b style="color:' + (up ? '#ff6b7d' : '#31c99a') + '">' + esc(sgn(r.profit, 6)) + ' $</b><br>' +
      '累计净USD：<b>' + esc(sgn(r.net, 6)) + ' $</b><br>' +
      '止盈目标价：<b>' + esc(num(r.tpPx, 6)) + '</b>' +
      (r.tpUsd != null ? ' <span style="color:#8b9abc">(目标 +' + esc(num(r.tpUsd, 6)) + '$)</span>' : '') + '<br>' +
      '实际平仓价：<b>' + esc(num(r.exitPx, 6)) + '</b>' +
      (r.avgPx != null ? ' <span style="color:#8b9abc">/ 均价 ' + esc(num(r.avgPx, 6)) + '</span>' : '') +
      '<div style="margin-top:4px;color:#7f92b8;font-size:10.5px">点击合约名 → 共享K线组件</div>';
    cvTip.style.display = 'block';
  }

  function drawCurve() {
    if (!cv || !cvCtx) return;
    var W = cv.clientWidth || 800, H = cv.clientHeight || 280;
    var dpr = global.devicePixelRatio || 1;
    var pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    var ctx = cvCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var total = lastCurve.length;
    var vis = cclamp(curveState.vis | 0, 5, Math.max(5, total || 5));
    curveState.vis = vis;
    /* ★off 允许为负 → 越过最新后右侧留白，最新点不再贴死右边缘、能继续往左拖 */
    var off = cclamp(curveState.off | 0, curveMinOff(), Math.max(0, total - vis));
    curveState.off = off;
    var rightPad = Math.max(0, -off);
    var endI = total - off;
    var startI = Math.max(0, endI - vis);
    var pts = lastCurve.slice(startI, Math.min(endI, total));

    var PL = 70, PR = 24, PT = 18, PB = 34;
    var plotW = Math.max(1, W - PL - PR), plotH = Math.max(1, H - PT - PB);
    /* ★留白也占一格 → 分母恒等于 vis，点间距不变 */
    var step = plotW / Math.max(1, pts.length + rightPad);
    var X = function (i) { return PL + (i - startI) * step + step / 2; };
    cv.__geo = { PL: PL, step: step, startI: startI, pts: pts, X: X };

    var lo = 0, hi = 0;
    for (var j = 0; j < pts.length; j++) {
      var v = +pts[j].net;
      if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    if (hi === lo) hi = lo + Math.max(0.1, Math.abs(lo) * 0.1);
    var padY = (hi - lo) * 0.12 || 0.05;
    lo -= padY; hi += padY;
    var Y = function (v) { return PT + (hi - v) / (hi - lo) * plotH; };

    /* 网格 + Y 轴刻度 */
    ctx.font = '10px Consolas, monospace'; ctx.textBaseline = 'middle';
    for (var g2 = 0; g2 <= 4; g2++) {
      var gy = PT + plotH * g2 / 4, gv = hi - (hi - lo) * g2 / 4;
      ctx.strokeStyle = '#1d2942'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PL, gy); ctx.lineTo(PL + plotW, gy); ctx.stroke();
      ctx.fillStyle = '#6d7690'; ctx.textAlign = 'right';
      ctx.fillText(gv.toFixed(4), PL - 8, gy);
    }
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = 'rgba(139,148,173,.5)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(PL, Y(0)); ctx.lineTo(PL + plotW, Y(0)); ctx.stroke();
      ctx.setLineDash([]);
    }
    var tickN = Math.min(6, pts.length);
    ctx.textAlign = 'center'; ctx.fillStyle = '#6d7690';
    for (var t = 0; t < tickN; t++) {
      var ti = Math.round(t * (pts.length - 1) / Math.max(1, tickN - 1));
      if (pts[ti]) ctx.fillText(fmtShort(pts[ti].t), X(startI + ti), PT + plotH + 16);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = '#8fa6d0'; ctx.font = '10px sans-serif';
    ctx.fillText('累计净USD', 6, PT - 8);

    /* 面积 + 折线 + 数据点 */
    if (pts.length) {
      ctx.beginPath();
      ctx.moveTo(X(startI), Y(+pts[0].net));
      for (var q = 1; q < pts.length; q++) ctx.lineTo(X(startI + q), Y(+pts[q].net));
      ctx.lineTo(X(startI + pts.length - 1), PT + plotH);
      ctx.lineTo(X(startI), PT + plotH);
      ctx.closePath(); ctx.fillStyle = 'rgba(61,123,255,.12)'; ctx.fill();

      ctx.beginPath();
      ctx.moveTo(X(startI), Y(+pts[0].net));
      for (var q2 = 1; q2 < pts.length; q2++) ctx.lineTo(X(startI + q2), Y(+pts[q2].net));
      ctx.strokeStyle = '#3d7bff'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();

      if (pts.length <= 80) {
        ctx.fillStyle = '#3d7bff';
        for (var q3 = 0; q3 < pts.length; q3++) {
          ctx.beginPath(); ctx.arc(X(startI + q3), Y(+pts[q3].net), 2.6, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else {
      ctx.fillStyle = '#8b94ad'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif';
      ctx.fillText('暂无平仓数据（浮盈 >10% 止盈后生成逐笔曲线点）', PL + plotW / 2, PT + plotH / 2);
      ctx.textAlign = 'left';
    }

    /* 十字光标 + 高亮点 */
    if (curveHover >= startI && curveHover < startI + pts.length && lastCurve[curveHover]) {
      var hx = X(curveHover), hy = Y(+lastCurve[curveHover].net);
      ctx.strokeStyle = 'rgba(120,160,255,.6)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(hx, PT); ctx.lineTo(hx, PT + plotH);
      ctx.moveTo(PL, hy); ctx.lineTo(PL + plotW, hy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 3.6, 0, Math.PI * 2); ctx.fill();
    }

    var info = document.getElementById('ftc-info');
    if (info) {
      var s = '可见 <b>' + pts.length + '</b> / 共 <b>' + total + '</b> 点';
      if (off > 0) s += ' · 距最新 <b>' + off + '</b> 点';
      if (off < 0) s += ' · 右侧留白 <b>' + (-off) + '</b> 点（可继续往最新拖动）';
      s += ' · 拖动平移 / 滚轮缩放 / 双击复位';
      info.innerHTML = s;
    }
  }
