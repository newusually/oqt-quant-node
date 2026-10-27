/* ============================================================================
 * web/js/ui/backfill.js —— ★历史回补进度面板（2026-10-26）
 * ----------------------------------------------------------------------------
 * 用户需求："写一个回补数据的进度的面板在最下面 ... 什么合约名称 进度条到百分之多少了
 *            还差多少 大概预计多久完成 ... 每页显示10行 ... 还可以分类筛选
 *            已经完成的 完成不到一半的 还有大部分完成的 ... 选项卡筛选"
 *
 * 数据：GET /api/okx/backfillprogress?grain=&filter=&page=&size=&q=&sort=
 * ========================================================================== */
(function (global) {
  'use strict';

  var GRAINS = [['3m', '3分钟'], ['5m', '5分钟'], ['15m', '15分钟'], ['1h', '1小时'], ['2h', '2小时'], ['4h', '4小时']];
  var FILTERS = [
    ['all', '全部'], ['done', '已完成'], ['most', '大部分完成'],
    ['half', '不到一半'], ['none', '未开始'], ['undone', '未完成']
  ];
  var STATUS_TXT = { done: '已完成', most: '大部分完成', half: '不到一半', none: '未开始' };
  var S = { grain: '1h', filter: 'all', page: 1, size: 10, q: '', sort: 'progress', timer: 0, box: null, loading: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String((s === null || s === undefined) ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function nf(n) { return (n === null || n === undefined || !isFinite(n)) ? '-' : Number(n).toLocaleString('zh-CN'); }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return sec + ' 秒';
    if (sec < 3600) return Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒';
    if (sec < 86400) return Math.floor(sec / 3600) + ' 小时 ' + Math.floor((sec % 3600) / 60) + ' 分';
    return Math.floor(sec / 86400) + ' 天 ' + Math.floor((sec % 86400) / 3600) + ' 小时';
  }
  function fmtTime(ms) {
    if (!ms) return '-';
    var d = new Date(ms), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------------- 骨架 ---------------- */
  function shell() {
    var gb = GRAINS.map(function (g) {
      return '<button class="fl-tf-tab' + (g[0] === S.grain ? ' on' : '') + '" data-grain="' + g[0] + '">' + g[1] + '</button>';
    }).join('');
    var fb = FILTERS.map(function (f) {
      return '<button class="fl-tf-tab' + (f[0] === S.filter ? ' on' : '') + '" data-filter="' + f[0] + '">' + f[1] + '</button>';
    }).join('');
    return '<div class="bf-wrap">' +
      '<div class="md-hd"><span class="md-t">📥 历史回补进度 <small>两年 K 线入库 · 每页 10 行 · 10 秒自动刷新</small></span>' +
      '<span class="md-live"><i class="pn-dot"></i><span id="bf-tm">加载中…</span></span></div>' +
      '<div class="tf-bar"><span class="tf-ttl">⏱ 粒度：</span><span class="tf-grp" id="bf-grain">' + gb + '</span>' +
      '<input id="bf-q" class="md-sel" style="width:130px" placeholder="搜索合约名" value="' + esc(S.q) + '">' +
      '<select class="md-sel" id="bf-sort">' +
      '<option value="progress"' + (S.sort === 'progress' ? ' selected' : '') + '>排序：进度低的在前</option>' +
      '<option value="remain"' + (S.sort === 'remain' ? ' selected' : '') + '>排序：还差最多的在前</option>' +
      '<option value="name"' + (S.sort === 'name' ? ' selected' : '') + '>排序：按名称</option>' +
      '</select>' +
      '<button class="md-btn" id="bf-refresh" title="立即刷新">⟳ 刷新</button></div>' +
      '<div class="tf-bar"><span class="tf-ttl">🔎 筛选：</span><span class="tf-grp" id="bf-filter">' + fb + '</span></div>' +
      '<div class="bf-sum" id="bf-sum"></div>' +
      '<div id="bf-tb"><div class="sg-note">加载中…</div></div>' +
      '<div class="tbl-pg" id="bf-pg"></div>' +
      '<div class="ud-pginfo" id="bf-pginfo"></div>' +
      '</div>';
  }

  /* ---------------- 渲染 ---------------- */
  function renderSum(j) {
    var el = $('bf-sum'); if (!el) return;
    var s = j.summary || {};
    var pct = s.avgPct || 0;
    el.innerHTML =
      '<div class="bf-bar"><i style="width:' + pct + '%"></i><span>总进度 ' + pct + '%</span></div>' +
      '<span class="bf-kv">已完成 <b>' + (s.done || 0) + '</b>/' + (s.total || 0) + ' 个</span>' +
      '<span class="bf-kv">进行中 <b>' + (s.running || 0) + '</b></span>' +
      '<span class="bf-kv">已入库 <b>' + nf(s.haveRows) + '</b> 根</span>' +
      '<span class="bf-kv">还差 <b>' + nf(s.remainRows) + '</b> 根</span>' +
      '<span class="bf-kv">速度 <b>' + (s.speed || 0) + '</b> 根/秒</span>' +
      '<span class="bf-kv">预计还需 <b>' + (s.taskRunning ? fmtDur(s.etaSec) : '已完成') + '</b></span>';
  }

  function renderTb(j) {
    var el = $('bf-tb'); if (!el) return;
    var rows = j.rows || [];
    if (!rows.length) { el.innerHTML = '<div class="sg-note">该筛选条件下没有合约</div>'; return; }
    var h = '<table class="bf-tb"><thead><tr>' +
      '<th>合约</th><th>进度条</th><th class="num">百分比</th><th class="num">已有 / 目标</th>' +
      '<th class="num">还差(根)</th><th class="num">已覆盖</th><th>状态</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var cls = r.status === 'done' ? 'done' : (r.running ? 'run' : '');
      h += '<tr>' +
        '<td><span class="bf-name">' + esc(r.inst) + '</span><span class="bf-sec">' + esc(r.sector) + '</span>' +
        (r.running ? ' <span class="bf-live">● 下载中 ' + (r.livePages || 0) + ' 页</span>' : '') + '</td>' +
        '<td><div class="bf-pb ' + cls + '"><i style="width:' + r.pct + '%"></i></div></td>' +
        '<td class="num">' + r.pct.toFixed(1) + '%</td>' +
        '<td class="num">' + nf(r.have) + ' / ' + nf(r.target) + '</td>' +
        '<td class="num">' + (r.remain > 0 ? nf(r.remain) : '0') + '</td>' +
        '<td class="num">' + (r.coverDays ? r.coverDays.toFixed(0) + ' 天' : '-') + '</td>' +
        '<td><span class="bf-st ' + r.status + '">' + (STATUS_TXT[r.status] || r.status) + '</span>' +
        (r.ended ? ' <span class="bf-sec">（历史已完整）</span>' : '') + '</td>' +
        '</tr>';
    });
    el.innerHTML = h + '</tbody></table>';
  }

  function renderPg(j) {
    var el = $('bf-pg'), info = $('bf-pginfo');
    if (!el || !info) return;
    var page = j.page || 1, pages = j.pages || 1, total = j.total || 0;
    var win = [], from = Math.max(1, page - 3), to = Math.min(pages, from + 7);
    for (var i = from; i <= to; i++) win.push(i);
    var h = '<button class="tbl-pg-btn" data-page="1"' + (page <= 1 ? ' disabled' : '') + '>« 首页</button>' +
      '<button class="tbl-pg-btn" data-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>‹ 上一页</button>';
    win.forEach(function (n) {
      h += '<button class="tbl-pg-btn' + (n === page ? ' on' : '') + '" data-page="' + n + '">' + n + '</button>';
    });
    h += '<button class="tbl-pg-btn" data-page="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>下一页 ›</button>' +
      '<button class="tbl-pg-btn" data-page="' + pages + '"' + (page >= pages ? ' disabled' : '') + '>末页 »</button>';
    el.innerHTML = h;
    info.innerHTML = '第 <b>' + page + '</b> / <b>' + pages + '</b> 页 · 筛选后共 <b>' + total + '</b> 个合约 · 每页 <b>' + (j.size || 10) + '</b> 行';
  }

  /* ---------------- 取数 ---------------- */
  function url() {
    return '/api/okx/backfillprogress?grain=' + S.grain + '&filter=' + S.filter +
      '&page=' + S.page + '&size=' + S.size + '&sort=' + S.sort + '&q=' + encodeURIComponent(S.q);
  }
  function load() {
    if (S.loading) return;
    S.loading = true;
    fetch(url(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      S.loading = false;
      var tm = $('bf-tm');
      if (tm) tm.textContent = '更新于 ' + fmtTime(Date.now()) + (j.summary && j.summary.taskRunning ? ' · 下载中' : ' · 空闲');
      if (!j || !j.ok) { var el = $('bf-tb'); if (el) el.innerHTML = '<div class="sg-note">' + esc((j && j.err) || '接口无数据') + '</div>'; return; }
      if (S.page > (j.pages || 1)) { S.page = j.pages || 1; return load(); }
      renderSum(j); renderTb(j); renderPg(j);
    }).catch(function (e) {
      S.loading = false;
      var el = $('bf-tb'); if (el) el.innerHTML = '<div class="sg-note">进度接口请求失败: ' + esc(e && e.message) + '</div>';
    });
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    var box = S.box; if (!box) return;
    box.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || t.nodeType !== 1) return;
      var g = t.getAttribute && t.getAttribute('data-grain');
      if (g && g !== S.grain) { S.grain = g; S.page = 1; rerender(); return; }
      var f = t.getAttribute && t.getAttribute('data-filter');
      if (f && f !== S.filter) { S.filter = f; S.page = 1; rerender(); return; }
      var p = t.getAttribute && t.getAttribute('data-page');
      if (p) { S.page = Math.max(1, parseInt(p, 10) || 1); load(); return; }
      if (t.id === 'bf-refresh') { load(); }
    });
    var q = $('bf-q');
    if (q) {
      q.addEventListener('change', function () { S.q = this.value.trim(); S.page = 1; load(); });
      q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { S.q = this.value.trim(); S.page = 1; load(); } });
    }
    var so = $('bf-sort');
    if (so) so.addEventListener('change', function () { S.sort = this.value; S.page = 1; load(); });
  }
  function rerender() {
    if (!S.box) return;
    S.box.innerHTML = shell();
    bind();
    load();
  }

  /* ---------------- 挂载 ---------------- */
  function mount(elId) {
    var box = $(elId);
    if (!box) return;
    S.box = box;
    box.innerHTML = shell();
    bind();
    load();
    if (S.timer) clearInterval(S.timer);
    S.timer = setInterval(load, 10000);
  }

  global.Backfill = { mount: mount, state: S, reload: load };
})(typeof window !== 'undefined' ? window : globalThis);