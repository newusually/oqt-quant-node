/* ============================================================================
 * web/js/trade-signals.js —— ★共享「买多 / 卖空 / 加仓 / 平仓」金字塔成交标记组件（2026-11-09 四态定稿）
 * ----------------------------------------------------------------------------
 * 用户定稿：买卖点要求 MA5 缠论线【第一次超过 MA60 虚线】为买多；
 *           MA5【第一次下跌超过 MA60 虚线】为卖空。
 *           买多 红色（写在 K 线下方），卖空 绿色（写在 K 线上方）。
 *           所有 K 线图和分时都要有。
 * ★2026-11-09 用户要求：标记字/形状/标签整体【缩小一倍】(15px→8px)，
 *   所有实线（成交价引导线、标签引导线、胶囊边框、形状轮廓）统一改为【虚线】。
 *
 * 判定（无未来函数，逐根序列）：
 *   a = ChanLun.series(bars, 5)   —— MA5  缠论线（红实线，转折点直连的纯直线段）
 *   b = ChanLun.series(bars, 60)  —— MA60 缠论线（粉虚线，转折点直连的纯直线段）
 *   d[i] = a[i] - b[i]
 *     d[i-1] <= 0 && d[i] > 0  → 第一次上穿 = 买多
 *     d[i-1] >= 0 && d[i] < 0  → 第一次下穿 = 卖空
 *   「第一次」= 只在穿越发生的那一根标记一次，状态保持期间不重复标记。
 *   起点从 i>=60 起算（MA60 未成形的头部无意义），minGapBars 再滤掉贴线抖动。
 *
 * 共享方式：本组件只负责「算 + 画」，由 drawKline 主图在 chanlun 画完之后统一调用，
 *   因此总览两个 K 线图、全部周期(含分时)、任何未来接入的页面都自动拥有同一套买卖点。
 *
 * 暴露：global.TradeSignals = { compute, cached, draw, config, setConfig, _stats }
 * ========================================================================== */
