/* 01-state.js — 状态层：常量 / 选项卡 / 事件映射 / 通用格式化
 * 本文件由浏览器端组合器 /web/js/ui/flowtrack.js 载入，10 层共享同一函数作用域。
 * 请勿单独 <script> 引入；改动后运行 node --check。 */
'use strict';
  var BOX = 'flowtrack-panel';
  var CSS_IN = false, pollTimer = null, lastCurve = [];
  var RIGHT_PAD = 20;                     // 最新右侧留白点数（解决「最新曲线拖不动」）
  var DEF_VIS = 60;                       // 默认可见点数
  var curveState = { off: 0, vis: DEF_VIS, anchorX: null };  // off>0=看历史, off<0=右侧留白; anchorX=缩放圆心
  var cv = null, cvCtx = null, cvTip = null, curveBound = false, curveDrag = null, curveHover = -1;
  var activePage = 1, activeSort = '', tfFilter = 'all', evFilter = 'all';
  /* 只保留 15m */
  var TF_TABS = [
    { id: 'all', label: '全部周期' }, { id: '15m', label: '15分钟' }
  ];
  var EV_TABS = [
    { id: 'all', label: '全部事件' }, { id: 'buy', label: '买多' }, { id: 'sell', label: '卖空' },
    { id: 'add_long', label: '买多加仓' }, { id: 'add_short', label: '卖空加仓' }, { id: 'close', label: '平仓' }
  ];
  /* ★五态事件：加仓必须区分「买多加仓 / 卖空加仓」 */
  var EV = {
    buy:       { label: '买多',     color: '#ff6b7d', sym: '▲' },
    sell:      { label: '卖空',     color: '#31c99a', sym: '▼' },
    add_long:  { label: '买多加仓', color: '#f0a020', sym: '◆' },
    add_short: { label: '卖空加仓', color: '#c07ae0', sym: '◆' },
    close:     { label: '平仓',     color: '#4f8cff', sym: '📍' }
  };
  function evKey(r) {
    if (r && r.event === 'add') return r.dir === '空' ? 'add_short' : 'add_long';
    return (r && r.event) || 'buy';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(v, d) {
    if (v == null || !isFinite(v)) return '—';
    return (+v).toFixed(d === undefined ? 2 : d);
  }
  function sgn(v, d) {
    if (v == null || !isFinite(v)) return '—';
    var n = +v;
    return (n > 0 ? '+' : '') + n.toFixed(d === undefined ? 1 : d);
  }
  function cls(v) { return v > 0 ? 'up' : (v < 0 ? 'dn' : 'flat'); }
  function dt(ms) { return ms ? new Date(ms).toLocaleString() : '—'; }
  function tf(ms) { return ms ? new Date(ms).toLocaleTimeString() : ''; }
  function tfName(id) { return id === '15m' ? '15分钟' : id === '30m' ? '30分钟' : id === '1h' ? '1小时' : (id || ''); }

  /* ★列配色板：每个列表列头不同颜色背景+文字，单元格同色淡底；行 hover 高亮由 CSS 处理。 */
  var COL_PALETTE = [
    { bg: '#27406e', fg: '#eaf2ff', cell: 'rgba(39,64,110,.20)' },
    { bg: '#5b3a78', fg: '#f3e6ff', cell: 'rgba(91,58,120,.20)' },
    { bg: '#1f5f52', fg: '#d9fff2', cell: 'rgba(31,95,82,.20)' },
    { bg: '#7a4a1f', fg: '#ffe9d2', cell: 'rgba(122,74,31,.20)' },
    { bg: '#7a1f49', fg: '#ffd9ec', cell: 'rgba(122,31,73,.20)' },
    { bg: '#1f5a78', fg: '#d6f3ff', cell: 'rgba(31,90,120,.20)' },
    { bg: '#4f6b1f', fg: '#eeffd6', cell: 'rgba(79,107,31,.20)' },
    { bg: '#6b5a1f', fg: '#fff6d6', cell: 'rgba(107,90,31,.20)' },
    { bg: '#3a6b1f', fg: '#ecffd6', cell: 'rgba(58,107,31,.20)' },
    { bg: '#1f467a', fg: '#d6e6ff', cell: 'rgba(31,70,122,.20)' },
    { bg: '#7a2626', fg: '#ffd6d6', cell: 'rgba(122,38,38,.20)' },
    { bg: '#1f6b4a', fg: '#d6ffea', cell: 'rgba(31,107,74,.20)' }
  ];
  /* 给表格上色：列头多彩背景+文字，单元格淡色同色底。 */
  function paintTable(tbl) {
    if (!tbl) return;
    var ths = tbl.querySelectorAll('thead th');
    for (var i = 0; i < ths.length; i++) {
      var c = COL_PALETTE[i % COL_PALETTE.length];
      ths[i].style.background = c.bg; ths[i].style.color = c.fg;
    }
    var trs = tbl.querySelectorAll('tbody tr');
    for (var r = 0; r < trs.length; r++) {
      var tds = trs[r].querySelectorAll('td');
      if (tds.length === 1 && tds[0].getAttribute('colspan')) continue;  // 空态合并行跳过
      for (var i = 0; i < tds.length; i++) {
        tds[i].style.background = COL_PALETTE[i % COL_PALETTE.length].cell;
      }
    }
  }
  /* 整行点击弹共享K线（点击合约名本身由 .inst 处理，避免重复） */
  function bindRowClicks(root) {
    if (!root || !root.querySelectorAll) return;
    [].forEach.call(root.querySelectorAll('tr.r'), function (tr) {
      var inst = tr.getAttribute('data-inst');
      if (!inst) return;
      tr.style.cursor = 'pointer';
      tr.onclick = function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('inst')) return;
        openSharedKline(inst);
      };
    });
  }
  function fmtPct(v) {
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + (+v).toFixed(2) + '%';
  }
  /* 最新一次 flowtrack 统计 + 未平仓持仓，供持仓列表 / AI 总览表使用 */
  var lastSummary = null, lastOpen = [];
