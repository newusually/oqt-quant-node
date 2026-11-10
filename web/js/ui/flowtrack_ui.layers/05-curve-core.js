  /* ======================= 通用曲线视图工厂（盈利曲线 / 实时持仓曲线 共用） =======================
   * 同一套自绘 Canvas 组件，实例化两次：
   *   closeView  → 盈利曲线（逐笔平仓 · 累计已实现净 USD）
   *   equityView → 实时持仓曲线（持仓期间实时净浮盈 USD，含亏损/盈利，每 30 秒采样）
   * 拖拽平移 / 滚轮缩放(以光标数据点为圆心) / 双击复位 / 悬停浮层（附可点击合约名）。 */
  function cclamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function CurveView(opts) {
    this.opts = opts || {};
    this.RIGHT_PAD = 20; this.DEF_VIS = 60;
    this.data = [];
    this.state = { off: 0, vis: this.DEF_VIS, anchorX: null };
    this.cv = null; this.ctx = null; this.tip = null; this.bound = false;
    this.hover = -1; this.drag = null;
    this.color = this.opts.color || '#3d7bff';
    this.area = this.opts.area || 'rgba(61,123,255,.12)';
    this.yLabel = this.opts.yLabel || '累计净USD';
    this.emptyText = this.opts.emptyText || '暂无数据';
    this.onTip = this.opts.onTip || function () { };
    this.valueKey = this.opts.valueKey || 'net';
  }
  CurveView.prototype.minOff = function () { return -this.RIGHT_PAD; };
  CurveView.prototype.maxOff = function () { return Math.max(0, this.data.length - (this.state.vis | 0)); };
  CurveView.prototype.stepN = function () { return Math.max(3, Math.round((this.state.vis | 0) / 2)); };
  CurveView.prototype.pan = function (n) { this.state.off = cclamp((this.state.off | 0) + n, this.minOff(), this.maxOff()); this.draw(); };
  CurveView.prototype.zoom = function (f, x) {
    var total = this.data.length, cur = this.state.vis | 0;
    var nv = cclamp(Math.round(cur * f), 5, Math.max(5, total)); if (nv === cur) return;
    if (x != null) this.state.anchorX = x;
    var cx = this.state.anchorX, ratio = 0.5;
    if (cx != null && this.cv && this.cv.getBoundingClientRect) {
      var r = this.cv.getBoundingClientRect();
      ratio = cclamp((cx - r.left - 70) / Math.max(1, r.width - 70 - 24), 0, 1);
    }
    var startI = Math.max(0, total - (this.state.off | 0) - cur);
    var bi = cclamp(Math.round(startI + ratio * cur), 0, Math.max(0, total - 1));
    var ns = bi - Math.round(ratio * nv);
    this.state.vis = nv;
    this.state.off = cclamp(total - (ns + nv), this.minOff(), Math.max(0, total - nv));
    this.draw();
  };
  CurveView.prototype.reset = function () { this.state.off = 0; this.state.vis = this.DEF_VIS; this.draw(); };
  CurveView.prototype.latest = function () { this.state.off = 0; this.draw(); };
  CurveView.prototype.showAll = function () { this.state.vis = Math.max(5, this.data.length); this.state.off = 0; this.draw(); };

  CurveView.prototype.tools = function () {
    var box = document.getElementById(this.opts.toolsId);
    if (!box || box.getAttribute('data-done')) return;
    box.setAttribute('data-done', '1');
    var self = this;
    var defs = [
      ['⏮ 最新', '回到最新（视口右端）', function () { self.latest(); }],
      ['← 历史', '看更早的数据', function () { self.pan(+self.stepN()); }],
      ['→ 更新', '看更新的数据', function () { self.pan(-self.stepN()); }],
      ['＋', '放大（减少可见点数）', function () { self.zoom(1 / 1.25); }],
      ['－', '缩小（增加可见点数）', function () { self.zoom(1.25); }],
      ['⤢ 全部', '显示全部点', function () { self.showAll(); }]
    ];
    defs.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = d[0]; b.title = d[1];
      b.onclick = function (e) { e.preventDefault(); d[2](); };
      box.appendChild(b);
    });
    var info = document.createElement('span');
    info.className = 'ftc-info'; info.id = this.opts.infoId;
    box.appendChild(info);
  };

  CurveView.prototype.fmtShort = function (ms) {
    var d = new Date(ms);
    function p(n) { return String(n).padStart(2, '0'); }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  CurveView.prototype.indexAt = function (mx) {
    var g = this.cv && this.cv.__geo;
    if (!g || !g.pts || !g.pts.length) return -1;
    var best = -1, bd = 1e9;
    for (var k = 0; k < g.pts.length; k++) {
      var dd = Math.abs(g.X(g.startI + k) - mx);
      if (dd < bd) { bd = dd; best = g.startI + k; }
    }
    return (bd <= g.step * 1.6) ? best : -1;
  };
  CurveView.prototype.showTip = function () {
    if (!this.tip) return;
    var r = this.data[this.hover];
    if (this.hover < 0 || !r) { this.tip.style.display = 'none'; return; }
    this.tip.innerHTML = this.onTip(r);
    this.tip.style.display = 'block';
  };

  CurveView.prototype.draw = function () {
    if (!this.cv || !this.ctx) return;
    var W = this.cv.clientWidth || 800, H = this.cv.clientHeight || 280;
    var dpr = global.devicePixelRatio || 1;
    var pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (this.cv.width !== pw || this.cv.height !== ph) { this.cv.width = pw; this.cv.height = ph; }
    var ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var total = this.data.length;
    var vis = cclamp(this.state.vis | 0, 5, Math.max(5, total || 5)); this.state.vis = vis;
    var off = cclamp(this.state.off | 0, this.minOff(), Math.max(0, total - vis)); this.state.off = off;
    var rightPad = Math.max(0, -off);
    var endI = total - off;
    var startI = Math.max(0, endI - vis);
    var pts = this.data.slice(startI, Math.min(endI, total));
    var key = this.valueKey;

    var PL = 70, PR = 24, PT = 18, PB = 34;
    var plotW = Math.max(1, W - PL - PR), plotH = Math.max(1, H - PT - PB);
    var step = plotW / Math.max(1, pts.length + rightPad);
    var X = function (i) { return PL + (i - startI) * step + step / 2; };
    this.cv.__geo = { PL: PL, step: step, startI: startI, pts: pts, X: X };

    var lo = 0, hi = 0;
    for (var j = 0; j < pts.length; j++) {
      var v = +pts[j][key];
      if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    if (hi === lo) hi = lo + Math.max(0.1, Math.abs(lo) * 0.1);
    var padY = (hi - lo) * 0.12 || 0.05; lo -= padY; hi += padY;
    var Y = function (v) { return PT + (hi - v) / (hi - lo) * plotH; };

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
    var tickN = Math.min(6, pts.length); ctx.textAlign = 'center'; ctx.fillStyle = '#6d7690';
    for (var t = 0; t < tickN; t++) {
      var ti = Math.round(t * (pts.length - 1) / Math.max(1, tickN - 1));
      if (pts[ti]) ctx.fillText(this.fmtShort(pts[ti].t), X(startI + ti), PT + plotH + 16);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = '#8fa6d0'; ctx.font = '10px sans-serif';
    ctx.fillText(this.yLabel, 6, PT - 8);

    if (pts.length) {
      ctx.beginPath();
      ctx.moveTo(X(startI), Y(+pts[0][key]));
      for (var q = 1; q < pts.length; q++) ctx.lineTo(X(startI + q), Y(+pts[q][key]));
      ctx.lineTo(X(startI + pts.length - 1), PT + plotH);
      ctx.lineTo(X(startI), PT + plotH);
      ctx.closePath(); ctx.fillStyle = this.area; ctx.fill();

      ctx.beginPath();
      ctx.moveTo(X(startI), Y(+pts[0][key]));
      for (var q2 = 1; q2 < pts.length; q2++) ctx.lineTo(X(startI + q2), Y(+pts[q2][key]));
      ctx.strokeStyle = this.color; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();

      if (pts.length <= 80) {
        ctx.fillStyle = this.color;
        for (var q3 = 0; q3 < pts.length; q3++) {
          ctx.beginPath(); ctx.arc(X(startI + q3), Y(+pts[q3][key]), 2.6, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else {
      ctx.fillStyle = '#8b94ad'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif';
      ctx.fillText(this.emptyText, PL + plotW / 2, PT + plotH / 2);
      ctx.textAlign = 'left';
    }

    if (this.hover >= startI && this.hover < startI + pts.length && this.data[this.hover]) {
      var hx = X(this.hover), hy = Y(+this.data[this.hover][key]);
      ctx.strokeStyle = 'rgba(120,160,255,.6)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(hx, PT); ctx.lineTo(hx, PT + plotH);
      ctx.moveTo(PL, hy); ctx.lineTo(PL + plotW, hy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 3.6, 0, Math.PI * 2); ctx.fill();
    }

    var info = document.getElementById(this.opts.infoId);
    if (info) {
      var s = '可见 <b>' + pts.length + '</b> / 共 <b>' + total + '</b> 点';
      if (off > 0) s += ' · 距最新 <b>' + off + '</b> 点';
      if (off < 0) s += ' · 右侧留白 <b>' + (-off) + '</b> 点（可继续往最新拖动）';
      s += ' · 拖动平移 / 滚轮缩放 / 双击复位';
      info.innerHTML = s;
    }
  };

  CurveView.prototype.bind = function () {
    var self = this;
    this.cv = document.getElementById(this.opts.canvasId);
    this.tip = document.getElementById(this.opts.tipId);
    if (!this.cv || this.bound) return;
    this.bound = true;
    this.ctx = this.cv.getContext('2d');
    this.tools();

    var tipHover = false;
    if (this.tip) {
      this.tip.addEventListener('mouseenter', function () { tipHover = true; });
      this.tip.addEventListener('mouseleave', function () {
        tipHover = false; self.tip.style.display = 'none'; self.hover = -1; self.draw();
      });
      this.tip.addEventListener('click', function (e) {
        var a = e.target;
        while (a && a !== self.tip && !a.getAttribute('data-inst')) a = a.parentNode;
        if (a && a !== self.tip) openSharedKline(a.getAttribute('data-inst'));
      });
    }
    this.cv.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      self.drag = { x: e.clientX, off: self.state.off | 0 };
      self.cv.style.cursor = 'grabbing'; e.preventDefault();
    });
    global.addEventListener('mousemove', function (e) {
      if (tipHover) return;
      if (self.drag) {
        var stp = (self.cv.__geo && self.cv.__geo.step) || 6;
        var dx = Math.round((e.clientX - self.drag.x) / stp);
        var no = cclamp(self.drag.off + dx, self.minOff(), self.maxOff());
        if (no !== self.state.off) { self.state.off = no; self.draw(); }
      }
      var r = self.cv.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      if (mx >= 0 && mx <= r.width && my >= 0 && my <= r.height) {
        var nh = self.indexAt(mx);
        if (nh !== self.hover) { self.hover = nh; self.draw(); }
        self.showTip();
      } else if (self.hover !== -1) {
        self.hover = -1; self.draw();
        if (self.tip) self.tip.style.display = 'none';
      }
    });
    global.addEventListener('mouseup', function () {
      if (self.drag) { self.drag = null; self.cv.style.cursor = 'grab'; }
    });
    this.cv.addEventListener('mouseleave', function () {
      if (tipHover) return;
      if (self.hover !== -1) { self.hover = -1; self.draw(); }
      if (self.tip) self.tip.style.display = 'none';
    });
    this.cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.shiftKey) self.pan(e.deltaY > 0 ? -10 : 10);
      else self.zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX);
    }, { passive: false });
    this.cv.addEventListener('dblclick', function () { self.reset(); });
    this.cv.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft') { self.pan(+self.stepN()); e.preventDefault(); }
      else if (k === 'ArrowRight') { self.pan(-self.stepN()); e.preventDefault(); }
      else if (k === '+' || k === '=') { self.zoom(1 / 1.25); e.preventDefault(); }
      else if (k === '-' || k === '_') { self.zoom(1.25); e.preventDefault(); }
      else if (k === 'Home') { self.latest(); e.preventDefault(); }
    });
    global.addEventListener('resize', function () { self.draw(); });
    if (global.ResizeObserver) {
      try { new ResizeObserver(function () { self.draw(); }).observe(self.cv.parentElement); } catch (e) { }
    }
  };

  CurveView.prototype.render = function (series) {
    this.data = (series || []).slice();
    if (!this.cv) this.bind();
    this.draw();
  };
