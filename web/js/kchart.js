/* ============================================================================
 * web/js/kchart.js —— ★共享 K 线图组件（2026-11-03）
 * ----------------------------------------------------------------------------
 * 一份代码，覆盖「所有页面 · 所有选项卡」的 K 线图：
 *   · 总览页  BTC 面板（6 个分时选项卡 3m/5m/15m/1h/2h/4h）
 *   · 总览页  美股三大指数面板
 *   · 美股独立页（3 指数 × 4 周期选项卡）
 *   · OKX 合约页（idxcv，周期选项卡）
 *
 * 组件职责：
 *   ① 主图绘制（复用 ind-engine.js 的 global.drawKline）
 *   ② 副图挂载（复用共享副图组件 global.SubCharts：MACD(12/26/60, 标=能量E) + 能量 E=mc²）
 *   ③ 统一交互：鼠标拖拽平移 / 滚轮缩放 / Shift+滚轮平移 / 双击复位 /
 *      键盘 ←→ 平移、+- 缩放、Home 回最新 / 触摸拖拽
 *   ④ 统一工具栏：⏮最新  ←历史  →更新  ＋放大  －缩小  ⤢全部 + 视口状态
 *
 * ★视口锚定语义（2026-11-03 修复的关键 bug）：
 *   off = 「距最新端多少根」。前插历史数据时数组长度 total 增长 nPre，
 *   但最新端没变 → off 必须【保持不变】才能让用户看到的还是同一批K线。
 *   旧代码写成 st.off += nPre（方向反了），导致：
 *     · 视口往更新方向跳变（用户看到「点 5m/15m 自动跑到最新端」）
 *     · startI 不变 → 懒加载 onMore 被反复触发（死循环拉历史）
 *     · off 一路暴涨（实测 5582 → 17422），拖回最新需要拖 8 万像素
 *   现改为 off 不变，并把这段锚定逻辑集中到本组件统一管理。
 * ========================================================================== */
