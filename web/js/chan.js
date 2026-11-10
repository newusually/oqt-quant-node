/* ============================================================================
 * web/js/chan.js —— ★共享缠论组件（MA5 版，2026-11-04 重构）
 * ----------------------------------------------------------------------------
 * 用户要求：把「缠论」统一为 MA5（5 周期均线）。即：
 *   ★缠论线      = 连续 MA5 折线（相邻点直连，按斜率着色 涨红/跌绿）
 *   ★能量公式段源 = MA5 单调伸展段（相邻转折点之间），段方向 = MA5 斜率符号
 *
 * 本组件对外提供：
 *   Chan.ma5(bars, period)   —— 返回 MA5 序列（按 bars 引用缓存）
 *   Chan.detect(bars, opt)   —— MA5 转折点（枢轴）
 *   Chan.segments(bars, opt) —— MA5 段数组（能量公式 c_seg/m_seg/E_seg 的输入）
 * 输出结构与旧缠论组件兼容（segs:{i0,i1,dir,fromType,toType,px0,px1,brk,open,bars,amp}），
 * 因此能量引擎 / 背驰 / 买卖信号无需改动即自动切换为 MA5 段。
 *
 * ★热插拔：maPeriod / minBars / minAmp 可在运行时改（setParam）+ localStorage 持久化。
 * 暴露：global.Chan = { ma5, detect, segments, getParams, setParam, resetParams,
 *                       onChange, offChange, DEFAULTS }
 * ========================================================================== */
