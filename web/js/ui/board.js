/* ============================================================================
 * web/js/ui/board.js —— 【榜单组件】（所有板块页面共用，一行代码渲染一个榜）
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）：
 *   "涨跌幅榜单必须左右两边对称放在一行并列"
 *   "涨幅榜和跌幅榜不对 应该按1D来算 当日的1D涨跌才算涨幅榜"
 *   "还要增加5分钟涨跌幅度榜单 1分钟涨跌幅度榜单"
 *   "5分钟买卖takervol比例榜单 15分钟买卖takervol榜单"
 *   "各类ajax组件复用 ... 所有面板 都给我组件化"
 *
 * ★复用点：任何页面要榜单，只调 Board.pair() / Board.load()，
 *   不需要各自写渲染逻辑；数据来源统一是 /api/boards/*。
 * ★左右对称：涨幅榜在左、跌幅榜在右，同一行 grid 两列（用户明确要求）
 * ★交互复用：悬停弹 K 线(ChanPop)、点击进对应模块页，各榜自动带上
 * ========================================================================== */
(function (global) {
  'use strict';
  var Net = global.Net;

  function esc(s) {
    return String((s === null || s === undefined) ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function cls(p) { return p > 0 ? 'up' : (p < 0 ? 'dn' : 'flat'); }
  function arrow(p) { return p >= 0 ? '▲' : '▼'; }

  // 点击进对应页面（全部是 OKX 永续 → 统一进 OKX 页）
  function hrefOf(x) {
    return '/modules/okx/web/index.html?inst=' + encodeURIComponent(x.code || '');
  }

  /* ---------------- ★分类标签（用户 2026-10-25 第三轮）
   *   "涨幅榜跌幅榜 各种面板要写清楚 分类是什么 比如合约涨幅榜 还有各种类型 要写清楚分类啊"
   *   → 每个榜单都带 3 个维度：范围(市场/板块) + 指标(涨跌幅/成交) + 周期(1D/5m/1m)
   *   cat: {scope:'全市场', metric:'涨跌幅', tf:'1D'} → 渲染成一排小标签
   */
  function catHTML(cat) {
    if (!cat) return '';
    var items = [];
    if (cat.scope) items.push(['范围', cat.scope]);
    if (cat.metric) items.push(['指标', cat.metric]);
    if (cat.tf) items.push(['周期', cat.tf]);
    if (!items.length) return '';
    return '<span class="bd-cats">' + items.map(function (x) {
      return '<span class="bd-cat"><i>' + esc(x[0]) + '</i>' + esc(x[1]) + '</span>';
    }).join('') + '</span>';
  }

  /* ---------------- 单行 ---------------- */
  function rowHTML(x, i, opt) {
    opt = opt || {};
    var p = x.pct;
    var showArrow = opt.arrow !== false;
    return '<div class="bd-row" data-code="' + esc(x.code) + '" data-href="' + esc(hrefOf(x)) + '"' +
      (opt.pop === false ? '' : ' title="悬停看5分钟K线 · 点击打开"') + '>' +
      '<span class="bd-no">' + (i + 1) + '</span>' +
      '<span class="bd-name">' + esc(x.name || x.sym) + '<i class="bd-sym">' + esc(x.sym || '') + '</i></span>' +
      '<span class="bd-px num">' + esc(x.pxText || '-') + '</span>' +
      '<span class="bd-pct num ' + cls(p) + '">' + (showArrow ? arrow(p) + ' ' : '') + esc(x.pctText || '-') + '</span>' +
      '</div>';
  }

  /* ---------------- 单榜（涨幅榜 或 跌幅榜，容器较窄时用）---------------- */
  // data: {gain:[], lose:[]}
  function pair(el, data, opt) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    opt = opt || {};
    var g = (data && data.gain) || [], l = (data && data.lose) || [];
    var n = opt.limit || 10;
    g = g.slice(0, n); l = l.slice(0, n);
    if (!g.length && !l.length) { el.innerHTML = '<div class="bd-empty">该窗口暂无数据（数据源启动中）</div>'; return; }
    el.innerHTML =
      '<div class="bd-pair">' +
      '<div class="bd-box"><div class="bd-hd"><span class="bd-tag up">涨幅榜</span>' +
      '<span class="bd-sub">' + esc(opt.label || '') + '</span>' + catHTML(opt.cat) + '</div>' +
      '<div class="bd-body">' + (g.length ? g.map(function (x, i) { return rowHTML(x, i, opt); }).join('') : '<div class="bd-empty sm">无</div>') + '</div></div>' +
      '<div class="bd-box"><div class="bd-hd"><span class="bd-tag dn">跌幅榜</span>' +
      '<span class="bd-sub">' + esc(opt.label || '') + '</span>' + catHTML(opt.cat) + '</div>' +
      '<div class="bd-body">' + (l.length ? l.map(function (x, i) { return rowHTML(x, i, opt); }).join('') : '<div class="bd-empty sm">无</div>') + '</div></div>' +
      '</div>';
    bind(el, opt);
  }

  /* ---------------- 单榜（涨幅榜 或 跌幅榜，容器较窄时用）---------------- */
  function list(el, rows, opt) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    opt = opt || {};
    var rs = (rows || []).slice(0, opt.limit || 10);
    if (!rs.length) { el.innerHTML = '<div class="bd-empty">该窗口暂无数据</div>'; return; }
    el.innerHTML =
      '<div class="bd-box one"><div class="bd-hd">' +
      '<span class="bd-tag ' + (opt.dir === 'lose' ? 'dn' : 'up') + '">' + esc(opt.title || '榜单') + '</span>' +
      '<span class="bd-sub">' + esc(opt.label || '') + '</span>' + catHTML(opt.cat) + '</div>' +
      '<div class="bd-body">' + rs.map(function (x, i) { return rowHTML(x, i, opt); }).join('') + '</div>' +
      '</div>';
    bind(el, opt);
  }

  /* ---------------- 交互绑定（复用：悬停弹K线 + 点击进入）---------------- */
  /* ★opt.onPick: 点击行时回调（OKX 页用它切换当前合约，而不是跳转页面） */
  function bind(root, opt) {
    opt = opt || {};
    if (!root || root.__bdBound) return;
    root.__bdBound = true;
    root.addEventListener('mouseover', function (e) {
      var row = e.target.closest ? e.target.closest('.bd-row') : null;
      if (!row || !root.contains(row)) return;
      var code = row.getAttribute('data-code');
      if (!code || !global.ChanPop) return;
      var nm = row.querySelector('.bd-name');
      global.ChanPop.open({
        inst: code, tf: '5m', t: Date.now(), px: null,
        label: (nm ? nm.textContent.trim().replace(/\s+/g, ' ') : code) + ' · 5分钟'
      }, { x: e.clientX, y: e.clientY });
    });
    root.addEventListener('mouseout', function (e) {
      var row = e.target.closest ? e.target.closest('.bd-row') : null;
      if (!row) return;
      if (!row.isConnected) return;
      var to = e.relatedTarget;
      if (to && row.contains(to)) return;
      if (global.ChanPop) global.ChanPop.close();
    });
    root.addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.bd-row') : null;
      if (!row) return;
      var code = row.getAttribute('data-code');
      /* ★优先走回调（页内切换），没有回调才跳转 */
      if (opt.onPick && code) { opt.onPick(code, row); return; }
      var href = row.getAttribute('data-href');
      if (href) location.href = href;
    });
  }

  /* ---------------- 取数 + 渲染 一步到位（组件自取数，页面零逻辑）----------------
   * Board.load(el, {kind:'1d', sector:'l1', limit:10, ttl:3000})
   * → 内部走 Net(请求合并+并发队列+缓存)，渲染左右对称双榜 */
  function load(el, opt) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return Promise.resolve(null);
    opt = opt || {};
    var kind = opt.kind || '1d';
    var url = '/api/boards/board?kind=' + encodeURIComponent(kind) +
      '&sector=' + encodeURIComponent(opt.sector || '') +
      '&limit=' + (opt.limit || 10);
    return Net.get(url, { ttl: (opt.ttl === null || opt.ttl === undefined) ? 2500 : opt.ttl }).then(function (j) {
      if (!j || !j.ok) { if (el) el.innerHTML = '<div class="bd-empty">数据源未就绪</div>'; return null; }
      pair(el, j, opt);
      return j;
    }).catch(function () {
      // 失败保留上次渲染内容（网络抖动不白屏）
      return null;
    });
  }

  global.Board = {
    pair: pair, list: list, load: load, catHTML: catHTML,
    rowHTML: rowHTML, bind: bind, hrefOf: hrefOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
