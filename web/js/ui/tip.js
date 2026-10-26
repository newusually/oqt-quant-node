/* ============================================================================
 * web/js/ui/tip.js —— ★共享悬浮窗组件库（2026-10-25 第七轮）
 * ----------------------------------------------------------------------------
 * 用户需求：
 *   "要求修改悬浮窗要求有数据才行 最好悬浮窗都给我做组件 这样可以共享组件
 *    有悬浮窗K线组件 有悬浮窗曲线信息组件这样的 这样重复利用率高"
 *
 * ★为什么做这个组件库（踩坑记录）：
 *   原先每个面板各写一份 tip 函数，直接把自定义字段挂在数据点里
 *   （{label, value, b: {...}} / {label, value, x: {...}}），
 *   但 ECharts 的 formatter 回调拿到的只是 {a, b}（两条曲线的点对象），
 *   自定义字段取不到 → 面板里出现 undefined / NaN。
 *   → 统一约定：数据点的自定义数据必须放在【extra】字段，
 *     组件层负责把它透传给 tip 回调，业务层只管写 tip 函数。
 *
 * ★组件：
 *   Tip.curve(el, cfg)  —— 带悬浮窗的【双轴曲线】组件
 *   Tip.kline(el, cfg)  —— 带悬浮窗的【K线】组件
 *   Tip.html / Tip.row  —— 统一的悬浮窗 HTML 模板（自动过滤无值字段）
 *   Tip.pct / Tip.num / Tip.time / Tip.date —— 统一数值格式化
 *
 * ★"要求有数据才行"的实现：
 *   Tip.row(k, v) 在 v == null 时返回空串 → 该行自动消失
 *   Tip.html 会剔除所有空行；若一行都不剩则显示"该时点无数据"
 * ========================================================================== */
