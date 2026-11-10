/* ============================================================================
 * web/js/qa-marks.js —— ★K 线标识：只画「交叉角 ≥10°」红色数学角弧 + 实际度数
 * ----------------------------------------------------------------------------
 * 用户 2026-11-06 第二轮要求（彻底推翻上一版「5~10° / Q1 面积」口径）：
 *   「只要10度以上的 每5个度数为一个单位 …… 5m 的时候 仅仅只是度数哦 面积不要」
 *
 * 新门控（单一判定，面积维度完全移除）：
 *   交叉角 ≥ ANG_MIN(10°) → 画【红色数学角】：水平射线 + 张开射线 + 圆弧 + 度数文字
 *   交叉角 < 10° → 不画任何东西。
 *   面积 / Q1 维度已移除，不再画斜线阴影带、不再写 Q1。K 线只标角度（5m 自然也是「仅仅度数」）。
 *
 * 挂在 ind-engine.js 的 drawKline 主图，天然覆盖：
 *   主力合约 K 线（1m/5m/15m/1h × 287 合约）与美股指数 K 线（1m/5m/15m/1h/1d × NQ/ES/YM）。
 * 周期由 bars 的时间间隔自动判定，不需要读 DOM 或全局状态，换合约/换分时自动生效。
 *
 * 角度门限：内联常量 ANG_MIN(10°)；若页面另行加载 QA_BOUNDS.angleMin 则覆盖（当前未加载，无需额外脚本）。
 * 判定口径：唯一交叉对 MA5/MA20、纯因果滚动 MA、
 * 最近已确认转折点的段角度、交叉角 = |θMA5 − θMA20|。
 * ========================================================================== */
