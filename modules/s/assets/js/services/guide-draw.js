/*
 * guide-draw.js — 服务层 / 画图指导工具箱（开源库封装）
 * 封装 GitHub 开源库，为数学画图（线段/图形）、语文写字格、英语四线三格、
 * 笔顺描边动画、拖拽排序、礼花特效提供统一接口。
 *
 * 依赖（assets/js/vendor/，均为 UMD/全局构建，无网络也能用）：
 *   svg.min.js      SVG.js v2   —— 画线段/图形/格子
 *   rough.js        Rough.js    —— 手绘风格图形（童趣）
 *   vivus.min.js    Vivus       —— SVG 描边动画（笔顺/书写示范）
 *   anime.min.js    anime.js v3 —— 补间动画（生长/移动/缩放）
 *   Sortable.min.js SortableJS  —— 拖拽排序（连词成句）
 *   canvas-confetti —— 礼花特效
 *   markdown-it     —— 范文 Markdown 渲染
 *
 * 原则：所有接口都做存在性检查，库缺失时安静降级，不影响页面其他功能。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var doc = w.document;

  var SVG = w.SVG, rough = w.rough, Vivus = w.Vivus, anime = w.anime,
      Sortable = w.Sortable, confetti = w.confetti, markdownit = w.markdownit;

  var C = {
    ink: "#3e2723", main: "#e65100", red: "#e53935", blue: "#1e88e5",
    green: "#43a047", grey: "#90a4ae", paper: "#fffdf7"
  };

  function el(tag, cls) {
    var d = doc.createElement(tag);
    if (cls) d.className = cls;
    return d;
  }
  function svgIn(box, wpx, hpx) {
    var host = typeof box === "string" ? doc.querySelector(box) : box;
    if (!host) return null;
    host.innerHTML = "";
    if (!SVG) {
      host.appendChild(el("div", "gd-fallback"));
      return null;
    }
    var draw = null;
    // ★2026-10-24 修"画图小工具点了没反应"(根因):
    //   本地 vendor 的 svg.min.js 是 SVG.js v2.7.1, 它的 Doc 工厂【必须带宿主节点】:
    //     · SVG()      → 构造时直接 attr() → this.node 为 undefined → 抛异常
    //     · SVG().addTo(domNode) → addTo 实现是 `t.put(this)`, 只接受 SVG.js 元素,
    //                              传 DOM 节点会抛 "t.put is not a function"
    //   正确用法: SVG(host) —— 工厂内部会建 <svg> 并 append 到 host、再 size(100%,100%)。
    //   下面保留 addTo 兜底(换新版 SVG.js 时也能用)。
    try {
      draw = SVG(host);
    } catch (e) {
      try { draw = SVG().addTo(host); } catch (e2) { host.appendChild(el("div", "gd-fallback")); return null; }
    }
    if (!draw) { host.appendChild(el("div", "gd-fallback")); return null; }
    try { draw.size("100%", "100%"); } catch (e3) { }
    if (wpx) draw.attr("viewBox", "0 0 " + wpx + " " + hpx);
    return draw;
  }
  function tween(target, to, opt) {
    if (!anime || !target) return null;
    var o = { targets: target, duration: (opt && opt.duration) || 800, easing: (opt && opt.easing) || "easeOutQuad" };
    for (var k in to) if (to.hasOwnProperty(k)) o[k] = to[k];
    if (opt && opt.complete) o.complete = opt.complete;
    return anime(o);
  }
  /* 描边动画：给 path 设置 dash 偏移，用 anime 从满偏移走到 0 */
  function drawIn(path, opt) {
    if (!path || !path.node) return;
    var n = path.node, len = 400;
    try { len = n.getTotalLength ? n.getTotalLength() : 400; } catch (e) {}
    n.style.strokeDasharray = len;
    n.style.strokeDashoffset = len;
    tween(n, { strokeDashoffset: [len, 0] }, { duration: (opt && opt.duration) || 900 });
  }

  /* ============ 1. 画线段（带尺子刻度 + 端点标注 + 生长动画） ============ */
  function segment(box, opt) {
    opt = opt || {};
    var draw = svgIn(box, 320, 120);
    if (!draw) return null;
    var x1 = opt.x1 !== undefined ? opt.x1 : 40, x2 = opt.x2 !== undefined ? opt.x2 : 280;
    var y = opt.y !== undefined ? opt.y : 70, color = opt.color || C.main;
    // 尺子
    draw.line(x1 - 12, y + 26, x2 + 12, y + 26).stroke({ width: 2, color: C.grey });
    var i, tick;
    for (i = 0; i <= (x2 - x1) / 20; i++) {
      tick = draw.line(x1 + i * 20, y + 20, x1 + i * 20, y + 32).stroke({ width: 1.5, color: C.grey });
      tween(tick.node, { opacity: [0, 1] }, { duration: 200 + i * 60 });
    }
    // 主线（生长动画）
    var main = draw.line(x1, y, x2, y).stroke({ width: opt.width || 4, color: color, linecap: "round" });
    drawIn(main, { duration: opt.duration || 1000 });
    // 端点 + 标注
    [[x1, "A"], [x2, "B"]].forEach(function (p) {
      draw.circle(10).center(p[0], y).fill(color).stroke({ width: 2, color: "#fff" });
      draw.text(p[1]).center(p[0], y - 20).font({ size: 15, family: "sans-serif" }).fill(C.ink);
    });
    if (opt.label) {
      draw.text(opt.label).center((x1 + x2) / 2, y + 54).font({ size: 13, family: "sans-serif" }).fill(C.grey);
    }
    return draw;
  }

  /* ============ 2. 数学图形（rough 手绘风 + 动画） ============ */
  function shape(box, type, opt) {
    opt = opt || {};
    var draw = svgIn(box, 320, 220);
    if (!draw) return null;
    var cx = 160, cy = 110, s = opt.size || 70, color = opt.color || C.blue;
    var host = draw.node.parentNode;
    var rc = null, node = null;
    if (rough) {
      try {
        var rs = rough.svg(draw.node);
        if (type === "circle") node = rs.circle(cx, cy, s * 2, { stroke: color, strokeWidth: opt.width || 3, roughness: 1.4 });
        else if (type === "square") node = rs.rectangle(cx - s, cy - s, s * 2, s * 2, { stroke: color, strokeWidth: opt.width || 3, roughness: 1.4 });
        else if (type === "triangle") node = rs.polygon([[cx, cy - s], [cx - s, cy + s * 0.8], [cx + s, cy + s * 0.8]], { stroke: color, strokeWidth: opt.width || 3, roughness: 1.4 });
        else if (type === "rect") node = rs.rectangle(cx - s * 1.4, cy - s * 0.7, s * 2.8, s * 1.4, { stroke: color, strokeWidth: opt.width || 3, roughness: 1.4 });
        else if (type === "angle") {
          node = rs.linearPath([[cx - s, cy + s * 0.7], [cx, cy - s * 0.3], [cx + s, cy + s * 0.7]], { stroke: color, strokeWidth: opt.width || 3, roughness: 1.4 });
        }
      } catch (e) { node = null; }
    }
    if (node) {
      draw.node.appendChild(node);
      // 依次描出每条手绘线
      var paths = node.querySelectorAll ? node.querySelectorAll("path") : [];
      for (var i = 0; i < paths.length; i++) drawIn({ node: paths[i] }, { duration: 500 + i * 200 });
    } else {
      // 无 rough 时的规整图形
      var p;
      if (type === "circle") p = draw.circle(s * 2).center(cx, cy).fill("none").stroke({ width: 3, color: color });
      else if (type === "square") p = draw.rect(s * 2, s * 2).center(cx, cy).fill("none").stroke({ width: 3, color: color });
      else if (type === "triangle") p = draw.polygon([[cx, cy - s], [cx - s, cy + s * 0.8], [cx + s, cy + s * 0.8]]).fill("none").stroke({ width: 3, color: color });
      else if (type === "rect") p = draw.rect(s * 2.8, s * 1.4).center(cx, cy).fill("none").stroke({ width: 3, color: color });
      else if (type === "angle") p = draw.polyline([[cx - s, cy + s * 0.7], [cx, cy - s * 0.3], [cx + s, cy + s * 0.7]]).fill("none").stroke({ width: 3, color: color });
      if (p) drawIn(p, { duration: 900 });
    }
    // 标注
    if (opt.labels) {
      opt.labels.forEach(function (lb) {
        draw.text(lb.t).center(lb.x, lb.y).font({ size: 14, family: "sans-serif" }).fill(C.ink);
      });
    }
    if (opt.name) {
      draw.text(opt.name).center(cx, 205).font({ size: 13, family: "sans-serif" }).fill(C.grey);
    }
    return draw;
  }

  /* ============ 3. 书写格：田字格 / 米字格 / 四线三格 ============ */
  function grid(box, kind, opt) {
    opt = opt || {};
    var draw;
    if (kind === "four" || kind === "pinyin") {
      draw = svgIn(box, 200, 150);
      if (!draw) return null;
      var x1 = 20, x2 = 180, ys = [20, 55, 90, 125];
      ys.forEach(function (y) {
        draw.line(x1, y, x2, y).stroke({ width: y === 20 || y === 125 ? 2 : 1, color: y === 20 || y === 125 ? C.ink : C.grey, dasharray: y === 20 || y === 125 ? null : "5 4" });
      });
    } else {
      draw = svgIn(box, 200, 200);
      if (!draw) return null;
      var a = 20, b = 180;
      draw.rect(b - a, b - a).move(a, a).fill(C.paper).stroke({ width: 2.5, color: C.ink });
      draw.line(a, a, b, b).stroke({ width: 1, color: C.grey, dasharray: "6 5" });
      draw.line(b, a, a, b).stroke({ width: 1, color: C.grey, dasharray: "6 5" });
      if (kind === "mi") {
        draw.line((a + b) / 2, a, (a + b) / 2, b).stroke({ width: 1, color: C.grey, dasharray: "6 5" });
        draw.line(a, (a + b) / 2, b, (a + b) / 2).stroke({ width: 1, color: C.grey, dasharray: "6 5" });
      }
    }
    return draw;
  }

  /* ============ 4. 笔顺描边动画（vivus，失败回退手动 dash） ============ */
  function stroke(box, paths, opt) {
    opt = opt || {};
    var host = typeof box === "string" ? doc.querySelector(box) : box;
    if (!host) return null;
    host.innerHTML = "";
    if (!SVG) return null;
    // ★同 svgIn: SVG.js v2.7.1 的 Doc 工厂必须带宿主节点(SVG(host)), 空参 SVG() 会炸
    var draw = null;
    try {
      draw = SVG(host);
      try { draw.size("100%", "100%"); } catch (e0) { }
      draw.attr("viewBox", "0 0 200 200");
    } catch (e) {
      try { draw = SVG().addTo(host).size("100%", "100%").attr("viewBox", "0 0 200 200"); }
      catch (e2) { return null; }
    }
    if (!draw) return null;
    paths.forEach(function (d, i) {
      var p = draw.path(d).fill("none").stroke({
        width: opt.width || 8, color: opt.color || C.ink, linecap: "round", linejoin: "round"
      });
      if (!Vivus || !anime) drawIn(p, { duration: opt.duration || 700 });
    });
    if (Vivus && anime) {
      // 用 anime 逐笔顺序描出（vivus 在此环境不可靠时 anime 也能兜底）
      var nodes = draw.node.querySelectorAll("path");
      for (var i = 0; i < nodes.length; i++) {
        (function (n, k) {
          setTimeout(function () {
            var len = 600;
            try { len = n.getTotalLength(); } catch (e) {}
            n.style.strokeDasharray = len;
            n.style.strokeDashoffset = len;
            tween(n, { strokeDashoffset: [len, 0] }, { duration: opt.duration || 700 });
          }, k * ((opt.duration || 700) + 200));
        })(nodes[i], i);
      }
    }
    return draw;
  }

  /* ============ 5. 拖拽排序（连词成句） ============ */
  function drag(elm, opt) {
    opt = opt || {};
    if (!Sortable || !elm) return null;
    return Sortable.create(elm, {
      animation: 160,
      ghostClass: opt.ghostClass || "drag-ghost",
      chosenClass: opt.chosenClass || "drag-chosen",
      onEnd: opt.onEnd || function () {}
    });
  }

  /* ============ 6. 礼花特效 ============ */
  function pop(x, y) {
    if (!confetti) return false;
    try {
      confetti({ particleCount: 60, spread: 70, origin: { x: x, y: y }, disableForReducedMotion: true });
      return true;
    } catch (e) { return false; }
  }
  function popFrom(elm) {
    if (!elm) return pop(0.5, 0.6);
    var r = elm.getBoundingClientRect();
    return pop((r.left + r.width / 2) / w.innerWidth, (r.top + r.height / 2) / w.innerHeight);
  }

  /* ============ 7. Markdown 渲染（范文） ============ */
  var md = null;
  function mdRender(text) {
    if (!markdownit) return String(text || "").replace(/\n/g, "<br>");
    if (!md) md = markdownit({ html: false, linkify: false, breaks: true });
    return md.render(String(text || ""));
  }

  App.Guide = {
    C: C,
    has: {
      svg: !!SVG, rough: !!rough, vivus: !!Vivus, anime: !!anime,
      sortable: !!Sortable, confetti: !!confetti, markdownit: !!markdownit
    },
    segment: segment, shape: shape, grid: grid, stroke: stroke,
    drag: drag, pop: pop, popFrom: popFrom, tween: tween, drawIn: drawIn,
    md: mdRender
  };
})(window);
