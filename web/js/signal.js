/* ============================================================================
 * web/js/signal.js —— ★共享「买多/卖空」信号组件（2026-11-04）
 * ----------------------------------------------------------------------------
 * 信号来源：能量段级副图的【背驰标记】（与副图共享同一套能量引擎 EnergyEngines）：
 *   · 绿色底背驰（dir<0，bullish）  → 买入信号「买多」
 *   · 红色顶背驰（dir>0，bearish）  → 卖出信号「卖空」
 *
 * 标记样式（用户指定）：
 *   · 买多：K 线【下方】，红字 15px，「🚀 买多」
 *   · 卖空：K 线【上方】，绿字 15px，「🍃 卖空」
 *   （标签颜色遵循国内「涨红跌绿」：买多=红，卖空=绿；与副图背驰点的绿/红语义区分，不冲突）
 *
 * ★共享：所有页面（总览 / OKX / 美股）、所有 K 线图、所有选项卡、所有合约与指数
 *   统一在 web/js/energy.js 的 SubCharts.sync() 末尾调用 drawOnChart —— 一处接入，全局生效。
 *
 * ★热插拔：信号完全派生自 EnergyEngines（已热插拔）。将来换公式/换信号逻辑，
 *   只需 EnergyEngines.register 新模型，或改 global.Signals.config，无需动本文件以外代码。
 *
 * 暴露：global.Signals = { drawOnChart, compute, config, _stats }
 * ========================================================================== */
(function (global) {
  'use strict';

  var RED = '#f0334b', GREEN = '#0bbf7a';

  /* 可热插拔配置（将来微调无需改核心逻辑） */
  var cfg = {
    font: 15,            // 标记字号 px（用户指定 15）
    gap: 22,             // 标签距 K 线高低点的距离
    buyColor: RED,       // 买多 = 红（涨红）
    sellColor: GREEN,    // 卖空 = 绿（跌绿）
    buyText: '买多',
    sellText: '卖空',
    buyIcon: '🚀',       // 小火箭
    sellIcon: '🍃'       // 绿叶
  };

  /* 取能量数据：优先用副图已算好并缓存的（避免重复计算），否则回退到引擎即时算 */
  function getEnergy(cv, bars) {
    var ed = (cv && cv.__sub && cv.__sub.energy && cv.__sub.energy.data) || null;
    if (ed) return ed;
    if (global.EnergyEngines) {
      try { return global.EnergyEngines.compute(bars || [], {}); } catch (e) { }
    }
    return null;
  }

  /* 当前可见区间（与副图/主图一致） */
  function visibleRange(cv) {
    var st = cv._kst || {};
    var total = cv.__total || 0;
    var vis = (st.vis | 0) || 200;
    var off = (st.off | 0) || 0;
    var endI = total - off;
    var startI = Math.max(0, endI - vis);
    return { startI: startI, endI: endI };
  }

  /* ================================================================ 主绘制入口
   * 由 SubCharts.sync 在每个主图重绘后调用：cv = 主 K 线 canvas；bars = 全量 K 线数组 */
  function drawOnChart(cv, bars) {
    if (!cv || typeof cv.__xOf !== 'function' || typeof cv.__yOf !== 'function') return;
    bars = bars || (cv.__sub && cv.__sub.bars) || [];
    var ed = getEnergy(cv, bars);
    if (!ed || ed.empty || !ed.divs || !ed.divs.length) return;

    var ctx = cv.getContext('2d');
    if (!ctx) return;

    var vr = visibleRange(cv);
    var S = global.Signals._stats; S.calls++;
    var drawnBuy = 0, drawnSell = 0;

    /* 标签纵向边界：避免越出画布（candle 在主区，标签在其上下，可能被推到画布外） */
    var topY = 12;
    var botY = (cv.clientHeight || (cv.__geo && cv.__geo.mainH ? (cv.__geo.t + cv.__geo.mainH) : 480)) - 12;

    for (var i = 0; i < ed.divs.length; i++) {
      var d = ed.divs[i];
      var idx = d.idx;
      if (idx < vr.startI || idx >= vr.endI) continue;   // 仅画可见区
      var isBuy = (d.dir < 0);                            // 底背驰(green)=买 ; 顶背驰(red)=卖
      var bar = bars[idx];
      /* 锚定价：优先用背驰极值价 d.px（段端点，最准确）；
       * 否则回退 K 线 low/high —— 兼容 .l/.h 与 .low/.high 两种字段命名 */
      var anchorP = (d.px != null && isFinite(d.px)) ? d.px
        : (bar ? (isBuy ? (bar.l != null ? bar.l : bar.low) : (bar.h != null ? bar.h : bar.high)) : null);
      if (anchorP == null || !isFinite(anchorP)) continue;
      var x = cv.__xOf(idx);
      var yCandle = cv.__yOf(anchorP);
      if (!isFinite(yCandle)) continue;
      var yLabel = isBuy ? (yCandle + cfg.gap) : (yCandle - cfg.gap);
      if (yLabel < topY) yLabel = topY;                   // 卖空标签贴顶，避免越界（仍保证可见）
      else if (yLabel > botY) yLabel = botY;             // 买多标签贴底
      var col = isBuy ? cfg.buyColor : cfg.sellColor;
      var txt = isBuy ? (cfg.buyIcon + ' ' + cfg.buyText) : (cfg.sellIcon + ' ' + cfg.sellText);

      /* 标签背景胶囊：保证在 K 线 / 缠论线之上清晰可读 */
      ctx.font = cfg.font + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var _tw = ctx.measureText(txt).width;
      var _padX = 5, _padY = 3, _bw = _tw + _padX * 2, _bh = cfg.font + _padY * 2;
      ctx.fillStyle = 'rgba(8,12,20,.82)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x - _bw / 2, yLabel - _bh / 2, _bw, _bh, 5); ctx.fill(); }
      else { ctx.fillRect(x - _bw / 2, yLabel - _bh / 2, _bw, _bh); }

      /* 连接线：从锚定价牵到标签，标明锚定 */
      ctx.save();
      ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yCandle); ctx.lineTo(x, yLabel); ctx.stroke();
      ctx.restore();

      /* 标签：买多红 / 卖空绿，15px，居中 */
      ctx.font = cfg.font + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = col;
      ctx.fillText(txt, x, yLabel);

      if (isBuy) drawnBuy++; else drawnSell++;
    }

    S.drawn += drawnBuy + drawnSell;
    S.buy += drawnBuy; S.sell += drawnSell;
    S.lastCanvas = (cv.id || (cv.className || '')) + '';
  }

  /* ================================================================ 独立计算（供外部/测试调用）
   * 输入 bars → 输出信号数组（买/卖 + 触发位置） */
  function compute(bars, opt) {
    var ed = (global.EnergyEngines) ? global.EnergyEngines.compute(bars || [], opt || {}) : null;
    if (!ed || ed.empty || !ed.divs) return { empty: true, n: 0, signals: [] };
    var signals = ed.divs.map(function (d) {
      return {
        idx: d.idx, dir: d.dir,
        type: d.dir < 0 ? 'buy' : 'sell',
        label: d.dir < 0 ? cfg.buyText : cfg.sellText,
        px: d.px, pxPrev: d.pxPrev, type2: d.type
      };
    });
    return { empty: false, n: ed.n, signals: signals, divs: ed.divs };
  }

  global.Signals = {
    drawOnChart: drawOnChart,
    compute: compute,
    config: cfg,
    _stats: { calls: 0, drawn: 0, buy: 0, sell: 0, lastCanvas: '' }
  };
})(typeof window !== 'undefined' ? window : globalThis);
