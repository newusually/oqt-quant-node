/* ============================================================================
 * web/js/ui/sentiment.js —— 【板块情绪组件】（总览页/板块页共用，自取数自渲染）
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）：
 *   "市场情绪 实时计算 要按板块分类 然后分别计算市场情绪才行"
 *
 * ★一个组件 = 总情绪仪表 + 各板块情绪列表（每板块单独一个 0-100 分）
 *   数据源: /api/boards/sentiment（板块聚合：涨跌家数 + taker 主动买比 + 动量）
 *   交互复用：悬停弹K线(ChanPop) / 点击进对应板块；数字变动闪烁
 * ★用法: Sentiment.mount({ gauge:'mood-score', arc:'mg-arc', ... , list:'sent-list' })
 * ========================================================================== */
(function (global) {
  'use strict';
  var Net = global.Net, ChanPop = function () { return global.ChanPop; };

  function esc(s) {
    return String((s === null || s === undefined) ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function cls(p) { return p > 0 ? 'up' : (p < 0 ? 'dn' : 'flat'); }
  function scoreCls(s) { return s >= 60 ? 'up' : s >= 40 ? 'flat' : 'dn'; }
  function $(id) { return document.getElementById(id); }

  /* 情绪分 → 颜色（与后端 labelOf 一致的兜底） */
  function colorOf(s) {
    if (s >= 75) return '#f0334b';
    if (s >= 60) return '#f06a7a';
    if (s >= 40) return '#f0a020';
    if (s >= 25) return '#3d9be8';
    return '#0bbf7a';
  }

  /* ---------------- 总情绪仪表 + 概览条 ---------------- */
  var PREV = {};
  function flashVal(key, val) {
    var p = PREV[key]; PREV[key] = val;
    return ((p !== null && p !== undefined) && p !== val) ? (val > p ? ' flash-up' : ' flash-dn') : '';
  }
  function renderGauge(all) {
    if (!all) return;
    var sc = $('mood-score');
    if (sc) {
      var f = flashVal('sent:score', all.score);
      sc.textContent = all.score;
      sc.className = scoreCls(all.score) + f;
    }
    var lb = $('mood-label');
    if (lb) lb.textContent = all.label + ' · ' + (all.count || 0) + ' 合约';
    var arc = $('mg-arc');
    if (arc) {
      arc.setAttribute('stroke', colorOf(all.score));
      arc.setAttribute('stroke-dashoffset', String(220 - 220 * all.score / 100));
    }
    // 概览条：上涨/下跌/主动买占比
    var up = all.up || 0, down = all.down || 0, tot = Math.max(1, up + down);
    var elUp = $('mb-up');
    if (elUp) { elUp.textContent = up + ' 个'; }
    var elDn = $('mb-down');
    if (elDn) { elDn.textContent = down + ' 个'; }
    var fUp = $('mb-up-f'); if (fUp) fUp.style.width = (up / tot * 100).toFixed(1) + '%';
    var fDn = $('mb-down-f'); if (fDn) fDn.style.width = (down / tot * 100).toFixed(1) + '%';
    // 顶部直播条情绪
    var m = $('lb-mood');
    if (m) { m.textContent = all.label + ' ' + all.score; m.className = cls(all.score - 50); }
  }

  /* ---------------- 板块情绪列表 ---------------- */
  function renderList(sectors) {
    var box = $('sent-list');
    if (!box) return;
    if (!sectors || !sectors.length) {
      box.innerHTML = '<div class="bd-empty sm">板块情绪计算中（数据源预热）…</div>';
      return;
    }
    box.innerHTML = sectors.map(function (s, i) {
      var col = colorOf(s.score);
      return '<div class="sent-row" data-sid="' + esc(s.sector) + '" title="点击查看' + esc(s.name) + '板块面板">' +
        '<span class="sent-no">' + (i + 1) + '</span>' +
        '<span class="sent-nm">' + esc(s.icon || '') + ' ' + esc(s.name) +
        '<i>' + s.count + ' 合约 · ' + s.up + '涨/' + s.down + '跌</i></span>' +
        '<span class="sent-bar"><b style="width:' + s.score.toFixed(0) + '%;background:' + col + '"></b></span>' +
        '<span class="sent-tk">买 ' + ((s.takerBuy === null || s.takerBuy === undefined) ? '-' : s.takerBuy + '%') + '</span>' +
        '<span class="sent-score" style="color:' + col + '">' + s.score + '</span>' +
        '<span class="sent-lab" style="color:' + col + '">' + esc(s.label) + '</span>' +
        '</div>';
    }).join('');
  }

  /* ---------------- 取数（组件自取数，页面零逻辑） ---------------- */
  var TIMER = null;
  function refresh() {
    return Net.get('/api/boards/sentiment?bars=1', { ttl: 3000 }).then(function (j) {
      if (!j || !j.ok) return null;
      renderGauge(j.all);
      renderList(j.sectors || []);
      var sub = $('sent-sub');
      if (sub && j.sectors && j.sectors.length) {
        sub.textContent = '按板块实时计算 · ' + j.sectors.length + ' 个板块 · 更新于 ' +
          new Date(j.at).toLocaleTimeString('zh-CN');
      }
      return j;
    }).catch(function () { return null; });
  }

  /* ---------------- 挂载 ---------------- */
  function mount(opt) {
    opt = opt || {};
    var box = $('sent-list');
    if (box && !box.__sentBound) {
      box.__sentBound = true;
      box.addEventListener('click', function (e) {
        var row = e.target.closest ? e.target.closest('.sent-row') : null;
        if (!row) return;
        var sid = row.getAttribute('data-sid');
        if (sid && global.SectorsApi) global.SectorsApi.show(sid);
      });
    }
    refresh();
    if (TIMER) clearInterval(TIMER);
    TIMER = setInterval(refresh, opt.interval || 5000);
  }

  global.Sentiment = { mount: mount, refresh: refresh, renderGauge: renderGauge, renderList: renderList };
})(typeof window !== 'undefined' ? window : globalThis);
