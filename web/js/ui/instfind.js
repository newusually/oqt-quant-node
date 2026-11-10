/* ============================================================================
 * web/js/ui/instfind.js —— 【合约实时查询 · 概念/分类组件】
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）：
 *   "合约各个介绍和概念都要保存在数据库然后分类各个合约和股票"
 *   "合约总是可以实时查询的"
 *
 * ★一个组件 = 搜索框 + 板块快捷过滤 + 结果列表 + 合约详情
 *   数据源: /api/boards/insts（概念库 507 合约）/ /api/boards/inst（详情）
 *   详情 = 概念介绍 + 一级/二级分类 + 实时行情
 * ★用法: InstFind.mount({ q:'if-q', cats:'if-cats', result:'if-result' })
 * ========================================================================== */
(function (global) {
  'use strict';
  var Net = global.Net;

  function esc(s) {
    return String((s === null || s === undefined) ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }
  function cls(p) { return p > 0 ? 'up' : (p < 0 ? 'dn' : 'flat'); }
  function pctTxt(p) { return (p >= 0 ? '+' : '') + (+p).toFixed(2) + '%'; }

  var state = { q: '', sector: '', cur: '' };
  var TIMER = null;

  /* 板块快捷过滤（加密生态分类，与后端 universe.SECTORS 一致） */
  var SECTORS = [
    { id: '', name: '全部' }, { id: 'l1', name: '公链' }, { id: 'l2', name: '扩容' },
    { id: 'defi', name: 'DeFi' }, { id: 'meme', name: 'Meme' }, { id: 'ai', name: 'AI' },
    { id: 'infra', name: '基础设施' }, { id: 'nft', name: '链游' },
    { id: 'rwa', name: '实物资产' }, { id: 'other', name: '其他' }
  ];
  /* 板块中文名（与后端 insts.js SEC_NAME 一致） */
  var SEC_NAME = {
    l1: '公链层', l2: '扩容层', defi: 'DeFi', meme: 'Meme', ai: 'AI',
    infra: '基础设施', nft: '链游与NFT', rwa: '实物资产与DePIN', other: '其他加密'
  };
  function secName(s) { return SEC_NAME[s] || s || '-'; }

  /* ---------------- 搜索（防抖 350ms） ---------------- */
  function doSearch() {
    var url = '/api/boards/insts?q=' + encodeURIComponent(state.q) +
      '&sector=' + encodeURIComponent(state.sector) + '&limit=50';
    return Net.get(url, { ttl: 3000 }).then(function (j) {
      if (!j || !j.ok) return null;
      renderList(j.list || []);
      return j;
    }).catch(function () { return null; });
  }
  function renderList(list) {
    var box = $('if-list');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="if-empty">未找到匹配合约（试试 BTC / 英伟达 / 科技 / 半导体）</div>';
      return;
    }
    box.innerHTML = list.map(function (x) {
      return '<div class="if-row' + (state.cur === x.sym ? ' on' : '') + '" data-sym="' + esc(x.sym) + '">' +
        '<span class="if-sym">' + esc(x.sym) + '</span>' +
        '<span class="if-nm">' + esc(x.name) + '</span>' +
        '<span class="if-cat">' + esc(secName(x.sector)) + '</span>' +
        '</div>';
    }).join('');
  }

  /* ---------------- 合约详情 ---------------- */
  function showDetail(sym) {
    state.cur = sym;
    var box = $('if-result');
    if (!box) return;
    box.innerHTML = '<div class="if-empty">查询中…</div>';
    Net.get('/api/boards/inst?sym=' + encodeURIComponent(sym), { ttl: 3000 }).then(function (j) {
      if (!j || !j.ok || !j.info) { box.innerHTML = '<div class="if-empty">未找到该合约</div>'; return; }
      var i = j.info, q = j.quote || {};
      var sec = secName(i.sector);
      box.innerHTML =
        '<div class="if-d-hd">' +
        '<b>' + esc(i.name) + '</b><span class="if-d-sym">' + esc(i.sym) + ' · ' + esc(i.instId) + '</span>' +
        '<a class="if-d-go" href="/modules/okx/web/index.html?inst=' + encodeURIComponent(i.instId) + '" target="_blank">打开 OKX 页 →</a>' +
        '</div>' +
        '<div class="if-d-cat">' +
        '<span class="if-chip">📂 ' + esc(sec) + '</span>' +

        (i.lever ? '<span class="if-chip">⚡ ' + esc(i.lever) + 'x</span>' : '') +
        '</div>' +
        '<div class="if-d-q">' +
        '<span class="if-q-k">最新价</span><b class="num">' + ((q.px !== null && q.px !== undefined) ? q.px : '-') + '</b>' +
        '<span class="if-q-k">当日</span><b class="num ' + cls(q.pct1d || 0) + '">' + ((q.pct1d !== null && q.pct1d !== undefined) ? pctTxt(q.pct1d) : '-') + '</b>' +
        '<span class="if-q-k">24h</span><b class="num ' + cls(q.pct24 || 0) + '">' + ((q.pct24 !== null && q.pct24 !== undefined) ? pctTxt(q.pct24) : '-') + '</b>' +
        '<span class="if-q-k">成交额</span><b class="num">' + ((q.turn !== null && q.turn !== undefined) ? Math.round(q.turn).toLocaleString('zh-CN') : '-') + '</b>' +
        '</div>' +
        '<div class="if-d-concept">' + esc(i.concept || '暂无概念介绍') + '</div>';
      // 高亮当前行
      var rows = document.querySelectorAll('.if-row');
      Array.prototype.forEach.call(rows, function (r) {
        r.classList.toggle('on', r.getAttribute('data-sym') === sym);
      });
    }).catch(function () {
      box.innerHTML = '<div class="if-empty">查询失败（网络抖动，请重试）</div>';
    });
  }

  /* ---------------- 挂载 ---------------- */
  function mount(opt) {
    opt = opt || {};
    // 板块 chips
    var cats = $('if-cats');
    if (cats && !cats.__built) {
      cats.__built = true;
      cats.innerHTML = SECTORS.map(function (s) {
        return '<span class="if-cat-tab' + (s.id === state.sector ? ' on' : '') + '" data-sid="' + s.id + '">' + esc(s.name) + '</span>';
      }).join('');
      cats.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('.if-cat-tab') : null;
        if (!t) return;
        state.sector = t.getAttribute('data-sid');
        Array.prototype.forEach.call(cats.children, function (c) {
          c.classList.toggle('on', c === t);
        });
        Net.invalidate('/api/boards/insts');
        doSearch();
      });
    }
    // 搜索框（防抖）
    var q = $('if-q');
    if (q && !q.__built) {
      q.__built = true;
      var deb = null;
      q.addEventListener('input', function () {
        clearTimeout(deb);
        deb = setTimeout(function () {
          state.q = q.value.trim();
          Net.invalidate('/api/boards/insts');
          doSearch();
        }, 350);
      });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          clearTimeout(deb);
          state.q = q.value.trim();
          Net.invalidate('/api/boards/insts');
          doSearch();
        }
      });
    }
    // 结果点击 → 详情
    var lb = $('if-list');
    if (lb && !lb.__ifBound) {
      lb.__ifBound = true;
      lb.addEventListener('click', function (e) {
        var row = e.target.closest ? e.target.closest('.if-row') : null;
        if (!row) return;
        showDetail(row.getAttribute('data-sym'));
      });
    }
    doSearch();
    if (TIMER) clearInterval(TIMER);
    // 当前合约详情 10s 实时刷新
    TIMER = setInterval(function () {
      if (state.cur) showDetail(state.cur);
    }, opt.interval || 10000);
  }

  global.InstFind = { mount: mount, search: doSearch, show: showDetail };
})(typeof window !== 'undefined' ? window : globalThis);
