/* ============================================================================
 * web/js/ui/rankpack.js —— 【榜单 + 配图复合组件】
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25 第三轮）：
 *   "还有只有榜单吗 榜单下面给我挂上饼状图柱状图这种 不要总是榜单榜单的 要分类清晰"
 *   "更要懂得分析 要通过榜单表达什么"
 *   "涨幅榜跌幅榜 各种面板要写清楚 分类是什么 比如合约涨幅榜 还有各种类型 要写清楚分类啊"
 *
 * ★为什么需要这个组件：
 *   原先页面只有"榜单"（一列文字），信息密度低、看不出结构。
 *   本组件把每个榜单升级为【分类标签 + 榜单 + 配套图表 + 解读结论】四件套：
 *     ① 分类标签：范围(市场/板块) + 指标(涨跌幅/成交) + 周期(1D/5m/1m)
 *     ② 榜单本体：涨幅榜 / 跌幅榜
 *     ③ 配套图表：柱状(涨跌分布) / 饼图(涨跌构成) / 双柱(涨跌对照)
 *     ④ 解读结论：一句话说明"这个榜单在说什么"
 *
 *   RankPack.mount('el', {
 *     kind:'1d', scope:'全市场', metric:'涨跌幅', tf:'1D',
 *     charts:['bar','pie'],   // 榜单下方挂哪些图
 *     limit: 10, interval: 8000
 *   })
 * ========================================================================== */
