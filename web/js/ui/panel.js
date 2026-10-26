/* ============================================================================
 * web/js/ui/panel.js —— 【通用面板组件】（组件化复用的最上层）
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）：
 *   "所有板块页面 所有面板 都给我组件化 都给我复用 同样的画图等都可以复用"
 *   "可以ajax速度快 网页并发"
 *
 * ★一行代码 = 一整个面板（卡片 + 多个榜单 + 多个图表 + 自动刷新 + 实时）：
 *   Panel.mount('box', {
 *     sector:'l1', title:'公链层', icon:'⛓',
 *     boards:[{kind:'1d',limit:10},{kind:'5m',limit:10},{kind:'1m',limit:8}],
 *     charts:[{type:'bar',from:'barRank',title:'涨幅TOP10'},
 *             {type:'ring',from:'pieUpDown',title:'涨跌家数'}],
 *     interval:10000
 *   });
 *
 * ★为什么快（解决并发与速度）：
 *   整个面板【只发 1 个请求】(panel 接口一次返回卡片+全部榜单+全部图表数据)
 *   而不是 卡片1 + 榜单3 + 图表2 = 6 个请求去抢浏览器的 6 并发额度
 *   取数统一走 Net（请求合并 + 并发队列 + 短缓存）
 *
 * ★分时/实时：数据源是服务端常驻 WS 内存 → 接口毫秒级，10 秒刷新也不卡
 * ========================================================================== */
