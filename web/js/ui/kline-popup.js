/* ============================================================================
 * web/js/ui/kline-popup.js —— ★独立「悬浮窗 K线」共享组件
 * BUILD 20261109a
 *
 * 定位：任何表格/面板点合约名都能弹的悬浮窗，且【与总览 K线图完全一模一样】。
 *   · 复用总览 K线引擎 global.KChart.create() → 自带
 *       ① 6 个工具栏按钮：⏮最新 / ←历史 / →更新 / ＋放大 / －缩小 / ⤢全部 + 视口状态
 *       ② 光标十字线 + OHLC 悬浮窗（ind-engine 按 canvas 绑定，自动生效）
 *       ③ 拖拽左右平移 / 滚轮缩放 / 双击复位
 *   · 复用共享信号灯 global.TradeSignals（五态：买多/卖空/买多加仓/卖空加仓/平仓），
 *     按 canvas id 隔离 marks，悬浮窗与总览同时打开互不串信号；
 *     标记锚定【真实成交价】，同根同类事件合并 ×N 且水平错开防叠加。
 *   · 复用总览 K线主图 global.drawKline（MA/缠论/角度/QAMarks 全部一致）。
 *
 * 数据源：
 *   /api/okx/kline?inst=&tf=      → { bars:[{t,o,h,l,c,v}] }   ★字段是 bars / t
 *   /api/okx/pyr_marks?inst=      → { rows:[{ts,event,dir,px}] }（不带 tf = 该合约全部四类事件）
 *
 * 修复记录（2026-11-08）：旧悬浮窗用 Tip.kline(ECharts)，且把响应读成
 *   kj.candles / c.ts → 实际是 bars / t，数组恒为空 → 看不到 K线、看不到信号；
 *   同时 ECharts 版本也没有总览那排工具按钮。本组件彻底替换。
 *
 * 用法：global.KlinePopup.open('BTC-USDT-SWAP', { tf: '15m' })
 * ========================================================================== */
