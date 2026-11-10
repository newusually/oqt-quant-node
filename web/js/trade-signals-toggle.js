/* ============================================================================
 * web/js/trade-signals-toggle.js —— K 线右上角「买卖信号」开关（默认隐藏）
 * ----------------------------------------------------------------------------
 * 用户 2026-11-06 要求：
 *   「增加买卖信号按钮在K线图右上角 点击才显示 不点击默认隐藏买卖信号显示
 *     这样方便修改 买卖信号是由共享买卖信号组件组成的」
 *
 * 买卖信号仍完全由共享组件 global.TradeSignals 绘制，本文件只负责：
 *   ① 一个全局开关（默认 false = 隐藏，刷新页面恢复默认隐藏，不持久化）
 *   ② 在每个 K 线画布右上角懒注入按钮（画布由 LeadK / us.js 动态创建，故懒注入）
 *   ③ 切换时按保存的 opts 原样重绘所有 K 线画布，两个图同时生效
 * ind-engine.js 的 drawKline 在调用 TradeSignals.draw 前读 QASigToggle.isEnabled() 门控。
 * ========================================================================== */
(function (global) {
  'use strict';
  var CLS = 'qa-sig-btn';
  var enabled = false;          /* ★默认隐藏 */
  var ON_BG = '#2f6bff', OFF_BG = '#16233b';
  /* 本轮重绘中共享组件实际画出的买卖信号累计数（供真实浏览器验收） */
  var sigCount = { draws: 0, buys: 0, sells: 0, computed: 0, canvases: 0, invoked: 0 };

  function isEnabled() { return enabled; }
  function signalStats() {
    return { on: enabled, draws: sigCount.draws, buys: sigCount.buys, sells: sigCount.sells,
      computed: sigCount.computed, canvases: sigCount.canvases, invoked: sigCount.invoked };
  }

  /* 只做调用次数计数，不改绘制逻辑：买卖信号仍 100% 由共享组件 TradeSignals.draw 完成。
     包一层是为了让真实浏览器验收能确定「开关打开后共享组件确实被调用」。 */
  function instrument() {
    var TS = global.TradeSignals;
    if (!TS || TS.__qaSigWrapped || typeof TS.draw !== 'function') return;
    var orig = TS.draw;
    TS.draw = function () { sigCount.invoked++; return orig.apply(this, arguments); };
    TS.__qaSigWrapped = true;
  }

  function syncButtons() {
    var bs = document.querySelectorAll('.' + CLS);
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      b.textContent = enabled ? '买卖信号 · 开' : '买卖信号 · 关';
      b.setAttribute('data-on', enabled ? '1' : '0');
      b.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      b.style.background = enabled ? ON_BG : OFF_BG;
      b.style.color = enabled ? '#fff' : '#cfe0ff';
      b.style.borderColor = enabled ? ON_BG : '#3a4f78';
      b.style.boxShadow = enabled ? '0 0 0 2px rgba(47,107,255,.22)' : 'none';
    }
  }

  /* 用 drawKline 保存的 __qaOpts 原样重绘，不重建数据、不改任何指标口径 */
  function redrawAll() {
    instrument();
    sigCount = { draws: 0, buys: 0, sells: 0, computed: 0, canvases: 0, invoked: 0 };
    var TS = global.TradeSignals;
    var list = document.querySelectorAll('canvas');
    for (var i = 0; i < list.length; i++) {
      var cv = list[i];
      if (!cv.__qaOpts || typeof global.drawKline !== 'function') continue;
      try {
        global.drawKline(cv, cv.__qaOpts);
        sigCount.canvases++;
        if (TS && TS._stats) {   /* 共享组件每次 draw 会重置自身统计，逐画布累加 */
          sigCount.draws += TS._stats.drawn | 0;
          sigCount.buys += TS._stats.buys | 0;
          sigCount.sells += TS._stats.sells | 0;
          sigCount.computed += TS._stats.computed | 0;
        }
      } catch (e) { /* 单个画布失败不影响其它 */ }
    }
    try { if (global.SubCharts && global.SubCharts.refreshAll) global.SubCharts.refreshAll(); } catch (e) { }
  }

  function toggle() {
    enabled = !enabled;
    /* 关闭时把共享组件的残留统计清零，页面刷新前后状态一致：默认隐藏 = 0 个信号 */
    if (!enabled && global.TradeSignals && global.TradeSignals._stats) {
      global.TradeSignals._stats.drawn = 0;
      global.TradeSignals._stats.buys = 0;
      global.TradeSignals._stats.sells = 0;
      global.TradeSignals._stats.computed = 0;
    }
    syncButtons();
    redrawAll();
  }

  function ensureButton(cv) {
    var host = cv && cv.parentNode;
    if (!host || host.querySelector('.' + CLS)) return;
    try {
      var cs = global.getComputedStyle(host);
      if (cs && cs.position === 'static') host.style.position = 'relative';
    } catch (e) { }
    var b = document.createElement('button');
    b.type = 'button';
    b.className = CLS;
    b.title = '点击切换买多/卖空买卖信号（由共享组件 TradeSignals 绘制）；默认隐藏，刷新后恢复隐藏';
    b.style.cssText = 'position:absolute;top:5px;right:8px;z-index:14;' +
      'font:11px/1.2 "Microsoft YaHei","PingFang SC",sans-serif;padding:5px 10px;' +
      'border-radius:6px;cursor:pointer;white-space:nowrap;' +
      'background:' + OFF_BG + ';color:#cfe0ff;border:1px solid #3a4f78;';
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      toggle();
    });
    host.appendChild(b);
    syncButtons();
  }

  global.QASigToggle = {
    isEnabled: isEnabled,
    ensureButton: ensureButton,
    sync: syncButtons,
    redraw: redrawAll,
    toggle: toggle,
    signalStats: signalStats
  };
})(typeof window !== 'undefined' ? window : globalThis);
