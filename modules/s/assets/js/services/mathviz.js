/* mathviz.js — 数学图形化教学引擎 (2026-10-28 重构)
 * ★本次修复(用户实测反馈):
 *   1. 【图形与题目不符】旧版写死 🍎 emoji —— 题干是兔子/小鸡/苹果, 教学图却永远是苹果,
 *      颜色形状全对不上。现在改为直接复用 images.js 的彩色 SVG(与题干同源同一套图)。
 *   2. 【多画好几个图】调用方若同时渲染 scene 排列图 + 本图会重叠 —— 见 math-view.js 协同处理。
 * 教学法规范:
 *   加法: 两组物体 + 大括号【向下开口】+ 问号在下面(求总数)
 *   减法: 总数物体 + 动画划线删除 + 大括号【向上开口/尖头朝上】+ 问号在上面(求剩余)
 *   乘法: 行×列矩阵图("每行b个,有a行"), 求总和
 *   除法: 总数矩阵, 按行/列分组去掉演示("每份b个,能分几份")
 * API:
 *   App.MathViz.svg(spec)   spec={op:"add|sub|mul|div", a, b, icon}  ← icon 为 images.js 的图形 id
 *   App.MathViz.show(el, spec)
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var ICON = "🍎";

  /* ---------- 题干图形 → SVG 元素（★与 images.js 同源, 颜色形态完全一致）---------- */
  /* 注意: CSS 动画里的 transform 会覆盖 <g> 的 transform 属性导致图形全部堆叠到原点,
   *       所以必须「外层 g 只做定位缩放 / 内层 g 只做动画」两层分开。 */
  function itemSVG(id, cx, cy, size, cls, delay) {
    var raw = "";
    try { raw = (App.IMG && App.IMG.svg) ? App.IMG.svg(id) : ""; } catch (e) { raw = ""; }
    var inner = "", m = raw && raw.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
    if (m && m[1]) inner = m[1];
    if (inner) {
      var s = size / 64;   // images.js 图形统一是 viewBox 0 0 64 64
      return '<g class="mv-pos" transform="translate(' + (cx - 32 * s).toFixed(1) + ',' + (cy - 32 * s).toFixed(1) + ') scale(' + s.toFixed(4) + ')">' +
        '<g class="mv-it ' + (cls || "") + '" style="animation-delay:' + delay + 'ms">' + inner + '</g></g>';
    }
    /* 图形库里没有这个 id 时才回退成 emoji */
    return '<text class="mv-it ' + (cls || "") + '" x="' + cx + '" y="' + (cy + size * 0.36).toFixed(1) + '" font-size="' + size + '" text-anchor="middle" style="animation-delay:' + delay + 'ms">' + ICON + '</text>';
  }

  /* ---------- 布局工具 ---------- */
  function rowItems(n, x0, cy, gap, size, cls, delay0, step, id) {
    var s = "";
    for (var i = 0; i < n; i++) s += itemSVG(id, x0 + i * gap, cy, size, cls, delay0 + i * step);
    return s;
  }
  /* 大括号: dir=down(向下开口,问号在下) / up(向上开口,尖头+问号在上) */
  function brace(x1, x2, y, dir, label) {
    var mid = (x1 + x2) / 2, h = dir === "down" ? 22 : -22, w = 10;
    var d = dir === "down"
      ? "M " + x1 + " " + y + " q 0 " + (h * 0.6) + " " + w + " " + (h * 0.6) + " L " + (mid - 4) + " " + (y + h * 0.6) + " q " + 4 + " 0 " + 4 + " " + (h * 0.4) + " q 0 " + (-h * 0.4) + " " + 4 + " " + (-h * 0.4) + " L " + (x2 - w) + " " + (y + h * 0.6) + " q " + w + " 0 " + w + " " + (-h * 0.6)
      : "M " + x1 + " " + y + " q 0 " + (h * 0.6) + " " + w + " " + (h * 0.6) + " L " + (mid - 4) + " " + (y + h * 0.6) + " q 4 0 4 " + (h * 0.4) + " q 0 " + (-h * 0.4) + " 4 " + (-h * 0.4) + " L " + (x2 - w) + " " + (y + h * 0.6) + " q " + w + " 0 " + w + " " + (-h * 0.6);
    var ly = dir === "down" ? y + h + 18 : y + h - 8;
    return '<path class="mv-brace" d="' + d + '" fill="none"/>' +
      '<text class="mv-q" x="' + mid + '" y="' + ly + '" text-anchor="middle">' + (label || "?") + '</text>';
  }
  /* 划线删除(斜线, 动画) */
  function strikes(items, cls) {
    var s = "";
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      s += '<line class="mv-strike ' + (cls || "") + '" x1="' + (it.x - 17) + '" y1="' + (it.y - 17) + '" x2="' + (it.x + 17) + '" y2="' + (it.y + 17) + '"' +
        ' style="animation-delay:' + it.delay + 'ms"/>';
    }
    return s;
  }

  /* ---------- 四则图（★全部接收 id, 图形与题目同源）---------- */
  function addSVG(a, b, id) {
    var total = a + b, gap = 36, W = Math.max(total * gap + 80, 320), H = 196;
    var x0 = (W - total * gap) / 2 + gap / 2, CY = 96;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mviz">' +
      rowItems(a, x0, CY, gap, 30, "", 0, 90, id) +
      rowItems(b, x0 + a * gap, CY, gap, 30, "mv-b", a * 90, 90, id) +
      '<text x="' + (x0 + (a - 1) * gap / 2) + '" y="44" class="mv-lb" text-anchor="middle">' + a + '个</text>' +
      '<text x="' + (x0 + a * gap + (b - 1) * gap / 2) + '" y="44" class="mv-lb mv-lb2" text-anchor="middle">' + b + '个</text>' +
      brace(x0 - 20, x0 + total * gap - gap + 20, CY + 26, "down") +
      '<text x="' + (W / 2) + '" y="' + (H - 12) + '" class="mv-tip" text-anchor="middle">' + a + ' 和 ' + b + ' 合起来，一共多少？(大括号向下=求总数)</text></svg>';
  }
  function subSVG(a, b, id) {
    /* a 总数, b 划掉, a-b 剩余 */
    var gap = 36, W = Math.max(a * gap + 120, 320), H = 206;
    var x0 = (W - a * gap) / 2 + gap / 2, CY = 96;
    var items = [];
    for (var i = 0; i < a; i++) items.push({ x: x0 + i * gap, y: CY, delay: 700 + i * 130 });
    var cut = items.slice(a - b);   /* 从右往左划 */
    var keepL = x0 - 20, keepR = x0 + (a - b) * gap - gap + 20;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mviz">' +
      rowItems(a, x0, CY, gap, 30, "", 0, 90, id) +
      strikes(cut) +
      brace(keepL, keepR, CY + 28, "up") +
      '<text x="' + ((keepL + keepR) / 2) + '" y="34" class="mv-lb" text-anchor="middle">剩多少?</text>' +
      '<text x="' + (W / 2) + '" y="' + (H - 12) + '" class="mv-tip" text-anchor="middle">一共 ' + a + ' 个，划掉 ' + b + ' 个（大括号向上+问号在上=求剩余），剩 ' + (a - b) + ' 个</text></svg>';
  }
  function mulSVG(a, b, id) {
    var gap = 34, W = Math.max(b * gap + 120, 300), rh = 44, H = a * rh + 100;
    var x0 = (W - b * gap) / 2 + gap / 2, y0 = 58;
    var s = "", r, c;
    for (r = 0; r < a; r++) {
      for (c = 0; c < b; c++) s += itemSVG(id, x0 + c * gap, y0 + r * rh, 30, "", (r * b + c) * 55);
      s += '<text class="mv-lb" x="' + (x0 + b * gap - gap / 2 + 26) + '" y="' + (y0 + r * rh + 4) + '" text-anchor="start">←' + b + '个</text>';
    }
    /* 行分组虚线框 */
    for (r = 0; r < a; r++) {
      s += '<rect class="mv-grp" x="' + (x0 - 22) + '" y="' + (y0 - 24 + r * rh) + '" width="' + (b * gap - gap + 44) + '" height="40" rx="9" style="animation-delay:' + (600 + r * 260) + 'ms"/>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mviz">' + s +
      '<text x="12" y="' + (y0 + (a - 1) * rh / 2) + '" class="mv-lb mv-lb2" text-anchor="start">' + a + '行</text>' +
      '<text x="' + (W / 2) + '" y="' + (H - 34) + '" class="mv-tip" text-anchor="middle">每行 ' + b + ' 个，共 ' + a + ' 行 → ' + b + '×' + a + '=' + (a * b) + '（矩阵求总和）</text></svg>';
  }
  function divSVG(a, b, id) {
    /* a 总数按每行 b 个排矩阵, 演示去掉一行=减b, 可去几次=商 */
    var cols = b, rows = Math.ceil(a / cols);
    var gap = 34, W = Math.max(cols * gap + 100, 300), rh = 42, H = rows * rh + 96;
    var x0 = (W - cols * gap) / 2 + gap / 2, y0 = 56;
    var s = "", k = 0, rowInfo = [], r, c, inRow;
    for (r = 0; r < rows && k < a; r++) {
      inRow = Math.min(cols, a - k);
      for (c = 0; c < inRow; c++) { s += itemSVG(id, x0 + c * gap, y0 + r * rh, 28, "", k * 55); k++; }
      rowInfo.push({ y: y0 + r * rh, delay: 900 + r * 500, n: inRow });
    }
    /* 行删除动画: 虚线+淡出 */
    for (r = 1; r < rowInfo.length; r++) {
      s += '<line class="mv-strike mv-divcut" x1="' + (x0 - 22) + '" y1="' + (rowInfo[r].y - 20) + '" x2="' + (x0 + (rowInfo[r].n - 1) * gap + 22) + '" y2="' + (rowInfo[r].y - 20) + '" style="animation-delay:' + rowInfo[r].delay + 'ms"/>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mviz">' + s +
      '<text x="' + (W / 2) + '" y="' + (H - 36) + '" class="mv-tip" text-anchor="middle">一共 ' + a + ' 个，每行放 ' + b + ' 个（去掉一行=减' + b + '），可以放 ' + Math.floor(a / b) + ' 行 → ' + a + '÷' + b + '=' + Math.floor(a / b) + (a % b ? "……" + (a % b) : "") + '</text></svg>';
  }

  function svg(spec) {
    if (!spec || !spec.op) return "";
    /* icon 缺省用苹果, 保证永远有图(调用方应传题干的物体 id) */
    var id = spec.icon || spec.iconId || "apple";
    switch (spec.op) {
      case "add": return addSVG(spec.a, spec.b, id);
      case "sub": return subSVG(spec.a, spec.b, id);
      case "mul": return mulSVG(spec.a, spec.b, id);
      case "div": return divSVG(spec.a, spec.b, id);
    }
    return "";
  }
  function show(el, spec) {
    if (!el) return;
    el.innerHTML = '<div class="mviz-box">' + svg(spec) + '<div class="mviz-alt">' + altWays(spec) + '</div></div>';
  }
  /* 多种方法理解 */
  function altWays(spec) {
    if (!spec) return "";
    var a = spec.a, b = spec.b, t = [];
    switch (spec.op) {
      case "add":
        t.push("方法1 数数: 从 " + a + " 往后数 " + b + " 个 → " + (a + b));
        t.push("方法2 凑十: " + a + " + " + b + "，先凑整再加余");
        t.push("方法3 画图: 两组合在一起，大括号向下求总数");
        break;
      case "sub":
        t.push("方法1 倒着数: 从 " + a + " 往回数 " + b + " 个 → " + (a - b));
        t.push("方法2 想加法: " + b + " + ? = " + a + "，? = " + (a - b));
        t.push("方法3 画图: 划掉 " + b + " 个，大括号向上问号在上，剩 " + (a - b));
        break;
      case "mul":
        t.push("方法1 连加: " + Array(a).fill(b).join(" + ") + " = " + (a * b));
        t.push("方法2 矩阵: 每行 " + b + " 个 × " + a + " 行 = " + (a * b) + " 个");
        t.push("方法3 分组数: 一行一行数，" + a + " 个 " + b + "");
        break;
      case "div":
        t.push("方法1 分一分: " + a + " 个，每 " + b + " 个一份，分了 " + Math.floor(a / b) + " 份");
        t.push("方法2 想乘法: " + b + " × ? = " + a + "，? = " + Math.floor(a / b));
        t.push("方法3 去行列: 矩阵每去掉一行就是减 " + b + "，能去 " + Math.floor(a / b) + " 次");
        break;
    }
    return t.map(function (x) { return '<div class="mv-alt-item">' + x + "</div>"; }).join("");
  }

  App.MathViz = { show: show, svg: svg, itemSVG: itemSVG };
})(window);
