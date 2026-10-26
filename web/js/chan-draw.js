/* ============================================================
 * chan-draw.js — 缠论线绘制（Canvas 版，1:1 移植 latest 的 chan.js）
 *
 * 【与 latest 的对应】
 *  latest: web/src/js/service/chart/chan.js  (LWC 版)
 *    · OXCF.chanLnPivots   → ChanCore.pivots
 *    · OXCF.chanExtend     → ChanCore.extend
 *    · OXCF.chanSplitExt   → ChanCore.splitExt
 *    · OXCF.chanDirLines   → 本文件 drawChanLines（Canvas 版）
 *    · buildChanLn         → 本文件 drawChan（取窗口内点 → 抽转折点 → 外推 → 分色连线）
 *
 * 【画法规格（与 latest 一致）】
 *  ① 两条线画在【K线上方同一坐标系】（不是独立副图）
 *     线1 = 慢EMA + DIF (= 快EMA)，线2 = 慢EMA + DEA  → 单位是价格，贴着K线柱子
 *  ② 每条线先按【缠论分型】抽摆动转折点（顶/底交替），再连成【直线段】
 *     —— 段内两点一线，绝不弯曲；这正是"连接最高点最低点"的画法
 *  ③ 上涨段红 #f6465d / 下跌段绿 #0ecb81（中国惯例 涨红跌绿）
 *  ④ 左右两端按端段斜率外推【虚线】延长到K线首/末根（辅助延长线）
 *  ⑤ 买卖点：笔夹角 < 60°（latest g_csAngleMax）才发
 *     夹角朝上(绿笔接红笔)=买(火箭) / 夹角朝下(红笔接绿笔)=卖(绿叶)
 * ============================================================ */
'use strict';
(function (global) {
  var CC = global.ChanCore;

  /* 画一条折线（可虚线），points=[{i,v}]，i=全局 bars 下标 */
  function strokePts(ctx, pts, x, y, color, width, dash) {
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (var k = 0; k < pts.length; k++) {
      var px = x(pts[k].i), py = y(pts[k].v);
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* 画一条线：抽转折点 → 外推 → 分色连线（复刻 OXCF.chanDirLines + chanExtend） */
  function drawChanLine(ctx, o) {
    // o: {vals(全量数组), i0, i1(全局下标范围), x(全局下标→像素), y(价→像素), vmin, vmax, width}
    var vals = o.vals;
    if (!vals || !vals.length) return null;
    // ① 只取窗口内的有效点（latest 铁律：叠加系列时间范围不得超过主图K线范围）
    var tv = [], vv = [], i;
    for (i = o.i0; i <= o.i1; i++) {
      var v = vals[i];
      if ((v === null || v === undefined) || !isFinite(v)) continue;
      tv.push(i); vv.push(v);
    }
    if (vv.length < CC.PIV_WIN * 2 + 1) return null;
    // ② 抽摆动转折点（顶/底交替），off=窗口起点 → 返回全局下标
    var pv = CC.pivots(tv, vv, o.i0);
    if (pv.length < 2) return null;
    // ③ 两端外推（辅助延长线），夹在 [vmin, vmax]
    var ext = CC.extend(pv, o.i0, o.i1, o.vmin, o.vmax);
    var sp = CC.splitExt(ext);
    // ④ 分色连线：上涨红 / 下跌绿
    var runs = CC.dirRuns(sp.main);
    for (i = 0; i < runs.length; i++) {
      strokePts(ctx, runs[i].pts, o.x, o.y, runs[i].up ? CC.COL_UP : CC.COL_DN, o.width, false);
    }
    if (sp.extL) strokePts(ctx, sp.extL, o.x, o.y, CC.COL_UP, o.width, true);
    if (sp.extR) strokePts(ctx, sp.extR, o.x, o.y, CC.COL_UP, o.width, true);
    return { pivots: pv, runs: runs, ext: sp };
  }

  /* 主入口：画两条缠论线（快/慢）+ 返回转折点信息 */
  // o: {closes(全量收盘), i0, i1(全局下标范围), x(全局→像素), y(价→像素), vmin, vmax, fast, slow, signal}
  function drawChan(ctx, o) {
    var closes = o.closes;
    if (!closes || closes.length < 30) return null;
    var L = CC.clLines(closes, o.fast || 12, o.slow || 26, o.signal || 9);
    if (!L.f || !L.f.length) return null;
    var lo = o.vmin, hi = o.vmax;
    var r1 = drawChanLine(ctx, {
      vals: L.f, i0: o.i0, i1: o.i1, x: o.x, y: o.y, vmin: lo, vmax: hi, width: CC.WIDTH_FAST
    });
    var r2 = drawChanLine(ctx, {
      vals: L.s, i0: o.i0, i1: o.i1, x: o.x, y: o.y, vmin: lo, vmax: hi, width: CC.WIDTH_SLOW
    });
    return { lines: L, fast: r1, slow: r2 };
  }

  /* 买卖信号（60° 夹角）—— 从摆动顶/底序列算笔，再算夹角 */
  // tops/bots: [{i, p, top}]（全局 bars 下标）
  // lines: {f, s} 两条线（用于找交叉点）
  // 返回 {bis, sigs}
  function calcSignals(tops, bots, lines, opt) {
    var bis = CC.toBis(tops || [], bots || []);
    if (!bis || bis.length < 5) return { bis: bis, sigs: [] };
    // 缠论线交叉点（金叉/死叉）—— 信号必须落在交叉处
    var crossIdx = [];
    if (lines && lines.f && lines.s) {
      var cs = CC.crossings(lines.f, lines.s);
      cs.forEach(function (c) { crossIdx.push(c.i); });
    }
    var sigs = CC.signalsAtCrossings(bis, crossIdx, opt || {});
    return { bis: bis, sigs: sigs };
  }

  global.ChanDraw = {
    drawChan: drawChan,
    drawChanLine: drawChanLine,
    calcSignals: calcSignals,
    strokePts: strokePts
  };
})(typeof window !== 'undefined' ? window : globalThis);