(function (global) {
  'use strict';

  var WARM = 120, RAD = 180 / Math.PI;
  var ANG_MIN = 10;               /* 只标记 ≥10° */
  var CFG = {
    angleColor: '#ff253f',      /* 红色：数学角 */
    angleText: '#ff5566',
    arcR: 17,
    minTopGap: 48,          /* 角弧离主图顶部的最小距离，避开顶部买卖点标签 */
    font: 11,
    minGapAngle: 76
  };
  var cache = new WeakMap();
  var stats = {};
  var perCanvas = {};
  var canvasSeq = 0;
  var lastJobs = { angle: [] };

  function resetStats() {
    stats = {
      grain: '', angleMin: ANG_MIN,
      eventsTotal: 0, visibleEvents: 0,
      angleEvents: 0, angleLabels: 0, angleArcs: 0,
      drawn: false, error: ''
    };
  }
  resetStats();

  /* 周期由 K 线时间间隔直接推断（毫秒），与回测周期一一对应 */
  function grainOf(bars) {
    if (!bars || bars.length < 2) return '1h';
    var d = Math.abs(bars[1].t - bars[0].t);
    if (d <= 60000) return '1m';
    if (d <= 300000) return '5m';
    if (d <= 900000) return '15m';
    if (d <= 3600000) return '1h';
    return '1d';
  }
  function angleMinOf() {
    var B = global.QA_BOUNDS;
    return (B && isFinite(B.angleMin)) ? B.angleMin : ANG_MIN;
  }

  /* 纯因果段角度：最近一个已确认转折点(j ≤ i−1) → i，与 bt/angle_strategy.js 逐行一致 */
  function causalAngles(ma, n, period) {
    var ang = new Float64Array(n);
    var pivot = Math.min(period - 1, n - 1), prevSlope = 0;
    for (var i = pivot + 1; i < n; i++) {
      var d = ma[i] - ma[i - 1];
      var s = d > 0 ? 1 : (d < 0 ? -1 : 0);
      if ((prevSlope > 0 && s < 0) || (prevSlope < 0 && s > 0)) pivot = i - 1;
      if (s !== 0) prevSlope = s;
      var base = Math.abs(ma[pivot]) > 1e-12 ? Math.abs(ma[pivot]) : 1;
      var span = Math.max(1, i - pivot);
      ang[i] = Math.atan((ma[i] - ma[pivot]) / base / span * 100) * RAD;
    }
    return ang;
  }

  /* 计算交叉事件的交叉角（面积维度已移除，不再算面积） */
  function eventsOf(bars) {
    var hit = cache.get(bars);
    if (hit) return hit;
    var n = bars.length, out = [];
    var empty = { events: out, ma5: null, ma20: null };
    if (!global.ChanLun || typeof global.ChanLun.ma !== 'function' || n < WARM + 5) {
      cache.set(bars, empty); return empty;
    }
    var ma5 = global.ChanLun.ma(bars, 5), ma20 = global.ChanLun.ma(bars, 20);
    var a5 = causalAngles(ma5, n, 5), a20 = causalAngles(ma20, n, 20);
    var prevD = ma5[WARM] - ma20[WARM];
    for (var j = WARM + 1; j < n - 1; j++) {
      var d = ma5[j] - ma20[j], dir = 0;
      if (prevD <= 0 && d > 0) dir = 1;
      else if (prevD >= 0 && d < 0) dir = -1;
      prevD = d;
      if (!dir) continue;
      out.push({
        i: j, dir: dir,
        cross: Math.abs(a5[j] - a20[j]),
        mid: (ma5[j] + ma20[j]) / 2
      });
    }
    var pack = { events: out, ma5: ma5, ma20: ma20 };
    cache.set(bars, pack);
    return pack;
  }

  function isAngle(ev, min) { return ev.cross >= min; }

  /* 给验收脚本用：逐事件返回判定，核对「只有满足的才画」 */
  function testEvents(bars, grain) {
    var g = grain || grainOf(bars), min = angleMinOf();
    return {
      grain: g, angleMin: min,
      events: eventsOf(bars).events.map(function (e) {
        return { i: e.i, cross: e.cross, isAngle: isAngle(e, min) };
      })
    };
  }

  /* 红色数学角：水平射线 + 张开射线 + 圆弧（跟数学课本一样） */
  function angleArc(ctx, px, py, deg) {
    var a = deg * Math.PI / 180, r = CFG.arcR;
    ctx.strokeStyle = CFG.angleColor;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.lineTo(px, py);
    ctx.lineTo(px + r * Math.cos(-a), py + r * Math.sin(-a));
    ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.72, -a, 0);
    ctx.stroke();
  }

  function far(list, px, gap) {
    for (var i = 0; i < list.length; i++) if (Math.abs(list[i] - px) < gap) return false;
    return true;
  }

  function draw(ctx, env) {
    resetStats();
    if (!ctx || !env || !env.bars || env.bars.length < WARM + 5) return;
    var bars = env.bars, grain = grainOf(bars);
    var min = angleMinOf();
    stats.grain = grain; stats.angleMin = min;
    var pack = eventsOf(bars);
    var evs = pack.events;
    stats.eventsTotal = evs.length;
    var sI = env.startI || 0, eI = (env.endI == null ? bars.length : env.endI);
    var clip = env.clip || { l: 0, t: 0, w: 1e9, h: 1e9 };
    var usedAngle = [];
    var angleJobs = [];
    lastJobs = { angle: [], grain: grain, angleMin: min };

    try {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clip.l, clip.t, clip.w, clip.h);
      ctx.clip();

      /* 统计 + 收集每个 ≥10° 事件的角弧位置（面积维度已移除，无 Q1 窗口） */
      for (var k = 0; k < evs.length; k++) {
        var ev = evs[k];
        if (ev.i < sI || ev.i >= eI) continue;
        stats.visibleEvents++;
        var okA = isAngle(ev, min);
        if (okA) {
          stats.angleEvents++;
          var px = env.x(ev.i);
          if (isFinite(px)) angleJobs.push({ px: px, i: ev.i, deg: ev.cross, mid: ev.mid });
          lastJobs.angle.push({ i: ev.i, cross: ev.cross, isAngle: okA });
        }
      }

      /* 每个 ≥10° 事件都画红色数学角弧（严格「是才画、不是就不画」）；
         只有度数文字做防重叠，避免信号密集处文字糊成一片。 */
      for (var a = 0; a < angleJobs.length; a++) {
        var ja = angleJobs[a];
        var py = env.y(ja.mid);
        if (!isFinite(py)) continue;
        py = Math.max(clip.t + CFG.minTopGap, Math.min(clip.t + clip.h - CFG.arcR - 8, py));
        ctx.fillStyle = 'rgba(8,15,28,.76)';
        ctx.beginPath(); ctx.arc(ja.px, py, CFG.arcR + 4, 0, Math.PI * 2); ctx.fill();
        angleArc(ctx, ja.px, py, ja.deg);
        stats.angleArcs++;
        if (!far(usedAngle, ja.px, CFG.minGapAngle)) continue;
        usedAngle.push(ja.px);
        var txt = ja.deg.toFixed(1) + '°';
        var tw = ctx.measureText(txt).width + 12;
        var tx = ja.px + CFG.arcR + 3, ty = py - CFG.arcR * 0.45;
        ctx.fillStyle = 'rgba(8,15,28,.92)';
        ctx.fillRect(tx - 2, ty - 10, tw, 20);
        ctx.strokeStyle = CFG.angleColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(tx - 2, ty - 10, tw, 20);
        ctx.fillStyle = CFG.angleText;
        ctx.textAlign = 'left';
        ctx.fillText(txt, tx + 4, ty);
        ctx.textAlign = 'center';
        stats.angleLabels++;
      }
      ctx.restore();
      stats.drawn = true;
    } catch (e) {
      stats.error = String((e && e.message) || e);
      try { ctx.restore(); } catch (_) { }
    }
    try {
      var cvs = ctx && ctx.canvas;
      var cid = (cvs && cvs.id) || '';
      if (!cid && cvs) { cid = 'qac_canvas_' + (++canvasSeq); cvs.id = cid; }
      var snap = {};
      for (var kk in stats) snap[kk] = stats[kk];
      snap.canvasId = cid;
      snap.jobsGrain = lastJobs.grain;
      snap.jobsCount = { angle: lastJobs.angle.length };
      snap.jobsOk = lastJobs.angle.every(function (x) {
        return x.isAngle === true && x.cross >= angleMinOf();
      });
      perCanvas[cid] = snap;
    } catch (_) { }
  }

  global.QAMarks = {
    draw: draw,
    testEvents: testEvents,
    stats: function () { return stats; },
    jobs: function () { return lastJobs; },
    all: function () { return perCanvas; },
    cfg: CFG
  };
})(window);