(function (global) {
  'use strict';

  var CFG = {
    fastPeriod: 5,
    slowPeriod: 60,
    minGapBars: 3,          // 贴线抖动去重：两次信号至少间隔 N 根
    fontSize: 8,            // ★2026-11-09 用户要求「标记字太大，缩小一倍」：15px → 8px
    buyText: '买多',
    sellText: '卖空',
    buyColor: '#f0334b',    // ★买多红色
    sellColor: '#0bbf7a',   // ★卖空绿色
    bg: 'rgba(10,16,28,.82)'
  };

  var WM = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  var ver = 0;
  var stats = { computed: 0, drawn: 0, buys: 0, sells: 0, lastError: '' };

  function setConfig(p) {
    if (!p) return CFG;
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k) && CFG[k] !== undefined) CFG[k] = p[k];
    CFG.fastPeriod = Math.max(2, CFG.fastPeriod | 0);
    CFG.slowPeriod = Math.max(CFG.fastPeriod + 1, CFG.slowPeriod | 0);
    CFG.minGapBars = Math.max(0, CFG.minGapBars | 0);
    CFG.fontSize = Math.max(7, CFG.fontSize | 0);   // 允许 8px 小字号（旧下限 8 会挡住一半缩放）
    ver++;                                     // 参数变了 → 缓存整体失效
    return CFG;
  }

  function chanSeries(bars, period) {
    if (!global.ChanLun || typeof global.ChanLun.series !== 'function') return null;
    try { return global.ChanLun.series(bars, period); } catch (e) { stats.lastError = String(e && e.message || e); return null; }
  }

  /* compute(bars) → [{ i, dir(1买多/-1卖空), t, price, bar }] */
  function compute(bars) {
    var out = [];
    stats.computed = 0; stats.buys = 0; stats.sells = 0;
    if (!bars || bars.length < CFG.slowPeriod + 5) return out;
    var a = chanSeries(bars, CFG.fastPeriod), b = chanSeries(bars, CFG.slowPeriod);
    if (!a || !b || a.length !== b.length) return out;

    var n = bars.length, start = Math.max(CFG.slowPeriod, 1);
    var prev = null, lastI = -1e9;
    for (var i = start; i < n; i++) {
      var d = a[i] - b[i];
      if (!isFinite(d)) continue;
      var dir = 0;
      if (prev !== null) {
        if (prev <= 0 && d > 0) dir = 1;         // ★第一次上穿 MA60 → 买多
        else if (prev >= 0 && d < 0) dir = -1;   // ★第一次下穿 MA60 → 卖空
      }
      prev = d;
      if (!dir) continue;
      if (i - lastI < CFG.minGapBars) continue;  // 「第一次」去重，避免贴线反复触发
      lastI = i;
      var bar = bars[i] || {};
      out.push({
        i: i, dir: dir, t: bar.t,
        price: (a[i] + b[i]) / 2,
        bar: bar
      });
      if (dir > 0) stats.buys++; else stats.sells++;
    }
    stats.computed = out.length;
    return out;
  }

  /* 末根形成中 K 线会被实时价原地改写，故 stamp 带上末根收盘价，变更即重算 */
  function cached(bars) {
    if (!bars || !bars.length) return [];
    var n = bars.length, z = bars[n - 1] || {};
    var stamp = 'v' + ver + '|' + n + '|' + z.t + '|' + z.c;
    if (WM) {
      var rec = WM.get(bars);
      if (rec && rec.stamp === stamp) return rec.data;
      var d = compute(bars);
      WM.set(bars, { stamp: stamp, data: d });
      return d;
    }
    return compute(bars);
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ★2026-11-08 / 2026-11-09：标记来源 = 金字塔策略真实成交记录(_marks)，
   *   四类事件共用一套视觉：买多(红三角·下) / 卖空(绿三角·上) / 加仓(橙菱形·下) / 平仓(蓝针·上)。
   *   视觉样式（15px 个性化标签 + 圆角底 + 防重叠）完全保留，新增形状区分四态。 */
  var _marks = [];                       // 全局 marks（leadk 总览 K线用，旧调用兼容）
  var _byId = Object.create(null);       // ★按 canvas id 隔离（悬浮窗与总览同时开不串信号）
  function setMarks(a, id) {
    if (id) _byId[id] = a || [];
    else _marks = a || [];
  }
  function marksFor(id) {
    return (id && _byId[id] !== undefined) ? _byId[id] : _marks;
  }

  /* ★五态样式：加仓按方向细分「买多加仓 / 卖空加仓」，多空分列上下避免堆在一起 */
  var STYLE = {
    buy:       { color: '#ff6b7d', side: 'down', shape: 'triUp', label: '买多',     key: 'buy' },
    sell:      { color: '#31c99a', side: 'up',   shape: 'triDn', label: '卖空',     key: 'sell' },
    add_long:  { color: '#f0a020', side: 'down', shape: 'dia',   label: '买多加仓', key: 'add_long' },
    add_short: { color: '#c07ae0', side: 'up',   shape: 'dia',   label: '卖空加仓', key: 'add_short' },
    close:     { color: '#4f8cff', side: 'up',   shape: 'pin',   label: '平仓',     key: 'close' }
  };
  function classify(m) {
    var dv = +((m && m.dir) != null ? m.dir : 1);
    var ev = (m && m.event) ? m.event : ((dv < 0) ? 'sell' : 'buy');
    /* ★加仓按方向细分：买多加仓 / 卖空加仓（dir<0 才是卖空，缺失 dir 默认买多） */
    if (ev === 'add') ev = (dv < 0) ? 'add_short' : 'add_long';
    return STYLE[ev] || {
      color: '#8b9abc', side: 'down', shape: 'circle',
      label: String(ev || '?'), key: String(ev || '?')
    };
  }

  function findBarIndex(bars, ts) {
    if (!bars || !bars.length) return -1;
    var lo = 0, hi = bars.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; var t = bars[mid].t; if (t <= ts) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }

  /* 在 (x,y) 绘制事件标记形状（sz=半径）
   * ★2026-11-09：形状尺寸缩小一半、轮廓由实线改【虚线】（加仓等所有标记统一）。 */
  function drawShape(ctx, shape, x, y, sz, color) {
    ctx.save();
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    if (shape === 'triUp') {
      ctx.moveTo(x, y - sz); ctx.lineTo(x - sz, y + sz); ctx.lineTo(x + sz, y + sz); ctx.closePath();
    } else if (shape === 'triDn') {
      ctx.moveTo(x, y + sz); ctx.lineTo(x - sz, y - sz); ctx.lineTo(x + sz, y - sz); ctx.closePath();
    } else if (shape === 'dia') {
      ctx.moveTo(x, y - sz); ctx.lineTo(x + sz, y); ctx.lineTo(x, y + sz); ctx.lineTo(x - sz, y); ctx.closePath();
    } else if (shape === 'pin') {
      ctx.arc(x, y - sz * 0.5, sz * 0.7, 0, Math.PI * 2); ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - sz * 0.5, y - sz * 0.1);
      ctx.lineTo(x + sz * 0.5, y - sz * 0.1);
      ctx.lineTo(x, y + sz); ctx.closePath();
    } else {
      ctx.arc(x, y, sz * 0.8, 0, Math.PI * 2); ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();      // ★虚线轮廓（setLineDash([2,2])），实线感不再遮挡 K线
    ctx.restore();
  }

  /* draw(ctx, env)
   * env = { bars, startI, endI, x(absIdx)->cssX, y(price)->cssY, clip:{l,t,w,h} }
   * ★2026-11-09：四类事件（买多/卖空/加仓/平仓）各自形状 + 个性化标签，碰撞防重叠 */
  function draw(ctx, env) {
    stats.drawn = 0;
    if (!ctx || !env || !env.bars || !env.bars.length) return;
    var bars = env.bars, sI = env.startI || 0, eI = (env.endI == null ? bars.length : env.endI);
    /* ★按画布 id 取各自的 marks：总览 K线用全局，悬浮窗用自己那份，互不覆盖 */
    var marks = marksFor(env.id);
    /* ★按 K线索引 + 事件类型分组：同一根 K线内「同类型」事件合并成一个标记并显示 ×N，
     *   避免同一位置多个标签叠成一坨（用户反馈「会叠加 有问题」）。
     *   同根不同类型事件分配不同 lane（水平错开），配合垂直外推彻底防重叠。 */
    var groups = Object.create(null), order = [];
    for (var zi = 0; zi < marks.length; zi++) {
      var m = marks[zi]; if (!m || !isFinite(m.ts)) continue;
      var bi = findBarIndex(bars, m.ts);
      if (bi < 0) continue;
      var st = classify(m);
      if (!groups[bi]) { groups[bi] = Object.create(null); order.push(bi); }
      var g = groups[bi][st.key];
      var pv = +m.price;
      if (!g) {
        groups[bi][st.key] = {
          i: bi, t: m.ts, st: st, n: 1,
          sumPx: isFinite(pv) ? pv : 0, cntPx: isFinite(pv) ? 1 : 0,
          price: isFinite(pv) ? pv : NaN
        };
      } else {
        g.n++;
        if (isFinite(pv)) { g.sumPx += pv; g.cntPx++; }
      }
    }
    var sigs = [];
    for (var oi = 0; oi < order.length; oi++) {
      var gm = groups[order[oi]], keys = [];
      for (var kk in gm) if (Object.prototype.hasOwnProperty.call(gm, kk)) keys.push(kk);
      keys.sort();
      for (var ki = 0; ki < keys.length; ki++) {
        var sg = gm[keys[ki]];
        if (sg.cntPx) sg.price = sg.sumPx / sg.cntPx;   // 合并后用成交均价作锚点
        sg.lane = ki; sg.lanes = keys.length;
        sigs.push(sg);
      }
    }
    sigs.sort(function (a, b) { return a.i - b.i || a.t - b.t; });
    if (!sigs.length) return;
    /* _stats 是全局共享的，两图轮流绘制 → 每次 draw 重算当前图的统计 */
    stats.computed = marks.length; stats.buys = 0; stats.sells = 0;
    stats.counts = { buy: 0, sell: 0, add: 0, add_long: 0, add_short: 0, close: 0 };
    for (var z = 0; z < marks.length; z++) {
      var mv = marks[z] || {};
      var ev0 = mv.event || (+mv.dir > 0 ? 'buy' : 'sell');
      if (ev0 === 'buy') stats.buys++;
      else if (ev0 === 'sell') stats.sells++;
      if (stats.counts[ev0] != null) stats.counts[ev0]++;
      if (ev0 === 'add') stats.counts[(+mv.dir > 0 ? 'add_long' : 'add_short')]++;
    }

    var top = env.clip ? env.clip.t : 0;
    var bottom = env.clip ? (env.clip.t + env.clip.h) : 1e9;
    var font = 'bold ' + CFG.fontSize + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    var placed = [];
    function hit(x1, y1, x2, y2) {
      for (var j = 0; j < placed.length; j++) {
        var r = placed[j];
        if (!(x2 < r.x1 - 2 || x1 > r.x2 + 2 || y2 < r.y1 - 2 || y1 > r.y2 + 2)) return true;
      }
      return false;
    }

    ctx.save();
    ctx.setLineDash([]);       // ★所有标记线条统一走虚线，逐段显式设置、画完复位
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var clipL = env.clip ? env.clip.l : 0;
    var clipR = env.clip ? (env.clip.l + env.clip.w) : 1e9;

    for (var k = 0; k < sigs.length; k++) {
      var s = sigs[k];
      if (s.i < sI || s.i >= eI) continue;
      var px = env.x(s.i);
      if (!isFinite(px)) continue;
      /* 无成交价时退回该根收盘价，绝不退回 low/high（那会让标记偏离真实成交位置） */
      if (!isFinite(s.price)) {
        var fb = bars[s.i] || {};
        s.price = +fb.c;
        if (!isFinite(s.price)) continue;
      }

      var col = s.st.color;
      var down = s.st.side === 'down';
      var sz = 4;                 /* ★形状半径 7 → 4（缩小一倍） */
      /* ★成交价锚定：标记高度 = 真实买入/卖出/加仓/平仓的成交价 env.y(price)。
       *   旧版用 env.y(low/high) 画在蜡烛上下沿，正是「不在实际价格位置标明」的根因。 */
      var priceY = env.y(s.price);
      if (!isFinite(priceY)) continue;
      priceY = Math.max(top + 2, Math.min(bottom - 2, priceY));
      var shapeY = priceY;

      var txt = s.st.label + (s.n > 1 ? '×' + s.n : '');
      var tw = ctx.measureText(txt).width + 6;   /* ★胶囊内边距 12 → 6 */
      var hh = CFG.fontSize + 4;                 /* ★胶囊高度 23 → 12 */
      /* 同一根 K线多个不同类型事件 → 水平分道错开；不同根但靠近的再做垂直外推 */
      var ax = px + (s.lane - (s.lanes - 1) / 2) * (tw + 3);
      ax = Math.max(clipL + tw / 2 + 1, Math.min(clipR - tw / 2 - 1, ax));

      var py = down ? (shapeY + sz + hh / 2 + 3) : (shapeY - sz - hh / 2 - 3);
      var step = down ? (hh + 2) : -(hh + 2);
      for (var tries = 0; tries < 10; tries++) {
        var Y = Math.max(top + hh / 2, Math.min(bottom - hh / 2, py));
        if (!hit(ax - tw / 2, Y - hh / 2, ax + tw / 2, Y + hh / 2)) { py = Y; break; }
        py += step;
      }
      py = Math.max(top + hh / 2, Math.min(bottom - hh / 2, py));
      placed.push({ x1: ax - tw / 2, y1: py - hh / 2, x2: ax + tw / 2, y2: py + hh / 2 });

      /* ① 成交价定位点 + 横向【虚线】：把「真实成交价」与形状连起来 */
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = 0.9;
      ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.moveTo(px, priceY); ctx.lineTo(ax, shapeY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(px, priceY, 1.4, 0, Math.PI * 2); ctx.fill();

      /* ② 形状放在成交价高度（不再贴在 low/high）；形状本身也是虚线轮廓 */
      drawShape(ctx, s.st.shape, ax, shapeY, sz, col);

      /* ③ 标签引导【虚线】：标签 → 形状 */
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = 0.85;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(ax, down ? (py - hh / 2) : (py + hh / 2));
      ctx.lineTo(ax, down ? (shapeY + sz) : (shapeY - sz));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      /* 深色半透明胶囊底（尺寸减半 + 虚线边框），保证在 K 线/缠论线上清晰可读 */
      ctx.fillStyle = CFG.bg;
      roundRect(ctx, ax - tw / 2, py - hh / 2, tw, hh, 3);
      ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = col;
      ctx.fillText(txt, ax, py + 0.5);
      stats.drawn++;
    }
    ctx.restore();
  }

  global.TradeSignals = {
    compute: compute,
    cached: cached,
    draw: draw,
    setMarks: setMarks,
    config: CFG,
    setConfig: setConfig,
    _stats: stats
  };
})(typeof window !== 'undefined' ? window : globalThis);