(function (global) {
  'use strict';
  var Net = global.Net, EKit = global.EKit, Board = global.Board;

  function esc(s) {
    return String((s === null || s === undefined) ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pctTxt(v) { return (v >= 0 ? '+' : '') + (+v).toFixed(2) + '%'; }

  /* ---------------- 榜单解读（把榜单翻译成结论） ---------------- */
  function interpret(kind, gain, lose, list) {
    var g = gain || [], l = lose || [];
    if (!g.length && !l.length) return '该窗口暂无数据';
    var up = g.length ? g[0] : null, dn = l.length ? l[0] : null;
    var t = '榜首 ' + (up ? (up.name || up.sym) + ' ' + pctTxt(up.pct) : '-');
    if (dn) t += '；跌幅榜首 ' + (dn.name || dn.sym) + ' ' + pctTxt(dn.pct);
    // 集中度：前 3 名占前 10 名的比例 → 判断是普涨还是个别暴涨
    if (g.length >= 6) {
      var sum = g.slice(0, 10).reduce(function (s, x) { return s + Math.max(0, x.pct || 0); }, 0);
      var top3 = g.slice(0, 3).reduce(function (s, x) { return s + Math.max(0, x.pct || 0); }, 0);
      var conc = sum > 0 ? top3 / sum * 100 : 0;
      t += '；前 3 名占前 10 名涨幅的 ' + conc.toFixed(0) + '%（' +
        (conc > 70 ? '行情由个别标的驱动' : '涨势较为普遍') + '）';
    }
    return t;
  }

  /* ---------------- 挂载 ---------------- */
  function mount(el, opt) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return null;
    var o = Object.assign({
      kind: '1d',
      scope: '全市场',        // 范围分类
      metric: '涨跌幅',       // 指标分类
      tf: '1D',              // 周期分类
      sector: '',
      only: '',              // ★单榜模式: 'gain' 只显示涨幅榜 | 'lose' 只显示跌幅榜（空=左右双榜并列）
      charts: ['bar'],        // 榜单下方挂哪些图：bar | pie | dual | turn
      limit: 10,
      interval: 8000,
      ttl: 2500,
      title: '',
      onPick: null,            // ★点击行回调（OKX 页用它切换当前合约）
      showInterpret: true
    }, opt || {});
    var UID = ++_uid;

    var cat = { scope: o.scope, metric: o.metric, tf: o.tf };
    el.innerHTML =
      '<div class="rp-hd">' +
      (o.title ? '<span class="rp-t">' + esc(o.title) + '</span>' : '') +
      '<span class="rp-cats">' + Board.catHTML(cat) + '</span>' +
      '<span class="rp-tm" id="rp-tm-' + UID + '">加载中…</span>' +
      '</div>' +
      '<div class="rp-bd" id="rp-bd-' + UID + '"></div>' +
      '<div class="rp-charts" id="rp-ch-' + UID + '"></div>' +
      (o.showInterpret ? '<div class="rp-iter" id="rp-it-' + UID + '">正在分析…</div>' : '');

    var refs = {
      bd: el.querySelector('#rp-bd-' + UID),
      ch: el.querySelector('#rp-ch-' + UID),
      it: el.querySelector('#rp-it-' + UID),
      tm: el.querySelector('#rp-tm-' + UID)
    };
    // 图表容器
    refs.ch.innerHTML = o.charts.map(function (c, i) {
      var title = { bar: '涨跌幅分布（柱状）', pie: '涨跌构成（饼图）', dual: '买卖力量对照（双柱）', turn: '成交额分布（柱状）' }[c] || c;
      return '<div class="rp-chb"><div class="rp-cht">' + esc(title) + '</div>' +
        '<div class="rp-chx" id="rp-cx-' + UID + '-' + i + '"></div></div>';
    }).join('');

    function drawCharts(j) {
      o.charts.forEach(function (c, i) {
        var box = el.querySelector('#rp-cx-' + UID + '-' + i);
        if (!box) return;
        var g = j.gain || [], l = j.lose || [], rows = j.list || [];
        if (c === 'bar') {
          var d = g.slice(0, o.limit).map(function (x) { return { name: x.name || x.sym, value: +(+x.pct).toFixed(2) }; });
          if (!d.length) { box.innerHTML = '<div class="rp-empty">无数据</div>'; return; }
          EKit.mount(box, 'barH', d, { color: '#f0334b' });
        } else if (c === 'pie') {
          var up = g.filter(function (x) { return x.pct > 0; }).length;
          var dn = l.filter(function (x) { return x.pct < 0; }).length;
          if (o.only === 'gain') { dn = 0; up = (j.scanned || 0) - dn; }
          if (o.only === 'lose') { up = 0; dn = (j.scanned || 0) - up; }
          var fl = Math.max(0, (j.scanned || 0) - up - dn);
          EKit.mount(box, 'pie', [
            { name: '上涨', value: up, color: '#f0334b' },
            { name: '下跌', value: dn, color: '#0bbf7a' },
            { name: '平盘', value: fl, color: '#8b94ad' }
          ], { radius: ['0%', '62%'] });
        } else if (c === 'turn') {
          var dt2 = (j.list && j.list.length ? j.list : j.gain).slice(0, o.limit)
            .map(function (x) { return { name: x.name || x.sym, value: Math.round(x.turn || 0) }; });
          if (!dt2.length) { box.innerHTML = '<div class="rp-empty">无数据</div>'; return; }
          EKit.mount(box, 'barH', dt2, { color: '#4f8cff' });
        }
      });
    }

    function draw(j) {
      if (!j || !j.ok) return;
      if (o.only === 'gain') {
        Board.list(refs.bd, j.gain || [], {
          limit: o.limit, label: o.tf, cat: cat, dir: 'gain',
          title: '涨幅榜', onPick: o.onPick
        });
      } else if (o.only === 'lose') {
        Board.list(refs.bd, j.lose || [], {
          limit: o.limit, label: o.tf, cat: cat, dir: 'lose',
          title: '跌幅榜', onPick: o.onPick
        });
      } else {
        Board.pair(refs.bd, j, { limit: o.limit, label: o.tf, cat: cat, onPick: o.onPick });
      }
      drawCharts(j);
      if (refs.it) refs.it.innerHTML = '<b>解读</b>' + esc(interpret(o.kind, j.gain, j.lose, j.list));
      if (refs.tm) refs.tm.textContent = new Date(j.at || Date.now()).toTimeString().slice(0, 8);
    }

    function tick() {
      var url = '/api/boards/board?kind=' + encodeURIComponent(o.kind) +
        '&sector=' + encodeURIComponent(o.sector) +
        (o.sub ? ('&sub=' + encodeURIComponent(o.sub)) : '') +
        '&limit=' + o.limit + '&t=' + Date.now();
      return Net.get(url, { ttl: o.ttl }).then(draw).catch(function () { });
    }

    var api = {
      refresh: tick,
      destroy: function () {
        if (api._iv) clearInterval(api._iv);
        var boxes = el.querySelectorAll('.rp-chx');
        for (var i = 0; i < boxes.length; i++) EKit.dispose(boxes[i]);
      }
    };
    tick();
    if (o.interval > 0) {
      api._iv = setInterval(function () { if (!document.hidden) tick(); }, o.interval);
    }
    return api;
  }

  var _uid = 0;
  global.RankPack = { mount: mount, interpret: interpret };
})(typeof window !== 'undefined' ? window : globalThis);
