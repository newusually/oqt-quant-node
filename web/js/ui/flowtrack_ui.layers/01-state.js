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
