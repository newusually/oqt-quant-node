// M8 modules/okx/web/ind-engine.js · 自研 Canvas K线图(零依赖)
//   忠实移植原 astock web/assets/app.js 的 drawKline(2026-10-23 最终规格):
//   蜡烛K线 + 多主图指标(MA/EMA/BOLL/Donchian/SAR/缠论) + 缠论光滑上下轨(Catmull-Rom)
//   + 最近10根最高(绿)/最低(红) + 斐波那契虚线 + 买卖点(买红火箭下/卖绿叶子上) +
//   成交量 + 副图(MACD/KDJ/RSI/WR/CCI/OBV/ATR) + 十字光标/拖动/滚轮翻页/双击复位。
//   中国惯例: 涨=红 跌=绿。无未来函数(缠论摆动点需右侧 PW 根确认)。
'use strict';
(function (global) {
  /* ---------------- 格式化 ---------------- */
  function fmt(v, d) { if (d === undefined) d = 2; return Number(v).toFixed(d); }
  // 价格自适应小数: |v|>=1→2位, >=0.01→4位, >=0.0001→6位, 否则8位
  function fp(v) {
    v = Number(v);
    if (v === 0) return '0.00';
    const a = Math.abs(v);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(4);
    if (a >= 0.0001) return v.toFixed(6);
    return v.toFixed(8);
  }
  function volTxt(v) {
    v = Number(v);
    if (v >= 1e8) return fmt(v / 1e8, 2) + '亿';
    if (v >= 1e4) return fmt(v / 1e4, 2) + '万';
    return fmt(v, 0);
  }
  function toMs(t) { const n = Number(t); if (!isFinite(n) || n <= 0) return NaN; return n < 1e11 ? n * 1000 : n; }
  function normBars(bars) {
    const out = [], seen = new Map();
    (bars || []).forEach(raw => {
      if ((raw === null || raw === undefined)) return;
      const b = Array.isArray(raw) ? { t: raw[0], o: raw[1], h: raw[2], l: raw[3], c: raw[4], v: raw[5] } : raw;
      if ((b === null || b === undefined) || (b.t === null || b.t === undefined)) return;
      const prev = seen.get(b.t);
      if (!prev) { seen.set(b.t, b); out.push(b); return; }
      if ((+b.v || 0) > (+prev.v || 0)) { prev.o = b.o; prev.h = b.h; prev.l = b.l; prev.c = b.c; prev.v = b.v; }
    });
    return out;
  }
  function tsTxt(t) {
    const d = new Date(toMs(t));
    if (isNaN(d.getTime())) return '-';
    const p = n => (n < 10 ? '0' : '') + n;
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function dateTxt(t) {
    const d = new Date(toMs(t));
    if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------------- 矢量图标: 火箭(买) / 绿叶(卖) ---------------- */
  function drawRocket(c, px, py, s) {
    c.save(); c.translate(px, py);
    c.fillStyle = '#ffa722';
    c.beginPath(); c.moveTo(-s * 0.30, s * 0.55); c.lineTo(0, s * 1.45); c.lineTo(s * 0.30, s * 0.55); c.closePath(); c.fill();
    c.fillStyle = '#d92b2b';
    c.beginPath(); c.moveTo(-s * 0.40, s * 0.12); c.lineTo(-s * 0.92, s * 0.72); c.lineTo(-s * 0.36, s * 0.64); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(s * 0.40, s * 0.12); c.lineTo(s * 0.92, s * 0.72); c.lineTo(s * 0.36, s * 0.64); c.closePath(); c.fill();
    c.fillStyle = '#ff3b30';
    c.beginPath();
    c.moveTo(0, -s * 1.05);
    c.quadraticCurveTo(s * 0.50, -s * 0.15, s * 0.42, s * 0.60);
    c.lineTo(-s * 0.42, s * 0.60);
    c.quadraticCurveTo(-s * 0.50, -s * 0.15, 0, -s * 1.05);
    c.closePath(); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(0, -s * 0.28, s * 0.20, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  function drawLeaf(c, px, py, s) {
    c.save(); c.translate(px, py);
    c.fillStyle = '#0bbf7a';
    c.beginPath();
    c.moveTo(-s * 0.55, s * 0.55);
    c.quadraticCurveTo(-s * 0.80, -s * 0.45, s * 0.55, -s * 0.50);
    c.quadraticCurveTo(s * 0.85, s * 0.45, -s * 0.55, s * 0.55);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.85)';
    c.lineWidth = Math.max(1, s * 0.11);
    c.beginPath(); c.moveTo(-s * 0.48, s * 0.45); c.lineTo(s * 0.46, -s * 0.40); c.stroke();
    c.lineWidth = Math.max(0.8, s * 0.07);
    c.beginPath(); c.moveTo(-s * 0.08, s * 0.04); c.lineTo(-s * 0.30, -s * 0.28); c.stroke();
    c.beginPath(); c.moveTo(s * 0.16, -s * 0.14); c.lineTo(s * 0.00, s * 0.18); c.stroke();
    c.restore();
  }

  /* ---------------- Canvas K线图 ---------------- */
  // opts: { bars:[{t,o,h,l,c,v}], marks:[{t,dir,price,label}], mainInd, subInd, height, stateKey }
  //   ★2026-11-03 买卖信号(bestSigs / drawBestSignals)与涨跌家数(breadthMap)参数已删除
  /* ---------------- ★2026-10-31i MACD 参数(可编辑 · localStorage 持久化) ---------------- */
  function loadMacdP() {
    var d = { fast: 12, slow: 26, signal: 60 };
    try {
      var s = global.localStorage && global.localStorage.getItem('oqt_macd_params');
      if (s) {
        var j = JSON.parse(s);
        if (j && j.fast > 0 && j.slow > 0 && j.signal > 0) { d.fast = +j.fast; d.slow = +j.slow; d.signal = +j.signal; }
      }
    } catch (e) { }
    return d;
  }
  function saveMacdP(p) { try { if (global.localStorage) global.localStorage.setItem('oqt_macd_params', JSON.stringify(p)); } catch (e) { } }
  var MACD_P = loadMacdP();
  function openMacdEditor(cv, clientX, clientY) {
    try {
      var doc = global.document; if (!doc) return;
      var box = cv.__macdEditor;
      if (!box) {
        box = doc.createElement('div');
        box.style.cssText = 'position:fixed;z-index:99999;background:#101826;border:1px solid #3d7bff;border-radius:8px;padding:10px 12px;font:12px/1.5 sans-serif;color:#dbe4ff;box-shadow:0 8px 30px rgba(0,0,0,.5);width:208px';
        box.innerHTML =
          '<div style="font-weight:600;margin-bottom:6px;color:#9fc0ff">MACD 参数 (快 / 慢 / 信号)</div>' +
          '<label style="display:block;margin:4px 0">快 EMA <input data-k="fast" type="number" min="1" max="500" style="width:64px;margin-left:6px;background:#0a1322;color:#fff;border:1px solid #2b3a5e;border-radius:4px;padding:2px 4px"></label>' +
          '<label style="display:block;margin:4px 0">慢 EMA <input data-k="slow" type="number" min="1" max="500" style="width:64px;margin-left:6px;background:#0a1322;color:#fff;border:1px solid #2b3a5e;border-radius:4px;padding:2px 4px"></label>' +
          '<label style="display:block;margin:4px 0">信号 DEA <input data-k="signal" type="number" min="1" max="500" style="width:64px;margin-left:6px;background:#0a1322;color:#fff;border:1px solid #2b3a5e;border-radius:4px;padding:2px 4px"></label>' +
          '<div style="margin-top:8px;text-align:right"><button data-a="cancel" style="background:#243049;color:#cfe0ff;border:1px solid #2b3a5e;border-radius:4px;padding:3px 10px;cursor:pointer;margin-right:6px">取消</button><button data-a="ok" style="background:#3d7bff;color:#fff;border:none;border-radius:4px;padding:3px 12px;cursor:pointer">保存</button></div>';
        doc.body.appendChild(box);
        box.addEventListener('click', function (ev) {
          var a = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-a');
          if (a === 'cancel') { box.style.display = 'none'; return; }
          if (a === 'ok') {
            var f = +box.querySelector('[data-k="fast"]').value, s = +box.querySelector('[data-k="slow"]').value, g = +box.querySelector('[data-k="signal"]').value;
            if (!(f > 0 && s > 0 && g > 0)) return;
            MACD_P = { fast: f, slow: s, signal: g }; saveMacdP(MACD_P);
            box.style.display = 'none';
            if (cv.__redraw) cv.__redraw();
          }
        });
        cv.__macdEditor = box;
      }
      box.querySelector('[data-k="fast"]').value = MACD_P.fast;
      box.querySelector('[data-k="slow"]').value = MACD_P.slow;
      box.querySelector('[data-k="signal"]').value = MACD_P.signal;
      var x = Math.min(clientX || 80, (global.innerWidth || 1200) - 230);
      var y = Math.min(clientY || 80, (global.innerHeight || 800) - 210);
      box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.display = 'block';
    } catch (e) { }
  }

  var ChanLineCache = null;   // ★2026-11-04 缠论枢轴缓存（bars 不变时复用，避免每次重绘重算）
  function drawKline(cv, opts) {
    /* ★2026-11-08 旧买卖信号开关(toggle)已删除；TradeSignals 改为始终绘制（ind-engine 内 sigOn=true） */
    cv.__qaOpts = opts;
    const dpr = global.devicePixelRatio || 1;
    const W = cv.clientWidth, H = opts.height || 460;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.height = H + 'px';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    /* ★2026-11-04 复用同一份归一化 bars：hover/缩放重绘时不重建数组，
     *   → chanlun / 4 个 MACD 组件的 WeakMap 缓存命中，避免每次鼠标移动全量重算。 */
    const rawBars = opts.bars || [];
    const nRaw = rawBars.length;
    const lastT = nRaw ? (rawBars[nRaw - 1] ? rawBars[nRaw - 1].t : 0) : 0;
    if (!(cv.__barsRaw === rawBars && cv.__barsN === nRaw && cv.__barsLastT === lastT && cv.__barsAll)) {
      cv.__barsAll = normBars(rawBars);
      cv.__barsRaw = rawBars; cv.__barsN = nRaw; cv.__barsLastT = lastT;
    }
    const all = cv.__barsAll;   // ★供 4 个 MACD 共享组件使用（主/副图索引、光标完全一致）
    var macdDif = null, macdDea = null, macdHist = null;   // ★2026-10-31k 暴露给悬浮窗最底行显示 MACD 值
    if (!all.length) {
      ctx.fillStyle = '#8b94ad'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('暂无K线数据(点「补充数据」拉取真实行情)', W / 2, H / 2);
      try { if (global.SubCharts && typeof global.SubCharts.sync === 'function') global.SubCharts.sync(cv); } catch (e) {}
      return;
    }
    const keyNow = opts.stateKey || '';
    if (cv.__kstKey !== keyNow) { cv._kst = null; cv.__kstKey = keyNow; }
    cv.__defVis = (opts.defVis | 0) || 100;   // ★2026-10-29 默认可视根数按分时自适应(3m/5m=240)
    const st = cv._kst || (cv._kst = { off: 0, vis: cv.__defVis, yoff: 0, tail: all.length ? (all[all.length - 1].t | 0) : 0, navAt: 0 });
    // 外部指定视口(KChart 组件用): opts.off / opts.vis 覆盖内部状态
    // ★允许负 off = 拖过最新 K线后右侧留白；旧版 opts.off>=0 会丢掉负值 → 到最右就拖不动
    if (opts.off !== null && opts.off !== undefined) st.off = opts.off | 0;
    const lastSaved = { off: st.off | 0, yoff: +st.yoff || 0, navAt: st.navAt | 0 };
    /* ★2026-10-29 K线懒加载: 历史K线从头部拼入(all[0].t 变小)时 off 同步 +N,
     *   视口钉在用户正在看的K线上, 不因补数据而跳动 */
    if (all.length) {
      if (st.firstT !== undefined && all[0].t < st.firstT) {
        let nPre = 0;
        while (nPre < all.length && all[nPre].t < st.firstT) nPre++;
        /* ★2026-11-03 深度修复(off 锚定方向):
         *   off 的语义 = 「距最新端多少根」。前插 nPre 根历史时, 视口应停在【同一批K线】上,
         *   而 off 是相对最新端的距离, 前插不影响最新端 → off 必须【保持不变】(数组索引自动后移 nPre)。
         *   旧代码写成 st.off += nPre → 方向反了, 后果:
         *     ① 视口被推向最新端(用户以为在左移看历史, 实际在往回跳)
         *     ② startI 恒 <= prefetchAhead → onMore 死循环, 历史被无限拉取
         *     ③ off 持续膨胀(实测 5582 → 17422), 拖回最新需拖 8 万像素 → 「左移回不来」
         *   现改为 off 完全不变(拖拽基点同理)。 */
        /* off 不变 —— 无需补偿 */
      }
      st.firstT = all[0].t;
    }
    const total = all.length;
    // ★可见根数: 外部指定(opts.vis) > 内部缩放状态(st.vis) > 默认(opts.defVis, 3m/5m=240)
    let vis = (opts.vis | 0) > 0 ? (opts.vis | 0) : ((st.vis | 0) > 0 ? (st.vis | 0) : cv.__defVis);
    vis = Math.max(20, Math.min(total, vis));
    st.vis = vis;
    /* ★右侧留白：off 允许为负（最多 rightPadMax 根），拖过最新后继续往右仍能拖动 */
    const rightPadMax = (opts.rightPad == null ? 40 : Math.max(0, +opts.rightPad || 0));
    st.off = Math.max(-rightPadMax, Math.min(total - vis, Math.round(st.off || 0)));
    const rightPad = Math.max(0, -(st.off | 0));
    const endI = total - st.off;
    const startI = Math.max(0, endI - vis);
    if (startI === 0 && st.off > 0 && opts.onMore && total < (opts.maxBars || 3000) && cv.__moreAt !== total) {
      /* ↑旧触发保留兼容(悬浮迷你窗等旧调用); ↓2026-10-29 K线懒加载主逻辑:
       *   视口左沿距已载历史起点 < prefetchAhead(默认200)根 → 自动向前补500根(opts.onMore),
       *   直到数据源头(opts.moreEof)。__moreBusy 防并发, 补完重画后再评估是否继续补。 */
      cv.__moreAt = total;
      try { Promise.resolve(opts.onMore(total)).catch(() => {}); } catch (e) {}
    }
    if (opts.onMore && !opts.moreEof && startI <= ((opts.prefetchAhead | 0) || 200) && !cv.__moreBusy) {
      cv.__moreBusy = true;
      const fin = () => { cv.__moreBusy = false; };
      try { Promise.resolve(opts.onMore(startI)).then(fin, fin); } catch (e) { fin(); }
    }
    const bars = all.slice(startI, endI);
    const ma5 = opts.ma5 ? opts.ma5.slice(startI, endI) : null;
    const ma10 = opts.ma10 ? opts.ma10.slice(startI, endI) : null;
    const ma20 = opts.ma20 ? opts.ma20.slice(startI, endI) : null;
    /* ★2026-11-03 副图已抽为共享组件(SubCharts: MACD[标=能量E] + 能量),
     *   opts.noSub=true 时主图不再自带 vol(成交量) 与 macd 区域, K线占满整块画布。 */
    /* ★2026-11-04 用户定稿：删除主图内嵌成交量/MACD 副图，全站只保留 SubCharts 挂载的 4 个 MACD 副图 */
    const subOn = false;
    const P = { l: 8, r: 62, t: 10, volH: subOn ? 62 : 0, macdH: subOn ? 66 : 0, gap: subOn ? 6 : 0 };
    const mainH = H - P.t - P.volH - P.macdH - P.gap * 2;
    const mainB = P.t + mainH;
    const volT = mainB + P.gap, volB = volT + P.volH;
    const macdT = volB + P.gap, macdB = macdT + P.macdH;
    const plotBottom = subOn ? macdB : mainB;   // 十字光标/选中线纵向终点
    const plotW = W - P.l - P.r;
    /* ★留白也占一格 → K线靠左绘制，右侧空出 rightPad 格，光标在留白区不落在任何 K线上 */
    const bw = plotW / Math.max(1, bars.length + rightPad);
    const cw = Math.max(1, Math.floor(bw * 0.7));
    cv.__total = total; cv.__bw = bw;
    const redrawK = () => { try { if (typeof cv._renderFn === 'function') cv._renderFn(); else drawKline(cv, cv._kopts || opts); } catch (e) {} };
    cv.__geo = { l: P.l, t: P.t, mainH: mainH, bw: bw, startI: startI };
    cv.__vis = { startI: startI, n: bars.length, bw: bw, l: P.l };   // ★光标联动用(闭包外可读)
    cv.__redraw = redrawK;   // ★2026-10-31i 供 MACD 参数编辑后实时重绘

    // ================= 指标计算 =================
    const mainInd = opts.mainInd || 'ma';
    const C = all.map(b => b.c), HH = all.map(b => b.h), LL = all.map(b => b.l), VV = all.map(b => b.v);
    const cut = a => a.slice(startI, endI);
    const maLine = n => { const o = []; let s = 0; for (let i = 0; i < C.length; i++) { s += C[i]; if (i >= n) s -= C[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; };
    const emaLine = n => { const k = 2 / (n + 1); let p = null; return C.map(x => (p = (p === null || p === undefined) ? x : x * k + p * (1 - k))); };
    const bollCalc = (n, m) => {
      const mid = maLine(n), up = [], dn = [];
      for (let i = 0; i < C.length; i++) {
        const mv = mid[i];
        if ((mv === null || mv === undefined)) { up.push(null); dn.push(null); continue; }
        let s = 0; for (let k = i - n + 1; k <= i; k++) s += (C[k] - mv) * (C[k] - mv);
        const sd = Math.sqrt(s / n); up.push(mv + m * sd); dn.push(mv - m * sd);
      }
      return { mid, up, dn };
    };
    const donchian = n => {
      const up = [], dn = [];
      for (let i = 0; i < C.length; i++) {
        if (i < n - 1) { up.push(null); dn.push(null); continue; }
        let h2 = -Infinity, l2 = Infinity;
        for (let k = i - n + 1; k <= i; k++) { h2 = Math.max(h2, HH[k]); l2 = Math.min(l2, LL[k]); }
        up.push(h2); dn.push(l2);
      }
      return { up, dn };
    };
    const sarCalc = (af0, afMax) => {
      const out = []; let up = true, ep = HH[0], sar = LL[0], af = af0;
      for (let i = 0; i < C.length; i++) {
        if (i === 0) { out.push(sar); continue; }
        sar = sar + af * (ep - sar);
        if (up) { if (LL[i] < sar) { up = false; sar = ep; ep = LL[i]; af = af0; } else if (HH[i] > ep) { ep = HH[i]; af = Math.min(afMax, af + af0); } }
        else { if (HH[i] > sar) { up = true; sar = ep; ep = HH[i]; af = af0; } else if (LL[i] < ep) { ep = LL[i]; af = Math.min(afMax, af + af0); } }
        out.push(sar);
      }
      return out;
    };

    const ovMain = {};
    if (mainInd === 'ma') {
      ovMain.ma5 = cut(maLine(5)); ovMain.ma10 = cut(maLine(10));
      ovMain.ma20 = cut(maLine(20)); ovMain.ma60 = cut(maLine(60));
    } else if (mainInd === 'ema') {
      ovMain.e12 = cut(emaLine(12)); ovMain.e26 = cut(emaLine(26));
    } else if (mainInd === 'boll') {
      const b = bollCalc(20, 2); ovMain.up = cut(b.up); ovMain.mid = cut(b.mid); ovMain.dn = cut(b.dn);
    } else if (mainInd === 'donchian') {
      const d = donchian(20); ovMain.up = cut(d.up); ovMain.dn = cut(d.dn);
    } else if (mainInd === 'sar') {
      ovMain.sar = cut(sarCalc(0.02, 0.2));
    }

    // 数值域
    let lo = 1e18, hi = -1e18;
    for (const b of bars) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
    const mav = []; [ma5, ma10, ma20].forEach(m => { if (m) mav.push(m); });
    mav.forEach(m => m.forEach((v, i) => { if (v && bars[i]) { if (v < lo) lo = v; if (v > hi) hi = v; } }));
    Object.keys(ovMain).forEach(k => { const v = ovMain[k]; if (Array.isArray(v)) v.forEach(x => { if (typeof x === 'number' && isFinite(x)) { if (x < lo) lo = x; if (x > hi) hi = x; } }); });
    /* ★2026-11-04 数值域纳入 4 条缠论直线的可见端点，防止直线被裁出画布 */
    try {
      if (global.ChanLun && typeof global.ChanLun.list === 'function') {
        global.ChanLun.list().forEach(L => {
          const pts = global.ChanLun.pivots(all, L.period) || [];
          for (let q = 0; q < pts.length; q++) {
            const p = pts[q];
            if (p.i < startI - 2 || p.i > endI + 2) continue;
            if (isFinite(p.px)) { if (p.px < lo) lo = p.px; if (p.px > hi) hi = p.px; }
          }
        });
      }
    } catch (e) {}
    const pad = (hi - lo) * 0.05 || 1;
    lo -= pad; hi += pad;
    const yShift = Math.max(-mainH * 0.8, Math.min(mainH * 0.8, st.yoff || 0));
    const y = v => P.t + (hi - v) / (hi - lo) * mainH + yShift;
    const x = i => P.l + i * bw + bw / 2;
    cv.__geo.hi = hi; cv.__geo.lo = lo; cv.__geo.yShift = yShift;

    // 网格 + 右侧价格标尺
    ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(38,48,80,.55)'; ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const gy = P.t + mainH * g / 4 + yShift, gv = hi - (hi - lo) * g / 4;
      ctx.beginPath(); ctx.moveTo(P.l, gy); ctx.lineTo(W - P.r, gy); ctx.stroke();
      ctx.fillStyle = '#8b94ad'; ctx.fillText(fp(gv), W - P.r + 5, gy);
    }
    if (subOn) {
      const vMax = Math.max.apply(null, bars.map(b => b.v).concat([1]));
      ctx.fillStyle = '#8b94ad';
      ctx.fillText(volTxt(vMax), W - P.r + 5, volT + 6);
      ctx.fillText('0', W - P.r + 5, volB - 6);
    }

    // 主图: K线 + 指标
    ctx.save();
    ctx.beginPath(); ctx.rect(0, P.t, W, mainH); ctx.clip();
    bars.forEach((b, i) => {
      const up = b.c >= b.o;
      ctx.strokeStyle = ctx.fillStyle = up ? '#f0334b' : '#0bbf7a';
      ctx.beginPath(); ctx.moveTo(Math.round(x(i)), y(b.h)); ctx.lineTo(Math.round(x(i)), y(b.l)); ctx.stroke();
      const yo = y(b.o), yc = y(b.c);
      const top = Math.min(yo, yc), h = Math.max(1, Math.abs(yc - yo));
      ctx.fillRect(Math.round(x(i) - cw / 2), top, cw, h);
    });
    /* ★2026-11-04 用户定稿：主图只保留 K线 + 4 条【纯直线】缠论线（共享组件 chanlun）。
     *   MA5 红实线 / MA20 蓝虚线 / MA30 绿虚线 / MA60 粉虚线；相邻转折点首尾直连，完全直线不弯曲。
     *   原逐根 MA 折线(MA10/20/60)、EMA/BOLL/通道/SAR 等弯曲均线、旧 MA5 连续折线 全部删除。 */
    try {
      if (global.ChanLun && typeof global.ChanLun.draw === 'function') {
        global.ChanLun.draw(ctx, {
          bars: all, startI: startI, endI: endI,
          x: (absIdx) => x(absIdx - startI),      // 传入全量索引 → 主图 x 坐标
          y: (price) => y(price),
          clip: { l: P.l, t: P.t, w: W - P.l - P.r, h: mainH },
          legend: { x: P.l + 2, y: P.t + 12 }
        });
      }
    } catch (e) {}
    /* ★2026-11-04 二轮定稿：共享「买多/卖空」买卖点组件。
     *   MA5 缠论线第一次上穿 MA60 虚线 → 买多(红 15px，K线下方)；
     *   MA5 第一次下穿 MA60 虚线 → 卖空(绿 15px，K线上方)。
     *   挂在 drawKline 主图 → 总览两个 K 线图、所有周期(含分时)自动全部生效。 */
    try {
      /* ★2026-11-08d：去掉买卖信号开关门控 —— 四态标记(买多/卖空/加仓/平仓)默认始终绘制，
       *   不再读 QASigToggle.isEnabled()，sigOn 恒为 true。 */
      var sigOn = true;
      if (global.TradeSignals && sigOn && typeof global.TradeSignals.draw === 'function') {
        global.TradeSignals.draw(ctx, {
          id: cv.id || '',
          bars: all, startI: startI, endI: endI,
          x: (absIdx) => x(absIdx - startI),
          y: (price) => y(price),
          clip: { l: P.l, t: P.t, w: W - P.l - P.r, h: mainH }
        });
      }
    } catch (e) {}
    /* ★2026-11-06 只保留两个档位：交叉角 5~10° 画红色数学角弧+度数，
     *   面积 Q1 画斜线阴影+Q1；是才画、不是就不画。
     *   挂在主图 drawKline → 总览两个 K 线图、全部分时、全部合约/指数自动生效。 */
    try {
      if (global.QAMarks && typeof global.QAMarks.draw === 'function') {
        global.QAMarks.draw(ctx, {
          bars: all, startI: startI, endI: endI,
          x: (absIdx) => x(absIdx - startI),
          y: (price) => y(price),
          clip: { l: P.l, t: P.t, w: W - P.l - P.r, h: mainH }
        });
      }
    } catch (e) {}
    // 视图提示
    ctx.fillStyle = 'rgba(139,148,173,.95)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    const viewTip = st.off > 0 ? ' · 可左右拖动' : (st.off < 0 ? ' · 右侧留白 ' + (-st.off) + ' 根' : ' · 可拖过最新');
    ctx.fillText('第 ' + (startI + 1) + '-' + Math.min(endI, total) + ' / ' + total + ' 根' + viewTip + ' · 双击回到最新', W - P.r - 106, P.t + 8);
    ctx.textAlign = 'left';

    // ★2026-10-31b 旧买卖信号(chan-signal.js DIF/DEA延长虚线交叉·火箭/绿叶)已整体删除
    //   —— 买卖信号已删除, K线上不再叠加信号标记。

    // 买卖信号标记(买=火箭红下 / 卖=绿叶绿上)
    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // ★盈利区间高亮(悬浮窗用): 入场时间 → 出场时间 之间画半透明带
    if (opts.hlRange && (opts.hlRange.t0 !== null && opts.hlRange.t0 !== undefined) && (opts.hlRange.t1 !== null && opts.hlRange.t1 !== undefined)) {
      const r0 = opts.hlRange.t0, r1 = opts.hlRange.t1;
      let bi0 = -1, bi1 = -1;
      for (let i = 0; i < bars.length; i++) {
        if (bi0 < 0 && bars[i].t >= r0) bi0 = i;
        if (bars[i].t <= r1) bi1 = i;
      }
      if (bi0 >= 0 && bi1 >= bi0) {
        const xa = x(bi0) - bw / 2, xb = x(bi1) + bw / 2;
        ctx.save();
        ctx.fillStyle = 'rgba(240,160,32,.14)';
        ctx.fillRect(xa, P.t, Math.max(2, xb - xa), mainH);
        ctx.strokeStyle = 'rgba(240,160,32,.55)';
        ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xa, P.t); ctx.lineTo(xa, P.t + mainH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(xb, P.t); ctx.lineTo(xb, P.t + mainH); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(240,160,32,.9)';
        ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('盈利区间', xa + 3, P.t + 10);
        ctx.restore();
      }
    }
    // ★2026-10-31b 斐波那契等间距垂直虚线(avg-vlines/showFib 开关)已按用户要求整体删除。
    /* ★2026-10-30e 读数改由数据库驱动(updown.js fetchSigs→renderSigReadout),
     *   服务端预计算(sig.sqlite)→前端查库, 不再用组件实时回调。 */
    // ★2026-11-04 用户定稿：旧缠论连线(opts.links)通道整体停用 —— 缠论线统一由共享组件 chanlun 绘制
    {
      const LK = [];
      if (LK.length && all.length > 1) {
        ctx.save();
        ctx.beginPath(); ctx.rect(P.l, P.t, W - P.l - P.r, mainH); ctx.clip();
        const giOf = (t) => {
          let lo2 = 0, hi2 = all.length - 1, gi = -1;
          while (lo2 <= hi2) { const mid = (lo2 + hi2) >> 1; if (all[mid].t <= t) { gi = mid; lo2 = mid + 1; } else hi2 = mid - 1; }
          return gi;
        };
        /* 主线: 全部实线直线(不虚不弯) */
        for (const L of LK) {
          const g0 = giOf(L.t0), g1 = giOf(L.t1);
          if (g0 < 0 || g1 < 0) continue;
          const x0 = x(g0 - startI), x1 = x(g1 - startI);
          if (!isFinite(x0) || !isFinite(x1)) continue;
          if (L.brk) { ctx.strokeStyle = '#8892a0'; ctx.lineWidth = 1.4; }
          else { ctx.strokeStyle = (L.dir || 0) > 0 ? '#f0334b' : '#0bbf7a'; ctx.lineWidth = 2; }
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x0, y(L.p0)); ctx.lineTo(x1, y(L.p1)); ctx.stroke();
          /* 端点圆点(过渡段端点小一点, 保持链条连续感) */
          ctx.fillStyle = ctx.strokeStyle;
          const rDot = L.brk ? 1.8 : 2.6;
          ctx.beginPath(); ctx.arc(x0, y(L.p0), rDot, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x1, y(L.p1), rDot, 0, Math.PI * 2); ctx.fill();
        }
        ctx.lineWidth = 2; ctx.setLineDash([]);
        ctx.restore();
      }
    }
    /* ★2026-11-04 用户定稿：买卖信号(火箭/绿叶)通道整体停用，能量公式与买卖信号全部删除 */
    const marks = [];
    // ★2026-10-31b 用户定稿: 所有旧买卖信号(缠论一买/一卖、DIF/DEA交叉、BK.pts)全部删除,
    //   买卖信号已删除(sig.sqlite / drawBestSignals)。
    //   opts.marks 仅保留参数兼容(现调用方传空数组)。
    marks.forEach(m => {
      let bi = -1;
      for (let i = 0; i < bars.length; i++) if (bars[i].t >= m.t) { bi = i; break; }
      if (bi < 0) return;
      const buy = (m.dir || 0) > 0;
      const col = buy ? '#ff3b30' : '#0bbf7a';
      const name = m.label || (buy ? '一买' : '一卖');
      const px = x(bi);
      const s = Math.max(6, Math.min(11, bw * 0.85));
      ctx.fillStyle = col;
      if (buy) {
        const py = y(bars[bi].l) + s * 1.5;
        drawRocket(ctx, px, py, s);
        ctx.fillText(bw >= 14 ? name + ' ' + fp(m.price) : (bw >= 9 ? name : ''), px, py + s * 1.35 + 8);
      } else {
        const py = y(bars[bi].h) - s * 1.5;
        drawLeaf(ctx, px, py, s);
        ctx.fillText(bw >= 14 ? name + ' ' + fp(m.price) : (bw >= 9 ? name : ''), px, py - s * 1.35 - 7);
      }
    });
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.restore();

    /* ★2026-11-03 买卖信号绘制组件(sig-markers.js / drawBestSignals)已整体删除。 */

    // 成交量（★2026-11-03: 副图已抽为共享组件，默认不再在主图画 vol）
    if (subOn) {
      const vy = v => volB - (v / vMax) * P.volH;
      bars.forEach((b, i) => {
        ctx.fillStyle = b.c >= b.o ? 'rgba(240,51,75,.75)' : 'rgba(11,191,122,.75)';
        const t = vy(b.v);
        ctx.fillRect(Math.round(x(i) - cw / 2), t, cw, Math.max(1, volB - t));
      });
      ctx.strokeStyle = 'rgba(38,48,80,.55)';
      ctx.beginPath(); ctx.moveTo(P.l, volT); ctx.lineTo(W - P.r, volT); ctx.stroke();
    }

    // 副图指标（★2026-11-03: noSub 时跳过，MACD 已由共享组件 SubCharts 以「能量E」为标单独渲染）
    const subInd = opts.subInd || 'macd';
    if (subOn) (function drawSub() {
      const ser = [];
      let hist = null, zeroLine = false;
      const ema = n => { const k = 2 / (n + 1); let p = null; return C.map(xv => (p = (p === null || p === undefined) ? xv : xv * k + p * (1 - k))); };
      /* ★2026-11-03 涨跌家数已删除 → MACD 数据源固定为收盘价 C(不再支持 breadthMap 切换)。 */
      const src = C;
      if (subInd === 'macd') {
        /* 在 src(涨家数或收盘价)上算 EMA, 遇缺口(null)跳过并沿用上一值, 避免断点拖出 NaN */
        const emaS = n => { const k = 2 / (n + 1); let p = null; return src.map(xv => { if (xv === null || xv === undefined || !isFinite(xv)) return (p === null ? null : p); p = (p === null) ? xv : xv * k + p * (1 - k); return p; }); };
        const e12 = emaS(MACD_P.fast), e26 = emaS(MACD_P.slow);
        const difF = e12.map((v, i) => (v === null || e26[i] === null) ? null : (v - e26[i]));
        const kS = 2 / (MACD_P.signal + 1); let dea = null;
        const deaF = difF.map(xv => (xv === null || xv === undefined) ? null : (dea = (dea === null) ? xv : xv * kS + dea * (1 - kS)));
        hist = difF.map((v, i) => (v === null || deaF[i] === null) ? null : (v - deaF[i]) * 2);
        macdDif = difF; macdDea = deaF; macdHist = hist;   // ★2026-10-31k 暴露给悬浮窗最底行显示 MACD 值
        ser.push({ arr: cut(difF), color: '#f0a020', name: 'DIF' });
        ser.push({ arr: cut(deaF), color: '#3d7bff', name: 'DEA' });
        zeroLine = true;
      } else if (subInd === 'kdj') {
        const K = [], D = [], J = [];
        let pk = 50, pd = 50;
        for (let i = 0; i < C.length; i++) {
          if (i < 8) { K.push(null); D.push(null); J.push(null); continue; }
          let hh = -Infinity, ll = Infinity;
          for (let k = i - 8; k <= i; k++) { hh = Math.max(hh, HH[k]); ll = Math.min(ll, LL[k]); }
          const rsv = hh === ll ? 50 : (C[i] - ll) / (hh - ll) * 100;
          pk = pk * 2 / 3 + rsv / 3; pd = pd * 2 / 3 + pk / 3;
          K.push(pk); D.push(pd); J.push(3 * pk - 2 * pd);
        }
        ser.push({ arr: cut(K), color: '#f0a020', name: 'K' });
        ser.push({ arr: cut(D), color: '#3d7bff', name: 'D' });
        ser.push({ arr: cut(J), color: '#c678dd', name: 'J' });
      } else if (subInd === 'rsi') {
        const R = []; let ag = 0, al = 0;
        for (let i = 0; i < C.length; i++) {
          if (i === 0) { R.push(null); continue; }
          const ch = C[i] - C[i - 1];
          const g = Math.max(0, ch), l = Math.max(0, -ch);
          if (i <= 14) { ag += g / 14; al += l / 14; if (i < 14) { R.push(null); continue; } }
          else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; }
          R.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
        }
        ser.push({ arr: cut(R), color: '#f0a020', name: 'RSI14' });
      } else if (subInd === 'wr') {
        const W2 = [];
        for (let i = 0; i < C.length; i++) {
          if (i < 13) { W2.push(null); continue; }
          let hh = -Infinity, ll = Infinity;
          for (let k = i - 13; k <= i; k++) { hh = Math.max(hh, HH[k]); ll = Math.min(ll, LL[k]); }
          W2.push(hh === ll ? 50 : (hh - C[i]) / (hh - ll) * 100);
        }
        ser.push({ arr: cut(W2), color: '#e06c9f', name: 'WR14' });
      } else if (subInd === 'cci') {
        const TP = C.map((c, i) => (HH[i] + LL[i] + c) / 3), M = [], OUT = [];
        for (let i = 0; i < C.length; i++) {
          if (i < 13) { M.push(null); OUT.push(null); continue; }
          let s2 = 0; for (let k = i - 13; k <= i; k++) s2 += TP[k];
          const ma = s2 / 14;
          let md2 = 0; for (let k = i - 13; k <= i; k++) md2 += Math.abs(TP[k] - ma);
          md2 /= 14;
          OUT.push(md2 === 0 ? 0 : (TP[i] - ma) / (0.015 * md2));
        }
        ser.push({ arr: cut(OUT), color: '#5aa9a3', name: 'CCI14' });
        zeroLine = true;
      } else if (subInd === 'obv') {
        const O = []; let run = 0;
        for (let i = 0; i < C.length; i++) { if (i > 0) run += C[i] > C[i - 1] ? VV[i] : (C[i] < C[i - 1] ? -VV[i] : 0); O.push(run); }
        ser.push({ arr: cut(O), color: '#3d7bff', name: 'OBV' });
      } else if (subInd === 'atr') {
        const A = [];
        for (let i = 0; i < C.length; i++) {
          const pc = i > 0 ? C[i - 1] : C[i];
          const tr = Math.max(HH[i] - LL[i], Math.abs(HH[i] - pc), Math.abs(LL[i] - pc));
          A.push(i === 0 ? tr : (A[i - 1] * 13 + tr) / 14);
        }
        ser.push({ arr: cut(A), color: '#f0a020', name: 'ATR14' });
      }
      let mn = Infinity, mx = -Infinity;
      const add = v => { if (typeof v === 'number' && isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } };
      ser.forEach(xv => xv.arr.forEach(add));
      if (hist) hist.forEach(v => add(v));
      if (zeroLine) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
      if (!isFinite(mn) || !isFinite(mx)) { mn = 0; mx = 1; }
      if (mn === mx) { mn -= 1; mx += 1; }
      const padv = (mx - mn) * 0.08; mn -= padv; mx += padv;
      const yy = v => macdT + (mx - v) / (mx - mn) * P.macdH;
      ctx.font = '9px Consolas, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (let g = 0; g <= 2; g++) {
        const gv = mx - (mx - mn) * g / 2, gy = yy(gv);
        ctx.strokeStyle = 'rgba(38,48,80,.55)';
        ctx.beginPath(); ctx.moveTo(P.l, gy); ctx.lineTo(W - P.r, gy); ctx.stroke();
        ctx.fillStyle = '#8b94ad'; ctx.fillText(fp(gv), W - P.r + 4, gy);
      }
      if (zeroLine && mn < 0 && mx > 0) {
        ctx.strokeStyle = 'rgba(139,148,173,.45)'; ctx.beginPath(); ctx.moveTo(P.l, yy(0)); ctx.lineTo(W - P.r, yy(0)); ctx.stroke();
      }
      if (hist) {
        const h2 = hist.slice(startI, endI);
        h2.forEach((v, i) => {
          if ((v === null || v === undefined)) return;
          ctx.fillStyle = v >= 0 ? 'rgba(240,51,75,.75)' : 'rgba(11,191,122,.75)';
          const y0 = yy(0), y1 = yy(v);
          ctx.fillRect(Math.round(x(i) - cw / 2), Math.min(y0, y1), cw, Math.max(1, Math.abs(y1 - y0)));
        });
      }
      ser.forEach(s2 => {
        ctx.strokeStyle = s2.color; ctx.lineWidth = 1.2; ctx.beginPath();
        let started = false;
        s2.arr.forEach((v, i) => { if ((v === null || v === undefined) || !bars[i]) return; if (!started) { ctx.moveTo(x(i), yy(v)); started = true; } else ctx.lineTo(x(i), yy(v)); });
        ctx.stroke();
      });
      let off = 2;
      if (subInd === 'macd') {
        /* ★2026-10-31k MACD 副图左上角: 显示 DIF/DEA/MACD 最新值(名称:值, 逗号分开) */
        var _li = all.length - 1;
        var _dV = (macdDif && macdDif[_li] != null) ? macdDif[_li] : null;
        var _eV = (macdDea && macdDea[_li] != null) ? macdDea[_li] : null;
        var _hV = (macdHist && macdHist[_li] != null) ? macdHist[_li] : null;
        ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        var _sx = P.l + 4;
        function _seg(lb, val, col) {
          ctx.fillStyle = '#8b94ad'; ctx.fillText(lb + ':', _sx, macdT - 8); _sx += (lb.length + 1) * 6.4;
          ctx.fillStyle = col; var s = (val == null) ? '-' : val.toFixed(2); ctx.fillText(s, _sx, macdT - 8); _sx += s.length * 6.4 + 10;
        }
        _seg('DIF', _dV, '#f0a020'); _seg('DEA', _eV, '#3d7bff'); _seg('MACD', _hV, (_hV == null ? '#d7dcea' : (_hV >= 0 ? '#f0334b' : '#0bbf7a')));
        cv.__macdSrc = 'close';
        /* ★2026-10-31i MACD 参数编辑按钮(副图左上): 点击打开实时修改+保存弹窗 */
        var bx = P.l + 4, by = macdT + 4, bw = 96, bh = 18;
        ctx.save();
        ctx.fillStyle = 'rgba(16,24,38,0.88)'; ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = '#3d7bff'; ctx.lineWidth = 1; ctx.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
        ctx.fillStyle = '#cfe0ff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('⚙ ' + MACD_P.fast + ',' + MACD_P.slow + ',' + MACD_P.signal, bx + 7, by + bh / 2 + 1);
        ctx.restore();
        cv.__macdBtn = { x: bx, y: by, w: bw, h: bh };
      } else {
        ser.forEach(s2 => { ctx.fillStyle = s2.color; ctx.font = '9px sans-serif'; ctx.fillText(s2.name, P.l + off, macdT - 8); off += 40; });
        cv.__macdBtn = null;
      }
    })();

    // 手绘图层（趋势线/水平线/垂直线/射线/矩形/三角形/斐波那契）
    //   ★1:1 移植 latest web/src/js/service/chart/draw.js 的形状绘制
    ctx.save();
    ctx.beginPath(); ctx.rect(0, P.t, W, mainH); ctx.clip();
    // 暴露坐标映射给绘图工具（全局K线下标 ↔ 像素, 价格 ↔ 像素）
    const xLeft = P.l, xRight = W - P.r, yTop = P.t, yBot = P.t + mainH;
    const xOf = gi => x(Math.max(0, Math.min(bars.length - 1, gi - startI)));
    const yOf = v => y(v);
    const iOf = mx => Math.max(0, Math.min(bars.length - 1, Math.round((mx - P.l) / bw - 0.5) + startI));
    const vOf = my => hi - ((my - yShift) - P.t) / mainH * (hi - lo);
    cv.__xOf = xOf; cv.__yOf = yOf; cv.__iOf = iOf; cv.__vOf = vOf;
    cv.__map = { xOf: xOf, yOf: yOf, iOf: iOf, vOf: vOf, xLeft: xLeft, xRight: xRight, yTop: yTop, yBot: yBot };
    const DT = global.DrawTool;
    if (DT) {
      const shapes = (opts.drawings || []).concat(cv.__draft ? [cv.__draft] : []);
      DT.render(ctx, shapes, { xOf: xOf, yOf: yOf, xLeft: xLeft, xRight: xRight, yTop: yTop, yBot: yBot });
    } else {
      (opts.drawings || []).forEach(function (d) {
        if (!d || (d.p1 === null || d.p1 === undefined) || (d.p2 === null || d.p2 === undefined)) return;
        const i1 = d.i1 - startI, i2 = d.i2 - startI;
        if (Math.max(i1, i2) < 0 || Math.min(i1, i2) >= bars.length) return;
        const X1 = x(Math.max(0, Math.min(bars.length - 1, i1))), X2 = x(Math.max(0, Math.min(bars.length - 1, i2)));
        const Y1 = y(d.p1), Y2 = y(d.p2);
        ctx.strokeStyle = '#3d7bff'; ctx.lineWidth = 1.4; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(X1, Y1); ctx.lineTo(X2, Y2); ctx.stroke();
      });
    }
    ctx.restore();

    // 十字光标 + OHLC 浮窗
    if (!cv._crossBound) {
      cv._crossBound = true;
      cv.addEventListener('mousemove', e => {
        if (cv._dragging) return;
        const rect = cv.getBoundingClientRect();
        cv._cross = { mx: e.clientX - rect.left, my: e.clientY - rect.top };
        redrawK();
        /* ★2026-11-03 共享副图光标联动: 把当前悬停K线的「全量索引」广播给副图组件,
         *   MACD(标=能量E) 与 能量副图 会同步画十字光标并显示该点读数。 */
        try {
          if (global.SubCharts && typeof global.SubCharts.setHover === 'function') {
            const vis = cv.__vis || { startI: 0, n: 0, bw: 1, l: P.l };
            const hb = Math.floor((cv._cross.mx - vis.l) / vis.bw);
            global.SubCharts.setHover(cv, (hb >= 0 && hb < vis.n) ? (vis.startI + hb) : null);
          }
        } catch (e3) { }
        // 外部回调（悬浮迷你窗用）：当前悬停的K线
        if (typeof opts.onHoverBar === 'function') {
          try {
            const b = cv.__barAt ? cv.__barAt(cv._cross.mx) : null;
            opts.onHoverBar(b || null);
          } catch (e2) { }
        }
      });
      cv.addEventListener('mouseleave', () => {
        cv._cross = null; redrawK();
        try { if (global.SubCharts && typeof global.SubCharts.setHover === 'function') global.SubCharts.setHover(cv, null); } catch (e3) { }
        if (typeof opts.onHoverBar === 'function') { try { opts.onHoverBar(null); } catch (e2) { } }
      });
    }
    if (cv._cross) {
      const mx = cv._cross.mx, my = cv._cross.my;
      const bi = Math.floor((mx - P.l) / bw);
      if (bi >= 0 && bi < bars.length) {
        const px = x(bi);
        ctx.save();
        ctx.strokeStyle = 'rgba(180,190,210,.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, P.t); ctx.lineTo(px, plotBottom); ctx.stroke();
        if (my >= P.t && my <= plotBottom) { ctx.beginPath(); ctx.moveTo(P.l, my); ctx.lineTo(W - P.r, my); ctx.stroke(); }
        ctx.setLineDash([]);
        ctx.font = '10px Consolas, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        if (my >= P.t && my <= plotBottom) {
          const pv = hi - ((my - yShift) - P.t) / mainH * (hi - lo);
          ctx.fillStyle = '#2a3350'; ctx.fillRect(W - P.r + 1, my - 8, P.r - 2, 16);
          ctx.fillStyle = '#d7dcea'; ctx.fillText(fp(pv), W - P.r + 4, my);
        }
        const tstr = dateTxt(bars[bi].t).slice(5) + ' ' + tsTxt(bars[bi].t).slice(6);
        ctx.fillStyle = '#2a3350'; ctx.fillRect(px - 34, plotBottom + 2, 68, 15);
        ctx.fillStyle = '#d7dcea'; ctx.textAlign = 'center'; ctx.fillText(tstr, px, plotBottom + 10);
        const b = bars[bi];
        const prev = bi > 0 ? bars[bi - 1].c : (b.o || b.c);
        const chg = prev > 0 ? (b.c - prev) / prev * 100 : 0;
        const amp = prev > 0 ? (b.h - b.l) / prev * 100 : 0;
        const col = chg >= 0 ? '#f0334b' : '#0bbf7a';
        const pctStr = (chg > 0 ? '+' : '') + fmt(chg, 2) + '%';
        const rows = [['开', fp(b.o), '高', fp(b.h), true], ['低', fp(b.l), '收', fp(b.c), false], ['涨跌', pctStr, '振幅', fmt(amp, 2) + '%', true]];
        /* ★2026-10-26 共享组件增强: opts.extraRows(b) → 追加自定义悬浮窗多行（涨跌家数/比例/幅度等）
         *   每行 = [ label, value, color ]，画在原 OHLC 浮窗下方；标题追加 opts.extraTitle */
        let extra = [];
        if (typeof opts.extraRows === 'function') { try { extra = opts.extraRows(b) || []; } catch (e) { extra = []; } }
        const ttlAdd = (typeof opts.extraTitle === 'function') ? opts.extraTitle() : '';
        const tw0 = 206, th0 = 16 + rows.length * 14 + 6;
        const mRow = (subInd === 'macd' && macdDif) ? 1 : 0;   // ★2026-10-31k 悬浮窗最底行显示 MACD 值
        const mh = mRow ? (6 + 14) : 0;
        const eh = extra.length, th = th0 + (eh ? 6 + eh * 14 : 0) + mh;
        const tw = mRow ? 240 : tw0;
        const tx = Math.min(px + 12, W - P.r - tw);
        const ty = Math.max(P.t + 4, Math.min(my - th - 10, plotBottom - th));
        ctx.fillStyle = 'rgba(17,22,35,.96)'; ctx.strokeStyle = '#2a3350'; ctx.lineWidth = 1;
        ctx.fillRect(tx, ty, tw, th); ctx.strokeRect(tx, ty, tw, th);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '11px sans-serif';
        ctx.fillStyle = '#8b94ad'; ctx.fillText(tsTxt(b.t) + '  ' + dateTxt(b.t) + (ttlAdd ? '  ' + ttlAdd : ''), tx + 7, ty + 5);
        rows.forEach((r, i) => {
          const yy = ty + 21 + i * 14;
          ctx.fillStyle = '#8b94ad'; ctx.fillText(r[0], tx + 7, yy);
          ctx.fillStyle = r[4] ? col : '#d7dcea'; ctx.fillText(r[1], tx + 26, yy);
          ctx.fillStyle = '#8b94ad'; ctx.fillText(r[2], tx + 104, yy);
          ctx.fillStyle = r[4] ? col : '#d7dcea'; ctx.fillText(r[3], tx + 132, yy);
        });
        /* 叠加行：分隔线 + 自定义行 */
        if (eh > 0) {
          const yDiv = ty + 16 + rows.length * 14 + 3;
          ctx.fillStyle = 'rgba(240,160,32,.85)';
          ctx.fillRect(tx + 7, yDiv, tw - 14, 1);
          extra.forEach((r, i) => {
            const y2 = yDiv + 6 + i * 14;
            /* 布局：名字靠左，数据右对齐（tw-10），避免中文标签与数值重叠 */
            ctx.fillStyle = '#8b94ad'; ctx.textAlign = 'left'; ctx.fillText(r[0], tx + 7, y2);
            ctx.fillStyle = r[2] || '#d7dcea'; ctx.textAlign = 'right'; ctx.fillText(String(r[1]), tx + tw - 10, y2);
          });
        }
        /* ★2026-10-31k K线悬浮窗最底行显示 MACD 的 DIF/DEA/MACD 值(名称:值, 逗号分开) */
        if (mRow && bi >= 0) {
          const gi = startI + bi;
          const dv = (macdDif && macdDif[gi] != null) ? macdDif[gi] : null;
          const ev = (macdDea && macdDea[gi] != null) ? macdDea[gi] : null;
          const hv = (macdHist && macdHist[gi] != null) ? macdHist[gi] : null;
          if (dv != null || ev != null || hv != null) {
            const yM = ty + 16 + rows.length * 14 + 3 + (eh ? 6 + eh * 14 : 0) + 3;
            ctx.fillStyle = 'rgba(240,160,32,.85)'; ctx.fillRect(tx + 7, yM - 4, tw - 14, 1);
            ctx.font = '10px Consolas, monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
            var _xc = tx + 7;
            ctx.fillStyle = '#8b94ad'; ctx.fillText('DIF:', _xc, yM); _xc += 4 * 6.4;
            ctx.fillStyle = '#f0a020'; ctx.fillText((dv == null ? '-' : dv.toFixed(2)), _xc, yM); _xc += 7 * 6.4;
            ctx.fillStyle = '#8b94ad'; ctx.fillText('DEA:', _xc, yM); _xc += 4 * 6.4;
            ctx.fillStyle = '#3d7bff'; ctx.fillText((ev == null ? '-' : ev.toFixed(2)), _xc, yM); _xc += 7 * 6.4;
            ctx.fillStyle = '#8b94ad'; ctx.fillText('MACD:', _xc, yM); _xc += 5 * 6.4;
            ctx.fillStyle = (hv == null ? '#d7dcea' : (hv >= 0 ? '#f0334b' : '#0bbf7a')); ctx.fillText((hv == null ? '-' : hv.toFixed(2)), _xc, yM);
          }
        }
        ctx.restore();
      }
    }
    cv.__barAt = mx => { const i = Math.floor((mx - P.l) / bw); return bars[i] || null; };

    // 选中K线
    if (opts.selT) {
      let si = -1;
      for (let i = 0; i < bars.length; i++) if (bars[i].t >= opts.selT) { si = i; break; }
      if (si >= 0) {
        const b = bars[si], cx = x(si);
        ctx.save();
        ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(200,214,255,.45)';
        ctx.beginPath(); ctx.moveTo(cx, P.t); ctx.lineTo(cx, plotBottom); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(P.l, y(b.c)); ctx.lineTo(W - P.r, y(b.c)); ctx.stroke();
        ctx.setLineDash([]);
        const prev = si > 0 ? bars[si - 1].c : b.o;
        const chg = prev > 0 ? (b.c - prev) / prev * 100 : 0;
        const info = dateTxt(b.t) + '  开' + fp(b.o) + ' 高' + fp(b.h) + ' 低' + fp(b.l) + ' 收' + fp(b.c) + '  ' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
        ctx.font = 'bold 10px sans-serif';
        const tw = ctx.measureText(info).width + 14;
        const bx = Math.max(P.l, Math.min(W - P.r - tw, cx - tw / 2));
        ctx.fillStyle = 'rgba(16,22,36,.92)'; ctx.fillRect(bx, P.t + 3, tw, 17);
        ctx.strokeStyle = chg >= 0 ? '#f0334b' : '#0bbf7a'; ctx.lineWidth = 1; ctx.strokeRect(bx, P.t + 3, tw, 17);
        ctx.fillStyle = chg >= 0 ? '#ff6b7d' : '#3ddc9a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(info, bx + 7, P.t + 12);
        const py = y(b.c);
        ctx.fillStyle = '#2b3a5e'; ctx.fillRect(W - P.r + 1, py - 7, P.r - 2, 14);
        ctx.fillStyle = '#dbe4ff'; ctx.font = '9px sans-serif'; ctx.fillText(fp(b.c), W - P.r + 4, py);
        ctx.restore();
      }
    }

    // 交互: 拖动平移 / 滚轮翻页 / 双击复位
    cv._kopts = opts;
    /* ★2026-11-03 DEF_VIS 提到函数作用域: 原先声明在下方 `if (!cv._kbound && !opts.noInteract)`
     *   块内, 但块外(_apiBound 段)的 _zoomBy/_panBy/_resetView 也要用它 →
     *   noInteract 模式(KChart 接管交互)下调用即抛 "DEF_VIS is not defined"。 */
    const DEF_VIS = () => (cv.__defVis || 100);   // ★2026-10-29 按分时自适应
    /* ★2026-11-03 noInteract: 交互已上移到共享组件 web/js/kchart.js,
     *   由 KChart 统一接管拖拽/滚轮/键盘/工具栏, 避免两套交互互相打架。 */
    if (!cv._kbound && !opts.noInteract) {
      cv._kbound = true;
      cv.style.cursor = 'grab';
      let drag = null;
      cv.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        var __b = cv.__macdBtn;   // ★2026-10-31i 点在 MACD 参数按钮上时不触发拖拽
        if (__b) { var __r = cv.getBoundingClientRect(); var __mx = e.clientX - __r.left, __my = e.clientY - __r.top; if (__mx >= __b.x && __mx <= __b.x + __b.w && __my >= __b.y && __my <= __b.y + __b.h) return; }
        if (cv.__drawToolActive) { e.preventDefault(); return; }   // 绘图模式下不平移
        const s = cv._kst || (cv._kst = { off: 0, vis: DEF_VIS(), yoff: 0 });
        drag = { x: e.clientX, y: e.clientY, off: s.off, yoff: s.yoff || 0 };
        cv.__dragBase = { x: e.clientX, off: s.off };   // ★2026-10-29j 活基点: 懒加载前拼钉位 off 时同步平移基点, 防止拖拽中已加载的旧K线"消失"
        cv._dragging = true; cv.style.cursor = 'grabbing'; e.preventDefault();
      });
      window.addEventListener('mousemove', e => {
        if (!drag) return;
        const s = cv._kst || (cv._kst = { off: 0, vis: DEF_VIS(), yoff: 0 });
        const bwNow = cv.__bw || 1;
        const base = cv.__dragBase || drag;             // ★2026-10-29j 用活基点(懒加载钉位会同步平移它)
        s.off = base.off + Math.round((e.clientX - base.x) / bwNow);
        s.yoff = (drag.yoff || 0) + (e.clientY - drag.y);
        redrawK();
      });
      window.addEventListener('mouseup', () => { if (drag) { drag = null; cv.__dragBase = null; cv._dragging = false; cv.style.cursor = 'grab'; } });
      // ★2026-10-24 补缩放(对齐 latest series.js handleScale: mouseWheel=true):
      //   滚轮 = 放大/缩小K线(改可见根数 vis, 20~总数) · Shift+滚轮 = 左右平移
      //   纵向缩放 = 拖动时按住 Ctrl(改 yoff)
      cv.addEventListener('wheel', e => {
        e.preventDefault();
        const s = cv._kst || (cv._kst = { off: 0, vis: DEF_VIS(), yoff: 0 });
        const total2 = cv.__total || DEF_VIS();
        if (e.shiftKey) {                               // Shift+滚轮 = 平移
          s.off = Math.max(0, Math.min(Math.max(0, total2 - (s.vis || DEF_VIS())), (s.off || 0) + (e.deltaY > 0 ? 10 : -10)));
        } else {                                        // 滚轮 = 缩放(可见根数)
          const cur = s.vis || DEF_VIS();
          const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
          const nv = Math.max(20, Math.min(total2, Math.round(cur * f)));
          if (nv !== cur) {
            s.vis = nv;
            s.off = Math.max(0, Math.min(Math.max(0, total2 - nv), s.off || 0));
          }
        }
        redrawK();
      }, { passive: false });
      cv.addEventListener('dblclick', () => { cv._kst = { off:0, vis:DEF_VIS(), yoff:0 }; redrawK(); });
    }
    /* ★2026-11-03 供外部按钮调用：缩放/平移/复位
     *   移出 noInteract 块 —— noInteract 模式下(KChart 接管交互)这些接口仍须可用,
     *   OKX 页的 ＋/－/⤢ 按钮依赖它们。 */
    if (!cv._apiBound) {
      cv._apiBound = true;
      // 供外部按钮调用：缩放/平移/复位
      /* ★2026-11-03 只在「尚未被外部接管」时才定义:
       *   OKX 页在 KChart 模式下会把 cv._zoomBy 转发给共享组件(KC.zoomBy),
       *   而本段在「有数据」的重绘里会执行 —— 若无条件覆盖, 外部转发会被夺走,
       *   表现为 OKX 页 ＋/－/⤢ 按钮点了没反应(实测 vis 恒为 200)。
       *   触发路径: 首次空数据渲染 → app.js 先绑定转发 → 后续有数据重绘 → 本段覆盖 → 失效。 */
      if (!cv._zoomBy) cv._zoomBy = function (f) {
        const s = cv._kst || (cv._kst = { off: 0, vis: DEF_VIS(), yoff: 0 });
        const total2 = cv.__total || DEF_VIS();
        const nv = Math.max(20, Math.min(total2, Math.round((s.vis || DEF_VIS()) * f)));
        if (nv !== (s.vis || DEF_VIS())) {
          s.vis = nv;
          s.off = Math.max(0, Math.min(Math.max(0, total2 - nv), s.off || 0));
          redrawK();
        }
      };
      if (!cv._panBy) cv._panBy = function (n) {
        const s = cv._kst || (cv._kst = { off: 0, vis: DEF_VIS(), yoff: 0 });
        const total2 = cv.__total || DEF_VIS();
        s.off = Math.max(0, Math.min(Math.max(0, total2 - (s.vis || DEF_VIS())), (s.off || 0) + n));
        redrawK();
      };
      if (!cv._resetView) cv._resetView = function () { cv._kst = { off: 0, vis: DEF_VIS(), yoff: 0 }; redrawK(); };
    }
    /* ★2026-10-31i MACD 参数按钮点击 → 打开实时编辑弹窗(可保存) */
    if (!cv._macdBtnBound) {
      cv._macdBtnBound = true;
      cv.addEventListener('click', function (e) {
        var b = cv.__macdBtn; if (!b) return;
        var rect = cv.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          e.preventDefault(); e.stopPropagation();
          openMacdEditor(cv, e.clientX, e.clientY);
        }
      });
    }
    /* ★2026-11-03 共享能量组件: 主图每次重绘(缩放/拖动/换周期)后同步重绘能量副图 */
    try { if (global.SubCharts && typeof global.SubCharts.sync === 'function') global.SubCharts.sync(cv); } catch (e) {}
    if (opts.stateKey) {
      try {
        st.tail = all.length ? (all[all.length - 1].t | 0) : 0;
        const moved = (st.off !== lastSaved.off) || ((st.yoff || 0) !== (lastSaved.yoff || 0));
        st.navAt = moved ? Date.now() : (lastSaved.navAt || 0);
        localStorage.setItem('oqt_view:' + opts.stateKey, JSON.stringify(st));
        lastSaved.off = st.off; lastSaved.yoff = st.yoff || 0; lastSaved.navAt = st.navAt;
      } catch (e) {}
    }
  }

  global.drawKline = drawKline;
  global.chanFmt = fmt;
  global.chanVolTxt = volTxt;
  global.chanTsTxt = tsTxt;
  global.chanDateTxt = dateTxt;
})(window);
