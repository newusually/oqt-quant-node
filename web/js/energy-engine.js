/* ============================================================================
 * web/js/energy-engine.js —— ★可热插拔的能量引擎（2026-11-03）
 * ----------------------------------------------------------------------------
 * 用户指定的能量公式（本文件唯一能量组件 seg-ec）：
 *   段速度  c_seg = (P₁ − P₀) / P₀ ÷ Δt     ← 段相对涨幅 / 时长
 *   段质量  m_seg = mean(V_段) / mean(V_全)
 *   段能量  E_seg = m_seg · (c_seg × 10000)²
 *
 * ★「段」的来源：共享缠论组件 global.Chan.segments()（MACD分区极值 + 连续划线）
 *   —— 能量组件以缠论为基准划分段，段能量按段内每根 K 线摊平 → 得到逐根能量序列 E，
 *      供「MACD(12/26/60，标的=能量E)」副图使用。
 *
 * ★热插拔：任何脚本可 EnergyEngines.register({id,name,desc,compute}) 注入新模型；
 *   EnergyEngines.use(id) 即时切换（无刷新、无重启），localStorage 持久化。
 *   暴露：global.EnergyEngines = { register, unregister, list, use, current, currentId,
 *                                   setParam, getParams, onChange, offChange }
 * ========================================================================== */