(function (global) {
  'use strict';
  var EKit = global.EKit;

  /* ---------------- 格式化 ---------------- */
  function esc(s) {
    return String((s === null || s === undefined) ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* 百分比：null/undefined/NaN → ''（调用方用 Tip.row 自动隐藏） */
  function pct(v, dg) {
    if ((v === null || v === undefined) || isNaN(v)) return '';
    var n = (dg === null || dg === undefined) ? 3 : dg;
    return (v > 0 ? '+' : '') + v.toFixed(n) + '%';
  }
  /* 数值：无值 → ''
   *   不传 dg 时按量级自适应小数位（低价币如 ENJ 0.0321 用 2 位会显示成 0.03 → 无法区分） */
  function num(v, dg) {
    if ((v === null || v === undefined) || isNaN(v)) return '';
    if ((dg !== null && dg !== undefined)) return (+v).toFixed(dg);
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1000) return (+v).toFixed(2);
    if (a >= 1) return (+v).toFixed(3);
    if (a >= 0.01) return (+v).toFixed(5);
    if (a >= 0.0001) return (+v).toFixed(7);
    return (+v).toPrecision(4);
  }
  /* 大数缩写 */
  function short(v) {
    if ((v === null || v === undefined) || isNaN(v)) return '';
    var a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(1) + '万';
    return (+v).toFixed(0);
  }
  function time(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function date(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function datetime(ts) {
    if (!ts) return '';
    return date(ts) + ' ' + time(ts);
  }

  /* ---------------- 悬浮窗 HTML 模板 ---------------- */
  var CLS = { up: '#f0334b', dn: '#0bbf7a', flat: '#e6ebf5', dim: '#8b94ad', warn: '#f0a020' };

  /**
   * 一行：值为空（null/undefined/''/NaN）时返回 '' → 该行不显示
   * @param {string} k  标签
   * @param {string|number} v 值（已格式化）
   * @param {string} cls 'up'|'dn'|'dim'|'warn' 或完整颜色
   */
  function row(k, v, cls) {
    if ((v === null || v === undefined) || v === '') return '';
    var c = CLS[cls] ? cls : (cls || 'flat');
    return '<div class="tt-r"><span>' + esc(k) + '</span><b class="' + c + '">' + esc(v) + '</b></div>';
  }
  function title(t) {
    if (!t) return '';
    return '<div class="tt-t">' + esc(t) + '</div>';
  }
  /**
   * 组装悬浮窗 HTML
   * @param {string} t  标题（时间等）
   * @param {Array<string>} rows  由 row() 生成的行（空串自动剔除）
   * @param {string} empty 无数据时的提示
   */
  function html(t, rows, empty) {
    var body = (rows || []).filter(function (x) { return x; }).join('');
    var head = title(t);
    if (!body) return head + '<div class="tt-empty">该时点无数据</div>';
    return head + body;
  }

  /* ---------------- 组件1：带悬浮窗的双轴曲线 ---------------- */
  /**
   * @param {HTMLElement|string} el
   * @param {object} cfg
   *   a: [{label, value, extra}]  左轴序列
   *   b: [{label, value, extra}]  右轴序列（可省略）
   *   aName/bName/n1/n2: 轴与系列名
   *   xFmt/yFmt/colorA/colorB/zoom
   *   tip: function(ctx) → HTML 字符串
   *        ctx = { a, b, extra, index, label }
   *        extra 取自 a[i].extra || b[i].extra
   */
  function curve(el, cfg) {
    cfg = cfg || {};
    if (!EKit) return null;
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return null;

    var A = (cfg.a || []).map(function (x) {
      return { label: x.label, value: x.value, extra: x.extra };
    });
    var B = (cfg.b || []).map(function (x) {
      return { label: x.label, value: x.value, extra: x.extra };
    });

    return EKit.mount(el, 'dualTip', { a: A, b: B, aName: cfg.aName, bName: cfg.bName }, {
      n1: cfg.n1, n2: cfg.n2,
      xFmt: cfg.xFmt || '{value}%', yFmt: cfg.yFmt || '{value}',
      colorA: cfg.colorA, colorB: cfg.colorB,
      zoom: cfg.zoom, zoomStart: cfg.zoomStart,
      tip: function (ctx) {
        var tipFn = cfg.tip;
        if (!tipFn) return html(ctx.label, []);
        // ★extra 统一从 a/b 的 extra 字段取（这是之前 undefined/NaN 的根因修复点）
        var extra = (ctx.a && ctx.a.extra) || (ctx.b && ctx.b.extra) || null;
        var out = tipFn({ a: ctx.a, b: ctx.b, extra: extra, index: ctx.index, label: ctx.label });
        return (out === null || out === undefined) ? html(ctx.label, []) : out;
      }
    });
  }

  /* ---------------- 组件2：带悬浮窗的 K 线 ---------------- */
  /**
   * @param {object} cfg
   *   candles: [{t, o, h, l, c, v, name, extra}]
   *   markPoint: 买入点等标记
   *   tip: function(ctx) → HTML
   *        ctx = { item, extra, index, label }
   */
  function kline(el, cfg) {
    cfg = cfg || {};
    if (!EKit) return null;
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return null;

    var list = (cfg.candles || []).map(function (x) {
      return {
        name: x.name || time(x.t), o: x.o, h: x.h, l: x.l, c: x.c, v: x.v,
        t: x.t, extra: x.extra
      };
    });

    return EKit.mount(el, 'candle', list, {
      markPoint: cfg.markPoint,
      kName: cfg.kName, volName: cfg.volName,
      kH: cfg.kH, zoomRoots: cfg.zoomRoots, noZoom: cfg.noZoom,
      tip: function (ctx) {
        var tipFn = cfg.tip;
        if (!tipFn) return html(ctx.label, []);
        var out = tipFn({ item: ctx.item, extra: ctx.extra, index: ctx.index, label: ctx.label });
        return (out === null || out === undefined) ? html(ctx.label, []) : out;
      }
    });
  }

  global.Tip = {
    curve: curve, kline: kline,
    html: html, row: row, title: title,
    esc: esc, pct: pct, num: num, short: short,
    time: time, date: date, datetime: datetime,
    CLS: CLS
  };
})(typeof window !== 'undefined' ? window : globalThis);
