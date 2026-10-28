/* ============================================================================
 * web/js/ui/chan-major.js —— ★缠论·大级别转折点 共享组件（2026-10-28）
 * ----------------------------------------------------------------------------
 * 用户需求：
 *   "新的缠论信号变成新的共享组件，可以共享回测+K线上的买卖点信号计算公式，
 *    组件内可以有多种算法和公式，只要原理相同就行……
 *    把买卖信号连线：先买后卖信号连接是红线，先卖后买信号连线是绿色。
 *    回测表格和K线图悬浮窗上的涨跌家数也要保留。
 *    买卖信号出现之前的前面一个信号：有多少根K线、平均涨跌家数比例、
 *    按顺序每根K线的涨跌比例、有没有规律 —— 都要做成表格。"
 *
 * ★设计：
 *   - 算法只有一份（后端 modules/okx/engines/chan.js 双约束确认式 ZigZag），
 *     回测表与K线画线都消费 /api/boards/chan 的同一份输出 —— 公式天然共享；
 *   - 本组件负责：①回测明细表（DetailTable 渲染）②K线 marks/links 组装
 *     ③每条连线区间的「逐根K线涨跌家数比例」明细表（懒加载 /api/boards/chan-seq）；
 *   - 连线配色（中国惯例）：底→顶(先买后卖, 涨)=红线 / 顶→底(先卖后买, 跌)=绿线；
 *     进行中未确认段 = 虚线（同样按方向红/绿）；
 *   - 组件内参数：minBars 40/60/80/100（连线最少K线距离），mode pct/atr（原理相同
 *     的两种阈值公式）—— 每个分时各自计算，信号各不相同。
 * ========================================================================== */
