/* ============================================================
 * chan-core.js — 缠论线/买卖信号核心算法（1:1 移植自 E:\oqt-quant-latest）
 *
 * 【来源逐条对应】
 *  ① 线计算   ← cpp/signal/chan_line.cpp  cl_lines()（cl_mode=macd 口径）
 *     · EMA 用 SMA 播种（ema_of），不是首值递推
 *     · line1 = slowEMA + DIF(=fastEMA) → 实际就是 fastEMA
 *     · line2 = slowEMA + DEA           → DEA 是 DIF 的 EMA(9)
 *     · 单位是【价格】→ 天然贴着K线柱子；两线交叉 = MACD 金叉/死叉
 *  ② 转折点   ← web/src/js/service/chart/chan.js  OXCF.chanLnPivots()
 *     · 左右 W 根(CL_PIV_WIN=4)内的极值 → 顶/底交替
 *     · 同向连续取更极端者；反向必须跨过 minMove(0.0015) 才算新转折
 *     · 两端留 W 根 → 右侧确认，无未来函数
 *  ③ 两端延长 ← chan.js  OXCF.chanExtend()
 *     · 按端段斜率外推到 K线首/末根，夹在 [lo-50%波幅, hi+50%波幅]
 *  ④ 分色连线 ← chan.js  OXCF.chanDirLines()
 *     · 每段一支线：上涨段红(#f6465d) / 下跌段绿(#0ecb81)；段内两点一线（绝不弯曲）
 *     · 延长段画【虚线】与真实段区分
 *  ⑤ 买卖信号 ← cpp/signal/signal_chan.cpp  bi_pair_angle() + g_csAngleMax
 *     · 斜率 k = (Δp/p)/Δbars（每根相对涨跌）
 *     · kScale = tan(25°)/中位斜率 → 角度口径跨周期一致
 *     · 夹角 = |atan(ka) - atan(kb)| （度）
 *     · 夹角 >= 60°（太陡的暴力 V 型）→ 不发信号
 *     · 笔序列由摆动顶/底序列(顶底交替)构成；绿笔(下跌)后接红笔(上涨)=买点（夹角朝上）
 *       红笔后接绿笔=卖点（夹角朝下）
 * ============================================================ */