(function (global) {
  'use strict';
  var Net = global.Net, Board = global.Board, EKit = global.EKit;

  function esc(s) {
    return String((s === null || s === undefined) ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function cls(p) { return p > 0 ? 'up' : (p < 0 ? 'dn' : 'flat'); }
  var UID = 0;

  /* ---------------- 卡片（板块代表品种 + 板块概况）---------------- */
  function cardHTML(x) {
    return '<div class="pn-card" data-code="' + esc(x.code) + '" data-href="' + esc(Board.hrefOf(x)) + '" title="悬停看5分钟K线 · 点击打开">' +
      '<div class="pn-cn">' + esc(x.name || x.sym) + '</div>' +
      '<div class="pn-cp num">' + esc(x.pxText || '-') + '</div>' +
      '<div class="pn-cc num ' + cls(x.pct) + '">' + (x.pct >= 0 ? '▲ ' : '▼ ') + esc(x.pctText || '-') + '</div>' +
      '</div>';
  }

  /* ---------------- 挂载 ---------------- */
  function mount(el, opt) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return null;
    var id = ++UID;
    var o = Object.assign({
      sector: '', title: '', icon: '', kinds: null,
      cardLimit: 8, boardLimit: 10, takerLimit: 8,
      interval: 10000, ttl: 2000,
      boards: null, charts: null
    }, opt || {});

    // boards: 兼容两种写法 —— 数组 [{kind}] 或 简写 ['1d','5m','1m']
    var bdefs = o.boards || (o.kinds || ['1d', '5m', '1m']).map(function (k) {
      return { kind: k };
    });
    var cdefs = o.charts || [];

    // 骨架（先出结构，数据到了再填 → 不白屏）
    var kindsQ = bdefs.map(function (b) { return b.kind; }).join(',');
    el.innerHTML =
      '<div class="pn-hd">' +
      '<span class="pn-t">' + esc(o.icon) + ' ' + esc(o.title) + '</span>' +
      '<span class="pn-live"><i class="pn-dot"></i><span class="pn-tm">加载中…</span></span>' +
      '</div>' +
      '<div class="pn-cards" id="pn-cards-' + id + '"></div>' +
      '<div class="pn-best" id="pn-best-' + id + '"></div>' +
      bdefs.map(function (b, i) {
        return '<div class="pn-bd" id="pn-bd-' + id + '-' + i + '"></div>';
      }).join('') +
      (cdefs.length ? '<div class="pn-charts">' + cdefs.map(function (c, i) {
        return '<div class="pn-ch" id="pn-ch-' + id + '-' + i + '"></div>';
      }).join('') + '</div>' : '');

    var refs = {
      cards: el.querySelector('#pn-cards-' + id),
      best: el.querySelector('#pn-best-' + id),
      tmel: el.querySelector('.pn-tm'),
      bds: bdefs.map(function (b, i) { return el.querySelector('#pn-bd-' + id + '-' + i); }),
      chs: cdefs.map(function (c, i) { return el.querySelector('#pn-ch-' + id + '-' + i); })
    };
    // 卡片交互（悬停K线 / 点击）
    Board.bind(refs.cards);

    function urlOf() {
      return '/api/boards/panel?sector=' + encodeURIComponent(o.sector) +
        '&kinds=' + encodeURIComponent(kindsQ) +
        '&limit=' + Math.max(o.boardLimit, o.takerLimit);
    }

    function draw(j) {
      if (!j || !j.ok) return;
      // 卡片
      if (refs.cards) refs.cards.innerHTML = (j.cards || []).slice(0, o.cardLimit).map(cardHTML).join('');
      // 榜单（左右对称双榜）
      bdefs.forEach(function (b, i) {
        var bx = j.boards && j.boards[b.kind];
        if (!bx) return;
        Board.pair(refs.bds[i], bx, { limit: o.boardLimit, label: labelOf(b.kind) });
      });
      // 图表（复用 EKit，数据直接来自接口）
      cdefs.forEach(function (c, i) {
        var d = (j.charts && j.charts[c.from]) || null;
        if (!d || !d.length) { if (refs.chs[i]) refs.chs[i].innerHTML = '<div class="pn-empty">暂无</div>'; return; }
        // 容器：图表盒 + 标题
        if (!refs.chs[i].querySelector('.pn-ch-bx')) {
          refs.chs[i].innerHTML = '<div class="pn-ch-t">' + esc(c.title || '') + '</div><div class="pn-ch-bx"></div>';
        }
        var box = refs.chs[i].querySelector('.pn-ch-bx');
        // ★lineDual 需要额外的 labels（横轴时间）—— 从 charts 里取
        var opt = Object.assign({}, c.opt || {});
        if (c.type === 'lineDual') {
          var meta = j.charts[c.from + 'Meta'];
          opt.labels = (j.charts[c.from] || []).map(function (p) { return p.name; });
          if (meta) opt.corrMeta = meta;
        }
        EKit.mount(box, c.type, d, opt);
      });
      if (refs.tmel) {
        var t = new Date(j.at || Date.now());
        refs.tmel.textContent = (j.ws && j.ws.conn ? 'WS实时' : '轮询') + ' · ' +
          t.toTimeString().slice(0, 8);
      }
    }

    function tick() {
      return Net.get(urlOf(), { ttl: o.ttl }).then(draw).catch(function () { });
    }

    var api = {
      id: id, el: el, opt: o,
      refresh: tick,
      destroy: function () {
        if (api._iv) clearInterval(api._iv);
        if (api._vis) document.removeEventListener('visibilitychange', api._vis);
        cdefs.forEach(function (c, i) { if (refs.chs[i]) EKit.dispose(refs.chs[i].querySelector('.pn-ch-bx')); });
      }
    };

    tick();
    if (o.interval > 0) {
      api._iv = setInterval(function () {
        if (document.hidden) return;               // 页面不可见 → 不浪费请求
        tick();
      }, o.interval);
      // 回到前台立即刷新一次
      api._vis = function () { if (!document.hidden) tick(); };
      document.addEventListener('visibilitychange', api._vis);
    }
    return api;
  }

  function labelOf(kind) {
    return ({
      '1d': '当日1D', '5m': '5分钟', '1m': '1分钟'
    })[kind] || kind;
  }

  /* ---------------- 批量挂载（一个页面多个板块，内部串行排队）---------------- */
  function mountAll(defs) {
    var apis = [];
    (defs || []).forEach(function (d) {
      var a = mount(d.el, d);
      if (a) apis.push(a);
    });
    return {
      list: apis,
      refreshAll: function () { apis.forEach(function (a) { a.refresh(); }); },
      destroyAll: function () { apis.forEach(function (a) { a.destroy(); }); }
    };
  }

  global.Panel = { mount: mount, mountAll: mountAll, labelOf: labelOf };
})(typeof window !== 'undefined' ? window : globalThis);
