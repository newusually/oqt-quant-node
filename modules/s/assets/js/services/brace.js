/*
 * brace.js — 服务层 / 大括号（花括号）绘制
 * 专门画数学课本里那种花括号：两端带向上小钩、中间尖端朝下，括住一组图案/文字。
 * 以前用 border-bottom 画成一条直线、或者写死坐标的静态 SVG，位置对不准、形状也不对。
 * 现在：真正量出被括元素的真实宽高，用贝塞尔曲线画花括号，支持描线动画与内容变化自动重画。
 *
 * 用法（普通页面）：
 *   App.Brace.draw(宿主div, { span: [元素1, 元素2], label: "？个", color: "#ef6c00" });
 *   App.Brace.update(宿主div);                 // 内容变了（增删图案）重新量宽重画
 *   App.Brace.watch(宿主div, opt);             // 自动观察 DOM 变化 + 窗口缩放，持续重画
 *   App.Brace.clear(宿主div);                  // 清掉重画
 *
 * 用法（Vue 页面）：模板里写 <brace-box label="？个"></brace-box>，
 *   组件会自动量父容器里 .row 元素的联合宽度，并把括号画在它们正下方（占位、不遮挡）。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var SVGNS = "http://www.w3.org/2000/svg";

  function mk(tag) { return document.createElementNS(SVGNS, tag); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 花括号路径：两端小钩朝上，中间尖端朝下 ----------
   * W: 跨度（像素）  H: 钩顶到尖端的深度（像素）
   * 向上括号（up=true）是它的垂直镜像：两端小钩朝下，尖端朝上。 */
  function pathDown(W, H) {
    var hy = H * 0.30;                       // 两端钩尖的深度（0 = 钩顶）
    return "M0," + hy.toFixed(1) +
      " C" + (W * 0.05).toFixed(1) + "," + hy.toFixed(1) + " " + (W * 0.09).toFixed(1) + "," + (H * 0.02).toFixed(1) + " " + (W * 0.16).toFixed(1) + "," + (H * 0.02).toFixed(1) +
      " C" + (W * 0.28).toFixed(1) + "," + (H * 0.03).toFixed(1) + " " + (W * 0.36).toFixed(1) + "," + (H * 0.18).toFixed(1) + " " + (W * 0.43).toFixed(1) + "," + (H * 0.38).toFixed(1) +
      " C" + (W * 0.47).toFixed(1) + "," + (H * 0.52).toFixed(1) + " " + (W * 0.49).toFixed(1) + "," + (H * 0.68).toFixed(1) + " " + (W * 0.5).toFixed(1) + "," + (H * 0.9).toFixed(1) +
      " C" + (W * 0.51).toFixed(1) + "," + (H * 0.68).toFixed(1) + " " + (W * 0.53).toFixed(1) + "," + (H * 0.52).toFixed(1) + " " + (W * 0.57).toFixed(1) + "," + (H * 0.38).toFixed(1) +
      " C" + (W * 0.64).toFixed(1) + "," + (H * 0.18).toFixed(1) + " " + (W * 0.72).toFixed(1) + "," + (H * 0.03).toFixed(1) + " " + (W * 0.84).toFixed(1) + "," + (H * 0.02).toFixed(1) +
      " C" + (W * 0.91).toFixed(1) + "," + (H * 0.02).toFixed(1) + " " + (W * 0.95).toFixed(1) + "," + hy.toFixed(1) + " " + W.toFixed(1) + "," + hy.toFixed(1);
  }
  function pathUp(W, H) {
    // 垂直镜像：y' = H - y
    var hy = H * 0.30;
    function fy(v) { return (H - v).toFixed(1); }
    return "M0," + fy(hy) +
      " C" + (W * 0.05).toFixed(1) + "," + fy(hy) + " " + (W * 0.09).toFixed(1) + "," + fy(H * 0.02) + " " + (W * 0.16).toFixed(1) + "," + fy(H * 0.02) +
      " C" + (W * 0.28).toFixed(1) + "," + fy(H * 0.03) + " " + (W * 0.36).toFixed(1) + "," + fy(H * 0.18) + " " + (W * 0.43).toFixed(1) + "," + fy(H * 0.38) +
      " C" + (W * 0.47).toFixed(1) + "," + fy(H * 0.52) + " " + (W * 0.49).toFixed(1) + "," + fy(H * 0.68) + " " + (W * 0.5).toFixed(1) + "," + fy(H * 0.9) +
      " C" + (W * 0.51).toFixed(1) + "," + fy(H * 0.68) + " " + (W * 0.53).toFixed(1) + "," + fy(H * 0.52) + " " + (W * 0.57).toFixed(1) + "," + fy(H * 0.38) +
      " C" + (W * 0.64).toFixed(1) + "," + fy(H * 0.18) + " " + (W * 0.72).toFixed(1) + "," + fy(H * 0.03) + " " + (W * 0.84).toFixed(1) + "," + fy(H * 0.02) +
      " C" + (W * 0.91).toFixed(1) + "," + fy(H * 0.02) + " " + (W * 0.95).toFixed(1) + "," + fy(hy) + " " + W.toFixed(1) + "," + fy(hy);
  }

  /* 布局坐标：不受 transform/动画影响（图案进场的 popIn 动画是 scale(0) 起步，
   * 用 getBoundingClientRect 会量成 0×0，括号就画不出来了） */
  function absOffset(el) {
    var x = 0, y = 0, n = el;
    while (n && n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y };
  }
  function measure(host, hostPos, hostRect, el) {
    var ow = typeof el.offsetWidth === "number" ? el.offsetWidth : 0;
    var oh = typeof el.offsetHeight === "number" ? el.offsetHeight : 0;
    if (ow > 0 || oh > 0) {
      var p = absOffset(el);
      return { x: p.x - hostPos.x, y: p.y - hostPos.y, w: ow, h: oh };
    }
    // 退化：没有 offsetWidth 的元素（内联 SVG 等）用视觉矩形
    if (!el.getBoundingClientRect) return null;
    var r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left - hostRect.left, y: r.top - hostRect.top, w: r.width, h: r.height };
  }

  /* 一组元素的联合包围盒（相对宿主元素） */
  function union(host, els) {
    var box = null, i, r;
    if (!host) return null;
    var hostPos = absOffset(host);
    var hostRect = host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 };
    for (i = 0; i < els.length; i++) {
      if (!els[i]) continue;
      r = measure(host, hostPos, hostRect, els[i]);
      if (!r) continue;
      if (!box) box = { x: r.x, y: r.y, w: r.w, h: r.h };
      else {
        var x2 = Math.max(box.x + box.w, r.x + r.w), y2 = Math.max(box.y + box.h, r.y + r.h);
        box.x = Math.min(box.x, r.x); box.y = Math.min(box.y, r.y);
        box.w = x2 - box.x; box.h = y2 - box.y;
      }
    }
    return box;
  }
  // 默认测量对象：父容器里的 .row（Vue 场景行）；没有就量上一个兄弟元素
  function defaultSpan(host) {
    var p = host.parentNode, rows, i;
    if (!p) return [];
    rows = p.querySelectorAll ? p.querySelectorAll(".row") : [];
    if (rows.length) { return Array.prototype.slice.call(rows); }
    var prev = host.previousElementSibling;
    return prev ? [prev] : [];
  }
  function optOf(opt) {
    opt = opt || {};
    return {
      span: opt.span || null,
      label: opt.label || "",
      color: opt.color || "#ef6c00",
      stroke: typeof opt.stroke === "number" ? opt.stroke : 5,
      depth: typeof opt.depth === "number" ? opt.depth : 0,   // 0 = 按宽度自动
      up: !!opt.up,
      dur: typeof opt.dur === "number" ? opt.dur : 700,
      pad: typeof opt.pad === "number" ? opt.pad : 12,       // 括号比图案宽出的像素
      labelColor: opt.labelColor || opt.color || "#e65100"
    };
  }

  /* ---------- 画（宿主变成定位容器，SVG 以普通流占据空间） ---------- */
  function draw(host, opt) {
    if (!host) return null;
    var o = optOf(opt);
    host.__braceOpt = o;
    if (!host.__braceInit) {
      try { host.style.position = "relative"; } catch (e0) {}
      host.__braceInit = true;
    }
    var els = o.span && o.span.length ? o.span : defaultSpan(host);
    var box = union(host, els);
    clear(host);
    if (!box || !box.w) return null;
    var W = Math.round(box.w + o.pad * 2);
    var H = Math.round(o.depth || clamp(W * 0.16, 18, 40));
    var top = o.up ? 2 : 0;
    var svg = mk("svg");
    svg.setAttribute("class", "yb-brace-svg" + (o.up ? " up" : ""));
    svg.setAttribute("width", W);
    svg.setAttribute("height", H + 4);
    svg.setAttribute("viewBox", "0 0 " + W + " " + (H + 4));
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.display = "block";
    svg.style.margin = "0 auto";
    svg.style.overflow = "visible";
    var g = mk("g");
    if (o.up) g.setAttribute("transform", "translate(0,2)");
    var p = mk("path");
    p.setAttribute("d", o.up ? pathUp(W, H) : pathDown(W, H));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", o.color);
    p.setAttribute("stroke-width", o.stroke);
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    g.appendChild(p);
    svg.appendChild(g);
    host.appendChild(svg);
    if (o.label) {
      var lab = document.createElement("div");
      lab.className = "yb-brace-label";
      lab.style.color = o.labelColor;
      lab.textContent = o.label;
      host.appendChild(lab);
    }
    // 描线动画：像用笔把括号写上去
    try {
      var len = p.getTotalLength ? p.getTotalLength() : 400;
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      void p.getBoundingClientRect();
      p.style.transition = "stroke-dashoffset " + o.dur + "ms ease";
      p.style.strokeDashoffset = "0";
    } catch (e1) {}
    host.__braceSvg = svg;
    return svg;
  }
  function update(host, opt) {
    if (!host) return null;
    return draw(host, opt || host.__braceOpt || {});
  }
  function clear(host) {
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    host.__braceSvg = null;
  }

  /* ---------- 自动观察：DOM 增删/类名变化 + 窗口缩放 → 防抖重画 ----------
   * 注意：括号自己的 DOM 变化（描线动画的 style、label 文本）必须忽略，否则会无限重画。 */
  function watch(host, opt) {
    if (!host) return;
    var t = null;
    function schedule() {
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; update(host, opt); }, 380);
    }
    function inHost(node) {
      var n = node;
      while (n) { if (n === host) return true; n = n.parentNode; }
      return false;
    }
    if (host.__braceMO) { try { host.__braceMO.disconnect(); } catch (e0) {} host.__braceMO = null; }
    if (w.MutationObserver) {
      var p = host.parentNode;
      if (p) {
        try {
          var mo = new w.MutationObserver(function (recs) {
            for (var i = 0; i < recs.length; i++) {
              if (inHost(recs[i].target)) continue;   // 括号自己的变化不理会
              schedule();
              return;
            }
          });
          mo.observe(p, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
          host.__braceMO = mo;
        } catch (e1) {}
      }
    }
    if (!host.__braceOnResize) {
      host.__braceOnResize = function () { schedule(); };
      w.addEventListener("resize", host.__braceOnResize);
    }
  }
  function unwatch(host) {
    if (!host) return;
    if (host.__braceMO) { try { host.__braceMO.disconnect(); } catch (e) {} host.__braceMO = null; }
    if (host.__braceOnResize) { w.removeEventListener("resize", host.__braceOnResize); host.__braceOnResize = null; }
  }

  App.Brace = {
    draw: draw,
    update: update,
    clear: clear,
    watch: watch,
    unwatch: unwatch,
    pathDown: pathDown,
    pathUp: pathUp
  };

  /* ---------- Vue 组件：<brace-box label="？个"></brace-box> ----------
   * 自动量父容器 .row 的联合宽度画括号； mounted/updated 重画 + watch 自适应。
   * 由 app.js 统一注册（和 site-shell 一样）。 */
  App.BraceBox = {
    name: "brace-box",
    props: {
      label: { type: String, default: "" },
      color: { type: String, default: "#ef6c00" },
      stroke: { type: Number, default: 5 },
      depth: { type: Number, default: 0 },
      up: { type: Boolean, default: false },
      dur: { type: Number, default: 700 },
      spanSel: { type: String, default: ".row" }
    },
    template: [
      '<div class="yb-brace" ref="host">',
      '</div>'
    ].join(""),
    mounted: function () { this.render(); },
    updated: function () { this.render(); },
    beforeUnmount: function () { App.Brace.unwatch(this.$refs.host); },
    methods: {
      render: function () {
        var host = this.$refs.host;
        if (!host || !App.Brace) return;
        var span = null;
        if (this.spanSel && host.parentNode && host.parentNode.querySelectorAll) {
          var list = host.parentNode.querySelectorAll(this.spanSel);
          if (list && list.length) span = Array.prototype.slice.call(list);
        }
        App.Brace.draw(host, {
          span: span, label: this.label, color: this.color, stroke: this.stroke,
          depth: this.depth, up: this.up, dur: this.dur
        });
        App.Brace.watch(host, {
          label: this.label, color: this.color, stroke: this.stroke,
          depth: this.depth, up: this.up, dur: this.dur, spanSel: this.spanSel
        });
      }
    }
  };
})(window);
