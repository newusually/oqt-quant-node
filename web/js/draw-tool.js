/* ============================================================
 * draw-tool.js — K线图绘图工具（1:1 移植 latest web/src/js/service/chart/draw.js）
 *
 * 【latest 对应】
 *   OXCF.loadShapes / saveShapes → 本地 localStorage「合约|周期」记忆
 *   OXCF.drawShapes               → DrawTool.render（形状绘制）
 *   OXCF.pointerDown/Move/Up      → DrawTool.attach（拖拽绘制）
 *   OXCF.clearDraw / undoDraw     → DrawTool.clear / DrawTool.undo
 *   命中删除（右键点形状）          → DrawTool.hit
 *
 * 【工具集】趋势线 / 水平线 / 垂直线 / 射线 / 矩形 / 三角形 / 斐波那契
 *   涨红跌绿；水平线整宽 + 右侧价格标签；垂直线整高 + 顶部时间标签
 *
 * 【坐标约定】形状用【全局K线下标 i】+【价格 v】存储，与窗口无关（缩放/翻页不丢）
 * ============================================================ */
'use strict';
(function (global) {
  var TOOLS = [
    { k: 'cursor', t: '✋ 移动' },
    { k: 'trend', t: '📐 趋势线' },
    { k: 'hline', t: '➖ 水平线' },
    { k: 'vline', t: '❘ 垂直线' },
    { k: 'ray', t: '↗ 射线' },
    { k: 'rect', t: '▭ 矩形' },
    { k: 'triangle', t: '🔺 三角形' },
    { k: 'fib', t: '📐 斐波那契' }
  ];
  var COLORS = ['#f0a020', '#3d7bff', '#f0334b', '#0bbf7a', '#c678dd', '#5aa9a3', '#e06c9f'];
  var NAME = { trend: '趋势线', hline: '水平线', vline: '垂直线', ray: '射线', rect: '矩形', triangle: '三角形', fib: '斐波那契' };

  /* ---------- 形状绘制 ---------- */
  // map: {xOf(i), yOf(v), xRight, yTop, yBot}
  function render(ctx, shapes, map) {
    if (!shapes || !shapes.length) return;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (var k = 0; k < shapes.length; k++) {
      var s = shapes[k];
      if (!s) continue;
      var col = s.color || COLORS[0];
      var w = s.width || 1.6;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w;
      if (s.type === 'hline') {
        var y = map.yOf(s.p1);
        if (!isFinite(y)) continue;
        ctx.beginPath(); ctx.moveTo(map.xLeft, y); ctx.lineTo(map.xRight, y); ctx.stroke();
        ctx.fillStyle = col; ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'left';
        ctx.fillText((s.p1).toFixed(4), map.xRight + 3, y);
      } else if (s.type === 'vline') {
        var x = map.xOf(s.i1);
        if (!isFinite(x)) continue;
        ctx.beginPath(); ctx.moveTo(x, map.yTop); ctx.lineTo(x, map.yBot); ctx.stroke();
        ctx.fillStyle = col; ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'center';
        ctx.fillText(s.t1Label || '', x, map.yTop - 3);
      } else if (s.type === 'ray') {
        var x1 = map.xOf(s.i1), y1 = map.yOf(s.p1);
        var x2 = map.xOf(s.i2), y2 = map.yOf(s.p2);
        if (!isFinite(x1) || !isFinite(x2)) continue;
        var dx = x2 - x1, dy = y2 - y1;
        var kk = (dx !== 0) ? (map.xRight - x1) / dx : 9999;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + dx * kk, y1 + dy * kk); ctx.stroke();
      } else if (s.type === 'rect') {
        var rx1 = map.xOf(s.i1), ry1 = map.yOf(s.p1), rx2 = map.xOf(s.i2), ry2 = map.yOf(s.p2);
        if (!isFinite(rx1) || !isFinite(rx2)) continue;
        ctx.globalAlpha = 0.16; ctx.fillRect(rx1, ry1, rx2 - rx1, ry2 - ry1); ctx.globalAlpha = 1;
        ctx.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
      } else if (s.type === 'triangle') {
        var tx1 = map.xOf(s.i1), ty1 = map.yOf(s.p1), tx2 = map.xOf(s.i2), ty2 = map.yOf(s.p2);
        if (!isFinite(tx1) || !isFinite(tx2)) continue;
        ctx.beginPath();
        ctx.moveTo(tx1, ty1); ctx.lineTo(tx2, ty2); ctx.lineTo(tx1, ty2); ctx.closePath();
        ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      } else if (s.type === 'fib') {
        var fx1 = map.xOf(s.i1), fy1 = map.yOf(s.p1), fx2 = map.xOf(s.i2), fy2 = map.yOf(s.p2);
        if (!isFinite(fx1) || !isFinite(fx2)) continue;
        var hi = Math.max(fy1, fy2), lo2 = Math.min(fy1, fy2);
        var lv = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'left';
        for (var f = 0; f < lv.length; f++) {
          var pv = hi - (hi - lo2) * lv[f];
          var yy = map.yOf(pv);
          var key = (lv[f] === 0 || lv[f] === 0.5 || lv[f] === 1);
          ctx.strokeStyle = key ? col : 'rgba(139,148,173,.6)';
          ctx.lineWidth = key ? 1.4 : 1;
          ctx.setLineDash(key ? [] : [3, 3]);
          ctx.beginPath(); ctx.moveTo(Math.min(fx1, fx2), yy); ctx.lineTo(Math.max(fx1, fx2), yy); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = key ? col : 'rgba(139,148,173,.8)';
          ctx.fillText((lv[f] * 100).toFixed(1) + '%', Math.max(fx1, fx2) + 4, yy);
        }
        ctx.strokeStyle = col; ctx.lineWidth = w;
      } else {                                   // trend
        var lx1 = map.xOf(s.i1), ly1 = map.yOf(s.p1), lx2 = map.xOf(s.i2), ly2 = map.yOf(s.p2);
        if (!isFinite(lx1) || !isFinite(lx2)) continue;
        ctx.beginPath(); ctx.moveTo(lx1, ly1); ctx.lineTo(lx2, ly2); ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(lx1, ly1, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(lx2, ly2, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ---------- 命中检测（右键删图形） ---------- */
  function hit(shapes, map, mx, my) {
    if (!shapes || !shapes.length) return -1;
    var best = -1, bd = 12;
    for (var k = shapes.length - 1; k >= 0; k--) {
      var s = shapes[k]; if (!s) continue;
      if (s.type === 'hline') {
        var d = Math.abs(map.yOf(s.p1) - my);
        if (d < bd) { bd = d; best = k; }
      } else if (s.type === 'vline') {
        var dv = Math.abs(map.xOf(s.i1) - mx);
        if (dv < bd) { bd = dv; best = k; }
      } else {
        var x1 = map.xOf(s.i1), y1 = map.yOf(s.p1), x2 = map.xOf(s.i2), y2 = map.yOf(s.p2);
        if (!isFinite(x1)) continue;
        var d2 = distSeg(mx, my, x1, y1, x2, y2);
        if (d2 < bd) { bd = d2; best = k; }
      }
    }
    return best;
  }
  function distSeg(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var L = dx * dx + dy * dy;
    if (L === 0) return Math.hypot(px - x1, py - y1);
    var t = ((px - x1) * dx + (py - y1) * dy) / L;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  /* ---------- 交互绑定 ---------- */
  // opt: {key(存储键), map(), getShapes(), setShapes(list), onChange(), isActive()}
  function attach(cv, opt) {
    if (!cv || cv.__drawBound) return;
    cv.__drawBound = true;
    var draft = null, dragging = false;

    function mapNow() { return opt.map(); }
    function pt(e) {
      var r = cv.getBoundingClientRect(), m = mapNow();
      return { mx: e.clientX - r.left, my: e.clientY - r.top };
    }
    function toShape(p) {
      var m = mapNow();
      var i = m.iOf(p.mx), v = m.vOf(p.my);
      return { i: i, p: v, i2: i, p2: v };
    }
    cv.addEventListener('mousedown', function (e) {
      if (e.button === 2) {                       // 右键 = 删图形
        var p = pt(e);
        var idx = hit(opt.getShapes(), mapNow(), p.mx, p.my);
        if (idx >= 0) {
          var sh = opt.getShapes().slice();
          sh.splice(idx, 1);
          opt.setShapes(sh); save(opt); opt.onChange();
        }
        return;
      }
      if (e.button !== 0) return;
      var tool = opt.tool();
      if (!tool || tool === 'cursor') { cv.__drawToolActive = false; return; }
      cv.__drawToolActive = true;               // 通知主图: 绘图模式下不要平移
      e.preventDefault(); e.stopPropagation();
      cv._dragging = true;                        // 阻断主图拖动平移
      dragging = true;
      draft = toShape(pt(e));
      draft.type = tool; draft.color = opt.color(); draft.width = opt.width ? opt.width() : 1.6;
      if (tool === 'hline') { draft.p2 = draft.p1; draft.i2 = draft.i1; }
    });
    global.addEventListener('mousemove', function (e) {
      if (!dragging || !draft) return;
      var p = pt(e), m = mapNow();
      if (draft.type === 'hline') { draft.p2 = m.vOf(p.my); draft.i2 = draft.i1; }
      else { draft.i2 = m.iOf(p.mx); draft.p2 = m.vOf(p.my); }
      opt.onChange(draft);
    });
    global.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false; cv._dragging = false;
      if (!draft) return;
      var sh = opt.getShapes().slice();
      // 单击即完成(水平线/垂直线)；其余要求两点不同
      if (draft.type === 'hline' || draft.type === 'vline' || draft.i2 !== draft.i1 || draft.p2 !== draft.p1) {
        sh.push(draft);
        opt.setShapes(sh); save(opt);
      }
      draft = null;
      opt.onChange();
    });
    cv.addEventListener('contextmenu', function (e) {
      if (opt.tool() && opt.tool() !== 'cursor') e.preventDefault();
    });
    cv.addEventListener('dblclick', function (e) {
      var tool = opt.tool();
      if (tool && tool !== 'cursor') { e.preventDefault(); e.stopPropagation(); }
    });
  }

  function save(opt) {
    try { localStorage.setItem('oqt.draw.' + opt.key(), JSON.stringify(opt.getShapes())); } catch (e) { }
  }
  function load(opt) {
    try {
      var raw = localStorage.getItem('oqt.draw.' + opt.key());
      if (raw) { var a = JSON.parse(raw); if (a && a.length) opt.setShapes(a); }
    } catch (e) { }
  }

  global.DrawTool = {
    TOOLS: TOOLS, COLORS: COLORS, NAME: NAME,
    render: render, hit: hit, attach: attach, load: load, save: save,
    undo: function (opt) { var s = opt.getShapes().slice(); s.pop(); opt.setShapes(s); save(opt); opt.onChange(); },
    clear: function (opt) { opt.setShapes([]); save(opt); opt.onChange(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