'use strict';
(function (global) {
  var CL_PIV_WIN = 4;            // 摆动转折点窗口(左右各N根)
  var CL_PIV_MINMOVE = 0.0015;  // 反向转折点最小变动(0.15%)
  var COL_UP = '#f6465d';        // 上涨段 = 红
  var COL_DN = '#0ecb81';        // 下跌段 = 绿
  var WIDTH_FAST = 2.8;          // 快线线宽
  var WIDTH_SLOW = 3.8;          // 慢线线宽（更粗，像线段）
  var ANGLE_MAX = 60;           // 笔夹角上限(度)：>= 则不发信号
  var TAN25 = 0.46630765815;     // tan(25°)

  /* ---------- EMA（SMA 播种，与 C++ ema_of 完全一致） ---------- */
  // 返回长度与 c 相同；前 p-1 个为 NaN（预热区无效）
  function emaOf(c, p) {
    var n = c.length, out = new Array(n);
    if (n < p) { for (var z = 0; z < n; z++) out[z] = NaN; return out; }
    var seed = 0;
    for (var i = 0; i < p; i++) seed += c[i];
    seed /= p;
    out[p - 1] = seed;
    var k = 2 / (p + 1);
    for (var j = p; j < n; j++) out[j] = c[j] * k + out[j - 1] * (1 - k);
    return out;
  }

  /* ---------- cl_lines：价格尺上的 DIF / DEA 两条线（macd 模式） ---------- */
  // 返回 {f: 快线, s: 慢线, start: 有效起始下标}
  //   线1 = slowEMA + DIF = fastEMA
  //   线2 = slowEMA + DEA
  function clLines(closes, fast, slow, signal) {
    fast = fast || 12; slow = slow || 26; signal = signal || 9;
    var n = closes.length;
    if (n < slow) return { f: [], s: [], start: n };
    var a = emaOf(closes, fast);   // 快 EMA
    var b = emaOf(closes, slow);   // 慢 EMA
    var dif = new Array(n).fill(NaN);
    for (var i = slow - 1; i < n; i++) dif[i] = a[i] - b[i];
    var dea = new Array(n).fill(NaN);
    if (n > slow - 1 + signal - 1) {
      var seed = 0;
      for (var j = 0; j < signal; j++) seed += dif[slow - 1 + j];
      seed /= signal;
      dea[slow - 1 + signal - 1] = seed;
      var k = 2 / (signal + 1);
      for (var m = slow - 1 + signal; m < n; m++) dea[m] = dif[m] * k + dea[m - 1] * (1 - k);
    }
    var f = new Array(n).fill(NaN), s = new Array(n).fill(NaN);
    var start = slow - 1 + signal - 1;
    for (var q = start; q < n; q++) {
      f[q] = b[q] + dif[q];   // = fastEMA
      s[q] = b[q] + dea[q];
    }
    return { f: f, s: s, start: start };
  }

  /* ---------- chanLnPivots：摆动转折点（顶/底交替序列） ---------- */
  // tv: 时间数组；vv: 值数组；off: vv[0] 对应的全局下标（返回值里的 i 换算成全局下标）
  // 返回 [{i, v, top}]
  function pivots(tv, vv, off) {
    off = off || 0;
    var out = [], n = vv.length, i, k;
    var W = CL_PIV_WIN, mv = CL_PIV_MINMOVE;
    if (n < W * 2 + 1) return out;
    for (i = W; i < n - W; i++) {                    // 两端留 W 根 → 右侧确认
      var isT = true, isB = true;
      for (k = 1; k <= W; k++) {
        if (vv[i - k] >= vv[i] || vv[i + k] >= vv[i]) isT = false;
        if (vv[i - k] <= vv[i] || vv[i + k] <= vv[i]) isB = false;
        if (!isT && !isB) break;
      }
      if (!isT && !isB) continue;
      out.push({ i: i + off, v: vv[i], top: isT });
    }
    // 同向取更极端 / 反向需跨过 minMove
    var f = [], lastUp = null;
    for (i = 0; i < out.length; i++) {
      var c = out[i];
      if (!f.length) { f.push({ i: c.i, v: c.v, top: c.top }); continue; }
      var last = f[f.length - 1];
      var rising = c.v >= last.v;
      if (lastUp === null) {
        if (Math.abs(c.v - last.v) < last.v * mv) continue;
        f.push({ i: c.i, v: c.v, top: c.top });
        lastUp = rising;
        continue;
      }
      if (rising === lastUp) {                        // 同向 → 替换末点为更极端者
        if (rising ? (c.v >= last.v) : (c.v <= last.v)) f[f.length - 1] = { i: c.i, v: c.v, top: c.top };
        continue;
      }
      if (Math.abs(c.v - last.v) < last.v * mv) continue;  // 反向但幅度不够 → 噪音
      f.push({ i: c.i, v: c.v, top: c.top });
      lastUp = rising;
    }
    return f;
  }

  /* ---------- chanExtend：两端按端段斜率外推 ---------- */
  // pts: [{i,v}]（i 为 bars 下标）；i0/i1 为目标边界下标；vmin/vmax 为夹取区间
  function extend(pts, i0, i1, vmin, vmax) {
    if (!pts || pts.length < 2) return pts;
    var out = pts.map(function (p) { return { i: p.i, v: p.v, ext: false }; });
    var p0 = out[0], p1 = out[1], q0 = out[out.length - 2], q1 = out[out.length - 1];
    var clamp = function (v) { return v < vmin ? vmin : (v > vmax ? vmax : v); };
    if (p0.i > i0) {                                  // 左端外推
      var sl0 = (p1.v - p0.v) / Math.max(1, p1.i - p0.i);
      out.unshift({ i: i0, v: clamp(p0.v - sl0 * (p0.i - i0)), ext: true });
    }
    if (q1.i < i1) {                                  // 右端外推
      var sl1 = (q1.v - q0.v) / Math.max(1, q1.i - q0.i);
      out.push({ i: i1, v: clamp(q1.v + sl1 * (i1 - q1.i)), ext: true });
    }
    return out;
  }

  /* ---------- chanSplitExt：拆出两端延长段 ---------- */
  function splitExt(pts) {
    var r = { main: (pts || []).slice(), extL: null, extR: null };
    if (r.main.length >= 3 && r.main[0].ext) {
      r.extL = [r.main[0], r.main[1]];
      r.main = r.main.slice(1);
    }
    var n = r.main.length;
    if (n >= 3 && r.main[n - 1].ext) {
      r.extR = [r.main[n - 2], r.main[n - 1]];
      r.main = r.main.slice(0, n - 1);
    }
    return r;
  }

  /* ---------- chanDirRuns：按方向切段（每段两点一线） ---------- */
  // pts: [{i,v}] → [{pts:[{i,v}], up:bool}]
  function dirRuns(pts) {
    if (!pts || pts.length < 2) return [];
    var runs = [], start = 0, curUp = pts[1].v >= pts[0].v, i;
    var push = function (a, b, up) {
      var seg = [];
      for (var k = a; k <= b && k < pts.length; k++) seg.push({ i: pts[k].i, v: pts[k].v });
      if (seg.length >= 2) runs.push({ pts: seg, up: up });
    };
    for (i = 1; i < pts.length; i++) {
      var up = pts[i].v >= pts[i - 1].v;
      if (up !== curUp) { push(start, i - 1, curUp); start = i - 1; curUp = up; }
    }
    push(start, pts.length - 1, curUp);
    return runs;
  }

  /* ---------- 摆动顶/底 → 笔序列（缠论"笔"） ---------- */
  // tops/bots: [{i, p, top}] 混合序列 → 合并成顶底交替的笔端点
  function toBis(tops, bots) {
    var all = tops.concat(bots).sort(function (a, b) { return a.i - b.i; });
    var f = [], lastTop = null;
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (!f.length) { f.push(c); lastTop = c.top; continue; }
      if (c.top === lastTop) {                        // 同向 → 取更极端
        var last = f[f.length - 1];
        if ((c.top && c.p >= last.p) || (!c.top && c.p <= last.p)) f[f.length - 1] = c;
        continue;
      }
      f.push(c);
      lastTop = c.top;
    }
    return f;
  }

  /* ---------- 笔斜率与夹角（1:1 移植 C++ signal_chan.cpp） ---------- */
  // C++ 口径:
  //   笔 q = bis[q-1] → bis[q]（端点序列，顶底交替）
  //   斜率 sl = |(Δp/p) / Δbars|                 （每根的相对变化）
  //   kScale = tan(25°) / median(sl)             （跨周期角度口径一致）
  //   夹角 = |atan(ka) - atan(kb)| （度），ka = (Δp/p)/Δbars * kScale
  function angleModel(bis) {
    if (!bis || bis.length < 5) return { kScale: 0, angleAt: function () { return 0; } };
    var sl = [], q;
    for (q = 1; q < bis.length; q++) {                 // 每一"笔" = 端点 q-1 → q
      var dx = Math.max(1, bis[q].i - bis[q - 1].i);
      var dy = (bis[q].p - bis[q - 1].p) / Math.max(1e-9, Math.abs(bis[q - 1].p));
      sl.push(Math.abs(dy / dx));
    }
    sl.sort(function (a, b) { return a - b; });
    var med = sl[sl.length >> 1];
    var kScale = (med > 1e-12) ? TAN25 / med : 0;
    // angleAt(pi): 笔 pi 与 笔 pi+1 在公共端点处的夹角
    function angleAt(pi) {
      if (kScale <= 0) return 0;
      if (pi < 0 || pi + 2 > bis.length - 1 + 1) return 0;
      if (pi + 1 >= bis.length) return 0;
      var a = bis[pi], b = bis[pi + 1];
      // 笔 pi：bis[pi-1] → bis[pi]（若 pi=0 则退化为 bis[0] → bis[1]）
      var a0 = (pi > 0) ? bis[pi - 1] : bis[0];
      var xa = Math.max(1, a.i - a0.i), xb = Math.max(1, b.i - a.i);
      var ya = (a.p - a0.p) / Math.max(1e-9, Math.abs(a0.p));
      var yb = (b.p - a.p) / Math.max(1e-9, Math.abs(a.p));
      var ka = ya / xa * kScale, kb = yb / xb * kScale;
      return Math.abs(Math.atan(ka) - Math.atan(kb)) * 57.29577951308232;
    }
    return { kScale: kScale, angleAt: angleAt };
  }

  /* ---------- 买卖信号：缠论交叉 + 笔夹角 < 60° ---------- */
  // 口径（1:1 移植 cpp/signal/signal_chan.cpp + 用户"要缠论交叉"要求）：
  //   ① 笔序列 bis[0..n]：笔 k = bis[k-1] → bis[k]（顶底交替）
  //      信号在笔 k 的【终点】bis[k]：
  //        笔 k 下跌(绿) → 终点是底 → 夹角朝上 = 买(+1)
  //        笔 k 上涨(红) → 终点是顶 → 夹角朝下 = 卖(-1)
  //   ② 夹角：|atan(ka)-atan(kb)| < cs_angle_max(60°)，太陡的暴力V型不发
  //   ③ 大笔过滤(cs_bf_*)：大级别笔额外要求跨度 >= bfDur(40根 / NQ 12根)
  //      小级别笔豁免跨度，但要求反向笔振幅 >= 本笔 × small_move(0.12)
  //      大级别笔要求反向笔振幅 >= 本笔 × big_move(0.382) 且绝对幅度 >= 1.2%
  //   ④ 必须在缠论线【交叉】处（交叉点离笔终点 <= tol 根）
  //   ⑤ 同向去重：minGap 根内同向只留更极端的一个
  // 返回 [{i, p, dir, ang, cv}] dir>0 买 / dir<0 卖
  function signalsAtCrossings(bis, crossIdx, opt) {
    opt = opt || {};
    var maxAngle = ((opt.maxAngle === null || opt.maxAngle === undefined)) ? ANGLE_MAX : opt.maxAngle;
    var bfDur = opt.bfDur || 0;            // 大笔跨度下限(0=不启用)
    var minGap = ((opt.minGap === null || opt.minGap === undefined)) ? 0 : opt.minGap;
    var tol = ((opt.tol === null || opt.tol === undefined)) ? 8 : opt.tol;   // 交叉点与笔终点的最大距离(根)
    var bigRatio = ((opt.bigRatio === null || opt.bigRatio === undefined)) ? 1.2 : opt.bigRatio;   // cs_big_ratio
    var bigLookback = ((opt.bigLookback === null || opt.bigLookback === undefined)) ? 30 : opt.bigLookback;
    var bigMove = ((opt.bigMove === null || opt.bigMove === undefined)) ? 0.382 : opt.bigMove;   // cs_big_move
    var smallMove = ((opt.smallMove === null || opt.smallMove === undefined)) ? 0.12 : opt.smallMove; // cs_small_move
    var bigMovePct = ((opt.bigMovePct === null || opt.bigMovePct === undefined)) ? 0.012 : opt.bigMovePct;
    var out = [];
    if (!bis || bis.length < 5) return out;
    var am = angleModel(bis);
    if (am.kScale <= 0) return out;
    var crosses = (crossIdx || []).slice().sort(function (a, b) { return a - b; });
    if (!crosses.length) return out;
    function nearestCross(i) {
      var lo = 0, hi = crosses.length - 1, best = -1, bestD = Infinity;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        var d = Math.abs(crosses[mid] - i);
        if (d < bestD) { bestD = d; best = crosses[mid]; }
        if (crosses[mid] < i) lo = mid + 1; else hi = mid - 1;
      }
      return (best >= 0 && bestD <= tol) ? best : -1;
    }
    // 笔振幅（C++ bi_extent = |endVal-beginVal| 绝对价差；比值比较用相对值等价）
    var amps = [], ampsAbs = [], k;
    for (k = 1; k < bis.length; k++) {
      ampsAbs.push(Math.abs(bis[k].p - bis[k - 1].p));
      amps.push(ampsAbs[k - 1] / Math.max(1e-9, Math.abs(bis[k - 1].p)));
    }
    // 大级别笔判定：本笔振幅 >= bigRatio × 近 bigLookback 笔振幅中位数
    var penBig = [];
    for (k = 1; k < bis.length; k++) {
      var from = Math.max(1, k - bigLookback);
      var win = amps.slice(from - 1, k);
      if (!win.length) { penBig.push(false); continue; }
      var sorted = win.slice().sort(function (a, b) { return a - b; });
      var med = sorted[sorted.length >> 1];
      penBig.push(med > 1e-12 && amps[k - 1] >= med * bigRatio);
    }
    for (var pi = 1; pi + 1 < bis.length; pi++) {
      var b0 = bis[pi - 1], b1 = bis[pi], b2 = bis[pi + 1];
      var ampN = amps[pi - 1];                       // 本笔振幅(相对)
      var ampR = Math.abs((b2.p - b1.p) / Math.max(1e-9, Math.abs(b1.p)));  // 反向笔振幅(相对)
      if (ampN <= 0) continue;
      var isBig = penBig[pi - 1];
      if (isBig) {
        if (ampR < ampN * bigMove) continue;          // 反向笔不够强 → 小趋势
        // 绝对幅度下限（C++: ampN_abs < endVal * bigMovePct）
        if (ampsAbs[pi - 1] < Math.abs(b1.p) * bigMovePct) continue;
        if (bfDur > 0 && (b1.i - b0.i) < bfDur) continue;  // 大笔跨度下限
      } else {
        if (ampR < ampN * smallMove) continue;        // 反向不足 → 毛刺
      }
      // 方向：笔 pi 下跌 → 终点是底 → 买；上涨 → 终点是顶 → 卖
      var down = b1.p < b0.p;
      var side = down ? 1 : -1;
      // 夹角（转角处）
      var ang = am.angleAt(pi);
      if (!(ang < maxAngle)) continue;               // 夹角太陡(暴力V型) → 不发
      // 必须落在缠论线交叉处
      var ci = nearestCross(b1.i);
      if (ci < 0) continue;
      out.push({ i: ci, p: b1.p, dir: side, ang: ang, cv: 1 });
    }
    // 同向去重：minGap 根内同向只留更极端的一个（买=更低低 / 卖=更高高）
    if (minGap > 0) {
      var keep = [], lastDir = 0, lastIdx = -1e9;
      for (var q = 0; q < out.length; q++) {
        var s = out[q];
        if (s.dir === lastDir && (s.i - lastIdx) < minGap) {
          var prevS = keep[keep.length - 1];
          if ((s.dir > 0 && s.p < prevS.p) || (s.dir < 0 && s.p > prevS.p)) keep[keep.length - 1] = s;
          continue;
        }
        keep.push(s); lastDir = s.dir; lastIdx = s.i;
      }
      out = keep;
    }
    return out;
  }

  /* ---------- 找两条线的交叉点下标 ---------- */
  // a/b: 等长数组；返回 [{i, dir}] dir>0 = a 上穿 b(金叉) / dir<0 = 下穿(死叉)
  function crossings(a, b, from, to) {
    var out = [];
    from = from || 0; to = ((to === null || to === undefined)) ? (a.length - 1) : to;
    for (var i = Math.max(1, from); i <= to; i++) {
      var p0 = a[i - 1] - b[i - 1], p1 = a[i] - b[i];
      if (!isFinite(p0) || !isFinite(p1)) continue;
      if (p0 <= 0 && p1 > 0) out.push({ i: i, dir: 1 });
      else if (p0 >= 0 && p1 < 0) out.push({ i: i, dir: -1 });
    }
    return out;
  }

  /* ---------- 周期自适应: 极值确认窗口 revBars / 大笔跨度下限 bfDur ---------- */
  //   1:1 移植 cpp/signal/signal_chan.cpp：
  //     revBars 按K线中位间隔(分钟)分档 1m:400 5m:200 15m:150 1h:100 1d:45 1w/1mo:30
  //     大笔跨度 dmin = bfDur(绝对) 或 revBars × cs_bf_dur_ratio(0.3)
  //   ★周线/月线用固定 40 根会把信号全过滤掉(40周/40月不可能) → 必须按周期自适应
  function revBarsForTimes(ts) {
    var n = ts ? ts.length : 0;
    if (n < 20) return 100;
    var dts = [];
    for (var i = 1; i < n; i++) { var d = ts[i] - ts[i - 1]; if (d > 0) dts.push(d); }
    if (!dts.length) return 100;
    dts.sort(function (a, b) { return a - b; });
    var mins = dts[dts.length >> 1] / 60000;
    if (mins <= 1.6) return 400;
    if (mins <= 6.5) return 200;
    if (mins <= 20) return 150;
    if (mins <= 70) return 100;
    if (mins <= 300) return 45;
    return 30;
  }
  function bfDurForTimes(ts, explicit) {
    if ((explicit !== null && explicit !== undefined) && explicit !== '' && +explicit > 0) return Math.round(+explicit);
    return Math.max(4, Math.round(revBarsForTimes(ts) * 0.3));
  }

  /* ============================================================
   * ★2026-10-24 用户新规: 买卖信号 = MACD 的 DIF/DEA
   *   ① 取【最近两根】K线, 把 DIF 线与 DEA 线各画一条【向右延长虚线】
   *      (斜率取这两根的实际变化率)
   *   ② 两条虚线在前方【交叉】的那个点 —— 就是 DIF 与 DEA 变得"相同"的地方:
   *        向上开口(交叉点处 DIF 在 DEA 上方) = 买
   *        向下开口(交叉点处 DEA 在 DIF 上方) = 卖
   *      交叉角必须 < 40°
   *   ③ 其它买卖信号一律不要(缠论一买/一卖、60°夹角信号已全部移除)
   *
   * 逐点回放: 对历史上每一根都按同一规则算一次 → 前面一个月/几天的信号都能出来
   * 返回 {sigs:[{i(基准下标), x(交点逻辑下标), p(交点价), dir, ang, t}], base, lines}
   * ============================================================ */
  function macdCrossSignals(bars, opt) {
    opt = opt || {};
    var n = bars ? bars.length : 0;
    var maxAngle = ((opt.maxAngle === null || opt.maxAngle === undefined)) ? 40 : opt.maxAngle;
    var minGap = ((opt.minGap === null || opt.minGap === undefined)) ? 20 : opt.minGap;   // 两个信号最小间隔(根)
    var maxAhead = ((opt.maxAhead === null || opt.maxAhead === undefined)) ? 60 : opt.maxAhead; // 交点最多投影到基准点之后多少根
    var out = { sigs: [], base: null, lines: null };
    if (n < 40) return out;
    var closes = bars.map(function (b) { return b.c; });
    var L = clLines(closes, 12, 26, 9);
    var F = L.f, S = L.s;                    // 价格尺上的 DIF 线 / DEA 线
    out.lines = L;
    // 逐点回放: i = 基准(最近两根中的后一根); 斜率取 i-1 → i
    var sigs = [], lastIdx = -1e9;
    for (var i = 34; i < n - 1; i++) {
      var kF = F[i] - F[i - 1];              // DIF 线斜率(价格/根)
      var kS = S[i] - S[i - 1];              // DEA 线斜率
      if (!isFinite(kF) || !isFinite(kS)) continue;
      var den = kF - kS;
      if (Math.abs(den) < 1e-12) continue;   // 平行 → 不交叉
      // 交点: F(i)+kF*(x-i) = S(i)+kS*(x-i)  →  x = i + (S[i]-F[i])/den
      var xi = i + (S[i] - F[i]) / den;
      if (!(xi > i + 0.5)) continue;          // 交点必须在基准点右侧
      if (xi > i + maxAhead) continue;        // 投影太远 → 不可信
      // 夹角: 相对斜率 × kScale 标定(与 latest signal_chan.cpp 同口径)
      var kS2 = angleScale(F, S, closes, i);
      var pxi = closes[i] > 0 ? closes[i] : 1;
      var a1 = (kF / pxi) * kS2, a2 = (kS / pxi) * kS2;
      var ang = Math.abs(Math.atan(a1) - Math.atan(a2)) * 57.29577951308232;
      if (!(ang < maxAngle)) continue;        // 夹角太大(太陡的V型) → 不发
      if (i - lastIdx < minGap) continue;     // 与上一个信号间隔太小 → 跳过
      // 交点处谁在上: x 增大时 F 相对 S 的差 = (F-S) + (kF-kS)*(x-i) → 正则 F(DIF)在上
      var diffAt = (F[i] - S[i]) + den * (xi - i);
      var dir = diffAt > 0 ? 1 : -1;           // 向上开口=买 / 向下开口=卖
      var pAt = F[i] + kF * (xi - i);
      sigs.push({ i: i, x: xi, p: pAt, dir: dir, ang: ang, t: bars[i].t, base: i,
        f: F[i], s: S[i], kf: kF, ks: kS });
      lastIdx = i;
    }
    if (!sigs.length) return out;
    sigs.reverse();                          // 最近的排前面
    out.sigs = sigs;
    out.base = { i: sigs[0].i, i2: sigs[0].i + 1, f: sigs[0].f, s: sigs[0].s, kf: sigs[0].kf, ks: sigs[0].ks, x: sigs[0].x, ang: sigs[0].ang, ok: true };
    return out;
  }
  // 角度标定 kScale = tan(25°)/中位相对斜率(与 latest signal_chan.cpp 同口径)
  function angleScale(F, S, closes, upto) {
    var sl = [], i, q;
    for (i = Math.max(1, upto - 200); i < Math.min(F.length, upto + 1); i++) {
      var px = closes[i] > 0 ? closes[i] : 1;
      var a = Math.abs((F[i] - F[i - 1]) / px);
      var b = Math.abs((S[i] - S[i - 1]) / px);
      sl.push(a); sl.push(b);
    }
    if (!sl.length) return 1;
    sl.sort(function (x, y) { return x - y; });
    var med = sl[sl.length >> 1];
    return (med > 1e-12) ? (0.46630765815 / med) : 1;
  }

  global.ChanCore = {
    emaOf: emaOf,
    clLines: clLines,
    pivots: pivots,
    extend: extend,
    splitExt: splitExt,
    dirRuns: dirRuns,
    toBis: toBis,
    angleModel: angleModel,
    signalsAtCrossings: signalsAtCrossings,
    crossings: crossings,
    revBarsForTimes: revBarsForTimes,
    bfDurForTimes: bfDurForTimes,
    macdCrossSignals: macdCrossSignals,
    COL_UP: COL_UP,
    COL_DN: COL_DN,
    WIDTH_FAST: WIDTH_FAST,
    WIDTH_SLOW: WIDTH_SLOW,
    ANGLE_MAX: ANGLE_MAX,
    PIV_WIN: CL_PIV_WIN,
    PIV_MINMOVE: CL_PIV_MINMOVE
  };
  // Node 端(require)也能拿到同一套算法 → 前后端口径完全一致
  if (typeof module !== 'undefined' && module.exports) module.exports = global.ChanCore;
})(typeof window !== 'undefined' ? window : globalThis);
