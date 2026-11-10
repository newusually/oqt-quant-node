  function bindCurve() {
    cv = document.getElementById('ftc-cv');
    cvTip = document.getElementById('ftc-tip');
    if (!cv || curveBound) return;
    curveBound = true;
    cvCtx = cv.getContext('2d');
    curveTools();

    /* 浮层固定右上角且可交互：鼠标移到浮层上时保持内容，合约名可点击弹共享K线 */
    var tipHover = false;
    if (cvTip) {
      cvTip.addEventListener('mouseenter', function () { tipHover = true; });
      cvTip.addEventListener('mouseleave', function () {
        tipHover = false;
        cvTip.style.display = 'none';
        curveHover = -1; drawCurve();
      });
      cvTip.addEventListener('click', function (e) {
        var a = e.target;
        while (a && a !== cvTip && !a.getAttribute('data-inst')) a = a.parentNode;
        if (a && a !== cvTip) openSharedKline(a.getAttribute('data-inst'));
      });
    }

    cv.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      curveDrag = { x: e.clientX, off: curveState.off | 0 };
      cv.style.cursor = 'grabbing'; e.preventDefault();
    });
    global.addEventListener('mousemove', function (e) {
      if (tipHover) return;              // ★鼠标在浮层上：保持当前曲线点，允许点击合约名
      if (curveDrag) {
        var stp = (cv.__geo && cv.__geo.step) || 6;
        var dx = Math.round((e.clientX - curveDrag.x) / stp);
        var no = cclamp(curveDrag.off + dx, curveMinOff(), curveMaxOff());
        if (no !== curveState.off) { curveState.off = no; drawCurve(); }
      }
      var r = cv.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      if (mx >= 0 && mx <= r.width && my >= 0 && my <= r.height) {
        var nh = curveIndexAt(mx);
        if (nh !== curveHover) { curveHover = nh; drawCurve(); }
        showCurveTip(mx, my);
      } else if (curveHover !== -1) {
        curveHover = -1; drawCurve();
        if (cvTip) cvTip.style.display = 'none';
      }
    });
    global.addEventListener('mouseup', function () {
      if (curveDrag) { curveDrag = null; cv.style.cursor = 'grab'; }
    });
    cv.addEventListener('mouseleave', function () {
      if (tipHover) return;              // ★移到浮层上不清空，交给浮层自身 mouseleave
      if (curveHover !== -1) { curveHover = -1; drawCurve(); }
      if (cvTip) cvTip.style.display = 'none';
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.shiftKey) curvePan(e.deltaY > 0 ? -10 : 10);
      else curveZoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX);   // ★以光标数据点为圆心
    }, { passive: false });
    cv.addEventListener('dblclick', function () { curveReset(); });
    cv.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft') { curvePan(+curveStep()); e.preventDefault(); }
      else if (k === 'ArrowRight') { curvePan(-curveStep()); e.preventDefault(); }
      else if (k === '+' || k === '=') { curveZoom(1 / 1.25); e.preventDefault(); }
      else if (k === '-' || k === '_') { curveZoom(1.25); e.preventDefault(); }
      else if (k === 'Home') { curveLatest(); e.preventDefault(); }
    });
    global.addEventListener('resize', function () { drawCurve(); });
    if (global.ResizeObserver) {
      try { new ResizeObserver(function () { drawCurve(); }).observe(cv.parentElement); } catch (e) { }
    }
  }

  function renderChart(d) {
    var el = document.getElementById('ft-chart'); if (!el) return;
    var series = ((d && d.curve) || []).slice();
    series.sort(function (a, b) { return (+a.t) - (+b.t); });
    lastCurve = series;
    if (!cv) bindCurve();      // 首次绑定（工具按钮 + 交互）
    drawCurve();               // ★只重绘，绝不重置 curveState → 3 秒轮询不打断用户拖动
  }
