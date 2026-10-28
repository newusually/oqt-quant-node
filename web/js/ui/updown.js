/* ============================================================================
 * web/js/ui/updown.js —— ★全市场涨跌家数统计面板（2026-10-26）
 * ----------------------------------------------------------------------------
 * 用户需求：
 *   "在首页总览播报下面 画图 画表格 要求详细时间 总共三个月 每15分钟计算
 *    上涨多少家/下跌多少家 比例 差额 和主力合约涨幅比较 画曲线 画表格"
 *   ★2026-10-26 追加:
 *     - K线图分时选项卡：按分钟数顺序 3m/5m/15m/1h/2h/4h 随时切换
 *     - 详细表格区【独立分时选项卡】：按分钟数切换看该分时详细表格 + 回测
 *     - BTC 涨跌家数买卖信号：跟随表格选项卡显示该分时回测面板（带分页）
 *     - 详细表格 / 信号回测均带分页按钮（可翻历史）
 *     - K线图上叠加买卖信号买点标记；BTC K线显示涨幅
 * ----------------------------------------------------------------------------
 * ★数据源：/api/boards/updown / /api/boards/buysignal
 * ========================================================================== */
(function (global) {
  'use strict';
  var EKit = global.EKit, Net = global.Net, Tip = global.Tip;
  if (!EKit || !Net) return;

  var UID = 'ud' + Math.random().toString(36).slice(2, 7);
  var REG = {};

  /* ★分时选项卡（用户 2026-10-26: 按分钟数顺序先后 3m→5m→15m→1h→2h→4h） */
  var TF = [
    { id: '3m', label: '3分钟' },
    { id: '5m', label: '5分钟' },
    { id: '15m', label: '15分钟' },
    { id: '1h', label: '1小时' },
    { id: '2h', label: '2小时' },
    { id: '4h', label: '4小时' }
  ];

  function esc(s) {
    return String((s === null || s === undefined) ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDT(ts) {
    if (!ts) return '-';
    var d = new Date(ts);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) +
      ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function bias(v) { return (v === null || v === undefined) ? '' : (v > 0 ? 'up' : (v < 0 ? 'dn' : 'flat')); }
  function tfLabel(g) { for (var i = 0; i < TF.length; i++) if (TF[i].id === g) return TF[i].label; return g; }

  function st() {
    if (!REG[UID]) {
      REG[UID] = {
        grain: '15m',        /* K线分时 */
        tgrain: '15m',       /* 详细表格+回测分时（独立选项卡） */
        sector: '', lead: 'BTC', bars: 2000,
        loadingOlder: false,        /* ★2026-10-28 「« 更早」加载中标记(防重复点击) */
        /* ★2026-10-28 服务端分页状态: tBefore=回溯锚点(0=最新窗口) tPages=当前窗口总页数
         *   tWinBack=已往回开了几个窗口(用于提示「第 N 段历史」) tTotal=当前窗口总根数 */
        tBefore: 0, tPages: 0, tWinBack: 0, tTotal: 0,
        kdata: null,         /* K线分时数据 */
        tdata: null,         /* 表格分时数据 */
        el: null, refs: {},
        tpage: 1, tPageSize: 20,   /* 详细表格分页 */
        spage: 1, sPageSize: 10,   /* 信号回测分页 */
        sigs: null, sigsAt: 0
      };
    }
    return REG[UID];
  }

  var SECTORS = [
    { id: '', name: '全市场' },
    { id: 'l1', name: '公链层' }, { id: 'l2', name: '扩容层' },
    { id: 'defi', name: 'DeFi' }, { id: 'meme', name: 'Meme' },
    { id: 'ai', name: 'AI' }, { id: 'infra', name: '基础设施' },
    { id: 'nft', name: '链游与NFT' }, { id: 'rwa', name: '实物资产' },
    { id: 'other', name: '其他加密' }
  ];
  var LEADS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'LINK'];

  function build(el) {
    var s = st();
    s.el = el;
    var secOpts = SECTORS.map(function (x) {
      return '<option value="' + x.id + '">' + x.name + '</option>';
    }).join('');
    var leadOpts = LEADS.map(function (x) {
      return '<option value="' + x + '"' + (x === s.lead ? ' selected' : '') + '>' + x + '</option>';
    }).join('');
    var tfBtns = TF.map(function (f) {
      return '<button class="tf-tab' + (f.id === s.grain ? ' on' : '') + '" data-grain="' + f.id + '">' + f.label + '</button>';
    }).join('');
    var tfBtns2 = TF.map(function (f) {
      return '<button class="tf-tab' + (f.id === s.tgrain ? ' on' : '') + '" data-grain="' + f.id + '">' + f.label + '</button>';
    }).join('');

    el.innerHTML =
      '<div class="md-hd">' +
      '<span class="md-t">📊 全市场涨跌家数 <small>上涨/下跌家数 · 比例 · 差额 vs 主力涨幅</small></span>' +
      '<select class="md-sel" id="ud-sec-' + UID + '">' + secOpts + '</select>' +
      '<select class="md-sel" id="ud-lead-' + UID + '">' + leadOpts + '</select>' +
      '<button class="md-btn" id="ud-refresh-' + UID + '" title="刷新数据">⟳ 刷新</button>' +
      '<span class="md-live"><i class="pn-dot"></i><span id="ud-tm-' + UID + '">加载中…</span></span>' +
      '</div>' +

      /* ---------- ① K线区：分时选项卡（3m/5m/15m/1h/2h/4h） ---------- */
      '<div class="tf-bar">' +
      '<span class="tf-ttl">⏱ K线分时：</span><span class="tf-stmp" id="ud-tflabel-' + UID + '"></span>' +
      '<span class="tf-grp">' + tfBtns + '</span>' +
      '</div>' +
      '<div class="cd-stats" id="ud-stats-' + UID + '"></div>' +
      '<div class="cd-box">' +
      '<div class="cd-t">📈 <span id="ud-kttl-' + UID + '">' + esc(s.lead) + 'USDT</span> ' +
      '<span class="tf-cur" id="ud-kgrain-' + UID + '">15分钟</span> K线 ' +
      '<small>分时选项卡切换 · 悬浮显示该时间全市场涨跌统计 · 下跌占比≥50%连3次→≤20%处标买点</small></div>' +
      '<div id="ud-ratio-' + UID + '" class="cd-chart" style="height:460px;position:relative">' +
      '<canvas id="ud-kcv-' + UID + '" style="width:100%;height:460px;display:block"></canvas>' +
      '</div>' +
      '</div>' +

      /* ---------- ② 详细表格 + 回测区：独立分时选项卡（用户: 表格上面加选项卡,
       *             可以按分钟数选项 直接看回测/详细表格） ---------- */
      '<div class="ud-tbwrap">' +
      '<div class="tf-bar" style="padding:8px 4px 2px">' +
      '<span class="tf-ttl">📋 表格分时：</span><span class="tf-stmp" id="ud-tbflabel-' + UID + '"></span>' +
      '<span class="tf-grp" id="ud-tfgrp2-' + UID + '">' + tfBtns2 + '</span>' +
      '</div>' +
      '<div class="cd-t" style="margin:6px 4px">📋 详细表格 · 按<b class="tf-cur" id="ud-tbgrain-' + UID + '">15分钟</b>分布（最新在上 · 分页可翻历史） ' +
      '<small>Excel 全框线 · ' + esc(s.lead) + ' 最高/收盘/涨幅/振幅/最高幅度/涨跌幅 与全市场涨跌统计对齐</small></div>' +
      '<div class="ud-tbscroll" id="ud-tb-' + UID + '"></div>' +
      /* ★分页条放在滚动容器外固定显示（修: 限高420px时分页按钮被推到底看不到） */
      '<div class="tbl-pg" id="ud-tpg-' + UID + '" style="padding:8px 4px"></div>' +
      '</div>' +
      '<div class="ud-sigwrap">' +
      '<div class="cd-t" style="margin-bottom:6px">🛒 <b id="ud-siggrain-' + UID + '">15分钟</b> BTC 涨跌家数买卖信号回测 <small>' +
      '规则：下跌占比≥50%连续3次 → 第4次≤20% 买入BTC · 跟随表格分时选项卡 · 仅BTC · 分页可翻历史</small></div>' +
      '<div id="ud-sig-' + UID + '"></div>' +
      '</div>' +
      /* ★2026-10-26 用户要求：连续上涨/下跌家数 > 100 的区段统计 + BTC 多空关系核实 */
      '<div class="ud-strwrap">' +
      '<div class="cd-t" style="margin-bottom:6px">📊 <b id="ud-strgrain-' + UID + '">15分钟</b> 连续涨跌家数统计 · BTC 多空关系核实 <small>' +
      '连续 N 根 上涨/下跌家数 &gt; 100 之后，做多还是做空更划算（真实K线回测）</small></div>' +
      '<div id="ud-str-' + UID + '"><div class="sg-note">加载中…</div></div>' +
      '<div class="tbl-pg" id="ud-spg-' + UID + '" style="padding:8px 4px"></div>' +
      '</div>' +
      '<div class="cd-note" id="ud-note-' + UID + '"></div>';

    s.refs = {
      sec: el.querySelector('#ud-sec-' + UID),
      lead: el.querySelector('#ud-lead-' + UID),
      refresh: el.querySelector('#ud-refresh-' + UID),
      tm: el.querySelector('#ud-tm-' + UID),
      tflabel: el.querySelector('#ud-tflabel-' + UID),
      tbflabel: el.querySelector('#ud-tbflabel-' + UID),
      stats: el.querySelector('#ud-stats-' + UID),
      ratio: el.querySelector('#ud-ratio-' + UID),
      kcv: el.querySelector('#ud-kcv-' + UID),
      tb: el.querySelector('#ud-tb-' + UID),
      str: el.querySelector('#ud-str-' + UID),
      spg: el.querySelector('#ud-spg-' + UID),
      strgrain: el.querySelector('#ud-strgrain-' + UID),
      note: el.querySelector('#ud-note-' + UID),
      sig: el.querySelector('#ud-sig-' + UID),
      kgrain: el.querySelector('#ud-kgrain-' + UID),
      tbgrain: el.querySelector('#ud-tbgrain-' + UID),
      siggrain: el.querySelector('#ud-siggrain-' + UID),
      kttl: el.querySelector('#ud-kttl-' + UID)
    };
    s.refs.sec.value = s.sector;
    s.refs.sec.addEventListener('change', function () { s.sector = s.refs.sec.value; s.tpage = 1; s.tBefore = 0; s.tPages = 0; s.tWinBack = 0; loadAll(); });
    s.refs.lead.addEventListener('change', function () { s.lead = s.refs.lead.value; s.sigs = null; s.tpage = 1; s.tBefore = 0; s.tPages = 0; s.tWinBack = 0; loadAll(); });
    s.refs.refresh.addEventListener('click', function () { loadAll(); });
    /* ★连续涨跌统计分页 */
    if (s.refs.spg) s.refs.spg.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var p = t.getAttribute('data-spage');
      if (!p) return;
      s.stpage = parseInt(p, 10) || 1;
      renderStreak();
    });
    /* ★K线分时切换（只刷K线） */
    var bar1 = el.querySelector('.tf-grp');
    if (bar1) bar1.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('.tf-tab') : null;
      if (!t || !t.getAttribute('data-grain')) return;
      var g = t.getAttribute('data-grain');
      if (g === s.grain) return;
      s.grain = g;
      Array.prototype.forEach.call(bar1.children, function (b) {
        b.classList.toggle('on', b.getAttribute('data-grain') === g);
      });
      if (s.refs.kgrain) s.refs.kgrain.textContent = tfLabel(g);
      loadK();
    });
    /* ★表格分时切换（刷详细表格 + 该分时回测面板） */
    var bar2 = el.querySelector('#ud-tfgrp2-' + UID);
    if (bar2) bar2.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('.tf-tab') : null;
      if (!t || !t.getAttribute('data-grain')) return;
      var g = t.getAttribute('data-grain');
      if (g === s.tgrain) return;
      s.tgrain = g;
      s.tpage = 1; s.spage = 1;                       // 切分时重置页码
      s.tBefore = 0; s.tPages = 0; s.tWinBack = 0;    // ★回到「最新窗口」(否则还在上一段历史里)
      Array.prototype.forEach.call(bar2.children, function (b) {
        b.classList.toggle('on', b.getAttribute('data-grain') === g);
      });
      if (s.refs.tbgrain) s.refs.tbgrain.textContent = tfLabel(g);
      if (s.refs.siggrain) s.refs.siggrain.textContent = tfLabel(g);
      if (s.refs.tbflabel) s.refs.tbflabel.textContent = tfLabel(g);
      /* ★原来这里复用 K线区的全窗数据省一次请求; 改为服务端分页后两者数据形状不同
       *   (K线要全窗 leadCandles, 表格只要本页行) → 表格始终按自己的页码请求 */
      loadT();
    });
  }

  /* ---------------- 数据加载 ----------------
   * o: { beforeTs, page, pageSize, bars, ttl }
   *   ★服务端分页(2026-10-28): 传 page/pageSize 时后端只回该页的行(默认不传=全量, 零风险);
   *     page 支持负数 —— -1 = 最新一页, 表格"最新在上"的首屏无需先知道总页数。
   *   ★历史页是不可变的 → 不带 &t= 时间戳, 让 Net 层缓存生效, 回翻已看过的页秒开。 */
  function fetchUpdown(grain, o) {
    o = o || {};
    var s = st();
    var url = '/api/boards/updown?grain=' + encodeURIComponent(grain) + '&sector=' + encodeURIComponent(s.sector) +
      '&lead=' + encodeURIComponent(s.lead) + '&bars=' + (o.bars || s.bars);
    if (o.beforeTs) url += '&beforeTs=' + o.beforeTs;
    if (o.page && o.pageSize) url += '&page=' + o.page + '&pageSize=' + o.pageSize;
    /* 历史页不可变 → 不带时间戳, Net 层缓存生效, 回翻看过的页秒开;
     *   但「最新一页」会随时间增长 → 必须带 &t= 绕过缓存, 否则首屏数据可能滞后 30 秒 */
    if (!o.page || o.fresh) url += '&t=' + Date.now();
    return Net.get(url, { ttl: o.ttl || 8000, timeout: 60000 });
  }

  /* K线分时数据（含顶部统计条）—— 这里不分页：K线图需要连续窗口(默认 2000 根) */
  function loadK() {
    var s = st();
    fetchUpdown(s.grain).then(function (j) {
      if (!j || !j.ok) {
        if (s.refs.stats) s.refs.stats.innerHTML = '<div class="sg-note">数据未就绪：' + esc((j && j.err) || '') + '</div>';
        if (s.refs.tm) s.refs.tm.textContent = '加载失败';
        return;
      }
      s.kdata = j;
      renderK();
      if (s.refs.tflabel) s.refs.tflabel.textContent = tfLabel(s.grain);
      if (s.refs.tm) s.refs.tm.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');
    }).catch(function () { });
  }

  /* 表格数据（详细表格 + 该分时回测）—— ★服务端分页版
   *   只请求「当前页」(TPAGE_SIZE 行)而不是整个 2000 根窗口 → 单次传输 MB 级降到 KB 级。
   *   方向换算: 后端 page 1 = 最早; 本表格"最新在上", UI 页码 1 = 最新
   *             → serverPage = pages - (uiPage - 1)。首屏 pages 未知, 先传 -1 取末页。 */
  var TPAGE_SIZE = 10;
  function tServerPage(uiPage) {
    var s = st(), pages = s.tPages || 0;
    if (!pages) return -1;
    return Math.max(1, pages - (uiPage - 1));
  }
  function loadT(uiPage, beforeTs) {
    var s = st();
    uiPage = uiPage || 1;
    if (beforeTs !== undefined) { s.tBefore = beforeTs; s.tPages = 0; }
    if (s.refs.tb) s.refs.tb.innerHTML = '<div class="sg-note">表格加载中…</div>';
    fetchUpdown(s.tgrain, {
      beforeTs: s.tBefore || 0,
      page: tServerPage(uiPage),
      pageSize: TPAGE_SIZE,
      fresh: (uiPage === 1 && !s.tBefore),      // 最新窗口的最新一页 → 不允许走前端缓存
      ttl: 30000
    }).then(function (j) {
      if (!j || !j.ok) {
        if (s.refs.tb) s.refs.tb.innerHTML = '<div class="sg-note">表格数据未就绪：' + esc((j && j.err) || '') + '</div>';
        return;
      }
      s.tdata = j;
      var pi = j.pageInfo || null;
      if (pi) {
        s.tPages = pi.pages; s.tTotal = pi.total;
        s.tpage = Math.max(1, pi.pages - pi.page + 1);   // 服务端页码 → UI 页码(最新在上)
      }
      renderT();
      renderSig();
      if (s.refs.tbflabel) s.refs.tbflabel.textContent = tfLabel(s.tgrain);
      loadStreak();          // ★表格分时切换 → 连续涨跌统计跟着换周期
    })['catch'](function () { });
  }

  /* ★连续涨跌家数 > 阈值 的区段统计（BTC 多空关系核实） */
  function loadStreak() {
    var s = st();
    var g = s.tgrain || s.grain;
    if (s.refs.strgrain) s.refs.strgrain.textContent = tfLabel(g);
    if (s.strGrain === g && s.strData && Date.now() - s.strAt < 60000) { renderStreak(); return; }
    Net.get('/api/boards/streak?grain=' + g + '&thr=100&minLen=2&bars=2000&maxRows=400', { ttl: 60000, timeout: 120000 })
      .then(function (j) {
        if (!j || !j.ok) {
          if (s.refs.str) s.refs.str.innerHTML = '<div class="sg-note">连续统计未就绪：' + esc((j && j.err) || '') + '</div>';
          return;
        }
        s.strData = j; s.strAt = Date.now(); s.strGrain = g; s.stpage = 1;
        renderStreak();
      }).catch(function () { });
  }

  function renderStreak() {
    var s = st(), j = s.strData;
    if (!j || !s.refs.str) return;
    var rows = j.rows || [];
    var size = 20, pages = Math.max(1, Math.ceil(rows.length / size));
    var page = Math.max(1, Math.min(pages, s.stpage || 1));
    var slice = rows.slice((page - 1) * size, (page - 1) * size + size);
    function nv(x) { return (x === null || x === undefined) ? '-' : x; }
    function pv(x) { return (x === null || x === undefined) ? '-' : ((x > 0 ? '+' : '') + x.toFixed(2) + '%'); }
    var h = '';
    if (j.concl && j.concl.length) {
      h += '<div class="ud-strconcl">' + j.concl.map(function (c) { return '<div>🔎 ' + esc(c) + '</div>'; }).join('') + '</div>';
    }
    var su = (j.summary || {}).up || {}, sd = (j.summary || {}).down || {};
    function sumRow(name, x) {
      if (!x.n) return '<tr><td>' + name + '</td><td class="num">0</td><td colspan="7" class="muted">样本不足</td></tr>';
      var bh = x.byHold || {};
      return '<tr><td>' + name + '</td><td class="num">' + x.n + '</td>' +
        '<td class="num">' + nv(x.avgLong) + '</td><td class="num">' + nv(x.avgShort) + '</td>' +
        '<td class="num">' + nv(x.winLong) + '</td><td class="num">' + nv(x.winShort) + '</td>' +
        '<td class="num">' + ((bh.h1 && bh.h1.avgLong !== null) ? bh.h1.avgLong : '-') + '</td>' +
        '<td class="num">' + ((bh.h5 && bh.h5.avgLong !== null) ? bh.h5.avgLong : '-') + '</td>' +
        '<td class="num">' + ((bh.h10 && bh.h10.avgLong !== null) ? bh.h10.avgLong : '-') + '</td></tr>';
    }
    h += '<table class="ud-excel"><thead><tr><th>信号</th><th>段数</th>' +
      '<th>做多均值%(持3)</th><th>做空均值%(持3)</th><th>做多胜率%</th><th>做空胜率%</th>' +
      '<th>持1均值%</th><th>持5均值%</th><th>持10均值%</th></tr></thead><tbody>' +
      sumRow('连续上涨家数&gt;100', su) + sumRow('连续下跌家数&gt;100', sd) + '</tbody></table>';
    h += '<div class="cd-t" style="margin:10px 0 6px">📋 分时明细（每段结束后的真实走势 · 最新在上）</div>';
    h += '<table class="ud-excel"><thead><tr><th>结束时间</th><th>信号</th><th>连续根数</th>' +
      '<th>平均涨家</th><th>平均跌家</th><th>样本</th><th>持1</th><th>持3</th><th>持5</th><th>持10</th>' +
      '<th>做多</th><th>做空</th></tr></thead><tbody>';
    slice.forEach(function (r) {
      var a = r.after || {};
      var cl = (r.longRet === null || r.longRet === undefined) ? '' : (r.longRet > 0 ? 'num-up' : 'num-dn');
      var cs = (r.shortRet === null || r.shortRet === undefined) ? '' : (r.shortRet > 0 ? 'num-up' : 'num-dn');
      h += '<tr><td>' + esc(fmtDT(r.endTs)) + '</td>' +
        '<td>' + (r.type === 'up' ? '<span class="num-up">连续涨</span>' : '<span class="num-dn">连续跌</span>') + '</td>' +
        '<td class="num">' + r.len + '</td><td class="num">' + r.upAvg + '</td><td class="num">' + r.downAvg + '</td>' +
        '<td class="num">' + r.total + '</td>' +
        '<td class="num">' + pv(a.h1) + '</td><td class="num">' + pv(a.h3) + '</td>' +
        '<td class="num">' + pv(a.h5) + '</td><td class="num">' + pv(a.h10) + '</td>' +
        '<td class="' + cl + '">' + pv(r.longRet) + '</td><td class="' + cs + '">' + pv(r.shortRet) + '</td></tr>';
    });
    h += '</tbody></table>';
    s.refs.str.innerHTML = h;
    if (s.refs.spg) s.refs.spg.innerHTML = pageBtns(pages, page, 'spage');
  }

  /* BTC信号：六周期一次取回（表格选项卡切换只切换显示面板，不重复请求） */
  function loadSigs(force) {
    var s = st();
    if (!force && s.sigs && Date.now() - s.sigsAt < 20000) { renderSig(); return; }
    Net.get('/api/boards/buysignal?bars=2000&t=' + Date.now(), { ttl: 20000, timeout: 90000 })
      .then(function (j) {
        if (j && j.ok) { s.sigs = j; s.sigsAt = Date.now(); renderSig(); renderK(); }
      }).catch(function () { });
  }

  function loadAll() {
    loadK();
    loadT();
    loadSigs(true);
    loadStreak();
  }

  /* ---------------- ① K线区渲染（当前 grain） ---------------- */
  function renderK() {
    var s = st(), j = s.kdata;
    if (!j || !s.refs.ratio) return;
    var bars = j.bars || [];
    var stx = j.stats || {};

    var cdl = (j.leadCandles || []).slice(-Math.max(s.bars, 100));
    var barByTs = {};
    bars.forEach(function (x) { if (x.ts) barByTs[x.ts] = x; });
    if (cdl && cdl.length && global.drawKline && s.refs.kcv) {
      /* 预计算前一根收盘（最高涨幅% / 涨跌幅%） */
      var prev = {};
      for (var k1 = 0; k1 < cdl.length; k1++) {
        prev[cdl[k1].ts] = (k1 > 0 && cdl[k1 - 1] && isFinite(cdl[k1 - 1].c)) ? cdl[k1 - 1].c : null;
      }
      /* ★K线买卖点标记：当前周期的全部买信号（红火箭下） */
      var mk = [];
      if (s.sigs && s.sigs.all) {
        for (var mi = 0; mi < s.sigs.all.length; mi++) {
          var it = s.sigs.all[mi];
          if (!it || it.grain !== s.grain || !it.signals) continue;
          for (var k2 = 0; k2 < it.signals.length; k2++) {
            var sg = it.signals[k2];
            mk.push({ t: sg.ts, dir: 1, price: sg.buyPx, label: '≈买' + tfLabel(s.grain) });
          }
          break;
        }
      }
      global.drawKline(s.refs.kcv, {
        bars: cdl.map(function (ck) { return { t: ck.ts, o: ck.o, h: ck.h, l: ck.l, c: ck.c, v: ck.v }; }),
        mainInd: 'ma', subInd: 'macd',
        height: 460, stateKey: 'feed:' + s.lead + ':' + s.grain,
        marks: mk,
        extraTitle: function () { return '全市场涨跌统计'; },
        extraRows: function (b) {
          var bi = barByTs[b.t] || {};
          var pc = prev[b.t];
          var hiR = (pc && isFinite(pc) && pc > 0 && isFinite(b.h)) ? (b.h - pc) / pc * 100 : null;
          var chg = (pc && isFinite(pc) && pc > 0 && isFinite(b.c)) ? (b.c - pc) / pc * 100 : null;
          var up = bi.up, dn = bi.down, upR = bi.upRatio, df = bi.diff;
          var upC = '#f0334b', dnC = '#0bbf7a', dim = '#d7dcea';
          function pp(v) { return (v === null || v === undefined) ? '-' : ((v > 0 ? '+' : '') + v.toFixed(3) + '%'); }
          function nn(v) { return (v === null || v === undefined) ? '-' : v; }
          return [
            ['上涨家数', nn(up), (up !== null && up !== undefined) ? '#f0334b' : dim],
            ['下跌家数', nn(dn), (dn !== null && dn !== undefined) ? '#0bbf7a' : dim],
            ['上涨比例', (upR === null || upR === undefined) ? '-' : upR + '%', (upR !== null && upR !== undefined && upR >= 50) ? '#f0334b' : dnC],
            ['差额(涨-跌)', (df === null || df === undefined) ? '-' : ((df > 0 ? '+' : '') + df), (df && df > 0) ? '#f0334b' : '#0bbf7a'],
            ['BTC涨幅%', pp(chg), (chg !== null && chg > 0) ? upC : dnC],
            ['最高涨幅%', pp(hiR), (hiR !== null && hiR > 0) ? upC : dnC]
          ];
        }
      });
    } else if (s.refs.ratio) {
      if (s.refs.kcv) s.refs.kcv.style.display = 'none';
      s.refs.ratio.innerHTML = '<div class="sg-note">' + s.lead + ' ' + tfLabel(s.grain) + ' K线数据回填中…</div>';
    }

    /* 顶部统计条（跟随 K线分时） */
    if (s.refs.stats) {
      s.refs.stats.innerHTML =
        b('上涨家数', stx.lastUp, 'up') +
        b('下跌家数', stx.lastDown, 'dn') +
        b('当前比例', (stx.lastRatio === null || stx.lastRatio === undefined) ? '-' : stx.lastRatio.toFixed(1) + '%',
          stx.lastRatio >= 50 ? 'up' : 'dn') +
        b('差额', (stx.lastDiff === null || stx.lastDiff === undefined) ? '-' : ((stx.lastDiff > 0 ? '+' : '') + stx.lastDiff),
          bias(stx.lastDiff)) +
        b(s.lead + ' 涨幅', (stx.lastLead === null || stx.lastLead === undefined) ? '-' : ((stx.lastLead > 0 ? '+' : '') + stx.lastLead.toFixed(3) + '%'),
          stx.lastLead > 0 ? 'up' : (stx.lastLead < 0 ? 'dn' : 'flat')) +
        b(s.lead + ' 收盘', (stx.lastClose === null || stx.lastClose === undefined) ? '-' : stx.lastClose.toFixed(2), bias(stx.lastLead)) +
        b('覆盖合约', j.covCount + ' / ' + j.count, '') +
        b('比例↔主力 r', (stx.corr === null || stx.corr === undefined) ? '-' : stx.corr, '') +
        b('同向一致率', (stx.agree === null || stx.agree === undefined) ? '-' : stx.agree + '%', '');
    }
    if (s.refs.note) {
      var oldS = j.oldest || 0, newS = j.newest || 0;
      s.refs.note.innerHTML =
        '<b>' + esc(tfLabel(s.grain)) + '</b> · 共 <b>' + bars.length + '</b> 个时间片 · 覆盖 <b>' + esc(fmtDT(oldS)) +
        '</b> ~ <b>' + esc(fmtDT(newS)) + '</b>（<b>' + j.spanDays + '</b> 天）· <b>' + j.covCount + '/' + j.count +
        '</b> 合约有数据 · 上涨比例↔主力涨幅 r=<b>' + ((stx.corr === null || stx.corr === undefined) ? '-' : stx.corr) +
        '</b> 一致率 <b>' + ((stx.agree === null || stx.agree === undefined) ? '-' : stx.agree + '%') + '</b> · ' +
        '<span class="muted">K线上 ▲ 为涨跌家数买信号（下跌占比连续3根≥50%后第4根≤20%）</span>';
    }
  }

  function b(k, v, cls) {
    return '<div class="md-stat"><span>' + esc(k) + '</span><b class="' + (cls || '') + '">' + esc(v) + '</b></div>';
  }

  /* ---------------- ② 详细表格（当前 tgrain · 全量行 · 分页） ---------------- */
  function buildTableRows(j) {
    /* ★2026-10-28 修复: 表格主轴必须是「本页 bars」(服务端已按页码裁成 20 行, 每行都带涨跌家数),
     *   而不能是 leadCandles(满窗口 2000 根 K线)。旧实现以 leadCandles 为轴、再去 bars 里按 ts 查家数,
     *   但本页只回传了 20 行 bars → 2000 行里仅 20 行有家数, 其余(更早的 03:45 等)全显示空白;
     *   表现为"详细表格只有最新一小段有数、更早全空"且所有周期都如此。
     *   现改为遍历 bars(本页 20 行, 家数必齐全), 用 ts 去 leadCandles 取 BTC 价(K线图仍用满窗, 不受影响)。 */
    var clByTs = {};
    (j.leadCandles || []).forEach(function (x) { if (x.ts) clByTs[x.ts] = x; });
    var bars = (j.bars || []).slice().sort(function (a, b) { return a.ts - b.ts; });
    var out = [];
    for (var i = 0; i < bars.length; i++) {
      var bi = bars[i];
      var ck = clByTs[bi.ts] || null;
      var rp = bi.upRatio;
      var diffTxt = (bi.diff === null || bi.diff === undefined) ? '-' : ((bi.diff > 0 ? '+' : '') + bi.diff);
      var total = bi.total || 0;
      /* ★前收盘优先取 K线自带 pc(整条序列真实前一根, 分页安全); 否则本页上一根 bar 的收 */
      var pc = (ck && ck.pc !== undefined && ck.pc !== null && isFinite(ck.pc)) ? +ck.pc
        : ((i > 0 && bars[i - 1] && isFinite(bars[i - 1].c)) ? bars[i - 1].c : null);
      var c = (ck && ck.c !== null && ck.c !== undefined) ? +ck.c : null;
      var h = (ck && ck.h !== null && ck.h !== undefined) ? +ck.h : null;
      var lo = (ck && ck.l !== null && ck.l !== undefined) ? +ck.l : null;
      var chg = (c !== null && pc) ? (c - pc) / pc * 100 : null;
      var amp = (h !== null && lo !== null && pc) ? (h - lo) / pc * 100 : null;
      var hiR = (h !== null && pc) ? (h - pc) / pc * 100 : null;
      /* ★2026-10-26 用户要求新增两列：最低价 / 最低价跌幅（相对前一根收盘） */
      var loR = (lo !== null && lo !== undefined && pc) ? (lo - pc) / pc * 100 : null;
      var loCls = (loR === null) ? '' : (loR >= 0 ? 'num-up' : 'num-dn');
      var o = (ck && ck.o !== null && ck.o !== undefined) ? +ck.o : null;
      var oR = (c !== null && o) ? (c - o) / o * 100 : null;
      function px(v, dg) { return (v === null || v === undefined) ? '-' : v.toFixed(dg || 2); }
      function pct2(v) { return (v === null || v === undefined) ? '-' : ((v > 0 ? '+' : '') + v.toFixed(2) + '%'); }
      var cCls = (chg === null) ? '' : (chg >= 0 ? 'num-up' : 'num-dn');
      var hiCls = (hiR === null) ? '' : (hiR >= 0 ? 'num-up' : 'num-dn');
      var oCls = (oR === null) ? '' : (oR >= 0 ? 'num-up' : 'num-dn');
      out.push({
        ts: bi.ts,
        html:
          '<tr>' +
          '<td>' + esc(fmtDT(bi.ts)) + '</td>' +
          '<td>' + (bi.up === null || bi.up === undefined ? '-' : bi.up) + '</td>' +
          '<td>' + (bi.down === null || bi.down === undefined ? '-' : bi.down) + '</td>' +
          '<td>' + total + '</td>' +
          '<td>' + (rp === null || rp === undefined ? '-' : rp.toFixed(2) + '%') + '</td>' +
          '<td>' + diffTxt + '</td>' +
          '<td class="num-up">' + px(h) + '</td>' +
          '<td class="num-dn">' + px(lo) + '</td>' +
          '<td class="' + ((c !== null) ? (c >= o ? 'num-up' : 'num-dn') : '') + '"><b>' + px(c) + '</b></td>' +
          '<td class="' + cCls + '">' + pct2(chg) + '</td>' +
          '<td class="num">' + pct2(amp) + '</td>' +
          '<td class="' + hiCls + '">' + pct2(hiR) + '</td>' +
          '<td class="' + oCls + '">' + pct2(oR) + '</td>' +
          '<td class="' + loCls + '">' + pct2(loR) + '</td>' +
          '</tr>'
      });
    }
    out.reverse();          // 最新在上
    return out;
  }

  /* ★分页按钮条（详细表格 / 信号回测共用；用户: 没有分页按钮看不到历史） */
  function pageBtns(pages, cur, prefix) {
    cur = cur || 1;
    var s = '', i, win = 8;
    function pb(num, label, dis, act) {
      return '<button class="tbl-pg-btn' + (act ? ' on' : '') + '" data-' + prefix + '="' + num + '"' + (dis ? ' disabled' : '') + '>' + label + '</button>';
    }
    s += pb(1, '«', cur <= 1, false);
    s += pb((cur - 1) || 1, '‹', cur <= 1, false);
    var lo = Math.max(1, cur - win), hi = Math.min(pages, cur + win);
    for (i = lo; i <= hi; i++) s += pb(i, i, false, i === cur);
    s += pb(Math.min(cur + 1, pages), '›', cur >= pages, false);
    s += pb(pages, '»', cur >= pages, false);
    return s;
  }

  function renderT() {
    var s = st(), j = s.tdata;
    if (!j || !s.refs.tb) return;
    var rows = buildTableRows(j);
    /* ★服务端已裁好页 → rows 直接是本页内容(通常 20 行), 不再本地切一刀。
     *   兜底: 万一没拿到 pageInfo(后端未分页), 本地限制在 100 行内防止一次性渲染几千行。 */
    var pi = j.pageInfo || null;
    var pages = (pi && pi.pages) || Math.max(1, Math.ceil(rows.length / 100));
    var tn = (pi && pi.total) || rows.length;
    if (s.tpage > pages) s.tpage = pages;
    if (s.tpage < 1) s.tpage = 1;
    if (!pi && rows.length > 100) rows = rows.slice((s.tpage - 1) * 100, s.tpage * 100);
    var html = rows.map(function (x) { return x.html; }).join('');
    var backTxt = s.tWinBack > 0 ? (' · 已回溯 <b>' + s.tWinBack + '</b> 段历史') : '';
    /* 表格本体进滚动容器；分页条在容器外固定可见 */
    s.refs.tb.innerHTML =
      '<div class="ud-pginfo">第 <b>' + s.tpage + '</b> / <b>' + pages + '</b> 页 · 当前窗口共 <b>' + tn +
      '</b> 根 · 覆盖约 ' + (j.spanDays || 0) + ' 天' + backTxt + ' · 服务端分页(每页 ' + TPAGE_SIZE + ' 行)</div>' +
      '<table class="ud-excel"><thead>' +
      '<tr><th>时间</th><th>上涨家数</th><th>下跌家数</th>' +
      '<th>样本</th><th>上涨比例</th><th>差额(涨-跌)</th>' +
      '<th>最高价(' + esc(s.lead) + ')</th><th>最低价(' + esc(s.lead) + ')</th><th>收盘价(' + esc(s.lead) + ')</th>' +
      '<th>涨幅%</th><th>振幅%</th><th>最高幅度%</th><th>涨跌幅%</th><th>最低价跌幅%</th>' +
      '</tr></thead><tbody>' + html + '</tbody></table>';
    var pg = s.el.querySelector('#ud-tpg-' + UID);
    if (pg) {
      /* ★2026-10-28 「« 更早」按钮: 窗口收窄到 2000 根后历史深度变浅,
       *   用它按 beforeTs 往回拉更早一批, 拼到现有序列前面 → 既能秒开又能翻到很久以前 */
      var olderBtn = s.loadingOlder
        ? '<span class="ud-pginfo">⏳ 加载更早…</span>'
        : '<button class="ud-pgbtn" data-older="1" title="往回加载更早的 ' + (s.bars || 2000) + ' 根">« 更早</button>';
      pg.innerHTML = olderBtn + pageBtns(pages, s.tpage, 'tp');
      pg.onclick = function (e) {
        var t = e.target;
        if (t && t.dataset && t.dataset.older) { loadOlder(); return; }
        if (t && t.dataset && t.dataset.tp) {
          var p = parseInt(t.dataset.tp, 10);
          if (!isNaN(p) && p !== s.tpage) loadT(p);     // ★换页 → 向服务端请求该页
        }
      };
    }
  }

  /* ★2026-10-28 「« 更早」: 以当前窗口最早一根为锚, 往回再开一个(2000 根的)历史窗口。
   *   分工: 服务端分页 = 窗口内翻页; beforeTs = 跨窗口回溯。两者不重叠, 也不会重复行。
   *   ★边界根防重: 后端 beforeTs 的口径是 ts<=beforeTs(含等于), 故传 oldest-1 保证严格更早。 */
  function loadOlder() {
    var s = st();
    if (s.loadingOlder) return;
    var j = s.tdata;
    if (!j || !j.oldest) return;
    s.loadingOlder = true;
    s.tWinBack = (s.tWinBack || 0) + 1;
    renderT();                       // 立刻把按钮变成「加载中」
    s.loadingOlder = false;
    loadT(1, j.oldest - 1);          // 新窗口先取它最新的一页(页码重置)
  }

  /* ---------------- ③ BTC 信号回测面板（跟随表格分时 · 分页可翻历史） ----------------
   *  规则: 下跌家数占比 downRatio ≥50% 连续3次 → 第4次 ≤20% → 买入BTC */
  function renderSig() {
    var s = st();
    if (!s.refs.sig) return;
    if (!s.sigs) { s.refs.sig.innerHTML = '<div class="sg-note">信号数据加载中…</div>'; return; }
    var all = s.sigs.all || [];
    var a = null;
    for (var i = 0; i < all.length; i++) if (all[i] && all[i].grain === s.tgrain) { a = all[i]; break; }

    if (!a || !a.ok) {
      s.refs.sig.innerHTML = '<div class="ud-sigpanel">' +
        '<div class="cd-t ud-sighd">🪜 <b>' + esc(tfLabel(s.tgrain)) + '</b> <small>' + (a && a.err ? esc(a.err) : '数据回补中…') + '</small></div>' +
        '<table class="ud-excel ud-sig"><tbody><tr><td class="num">—</td></tr></tbody></table>' +
        '</div>' +
        '<div class="cd-note" id="ud-sigstore-' + UID + '" style="text-align:left;color:#66708a"></div>';
      var pg0 = s.el.querySelector('#ud-spg-' + UID);
      if (pg0) pg0.innerHTML = '';
      loadSigStore();
      return;
    }

    var st2 = a.stats || {};
    var sigs = (a.signals || []).slice().reverse();      // 最新在上
    var tn = sigs.length, tp = s.sPageSize || 10;
    var pages = Math.max(1, Math.ceil(tn / tp));
    if (s.spage > pages) s.spage = pages;
    if (s.spage < 1) s.spage = 1;
    var start = (s.spage - 1) * tp, end = Math.min(start + tp, tn);
    var rows = sigs.slice(start, end).map(function (sg, idx) {
      return '<tr>' +
        '<td>' + (start + idx + 1) + '</td>' +
        '<td>' + esc(fmtDT(sg.ts)) + '</td>' +
        '<td class="num-dn">' + esc(sg.buyRatio) + '%</td>' +
        '<td class="num">' + (sg.buyPx === null || sg.buyPx === undefined ? '-' : sg.buyPx) + '</td>' +
        '<td class="' + ((sg.f1 === null || sg.f1 === undefined) ? '' : (sg.f1 >= 0 ? 'num-up' : 'num-dn')) + '">' + pct(sg.f1) + '</td>' +
        '<td class="' + ((sg.f2 === null || sg.f2 === undefined) ? '' : (sg.f2 >= 0 ? 'num-up' : 'num-dn')) + '">' + pct(sg.f2) + '</td>' +
        '<td class="' + ((sg.f3 === null || sg.f3 === undefined) ? '' : (sg.f3 >= 0 ? 'num-up' : 'num-dn')) + '">' + pct(sg.f3) + '</td>' +
        '<td class="' + ((sg.f5 === null || sg.f5 === undefined) ? '' : (sg.f5 >= 0 ? 'num-up' : 'num-dn')) + '">' + pct(sg.f5) + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="8" class="num">无信号</td></tr>';

    s.refs.sig.innerHTML =
      '<div class="ud-sigpanel">' +
      '<div class="cd-t ud-sighd">🪜 ' + esc(tfLabel(s.tgrain)) + ' · 买卖信号回测 ' +
      '<small>信号<b> ' + (st2.total || 0) + '</b>个 · 覆盖 ' + (a.count || 0) + ' 合约 · 仅BTC · 分页可翻历史</small></div>' +
      '<table class="ud-excel ud-sig">' +
      '<thead><tr><th>#</th><th>触发时间</th><th>下跌占比</th><th>买入价</th>' +
      '<th>持1根</th><th>持2根</th><th>持3根</th><th>持5根</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr>' +
      '<td colspan="3" class="bx-l">胜率 <b>' + (st2.win1 === null || st2.win1 === undefined ? '-' : st2.win1 + '/' + (st2.total || 0)) + '</b></td>' +
      '<td class="bx">1均收<b class="' + ((st2.avg1 !== null && st2.avg1 >= 0) ? 'num-up' : 'num-dn') + '">' + pct(st2.avg1) + '</b></td>' +
      '<td class="bx">2均收<b class="' + ((st2.avg2 !== null && st2.avg2 >= 0) ? 'num-up' : 'num-dn') + '">' + pct(st2.avg2) + '</b></td>' +
      '<td class="bx">3均收<b class="' + ((st2.avg3 !== null && st2.avg3 >= 0) ? 'num-up' : 'num-dn') + '">' + pct(st2.avg3) + '</b></td>' +
      '<td class="bx">5均收<b class="' + ((st2.avg5 !== null && st2.avg5 >= 0) ? 'num-up' : 'num-dn') + '">' + pct(st2.avg5) + '</b></td>' +
      '<td class="bx">最佳<b class="num-up">' + pct(st2.best) + '</b><br/>最差<b class="num-dn">' + pct(st2.worst) + '</b></td>' +
      '</tr></tfoot>' +
      '</table>' +
      '<div class="ud-pginfo">第 <b>' + s.spage + '</b> / <b>' + pages + '</b> 页 · 共 <b>' + tn + '</b> 个信号</div>' +
      '</div>' +
      /* ★分页条外置固定可见（与详细表格一致） */
      '<div class="tbl-pg" id="ud-spg-' + UID + '" style="padding:6px 4px 2px">' + pageBtns(pages, s.spage, 'sp') + '</div>' +
      '<div class="cd-note" style="padding-top:6px;text-align:left">' +
      '<b>规则</b>：全市场每个时间片统计下跌家数占比；下跌占比连续3根≥50%（市场普跌）后第4根≤20%（恐慌收敛）→ 买入BTC，' +
      '持有1/2/3/5根后统计涨跌。切换「表格分时」选项卡可看其它分时回测。仅BTC显示买卖信号。</div>' +
      '<div class="cd-note" id="ud-sigstore-' + UID + '" style="text-align:left;color:#66708a">数据库存档状态加载中…</div>';

    var box = s.el.querySelector('#ud-spg-' + UID);
    if (box) box.onclick = function (e) {
      var t = e.target;
      if (t && t.dataset && t.dataset.sp) {
        var p = parseInt(t.dataset.sp, 10);
        if (!isNaN(p)) { s.spage = p; renderSig(); }
      }
    };
    loadSigStore();
  }
  function pct(v) { return (v === null || v === undefined) ? '-' : ((v > 0 ? '+' : '') + v.toFixed(2) + '%'); }

  /* 数据库存档状态 */
  function loadSigStore() {
    var s = st();
    Net.get('/api/boards/buysigstore?t=' + Date.now(), { ttl: 20000, timeout: 30000 })
      .then(function (j) {
        var el = s.el && s.el.querySelector('#ud-sigstore-' + UID);
        if (el && j && j.ok) {
          var ig = j.integrity, parts = [];
          if (ig && ig.grains && ig.grains.length) {
            parts = ig.grains.map(function (g) {
              var dd = (ig.detail || {})[g] || {};
              var full = (dd.klineStoreOk === dd.klineStoreTotal && dd.klineStoreTotal > 0);
              return esc(g) + ' 存' + (dd.n || 0) + '条' +
                (full ? ' ✓' : ' · K线回补中(' + (dd.klineStoreOk || 0) + '/' + (dd.klineStoreTotal || 0) + ')');
            });
          }
          el.innerHTML = '<b>📦 已存档 ' + (j.count || 0) + ' 条</b>（自动落库 buysig.sqlite）· ' + parts.join('　');
        }
      }).catch(function () { });
  }

  function mount(elId, opt) {
    opt = Object.assign({ grain: '15m', sector: '', lead: 'BTC', bars: 2000, interval: 30000 }, opt || {});
    var el = typeof elId === 'string' ? document.getElementById(elId) : elId;
    if (!el) return;
    var s = st();
    s.sector = opt.sector === 'all' ? '' : opt.sector;
    s.lead = opt.lead || 'BTC';
    s.grain = opt.grain || '15m';
    s.tgrain = opt.grain || '15m';
    s.bars = opt.bars;
    build(el);
    loadAll();
    if (opt.interval) {
      clearInterval(s.timer);
      s.timer = setInterval(function () {
        if (document.hidden) return;
        loadK();
        if (s.tgrain !== s.grain) loadT();
        loadSigs(false);
      }, opt.interval);
    }
    return s;
  }

  global.UpDown = { mount: mount, state: st };
})(typeof window !== 'undefined' ? window : globalThis);