(function (global) {
  'use strict';

  var RED = '#f0334b', GREEN = '#0bbf7a';

  /* ================================================================ 工具 */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function tsOf(b) { return (b.t != null) ? b.t : b.ts; }

  /* Δt 单位 → 毫秒 */
  var UNIT_MS = { 'ms': 1, 's': 1000, 'min': 60000, 'm': 60000, 'h': 3600000, 'H': 3600000, 'd': 86400000, 'D': 86400000 };

  /* ================================================================ 基础数据抽取 */
  function base(bars) {
    var n = (bars && bars.length) ? bars.length : 0;
    var ts = new Array(n), c = new Array(n), v = new Array(n), meanV = 0;
    for (var i = 0; i < n; i++) {
      var b = bars[i];
      ts[i] = tsOf(b);
      c[i] = +b.c;
      var vv = (b.v == null || !isFinite(+b.v)) ? 0 : +b.v;
      v[i] = vv;
      meanV += vv;
    }
    meanV = n ? meanV / n : 0;
    if (!(meanV > 0)) meanV = 1;         // 无成交量数据时质量恒为 1（不虚增）
    return { n: n, ts: ts, c: c, v: v, meanV: meanV };
  }

  /* ================================================================ 段来源 */
  /* 优先用共享缠论组件；未加载时降级为 ZigZag 交替极值段（保证组件可独立使用） */
  function getSegs(bars, opt) {
    if (global.Chan && typeof global.Chan.segments === 'function') {
      try {
        var r = global.Chan.segments(bars, opt && opt.chanOpt);
        if (r && r.segs && r.segs.length) return { segs: r.segs, pts: r.pts || [], source: 'chan' };
      } catch (e) { }
    }
    return { segs: fallbackSegs(bars), pts: [], source: 'zigzag' };
  }

  /* 降级段划分：ZigZag（幅度阈值 = 1%）交替极值 */
  function fallbackSegs(bars) {
    var n = (bars && bars.length) ? bars.length : 0;
    var segs = [], pts = [];
    if (n < 3) return segs;
    var thr = 0.01, dir = 0, extI = 0, extP = +bars[0].c;
    for (var i = 1; i < n; i++) {
      var c = +bars[i].c;
      if (dir >= 0 && c > extP) { extP = c; extI = i; }
      if (dir <= 0 && c < extP) { extP = c; extI = i; }
      var chg = dir >= 0 ? (c / extP - 1) : (extP / c - 1);
      if (Math.abs(chg) >= thr) {
        pts.push({ i: extI, type: dir >= 0 ? 'T' : 'B', px: extP });
        dir = dir >= 0 ? -1 : 1;
        extP = c; extI = i;
      }
    }
    pts.push({ i: extI, type: dir >= 0 ? 'T' : 'B', px: extP });
    for (var k = 1; k < pts.length; k++) {
      var a = pts[k - 1], b = pts[k];
      if (b.i <= a.i) continue;
      var d = (b.px > a.px) ? 1 : (b.px < a.px ? -1 : 0);
      if (!d) continue;
      segs.push({ i0: a.i, i1: b.i, dir: d, fromType: a.type, toType: b.type, px0: a.px, px1: b.px, brk: false, open: false, bars: b.i - a.i, amp: +((b.px / a.px - 1) * 100).toFixed(2) });
    }
    return segs;
  }

  /* ================================================================ 定积分面积（辅助量）
   * S = ∫(P/MA − 1) dt  —— 价差面积（无量纲 %·h，符号=方向）。不是能量本身。 */
  function areaSeries(c, ts, n) {
    var maWin = clamp(Math.round(n / 20), 10, 240);
    var ma = new Array(n), run = 0;
    for (var i = 0; i < n; i++) {
      run += c[i];
      if (i >= maWin) run -= c[i - maWin];
      ma[i] = run / Math.min(i + 1, maWin);
    }
    var cum = new Array(n); cum[0] = 0;
    for (i = 1; i < n; i++) {
      var dt = (ts[i] - ts[i - 1]);
      if (!(dt > 0) || dt > 86400000 * 8) dt = 3600000;
      var h = dt / 3600000;
      var rel = ma[i] ? (c[i] - ma[i]) / ma[i] : 0;
      var relP = ma[i - 1] ? (c[i - 1] - ma[i - 1]) / ma[i - 1] : 0;
      cum[i] = cum[i - 1] + (rel + relP) * 0.5 * h;
    }
    return { ma: ma, maWin: maWin, cum: cum };
  }

  /* ================================================================ 背驰（能量衰减）
   *   ★缠论段方向天然交替(顶→底→顶→底) → 「同向三段」永不成立, 必须比较【相邻同向段】:
   *     segs[i] 与 segs[i-2] 方向相同(i-1 是反向段)。
   *   顶背驰: X 向上 且 X.px1 > A.px1(创新高) 且 X.E < A.E(能量衰减)
   *   底背驰: X 向下 且 X.px1 < A.px1(创新低) 且 X.E < A.E(能量衰减)
   *   三段强背驰(可选): 同向第 i 段与 i-4 段比, 且 E 同时低于中间两段 → 标注「强背驰」
   *   ★用缠论段端点价(px1)比较创新高/低, 不用K线收盘价 —— 收盘价不含极值, 会漏判。 */
  function divergences(segs) {
    var divs = [];
    for (var i = 2; i < segs.length; i++) {
      var X = segs[i], A = segs[i - 2];            // 方向必然相同
      if (X.dir !== A.dir) continue;
      var higher = (X.dir > 0)
        ? (X.px1 > A.px1 && X.E < A.E)
        : (X.px1 < A.px1 && X.E < A.E);
      if (!higher) continue;
      var strong = false;
      if (i >= 4) {
        var B = segs[i - 4];
        if (B.dir === X.dir && X.E < Math.min(A.E, B.E)) strong = true;
      }
      divs.push({
        idx: X.i1, dir: X.dir, segIdx: i,
        type: (X.dir > 0 ? '顶背驰' : '底背驰') + (strong ? '·强' : ''),
        eNow: X.E, ePrev: A.E, px: X.px1, pxPrev: A.px1
      });
    }
    return divs;
  }

  /* ================================================================ 涨跌强弱判定
   *   净能量  S_net = Σ E_seg(向上) − Σ E_seg(向下)
   *   方向一致性 z = S_net / Σ E_seg            ∈ [-1, +1]
   *   判定：z ≥ 0.2 → 偏涨；z ≤ −0.2 → 偏跌；否则震荡
   */
  function strength(segs) {
    var eu = 0, ed = 0, tot = 0;
    for (var i = 0; i < segs.length; i++) {
      var e = segs[i].E || 0;
      tot += e;
      if (segs[i].dir > 0) eu += e; else ed += e;
    }
    var net = eu - ed;
    var z = tot > 0 ? net / tot : 0;
    var verdict = (z >= 0.2) ? '偏涨' : (z <= -0.2 ? '偏跌' : '震荡');
    return { net: net, eu: eu, ed: ed, total: tot, z: z, verdict: verdict };
  }

  /* ================================================================ 引擎 seg-ec（唯一能量组件，用户公式）
   *   c_seg = (P₁−P₀)/P₀ ÷ Δt
   *   m_seg = mean(V_段)/mean(V_全)
   *   E_seg = m_seg·(c_seg×10000)²
   */
  function computeSegEC(bars, opt) {
    opt = opt || {};
    var B = base(bars);
    var n = B.n;
    if (n < 12) return { empty: true, n: n, model: 'seg-ec' };

    var dtUnit = opt.dtUnit || getParams().dtUnit || 'h';
    var unitMs = UNIT_MS[dtUnit] || 3600000;

    var S = getSegs(bars, opt);
    var segs = S.segs;

    /* 逐根能量序列（段能量摊平到段内每根） */
    var E = new Array(n).fill(0);
    var cSeg = new Array(n).fill(0);
    var mSeg = new Array(n).fill(0);
    var segOwner = new Array(n).fill(-1);

    for (var k = 0; k < segs.length; k++) {
      var sg = segs[k];
      var i0 = Math.max(0, sg.i0), i1 = Math.min(n - 1, sg.i1);
      if (i1 < i0) continue;
      var P0 = +sg.px0, P1 = +sg.px1;
      if (!isFinite(P0) || !isFinite(P1) || P0 <= 0) continue;

      /* Δt：段首尾 K 线时间差（按所选单位换算），至少 1 个单位避免除零 */
      var t0 = B.ts[i0], t1 = B.ts[i1];
      var dtRaw = (isFinite(t0) && isFinite(t1) && t1 > t0) ? (t1 - t0) : 0;
      var dt = dtRaw / unitMs;
      if (!(dt > 0)) dt = 1;

      /* 段速度 c_seg = 相对涨幅 ÷ 时长 */
      var cSegV = ((P1 - P0) / P0) / dt;

      /* 段质量 m_seg = mean(V_段) / mean(V_全) */
      var sum = 0, cnt = 0;
      for (var j = i0; j <= i1; j++) { sum += B.v[j]; cnt++; }
      var mSegV = cnt ? (sum / cnt) / B.meanV : 1;

      /* 段能量 E_seg = m_seg · (c_seg×10000)² */
      var ESegV = mSegV * Math.pow(cSegV * 10000, 2);

      sg.cSeg = cSegV; sg.mSeg = mSegV; sg.E = ESegV;
      sg.dt = dt; sg.dtRaw = dtRaw; sg.i0 = i0; sg.i1 = i1;

      /* ★段能量摊平到段内每根: 区间 [i0, i1-1]（段末点归下一段, 避免段间重叠）,
       *   最后一段摊到 n-1 → 全序列每根都有能量值, 且段内恒定。 */
      var jEnd = (k === segs.length - 1) ? i1 : (i1 - 1);
      if (jEnd < i0) jEnd = i0;
      for (j = i0; j <= jEnd; j++) { E[j] = ESegV; cSeg[j] = cSegV; mSeg[j] = mSegV; segOwner[j] = k; }
    }

    var A = areaSeries(B.c, B.ts, n);
    var divs = divergences(segs);
    var st = strength(segs);

    return {
      empty: false, n: n, model: 'seg-ec', modelName: '段级 E=mc²',
      ts: B.ts, c: B.c, v: B.v, meanV: B.meanV,
      E: E, cSeg: cSeg, mSeg: mSeg, segOwner: segOwner,
      cum: A.cum, ma: A.ma, maWin: A.maWin,
      segs: segs, divs: divs,
      segSource: S.source, dtUnit: dtUnit,
      net: st.net, eu: st.eu, ed: st.ed, z: st.z, score: st.z, verdict: st.verdict,
      eLast: n ? E[n - 1] : 0,
      formula: 'c_seg=(P₁−P₀)/P₀÷Δt ; m_seg=mean(V段)/mean(V全) ; E_seg=m_seg·(c_seg×10000)²'
    };
  }

    /* ================================================================ 唯一能量组件：seg-ec（用户公式，段级 E=mc²）
   *   ★本文件只保留这一个能量模型；旧「逐根 E=mc²」对照模型已移除，杜绝双公式并存。
   *   ★将来换/加公式：EnergyEngines.register({id,name,desc,compute}) 注入 → EnergyEngines.use(id)
   *     全站副图自动热插拔重算（无需刷新/重启，localStorage 持久化）。 */


  /* ================================================================ 引擎注册表（热插拔核心） */
  var engines = {};
  var order = [];
  var currentId = 'seg-ec';
  var params = { dtUnit: 'h' };
  var listeners = [];

  function register(eng) {
    if (!eng || !eng.id || typeof eng.compute !== 'function') return null;
    if (!engines[eng.id]) order.push(eng.id);
    engines[eng.id] = eng;
    if (eng.default) currentId = eng.id;
    return eng;
  }
  function unregister(id) {
    if (!engines[id]) return false;
    delete engines[id];
    order = order.filter(function (x) { return x !== id; });
    if (currentId === id) currentId = order[0] || 'seg-ec';
    fire();
    return true;
  }
  function list() {
    return order.map(function (id) {
      var e = engines[id];
      return { id: e.id, name: e.name || e.id, desc: e.desc || '', formula: e.formula || '' };
    });
  }
  function current() { return engines[currentId] || engines[order[0]]; }
  function currentId_() { return currentId; }
  function use(id) {
    if (!engines[id]) return currentId;
    currentId = id;
    try { if (global.localStorage) global.localStorage.setItem('oqt.energy.model', id); } catch (e) { }
    fire();
    return currentId;
  }
  function compute(bars, opt) {
    var e = current();
    if (!e) return { empty: true, n: 0 };
    try { return e.compute(bars, opt || {}); }
    catch (err) { return { empty: true, n: 0, err: String(err && err.message || err) }; }
  }
  function getParams() { return params; }
  function setParam(k, v) {
    if (!k) return params;
    if (typeof k === 'object') { for (var kk in k) setParam(kk, k[kk]); return params; }
    if (k === 'dtUnit') {
      var u = String(v || 'h');
      params.dtUnit = UNIT_MS[u] ? u : 'h';
      try { if (global.localStorage) global.localStorage.setItem('oqt.energy.params', JSON.stringify(params)); } catch (e) { }
      fire();
    }
    return params;
  }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function offChange(fn) { listeners = listeners.filter(function (x) { return x !== fn; }); }
  function fire() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](currentId, getParams()); } catch (e) { } } }

  /* 初始：读 localStorage 恢复上次选择 */
  (function init() {
    try {
      var m = global.localStorage && global.localStorage.getItem('oqt.energy.model');
      if (m && m !== currentId && engines[m]) currentId = m;
      var p = global.localStorage && global.localStorage.getItem('oqt.energy.params');
      if (p) { var j = JSON.parse(p); if (j && j.dtUnit && UNIT_MS[j.dtUnit]) params.dtUnit = j.dtUnit; }
    } catch (e) { }
  })();

  /* 内置引擎注册 */
  register({ id: 'seg-ec', name: '段级 E=mc²', desc: '缠论段：c_seg=(P₁−P₀)/P₀÷Δt，m_seg=mean(V段)/mean(V全)，E_seg=m_seg·(c_seg×10000)²', compute: computeSegEC, default: true, formula: 'E_seg = m_seg · (c_seg×10000)²' });

  global.EnergyEngines = {
    register: register, unregister: unregister, list: list,
    use: use, current: current, currentId: currentId_,
    compute: compute,
    getParams: getParams, setParam: setParam,
    onChange: onChange, offChange: offChange,
    units: Object.keys(UNIT_MS),
    RED: RED, GREEN: GREEN
  };
})(typeof window !== 'undefined' ? window : globalThis);
