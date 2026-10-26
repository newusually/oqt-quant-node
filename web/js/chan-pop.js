/* ============================================================
 * chan-pop.js — 悬浮迷你K线窗（1:1 移植 latest web/src/js/service/chart/pop.js）
 *
 * 【用途】鼠标移到【信号列表 / 成交流水 / 净值曲线】某一行 →
 *         右上角弹出该合约该周期的小K线窗（该时点前后各若干根），
 *         窗内可移动鼠标看 OHLC/涨跌幅/振幅，可左右拖动看历史。
 *         不用跳主图，鼠标可移进小窗内继续交互。
 *
 * 【与 latest 的对应】
 *   latest pop.js:  fetchKline → OKXChart.mount(fixBars:50) → setData → centerOn(t)
 *   本文件:        fetchKline(同源 API) → 自绘 Canvas 迷你图(复用 drawKline 引擎)
 *                  → centerOn(信号时间) → 十字光标 OHLC 浮窗
 *
 * 【关键】① 按信号时间定位: 取 before = 信号时间 + N 根 → 信号大致居中
 *         ② 固定 50 根 + 可左右拖历史（与主图同口径）
 *         ③ 小窗 hover 时不关闭（mouseenter/leave + 延迟关闭）
 *         ④ ★打开期间每 10s 自动刷新(fresh 旁路缓存): 视口锚最新则追最新K线
 * ============================================================ */
