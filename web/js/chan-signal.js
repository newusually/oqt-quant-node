/* ============================================================================
 * chan-signal.js —— 【全站共用】买卖信号核心 JS（OKX / NQ / A股 三页面共用）
 * ----------------------------------------------------------------------------
 * 用户要求：「这3个页面的信号都是同一个买卖信号 应该共用啊 共用买卖信号dll 变成js」
 *   → 本文件就是「DLL 变 JS」的落地：把 latest 的 cpp/signal/signal_chan.cpp
 *     买卖信号规则收敛成一个前端/后端共用的 JS 模块，三页面引用同一份。
 *
 * 规则（2026-10-24 用户最终口径）：
 *   ① 取「最近两根」K线作为基准点，要求 DIF 线与 DEA 线在这两根上"相同"
 *      （|F-S| / price <= eps）
 *   ② 以这两根为基准，把 DIF 与 DEA 各向右画一条【延长虚线】
 *   ③ 两条虚线在前方【交叉】= DIF 与 DEA 变得相同之处
 *        向上开口（DIF 在上）= 买
 *        向下开口（DEA 在上）= 卖
 *   ④ 交叉夹角必须 < maxAngle（默认 40°）
 *   ⑤ 其他买卖信号（一买/一卖、60°夹角、EMA金叉）全部不用
 *
 * 导出：
 *   window.ChanSignal.compute(bars, opt) → {sigs, base, lines}
 *   window.ChanSignal.draw(ctx, geo, res) → 画延长虚线 + 交叉点 + 火箭/绿叶
 *   window.ChanSignal.minGap(tf)         → 按周期给最小间隔
 * ========================================================================== */
(function (global) {
  'use strict';

  var CC = global.ChanCore;
  if (!CC) { console.warn('[ChanSignal] ChanCore 未加载'); return; }

  /* ---------- 按周期给最小间隔（根）：防止同一波行情刷屏 ---------- */
  var GAP = {
    '1m': 60, '3m': 50, '5m': 20, '15m': 15, '30m': 12,
    '1h': 10, '2h': 8, '4h': 6, '6h': 5, '12h': 4,
    '1d': 4, '1w': 2, '1M': 1
  };
  function minGap(tf) {
    if (!tf) return 10;
    return (GAP[String(tf)] !== null && GAP[String(tf)] !== undefined) ? GAP[String(tf)] : 10;
  }

  /* ---------- 计算信号（薄封装 ChanCore.macdCrossSignals，保证三页同一口径） ---------- */
  // bars: [{t, o, h, l, c, v}]
  // opt:   {maxAngle(默认40), eps(默认0.0002), minGap(默认按tf), maxAhead(默认60)}
  function compute(bars, opt) {
    opt = opt || {};
    var o = {
      maxAngle: (opt.maxAngle === null || opt.maxAngle === undefined) ? 40 : opt.maxAngle,
      eps: (opt.eps === null || opt.eps === undefined) ? 0.0002 : opt.eps,
      minGap: (opt.minGap === null || opt.minGap === undefined) ? minGap(opt.tf) : opt.minGap,
      maxAhead: (opt.maxAhead === null || opt.maxAhead === undefined) ? 60 : opt.maxAhead
    };
    return CC.macdCrossSignals(bars || [], o);
  }

  /* ---------- 绘制 ---------- */
  // geo: {x(i)->px, y(price)->py, i0(全局起始下标), i1(全局结束下标), right(右边缘px),
  //        lineColorFast, lineColorSlow, drawRocket, drawLeaf}
  function draw(ctx, geo, res) {
    if (!ctx || !res || !res.base || !res.base.ok || !res.lines) return null;
    var F = res.lines.f, S = res.lines.s;
    var b = res.base;
    var i0 = b.i, i1 = ((b.i2 !== null && b.i2 !== undefined) ? b.i2 : b.i + 1);
    var gx0 = geo.x(i0), gx1 = geo.x(i1);
    var gyF0 = geo.y(F[i0]), gyF1 = geo.y(F[i1]);
    var gyS0 = geo.y(S[i0]), gyS1 = geo.y(S[i1]);
    var xR = geo.right;

    // ① 两条延长虚线（DIF 橙 / DEA 蓝）
    var kf = (gyF1 - gyF0) / Math.max(1e-6, (gx1 - gx0));
    var ks = (gyS1 - gyS0) / Math.max(1e-6, (gx1 - gx0));
    ctx.save();
    ctx.setLineDash([6, 4]); ctx.lineWidth = 1.6;
    ctx.strokeStyle = geo.lineColorFast || '#f0a020';
    ctx.beginPath(); ctx.moveTo(gx0, gyF0); ctx.lineTo(xR, gyF0 + kf * (xR - gx0)); ctx.stroke();
    ctx.strokeStyle = geo.lineColorSlow || '#3d7bff';
    ctx.beginPath(); ctx.moveTo(gx0, gyS0); ctx.lineTo(xR, gyS0 + ks * (xR - gx0)); ctx.stroke();
    ctx.setLineDash([]);

    // ② 交点（两条虚线交叉处 = DIF 与 DEA 变得相同之处）
    var den = kf - ks;
    var xC = den ? gx0 + (gyS0 - gyF0) / den : gx0;
    var yC = gyF0 + kf * (xC - gx0);
    var sig = res.sigs && res.sigs[0];
    var buy = sig ? sig.dir > 0 : true;

    // ③ 交叉点标记
    ctx.fillStyle = buy ? '#ff3b30' : '#0bbf7a';
    ctx.beginPath(); ctx.arc(xC, yC, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (sig) {
      ctx.fillStyle = buy ? '#ff6b63' : '#4fe0a8';
      ctx.fillText((buy ? '买' : '卖') + ' ' + sig.ang.toFixed(0) + '°', xC, yC - 13);
    }
    ctx.restore();

    // ④ 窗口内所有历史信号的火箭/绿叶标记（前面一个月/几天的也要看得见）
    var drawn = 0;
    (res.sigs || []).forEach(function (s) {
      var gi = s.i;
      if (gi < geo.i0 || gi > geo.i1) return;
      var px = geo.x(gi);
      var isBuy = s.dir > 0;
      var size = geo.size || 8;
      var col = isBuy ? '#ff3b30' : '#0bbf7a';
      ctx.save();
      ctx.fillStyle = col;
      if (isBuy) {
        var py = geo.y(geo.lowAt(gi)) + size * 1.5;
        if (geo.drawRocket) geo.drawRocket(ctx, px, py, size);
        ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(geo.wide ? ('买 ' + s.ang.toFixed(0) + '°') : '买', px, py + size * 1.35 + 8);
      } else {
        var py2 = geo.y(geo.highAt(gi)) - size * 1.5;
        if (geo.drawLeaf) geo.drawLeaf(ctx, px, py2, size);
        ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(geo.wide ? ('卖 ' + s.ang.toFixed(0) + '°') : '卖', px, py2 - size * 1.35 - 7);
      }
      ctx.restore();
      drawn++;
    });

    return { xC: xC, yC: yC, buy: buy, drawn: drawn };
  }

  global.ChanSignal = {
    compute: compute,
    draw: draw,
    minGap: minGap,
    GAP: GAP,
    MAX_ANGLE: 40
  };
})(typeof window !== 'undefined' ? window : globalThis);
