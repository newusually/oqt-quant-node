/* ============================================================================
 * web/js/svc/search.js —— 【搜索服务】（分层：服务层，供所有页面复用）
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）："js 每个计算 画图 下载 搜索 都分类 分层架构做好 做到复用"
 *
 * 职责单一：在合约池里按 名称/代码/拼音 搜索，并给出所属板块。
 * 合约池来自 /api/boards/universe（已按 OKX instCategory 分好类），只取一次。
 *
 *   Search.ready()                       预加载合约池
 *   Search.find('nvda')                  返回 [{code,name,sym,sector,sectorName}]
 *   Search.bind(input, listEl, onPick)   ★一行给任意输入框接上搜索下拉
 * ========================================================================== */
(function (global) {
  'use strict';
  var Net = global.Net;
  var POOL = null, LOADING = null;

  function ready() {
    if (POOL) return Promise.resolve(POOL);
    if (LOADING) return LOADING;
    LOADING = Net.get('/api/boards/universe', { ttl: 10 * 60 * 1000 }).then(function (j) {
      var list = [];
      ((j && j.groups) || []).forEach(function (g) {
        (g.list || []).forEach(function (x) {
          list.push({
            code: x.code, sym: x.sym, name: x.name,
            sector: g.id, sectorName: g.name, sectorIcon: g.icon
          });
        });
      });
      POOL = list;
      return list;
    }).catch(function () { POOL = []; return []; });
    return LOADING;
  }

  // 匹配：代码直接命中 > 名称包含 > 代码包含
  function find(kw, limit) {
    if (!POOL) return [];
    var k = String(kw || '').trim().toLowerCase();
    if (!k) return [];
    var a = [], b = [], c = [];
    for (var i = 0; i < POOL.length; i++) {
      var x = POOL[i];
      var sym = (x.sym || '').toLowerCase();
      var nm = (x.name || '').toLowerCase();
      if (sym === k || nm === k) a.push(x);
      else if (sym.indexOf(k) === 0 || nm.indexOf(k) === 0) b.push(x);
      else if (sym.indexOf(k) >= 0 || nm.indexOf(k) >= 0) c.push(x);
    }
    return a.concat(b, c).slice(0, limit || 12);
  }

  /* ★给任意输入框接上搜索下拉（页面零逻辑复用） */
  function bind(input, listEl, onPick) {
    if (typeof input === 'string') input = document.getElementById(input);
    if (typeof listEl === 'string') listEl = document.getElementById(listEl);
    if (!input || !listEl) return;
    var t = 0;
    input.addEventListener('input', function () {
      clearTimeout(t);
      var kw = input.value.trim();
      if (!kw) { listEl.innerHTML = ''; listEl.classList.remove('on'); return; }
      t = setTimeout(function () {
        ready().then(function () {
          var rs = find(kw, 12);
          if (!rs.length) { listEl.innerHTML = '<div class="sr-empty">无匹配标的</div>'; listEl.classList.add('on'); return; }
          listEl.innerHTML = rs.map(function (x, i) {
            return '<div class="sr-item" data-i="' + i + '" data-code="' + x.code + '">' +
              '<span class="sr-ic">' + (x.sectorIcon || '') + '</span>' +
              '<b class="sr-nm">' + x.name + '</b>' +
              '<span class="sr-sy">' + x.sym + '</span>' +
              '<span class="sr-sc">' + x.sectorName + '</span>' +
              '</div>';
          }).join('');
          listEl.classList.add('on');
          Array.prototype.forEach.call(listEl.querySelectorAll('.sr-item'), function (el) {
            el.addEventListener('click', function () {
              var i = +el.getAttribute('data-i');
              var x = rs[i];
              input.value = x.name;
              listEl.innerHTML = ''; listEl.classList.remove('on');
              if (onPick) onPick(x);
            });
          });
        });
      }, 180);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () { listEl.classList.remove('on'); }, 160);
    });
  }

  global.Search = { ready: ready, find: find, bind: bind, pool: function () { return POOL || []; } };
})(typeof window !== 'undefined' ? window : globalThis);
