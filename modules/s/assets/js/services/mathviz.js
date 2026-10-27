/* mathviz.js — 数学图形化教学引擎 (2026-10-27)
 * 教学法(用户指定规范):
 *   加法: 两组物体 + 大括号【向下开口】+ 问号在下面(求总数)
 *   减法: 总数物体 + 动画划线删除被减部分 + 大括号【向上开口/尖头朝上】+ 问号在上面(求剩余)
 *   乘法: 行×列矩阵图("每行b个,有a行"), 求总和
 *   除法: 总数矩阵, 按行/列分组去掉演示("每份b个,能分几份")
 * 全部带动画(逐个出现/划掉/括号展开), 多解法提示。
 * API:
 *   App.MathViz.show(el, spec)     spec={op:"add|sub|mul|div", a, b, icon, ans}
 *   App.MathViz.svg(spec)          返回 SVG 字符串
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var ICON = "🍎";

  /* ---------- 布局工具 ---------- */
  function rowIcons(n, x0, y, gap, size, cls, delay0, step) {
    var s = "";
    for (var i = 0; i < n; i++) {
      s += '<text class="mv-it ' + (cls || "") + '" data-i="' + i + '" x="' + (x0 + i * gap) + '" y="' + y + '" font-size="' + size + '" text-anchor="middle"' +
        ' style="animation-delay:' + (delay0 + i * step) + 'ms">' + ICON + '</text>';
    }
    return s;
  }
  /* 大括号: dir=down(向下开口,问号在下) / up(向上开口,尖头+问号在上) */
  function brace(x1, x2, y, dir, label) {
    var mid = (x1 + x2) / 2, h = dir === "down" ? 22 : -22, w = 10;
    /* 贝塞尔大括号 */
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
      s += '<line class="mv-strike ' + (cls || "") + '" x1="' + (it.x - 16) + '" y1="' + (it.y - 14) + '" x2="' + (it.x + 16) + '" y2="' + (it.y + 6) + '"' +
        ' style="animation-delay:' + it.delay + 'ms"/>';
    }
    return s;
  }

  /* ---------- 四则图 ---------- */
  function addSVG(a, b) {
    var total = a + b, gap = 34, W = Math.max(total * gap + 80, 320), H = 190;
    var x0 = (W - total * gap) / 2 + gap / 2;
    var s1 = "", s2 = "";
    for (var i = 0; i < a; i++) s1 += '<text class="mv-it" x="' + (x0 + i * gap) + '" y="86" font-size="26" text-anchor="middle" style="animation-delay:' + i * 90 + 'ms">' + ICON + '</text>';
    for (var j = 0; j < b; j++) s2 += '<text class="mv-it mv-b" x="' + (x0 + (a + j) * gap) + '" y="86" font-size="26" text-anchor="middle" style="animation-delay:' + (a + j) * 90 + 'ms">' + ICON + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mviz">' +
      '<text x="' + (x0 + (a - 1) * gap / 2) + '" y="40" class="mv-lb" text-anchor="middle">' + a + '个</text>' +
      '<text x="' + (x0 + a * gap + (b - 1) * gap / 2) + '" y="40" class="mv-lb mv-lb2" text-anchor="middle">' + b + '个</text>' +
      s1 + s2 + brace(x0 - 20, x0 + total * gap - gap + 20, 104, "down") +
      '<text x="' + (W / 2) + '" y="172" class="mv-tip" text-anchor="middle">' + a + ' 和 ' + b + ' 合起来，一共多少？(大括号向下=求总数)</text></svg>';
  }
  function subSVG(a, b) {
    /* a 总数, b 划掉, a-b 剩余 */
    var gap = 34, W = Math.max(a * gap + 120, 320), H = 200;
    var x0 = (W - a * gap) / 2 + gap / 2;
    var items = [];
    for (var i = 0; i < a; i++) items.push({ x: x0 + i * gap, y: 86, delay: 700 + i * 130 });
    var cut = items.slice(a - b);   /* 从右往左划 */
    var keepL = x0 - 20, keepR = x0 + (a - b) * gap - gap + 20;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mviz">' +
      rowIcons(a, x0, 86, gap, 26, "", 0, 90) +
      strikes(cut) +
      brace(keepL, keepR, 118, "up") +
      '<text x="' + ((keepL + keepR) / 2) + '" y="34" class="mv-lb" text-anchor="middle">剩多少?</text>' +
      '<text x="' + (W / 2) + '" y="182" class="mv-tip" text-anchor="middle">一共 ' + a + ' 个，划掉 ' + b + ' 个（大括号向上+问号在上=求剩余），剩 ' + (a - b) + ' 个</text></svg>';
  }
  function mulSVG(a, b) {
    var gap = 32, W = Math.max(b * gap + 110, 300), rh = 38, H = a * rh + 96;
    var x0 = (W - b * gap) / 2 + gap / 2, y0 = 52;
    var s = "";
    for (var r = 0; r < a; r++) {
      for (var c = 0; c < b; c++) {
        s += '<text class="mv-it" x="' + (x0 + c * gap) + '" y="' + (y0 + r * rh) + '" font-size="24" text-anchor="middle" style="animation-delay:' + (r * b + c) * 55 + 'ms">' + ICON + '</text>';
      }
      s += '<text class="mv-lb" x="' + (x0 + b * gap - gap / 2 + 26) + '" y="' + (y0 + r * rh) + '" text-anchor="start">←' + b + '个</text>';
    }
    /* 行分组虚线框 */
    for (var r2 = 0; r2 < a; r2++) {
      s += '<rect class="mv-grp" x="' + (x0 - 22) + '" y="' + (y0 - r2 * 0 - 24 + r2 * rh) + '" width="' + (b * gap - gap + 44) + '" height="34" rx="9" style="animation-delay:' + (600 + r2 * 260) + 'ms"/>';
    }
    var midX = W / 2;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mviz">' + s +
      '<text x="12" y="' + (y0 + (a - 1) * rh / 2) + '" class="mv-lb mv-lb2" text-anchor="start">' + a + '行<br/></text>' +
      '<text x="' + midX + '" y="' + (H - 34) + '" class="mv-tip" text-anchor="middle">每行 ' + b + ' 个，共 ' + a + ' 行 → ' + b + '×' + a + '=' + (a * b) + '（矩阵求总和）</text></svg>';
  }
  function divSVG(a, b) {
    /* a 总数按每行 b 个排矩阵, 演示去掉一行=减b, 可去几次=商 */
    var cols = b, rows = Math.ceil(a / cols);
    var gap = 32, W = Math.max(cols * gap + 100, 300), rh = 36, H = rows * rh + 92;
    var x0 = (W - cols * gap) / 2 + gap / 2, y0 = 50;
    var s = "", k = 0;
    var rowInfo = [];
    for (var r = 0; r < rows && k < a; r++) {
      var inRow = Math.min(cols, a - k);
      var ids = [];
      for (var c = 0; c < inRow; c++) {
        s += '<text class="mv-it" x="' + (x0 + c * gap) + '" y="' + (y0 + r * rh) + '" font-size="24" text-anchor="middle" style="animation-delay:' + k * 55 + 'ms">' + ICON + '</text>';
        ids.push(k); k++;
      }
      rowInfo.push({ y: y0 + r * rh, delay: 900 + r * 500, n: inRow });
    }
    /* 行删除动画: 虚线+淡出 */
    for (var r2 = 1; r2 < rowInfo.length; r2++) {
      s += '<line class="mv-strike mv-divcut" x1="' + (x0 - 22) + '" y1="' + (rowInfo[r2].y - 16) + '" x2="' + (x0 + (rowInfo[r2].n - 1) * gap + 22) + '" y2="' + (rowInfo[r2].y - 16) + '" style="animation-delay:' + rowInfo[r2].delay + 'ms"/>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mviz">' + s +
      '<text x="' + (W / 2) + '" y="' + (H - 36) + '" class="mv-tip" text-anchor="middle">一共 ' + a + ' 个，每行放 ' + b + ' 个（去掉一行=减' + b + '），可以放 ' + Math.floor(a / b) + ' 行 → ' + a + '÷' + b + '=' + Math.floor(a / b) + (a % b ? "……" + (a % b) : "") + '</text></svg>';
  }

  function svg(spec) {
    if (!spec || !spec.op) return "";
    switch (spec.op) {
      case "add": return addSVG(spec.a, spec.b);
      case "sub": return subSVG(spec.a, spec.b);
      case "mul": return mulSVG(spec.a, spec.b);
      case "div": return divSVG(spec.a, spec.b);
    }
    return "";
  }
  function show(el, spec) {
    if (!el) return;
    var html = '<div class="mviz-box">' + svg(spec) + '<div class="mviz-alt">' + altWays(spec) + '</div></div>';
    el.innerHTML = html;
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

  App.MathViz = { show: show, svg: svg };
})(window);
