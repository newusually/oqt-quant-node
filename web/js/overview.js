/* ============================================================================
 * overview.js —— 总览页（全局行情监控中心）逻辑
 *   · 拉 /api/market/summary → 渲染大盘卡片 / 涨跌榜 / 情绪仪表 / AI 分析
 *   · 电视式实时播报（Announcer.mountTV）+ 语音自动播报（Announcer.start）
 *   · ★面板实时 ajax：数字变动闪烁、15 秒刷新、全市场实时比较
 *   · ★悬停卡片/排行 → 弹出 5 分钟实时 K 线小窗（共用 ChanPop）
 *   · ★点击卡片/排行 → 打开 OKX 合约页面
 * ========================================================================== */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String((s === null || s === undefined) ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function cls(p) { return p > 0 ? 'up' : (p < 0 ? 'dn' : 'flat'); }

  var TV = null;
  var LOADED = false;
  var PREV = {};          // key → 上次显示值（闪烁动画）

  /* 闪烁 class：值变了就闪一下（涨红跌绿） */
  function flash(key, val, up) {
    var prev = PREV[key];
    PREV[key] = val;
    if ((prev === null || prev === undefined) || prev === val) return '';
    return up ? ' flash-up' : ' flash-dn';
  }
  function flashEl(el, up) {
    if (!el) return;
    el.classList.remove('flash-up', 'flash-dn');
    void el.offsetWidth;
    el.classList.add(up ? 'flash-up' : 'flash-dn');
    setTimeout(function () { el.classList.remove('flash-up', 'flash-dn'); }, 900);
  }

  /* ---------------- ★毫秒级行情（SSE）: OKX 公共WS 推送, 卡片价格实时跳 ----------------
   * 用户要求"首页各类涨幅...根本没有实时拿数据" + "行情毫秒级ws" */
  function initWsStream() {
    if (!window.EventSource) return;
    try {
      var es = new EventSource('/api/okx/stream');
      es.onmessage = function (ev) {
        try {
          var j = JSON.parse(ev.data);
          if (!j || !j.ok || !j.list) return;
          var map = {};
          for (var i = 0; i < j.list.length; i++) map[j.list[i].instId] = j.list[i];
          // ① OKX 行情卡片: 价格/涨跌幅毫秒级更新 + 闪烁
          var cards = document.querySelectorAll('.mk-card[data-mkt="OKX"]');
          for (var k = 0; k < cards.length; k++) {
            var code = cards[k].getAttribute('data-code');
            var t = map[code];
            if (!t) continue;
            var pxEl = cards[k].querySelector('.mk-px');
            var pctEl = cards[k].querySelector('.mk-pct');
            if (pxEl && pxEl.textContent !== t.pxText) {
              flashEl(pxEl, t.chg >= 0);
              pxEl.textContent = t.pxText;
            }
            if (pctEl) {
              var txt = (t.chg >= 0 ? '▲ ' : '▼ ') + t.chgText;
              if (pctEl.textContent !== txt) { flashEl(pctEl, t.chg >= 0); pctEl.textContent = txt; }
              pctEl.className = 'mk-pct ' + cls(t.chg);
            }
          }
          // ② 顶部直播条 OKX（ETH 为代表）
          var eth = map['ETH-USDT-SWAP'];
          var lb = $('lb-okx');
          if (eth && lb && lb.textContent !== eth.chgText) {
            lb.textContent = eth.chgText;
            lb.className = cls(eth.chg);
          }
        } catch (e) { }
      };
    } catch (e) { }
  }


  /* ---------------- ★板块卡片（数据源=WS 常驻内存：加密生态板块） ----------------
   * 一张卡 = 一个板块（代表品种价格 + 板块均涨幅 + 涨跌家数），点击切到该板块面板 */
  function renderSectorCards(list) {
    var box = $('mkt-cards');
    if (!box) return;
    if (!list.length) return;
    // 增量 patch：卡片数量固定，首次建 DOM，之后只改文本（不打断悬停弹窗）
    if (box.children.length !== list.length) {
      box.innerHTML = list.map(function (s) {
        return '<div class="mk-card" data-sid="' + esc(s.id) + '" data-code="' + esc(s.top ? s.top.code : '') + '">' +
          '<div class="mk-name">' + esc(s.icon + ' ' + s.name) + ' <span class="live-lab">' + s.count + '只</span></div>' +
          '<div class="mk-px">-</div><div class="mk-pct">-</div>' +
          '<svg class="mk-spark" viewBox="0 0 120 30" preserveAspectRatio="none"><line x1="0" y1="27" x2="120" y2="27" stroke="rgba(139,148,173,.25)" stroke-width="1"/></svg>' +
          '</div>';
      }).join('');
      // 点击 → 切到该板块（复用 Sectors 组件）
      box.addEventListener('click', function (e) {
        var el = e.target.closest ? e.target.closest('.mk-card') : null;
        if (!el || !box.contains(el)) return;
        var sid = el.getAttribute('data-sid');
        if (sid && window.SectorsApi) window.SectorsApi.show(sid);
      });
      /* ★2026-10-26 用户要求: 删除总览底部悬浮K线小窗 → 移除 mk-card 悬停 ChanPop 弹窗 */
    }
    for (var i = 0; i < list.length; i++) {
      var s = list[i], el = box.children[i];
      if (!el || !s.top) continue;
      var pxEl = el.querySelector('.mk-px'), pctEl = el.querySelector('.mk-pct');
      var pxTxt = s.top.pxText, pctTxt = s.pctAvgText;
      if (pxEl && pxEl.textContent !== pxTxt) { pxEl.textContent = pxTxt; pxEl.className = 'mk-px ' + cls(s.pctAvg); flashEl(pxEl, s.pctAvg >= 0); }
      if (pctEl) {
        var t = (s.pctAvg >= 0 ? '▲ ' : '▼ ') + pctTxt;
        if (pctEl.textContent !== t) { pctEl.textContent = t; pctEl.className = 'mk-pct ' + cls(s.pctAvg); flashEl(pctEl, s.pctAvg >= 0); }
      }
      el.setAttribute('data-code', s.top.code);
    }
    tintPanel(box.closest('.panel'), list.reduce(function (a, s) { return a + s.pctAvg; }, 0) / list.length);
  }
  function setBar(id, txt, pct) {
    var e = $(id); if (!e) return;
    if (e.textContent !== txt) { e.textContent = txt; e.className = (pct === null || pct === undefined) ? '' : cls(pct); }
  }

  /* ---------------- 面板背景着色（★用户: "背景跟大盘行情面板一样, 行情在动背景也在换颜色"） ----------
   * 涨 → 红色渐变 / 跌 → 绿色渐变(中国惯例), CSS transition 平滑过渡 */
  function tintPanel(panel, pct) {
    if (!panel) return;
    panel.classList.toggle('tint-up', pct > 0.05);
    panel.classList.toggle('tint-dn', pct < -0.05);
  }

  /* ---------------- AI 分析（★2026-10-25 改接 /api/boards/ai：507 合约全量） ----------------
   * 情绪仪表已交给 Sentiment 组件（按板块实时计算），这里只渲染 AI 面板：
   * 结论文本 + 板块分布表 + 极端异动榜（涨幅/跌幅/taker 强/弱） */
  function renderAI(an) {
    if (!an || !an.ok) return;
    var t = $('ai-text'); if (t) t.textContent = an.ai.text || '暂无分析';
    var b = $('ai-bullets');
    if (b) b.innerHTML = (an.ai.bullets || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    var a = $('ai-advice'); if (a) a.textContent = '💡 操作建议：' + (an.ai.advice || '-');
    var tm = $('ai-time'); if (tm) tm.textContent = '更新于 ' + (an.timeText || new Date().toLocaleString('zh-CN'));
    renderAISectors(an.sectors || []);
    renderAIExtremes(an);
    renderAIReads(an);        // ★第三轮: 榜单解读（"通过榜单表达什么"）
    renderAIMood(an);         // ★第三轮: 各合约情绪榜
    renderAIBias(an);         // ★第三轮: 市场买多还是卖空
  }

  /* ★第三轮: 榜单解读 —— 把榜单翻译成结论（用户: "要通过榜单表达什么"） */
  function renderAIReads(an) {
    var box = $('ai-reads');
    if (!box) return;
    var list = an.reads || [];
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = list.map(function (r) {
      return '<div class="ai-read"><span class="ai-read-i">' + esc(r.icon || '·') + '</span>' +
        '<div><b>' + esc(r.title || '') + '</b><p>' + esc(r.text || '') + '</p></div></div>';
    }).join('');
  }

  /* ★第三轮: 市场买卖倾向（用户: "市场要买多还是卖空"） */
  function renderAIBias(an) {
    var box = $('ai-bias');
    if (!box) return;
    if (!an.marketBias) { box.innerHTML = ''; return; }
    box.innerHTML =
      '<div class="ai-bias-k">市场倾向</div>' +
      '<div class="ai-bias-v" style="color:' + esc(an.marketBiasColor || '#f0a020') + '">' + esc(an.marketBias) + '</div>' +
      '<div class="ai-bias-t">' + esc(an.marketBiasText || an.marketBiasReason || '') + '</div>';
  }

  /* ★第三轮: 各合约情绪榜（用户: "各个合约 各个板块的情绪"） */
  function renderAIMood(an) {
    var box = $('ai-mood');
    if (!box) return;
    function rows(list) {
      return (list || []).slice(0, 6).map(function (x) {
        return '<div class="ai-ext-row"><span class="ai-ext-nm">' + esc(x.name) +
          '<i style="font-style:normal;color:#7b869e;font-size:10px;margin-left:4px">' + esc(x.sector || '') + '</i></span>' +
          '<span class="ai-ext-v num" style="color:' + esc(x.moodColor || '#e6ebf5') + '">' + x.mood + '</span>' +
          '<span class="ai-mood-ls">' + esc(x.longShort || '-') + '</span></div>';
      }).join('') || '<div class="bd-empty sm">无</div>';
    }
    box.innerHTML =
      '<div class="ai-ext-box"><div class="ai-ext-t up">🔥 情绪最强合约</div>' + rows(an.moodTop) + '</div>' +
      '<div class="ai-ext-box"><div class="ai-ext-t dn">🥶 情绪最弱合约</div>' + rows(an.moodLow) + '</div>';
  }
  /* 板块分布表：合约数/涨跌/均涨幅/情绪分 */
  function renderAISectors(sectors) {
    var tb = $('ai-sec-tb');
    if (!tb) return;
    if (!sectors.length) { tb.innerHTML = ''; return; }
    var html = '<thead><tr><th>板块</th><th class="r">合约</th><th class="r">涨/跌</th>' +
      '<th class="r">均涨幅</th><th class="r">情绪分</th><th>代表合约</th></tr></thead><tbody>';
    sectors.forEach(function (s) {
      html += '<tr>' +
        '<td>' + esc(s.icon || '') + ' ' + esc(s.name) + '</td>' +
        '<td class="r num">' + s.count + '</td>' +
        '<td class="r num"><b class="up">' + s.up + '</b>/<b class="dn">' + s.down + '</b></td>' +
        '<td class="r num ' + cls(s.pctAvg) + '">' + (s.pctAvg >= 0 ? '+' : '') + s.pctAvg.toFixed(2) + '%</td>' +
        '<td class="r num">' + ((s.score === null || s.score === undefined) ? '-' : s.score) + '</td>' +
        '<td class="ai-sec-top">' + esc(s.topSym ? s.topSym.name + ' ' + (s.topSym.pct >= 0 ? '+' : '') + s.topSym.pct + '%' : '-') + '</td>' +
        '</tr>';
    });
    tb.innerHTML = html + '</tbody>';
  }
  /* 极端异动榜：涨幅/跌幅 top5 */
  function renderAIExtremes(an) {
    var box = $('ai-ext');
    if (!box) return;
    function rows(list) {
      return (list || []).slice(0, 5).map(function (x) {
        return '<div class="ai-ext-row"><span class="ai-ext-nm">' + esc(x.name) + '</span>' +
          '<span class="ai-ext-v num ' + cls(x.pct) + '">' + (x.pct >= 0 ? '+' : '') + x.pct.toFixed(1) + '%</span></div>';
      }).join('') || '<div class="bd-empty sm">无</div>';
    }
    box.innerHTML =
      '<div class="ai-ext-box"><div class="ai-ext-t up">🚀 涨幅极端</div>' + rows(an.gainTop) + '</div>' +
      '<div class="ai-ext-box"><div class="ai-ext-t dn">🧨 跌幅极端</div>' + rows(an.loseTop) + '</div>';
  }
  function refreshAI() {
    return fetch('/api/boards/ai?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(renderAI)
      .catch(function () { });
  }

  /* ---------------- ★板块分布图表（ECharts, 接 /api/boards/sectordist） ----------------
   * 用户: "合约分布 应该是各个板块分布"
   *       "给我各个合约比较分类的画图" */
  function renderCharts(dist) {
    if (!dist || !dist.ok || !window.EKit) return;
    var secs = (dist.sectors || []).slice(0, 12);
    if (!secs.length) return;
    // ① 板块涨跌分布：涨/跌家数双柱对照（name 已含图标, 来自 sectordist）
    EKit.mount('chart-dist-a', 'barDual', secs.map(function (s) {
      return { name: s.name, v1: s.up, v2: s.down };
    }), { n1: '上涨家数', n2: '下跌家数', rotate: 35 });
    var subA = $('dist-a-sub');
    if (subA) subA.textContent = secs.length + ' 个板块涨跌家数 · 更新于 ' + new Date(dist.at).toLocaleTimeString('zh-CN');
    // ③ 全市场涨跌构成饼图
    var upAll = 0, dnAll = 0;
    secs.forEach(function (s) { upAll += s.up; dnAll += s.down; });
    EKit.mount('chart-mood-pie', 'pie', [
      { name: '上涨合约', value: upAll, itemStyle: { color: '#f0334b' } },
      { name: '下跌合约', value: dnAll, itemStyle: { color: '#0bbf7a' } }
    ]);
    // ④ 板块成交额对比（横条，真实 24h 成交额）
    EKit.mount('chart-vol-top', 'barH', secs.map(function (s) {
      return { name: s.name, value: s.turn || 0 };
    }), { color: '#4f8cff', fmt: '{value}' });
  }
  function refreshCharts() {
    return fetch('/api/boards/sectordist?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(renderCharts)
      .catch(function () { });
  }

  /* ---------------- ★盈利监控 / 持仓摘要（真实 OKX 账户, 组件复用 okx API） ----------------
   * 用户: "账户净值曲线...根本不显示 也不实时ajax"
   *   · 账户净值 = 全币种折USD(账户只有 BABYDOGE 等币时, USDT口径的 0.00 像没显示);
   *   · 累计已实现盈亏曲线 = /api/okx/pnl 的 fill 明细累计(ECharts line, 10秒实时);
   *   · 持仓明细 chips; 数字变动闪烁。 */
  function fmtUsd(v) {
    v = Number(v);
    if (!isFinite(v)) return '-';
    var a = Math.abs(v);
    if (a >= 1000) return (v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(4);
    if (a > 0) return v.toPrecision(3);            // 极小值(如 2.38e-10)也显示出来, 不是"-"
    return '0.00';
  }
  var ACC_PREV = {};
  function setAcc(id, txt, up) {
    var el = $(id);
    if (!el) return;
    if (el.textContent === txt) return;
    var prev = ACC_PREV[id];
    ACC_PREV[id] = txt;
    el.textContent = txt;
    if ((prev !== null && prev !== undefined) && (up !== null && up !== undefined)) flashEl(el, up);
  }
  function refreshAccountPanels() {
    fetch('/api/okx/account', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (a) {
      if (!a || !a.ok) return;
      var eq = (a.eqUsdTotal !== null && a.eqUsdTotal !== undefined) ? a.eqUsdTotal : a.totalEq;
      setAcc('ov-eq', '$' + fmtUsd(eq));
      var s = $('ov-eq-sub');
      if (s) s.textContent = '可用 ' + fmtUsd(a.avail) + ' ' + (a.ccy || 'USDT') + ' · 全币种折USD';
      // 持仓明细(非零币种)
      var hold = $('ov-hold');
      if (hold) {
        var hs = a.holdings || [];
        hold.innerHTML = hs.length
          ? '<span class="ov-hold-t">持仓明细</span>' + hs.map(function (h) {
            return '<span class="ov-hold-i">' + esc(h.ccy) + ' ' + (+h.eq).toPrecision(4) +
              (h.eqUsd > 0 ? ' ≈ $' + fmtUsd(h.eqUsd) : '') + '</span>';
          }).join('')
          : '<span class="ov-hold-t">持仓明细</span><span class="ov-hold-i">无持仓</span>';
      }
    }).catch(function () { });
    fetch('/api/okx/pnl', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (p) {
      if (!p || !p.ok) return;
      var up = (p.total || 0) >= 0;
      var el = $('ov-pnl');
      if (el) {
        el.textContent = (up ? '+' : '') + fmtUsd(p.total);
        el.className = 'v num ' + (up ? 'up' : 'dn');
      }
      var sub = $('ov-pnl-sub');
      if (sub) sub.textContent = 'OKX 成交明细 ' + (p.count || 0) + ' 笔累计';
      // ★累计已实现盈亏曲线(红涨绿跌)
      var ser = (p.series || []).map(function (x) { return [x.ts, x.cum]; });
      if (window.Charts && ser.length) {
        window.Charts.line('chart-equity', {
          series: [{
            name: '累计已实现盈亏(USDT)', data: ser,
            color: up ? '#f0334b' : '#0bbf7a',
            markLine: { silent: true, symbol: 'none', lineStyle: { color: '#3a4664', type: 'dashed' }, data: [{ yAxis: 0 }], label: { show: false } }
          }]
        });
      }
    }).catch(function () { });
    fetch('/api/okx/positions', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (p) {
      if (!p || !p.ok) return;
      var n = $('ov-pos-n'); if (n) n.textContent = p.count;
      var sub = $('ov-pos-sub'); if (sub) sub.textContent = '共 ' + p.count + ' 个持仓';
      var up = $('ov-upl');
      if (up) {
        up.textContent = (p.totalUpl >= 0 ? '+' : '') + (p.totalUpl || 0).toFixed(4);
        up.className = 'v num ' + ((p.totalUpl || 0) >= 0 ? 'up' : 'dn');
      }
    }).catch(function () { });
  }

  /* ---------------- ★主流币实时行情（用户 2026-10-25: "只有一个合约不好看 要多个主流币才行"）
   *   渲染多个主流币：名称 + 价格 + 当日1D涨跌幅（红涨绿跌），数字变动闪烁 */
  var MAJORS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'];
  var MAJOR_PREV = {};
  function renderMajors(list) {
    var box = $('lb-majors');
    if (!box || !list || !list.length) return;
    var html = list.map(function (x) {
      var prev = MAJOR_PREV[x.sym];
      var flash = '';
      if ((prev !== null && prev !== undefined) && prev !== x.pctText) flash = (x.pct >= 0 ? ' flash-up' : ' flash-dn');
      MAJOR_PREV[x.sym] = x.pctText;
      return '<a class="lb-mj" href="/modules/okx/web/index.html?inst=' + encodeURIComponent(x.instId) + '" title="' +
        esc(x.name) + ' · 当日1D">' +
        '<span class="lb-mj-n">' + esc(x.sym) + '</span>' +
        '<span class="lb-mj-p num">' + esc(x.pxText) + '</span>' +
        '<span class="lb-mj-c num ' + cls(x.pct) + flash + '">' + (x.pct >= 0 ? '▲' : '▼') + esc(x.pctText) + '</span>' +
        '</a>';
    }).join('');
    box.innerHTML = html;
  }
  function refreshMajors() {
    Net.get('/api/boards/majors?syms=' + MAJORS.join(','), { ttl: 1500 }).then(function (j) {
      if (j && j.ok) renderMajors(j.list || []);
    }).catch(function () { });
  }

  /* ---------------- 分级实时刷新（★用户: "首页所有面板都要ajax ws... okx毫秒级 其他都是秒级"） ----------------
   *   3s  → 行情卡片/直播条(数字跳动+闪烁; OKX 另有毫秒级 SSE)
   *   5s  → 三个排行榜(全市场实时比较, FLIP 滑动+背景着色) / ECharts 图表
   *   10s → 盈利监控/持仓(真实 OKX 账户, 净值+累计盈亏曲线)
   *   20s → 情绪仪表/AI 分析(重算较重)
   *   5min→ Announcer.start 的 onSummary 慢路径兜底 */
  /* ★卡片/榜单已改由 refreshFast / refreshPanels 用【WS 数据源 + Board 组件】渲染
   *   (旧口径是本地 5m K线 / 新浪 24h, 不是当日 1D —— 用户明确要求改)
   * ★情绪/AI/分布图已改由 Sentiment/TakerAll/InstFind 组件 + 板块 API 驱动 */
  function renderAll(sm) {
    hideLoader();
  }
  function fetchSummary() {
    return fetch('/api/market/summary?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; });
  }
  function refreshFast() {           // 3s: 板块卡片(★WS 常驻内存, 加密生态板块)
    Net.get('/api/boards/sectors', { ttl: 2000 }).then(function (j) {
      if (!j || !j.ok) return;
      renderSectorCards(j.sectors || []);
      var ps = (j.sectors || []).map(function (s) { return s.pctAvg; });
      if (ps.length) {
        tintPanel(document.querySelector('.live-bar'), ps.reduce(function (a, b) { return a + b; }, 0) / ps.length);
      }
      // 直播条: 全市场均价
      var ps2 = (j.sectors || []).map(function (s) { return s.pctAvg; });
      var avg = ps2.length ? ps2.reduce(function (a, b) { return a + b; }, 0) / ps2.length : null;
      setBar('lb-okx', (avg === null || avg === undefined) ? '-' : (avg >= 0 ? '+' : '') + avg.toFixed(2) + '%', avg);
      var ws = j.ws;
      var wt = $('lb-ws');
      if (wt) wt.textContent = ws && ws.conn ? ('WS ' + ws.conn + '连接 · ' + ws.insts + '标的') : 'WS 连接中';
    }).catch(function () { });
    // ★主流币实时行情（3s 一次，与板块卡片同频）
    refreshMajors();
  }

  /* ★排行榜改用【当日1D / 5分钟】正确口径(用户: "涨幅榜应该按1D来算 当日的1D涨跌")
   *   旧口径来自本地5m K线(是5分钟涨跌) —— 已废弃
   *   ★2026-10-25 第三轮：榜单已升级为 RankPack 复合组件（分类标签+配图+解读），
   *     由 RankPack 自己取数渲染 → 此处旧逻辑停用（避免重复请求与 DOM 冲突） */
  function refreshPanels() { /* 已由 RankPack 接管 */ }

  /* ---------------- 主刷新(首屏 + 骨架重试) ---------------- */
  function refresh() {
    fetchSummary().then(function (sm) {
      if (!sm || !sm.ok) return;
      renderAll(sm);
      // ★拿到骨架数据(后端还在预热) → 2 秒后再拉一次真实数据
      if (sm.skeleton) setTimeout(refresh, 2000);
    });
  }

  function hideLoader() {
    if (LOADED) return;
    LOADED = true;
    var l = $('loader');
    if (l) { l.classList.add('hide'); setTimeout(function () { if (l.parentNode) l.parentNode.removeChild(l); }, 500); }
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    // 时钟
    setInterval(function () {
      var c = $('clock'); if (c) c.textContent = new Date().toLocaleString('zh-CN');
    }, 1000);
    var c = $('clock'); if (c) c.textContent = new Date().toLocaleString('zh-CN');

    // 电视播报 + 语音播报（oqt 财经电台）
    // ★2026-10-24 用户要求「首页播报语音取消 不要语音了 太烦了」→ 只静音, 电视动画保留
    if (window.Announcer) {
      if (window.Announcer.mute) window.Announcer.mute(true);
      TV = window.Announcer.mountTV('tvbox');
      window.Announcer.start({
        auto: false,                  // 静音: 不自动念
        interval: 300000,             // 5 分钟慢路径兜底重渲染
        delay: 1500,
        onSummary: function (sm) { renderAll(sm); }
      });
    }
    refresh();
    // 兜底: 8 秒后无论如何收起 loading
    setTimeout(hideLoader, 8000);
    // ★毫秒级行情 SSE（OKX 公共WS → 服务端 → 页面）
    initWsStream();

    /* ★2026-10-25 板块面板（组件化：标签切换 → 同时刻只 1 个活跃请求）
     *   ★2026-10-26 用户要求: 删除板块内「涨幅榜/跌幅榜1D」双榜面板
     *     及「涨跌 TOP10（%）/成交额 TOP10/涨跌家数」图表 → 只保留板块成员卡片 */
    if (window.Sectors && $('sect-tabs') && $('sect-panel')) {
      window.SectorsApi = window.Sectors.mount('sect-tabs', 'sect-panel', {
        kinds: [],        // 删除涨幅榜/跌幅榜双榜
        charts: [],       // 删除 涨跌TOP10 / 成交额TOP10 / 涨跌家数 图表
        interval: 10000,
        cardLimit: 8, boardLimit: 10,
        list: [
          /* ★加密生态板块（板块分析面板继续服务全市场） */
          { id: 'l1', title: '公链层', icon: '⛓' },
          { id: 'l2', title: '扩容层', icon: '🧱' },
          { id: 'defi', title: 'DeFi', icon: '🔗' },
          { id: 'meme', title: 'Meme', icon: '🐕' },
          { id: 'ai', title: 'AI', icon: '🤖' },
          { id: 'infra', title: '基础设施', icon: '🧰' },
          { id: 'nft', title: '链游与NFT', icon: '🎮' },
          { id: 'rwa', title: '实物资产与DePIN', icon: '🏗' },
          { id: 'other', title: '其他加密', icon: '🪙' }
        ]
      });
    }

    // ★分级实时轮询: 3s 板块卡片 / 10s taker榜+账户 / 15s AI
    refreshFast();        setInterval(refreshFast, 3000);
    refreshPanels();      setInterval(refreshPanels, 5000);
    refreshAccountPanels(); setInterval(refreshAccountPanels, 10000);
    refreshAI(); setInterval(refreshAI, 15000);

    /* ★2026-10-26 用户要求: 删除所有买卖信号 / 涨幅榜 / 表格下方分析面板
     *   → Sentiment / InstFind / RankPack / MainDual / SignalPanel /
     *     CryptoDual / VsCrypto / Relation 挂载已全部移除 */

    /* ★2026-10-26 用户要求: 删除所有买卖信号 / 涨幅榜 / 表格下方分析面板
     *   → Sentiment / InstFind / RankPack / MainDual / SignalPanel /
     *     CryptoDual / VsCrypto / Relation 挂载已全部移除 */

    /* ★2026-10-26: ★首页播报下方·全市场 15m 涨跌家数统计
     *   上涨/下跌家数、比例、差额 + 主力涨幅 + 主力×差额指数
     *   → K线(分时切换) + 详细表格(独立分时选项卡) + 该分时买卖信号回测
     *   ★2026-10-26 用户要求: 分时顺序 3m/5m/15m/1h/2h/4h；表格与回测均带分页 */
    if (window.UpDown && $('updown-panel')) {
      /* ★2026-10-28 bars 18000 → 2000: 单次响应实测 4.32MB(3m) 而表格一屏只显示 20 行,
       *   99% 的传输是浪费 → 收窄后 0.72MB(降 83%), 切分时从"几十秒白屏"变秒开。
       *   需要看更早历史 → 用表格分页条上的「« 更早」按钮按 beforeTs 往回翻。 */
      window.UpDown.mount('updown-panel', { grain: '15m', sector: '', lead: 'BTC', bars: 2000, interval: 30000 });



    /* ★2026-10-26 用户要求: 页面最下方「历史回补进度」面板（两年K线入库进度） */

    if (window.Backfill) {

      try { window.Backfill.mount('backfill-panel'); } catch (e) { }

    }
    }

    /* ★2026-10-26 用户要求: 删除总览底部悬浮K线小窗（CelestiaTIA·5分钟✕那类）
     *   → 移除 ChanPop 全局 hover 触发，悬停卡片/榜单不再弹 K线小窗 */

    // ★点击卡片/排行 → 打开对应选项卡全部页面（带品种定位参数）
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.mk-card, .rk-item') : null;
      if (!el) return;
      var href = el.getAttribute('data-href');
      if (href) location.href = href;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
