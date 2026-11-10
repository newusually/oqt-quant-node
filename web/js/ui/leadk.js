/* ============================================================================
 * web/js/ui/leadk.js —— ★主力K线面板（2026-11-03，替代 updown.js）
 * ----------------------------------------------------------------------------
 * 缘起: 用户要求「删除所有买卖信号和组件、涨跌家数和组件/数据/公式」。
 *   原 web/js/ui/updown.js 是一个混合面板（涨跌家数统计 + 详细表格 + 买卖信号回测
 *   + 买入设置弹窗 + 主力K线）。现在只剩「主力合约K线」这一件事，故独立成
 *   web/js/ui/leadk.js：
 *     · 保留：合约选择器(200+ USDT永续 + WS实时价) / 分时选项卡 / 共享KChart
 *             / 共享能量副图(MACD标=能量E + 段级能量E_seg) / 缠论连线叠加 / 左移补历史
 *     · 删除：涨跌家数统计条、涨跌家数详细表格、买卖信号回测、买入设置(tradecfg)
 *
 * 数据源: /api/boards/leadk  (只返回K线, 无任何涨跌家数)
 * 暴露:   global.LeadK = { mount, state }
 * ========================================================================== */
(function (global) {
  'use strict';
  var Net = global.Net;
  if (!Net) return;

  var UID = 'lk' + Math.random().toString(36).slice(2, 7);
  var REG = {};

  /* ★2026-11-08 K线图选项卡：分时(1m) / 15分钟 / 30分钟 / 1小时。
   *   注：用户 2026-11-07 曾要求删除 5m/15m，2026-11-08 明确要求恢复 15m；5m 仍禁用。
   *       15m/30m/1h 服务端仅保留最近 3 个月数据（见 kline.js SHORT_GRAINS 裁剪）。 */
  var TF = [
    { id: '1m', label: '分时' },
    { id: '15m', label: '15分钟' },
    { id: '30m', label: '30分钟' },
    { id: '1h', label: '1小时' }
  ];

  function esc(s) {
    return String((s === null || s === undefined) ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tfLabel(g) { for (var i = 0; i < TF.length; i++) if (TF[i].id === g) return TF[i].label; return g; }

  function st() {
    if (!REG[UID]) {
      REG[UID] = {
        grain: '1h', lead: 'BTC', instId: 'BTC-USDT-SWAP', bars: 2000,
        el: null, refs: {}, timer: null,
        kKey: '', kall: null, kOldBusy: false, kEof: false,
        chanCache: {}
      };
    }
    return REG[UID];
  }

  /* ============================================================================
   * 合约选择器（200+ USDT 永续 + WS 实时价）
   * ========================================================================== */
  var INSTS = [], INSTS_AT = 0, TICK = {}, esInst = null, ddOpen = false, curFilter = '';
  var instSeq = 0;   /* ★合约选择序号：快速切换时丢弃过期请求，避免 K线/标记串到别的合约 */
  var INST_STYLE_DONE = false;

  function ensureInstStyle() {
    if (INST_STYLE_DONE || !document.head) return;
    INST_STYLE_DONE = true;
    var stl = document.createElement('style');
    stl.textContent =
      '.inst-bar{display:flex;align-items:center;gap:10px;padding:8px 4px;flex-wrap:wrap}' +
      '.inst-dd{position:relative;display:inline-block}' +
      '.inst-btn{display:flex;align-items:center;gap:8px;min-width:330px;padding:7px 12px;border:1px solid #26304a;border-radius:9px;background:linear-gradient(180deg,#1b2436,#161c2b);cursor:pointer;font-size:13px;color:#e7ecf5;box-shadow:0 1px 3px rgba(0,0,0,.35)}' +
      '.inst-btn:hover{border-color:#3d6bb5;box-shadow:0 2px 10px rgba(77,141,255,.22)}' +
      '.inst-btn .inst-sym{font-weight:700;font-size:14px;color:#9fc1ff}' +
      '.inst-btn .inst-name{color:#8b94ad;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.inst-btn .inst-px{font-weight:600;color:#e7ecf5}' +
      '.inst-btn .inst-chg{font-weight:600}' +
      '.inst-btn .inst-arrow{margin-left:auto;color:#8b94ad;font-size:12px;transition:transform .18s}' +
      '.inst-dd.open .inst-arrow{transform:rotate(180deg)}' +
      '.inst-panel{position:absolute;top:calc(100% + 6px);left:0;width:430px;max-width:88vw;background:#161c2b;border:1px solid #26304a;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);z-index:9990;overflow:hidden}' +
      '.inst-search{width:100%;box-sizing:border-box;padding:9px 12px;border:none;border-bottom:1px solid #26304a;font-size:13px;outline:none;color:#e7ecf5;background:#1b2436}' +
      '.inst-search::placeholder{color:#667089}' +
      '.inst-list{max-height:340px;overflow-y:auto;overscroll-behavior:contain;background:#161c2b}' +
      '.inst-it{display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12.5px;color:#e7ecf5;border-bottom:1px solid rgba(38,48,74,.55)}' +
      '.inst-it:hover{background:rgba(79,140,255,.14)}' +
      '.inst-it.hot{background:rgba(77,141,255,.20)}' +
      '.inst-it .n1{width:74px;font-weight:700;color:#9fc1ff;flex:none}' +
      '.inst-it .n2{color:#8b94ad;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.inst-it .n3{width:110px;text-align:right;font-weight:600;flex:none;color:#e7ecf5}' +
      '.inst-it .n4{width:76px;text-align:right;font-weight:600;flex:none}' +
      'select.md-sel option{background:#161c2b;color:#e7ecf5}' +
      '.num-up{color:#f0334b}.num-dn{color:#0bbf7a}';
    document.head.appendChild(stl);
  }

  function chgCls(v) { return (v === null || v === undefined) ? '' : (v > 0 ? 'num-up' : (v < 0 ? 'num-dn' : '')); }
  function chgTxt(t) { return (t && t.chgText) ? t.chgText : '-'; }
  function pxTxt(t) { return (t && t.pxText) ? t.pxText : '-'; }

  function openInstStream() {
    if (esInst || !global.EventSource) return;
    try {
      esInst = new EventSource('/api/okx/stream');
      esInst.onmessage = function (ev) {
        try {
          var j = JSON.parse(ev.data);
          if (!j || !j.ok || !j.list) return;
          for (var i = 0; i < j.list.length; i++) TICK[j.list[i].instId] = j.list[i];
          paintInstBtn();
          if (ddOpen) paintInstList(curFilter);
        } catch (e) { }
      };
    } catch (e) { }
  }

  function ensureInsts() {
    /* ★2026-11-04 修复：原实现只在「点击下拉」时被调用 → 不点下拉时按钮永远显示 "-"。
     *   现在 mount 时就调用，且无论 instlist 成功与否都立即启动 SSE 常驻刷新，
     *   因此默认 BTC 的实时价 + 涨跌幅一进页面就显示，无需任何点击。 */
    if (INSTS.length && Date.now() - INSTS_AT < 600000) { openInstStream(); paintInstBtn(); return; }
    Net.get('/api/boards/instlist?t=' + Date.now(), { ttl: 30000, timeout: 30000 }).then(function (j) {
      if (j && j.ok && j.list && j.list.length) {
        INSTS = j.list; INSTS_AT = Date.now();
        for (var i = 0; i < INSTS.length; i++) if (!TICK[INSTS[i].instId]) TICK[INSTS[i].instId] = INSTS[i];
        paintInstBtn();
        paintInstList(curFilter);   // ★合约列表初始就填好，不点开也有内容
      }
    }).catch(function () { });
    openInstStream();
    paintInstBtn();
  }

  function paintInstBtn() {
    var s = st();
    if (!s.refs.instBtn) return;
    var instId = s.instId, meta = null;
    for (var i = 0; i < INSTS.length; i++) if (INSTS[i].instId === instId) { meta = INSTS[i]; break; }
    var t = TICK[instId] || meta || null;
    var sym = instId.replace('-USDT-SWAP', '');
    var q = s.refs.instBtn.querySelector('.inst-sym');
    var n = s.refs.instBtn.querySelector('.inst-name');
    var p = s.refs.instBtn.querySelector('.inst-px');
    var c = s.refs.instBtn.querySelector('.inst-chg');
    if (q) q.textContent = sym;
    if (n) n.textContent = (meta && meta.name) ? meta.name : sym;
    if (p) { var pt = pxTxt(t); if (p.textContent !== pt) { p.textContent = pt; p.className = 'inst-px num'; } }
    if (c) {
      var ct = chgTxt(t);
      if (c.textContent !== ct) {
        c.textContent = ct;
        c.className = 'inst-chg num ' + chgCls(t ? t.chg : null);
      }
    }
  }

  function paintInstList(filter) {
    var s = st();
    if (!s.refs.instList) return;
    var f = String(filter || '').toUpperCase();
    var rows = [];
    for (var i = 0; i < INSTS.length; i++) {
      var x = INSTS[i];
      if (f && x.sym.indexOf(f) < 0 && String(x.name || '').toUpperCase().indexOf(f) < 0) continue;
      rows.push(x);
    }
    if (!rows.length) { s.refs.instList.innerHTML = '<div class="inst-it"><span class="n2">无匹配合约</span></div>'; return; }
    var cur = s.instId, h = [];
    for (var k = 0; k < rows.length; k++) {
      var y = rows[k], t = TICK[y.instId] || y;
      h.push('<div class="inst-it' + (y.instId === cur ? ' hot' : '') + '" data-inst="' + esc(y.instId) + '">' +
        '<span class="n1">' + esc(y.sym) + '</span>' +
        '<span class="n2">' + esc(y.name || y.sym) + '</span>' +
        '<span class="n3 num">' + esc(pxTxt(t)) + '</span>' +
        '<span class="n4 num ' + chgCls(t ? t.chg : null) + '">' + esc(chgTxt(t)) + '</span></div>');
    }
    s.refs.instList.innerHTML = h.join('');
  }

  function bindInstDD() {
    var s = st();
    if (!s.refs.instBtn) return;
    s.refs.instBtn.addEventListener('click', function (e) {
      ddOpen = !ddOpen;
      if (s.refs.instPanel) s.refs.instPanel.style.display = ddOpen ? '' : 'none';
      if (s.refs.instDD) s.refs.instDD.classList.toggle('open', ddOpen);
      if (ddOpen) {
        ensureInsts(); curFilter = '';
        if (s.refs.instSearch) s.refs.instSearch.value = '';
        paintInstList(''); setTimeout(function () { if (s.refs.instSearch) s.refs.instSearch.focus(); }, 60);
      }
    });
    document.addEventListener('click', function (e) {
      if (!ddOpen) return;
      var el = e.target;
      if (s.refs.instDD && s.refs.instDD.contains && s.refs.instDD.contains(el)) return;
      ddOpen = false;
      if (s.refs.instPanel) s.refs.instPanel.style.display = 'none';
      if (s.refs.instDD) s.refs.instDD.classList.remove('open');
    });
    if (s.refs.instSearch) s.refs.instSearch.addEventListener('input', function () {
      curFilter = s.refs.instSearch.value.trim(); paintInstList(curFilter);
    });
    if (s.refs.instList) s.refs.instList.addEventListener('click', function (e) {
      var it = e.target.closest ? e.target.closest('.inst-it') : null;
      if (!it || !it.getAttribute('data-inst')) return;
      pickInst(it.getAttribute('data-inst'));
    });
  }

  function pickInst(instId) {
    var s = st();
    instId = String(instId || '').toUpperCase();
    if (!instId) return;
    if (instId.indexOf('-') < 0) instId = instId + '-USDT-SWAP';
    ddOpen = false;
    if (s.refs.instPanel) s.refs.instPanel.style.display = 'none';
    if (s.refs.instDD) s.refs.instDD.classList.remove('open');
    var sym = instId.replace(/-USDT-SWAP$/, '');
    s.instId = instId; s.lead = sym;
    instSeq++;
    paintInstBtn();
    if (s.refs.kttl) s.refs.kttl.textContent = instId;
    /* ★2026-11-09：选择哪个合约就立刻重载哪个合约的 K线，不等标记请求返回；
     *   旧版在该合约「暂无金字塔信号」时会 autoPickBest 自动跳回榜首、并且跳过 loadK，
     *   正是「合约列表选了 A，K线却仍显示 B」的根因。现已停用自动跳转。 */
    kReset();
    loadK();
    ensureMarksFor(instId);   // 标记异步加载，完成后只重绘、绝不改合约
  }

  /* ============================================================================
   * 构建 DOM
   * ========================================================================== */

  function build(el) {
    var s = st();
    s.el = el;
    ensureInstStyle();
    var tfBtns = TF.map(function (f) {
      return '<button class="tf-tab' + (f.id === s.grain ? ' on' : '') + '" data-grain="' + f.id + '">' + f.label + '</button>';
    }).join('');

    el.innerHTML =
      '<div class="md-hd">' +
      '<span class="md-t">📈 主力合约K线 <small>共享KChart · 4条纯直线缠论线(MA5/20/30/60) · MACD5(12/26/60) · 买多/卖空(MA5×MA60)</small></span>' +
      '<button class="md-btn" id="lk-refresh-' + UID + '" title="刷新数据">⟳ 刷新</button>' +
      '<span class="md-live"><i class="pn-dot"></i><span id="lk-tm-' + UID + '">加载中…</span></span>' +
      '</div>' +

      '<div class="inst-bar">' +
      '<span class="tf-ttl">🪙 合约：</span>' +
      '<div class="inst-dd" id="lk-instdd-' + UID + '">' +
      '<button class="inst-btn" id="lk-instbtn-' + UID + '" title="点击选择合约（287 个 USDT 永续 · 价格/涨跌幅 WS 实时）">' +
      '<b class="inst-sym">BTC</b><span class="inst-name">比特币</span>' +
      '<span class="inst-px num">-</span><span class="inst-chg num">-</span><span class="inst-arrow">▾</span></button>' +
      '<div class="inst-panel" id="lk-instpanel-' + UID + '" style="display:none">' +
      '<input class="inst-search" id="lk-instsearch-' + UID + '" placeholder="搜索合约代码 / 名称…">' +
      '<div class="inst-list" id="lk-instlist-' + UID + '"></div>' +
      '</div></div>' +
      '<span class="muted" style="font-size:12px">默认 BTC 实时价/涨跌幅自动显示(WS) · 点击下拉可搜索并切换全部合约</span>' +
      '</div>' +

      '<div class="tf-bar">' +
      '<span class="tf-ttl">⏱ K线分时：</span><span class="tf-stmp" id="lk-tflabel-' + UID + '"></span>' +
      '<span class="tf-grp">' + tfBtns + '</span>' +
      '</div>' +

      '<div class="cd-box">' +
      '<div class="cd-t">📈 <span id="lk-kttl-' + UID + '">' + esc(s.instId) + '</span> ' +
      '<span class="tf-cur" id="lk-kgrain-' + UID + '">' + tfLabel(s.grain) + '</span> K线' +
      '<small>MA5 红实线 / MA20 蓝虚线 / MA30 绿虚线 / MA60 粉虚线 · K线叠加事件：' +
      '<span style="color:#ff6b7d;font-weight:700">▲买多</span> ' +
      '<span style="color:#31c99a;font-weight:700">▼卖空</span> ' +
      '<span style="color:#f0a020;font-weight:700">◆买多加仓</span> ' +
      '<span style="color:#c07ae0;font-weight:700">◆卖空加仓</span> ' +
      '<span style="color:#4f8cff;font-weight:700">📍平仓</span> ' +
      '= 金字塔策略真实成交价(只 15m) · 加仓规则：满 1 小时 + 浮亏 >1% + MACD 柱方向同向</small>' +
      '</div>' +
      /* ★2026-11-08e：容器改为自适应高度 —— 固定 400px 会把 KChart 追加的
       *   6 个工具按钮(⏮←→＋－⤢)+视口状态挤出容器/被下方副图遮挡，看起来「缺了一大半」。 */
      '<div id="lk-ratio-' + UID + '" class="cd-chart" style="height:auto;min-height:400px;position:relative;overflow:visible">' +
      '<canvas id="lk-kcv-' + UID + '" style="width:100%;height:400px;display:block"></canvas>' +
      '</div>' +
      '<div id="lk-subbox-' + UID + '" style="margin-top:6px"></div>' +
      '</div>';

    s.refs = {
      refresh: el.querySelector('#lk-refresh-' + UID),
      tm: el.querySelector('#lk-tm-' + UID),
      tflabel: el.querySelector('#lk-tflabel-' + UID),
      ratio: el.querySelector('#lk-ratio-' + UID),
      kcv: el.querySelector('#lk-kcv-' + UID),
      ecv: el.querySelector('#lk-subbox-' + UID),
      kttl: el.querySelector('#lk-kttl-' + UID),
      kgrain: el.querySelector('#lk-kgrain-' + UID),
      instDD: el.querySelector('#lk-instdd-' + UID),
      instBtn: el.querySelector('#lk-instbtn-' + UID),
      instPanel: el.querySelector('#lk-instpanel-' + UID),
      instSearch: el.querySelector('#lk-instsearch-' + UID),
      instList: el.querySelector('#lk-instlist-' + UID)
    };

    if (s.refs.refresh) s.refs.refresh.addEventListener('click', function () { kReset(); loadK(); });
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
      kReset(); loadK();
    });
    bindInstDD();
  }

  /* ============================================================================
   * 数据加载
   * ========================================================================== */
  var KCHUNK = 1500;     /* 每次向前补的根数 */
  var KAHEAD = 400;      /* 视口左沿距已载起点不足此数 → 触发补一批 */
  var KDEF_VIS = 240;    /* 默认可视根数 */

  function fetchLeadK(grain, o) {
    o = o || {};
    var s = st();
    var url = '/api/boards/leadk?grain=' + encodeURIComponent(grain) +
      '&lead=' + encodeURIComponent(s.lead) +
      '&instId=' + encodeURIComponent(s.instId) +   /* ★完整合约ID：服务端按它精确取该合约 K线 */
      '&bars=' + (o.bars || s.bars);
    if (o.beforeTs) url += '&beforeTs=' + o.beforeTs;
    if (!o.beforeTs) url += '&t=' + Date.now();
    return Net.get(url, { ttl: o.ttl || 8000, timeout: 60000 });
  }

  function kReset() {
    var s = st();
    s.kKey = s.instId + '|' + s.grain;
    s.kall = [];
    s.kOldBusy = false;
    s.kEof = false;
  }

  function kMerge(j) {
    var s = st();
    if (!s.kall) kReset();
    var map = {}, out = [], i, k;
    for (i = 0; i < s.kall.length; i++) map[s.kall[i].ts] = s.kall[i];
    var lc = (j && j.candles) || [];
    for (i = 0; i < lc.length; i++) if (lc[i] && lc[i].ts) map[lc[i].ts] = lc[i];
    for (k in map) if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
    out.sort(function (a, b) { return a.ts - b.ts; });
    s.kall = out;
  }

  /* ★2026-11-09 降级数据源：/api/boards/leadk 本地库对部分合约/周期(如 ETH 15m)没有历史片，
   *   此时改用 /api/okx/kline（bars:{t,o,h,l,c,v}）画同一合约，避免「选了合约却是一片空白」。 */
  function loadFallbackK(inst, grain, seq) {
    return Net.get('/api/okx/kline?inst=' + encodeURIComponent(inst) +
      '&tf=' + encodeURIComponent(grain) + '&limit=2000&t=' + Date.now(),
      { ttl: 8000, timeout: 30000 }).then(function (kj) {
      if (seq !== instSeq || inst !== st().instId) return false;
      if (!kj || !kj.ok || !kj.bars || !kj.bars.length) return false;
      if (kj.inst && String(kj.inst).toUpperCase() !== inst) return false;
      var s = st();
      s.kall = kj.bars.map(function (b) {
        return { ts: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      }).sort(function (a, b) { return a.ts - b.ts; });
      renderK();
      if (s.refs.tm) s.refs.tm.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN') + ' · 备用K线源';
      return true;
    }).catch(function () { return false; });
  }

  function loadK() {
    var s = st();
    var inst = s.instId, grain = s.grain, seq = instSeq;
    fetchLeadK(grain).then(function (j) {
      /* ★过期/串合约响应直接丢弃：快速切换合约时旧请求不得覆盖新合约的 K线 */
      if (seq !== instSeq || inst !== st().instId) return;
      if (!j || !j.ok) {
        if (s.refs.tm) s.refs.tm.textContent = '加载失败：' + esc((j && j.err) || '');
        return;
      }
      if (j.instId && String(j.instId).toUpperCase() !== inst) {
        if (s.refs.tm) s.refs.tm.textContent = '合约不匹配：请求 ' + esc(inst) + ' / 返回 ' + esc(j.instId);
        return;
      }
      var key = inst + '|' + grain;
      if (s.kKey !== key || !s.kall) kReset();
      kMerge(j);
      if (!s.kall || s.kall.length < 2) { loadFallbackK(inst, grain, seq); return; }
      renderK();
      if (s.refs.tflabel) s.refs.tflabel.textContent = tfLabel(s.grain);
      if (s.refs.tm) s.refs.tm.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');
    }).catch(function () { });
  }

  /* ★左移补历史：beforeTs=已载最早ts-1 → 服务端返回更早的一段，前插进 kall */
  function loadOlderK() {
    var s = st();
    if (!s.kall || !s.kall.length || s.kOldBusy || s.kEof) return Promise.resolve(false);
    var key = s.kKey, oldest = s.kall[0].ts;
    s.kOldBusy = true;
    return fetchLeadK(s.grain, { beforeTs: oldest - 1, bars: KCHUNK, ttl: 60000 }).then(function (j) {
      s.kOldBusy = false;
      if (!j || !j.ok || key !== st().kKey) return false;
      var got = 0, lc = j.candles || [];
      for (var i = 0; i < lc.length; i++) if (lc[i] && lc[i].ts && lc[i].ts < oldest) got++;
      if (!got) { s.kEof = true; return false; }
      kMerge(j);
      renderK();
      return true;
    }).catch(function () { s.kOldBusy = false; return false; });
  }

  /* ============================================================================
   * 缠论连线（主图叠加）—— 服务端 chan 引擎输出
   * ========================================================================== */
  function getChanLinks(grain, cb) {
    var s = st();
    /* 缠论连线通道已由共享组件 chanlun 接管，1m 也不再打这个过时接口 */
    if (grain === '1m') { cb([]); return; }
    var c = s.chanCache[grain];
    if (c && Date.now() - c.at < 60000) { cb(c.links); return; }
    var url = '/api/boards/chan?grain=' + encodeURIComponent(grain) + '&days=365';
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var links = [];
      if (j && j.ok && j.signals && j.signals.length) {
        for (var i = 1; i < j.signals.length; i++) {
          var a = j.signals[i - 1], b = j.signals[i];
          if (a.ts == null || b.ts == null || a.px == null || b.px == null) continue;
          links.push({ t0: a.ts, p0: a.px, t1: b.ts, p1: b.px, dir: (b.px > a.px ? 1 : -1), brk: !!b.segBrk });
        }
        if (j.openLeg && j.openLeg.fromTs != null && j.openLeg.toTs != null) {
          links.push({
            t0: j.openLeg.fromTs, p0: j.openLeg.fromPx, t1: j.openLeg.toTs, p1: j.openLeg.toPx,
            dir: (j.openLeg.toPx >= j.openLeg.fromPx ? 1 : -1), brk: true
          });
        }
      }
      s.chanCache[grain] = { at: Date.now(), links: links };
      cb(links);
    }).catch(function () { cb([]); });
  }

  /* ============================================================================
   * 渲染
   * ========================================================================== */
  function renderK() {
    var s = st();
    if (!s.refs.ratio || !s.kall || !s.kall.length) return;
    var cdl = s.kall;
    var kb = cdl.map(function (ck) { return { t: ck.ts, o: ck.o, h: ck.h, l: ck.l, c: ck.c, v: ck.v }; });
    var doDraw = function (lk) {
      if (s.refs.kcv) s.refs.kcv.style.display = 'block';
      var kopts = {
        bars: kb,
        mainInd: 'ma', subInd: 'macd',
        noSub: true,
        height: 400, stateKey: 'leadk:' + s.lead + ':' + s.grain,
        defVis: KDEF_VIS,
        onMore: loadOlderK,
        moreEof: !!s.kEof,
        prefetchAhead: KAHEAD,
        marks: [],
        links: lk || [],
        extraTitle: function () { return ''; },
        extraRows: function () { return []; }
      };
      if (global.KChart && s.refs.kcv) {
        if (!s.kchart) {
          s.kchart = global.KChart.create(s.refs.ratio, {
            canvas: s.refs.kcv,
            subBox: s.refs.ecv,
            height: 400,
            stateKey: 'leadk:' + s.lead + ':' + s.grain,
            defVis: KDEF_VIS,
            label: s.lead + ' ' + s.grain,
            onMore: loadOlderK,
            prefetchAhead: KAHEAD,
            draw: function () { return kopts; }
          });
        } else {
          s.kchart.o.stateKey = 'leadk:' + s.lead + ':' + s.grain;
          s.kchart.o.label = s.lead + ' ' + s.grain;
          s.kchart.o.onMore = loadOlderK;
          s.kchart.o.moreEof = !!s.kEof;
          s.kchart.o.draw = function () { return kopts; };
          if (s.kchart.state.key !== s.kchart.o.stateKey) s.kchart.state.key = null;
        }
        s.kchart.setBars(kb);
      } else {
        global.drawKline(s.refs.kcv, kopts);
        if (global.SubCharts && s.refs.kcv && s.refs.ecv) {
          try { global.SubCharts.mount(s.refs.kcv, s.refs.ecv, kb, { label: s.lead + ' ' + s.grain }); } catch (e) { }
        }
      }
    };
    getChanLinks(s.grain, doDraw);
  }

  /* ============================================================================
   * ★2026-11-09 K线成交记录叠加（金字塔策略真实成交，非 MA 交叉"数据信号"）
   *   · 切换合约 / 首次加载 → 拉 pyr_marks 设 TradeSignals.setMarks
   *     使 K线图按 ts 二分定位 bar，按【真实成交价】叠加
   *     「买多(红▲)/卖空(绿▼)/买多加仓(橙◆)/卖空加仓(紫◆)/平仓(蓝📍)」五态标记
   *   · 当前合约无任何成交 → 自动切到 pyr_insts 榜首（用户要求"无交易自动切到榜首"）
   * ========================================================================== */
  var MARKS_BY_INST = {};

  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return String(n).padStart(2, '0'); }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ★拉取某合约的全部金字塔事件作图表标记（买多/卖空/买多加仓/卖空加仓/平仓），并触发重绘 */
  function ensureMarksFor(instId, done) {
    var s = st();
    var seq = instSeq;
    Net.get('/api/okx/pyr_marks?inst=' + encodeURIComponent(instId) + '&t=' + Date.now(),
      { ttl: 15000, timeout: 20000 }).then(function (j) {
      if (seq !== instSeq) return;   /* ★过期合约的标记不得覆盖当前合约 */
      var rows = (j && j.ok && j.rows) ? j.rows : [];
      var ms = rows.map(function (r) {
        return { ts: r.ts, event: r.event, dir: r.dir > 0 ? 1 : -1, price: r.px };
      });
      MARKS_BY_INST[instId] = ms;
      if (global.TradeSignals && typeof global.TradeSignals.setMarks === 'function') global.TradeSignals.setMarks(ms);
      if (s.instId === instId && s.kchart) s.kchart.redraw();
      if (done) done(rows.length);
    }).catch(function () { if (done) done(0); });
  }

  /* ★已停用：旧版「当前合约无成交 → 自动切到 pyr_insts 榜首」会覆盖用户手动选择的合约，
   *   并跳过 K线重载，导致合约列表选择后 K线不同步。保留函数仅供外部显式调用，mount/pickInst 不再使用。 */
  function autoPickBest(skipInst) {
    var s = st();
    Net.get('/api/okx/pyr_insts?limit=30&t=' + Date.now(), { ttl: 60000, timeout: 20000 }).then(function (j) {
      if (j && j.ok && j.insts && j.insts.length) {
        var best = j.insts[0].inst;
        if (best && best.toUpperCase() !== String(skipInst || '').toUpperCase()) { pickInst(best); return; }
      }
      loadK();
    }).catch(function () { loadK(); });
  }

  /* ============================================================================
   * 挂载
   * ========================================================================== */
  function mount(elId, opt) {
    opt = Object.assign({ grain: '1h', lead: 'BTC', bars: 2000, interval: 30000 }, opt || {});
    var el = typeof elId === 'string' ? document.getElementById(elId) : elId;
    if (!el) return null;
    var s = st();
    s.lead = opt.lead || 'BTC';
    s.instId = (s.lead + '-USDT-SWAP').toUpperCase();
    s.grain = opt.grain || '1h';
    s.bars = opt.bars;
    build(el);
    ensureInsts();          // ★默认 BTC 实时价/涨跌幅：不点下拉也要立刻显示
    /* ★2026-11-09：默认合约立即加载 K线 + 成交标记；不再因「无信号」自动跳榜首 */
    kReset(); loadK();
    ensureMarksFor(s.instId);
    if (opt.interval) {
      clearInterval(s.timer);
      s.timer = setInterval(function () {
        if (document.hidden) return;
        loadK();
      }, opt.interval);
    }
    return s;
  }

  /* ★供总览顶部主流币行情点击后切换本 K 线图（旧链接指向已删除的 OKX 页面） */
  global.LeadK = { mount: mount, state: st, select: pickInst };
})(typeof window !== 'undefined' ? window : globalThis);
