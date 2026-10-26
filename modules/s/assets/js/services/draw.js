/*
 * draw.js — 服务层 / 画图引擎（SVG 覆盖层，真正"对准"DOM 元素绘制）
 * 解决：以前大括号是写死的静态 SVG，位置固定，括住的区域当然是空白。
 * 现在：所有标注（大括号/箭头/圈/叉/下划线/框/文字）都先量出元素的真实位置再画。
 *
 * 用法：
 *   var L = App.Draw.layer(容器);                       // 拿/建覆盖层（容器需 position:relative）
 *   App.Draw.brace(L, [元素1, 元素2], { label: "2 个" }); // 在元素下方画大括号括住它们
 *   App.Draw.ring(L, el); App.Draw.cross(L, el); App.Draw.arrow(L, elA, elB);
 *   App.Draw.clear(L);                                  // 清空（重画前调用）
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var SVGNS = "http://www.w3.org/2000/svg";

  function mk(tag) { return document.createElementNS(SVGNS, tag); }

  /* 容器 → 覆盖层 SVG（每个容器只建一个） */
  function layer(container) {
    if (!container) return null;
    var svg = container.__drawSvg;
    if (!svg) {
      svg = mk("svg");
      svg.setAttribute("class", "draw-layer");
      svg.style.position = "absolute";
      svg.style.left = "0"; svg.style.top = "0";
      svg.style.width = "100%"; svg.style.height = "100%";
      svg.style.pointerEvents = "none";
      svg.style.overflow = "visible";
      svg.style.zIndex = "5";
      container.appendChild(svg);
      container.__drawSvg = svg;
      container.__drawItems = [];
      // 窗口尺寸变化时按原样重画，保证始终对准
      w.addEventListener("resize", function () { redraw(container); });
    }
    return svg;
  }

  /* 量出元素相对容器的真实位置 */
  function rel(container, el) {
    if (!el || !el.getBoundingClientRect) return null;
    var r = el.getBoundingClientRect(), b = container.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height, cx: r.left - b.left + r.width / 2, cy: r.top - b.top + r.height / 2 };
  }

  /* 一组元素的联合包围盒 */
  function bbox(container, els) {
    var box = null, i, r;
    for (i = 0; i < els.length; i++) {
      r = rel(container, els[i]);
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

  /* 记录一次绘制（resize 重放用） */
  function record(container, fn) {
    layer(container);
    if (container.__drawItems) container.__drawItems.push(fn);
    return fn;
  }
  function redraw(container) {
    var svg = container.__drawSvg;
    if (!svg) return;
    clear(container);
    var items = container.__drawItems.slice(0);
    container.__drawItems = [];
    for (var i = 0; i < items.length; i++) { try { items[i](); } catch (e) {} }
  }

  function clear(container) {
    var svg = container && container.__drawSvg;
    if (svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }
    if (container) container.__drawItems = [];
  }

  /* ---------- 基础图元 ---------- */
  function optOf(opt) {
    opt = opt || {};
    return {
      color: opt.color || "#e65100",
      w: opt.w || 3,
      label: opt.label || "",
      labelColor: opt.labelColor || "#e65100",
      dur: typeof opt.dur === "number" ? opt.dur : 700,
      pad: typeof opt.pad === "number" ? opt.pad : 8
    };
  }
  function line(x1, y1, x2, y2, o) {
    var l = mk("line");
    l.setAttribute("x1", x1); l.setAttribute("y1", y1);
    l.setAttribute("x2", x2); l.setAttribute("y2", y2);
    l.setAttribute("stroke", o.color); l.setAttribute("stroke-width", o.w);
    l.setAttribute("stroke-linecap", "round");
    return l;
  }
  function ellipse(cx, cy, rx, ry, o, dash) {
    var e = mk("ellipse");
    e.setAttribute("cx", cx); e.setAttribute("cy", cy);
    e.setAttribute("rx", rx); e.setAttribute("ry", ry);
    e.setAttribute("fill", "none");
    e.setAttribute("stroke", o.color); e.setAttribute("stroke-width", o.w);
    if (dash) e.setAttribute("stroke-dasharray", dash);
    return e;
  }
  function labelText(svg, cx, y, txt, o, size) {
    var t = mk("text");
    t.setAttribute("x", cx); t.setAttribute("y", y);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", size || 18);
    t.setAttribute("font-weight", "bold");
    t.setAttribute("fill", o.labelColor);
    t.setAttribute("font-family", '"PingFang SC","Microsoft YaHei",sans-serif');
    t.textContent = txt;
    svg.appendChild(t);
    return t;
  }
  // 描线动画（像用笔写上去）
  function drawIn(el, dur) {
    try {
      var len = el.getTotalLength ? el.getTotalLength() : 400;
      el.style.strokeDasharray = len;
      el.style.strokeDashoffset = len;
      void el.getBoundingClientRect();
      el.style.transition = "stroke-dashoffset " + (dur || 700) + "ms ease";
      el.style.strokeDashoffset = "0";
    } catch (e) {}
  }

  /* ---------- 大括号：真正量出元素位置再画 ---------- */
  // 向下大括号（元素下方）：(x,y) 左端，w 跨度，h 深度，尖端在下方
  function braceDownPath(x, y, w, h) {
    return "M" + x + "," + y +
      " C" + (x + 0.10 * w) + "," + (y + 0.06 * h) + " " + (x + 0.40 * w) + "," + (y + 0.42 * h) + " " + (x + 0.5 * w) + "," + (y + 0.62 * h) +
      " C" + (x + 0.60 * w) + "," + (y + 0.42 * h) + " " + (x + 0.90 * w) + "," + (y + 0.06 * h) + " " + (x + w) + "," + y;
  }
  // 向上大括号（元素上方）：尖端在上方
  function braceUpPath(x, y, w, h) {
    return "M" + x + "," + (y + h) +
      " C" + (x + 0.10 * w) + "," + (y + h - 0.06 * h) + " " + (x + 0.40 * w) + "," + (y + h - 0.42 * h) + " " + (x + 0.5 * w) + "," + (y + h - 0.62 * h) +
      " C" + (x + 0.60 * w) + "," + (y + h - 0.42 * h) + " " + (x + 0.90 * w) + "," + (y + h - 0.06 * h) + " " + (x + w) + "," + (y + h);
  }
  function brace(container, els, opt) {
    opt = opt || {};
    var o = optOf(opt);
    return record(container, function () {
      var svg = layer(container);
      if (!svg) return;
      var box = bbox(container, els);
      if (!box || !box.w) return;
      var up = !!opt.up;
      var depth = opt.depth || Math.max(14, Math.min(30, box.w * 0.12));
      var p = mk("path");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", o.color);
      p.setAttribute("stroke-width", o.w);
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("d", up
        ? braceUpPath(box.x - o.pad, box.y - depth - o.pad, box.w + o.pad * 2, depth)
        : braceDownPath(box.x - o.pad, box.y + box.h + o.pad, box.w + o.pad * 2, depth));
      svg.appendChild(p);
      drawIn(p, o.dur);
      if (o.label) {
        var ly = up ? (box.y - depth - o.pad - 8) : (box.y + box.h + o.pad + depth + 18);
        labelText(svg, box.x + box.w / 2, ly, o.label, o, opt.labelSize || 17);
      }
      return p;
    });
  }

  /* ---------- 其他标注 ---------- */
  function ring(container, el, opt) {
    opt = opt || {};
    var o = optOf(opt);
    return record(container, function () {
      var svg = layer(container);
      var r = rel(container, el);
      if (!svg || !r) return;
      var e = ellipse(r.cx, r.cy, r.w / 2 + o.pad, r.h / 2 + o.pad, o, "6 5");
      svg.appendChild(e);
      drawIn(e, o.dur);
      if (o.label) labelText(svg, r.cx, r.y - 8, o.label, o, opt.labelSize || 16);
      return e;
    });
  }
  function underline(container, el, opt) {
    opt = opt || {};
    var o = optOf(opt);
    return record(container, function () {
      var svg = layer(container);
      var r = rel(container, el);
      if (!svg || !r) return;
      var y = r.y + r.h + 6;
      var p = mk("path");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", o.color);
      p.setAttribute("stroke-width", o.w);
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("d", "M" + r.x + "," + y + " q" + (r.w / 4) + ",6 " + (r.w / 2) + ",0 q" + (r.w / 4) + ",-6 " + (r.w / 2) + ",0");
      svg.appendChild(p);
      drawIn(p, o.dur);
      return p;
    });
  }
  function cross(container, el, opt) {
    opt = opt || {};
    var o = optOf(opt);
    return record(container, function () {
      var svg = layer(container);
      var r = rel(container, el);
      if (!svg || !r) return;
      var g = mk("g");
      g.appendChild(line(r.x - 4, r.y - 4, r.x + r.w + 4, r.y + r.h + 4, o));
      g.appendChild(line(r.x + r.w + 4, r.y - 4, r.x - 4, r.y + r.h + 4, o));
      svg.appendChild(g);
      return g;
    });
  }
  function frame(container, el, opt) {
    opt = opt || {};
    var o = optOf(opt);
    return record(container, function () {
      var svg = layer(container);
      var r = rel(container, el);
      if (!svg || !r) return;
      var rect = mk("rect");
      rect.setAttribute("x", r.x - o.pad); rect.setAttribute("y", r.y - o.pad);
      rect.setAttribute("width", r.w + o.pad * 2); rect.setAttribute("height", r.h + o.pad * 2);
      rect.setAttribute("rx", 10);
      rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", o.color); rect.setAttribute("stroke-width", o.w);
      if (opt.dash) rect.setAttribute("stroke-dasharray", "7 5");
      svg.appendChild(rect);
      drawIn(rect, o.dur);
      return rect;
    });
  }
  function arrow(container, el1, el2, opt) {
    opt = opt || {};
    var o = optOf(opt);
    return record(container, function () {
      var svg = layer(container);
      var r1 = rel(container, el1), r2 = rel(container, el2);
      if (!svg || !r1 || !r2) return;
      var x1 = r1.cx, y1 = r1.cy, x2 = r2.cx, y2 = r2.cy;
      var mx = (x1 + x2) / 2, my = Math.min(y1, y2) - 40;
      var p = mk("path");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", o.color);
      p.setAttribute("stroke-width", o.w);
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("marker-end", "url(#drawArrowHead)");
      p.setAttribute("d", "M" + x1 + "," + y1 + " Q" + mx + "," + my + " " + x2 + "," + (y2 - r2.h / 2 - 4));
      ensureDefs(svg);
      svg.appendChild(p);
      drawIn(p, o.dur);
      return p;
    });
  }
  function ensureDefs(svg) {
    if (svg.querySelector("defs")) return;
    var defs = mk("defs");
    var marker = mk("marker");
    marker.setAttribute("id", "drawArrowHead");
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "4");
    marker.setAttribute("orient", "auto");
    var poly = mk("polygon");
    poly.setAttribute("points", "0,0 9,4 0,8");
    poly.setAttribute("fill", "#e65100");
    marker.appendChild(poly);
    defs.appendChild(marker);
    svg.appendChild(defs);
  }
  function text(container, x, y, str, opt) {
    opt = opt || {};
    var o = optOf(opt);
    return record(container, function () {
      var svg = layer(container);
      if (!svg) return;
      return labelText(svg, x, y, str, o, opt.size || 18);
    });
  }

  App.Draw = {
    layer: layer,
    clear: clear,
    redraw: redraw,
    rel: rel,
    bbox: bbox,
    brace: brace,
    ring: ring,
    underline: underline,
    cross: cross,
    frame: frame,
    arrow: arrow,
    text: text,
    braceDownPath: braceDownPath,
    braceUpPath: braceUpPath
  };
})(window);