'use strict';
(function (global) {

  /* ---------------- 模块级缓存（回测表与K线共享同一份数据） ---------------- */
  var CACHE = {};                        // key → {at, data}
  var TTL = 60000;
  var DAYS = 730;                        // ★两年回测

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pct(v) { return (v === null || v === undefined) ? '-' : ((v > 0 ? '+' : '') + (+v).toFixed(2) + '%'); }
  function nv(v) { return (v === null || v === undefined) ? '-' : v; }
  function fmtDT(ts) {
    var d = new Date(+ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtD(ts) {
    var d = new Date(+ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function key(g, minBars, minAmp, mode) { return g + '|' + (minBars || 40) + '|' + (minAmp || 10) + '|' + (mode || 'pct'); }

  function fetchJSON(url, timeout) {
    if (global.Net && global.Net.get) return global.Net.get(url, { ttl: 5000, timeout: timeout || 120000 });
    return new Promise(function (resolve, reject) {
      var xr = new XMLHttpRequest();
      xr.timeout = timeout || 120000;
      xr.open('GET', url, true);
      xr.onload = function () { try { resolve(JSON.parse(xr.responseText)); } catch (e) { reject(e); } };
      xr.onerror = function () { reject(new Error('network')); };
      xr.ontimeout = function () { reject(new Error('timeout')); };
      xr.send();
    });
  }

  /* ---------------- 数据加载（带缓存） ---------------- */
  function load(grain, opt, force) {
    opt = opt || {};
    var k = key(grain, opt.minBars, opt.minAmp, opt.mode);
    var hit = CACHE[k];
    if (!force && hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);
    var url = '/api/boards/chan?grain=' + encodeURIComponent(grain) +
      '&days=' + (opt.days || DAYS) +
      '&minBars=' + (opt.minBars || 40) +
      '&minAmp=' + (opt.minAmp || 10) +
      '&mode=' + (opt.mode || 'pct') +
      '&t=' + Date.now();
    return fetchJSON(url).then(function (j) {
      if (j && j.ok) CACHE[k] = { at: Date.now(), data: j };
      return j;
    });
  }
  /* 只读缓存（K线渲染用，命中才有值） */
  function cached(grain, opt) {
    var hit = CACHE[key(grain, opt && opt.minBars, opt && opt.minAmp, opt && opt.mode)];
    return (hit && hit.data && hit.data.ok) ? hit.data : null;
  }

  /* ---------------- K线画线数据（marks 点 + links 连线段） ----------------
   * dir=+1 买(底)→卖(顶) 红线 / dir=-1 卖(顶)→买(底) 绿线; dash=开放未确认段 */
  function chartData(grain, opt) {
    var d = cached(grain, opt);
    if (!d || !d.signals) return null;
    var marks = [], links = [];
    for (var k = 0; k < d.signals.length; k++) {
      var sg = d.signals[k];
      if (sg.up === null && sg.down === null && k > 0 && sg.segBars === 0) continue;
      marks.push({ t: sg.ts, dir: sg.type === 'B' ? 1 : -1, price: sg.px, label: sg.type === 'B' ? '买' : '卖' });
      if (k > 0) {
        var pv = d.signals[k - 1];
        links.push({ t0: pv.ts, p0: pv.px, t1: sg.ts, p1: sg.px, dir: sg.type === 'T' ? 1 : -1 });
      }
    }
    if (d.openLeg) {
      links.push({
        t0: d.openLeg.fromTs, p0: d.openLeg.fromPx,
        t1: d.openLeg.toTs, p1: d.openLeg.toPx,
        dir: d.openLeg.toType === 'T' ? 1 : -1, dash: true
      });
    }
    return { marks: marks, links: links, data: d };
  }

  /* ---------------- 回测明细表（挂载到 host, 内含分页/参数/分段明细） ---------------- */
  function mount(host, opt) {
    opt = opt || {};
    var st = {
      grain: opt.grain || '5m',
      minBars: opt.minBars || 40,
      minAmp: opt.minAmp || 10,
      mode: opt.mode || 'pct',
      page: 1,
      seqTs: null,                       // 当前展开的信号 ts
      seqPage: 1,                        // 分段明细表页码
      seqLoading: false,
      seqData: null,
      data: null,
      loading: false,
      dead: false
    };
    var dt = null, seqdt = null;

    function onSignals() { try { if (opt.onSignals) opt.onSignals(st.data); } catch (e) { } }

    function fetch(force) {
      if (st.loading) return;
      st.loading = true;
      render();
      load(st.grain, { minBars: st.minBars, minAmp: st.minAmp, mode: st.mode, days: opt.days }, force)
        .then(function (j) {
          st.loading = false;
          if (st.dead) return;
          if (j && j.ok) {
            st.data = j;
            /* 页码按最新在上方向: UI页1=最新 */
            var pages = Math.max(1, Math.ceil(j.signals.length / 10));
            if (st.page > pages) st.page = pages;
          }
          render();
          onSignals();
        }).catch(function () { st.loading = false; if (!st.dead) render(); });
    }

    /* ---- 主表 12 列 ---- */
    function cols() {
      var labels = ['#', '时间', '信号', '转折价', '涨家', '跌家', '上涨占比', '距前信号(根)', '前段均涨占比', '前段规律', '到下一点', '前段明细'];
      return labels.map(function (lb) { return { label: lb, cell: function (r) { return r._tds[lb]; } }; });
    }
    function rowTds(sg, n) {
      var isBuy = sg.type === 'B';
      var t = {};
      t['#'] = '<td class="num">' + n + '</td>';
      t['时间'] = '<td>' + esc(fmtDT(sg.ts)) + '</td>';
      t['信号'] = isBuy
        ? '<td><b class="num-up">底 · 买</b></td>'
        : '<td><b class="num-dn">顶 · 卖</b></td>';
      t['转折价'] = '<td class="num"><b>' + sg.px + '</b></td>';
      t['涨家'] = '<td class="num-up">' + nv(sg.up) + '</td>';
      t['跌家'] = '<td class="num-dn">' + nv(sg.down) + '</td>';
      t['上涨占比'] = '<td class="num">' + (sg.upRatio === null || sg.upRatio === undefined ? '-' : sg.upRatio + '%') + '</td>';
      t['距前信号(根)'] = '<td class="num">' + (sg.segBars || '-') + '</td>';
      t['前段均涨占比'] = '<td class="num">' + (sg.segAvgRatio === null || sg.segAvgRatio === undefined ? '-' : sg.segAvgRatio + '%') + '</td>';
      t['前段规律'] = '<td class="num">' + esc(sg.segTrend || (sg.segBars ? '无' : '-')) + '</td>';
      var na = sg.nextAmp;
      t['到下一点'] = '<td class="' + (na === null || na === undefined ? '' : (na >= 0 ? 'num-up' : 'num-dn')) + '">' +
        (na === null || na === undefined ? (sg === st.data.signals[st.data.signals.length - 1] ? '持有中' : '-') : pct(na)) + '</td>';
      t['前段明细'] = (st.seqTs === sg.ts)
        ? '<td class="num"><b>已展开 ▲</b></td>'
        : '<td class="num"><button class="tbl-pg-btn" data-chanseq="' + sg.ts + '">查看</button></td>';
      return t;
    }

    /* ---- 分段明细（逐根K线涨跌比例） ---- */
    function seqCols() {
      var labels = ['顺序', '时间', '涨家', '跌家', '样本', '上涨占比', 'BTC收盘'];
      return labels.map(function (lb) { return { label: lb, cell: function (r) { return r._tds[lb]; } }; });
    }
    function seqTds(r, n) {
      var t = {};
      t['顺序'] = '<td class="num">' + r.seqNo + '</td>';
      t['时间'] = '<td>' + esc(fmtDT(r.ts)) + '</td>';
      t['涨家'] = '<td class="num-up">' + nv(r.up) + '</td>';
      t['跌家'] = '<td class="num-dn">' + nv(r.down) + '</td>';
      t['样本'] = '<td class="num">' + nv(r.total) + '</td>';
      t['上涨占比'] = '<td class="num">' + (r.upRatio === null || r.upRatio === undefined ? '-' : r.upRatio + '%') + '</td>';
      t['BTC收盘'] = '<td class="num">' + nv(r.c) + '</td>';
      return t;
    }

    function loadSeq(ts) {
      st.seqTs = ts; st.seqData = null; st.seqLoading = true; st.seqPage = 1;
      render();
      var url = '/api/boards/chan-seq?grain=' + encodeURIComponent(st.grain) +
        '&days=' + (opt.days || DAYS) + '&minBars=' + st.minBars + '&minAmp=' + st.minAmp +
        '&mode=' + st.mode + '&ts=' + ts + '&t=' + Date.now();
      fetchJSON(url).then(function (j) {
        st.seqLoading = false;
        if (st.dead) return;
        if (j && j.ok) st.seqData = j; else st.seqData = { err: (j && j.err) || '加载失败' };
        render();
      }).catch(function () { st.seqLoading = false; if (!st.dead) { st.seqData = { err: '网络错误' }; render(); } });
    }

    /* ---- 渲染 ---- */
    function render() {
      if (!host) return;
      var h = '';
      h += '<div class="cd-t ud-sighd">🪜 <b>' + esc(label(st.grain)) + '</b> · 缠论大级别转折点 · BTC 买卖信号回测 ' +
        '<small>划线式确认 · 无预测 · 连接段≥<b>' + st.minBars + '</b>根K线 · 段涨跌幅≥<b>' + st.minAmp + '%</b> · 底=买 顶=卖 · 涨红跌绿</small></div>';

      /* 参数（组件内多公式: 距离阈值 + 阈值模式） */
      h += '<div class="ud-pginfo" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
        '连线最少K线距离 <select class="md-sel" data-chanp="minBars" style="max-width:90px">' +
        [40, 60, 80, 100].map(function (v) { return '<option value="' + v + '"' + (v === st.minBars ? ' selected' : '') + '>' + v + '根</option>'; }).join('') +
        '</select>' +
        '阈值公式 <select class="md-sel" data-chanp="mode" style="max-width:150px">' +
        '<option value="pct"' + (st.mode === 'pct' ? ' selected' : '') + '>固定幅度(默认)</option>' +
        '<option value="atr"' + (st.mode === 'atr' ? ' selected' : '') + '>ATR自适应(同原理)</option>' +
        '</select>' +
        '<button class="tbl-pg-btn" data-chanrefresh="1">⟳ 重算</button>' +
        '<span class="muted">每个分时各自计算 · 信号各不相同 · 仅BTC</span></div>';

      if (st.loading && !st.data) {
        h += '<div class="sg-note">⏳ 缠论划线计算中（两年K线逐根扫描，首次约 2~5 秒）…</div>';
        host.innerHTML = h;
        return;
      }
      if (!st.data || !st.data.ok) {
        h += '<div class="sg-note">缠论信号未就绪：' + esc((st.data && st.data.err) || '') + '</div>';
        host.innerHTML = h;
        bind();
        return;
      }
      var d = st.data;
      var sigs = d.signals.slice().reverse();          // 最新在上
      var pages = Math.max(1, Math.ceil(sigs.length / 10));
      if (st.page > pages) st.page = pages;
      var tn = sigs.length;

      /* 汇总行 */
      var s2 = d.stats || {};
      var tc = s2.trendCnt || {};
      h += '<div class="ud-pginfo">两年K线 <b>' + d.candles + '</b> 根（' + esc(fmtD(d.from)) + ' ~ ' + esc(fmtD(d.to)) +
        '）· 信号 <b>' + (s2.total || 0) + '</b>（<b class="num-up">买 ' + (s2.buy || 0) + '</b> / <b class="num-dn">卖 ' + (s2.sell || 0) + '</b>）' +
        ' · 平均段 <b>' + (s2.avgSegBars || 0) + '</b>根 / <b>' + (s2.avgSegAmp || 0) + '%</b>' +
        ' · 前段均涨占比 <b>' + (s2.avgSegRatio === null || s2.avgSegRatio === undefined ? '-' : s2.avgSegRatio + '%') + '</b>' +
        ' · 规律分布 升<b>' + (tc['前低后高(升)'] || 0) + '</b>/降<b>' + (tc['前高后低(降)'] || 0) + '</b>/平稳<b>' + (tc['平稳'] || 0) + '</b>' +
        ' · 计算耗时 ' + d.computeMs + 'ms</div>';

      if (!dt) dt = new global.DetailTable({ pageSize: 10, emptyText: '无信号', tableClass: 'ud-excel ud-sig' });
      dt.cols = cols();
      dt.setData(sigs.map(function (sg, idx) {
        var o = Object.assign({}, sg);
        o._tds = rowTds(o, idx + 1);
        return o;
      }), tn, st.page);
      h += dt.html();
      h += '<div class="tbl-pg" data-chanpg="1" style="padding:6px 4px 2px">' + dt.pagerHTML('chanpg') + '</div>';

      /* 分段明细区 */
      h += '<div class="cd-t" style="margin:10px 0 4px">📐 前段逐根K线涨跌家数比例（当前展开：' +
        (st.seqTs ? esc(fmtDT(st.seqTs)) + ' 的信号' : '未选择 · 点击表格「查看」') + '）</div>';
      h += '<div data-chanseqbox="1">';
      if (st.seqLoading) {
        h += '<div class="sg-note">⏳ 加载该连线区间的逐根比例…</div>';
      } else if (st.seqData && st.seqData.err) {
        h += '<div class="sg-note">' + esc(st.seqData.err) + '</div>';
      } else if (st.seqData) {
        var q = st.seqData;
        h += '<div class="ud-pginfo">该信号（' + (q.type === 'B' ? '底·买' : '顶·卖') + ' @ ' + q.px +
          '）之前连线：<b>' + q.segBars + '</b>根K线 · 段涨跌幅 <b class="' + (q.segAmp >= 0 ? 'num-up' : 'num-dn') + '">' + pct(q.segAmp) +
          '</b> · 平均上涨占比 <b>' + (q.segAvgRatio === null ? '-' : q.segAvgRatio + '%') + '</b>' +
          '（前半 ' + (q.segFirst === null ? '-' : q.segFirst + '%') + ' / 后半 ' + (q.segSecond === null ? '-' : q.segSecond + '%') +
          ' → <b>' + esc(q.segTrend || '平稳') + '</b>）· 最低 ' + (q.segMinRatio === null ? '-' : q.segMinRatio + '%') +
          ' / 最高 ' + (q.segMaxRatio === null ? '-' : q.segMaxRatio + '%') + '</div>';
        if (!seqdt) seqdt = new global.DetailTable({ pageSize: 20, emptyText: '无数据', tableClass: 'ud-excel' });
        seqdt.cols = seqCols();
        var seqRows = (q.rows || []).map(function (r, idx) {
          var o = Object.assign({}, r); o._tds = seqTds(o, idx); return o;
        });
        var seqPages = Math.max(1, Math.ceil(seqRows.length / 20));
        if (st.seqPage > seqPages) st.seqPage = seqPages;
        seqdt.setData(seqRows, seqRows.length, st.seqPage || 1);
        h += seqdt.html();
        h += '<div class="tbl-pg" data-chanseqpg="1" style="padding:4px 4px 0">' + seqdt.pagerHTML('chanseqpg') + '</div>';
      } else {
        h += '<div class="sg-note">点上方表格「查看」展开该信号前一条连线区间的逐根涨跌比例（共 ' + (st.seqTs ? '' : '自动展示最新信号') + '）</div>';
      }
      h += '</div>';

      h += '<div class="cd-note" style="padding-top:6px;text-align:left">' +
        '<b>规则（有别于常规缠论）</b>：只认「真正的大底/大顶」—— 相邻底顶两点必须同时满足 ' +
        '①间隔≥' + st.minBars + '根K线 ②连线涨跌幅≥' + st.minAmp + '%（ATR模式按波动自适应，原理相同）；' +
        '不满足的小顶小底一律不画线。确认 = 事后回撤/突破达到阈值才成立，全部由已收盘K线划线得来，' +
        '<b>没有任何预测功能</b>。底=买，顶=卖；先买后卖连线为红线，先卖后买连线为绿线；' +
        '进行中未确认段为虚线。K线悬浮窗保留全市场涨跌家数。</div>';

      host.innerHTML = h;
      bind();
    }

    function bind() {
      if (!host) return;
      var sel = host.querySelector('[data-chanp="minBars"]');
      if (sel) sel.onchange = function () { st.minBars = parseInt(sel.value, 10) || 40; st.page = 1; st.seqTs = null; st.seqData = null; fetch(true); };
      var sel2 = host.querySelector('[data-chanp="mode"]');
      if (sel2) sel2.onchange = function () { st.mode = sel2.value || 'pct'; st.page = 1; st.seqTs = null; st.seqData = null; fetch(true); };
      var rf = host.querySelector('[data-chanrefresh]');
      if (rf) rf.onclick = function () { st.page = 1; fetch(true); };
      var pg = host.querySelector('[data-chanpg]');
      if (pg) dt.bindPager(pg, 'chanpg', function (p) { st.page = p; render(); });
      var spg = host.querySelector('[data-chanseqpg]');
      if (spg && seqdt) seqdt.bindPager(spg, 'chanseqpg', function (p) { st.seqPage = p; render(); });
      host.querySelectorAll('[data-chanseq]').forEach(function (btn) {
        btn.onclick = function () { loadSeq(parseInt(btn.getAttribute('data-chanseq'), 10)); };
      });
    }

    function label(g) {
      return ({ '3m': '3分钟', '5m': '5分钟', '15m': '15分钟', '1h': '1小时', '2h': '2小时', '4h': '4小时' })[g] || g;
    }

    /* 首次挂载: 自动展开最新信号的分段明细 */
    function autoSeq() {
      if (st.seqTs || !st.data || !st.data.ok || !st.data.signals.length) return;
      loadSeq(st.data.signals[st.data.signals.length - 1].ts);
    }
    var _render = render;
    render = function () { _render(); if (st.data && st.data.ok) autoSeq(); };

    fetch(false);

    return {
      setGrain: function (g) {
        if (g === st.grain && st.data) { render(); return; }
        st.grain = g; st.page = 1; st.seqTs = null; st.seqData = null; st.data = null;
        var c = cached(g, { minBars: st.minBars, minAmp: st.minAmp, mode: st.mode });
        if (c) { st.data = c; render(); onSignals(); var pgN = Math.max(1, Math.ceil(c.signals.length / 10)); if (st.page > pgN) st.page = pgN; autoSeq(); }
        fetch(false);
      },
      refresh: function () { fetch(true); },
      state: st,
      destroy: function () { st.dead = true; if (host) host.innerHTML = ''; }
    };
  }

  global.ChanMajor = {
    load: load,
    cached: cached,
    chartData: chartData,
    mount: mount,
    /* 页面直接预取某分时的信号(给K线画线用, 不挂DOM) */
    ensure: function (grain, opt) {
      return load(grain, opt || {}, false);
    }
  };

})(typeof window !== 'undefined' ? window : this);
