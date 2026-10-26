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
  // opts: { bars:[{t,o,h,l,c,v}], marks:[{t,dir,price,label}], chan:{fib,pts}, mainInd, subInd, height, stateKey }
  function drawKline(cv, opts) {
    const dpr = global.devicePixelRatio || 1;
    const W = cv.clientWidth, H = opts.height || 460;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.height = H + 'px';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const all = normBars(opts.bars);
    if (!all.length) {
      ctx.fillStyle = '#8b94ad'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('暂无K线数据(点「补充数据」拉取真实行情)', W / 2, H / 2);
      return;
    }
    const keyNow = opts.stateKey || '';
    if (cv.__kstKey !== keyNow) { cv._kst = null; cv.__kstKey = keyNow; }
    const st = cv._kst || (cv._kst = { off: 0, vis: 100, yoff: 0, tail: all.length ? (all[all.length - 1].t | 0) : 0, navAt: 0 });
    // 外部指定视口(悬浮迷你窗用): opts.off / opts.vis 覆盖内部状态
    if ((opts.off !== null && opts.off !== undefined) && opts.off >= 0) st.off = opts.off | 0;
    const lastSaved = { off: st.off | 0, yoff: +st.yoff || 0, navAt: st.navAt | 0 };
    const total = all.length;
    // ★可见根数: 外部指定(opts.vis) > 内部缩放状态(st.vis) > 默认100
    let vis = (opts.vis | 0) > 0 ? (opts.vis | 0) : ((st.vis | 0) > 0 ? (st.vis | 0) : 100);
    vis = Math.max(20, Math.min(total, vis));
    st.vis = vis;
    st.off = Math.max(0, Math.min(total - vis, Math.round(st.off || 0)));
    const endI = total - st.off;
    const startI = Math.max(0, endI - vis);
    if (startI === 0 && st.off > 0 && opts.onMore && total < (opts.maxBars || 3000) && cv.__moreAt !== total) {
      cv.__moreAt = total;
      try { Promise.resolve(opts.onMore(total)).catch(() => {}); } catch (e) {}
    }
    const bars = all.slice(startI, endI);
    const ma5 = opts.ma5 ? opts.ma5.slice(startI, endI) : null;
    const ma10 = opts.ma10 ? opts.ma10.slice(startI, endI) : null;
    const ma20 = opts.ma20 ? opts.ma20.slice(startI, endI) : null;
    const P = { l: 8, r: 62, t: 10, volH: 62, macdH: 66, gap: 6 };
    const mainH = H - P.t - P.volH - P.macdH - P.gap * 2;
    const mainB = P.t + mainH;
    const volT = mainB + P.gap, volB = volT + P.volH;
    const macdT = volB + P.gap, macdB = macdT + P.macdH;
    const macdB0 = macdB;
    const plotW = W - P.l - P.r;
    const bw = plotW / bars.length;
    const cw = Math.max(1, Math.floor(bw * 0.7));
    cv.__total = total; cv.__bw = bw;
    const redrawK = () => { try { if (typeof cv._renderFn === 'function') cv._renderFn(); else drawKline(cv, cv._kopts || opts); } catch (e) {} };
    cv.__geo = { l: P.l, t: P.t, mainH: mainH, bw: bw, startI: startI };

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
    // 缠论(摆动顶/底 → 光滑样条 + 最近10根高低)
    const chanNew = () => {
      const n = all.length;
      const out = { tops: [], bots: [], hi10: 0, lo10: 0, t10: 0, tN: 0 };
      if (n < 8) return out;
      const PW = 3, PMM = 0.0012, PCAP = 120;
      const pv = [];
      for (let i = PW; i < n - PW; i++) {
        const h = HH[i], l = LL[i];
        let isT = true, isB = true;
        for (let k = 1; k <= PW; k++) {
          if (HH[i - k] >= h || HH[i + k] >= h) isT = false;
          if (LL[i - k] <= l || LL[i + k] <= l) isB = false;
          if (!isT && !isB) break;
        }
        if (isT || isB) pv.push({ i, p: isT ? h : l, top: isT });
      }
      const f = [];
      for (const c of pv) {
        if (!f.length) { f.push(c); continue; }
        const last = f[f.length - 1];
        if (c.top === last.top) { if ((c.top && c.p >= last.p) || (!c.top && c.p <= last.p)) f[f.length - 1] = c; continue; }
        if (Math.abs(c.p - last.p) < last.p * PMM) continue;
        f.push(c);
      }
      const pf = f.length > PCAP ? f.slice(f.length - PCAP) : f;
      for (const q of pf) (q.top ? out.tops : out.bots).push(q);
      const w = Math.min(10, n), i0 = n - w;
      let hi = -Infinity, lo = Infinity;
      for (let i = i0; i < n; i++) { if (HH[i] > hi) hi = HH[i]; if (LL[i] < lo) lo = LL[i]; }
      out.hi10 = hi; out.lo10 = lo; out.t10 = all[i0].t; out.tN = all[n - 1].t;
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
    } else if (mainInd === 'chan') {
      ovMain.chan = chanNew();
    }

    // 数值域
    let lo = 1e18, hi = -1e18;
    for (const b of bars) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
    const mav = []; [ma5, ma10, ma20].forEach(m => { if (m) mav.push(m); });
    mav.forEach(m => m.forEach((v, i) => { if (v && bars[i]) { if (v < lo) lo = v; if (v > hi) hi = v; } }));
    Object.keys(ovMain).forEach(k => { const v = ovMain[k]; if (Array.isArray(v)) v.forEach(x => { if (typeof x === 'number' && isFinite(x)) { if (x < lo) lo = x; if (x > hi) hi = x; } }); });
    const pad = (hi - lo) * 0.05 || 1;
    if (mainInd === 'chan' && ovMain.chan) {
      const ck = ovMain.chan;
      const wt0 = bars.length ? bars[0].t : 0, wt1 = bars.length ? bars[bars.length - 1].t : 0;
      const inWin = t => t >= wt0 && t <= wt1;
      const BK0 = (opts.chan && opts.chan.ok !== false) ? opts.chan : null;
      // ★只纳入"K线可见区间 ± 50%波幅"内的 fib: 过远的扩展位(如1.618)会把 y 轴撑开、
      //   K线被压成一条线(latest chanExtend 同样的夹取思路)
      let klo0 = Infinity, khi0 = -Infinity;
      for (let i = startI; i < endI; i++) { if (LL[i] < klo0) klo0 = LL[i]; if (HH[i] > khi0) khi0 = HH[i]; }
      if (!(khi0 > klo0)) { klo0 = lo; khi0 = hi; }
      const band0 = (khi0 - klo0) * 0.5, fLo = klo0 - band0, fHi = khi0 + band0;
      (BK0 && BK0.fib || []).forEach(f => {
        const px = +f[0];
        if (!isFinite(px) || px <= 0) return;
        if (px < fLo || px > fHi) return;          // 超出夹取区间 → 不参与 y 轴
        if (px < lo) lo = px; if (px > hi) hi = px;
      });
      (BK0 && BK0.pts || []).forEach(p => { if (!inWin(p.t)) return; if (p.p < lo) lo = p.p; if (p.p > hi) hi = p.p; });
    }
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
    const vMax = Math.max.apply(null, bars.map(b => b.v).concat([1]));
    ctx.fillStyle = '#8b94ad';
    ctx.fillText(volTxt(vMax), W - P.r + 5, volT + 6);
    ctx.fillText('0', W - P.r + 5, volB - 6);

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
    const lineSeries = (arr, color, dash, w) => {
      if (!arr) return;
      ctx.strokeStyle = color; ctx.lineWidth = w || 1.2; if (dash) ctx.setLineDash([4, 3]);
      ctx.beginPath(); let started = false;
      arr.forEach((v, i) => { if ((v === null || v === undefined) || !bars[i]) return; if (!started) { ctx.moveTo(x(i), y(v)); started = true; } else ctx.lineTo(x(i), y(v)); });
      ctx.stroke(); if (dash) ctx.setLineDash([]);
    };
    const legend = (txt, color, off) => { ctx.fillStyle = color; ctx.fillText(txt, P.l + (off || 0), P.t + 8); };

    if (mainInd === 'ma') {
      lineSeries(ovMain.ma5, '#f0a020'); lineSeries(ovMain.ma10, '#3d7bff');
      lineSeries(ovMain.ma20, '#c678dd'); lineSeries(ovMain.ma60, '#5aa9a3', true);
      legend('MA5', '#f0a020', 2); legend('MA10', '#3d7bff', 34);
      legend('MA20', '#c678dd', 72); legend('MA60', '#5aa9a3', 112);
    } else if (mainInd === 'ema') {
      lineSeries(ovMain.e12, '#f0a020'); lineSeries(ovMain.e26, '#3d7bff');
      legend('EMA12', '#f0a020', 2); legend('EMA26', '#3d7bff', 52);
    } else if (mainInd === 'boll') {
      lineSeries(ovMain.up, '#e06c9f'); lineSeries(ovMain.mid, '#f0a020'); lineSeries(ovMain.dn, '#e06c9f', true);
      legend('BOLL(20,2)', '#e06c9f', 2);
    } else if (mainInd === 'donchian') {
      lineSeries(ovMain.up, '#3d7bff'); lineSeries(ovMain.dn, '#3d7bff', true);
      legend('通道(20)', '#3d7bff', 2);
    } else if (mainInd === 'sar') {
      const arr = ovMain.sar || [];
      arr.forEach((v, i) => { if ((v === null || v === undefined) || !bars[i]) return; const above = v > bars[i].c; ctx.fillStyle = above ? '#0bbf7a' : '#f0334b'; ctx.beginPath(); ctx.arc(x(i), y(v), 1.6, 0, Math.PI * 2); ctx.fill(); });
      legend('SAR(0.02,0.2)', '#f0a020', 2);
    } else if (mainInd === 'chan') {
      const ck = ovMain.chan || { tops: [], bots: [], hi10: 0, lo10: 0, t10: 0, tN: 0 };
      ctx.save();
      ctx.beginPath(); ctx.rect(0, P.t, W, mainH); ctx.clip();
      ctx.setLineDash([]);
      ctx.textAlign = 'left';
      const C_UP = '#f0334b', C_DN = '#0bbf7a';
      const tx = function (t) {
        const tt = +t;
        if (!isFinite(tt) || !all.length) return NaN;
        let lo2 = 0, hi2 = all.length - 1, idx = -1;
        while (lo2 <= hi2) { const mid = (lo2 + hi2) >> 1; if (all[mid].t <= tt) { idx = mid; lo2 = mid + 1; } else hi2 = mid - 1; }
        if (idx < 0) return x(-startI - 1);
        if (idx >= all.length - 1 || all[idx].t === tt) return x(idx - startI);
        const b0 = all[idx], b1 = all[idx + 1];
        const f = (tt - b0.t) / Math.max(1e-9, b1.t - b0.t);
        const xi = x(idx - startI), xj = x(idx + 1 - startI);
        return xi + (xj - xi) * f;
      };
      // ---- 缠论线 v2（1:1 移植 latest web/src/js/service/chart/chan.js）----
      //   ① 两条线画在 K线同一坐标系（价格单位，贴着柱子）：
      //      线1 = 慢EMA + DIF(=快EMA)，线2 = 慢EMA + DEA
      //   ② 每条线按【缠论分型】抽摆动转折点(顶/底交替) → 连成【直线段】
      //      段内两点一线，绝不弯曲 —— 这就是"连接最高点最低点"的画法
      //   ③ 上涨段红 / 下跌段绿（中国惯例 涨红跌绿）
      //   ④ 左右两端按端段斜率外推【虚线】延长到 K线首/末根（辅助延长线）
      const CH = global.ChanDraw;
      if (CH) {
        const closAll = C;
        // x 用【全局下标】→ 窗口内局部下标
        const xg = gi => x(gi - startI);
        // 延长线夹取区间：K线最低-50%波幅 ~ 最高+50%波幅（latest chanExtend 口径）
        let klo = Infinity, khi = -Infinity;
        for (let i = startI; i < endI; i++) { if (LL[i] < klo) klo = LL[i]; if (HH[i] > khi) khi = HH[i]; }
        if (!(khi > klo)) { klo = lo; khi = hi; }
        const band = (khi - klo) * 0.5;
        const res = CH.drawChan(ctx, {
          closes: closAll, i0: startI, i1: endI - 1, x: xg, y: y,
          vmin: klo - band, vmax: khi + band, fast: 12, slow: 26, signal: 9
        });
        cv.__chanRes = res || null;
        // ★买卖信号（2026-10-24 新规）: MACD 的 DIF/DEA 取最近两根"相同"处 → 各画延长虚线
        //   → 虚线交叉: 向上开口=买 / 向下开口=卖, 夹角须 < 40°。其他买卖信号一律不要。
        cv.__macdSig = (global.ChanSignal ? global.ChanSignal.compute(all, { tf: opts.tf }) : null);
        cv.__chanSigs = (cv.__macdSig && cv.__macdSig.sigs) ? cv.__macdSig.sigs : [];
        cv.__chanBis = [];
      }
      if (ck.hi10 > 0 && ck.lo10 > 0 && ck.hi10 >= ck.lo10) {
        const xA = tx(ck.t10), xB = tx(ck.tN), yHi = y(ck.hi10), yLo = y(ck.lo10);
        ctx.lineWidth = 2.5; ctx.setLineDash([]);
        ctx.strokeStyle = C_DN; ctx.beginPath(); ctx.moveTo(xA, yHi); ctx.lineTo(xB, yHi); ctx.stroke();
        ctx.strokeStyle = C_UP; ctx.beginPath(); ctx.moveTo(xA, yLo); ctx.lineTo(xB, yLo); ctx.stroke();
        ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
        ctx.strokeStyle = C_DN; ctx.beginPath(); ctx.moveTo(P.l, yHi); ctx.lineTo(W - P.r, yHi); ctx.stroke();
        ctx.strokeStyle = C_UP; ctx.beginPath(); ctx.moveTo(P.l, yLo); ctx.lineTo(W - P.r, yLo); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
        ctx.fillStyle = C_DN; ctx.fillText('10根最高 ' + fp(ck.hi10), P.l + 5, yHi - 4);
        ctx.fillStyle = C_UP; ctx.fillText('10根最低 ' + fp(ck.lo10), P.l + 5, yLo + 12);
      }
      const BK = (opts.chan && opts.chan.ok !== false) ? opts.chan : null;
      (BK && BK.fib || []).forEach(f => {
        const py2 = y(f[0]);
        if (!isFinite(py2) || py2 < P.t || py2 > P.t + mainH) return;
        const isKey = Math.abs(f[1] - 0.618) < 1e-6;
        ctx.save();
        ctx.strokeStyle = isKey ? 'rgba(240,160,32,.9)' : (f[2] === 2 ? 'rgba(61,123,255,.6)' : 'rgba(139,148,173,.6)');
        ctx.lineWidth = isKey ? 1.5 : 1;
        ctx.setLineDash(f[2] === 2 ? [2, 4] : [5, 4]);
        ctx.beginPath(); ctx.moveTo(P.l, py2); ctx.lineTo(W - P.r, py2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = isKey ? 'rgba(240,160,32,.95)' : 'rgba(139,148,173,.85)';
        ctx.font = '11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
        ctx.fillText((f[2] === 2 ? 'ext ' : '') + (+f[1]).toFixed(3), P.l + 5, py2 - 3);
        ctx.restore();
      });
      ctx.restore();
      legend('缠论·DIF/DEA转折点连线(涨红跌绿) + 10根高低(无未来函数)', '#f6465d', 2);
    }
    // 视图提示
    ctx.fillStyle = 'rgba(139,148,173,.95)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('第 ' + (startI + 1) + '-' + endI + ' / ' + total + ' 根' + (st.off > 0 ? ' · 可左右拖动' : ' · 拖动看更早') + ' · 双击回到最新', W - P.r - 2, P.t + 8);
    ctx.textAlign = 'left';

    // ★买卖信号（共用模块 web/js/chan-signal.js —— OKX/NQ/A股 三页同一套规则与绘制）
    //   DIF/DEA 取最近两根"相同"处 → 各画延长虚线 → 虚线交叉:
    //   向上开口=买(火箭) / 向下开口=卖(绿叶), 夹角 < 40°
    {
      const MS = cv.__macdSig;
      const _CS = global.ChanSignal;
      if (MS && MS.base && MS.base.ok && _CS) {
        _CS.draw(ctx, {
          x: function (gi) { return x(gi - startI); },
          y: function (p) { return y(p); },
          i0: startI, i1: endI - 1,
          right: W - P.r,
          size: Math.max(6, Math.min(11, bw * 0.85)),
          wide: bw >= 14,
          lowAt: function (gi) { return all[gi] ? all[gi].l : 0; },
          highAt: function (gi) { return all[gi] ? all[gi].h : 0; },
          drawRocket: drawRocket,
          drawLeaf: drawLeaf
        }, MS);
      }
    }

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
    const marks = [];
    (opts.marks || []).forEach(m => marks.push(m));
    // ★2026-10-24 用户要求「其他买卖信号全部删除」:
    //   缠论一买/一卖、60°夹角信号一律不画 —— 现在只有 DIF/DEA 延长虚线交叉那一个信号(上面已画)。
    // ★后端缠论买卖点(BK.pts)也不画了 —— 只保留 DIF/DEA 延长虚线交叉这一个信号
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

    // 成交量
    const vy = v => volB - (v / vMax) * P.volH;
    bars.forEach((b, i) => {
      ctx.fillStyle = b.c >= b.o ? 'rgba(240,51,75,.75)' : 'rgba(11,191,122,.75)';
      const t = vy(b.v);
      ctx.fillRect(Math.round(x(i) - cw / 2), t, cw, Math.max(1, volB - t));
    });
    ctx.strokeStyle = 'rgba(38,48,80,.55)';
    ctx.beginPath(); ctx.moveTo(P.l, volT); ctx.lineTo(W - P.r, volT); ctx.stroke();

    // 副图指标
    const subInd = opts.subInd || 'macd';
    (function drawSub() {
      const ser = [];
      let hist = null, zeroLine = false;
      const ema = n => { const k = 2 / (n + 1); let p = null; return C.map(xv => (p = (p === null || p === undefined) ? xv : xv * k + p * (1 - k))); };
      if (subInd === 'macd') {
        const e12 = ema(12), e26 = ema(26);
        const difF = e12.map((v, i) => v - e26[i]);
        const k9 = 2 / 10; let dea = null;
        const deaF = difF.map(xv => (dea = (dea === null || dea === undefined) ? xv : xv * k9 + dea * (1 - k9)));
        hist = difF.map((v, i) => (v - deaF[i]) * 2);
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
      ser.forEach(s2 => { ctx.fillStyle = s2.color; ctx.font = '9px sans-serif'; ctx.fillText(s2.name, P.l + off, macdT - 8); off += 40; });
      if (subInd === 'macd') { ctx.fillStyle = '#8b94ad'; ctx.fillText('MACD(12,26,9)', P.l + 96, macdT - 8); }
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
        ctx.beginPath(); ctx.moveTo(px, P.t); ctx.lineTo(px, macdB0); ctx.stroke();
        if (my >= P.t && my <= macdB0) { ctx.beginPath(); ctx.moveTo(P.l, my); ctx.lineTo(W - P.r, my); ctx.stroke(); }
        ctx.setLineDash([]);
        ctx.font = '10px Consolas, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        if (my >= P.t && my <= macdB0) {
          const pv = hi - ((my - yShift) - P.t) / mainH * (hi - lo);
          ctx.fillStyle = '#2a3350'; ctx.fillRect(W - P.r + 1, my - 8, P.r - 2, 16);
          ctx.fillStyle = '#d7dcea'; ctx.fillText(fp(pv), W - P.r + 4, my);
        }
        const tstr = dateTxt(bars[bi].t).slice(5) + ' ' + tsTxt(bars[bi].t).slice(6);
        ctx.fillStyle = '#2a3350'; ctx.fillRect(px - 34, macdB0 + 2, 68, 15);
        ctx.fillStyle = '#d7dcea'; ctx.textAlign = 'center'; ctx.fillText(tstr, px, macdB0 + 10);
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
        const eh = extra.length, th = th0 + (eh ? 6 + eh * 14 : 0);
        const tw = tw0;
        const tx = Math.min(px + 12, W - P.r - tw);
        const ty = Math.max(P.t + 4, Math.min(my - th - 10, macdB0 - th));
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
        ctx.beginPath(); ctx.moveTo(cx, P.t); ctx.lineTo(cx, volB); ctx.stroke();
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
    if (!cv._kbound) {
      cv._kbound = true;
      cv.style.cursor = 'grab';
      let drag = null; const DEF_VIS = 100;
      cv.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        if (cv.__drawToolActive) { e.preventDefault(); return; }   // 绘图模式下不平移
        const s = cv._kst || (cv._kst = { off: 0, vis: DEF_VIS, yoff: 0 });
        drag = { x: e.clientX, y: e.clientY, off: s.off, yoff: s.yoff || 0 };
        cv._dragging = true; cv.style.cursor = 'grabbing'; e.preventDefault();
      });
      window.addEventListener('mousemove', e => {
        if (!drag) return;
        const s = cv._kst || (cv._kst = { off: 0, vis: DEF_VIS, yoff: 0 });
        const bwNow = cv.__bw || 1;
        s.off = drag.off + Math.round((e.clientX - drag.x) / bwNow);
        s.yoff = (drag.yoff || 0) + (e.clientY - drag.y);
        redrawK();
      });
      window.addEventListener('mouseup', () => { if (drag) { drag = null; cv._dragging = false; cv.style.cursor = 'grab'; } });
      // ★2026-10-24 补缩放(对齐 latest series.js handleScale: mouseWheel=true):
      //   滚轮 = 放大/缩小K线(改可见根数 vis, 20~总数) · Shift+滚轮 = 左右平移
      //   纵向缩放 = 拖动时按住 Ctrl(改 yoff)
      cv.addEventListener('wheel', e => {
        e.preventDefault();
        const s = cv._kst || (cv._kst = { off: 0, vis: DEF_VIS, yoff: 0 });
        const total2 = cv.__total || DEF_VIS;
        if (e.shiftKey) {                               // Shift+滚轮 = 平移
          s.off = Math.max(0, Math.min(Math.max(0, total2 - (s.vis || DEF_VIS)), (s.off || 0) + (e.deltaY > 0 ? 10 : -10)));
        } else {                                        // 滚轮 = 缩放(可见根数)
          const cur = s.vis || DEF_VIS;
          const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
          const nv = Math.max(20, Math.min(total2, Math.round(cur * f)));
          if (nv !== cur) {
            s.vis = nv;
            s.off = Math.max(0, Math.min(Math.max(0, total2 - nv), s.off || 0));
          }
        }
        redrawK();
      }, { passive: false });
      cv.addEventListener('dblclick', () => { cv._kst = { off:0, vis:DEF_VIS, yoff:0 }; redrawK(); });
      // 供外部按钮调用：缩放/平移/复位
      cv._zoomBy = function (f) {
        const s = cv._kst || (cv._kst = { off: 0, vis: DEF_VIS, yoff: 0 });
        const total2 = cv.__total || DEF_VIS;
        const nv = Math.max(20, Math.min(total2, Math.round((s.vis || DEF_VIS) * f)));
        if (nv !== (s.vis || DEF_VIS)) {
          s.vis = nv;
          s.off = Math.max(0, Math.min(Math.max(0, total2 - nv), s.off || 0));
          redrawK();
        }
      };
      cv._panBy = function (n) {
        const s = cv._kst || (cv._kst = { off: 0, vis: DEF_VIS, yoff: 0 });
        const total2 = cv.__total || DEF_VIS;
        s.off = Math.max(0, Math.min(Math.max(0, total2 - (s.vis || DEF_VIS)), (s.off || 0) + n));
        redrawK();
      };
      cv._resetView = function () { cv._kst = { off: 0, vis: DEF_VIS, yoff: 0 }; redrawK(); };
    }
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