(function (global) {
  'use strict';

  var DIM = '#9fb0cc';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function $(s, r) { return (r || document).querySelector(s); }

  /* ------------------------------------------------------------ 工具栏样式 */
  var TOOL_CSS =
    '.kchart-tools{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:0 0 4px 0;font-size:12px}' +
    '.kchart-tools button{background:#16203a;color:#c9d6ee;border:1px solid #2c3a5e;border-radius:5px;' +
    'padding:2px 8px;font-size:12px;cursor:pointer;line-height:18px;user-select:none}' +
    '.kchart-tools button:hover{background:#22304f;border-color:#3d5a8e}' +
    '.kchart-tools .kchart-info{color:' + DIM + ';font-size:11px;margin-left:auto;white-space:nowrap}' +
    '.kchart-tools .kchart-info b{color:#d7e2f7;font-weight:600}';

  function ensureCss() {
    if (document.getElementById('kchart-css')) return;
    var st = document.createElement('style');
    st.id = 'kchart-css';
    st.textContent = TOOL_CSS;
    document.head.appendChild(st);
  }

  /* ============================================================== 组件主体 */
  /**
   * @param {HTMLElement} container 宿主容器
   * @param {Object} opts
   *   canvas     : 可选，复用已有 canvas（否则在 container 内新建）
   *   subBox     : 可选，复用已有副图容器（否则新建）
   *   height     : 主图高度 px（默认 380）
   *   stateKey   : 视口持久化 key
   *   defVis     : 默认可见根数
   *   bars       : 初始 bars
   *   draw       : 传给 drawKline 的额外参数（函数或对象）
   *   onMore     : 懒加载回调（往左翻历史）
   *   moreEof    : 已到历史尽头
   *   prefetchAhead: 距左沿多少根触发补历史
   *   label      : 副图标题标签
   *   tools      : 是否显示工具栏（默认 true）
   */
  function KChart(container, opts) {
    ensureCss();
    this.c = container;
    this.o = opts || {};
    this.bars = this.o.bars || [];
    this.state = { off: 0, vis: (this.o.defVis | 0) || 200, yoff: 0, key: null };
    this._subsDirty = true;
    this._build();
    this._bind();
  }

  KChart.prototype._build = function () {
    var o = this.o, self = this;

    /* 工具栏 */
    if (o.tools !== false) {
      this.tools = document.createElement('div');
      this.tools.className = 'kchart-tools';
      this.btnLast = this._btn('⏮ 最新', '回到最新K线(视口右端)', function () { self.toLatest(); });
      this.btnPrev = this._btn('← 历史', '往左看更早的历史(←)', function () { self.panBy(+self._step()); });
      this.btnNext = this._btn('→ 更新', '往右看更新的数据(→)', function () { self.panBy(-self._step()); });
      this.btnIn = this._btn('＋', '放大K线(减少可见根数)', function () { self.zoomBy(1 / 1.25); });
      this.btnOut = this._btn('－', '缩小K线(增加可见根数)', function () { self.zoomBy(1.25); });
      this.btnAll = this._btn('⤢ 全部', '显示全部K线', function () { self.showAll(); });
      this.info = document.createElement('span');
      this.info.className = 'kchart-info';
      this.tools.appendChild(this.btnLast);
      this.tools.appendChild(this.btnPrev);
      this.tools.appendChild(this.btnNext);
      this.tools.appendChild(this.btnIn);
      this.tools.appendChild(this.btnOut);
      this.tools.appendChild(this.btnAll);
      this.tools.appendChild(this.info);
      this.c.appendChild(this.tools);
    }

    /* 主图 canvas */
    if (this.o.canvas) {
      this.cv = this.o.canvas;
    } else {
      this.cv = document.createElement('canvas');
      this.cv.className = 'kchart-main';
      this.cv.style.cssText = 'width:100%;display:block;background:#0e1422;border-radius:8px';
      this.c.appendChild(this.cv);
    }
    this.cv.style.cursor = 'grab';

    /* 副图容器 */
    if (this.o.subBox) {
      this.subBox = this.o.subBox;
    } else {
      this.subBox = document.createElement('div');
      this.subBox.className = 'kchart-sub';
      this.subBox.style.marginTop = '6px';
      this.c.appendChild(this.subBox);
    }
  };

  KChart.prototype._btn = function (txt, title, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = txt;
    b.title = title;
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
    return b;
  };

  /* ------------------------------------------------------------- 视口操作 */
  /* ★2026-11-08：允许 off 为负 = 拖过【最新】K线后右侧留白，不再一到最右就拖不动。
   *   rightPad 由宿主传入（默认 40 根）；悬浮窗组件传同一个值。 */
  KChart.prototype._minOff = function () {
    var r = this.o.rightPad;
    return -Math.max(0, (r == null ? 40 : (+r || 0)));
  };
  KChart.prototype._step = function () {
    return Math.max(10, Math.round((this.state.vis || 200) / 2));
  };
  KChart.prototype.toLatest = function () {
    this.state.off = 0;
    this._draw();
  };
  KChart.prototype.panBy = function (n) {
    var total = this.cv.__total || this.bars.length || 0;
    var vis = this.state.vis || 200;
    var maxOff = Math.max(0, total - vis);
    this.state.off = clamp((this.state.off | 0) + n, this._minOff(), maxOff);
    this._draw();
  };
  /* ★2026-11-09：把屏幕位置换算成「锚点 K线」+ 它在视口内的比例。
   *   drawKline 每帧写入 cv.__geo.startI / cv.__bw，故这里能精确对应到光标下那根 K线。 */
  KChart.prototype._anchorBar = function (clientX) {
    var cv = this.cv;
    var vis = this.state.vis || 200;
    var geo = cv.__geo || {};
    var l = (geo.l == null) ? 8 : geo.l;
    var startI = geo.startI || 0;
    var total = cv.__total || this.bars.length || 0;
    var rect = cv.getBoundingClientRect ? cv.getBoundingClientRect() : { left: 0, width: cv.clientWidth || 800 };
    var W = rect.width || cv.clientWidth || 800;
    var plotW = Math.max(1, W - l - 62);
    var ratio = 0.5;
    if (clientX != null && isFinite(clientX)) {
      ratio = clamp((clientX - rect.left - l) / plotW, 0, 1);
    }
    var bi = clamp(Math.round(startI + ratio * vis), 0, Math.max(0, total - 1));
    return { bi: bi, ratio: ratio };
  };

  /* ★以【光标所在那根 K线】为圆心缩放：缩放后该根 K线仍停在屏幕同一位置。
   *   clientX 为空（工具按钮/键盘）时用最近一次鼠标位置；从未悬停过则退化为视口中心。 */
  KChart.prototype.zoomAt = function (f, clientX) {
    var total = this.cv.__total || this.bars.length || 0;
    var cur = this.state.vis || 200;
    var nv = clamp(Math.round(cur * f), 20, Math.max(20, total));
    if (nv === cur) return;
    var a = this._anchorBar(clientX);
    var newStart = a.bi - Math.round(a.ratio * nv);
    var newOff = total - (newStart + nv);
    this.state.vis = nv;
    this.state.off = clamp(Math.round(newOff), this._minOff(), Math.max(0, total - nv));
    this._draw();
  };
  KChart.prototype.zoomBy = function (f, clientX) {
    return this.zoomAt(f, clientX == null ? this._lastX : clientX);
  };
  KChart.prototype.showAll = function () {
    var total = this.cv.__total || this.bars.length || 0;
    this.state.vis = clamp(total, 20, Math.max(20, total));
    this.state.off = 0;
    this._draw();
  };
  KChart.prototype.reset = function () {
    this.state.off = 0;
    this.state.vis = (this.o.defVis | 0) || 200;
    this.state.yoff = 0;
    this._draw();
  };

  /* --------------------------------------------------------------- 绘制层 */
  KChart.prototype._opts = function () {
    var o = this.o, out = {};
    var base = (typeof o.draw === 'function') ? o.draw(this.bars, this) : (o.draw || {});
    for (var k in base) out[k] = base[k];
    if (o.extra) for (var k2 in o.extra) out[k2] = o.extra[k2];
    out.bars = this.bars;
    out.height = o.height || this.cv.clientHeight || 380;
    out.stateKey = o.stateKey;
    out.defVis = (o.defVis | 0) || out.defVis || 200;
    out.off = this.state.off | 0;          // ★由组件统一控制视口
    out.vis = this.state.vis | 0;
    out.noSub = true;                      // 副图交给 SubCharts
    out.noInteract = true;                 // 交互交给本组件（避免与内嵌拖拽打架）
    if (o.onMore) out.onMore = o.onMore;
    if (o.moreEof != null) out.moreEof = o.moreEof;
    if (o.prefetchAhead) out.prefetchAhead = o.prefetchAhead;
    out.rightPad = (o.rightPad == null ? 40 : +o.rightPad);   // ★拖过最新后的右侧留白上限
    return out;
  };

  KChart.prototype._draw = function () {
    if (!global.drawKline || !this.cv) return;
    var o = this._opts();
    /* 换 stateKey → 视口与缩放级别一起复位（换合约/换周期不应保留旧的放大倍数，
     *   否则新合约会用上一张图的 vis 绘制，看起来就是「放大到不对应的 K线范围」） */
    if (this.state.key !== (o.stateKey || null)) {
      this.state.key = o.stateKey || null;
      this.state.off = 0;
      this.state.vis = (o.defVis | 0) || 200;
      this.state.yoff = 0;
      o.off = 0;
      o.vis = this.state.vis;
    }
    global.drawKline(this.cv, o);
    var st = this.cv._kst;
    if (st) {
      this.state.off = st.off | 0;
      this.state.vis = st.vis | 0;
      this.state.yoff = st.yoff || 0;
    }
    if (this._subsDirty) this._mountSub();
    this._label();
  };

  KChart.prototype._mountSub = function () {
    if (!global.SubCharts || !this.subBox) return;
    try {
      global.SubCharts.mount(this.cv, this.subBox, this.bars, { label: this.o.label || '' });
      this._subsDirty = false;
    } catch (e) { /* 副图失败不影响主图 */ }
  };

  KChart.prototype._label = function () {
    if (!this.info) return;
    var total = this.cv.__total || this.bars.length || 0;
    var vis = this.state.vis || 0;
    var off = this.state.off || 0;
    var from = Math.max(0, total - off - vis);
    var to = Math.min(total, Math.max(0, total - off));
    var txt = '可见 <b>' + vis + '</b> / 共 <b>' + total + '</b> 根';
    if (off > 0) txt += ' · 距最新 <b>' + off + '</b> 根';
    if (off < 0) txt += ' · 右侧留白 <b>' + (-off) + '</b> 根（可继续往最新拖动）';
    if (total > 0) {
      var a = this.bars[from] && this.bars[from].t;
      var b = this.bars[to - 1] && this.bars[to - 1].t;
      if (a && b) txt += ' · ' + fmtTs(a) + ' ~ ' + fmtTs(b);
    }
    this.info.innerHTML = txt;
  };

  function fmtTs(t) {
    var d = new Date(t);
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* --------------------------------------------------------------- 数据层 */
  KChart.prototype.setBars = function (bars) {
    this.bars = bars || [];
    this._subsDirty = true;
    this._draw();
    return this;
  };
  /* 只重绘主图（副图数据不变时用，避免拖拽卡顿） */
  KChart.prototype.redraw = function () {
    this._draw();
    return this;
  };

  /* ============================================================ 交互绑定 */
  KChart.prototype._bind = function () {
    var self = this, cv = this.cv;
    var drag = null;

    function st() { return self.state; }
    function totalBars() { return cv.__total || self.bars.length || 0; }
    function maxOff() { return Math.max(0, totalBars() - (st().vis || 200)); }
    function minOff() { return self._minOff(); }

    /* ★记录光标位置：点「＋/－」按钮时也以光标下那根 K线为缩放圆心 */
    cv.addEventListener('mousemove', function (e) { self._lastX = e.clientX; });

    cv.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (cv.__drawToolActive) { e.preventDefault(); return; }   // 绘图模式不平移
      var r = cv.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, off: st().off | 0, yoff: st().yoff || 0, rect: r };
      cv._dragging = true;
      cv.style.cursor = 'grabbing';
      e.preventDefault();
    });

    global.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var bw = cv.__bw || 4;
      var dx = Math.round((e.clientX - drag.x) / bw);
      var no = clamp(drag.off + dx, minOff(), maxOff());
      if (no !== st().off) { st().off = no; self._draw(); }
      st().yoff = drag.yoff + (e.clientY - drag.y);
    });

    global.addEventListener('mouseup', function () {
      if (!drag) return;
      drag = null; cv._dragging = false; cv.style.cursor = 'grab';
    });

    cv.addEventListener('mouseleave', function () {
      if (cv._dragging) { drag = null; cv._dragging = false; cv.style.cursor = 'grab'; }
    });

    /* 滚轮：缩放 / Shift 平移 */
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.shiftKey) {
        var step = e.deltaY > 0 ? -10 : 10;
        st().off = clamp((st().off | 0) + step, minOff(), maxOff());
        self._draw();
      } else {
        /* ★滚轮缩放锚点 = 鼠标所在那根 K线，放大/缩小都围绕它，不再跑到不对应的范围 */
        self.zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX);
      }
    }, { passive: false });

    /* 双击复位 */
    cv.addEventListener('dblclick', function () { self.reset(); });

    /* 触摸：单指拖拽平移 */
    var touch = null;
    cv.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, off: st().off | 0 };
    }, { passive: true });
    cv.addEventListener('touchmove', function (e) {
      if (!touch || e.touches.length !== 1) return;
      e.preventDefault();
      var bw = cv.__bw || 4;
      var dx = Math.round((e.touches[0].clientX - touch.x) / bw);
      st().off = clamp(touch.off + dx, minOff(), maxOff());
      self._draw();
    }, { passive: false });
    cv.addEventListener('touchend', function () { touch = null; }, { passive: true });

    /* 键盘：←→ 平移 / +- 缩放 / Home 回最新 */
    cv.setAttribute('tabindex', '0');
    cv.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft') { st().off = clamp((st().off | 0) + self._step(), minOff(), maxOff()); self._draw(); e.preventDefault(); }
      else if (k === 'ArrowRight') { st().off = clamp((st().off | 0) - self._step(), minOff(), maxOff()); self._draw(); e.preventDefault(); }
      else if (k === '+' || k === '=') { self.zoomBy(1 / 1.25); e.preventDefault(); }
      else if (k === '-' || k === '_') { self.zoomBy(1.25); e.preventDefault(); }
      else if (k === 'Home') { self.toLatest(); e.preventDefault(); }
    });

    /* 尺寸变化重绘（父容器宽度变化时画布需重算） */
    if (global.ResizeObserver) {
      var ro = new ResizeObserver(function () { self._draw(); });
      try { ro.observe(this.c); } catch (e) { }
      this._ro = ro;
    }
  };

  /* ============================================================== 导出接口 */
  global.KChart = {
    create: function (container, opts) {
      if (!container) return null;
      return new KChart(container, opts || {});
    },
    /* 兼容：直接从已有 canvas 创建 */
    attach: function (cv, container, opts) {
      opts = opts || {};
      opts.canvas = cv;
      return global.KChart.create(container || (cv.parentNode), opts);
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
