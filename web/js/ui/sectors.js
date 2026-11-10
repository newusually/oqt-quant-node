/* ============================================================================
 * web/js/ui/sectors.js —— 【板块标签组件】（复用 Panel，页面上只保留 1 个活跃请求）
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）：
 *   "所有板块页面 所有面板 都给我组件化 都给我复用"
 *   "可以ajax速度快 网页并发"
 *
 * ★为什么用标签而不是把 10 个板块全铺在页面上：
 *   10 个面板同时刷新 = 10 个请求持续抢并发额度 + 10 份 ECharts 实例常驻 → 卡
 *   标签切换：同一时刻只挂载【当前 1 个】面板 → 请求数 1，图表实例少量
 *
 *   Sectors.mount('tabsEl', 'panelEl', {
 *     list: [{id:'l1', title:'公链层', icon:'⛓'}, ...],
 *     kinds:['1d','5m','1m'],
 *     charts:[{type:'bar',from:'barRank',title:'涨幅TOP10'}, ...]
 *   });
 * ========================================================================== */
(function (global) {
  'use strict';
  var Panel = global.Panel, EKit = global.EKit;

  function esc(s) {
    return String((s === null || s === undefined) ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function mount(tabsEl, panelEl, opt) {
    if (typeof tabsEl === 'string') tabsEl = document.getElementById(tabsEl);
    if (typeof panelEl === 'string') panelEl = document.getElementById(panelEl);
    if (!tabsEl || !panelEl) return null;
    var list = opt.list || [];
    var curId = null, curApi = null;

    tabsEl.innerHTML = list.map(function (s, i) {
      return '<span class="sct-tab' + (i === 0 ? ' on' : '') + '" data-id="' + esc(s.id) + '">' +
        esc(s.icon) + ' ' + esc(s.title) + '</span>';
    }).join('');

    function show(id, force) {
      if (id === curId && !force) return;
      var s = list.filter(function (x) { return x.id === id; })[0];
      if (!s) return;
      // 切走时销毁旧面板（清定时器 + 释放 ECharts 实例，防泄漏）
      if (curApi) { curApi.destroy(); curApi = null; }
      panelEl.innerHTML = '';
      curId = id;
      Array.prototype.forEach.call(tabsEl.children, function (el) {
        el.classList.toggle('on', el.getAttribute('data-id') === id);
      });
      curApi = Panel.mount(panelEl, {
        sector: s.id,
        title: s.title, icon: s.icon,
        kinds: s.kinds || opt.kinds,
        charts: s.charts || opt.charts,
        interval: s.interval || opt.interval || 10000,
        cardLimit: opt.cardLimit || 8,
        boardLimit: opt.boardLimit || 10,
        takerLimit: opt.takerLimit || 8
      });
    }

    tabsEl.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.sct-tab') : null;
      if (!el || !tabsEl.contains(el)) return;
      show(el.getAttribute('data-id'));
    });

    // 首屏：延迟一拍再挂，先把页面骨架让出去（首屏更快）
    if (list.length) {
      setTimeout(function () { show(list[0].id); }, 60);
    }

    return {
      show: show,
      current: function () { return curId; },
      api: function () { return curApi; },
      refresh: function () { if (curApi) curApi.refresh(); }
    };
  }

  global.Sectors = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