(function (global) {
  'use strict';

  var CV_ID = 'klp-kcv';                 // canvas id → TradeSignals marks 按 id 隔离
  var RIGHT_PAD = 40;                    // ★允许拖过最新 K线后右侧留白 40 根（不再拖到最右就卡死）
  var TFS = [
    { id: '1m', label: '分时' }, { id: '3m', label: '3分钟' },
    { id: '5m', label: '5分钟' }, { id: '15m', label: '15分钟' },
    { id: '30m', label: '30分钟' }, { id: '1h', label: '1小时' },
    { id: '2h', label: '2小时' }, { id: '4h', label: '4小时' },
    { id: '1d', label: '日线' }
  ];
  var EV = {
    buy:       { label: '买多',     color: '#ff6b7d', sym: '▲' },
    sell:      { label: '卖空',     color: '#31c99a', sym: '▼' },
    add_long:  { label: '买多加仓', color: '#f0a020', sym: '◆' },
    add_short: { label: '卖空加仓', color: '#c07ae0', sym: '◆' },
    close:     { label: '平仓',     color: '#4f8cff', sym: '📍' }
  };
  /* ★加仓按方向细分：买多加仓 / 卖空加仓，不再笼统显示「加仓」 */
  function evKey(e) {
    if (e && e.event === 'add') return (+e.dir > 0) ? 'add_long' : 'add_short';
    return (e && e.event) || ((e && +e.dir > 0) ? 'buy' : 'sell');
  }

  var mask = null, pop = null, chart = null;
  var curInst = '', curTf = '15m', bars = [], marks = [];
  var cssDone = false, reqSeq = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function tfName(id) {
    for (var i = 0; i < TFS.length; i++) if (TFS[i].id === id) return TFS[i].label;
    return id || '';
  }

  /* --------------------------------------------------------------- 样式 */
  function css() {
    if (cssDone) return;
    cssDone = true;
    var st = document.createElement('style');
    st.id = 'klp-css';
    st.textContent =
      '#klp-mask{position:fixed;inset:0;background:rgba(6,10,18,.72);z-index:10000;display:none}' +
      '#klp-pop{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
        'width:min(1100px,96vw);height:min(730px,94vh);background:#0e1728;' +
        'border:1px solid #3d7bff;border-radius:14px;z-index:10001;display:none;' +
        'flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.55);overflow:hidden}' +
      '#klp-pop .klp-hd{display:flex;align-items:center;gap:10px;padding:10px 14px;' +
        'border-bottom:1px solid #263553;flex:none}' +
      '#klp-pop .klp-hd .t{font-size:15px;color:#cfe0ff;font-weight:700}' +
      '#klp-pop .klp-hd .x{margin-left:auto;cursor:pointer;color:#8b9abc;font-size:20px;' +
        'line-height:1;padding:0 6px}' +
      '#klp-pop .klp-hd .x:hover{color:#fff}' +
      '#klp-pop .klp-tabs{display:flex;gap:6px;padding:8px 14px;flex-wrap:wrap;' +
        'border-bottom:1px solid #1e2b45;flex:none}' +
      '#klp-pop .klp-tab{padding:4px 11px;border:1px solid #2b3f63;border-radius:16px;' +
        'background:#16233b;color:#a9c2ee;cursor:pointer;font-size:12px;user-select:none}' +
      '#klp-pop .klp-tab:hover{background:#22304f;border-color:#4f7fd8}' +
      '#klp-pop .klp-tab.on{background:#3d7bff;border-color:#3d7bff;color:#fff;font-weight:700}' +
      '#klp-pop .klp-body{flex:1;overflow:auto;padding:8px 12px 12px}' +
      '#klp-kbox{width:100%}' +
      '#klp-kcv{width:100%;display:block;background:#0e1422;border-radius:8px}' +
      '#klp-pop .klp-msg{padding:10px 4px;color:#8b94ad;font-size:12.5px;text-align:center}' +
      '#klp-pop .klp-msg.err{color:#ff8a95}' +
      '#klp-pop .klp-ft{flex:none;display:flex;align-items:center;gap:14px;flex-wrap:wrap;' +
        'padding:8px 14px;border-top:1px solid #263553;font-size:12px;color:#8b9abc}' +
      '#klp-pop .klp-ft b{color:#cfe0ff;margin:0 2px}' +
      '#klp-pop .klp-ft .lg{font-weight:700}';
    document.head.appendChild(st);
  }

  /* --------------------------------------------------------------- DOM */
  function ensureDom() {
    if (mask && pop) return;
    mask = document.createElement('div');
    mask.id = 'klp-mask';
    document.body.appendChild(mask);

    pop = document.createElement('div');
    pop.id = 'klp-pop';
    pop.innerHTML =
      '<div class="klp-hd"><span class="t" id="klp-t"></span><span class="x" id="klp-x" title="关闭">×</span></div>' +
      '<div class="klp-tabs" id="klp-tabs"></div>' +
      '<div class="klp-body">' +
        '<div id="klp-kbox"><canvas id="' + CV_ID + '"></canvas></div>' +
        '<div class="klp-msg" id="klp-msg"></div>' +
      '</div>' +
      '<div class="klp-ft" id="klp-ft"></div>';
    document.body.appendChild(pop);

    mask.onclick = close;
    document.getElementById('klp-x').onclick = close;
    /* Esc 关闭 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && pop.style.display !== 'none') close();
    });
  }

  function renderTabs() {
    var el = document.getElementById('klp-tabs');
    if (!el) return;
    el.innerHTML = TFS.map(function (f) {
      return '<span class="klp-tab' + (f.id === curTf ? ' on' : '') + '" data-tf="' + f.id + '">' +
        esc(f.label) + '</span>';
    }).join('');
    [].forEach.call(el.querySelectorAll('.klp-tab'), function (t) {
      t.onclick = function () {
        var f = t.getAttribute('data-tf');
        if (f === curTf) return;
        curTf = f;
        renderTabs();
        load();
      };
    });
  }

  /* --------------------------------------------------------------- 数据 */
  function msg(text, isErr) {
    var el = document.getElementById('klp-msg');
    if (!el) return;
    el.className = 'klp-msg' + (isErr ? ' err' : '');
    el.textContent = text || '';
  }

  function load() {
    if (!curInst) return;
    var seq = ++reqSeq;
    /* ★快照合约/周期：连续点两个合约时，旧请求结果绝不能覆盖新合约 */
    var inst = curInst, tf = curTf;
    msg('加载 ' + esc(inst) + ' · ' + esc(tfName(tf)) + ' K线 / 信号…');
    var kurl = '/api/okx/kline?inst=' + encodeURIComponent(inst) +
      '&tf=' + encodeURIComponent(tf) + '&limit=600&t=' + Date.now();
    /* 不带 tf：拿该合约【全部周期】四类事件，切周期时信号不会消失 */
    var murl = '/api/okx/pyr_marks?inst=' + encodeURIComponent(inst) + '&t=' + Date.now();

    Promise.all([
      fetch(kurl).then(function (r) { return r.json(); }),
      fetch(murl).then(function (r) { return r.json(); }).catch(function () { return { rows: [] }; })
    ]).then(function (res) {
      if (seq !== reqSeq || inst !== curInst) return;  // 过期 / 串合约请求丢弃
      var kj = res[0] || {}, mj = res[1] || {};
      /* ★防串合约：后端返回的 inst 必须与请求完全一致，否则宁可报错也不画错图 */
      if (kj.ok && kj.inst && String(kj.inst).toUpperCase() !== inst) {
        msg('合约不匹配：请求 ' + esc(inst) + ' / 返回 ' + esc(kj.inst), true);
        return;
      }
      /* ★关键修复：接口返回 bars:[{t,o,h,l,c,v}]，不是 candles / ts */
      var raw = (kj.bars || []).slice();
      raw.sort(function (a, b) { return (+a.t) - (+b.t); });
      bars = raw.map(function (b) {
        return { t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v };
      });
      var evs = (mj.rows || []);
      marks = evs.map(function (e) {
        return {
          ts: +e.ts, event: e.event,
          dir: (+e.dir > 0 ? 1 : -1), price: +e.px
        };
      }).filter(function (m) { return isFinite(m.ts) && isFinite(m.price); });

      if (!bars.length) { msg('该合约 ' + esc(inst) + ' ' + tfName(tf) + ' 暂无 K线数据', true); return; }
      if (mj.ok === false) msg('信号接口异常：' + esc(mj.err || ''), true);
      else msg('');

      /* 四态信号灯：按 canvas id 隔离，不与总览 K线串 */
      if (global.TradeSignals && global.TradeSignals.setMarks) global.TradeSignals.setMarks(marks, CV_ID);
      renderChart();
      renderFoot();
    }).catch(function (e) {
      if (seq !== reqSeq || inst !== curInst) return;
      msg('K线加载失败：' + esc(e && e.message || e), true);
    });
  }

  /* --------------------------------------------------------------- 绘图 */
  function renderChart() {
    if (!global.KChart || !global.drawKline) {
      msg('总览 K线引擎未加载（KChart / drawKline）', true);
      return;
    }
    var kbox = document.getElementById('klp-kbox');
    var cv = document.getElementById(CV_ID);
    if (!kbox || !cv) return;

    var stateKey = 'klp:' + curInst + ':' + curTf;
    var drawFn = function () {
      return {
        bars: bars,
        mainInd: 'ma', subInd: 'macd',
        noSub: true, height: 400,
        marks: [], links: [], drawings: [],
        extraTitle: function () { return ''; },
        extraRows: function () { return []; }
      };
    };

    if (!chart) {
      chart = global.KChart.create(kbox, {
        canvas: cv,                     /* 复用已有 canvas → 工具栏落在 K线图下方，与总览一致 */
        height: 400,
        stateKey: stateKey,
        defVis: 120,
        label: curInst + ' ' + curTf,
        tools: true,                    /* ★6 个工具按钮（⏮←→＋－⤢）+ 视口状态 */
        rightPad: RIGHT_PAD,            /* ★拖过最新后右侧留白，可继续往右拖 */
        draw: drawFn
      });
    } else {
      chart.o.stateKey = stateKey;
      chart.o.label = curInst + ' ' + curTf;
      chart.o.draw = drawFn;
      chart.o.defVis = 120;             // ★换合约复位默认可视根数
      chart.o.rightPad = RIGHT_PAD;     // ★复用已有 chart 时也要同步右侧留白，否则 _minOff() 会退回旧值
      if (chart.state.key !== stateKey) chart.state.key = null;   // 换合约/周期复位视口
    }
    if (chart) chart.setBars(bars);
  }

  function renderFoot() {
    var el = document.getElementById('klp-ft');
    if (!el) return;
    var cnt = { buy: 0, sell: 0, add_long: 0, add_short: 0, close: 0 };
    marks.forEach(function (m) { var k = evKey(m); if (cnt[k] !== undefined) cnt[k]++; });
    /* ★加仓细分：买多加仓 / 卖空加仓 各自计数与图例 */
    var lg = Object.keys(EV).map(function (k) {
      return '<span class="lg" style="color:' + EV[k].color + '">' +
        EV[k].sym + EV[k].label + '</span> <b>' + cnt[k] + '</b>';
    }).join('　');
    el.innerHTML = '<span>' + esc(curInst) + ' · ' + esc(tfName(curTf)) + ' · K线 <b>' + bars.length +
      '</b> 根 · 事件合计 <b>' + marks.length + '</b> · 标记锚定成交价 · 加仓规则：每满4小时且逆向偏离≥1%</span>' + lg +
      '<span style="margin-left:auto">滚轮以【光标所在 K线】为圆心缩放 · 双击复位 · 标记缩小/虚线 · 悬停看 OHLC</span>';
  }

  /* --------------------------------------------------------------- 对外 */
  function open(inst, opts) {
    opts = opts || {};
    css();
    ensureDom();
    curInst = String(inst || '').toUpperCase();
    curTf = opts.tf || '15m';
    mask.style.display = 'block';
    pop.style.display = 'flex';         // 先显示 → canvas 才有宽度，绘图不会算成 0
    /* ★换合约先清空：绝不让上一个合约的 K线/信号残留在新标题下
     *   （旧版末尾 chart.redraw() 会用旧 bars 重画，正是「弹窗合约不对」的元凶之一） */
    bars = []; marks = [];
    if (global.TradeSignals && global.TradeSignals.setMarks) global.TradeSignals.setMarks([], CV_ID);
    if (chart) {
      try {
        /* ★换合约复位缩放级别与锚点：不继承上一张图的放大倍数/鼠标位置，
         *   否则新合约会画在「不对应的 K线范围」（与总览 K线同步修复）。 */
        chart.state.vis = 120;
        chart.state.off = 0;
        chart._lastX = null;
        chart.setBars([]);
      } catch (e) { }
    }
    document.getElementById('klp-t').textContent =
      curInst + ' · K线（买多 / 卖空 / 买多加仓 / 卖空加仓 / 平仓）';
    renderTabs();
    load();
  }

  function close() {
    if (mask) mask.style.display = 'none';
    if (pop) pop.style.display = 'none';
  }

  global.KlinePopup = { open: open, close: close };
})(typeof window !== 'undefined' ? window : globalThis);