'use strict';
(function (global) {
  var box = null, bodyEl = null, titleEl = null, subEl = null, legendEl = null;
  var cv = null, ctrl = null;                 // ctrl: 当前小窗的迷你图控制
  var cur = null;                             // {inst, tf, t, px, label}
  var hideT = 0, busy = false;
  var FETCH = null;                           // 外部注入取数函数
  var onClose = null;
  var AUTO_MS = 10000, autoT = 0;             // ★打开期间自动刷新(实时K线)
  var loadSeq = 0;                            // ★取数序号: 悬停快速滑动会连发多次 open,
                                              //   旧请求完成时若已被取代 → 自动补加载最新的(防卡"加载中")

  function ensure() {
    if (box) return box;
    box = document.createElement('div');
    box.id = 'chanpop';
    box.className = 'chanpop';
    box.innerHTML =
      '<div class="chanpop-hd">' +
      '<span class="chanpop-t"></span>' +
      '<span class="chanpop-s"></span>' +
      '<span class="flex-1"></span>' +
      '<span class="chanpop-x" title="关闭">✕</span>' +
      '</div>' +
      '<div class="chanpop-bd"></div>' +
      '<div class="chanpop-legend" style="display:none"></div>';
    document.body.appendChild(box);
    titleEl = box.querySelector('.chanpop-t');
    subEl = box.querySelector('.chanpop-s');
    legendEl = box.querySelector('.chanpop-legend');
    bodyEl = box.querySelector('.chanpop-bd');
    box.querySelector('.chanpop-x').onclick = function () { close(true); };
    box.addEventListener('mouseenter', function () { clearTimeout(hideT); });
    box.addEventListener('mouseleave', function () { schedule(); });
    return box;
  }

  function schedule() { clearTimeout(hideT); hideT = setTimeout(function () { close(); }, 420); }

  function close(force) {
    clearTimeout(hideT);
    clearTimeout(autoT);                       // ★停自动刷新
    if (!box) return;
    box.classList.remove('on');
    if (legendEl) legendEl.style.display = 'none';
    if (force) { cur = null; ctrl = null; if (bodyEl) bodyEl.innerHTML = ''; }
    if (onClose) { try { onClose(); } catch (e) { } onClose = null; }
  }

  function showEmpty(msg) {
    if (!box) return;
    var el = box.querySelector('.chanpop-empty-ov');
    if (!el) { el = document.createElement('div'); el.className = 'chanpop-empty-ov'; box.appendChild(el); }
    el.textContent = msg; el.style.display = 'flex';
  }
  function hideEmpty() {
    var el = box.querySelector('.chanpop-empty-ov'); if (el) el.style.display = 'none';
  }

  // 取数（外部注入优先）
  function fetchKline(inst, tf, n, extra) {
    if (FETCH && FETCH.kline) return FETCH.kline(inst, tf, n, extra);
    return Promise.resolve(null);
  }

  function fp(v) {
    v = Number(v);
    if (!isFinite(v)) return '-';
    if (v === 0) return '0.00';
    var a = Math.abs(v);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(4);
    if (a >= 0.0001) return v.toFixed(6);
    return v.toFixed(8);
  }
  function tsTxt(ms) {
    var n = +ms;
    if (!isFinite(n) || n <= 0) return '-';
    if (n < 1e11) n = n * 1000;          // 秒 → 毫秒（NQ/A股 K线用秒）
    var d = new Date(n);
    if (isNaN(d.getTime())) return '-';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function sgnCls(v) { return v > 0 ? 'up' : (v < 0 ? 'dn' : 'muted'); }

  // 十字光标信息窗（复刻主图 OHLC 浮窗）
  function renderLegend(h) {
    if (!legendEl) return;
    if (!h) { legendEl.style.display = 'none'; return; }
    var chg = h.chg || 0, amp = h.amp || 0;
    legendEl.style.display = 'block';
    legendEl.innerHTML =
      '<div class="chanpop-leg-t">' + (h.tstr || '') + '</div>' +
      '<div class="chanpop-leg-r">' +
      '<span>开 <b>' + fp(h.o) + '</b></span>' +
      '<span>高 <b class="up">' + fp(h.h) + '</b></span>' +
      '<span>低 <b class="dn">' + fp(h.l) + '</b></span>' +
      '<span>收 <b class="' + sgnCls(h.c - h.o) + '">' + fp(h.c) + '</b></span>' +
      '<span>量 <b class="muted">' + (h.vol ? Math.round(h.vol).toLocaleString() : '—') + '</b></span>' +
      '<span>涨跌幅 <b class="' + sgnCls(chg) + '">' + chg.toFixed(2) + '%</b></span>' +
      '<span>振幅 <b class="muted">' + amp.toFixed(2) + '%</b></span>' +
      '</div>';
  }

  /* 打开/切换小窗 */
  // next: {inst, tf, t(信号时间ms), px, label}  pt: {x, y} 鼠标坐标(光标跟随定位)
  function open(next, pt) {
    if (!next || !next.inst) return;
    ensure();
    var same = cur && cur.inst === next.inst && cur.tf === next.tf && cur.t === next.t;
    cur = next;
    box.classList.add('on');
    if (titleEl) titleEl.textContent = next.label || next.inst;
    if (subEl) subEl.textContent = next.tf || '';
    place(pt || lastPt);                      // ★光标跟随定位, 不遮挡右侧面板
    startAuto();                              // ★打开期间定时自动刷新
    if (same && ctrl) return;                   // 同一信号 → 不重复取数
    load(next);
  }

  /* ★光标跟随定位: 出现在鼠标右下方, 贴近边缘时自动翻转, 永不超出视口 */
  var lastPt = null;
  function place(pt) {
    if (!box) return;
    if (!pt) {                                // 无坐标 → 回退右上角
      box.style.left = ''; box.style.top = ''; box.style.right = '18px';
      return;
    }
    var W = box.offsetWidth || 520, H = box.offsetHeight || 320;
    var vw = window.innerWidth, vh = window.innerHeight;
    var px = pt.x + 18, py = pt.y + 18;
    if (px + W > vw - 8) px = Math.max(8, pt.x - W - 14);   // 右边不够 → 翻到鼠标左侧
    if (py + H > vh - 8) py = Math.max(8, vh - H - 8);      // 下面不够 → 上移
    box.style.right = 'auto';
    box.style.left = px + 'px';
    box.style.top = py + 'px';
  }

  function load(next) {
    var my = ++loadSeq;
    busy = true;
    showEmpty('加载中…');
    // 前后各取 150 根，信号居中
    fetchKline(next.inst, next.tf, 300, { before: next.t }).then(function (j) {
      var empty = !j || !j.ok || !j.bars || !j.bars.length;
      if (empty && next.t) {
        // 该时点之前无数据 → 回退取最新数据（至少给个图看）
        return fetchKline(next.inst, next.tf, 300, null).then(function (j2) {
          return (j2 && j2.ok && j2.bars && j2.bars.length) ? j2 : j;
        });
      }
      return j;
    }).then(function (j) {
      busy = false;
      // ★被更新的 open() 取代(悬停连发) → 不渲染旧数据, 立即补加载当前 cur
      if (my !== loadSeq || !cur || cur.t !== next.t) { retry(); return; }
      if (!j || !j.ok || !j.bars || !j.bars.length) {
        showEmpty('该时点暂无K线数据');
        return;
      }
      hideEmpty();
      render(next, j);
    }, function (e) {
      busy = false;
      if (my !== loadSeq) { retry(); return; }
      showEmpty('取数失败: ' + (e && e.message || e));
    });
  }

  // 补加载: 窗还开着就用最新的 cur 重新取数(序号已自增, 不会循环)
  function retry() {
    if (cur && cur.inst && box && box.classList.contains('on')) load(cur);
  }

  /* ★自动刷新: 打开期间每 AUTO_MS 用 fresh 旁路缓存重取, 重绘(视口锚点保留) */
  function startAuto() {
    clearTimeout(autoT);
    autoT = setTimeout(tickAuto, AUTO_MS);
  }
  function tickAuto() {
    if (box && box.classList.contains('on') && cur && ctrl && !busy) refresh();
    autoT = setTimeout(tickAuto, AUTO_MS);      // 链式续期(close 时统一清)
  }
  function refresh() {
    if (!cur || !ctrl || busy) return;
    var wasEnd = (ctrl.off + (ctrl.VIS || 50)) >= ctrl.bars.length;   // 停在最新 → 刷新后仍追最新
    busy = true;
    fetchKline(cur.inst, cur.tf, 300, { before: cur.t, fresh: true }).then(function (j) {
      busy = false;
      if (!cur || !ctrl) return;                // 窗已关/已换信号
      if (!j || !j.ok || !j.bars || !j.bars.length) return;   // 取数失败 → 静默保留旧图
      hideEmpty();
      render(cur, j, wasEnd ? true : ctrl.off);
    }, function () { busy = false; });          // 网络异常 → 静默, 下个周期再试
  }

  // 行格式归一: 后端有的返回对象 {t,o,h,l,c,v}, 有的返回数组 [t,o,h,l,c,dif,dea,hist,e12,e26,null,v]
  function normBars(raw) {
    return (raw || []).map(function (r) {
      if (Array.isArray(r)) return { t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[11] };
      return r;
    });
  }

  function render(next, j, keepOff) {
    if (!bodyEl) return;
    if (!cv) {
      bodyEl.innerHTML = '';
      cv = document.createElement('canvas');
      cv.id = 'chanpop-cv';
      cv.className = 'chart';
      bodyEl.appendChild(cv);
    }
    var bars = normBars(j.bars);
    // 定位信号：找最接近的K线下标（自动兼容 秒/毫秒 两种时间戳口径）
    var idx = -1, bestD = Infinity;
    for (var i = 0; i < bars.length; i++) {
      var bt = +bars[i].t;
      var d1 = Math.abs(bt - next.t);            // 同单位
      var d2 = Math.abs(bt * 1000 - next.t);     // 秒 → 毫秒
      var d = Math.min(d1, d2);
      if (d < bestD) { bestD = d; idx = i; if (d1 <= d2) break; }
    }
    if (idx < 0) idx = bars.length - 1;
    // 视口 50 根，信号居中；keepOff: true=锚最新 / 数字=固定视口(自动刷新保留) / 缺省=信号居中
    var VIS = 50;
    var off;
    if (keepOff === true) off = Math.max(0, bars.length - VIS);
    else if (typeof keepOff === 'number') off = Math.max(0, Math.min(Math.max(0, bars.length - VIS), keepOff));
    else off = Math.max(0, Math.min(Math.max(0, bars.length - VIS), idx - Math.floor(VIS / 2)));
    // ★盈利区间: 入场时间 → 出场时间(用同一套单位换算)
    var marks = [], hlRange = null;
    if ((next.entryT !== null && next.entryT !== undefined)) {
      var et = +next.entryT, xt = (+next.exitT !== null && +next.exitT !== undefined) ? +next.exitT : +next.t;
      // 换算到 bars 的时间单位
      var unit = (bars.length && bars[0].t < 1e11) ? 1000 : 1;
      var etB = Math.abs(et * unit - bars[0].t) < Math.abs(et - bars[0].t) ? et * unit : et;
      var xtB = Math.abs(xt * unit - bars[0].t) < Math.abs(xt - bars[0].t) ? xt * unit : xt;
      marks.push({ t: etB, dir: 1, price: next.entryPx, label: '入场' });
      if ((next.exitT !== null && next.exitT !== undefined)) marks.push({ t: xtB, dir: -1, price: next.exitPx, label: '出场' });
      hlRange = { t0: etB, t1: xtB };
    }
    var draw = function () {
      if (!global.drawKline) return;
      global.drawKline(cv, {
        bars: bars, mainInd: 'chan', subInd: 'macd', height: 260,
        vis: VIS, off: off, chan: j.chan || null,
        marks: marks, hlRange: hlRange,
        stateKey: null,
        onHoverBar: function (b) {
          if (!b) { renderLegend(null); return; }
          var prev = null;
          for (var k = 0; k < bars.length; k++) if (bars[k].t === b.t) { prev = k > 0 ? bars[k - 1].c : b.o; break; }
          var chg = prev > 0 ? (b.c - prev) / prev * 100 : 0;
          var amp = prev > 0 ? (b.h - b.l) / prev * 100 : 0;
          renderLegend({ tstr: tsTxt(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, chg: chg, amp: amp });
        }
      });
    };
    ctrl = { bars: bars, off: off, VIS: VIS, draw: draw };
    requestAnimationFrame(function () {
      draw();
      if (subEl) subEl.textContent = (next.tf || '') + ' · ' + tsTxt(next.t) + (next.px ? ' · ' + fp(next.px) : '');
    });
  }

  /* 绑定：给任意表格行加 hover → 弹小窗 */
  // sel: 行选择器; getData: (tr) => ({inst, tf, t, px, label}) 或 null
  function bindRows(sel, getData) {
    var root = document.querySelector(sel);
    if (!root) return;
    root.addEventListener('mouseover', function (e) {
      lastPt = { x: e.clientX, y: e.clientY };      // 记住鼠标位置(光标跟随)
      var tr = e.target.closest ? e.target.closest('tr') : null;
      if (!tr || !root.contains(tr)) return;
      var d;
      try { d = getData(tr); } catch (err) { d = null; }
      if (!d || !d.inst) return;
      open(d, lastPt);
    });
    root.addEventListener('mouseout', function (e) {
      var tr = e.target.closest ? e.target.closest('tr') : null;
      if (!tr) return;
      if (!tr.isConnected) return;                  // ★刷新重绘后的旧行 → 不关窗
      var to = e.relatedTarget;
      if (to && tr.contains(to)) return;          // 还在同一行内 → 不关
      schedule();
    });
  }

  global.ChanPop = {
    open: open,
    close: close,
    bindRows: bindRows,
    setFetch: function (f) { FETCH = f; },
    setOnClose: function (f) { onClose = f; },
    setAutoRefresh: function (ms) { if (+ms > 0) AUTO_MS = +ms; },
    refresh: refresh
  };
})(typeof window !== 'undefined' ? window : globalThis);