(function (global) {
  'use strict';

  var DEFAULTS = { maPeriod: 5, minBars: 2, minAmp: 0.02 };
  var LS_KEY = 'oqt.chan.params';
  var params = null;

  function numv(v, d, lo, hi) { var n = parseFloat(v); if (!isFinite(n)) n = d; return Math.min(hi, Math.max(lo, n)); }
  function intv(v, d, lo, hi) { var n = parseInt(v, 10); if (!isFinite(n)) n = d; return Math.min(hi, Math.max(lo, n)); }

  function defaults() {
    return { maPeriod: DEFAULTS.maPeriod, minBars: DEFAULTS.minBars, minAmp: DEFAULTS.minAmp };
  }

  /* 读 localStorage（浏览器缺失时静默降级为默认值） */
  function getParams() {
    if (params) return params;
    var p = defaults();
    try {
      var raw = global.localStorage && global.localStorage.getItem(LS_KEY);
      if (raw) {
        var j = JSON.parse(raw);
        p.maPeriod = intv(j.maPeriod, p.maPeriod, 2, 200);
        p.minBars = intv(j.minBars, p.minBars, 1, 2000);
        p.minAmp = numv(j.minAmp, p.minAmp, 0.001, 90);
      }
    } catch (e) { }
    params = p;
    return params;
  }

  /* 热插拔入口：改任一参数，立即生效（并广播 onChange） */
  function setParam(patch, opts) {
    var p = getParams();
    if (!patch) return p;
    ['maPeriod', 'minBars', 'minAmp'].forEach(function (k) {
      if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') p[k] = patch[k];
    });
    p.maPeriod = intv(p.maPeriod, DEFAULTS.maPeriod, 2, 200);
    p.minBars = intv(p.minBars, DEFAULTS.minBars, 1, 2000);
    p.minAmp = numv(p.minAmp, DEFAULTS.minAmp, 0.001, 90);
    params = p;
    try { if (global.localStorage) global.localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) { }
    if (!(opts && opts.silent)) fire();
    return p;
  }

  function resetParams() { params = defaults(); try { if (global.localStorage) global.localStorage.removeItem(LS_KEY); } catch (e) { } fire(); return params; }

  var listeners = [];
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function offChange(fn) { listeners = listeners.filter(function (x) { return x !== fn; }); }
  function fire() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](getParams()); } catch (e) { } } }

  /* ================================================================ MA5 序列（带缓存）
   *   ma5[i] = mean(close[i-period+1 .. i])；i<period-1 时用已知部分均值（保证从 0 起连续）。
   */
  function ma5(bars, period) {
    period = period || (getParams().maPeriod | 0) || 5;
    if (!bars || !bars.length) return [];
    if (bars.__ma5 && bars.__ma5.period === period && bars.__ma5.n === bars.length) return bars.__ma5.arr;
    var n = bars.length, out = new Array(n), sum = 0;
    for (var i = 0; i < n; i++) {
      var c = +bars[i].c;
      if (!isFinite(c)) c = (i ? out[i - 1] : 0);
      sum += c;
      if (i >= period) sum -= +bars[i - period].c;
      out[i] = (i >= period - 1) ? sum / period : sum / (i + 1);
    }
    try { bars.__ma5 = { period: period, n: n, arr: out }; } catch (e) { }
    return out;
  }

  /* ================================================================ detect(bars, opt)
   *   返回 MA5 转折点（枢轴 {i,type:'B'|'T',px,brk}）+ 开放段 openLeg。
   *   type: 局部极大='T'(顶) / 局部极小='B'(底)。brk=段过短(小于 minBars)标记过渡段。
   */
  function detect(bars, opt) {
    opt = opt || {};
    var cfg = Object.assign(getParams(), opt || {});
    var period = Math.max(2, cfg.maPeriod | 0 || 5);
    var minBars = Math.max(1, cfg.minBars | 0 || 1);
    var minAmp = Math.max(0.001, +cfg.minAmp || 0.02);
    var ma = ma5(bars, period);
    var n = (bars && bars.length) ? bars.length : 0;
    if (n < period + 4) return { pts: [], openLeg: null, cfg: cfg, ma: ma };

    function slope(i) { var d = ma[i + 1] - ma[i]; return d > 0 ? 1 : (d < 0 ? -1 : 0); }

    /* ① 找 MA5 转折点（斜率变号处） */
    var pivots = [];
    for (var i = 1; i < n - 1; i++) {
      if (ma[i] == null || ma[i - 1] == null || ma[i + 1] == null) continue;
      var dP = slope(i - 1), dN = slope(i);
      if (dP >= 0 && dN <= 0) pivots.push({ i: i, type: 'T', px: ma[i] });
      else if (dP <= 0 && dN >= 0) pivots.push({ i: i, type: 'B', px: ma[i] });
    }

    /* ② 段评估：相邻转折点连段；段幅(%)=|ΔMA5/MA5|，过小(小于 minAmp)或段长小于 minBars 标记 brk 过渡 */
    var pts = [];
    if (pivots.length) {
      pts.push({ i: pivots[0].i, type: pivots[0].type, px: pivots[0].px, brk: false });
      for (var k = 1; k < pivots.length; k++) {
        var len = pivots[k].i - pivots[k - 1].i;
        var amp = Math.abs(pivots[k].px / pivots[k - 1].px - 1) * 100;
        pts.push({ i: pivots[k].i, type: pivots[k].type, px: pivots[k].px, brk: (len < minBars || amp < minAmp) });
      }
    }

    /* ③ 开放段（最后转折点 → 最新一根 MA5），延伸到最新，能量覆盖到末端无空白 */
    var openLeg = null;
    if (pts.length && (n - 1) > pts[pts.length - 1].i) {
      var last = pts[pts.length - 1];
      var lastMa = ma[n - 1];
      var dirN = lastMa > last.px ? 1 : (lastMa < last.px ? -1 : 0);
      if (dirN) openLeg = {
        fromI: last.i, fromPx: last.px, fromType: last.type,
        toI: n - 1, toPx: lastMa, toType: last.type === 'B' ? 'T' : 'B',
        bars: (n - 1) - last.i,
        amp: +((lastMa / last.px - 1) * 100).toFixed(2)
      };
    }
    return { pts: pts, openLeg: openLeg, cfg: cfg, ma: ma };
  }

  /* ================================================================ segments(bars, opt)
   *   把转折点转成「段」数组（能量公式的输入）。段方向 = MA5 斜率符号。
   *   seg = { i0, i1, dir, fromType, toType, px0, px1, brk, open, bars, amp }
   */
  function segments(bars, opt) {
    var det = detect(bars, opt);
    var pts = det.pts || [];
    var out = [];
    for (var k = 1; k < pts.length; k++) {
      var a = pts[k - 1], b = pts[k];
      if (b.i <= a.i) continue;
      var dir = (b.px > a.px) ? 1 : (b.px < a.px ? -1 : 0);
      if (!dir) continue;
      out.push({
        i0: a.i, i1: b.i, dir: dir,
        fromType: a.type, toType: b.type,
        px0: a.px, px1: b.px,
        brk: !!b.brk, open: false,
        bars: b.i - a.i,
        amp: +((b.px / a.px - 1) * 100).toFixed(2)
      });
    }
    /* 开放段（进行中，未确认）→ 末段，延伸到最新一根 */
    if (det.openLeg && bars && bars.length) {
      var ol = det.openLeg, last = pts[pts.length - 1];
      var dir2 = (ol.toPx > last.px) ? 1 : (ol.toPx < last.px ? -1 : 0);
      if (dir2) {
        out.push({
          i0: last.i, i1: bars.length - 1, dir: dir2,
          fromType: last.type, toType: ol.toType,
          px0: last.px, px1: ol.toPx,
          brk: true, open: true,
          bars: (bars.length - 1) - last.i,
          amp: +((ol.toPx / last.px - 1) * 100).toFixed(2)
        });
      }
    }
    return { segs: out, pts: pts, openLeg: det.openLeg, cfg: det.cfg, ma: det.ma };
  }

  global.Chan = {
    ma5: ma5,
    detect: detect,
    segments: segments,
    getParams: getParams,
    setParam: setParam,
    resetParams: resetParams,
    onChange: onChange,
    offChange: offChange,
    DEFAULTS: DEFAULTS
  };
})(typeof window !== 'undefined' ? window : globalThis);
