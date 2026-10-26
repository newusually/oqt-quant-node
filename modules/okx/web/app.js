// M8 modules/okx/web/app.js · OKX 页面逻辑(原生 JS + AJAX 调 JSON 接口)
//   合约列表(左侧) / 周期+指标切换 / 实时获取+补充数据 / 均线K线 / 账户盈亏
'use strict';
(function () {
  // ★支持 URL 参数 ?inst=ETH-USDT-SWAP 直接定位到某个合约
  var _qs = (function(){ try { return new URLSearchParams(location.search); } catch(e){ return null; } })();
  var inst = (_qs && _qs.get('inst')) || 'ETH-USDT-SWAP';
  var TF = '5m';
  var bars = [], CHAN = null, ACC = null, EQ_SERIES = null;
  var DRAW = { tool: 'cursor', color: '#f0a020', shapes: [] };

  function $(id) { return document.getElementById(id); }
  function fmtTime(ms) {
    var d = new Date(ms); function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fp(v) {
    v = Number(v);
    if (v === 0) return '0.00';
    var a = Math.abs(v);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(4);
    if (a >= 0.0001) return v.toFixed(6);
    return v.toFixed(8);
  }
  function fmtPx(v) { return (v === null || v === undefined) ? '-' : fp(v); }
  function api(path, q) {
    var u = '/api/okx/' + path;
    if (q) { var s = []; for (var k in q) if ((q[k] !== null && q[k] !== undefined)) s.push(encodeURIComponent(k) + '=' + encodeURIComponent(q[k])); if (s.length) u += '?' + s.join('&'); }
    return fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function toast(msg, bad) {
    var el = $('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.className = bad ? 'bad' : ''; el.style.display = 'block';
    clearTimeout(el._tm); el._tm = setTimeout(function () { el.style.display = 'none'; }, 2800);
  }

  // ---------------- 合约列表（★带实时价格 + 涨跌幅 + 箭头 + 红绿） ----------------
  var ALL_INST = [];
  var TICK_MAP = {};          // instId → {last, chg, pxText, chgText}
  var PREV_PX = {};           // instId → 上一次价格（用于闪烁动画）
  /* ★合约分类：引擎已给每个合约打好【加密生态板块】标签:
   *   sector = 公链层 / 扩容层 / DeFi / Meme / AI / 基础设施 / 链游与NFT / 实物资产与DePIN / 其他加密 */
  var CATS = [];            // [{id,name,icon,count}] 板块分类
  var CAT_OF = {};          // instId → 板块 id
  var CUR_CAT = '';         // 当前板块（'' = 全部）
  function buildCats() {
    CAT_OF = {};
    var cnt = {}, meta = {};
    ALL_INST.forEach(function (x) {
      var s = x.sector || 'other';
      CAT_OF[x.instId] = s;
      cnt[s] = (cnt[s] || 0) + 1;
    });
    fetch('/api/boards/sectors', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        (j.sectors || []).forEach(function (s) { meta[s.id] = s; });
        done(meta);
      }).catch(function () { done(meta); });
    function done(meta) {
      CATS = Object.keys(cnt).map(function (id) {
        var m = meta[id] || {};
        return { id: id, name: m.name || id, icon: m.icon || '', count: cnt[id] };
      });
      renderCats();
    }
  }
  function renderCats() {
    var box = $('inst-cats');
    if (!box || !CATS.length) return;
    var items = [{ id: '', name: '全部', icon: '', count: ALL_INST.length }].concat(CATS);
    var html = items.map(function (c) {
      return '<span class="icat' + (CUR_CAT === c.id ? ' on' : '') + '" data-cat="' + c.id + '">' +
        (c.icon ? c.icon + ' ' : '') + c.name + '<i>' + c.count + '</i></span>';
    }).join('');
    box.innerHTML = html;
  }

  function renderInstList(filter) {
    var box = $('inst-list');
    var f = (filter || '').trim().toUpperCase();
    var list = ALL_INST;
    if (CUR_CAT) list = list.filter(function (x) { return CAT_OF[x.instId] === CUR_CAT; });
    if (f) list = list.filter(function (x) { return x.instId.indexOf(f) >= 0 || (x.instFamily || '').toUpperCase().indexOf(f) >= 0; });
    if (!list.length) { box.innerHTML = '<div class="empty">无匹配</div>'; return; }
    box.innerHTML = '';
    // ★全部合约都列出来，价格实时变动（loadTickers 3 秒刷新）
    list.slice(0, 600).forEach(function (x) {
      var d = document.createElement('div');
      d.className = 'inst-item' + (x.instId === inst ? ' on' : '');
      d.setAttribute('data-inst', x.instId);
      d.innerHTML = '<span class="ii-name">' + x.instId + '</span>' +
        '<span class="ii-px" data-px="' + x.instId + '"><span class="muted">…</span></span>' +
        '<span class="ii-fam muted">' + (x.instFamily || '') + '</span>';
      d.onclick = function () { selectInst(x.instId); };
      box.appendChild(d);
    });
    paintTickers();
  }
  // ★把实时价格刷进列表（不重建 DOM, 避免闪烁/滚动位置丢失）
  function paintTickers() {
    var nodes = document.querySelectorAll('.ii-px[data-px]');
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].getAttribute('data-px');
      var t = TICK_MAP[id];
      if (!t) continue;
      var up = t.chg > 0, dn = t.chg < 0;
      var arrow = up ? '▲' : (dn ? '▼' : '—');
      var c = up ? 'ii-up' : (dn ? 'ii-dn' : '');
      var prev = PREV_PX[id];
      var flash = '';
      if ((prev !== null && prev !== undefined) && t.last !== prev) {
        flash = (t.last > prev) ? ' ii-flash-up' : ' ii-flash-dn';
      }
      PREV_PX[id] = t.last;
      nodes[i].className = 'ii-px ' + c + flash;
      nodes[i].innerHTML = '<span>' + t.pxText + '</span>' +
        '<span class="ii-arrow">' + arrow + '</span>' +
        '<span class="ii-chg">' + t.chgText + '</span>';
    }
  }
  function loadInstruments() {
    api('instruments').then(function (r) {
      if (!r.ok || !r.list) { $('inst-count').textContent = '· 失败'; return; }
      ALL_INST = r.list;
      $('inst-count').textContent = '· ' + ALL_INST.length + ' 个';
      renderInstList($('inst-search').value);
      if (CATS.length) renderCats();   // ★合约列表到位后刷新分类的"全部"计数
      else buildCats();                // ★首次: 按 sector/sub 自建分类(含二级)
    }).catch(function () { $('inst-count').textContent = '· 失败'; });
  }
  // ★实时 ticker（每 3 秒 ajax 拉全市场, 刷价格/涨跌/箭头）——SSE 接通后自动停此轮询
  var TICK_TIMER = null;
  function loadTickers() {
    api('tickers').then(function (r) {
      if (!r.ok || !r.list) return;
      var map = {};
      for (var i = 0; i < r.list.length; i++) map[r.list[i].instId] = r.list[i];
      TICK_MAP = map;
      // 当前选中合约的头部价格也用实时价
      var cur = TICK_MAP[inst];
      if (cur) {
        $('inst-price').textContent = cur.pxText;
        var pe = $('inst-pct');
        pe.textContent = cur.chgText;
        pe.className = 'num ' + (cur.chg > 0 ? 'up' : (cur.chg < 0 ? 'dn' : ''));
      }
      paintTickers();
    }).catch(function () {});
  }
  // ★毫秒级行情（SSE）: 服务端长连 OKX 公共 WS, 价格变动 ~300ms 推到页面
  //   （用户要求"行情毫秒级ws"；SSE 断开时自动回退 3 秒轮询）
  function initWsStream() {
    if (!window.EventSource) return;
    try {
      var es = new EventSource('/api/okx/stream');
      es.onopen = function () {
        if (TICK_TIMER) { clearInterval(TICK_TIMER); TICK_TIMER = null; }   // 毫秒级接通 → 停轮询
      };
      es.onerror = function () {
        if (!TICK_TIMER) TICK_TIMER = setInterval(loadTickers, 3000);       // 断线 → 回退轮询
      };
      es.onmessage = function (ev) {
        try {
          var j = JSON.parse(ev.data);
          if (!j || !j.ok || !j.list) return;
          for (var i = 0; i < j.list.length; i++) TICK_MAP[j.list[i].instId] = j.list[i];
          var cur = TICK_MAP[inst];
          if (cur) {
            $('inst-price').textContent = cur.pxText;
            var pe = $('inst-pct');
            pe.textContent = cur.chgText;
            pe.className = 'num ' + (cur.chg > 0 ? 'up' : (cur.chg < 0 ? 'dn' : ''));
            // ★毫秒级K线: 用最新价拼「形成中」K线, 主图跟着动(用户: "K线图居然不动")
            LIVE_PX = parseFloat(String(cur.pxText).replace(/,/g, ''));
            if (isFinite(LIVE_PX)) patchLiveBar();
          }
          paintTickers();                     // 侧栏全市场合约价格毫秒级刷新
        } catch (e) { }
      };
    } catch (e) { }
  }

  /* ---------------- ★毫秒级K线(SSE 拼形成中K线) ----------------
   * 价格/涨跌幅: 每批 SSE(~300ms) 即时更新;
   * 主图: 把最新价并入最后一根K线(收线则新开一根), 节流 1s 重绘 —— 形成中的K线持续在动;
   * 已收线的K线由服务端「保鲜员」落库, 60s 静默对账重载合并真实数据。 */
  var LIVE_PX = null, LAST_DRAW = 0, LIVE_INST = null;
  var TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000, '12h': 43200000, '1d': 86400000, '1w': 604800000, '1M': 2592000000 };
  function patchLiveBar() {
    if (!bars.length || (LIVE_PX === null || LIVE_PX === undefined) || LIVE_INST !== inst) return;
    var now = Date.now(), tfms = TF_MS[TF] || 300000;
    var last = bars[bars.length - 1];
    if (now >= last.t + tfms) {
      // 当前根已收线 → 按周期网格新开一根形成中K线
      var nt = Math.floor(now / tfms) * tfms;
      if (nt > last.t) bars.push({ t: nt, o: LIVE_PX, h: LIVE_PX, l: LIVE_PX, c: LIVE_PX, v: 0 });
    } else {
      last.c = LIVE_PX;
      if (LIVE_PX > last.h) last.h = LIVE_PX;
      if (LIVE_PX < last.l) last.l = LIVE_PX;
    }
    if (now - LAST_DRAW >= 1000) { LAST_DRAW = now; renderChart(); }
  }
  // 60s 静默对账: 拉库里最新K线, 保留形成中K线(库里还没有的实时根), 合并后重绘
  function loadKlineQuiet() {
    if (document.hidden) return;                       // 后台标签页不重载
    api('kline', { inst: inst, tf: TF, limit: 20000 }).then(function (k) {
      if (!k.ok || !k.bars || !k.bars.length) return;
      var nb = k.bars;
      var form = bars.length ? bars[bars.length - 1] : null;
      if (form && form.t > nb[nb.length - 1].t) {
        while (nb.length && nb[nb.length - 1].t >= form.t) nb.pop();   // 去掉库里被我们实时根覆盖的部分
        nb.push(form);
      }
      bars = nb; CHAN = k.chan || null;
      renderChart();
    }).catch(function () { });
  }
  function selectInst(id) {
    inst = id;
    LIVE_PX = null;                            // 换合约 → 清掉旧合约的实时价, 等新 SSE  ticker
    Array.prototype.forEach.call(document.querySelectorAll('.inst-item'), function (e) {
      e.classList.toggle('on', e.getAttribute('data-inst') === id);
    });
    $('inst-name').textContent = id;
    $('st-line').textContent = id + ' · ' + TF + ' · MA';
    loadKline(); loadBook();
  }

  // ---------------- 实时买卖队列 ----------------
  function loadBook() {
    api('book', { inst: inst, sz: 10 }).then(function (r) {
      if (!r.ok) return;
      var maxSz = 1;
      (r.asks || []).concat(r.bids || []).forEach(function (x) { if (x.sz > maxSz) maxSz = x.sz; });
      /* ★布局修复(用户 2026-10-25: "数量列下面的东西移动到了左边 价格也去了左边")
       *   根因: 深度条 .dep 是 position:absolute → 不占 grid 单元格,
       *         导致后面的 价格/数量 两个 span 各往前挪一列, 与表头三列错位。
       *   修法: 补上第 1 列【档位】(卖1/买1...), 让 in-flow 元素正好 3 个 = 与表头 3 列对齐 */
      function rows(arr, cls) {
        return (arr || []).map(function (x, i) {
          var w = (x.sz / maxSz * 100).toFixed(1);
          return '<div class="book-row ' + cls + '">' +
            '<span class="dep" style="width:' + w + '%;background:' + (cls === 'ask' ? '#f0334b' : '#0bbf7a') + '"></span>' +
            '<span class="bd-no">' + (cls === 'ask' ? '卖' : '买') + (i + 1) + '</span>' +
            '<span class="px">' + x.pxText + '</span>' +
            '<span class="r sz">' + x.sz + '</span>' +
            '</div>';
        }).join('');
      }
      $('book-asks').innerHTML = rows(r.asks, 'ask');
      $('book-bids').innerHTML = rows(r.bids, 'bid');
      var t = TICK_MAP[inst];
      $('book-mid').innerHTML = '<span class="' + (t && t.chg > 0 ? 'up' : (t && t.chg < 0 ? 'dn' : '')) + '">最新价 ' +
        (t ? t.pxText : '-') + '</span><span class="muted">价差 ' +
        ((r.spread !== null && r.spread !== undefined) ? r.spread.toFixed(4) : '-') + '</span>';
      /* ★买盘/卖盘比例总结行(用户: "少了一行 就是总结买盘和卖盘的比例 在买盘卖盘的中间") */
      var askSum = 0, bidSum = 0;
      (r.asks || []).forEach(function (x) { askSum += +x.sz || 0; });
      (r.bids || []).forEach(function (x) { bidSum += +x.sz || 0; });
      var tot = askSum + bidSum;
      var bR = tot ? bidSum / tot * 100 : 50;      // 买盘占比
      var rat = $('book-ratio');
      if (rat) {
        rat.innerHTML =
          '<div class="bkr-t"><span class="dn">买盘 ' + bR.toFixed(1) + '%</span>' +
          '<span class="up">卖盘 ' + (100 - bR).toFixed(1) + '%</span></div>' +
          '<div class="bkr-b">' +
          '<b class="bkr-buy" style="width:' + bR.toFixed(1) + '%"></b>' +
          '<b class="bkr-sell" style="width:' + (100 - bR).toFixed(1) + '%"></b></div>';
      }
      $('book-sub').textContent = 'Order Book · ' + inst + ' · ' + new Date().toLocaleTimeString('zh-CN');
    }).catch(function () {});
  }

  // ---------------- 持仓监控 ----------------
  function loadPositions() {
    api('positions').then(function (r) {
      var tb = $('pos-tb');
      if (!tb) return;
      if (!r.ok) { tb.innerHTML = '<tr><td colspan="7" class="empty">持仓读取失败: ' + (r.err || '') + '</td></tr>'; return; }
      $('pos-sub').textContent = r.count + ' 个持仓';
      if (!r.rows.length) { tb.innerHTML = '<tr><td colspan="7" class="empty">暂无持仓</td></tr>'; $('pos-sum').textContent = '浮动盈亏合计: 0.0000'; return; }
      tb.innerHTML = r.rows.map(function (x) {
        var buy = x.dir > 0;
        return '<tr>' +
          '<td>' + x.instId + '</td>' +
          '<td class="c"><span class="badge ' + (buy ? 'buy' : 'sell') + '">' + (buy ? '多' : '空') + '</span></td>' +
          '<td class="r">' + x.szText + '</td>' +
          '<td class="r">' + x.avgPxText + '</td>' +
          '<td class="r">' + x.markPxText + '</td>' +
          '<td class="r ' + (x.upl >= 0 ? 'up' : 'dn') + '">' + x.uplText + ' (' + x.uplPctText + ')</td>' +
          '<td class="r">' + x.liqPx + '</td>' +
          '</tr>';
      }).join('');
      var su = $('pos-sum');
      su.innerHTML = '浮动盈亏合计: <span class="' + (r.totalUpl >= 0 ? 'up' : 'dn') + '">' + r.totalUplText + ' USDT</span>';
    }).catch(function () {});
  }

  // ---------------- 周期按钮 ----------------
  var TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];
  function renderTf() {
    var g = $('tf-grp'); g.innerHTML = '';
    TFS.forEach(function (t) {
      var a = document.createElement('a');
      a.textContent = t; a.href = 'javascript:;';
      if (t === TF) a.className = 'on';
      a.onclick = function () { TF = t; LIVE_PX = null; renderTf(); $('st-line').textContent = inst + ' · ' + TF + ' · MA'; loadKline(); };
      g.appendChild(a);
    });
  }

  // ---------------- K线 + 均线 ----------------
  function renderChart() {
    drawKline($('idxcv'), {
      bars: bars, chan: CHAN, mainInd: $('mainInd-sel').value, subInd: $('subInd-sel').value,
      height: 480, stateKey: inst + ':' + TF, tf: TF,
      drawings: DRAW.shapes,
      // ★往左滑到边界 → 自动往回补历史(分页), 往前翻到本地共 1000 根为止
      onMore: function () {
        if (BACKFILL_BUSY) return;
        BACKFILL_BUSY = true;
        api('backfill', { inst: inst, tf: TF, limit: 1000, rounds: 30 }).then(function (r) {
          BACKFILL_BUSY = false;
          if (r && r.ok && r.added > 0) { loadKline(); toast('已回补 ' + r.added + ' 根历史K线'); }
        }).catch(function () { BACKFILL_BUSY = false; });
      }
    });
  }
  function loadKline() {
    $('idx-info').textContent = '加载中…';
    api('kline', { inst: inst, tf: TF, limit: 20000 }).then(function (k) {
      if (!k.ok) { $('idx-info').textContent = '加载失败: ' + (k.err || ''); return; }
      bars = k.bars || []; CHAN = k.chan || null;
      LIVE_INST = inst;                        // ★标记: 当前 bars 属于该合约(SSE 拼实时根用)
      if (!bars.length) { $('idx-info').textContent = '该周期暂无数据, 点「补充数据」拉取'; renderChart(); return; }
      var last = bars[bars.length - 1];
      $('inst-price').textContent = fmtPx(last.c);
      var prev = bars.length > 1 ? bars[bars.length - 2].c : last.o;
      var pct = prev ? (last.c - prev) / prev * 100 : 0;
      var pe = $('inst-pct'); pe.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'; pe.className = 'num ' + (pct >= 0 ? 'up' : 'dn');
      $('idx-info').textContent = '共 ' + bars.length + ' 根 · 最新 ' + fmtTime(last.t) + ' · 数据 ' + (k.src || '');
      renderChart();
    }).catch(function (e) { $('idx-info').textContent = '错误: ' + e; });
  }

  // ---------------- 账户/盈亏/成交 ----------------
  function loadAccount() {
    api('account').then(function (a) {
      if (!a.ok) { $('s-eq').textContent = '-'; return; }
      ACC = a;
      var ccy = a.ccy || 'USDT';
      $('s-eq').textContent = fp(a.totalEq) + ' ' + ccy;
      $('s-eq-chg').textContent = '可用 ' + fp(a.avail) + ' ' + ccy;
      drawEq();
    }).catch(function () {});
  }
  function drawEq() {
    var cv = $('eqcv'); if (!cv || !EQ_SERIES || !EQ_SERIES.length) return;
    var dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth || 900, H = 240;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    var c = cv.getContext('2d'); c.scale(dpr, dpr); c.clearRect(0, 0, W, H);
    var rs = EQ_SERIES;
    var lo = Math.min.apply(null, rs.map(function (r) { return r.eq; })), hi = Math.max.apply(null, rs.map(function (r) { return r.eq; }));
    var pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    var padL = 64, padR = 12, padT = 10, padB = 22, pw = W - padL - padR, ph = H - padT - padB;
    c.strokeStyle = '#26304a'; c.fillStyle = '#8b94ad'; c.font = '11px sans-serif'; c.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) { var y = padT + ph * g / 4; c.beginPath(); c.moveTo(padL, y); c.lineTo(W - padR, y); c.stroke(); c.fillText(fp(lo + (hi - lo) * (1 - g / 4)), 4, y); }
    c.strokeStyle = '#4d8dff'; c.lineWidth = 1.5; c.beginPath();
    rs.forEach(function (r, i) { var x = padL + pw * i / Math.max(1, rs.length - 1); var y = padT + ph * (1 - (r.eq - lo) / (hi - lo)); if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); });
    c.stroke();
    if (rs.length < 2) { var y0 = padT + ph * (1 - (rs[0].eq - lo) / (hi - lo)); c.fillStyle = '#4d8dff'; c.beginPath(); c.arc(padL + pw / 2, y0, 3, 0, Math.PI * 2); c.fill(); }
  }
  function loadPnl() {
    api('pnl').then(function (p) {
      if (!p.ok) { $('s-pnl').textContent = '-'; return; }
      $('s-pnl').textContent = ((p.total !== null && p.total !== undefined) ? (p.total >= 0 ? '+' : '') + fp(p.total) : '-') + ' USDT';
      $('s-pnl').className = 'v num ' + ((p.total || 0) >= 0 ? 'up' : 'dn');
      // 账户净值曲线: 以当前净值为锚, 反推历史权益(累计已实现盈亏序列偏移)
      if (ACC && ACC.ok && (ACC.totalEq !== null && ACC.totalEq !== undefined) && p.series && p.series.length) {
        var te = ACC.totalEq, tot = p.total || 0;
        EQ_SERIES = p.series.map(function (s) { return { ts: s.ts, eq: te - tot + s.cum }; });
        drawEq();
      }
    }).catch(function () {});
  }
  function loadTrades() {
    api('trades', { limit: 100 }).then(function (t) {
      if (!t.ok) { $('s-trades').textContent = '-'; return; }
      $('s-trades').textContent = t.count;
      var ccy = (t.rows && t.rows[0] && t.rows[0].ccy) || 'USDT';
      $('tr-sub').textContent = t.count + ' 条 · 已实现盈亏 ' + ((t.profit !== null && t.profit !== undefined) ? (t.profit >= 0 ? '+' : '') + fp(t.profit) : '-') + ' ' + ccy;
      var tb = $('tr-tb'); tb.innerHTML = '';
      t.rows.forEach(function (r) {
        var tr = document.createElement('tr');
        var buy = (r.side || '').toLowerCase() === 'buy';
        var notional = ((r.fillPx !== null && r.fillPx !== undefined) && (r.sz !== null && r.sz !== undefined)) ? r.fillPx * r.sz : null;
        tr.innerHTML = '<td>' + fmtTime(r.time) + '</td>' +
          '<td>' + (r.inst || '-') + '</td>' +
          '<td><span class="badge ' + (buy ? 'buy' : 'sell') + '">' + (r.side || '-') + '</span></td>' +
          '<td class="r">' + fp(r.fillPx) + '</td>' +
          '<td class="r">' + ((r.sz !== null && r.sz !== undefined) ? r.sz.toFixed(4) : '-') + '</td>' +
          '<td class="r">' + ((notional !== null && notional !== undefined) ? fp(notional) : '-') + '</td>' +
          '<td class="r ' + ((r.pnl || 0) >= 0 ? 'up' : 'dn') + '">' + ((r.pnl !== null && r.pnl !== undefined) ? (r.pnl >= 0 ? '+' : '') + fp(r.pnl) : '-') + '</td>';
        tb.appendChild(tr);
      });
      if (!t.rows.length) tb.innerHTML = '<tr><td colspan="7" class="empty">暂无成交</td></tr>';
    }).catch(function () {});
  }
  // ---------------- 绘图工具（移植 latest draw.js） ----------------
  function drawKey() { return inst + '|' + TF; }
  function drawOpt() {
    return {
      key: drawKey,
      map: function () { return $('idxcv').__map; },
      getShapes: function () { return DRAW.shapes; },
      setShapes: function (l) { DRAW.shapes = l; },
      tool: function () { return DRAW.tool; },
      color: function () { return DRAW.color; },
      onChange: function (draft) {
        var cv = $('idxcv');
        if (cv) cv.__draft = draft || null;
        renderChart();
      }
    };
  }
  function initDraw() {
    var cv = $('idxcv');
    if (!cv || !window.DrawTool) return;
    // 恢复该「合约|周期」已画的图形（1:1 latest loadShapes）
    DRAW.shapes = [];
    window.DrawTool.load(drawOpt());
    window.DrawTool.attach(cv, drawOpt());
    var sel = $('draw-tool'), col = $('draw-color');
    if (sel) sel.onchange = function () { DRAW.tool = sel.value; toast(sel.value === 'cursor' ? '已退出绘图' : '绘图工具: ' + sel.value + ' · 在K线上拖拽, 右键删图形'); };
    if (col) col.onchange = function () { DRAW.color = col.value; };
    var undo = $('draw-undo'), clr = $('draw-clear');
    if (undo) undo.onclick = function () { window.DrawTool.undo(drawOpt()); };
    if (clr) clr.onclick = function () { window.DrawTool.clear(drawOpt()); };
    // Esc 退出绘图工具（1:1 latest app.js:117）
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { DRAW.tool = 'cursor'; if (sel) sel.value = 'cursor'; }
    });
  }

  // ---------------- 实时获取 / 补充数据 ----------------
  function doPull(pages, label) {
    var btn = label === 'live' ? $('btn-live') : $('btn-more');
    btn.disabled = true; btn.textContent = '拉取中…';
    api('pull', { inst: inst, tf: TF, pages: pages }).then(function (r) {
      if (!r.ok && r.empty) { toast('未拉到数据', true); }
      else { toast('已' + (label === 'live' ? '实时获取' : '补充') + ' ' + ((r.added !== null && r.added !== undefined) ? r.added : 0) + ' 根 · 本地共 ' + (r.total || 0) + ' 根'); }
      loadKline();
    }).catch(function (e) { toast('拉取失败: ' + e, true); }).then(function () { btn.disabled = false; btn.textContent = label === 'live' ? '实时获取' : '补充数据'; });
  }

  // ---------------- 历史回补(往左滑动自动补 / 一键补30天) ----------------
  var BACKFILL_BUSY = false;
  function doBackfill(days) {
    if (BACKFILL_BUSY) { toast('正在回补历史, 请稍候…', true); return; }
    BACKFILL_BUSY = true;
    var btn = $('btn-backfill');
    if (btn) { btn.disabled = true; btn.textContent = '回补中…'; }
    toast('开始回补最近 ' + days + ' 天历史…');
    api('backfill', { inst: inst, tf: TF, days: days, rounds: 60 }).then(function (r) {
      BACKFILL_BUSY = false;
      if (btn) { btn.disabled = false; btn.textContent = '⏪ 补30天'; }
      if (!r || !r.ok) { toast('回补失败: ' + ((r && r.err) || '未知'), true); return; }
      var d = r.oldest ? new Date(r.oldest).toISOString().slice(0, 10) : '-';
      toast('回补完成 · 新增 ' + r.added + ' 根 · 本地共 ' + r.total + ' 根 · 最早 ' + d);
      loadKline();
    }).catch(function (e) {
      BACKFILL_BUSY = false;
      if (btn) { btn.disabled = false; btn.textContent = '⏪ 补30天'; }
      toast('回补失败: ' + e, true);
    });
  }

  // ---------------- 悬浮迷你K线窗（移植 latest pop.js） ----------------
  // 取数：按 inst+tf 拉 K线（带 before 定位信号时点）
  function popFetchKline(pInst, pTf, n, extra) {
    var q = { inst: pInst, tf: pTf, limit: n || 300 };
    if (extra && extra.before) q.before = extra.before;
    if (extra && extra.fresh) q.fresh = 1;          // ★自动刷新(本地库+保鲜员, 参数预留)
    return api('kline', q).then(function (k) {
      if (!k || !k.ok) return { ok: false, bars: [] };
      return { ok: true, bars: k.bars || [], chan: k.chan || null };
    });
  }
  function initPop() {
    if (!window.ChanPop) return;
    window.ChanPop.setFetch({ kline: popFetchKline });
    // ① 成交流水表 → 悬浮弹该时点K线
    window.ChanPop.bindRows('#tr-tb', function (tr) {
      var tds = tr.querySelectorAll('td');
      if (!tds.length) return null;
      var instName = tds[1] ? tds[1].textContent.trim() : '';
      if (!instName || instName === '-') return null;
      var ts = parseTime(tds[0] ? tds[0].textContent.trim() : '');
      if (!ts) return null;
      var px = tds[3] ? parseFloat(tds[3].textContent) : null;
      return { inst: instName, tf: TF, t: ts, px: px, label: instName };
    });
    // ③ 账户净值曲线 → 悬浮弹当前合约K线（定位到曲线对应时点）
    var eqcv = $('eqcv');
    if (eqcv) {
      eqcv.addEventListener('mousemove', function (e) {
        if (!EQ_SERIES || !EQ_SERIES.length) return;
        var rect = eqcv.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var padL = 64, padR = 12;
        var pw = (rect.width || 900) - padL - padR;
        var f = Math.max(0, Math.min(1, (mx - padL) / Math.max(1, pw)));
        var i = Math.round(f * (EQ_SERIES.length - 1));
        var pt = EQ_SERIES[i];
        if (!pt) return;
        if (POP_LAST_T === pt.ts) return;
        POP_LAST_T = pt.ts;
        if (window.ChanPop) window.ChanPop.open({ inst: inst, tf: TF, t: pt.ts, px: pt.eq, label: inst + ' 净值曲线' });
      });
      eqcv.addEventListener('mouseleave', function () { POP_LAST_T = 0; });
    }
  }
  var POP_LAST_T = 0;
  function parseTime(s) {
    if (!s) return 0;
    var m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return 0;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  }

  function tick() { $('clock').textContent = new Date().toLocaleString('zh-CN'); }

  /* ---------------- ★当前合约概念（用户 2026-10-25: "合约介绍概念入库" "实时查询"） ----------------
   * 数据源: /api/boards/inst（概念库全市场合约 + 实时行情）
   * sym 由 instId 推导: ETH-USDT-SWAP → ETH */
  function symOf(instId) { return String(instId || '').split('-')[0].toUpperCase(); }
  var SEC_CN = { l1: '公链层', l2: '扩容层', defi: 'DeFi', meme: 'Meme', ai: 'AI', infra: '基础设施', nft: '链游与NFT', rwa: '实物资产与DePIN', other: '其他加密' };
  function loadInstConcept() {
    var sym = symOf(inst);
    fetch('/api/boards/inst?sym=' + encodeURIComponent(sym) + '&t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !j.info) {
          $('ic-concept').textContent = '该合约暂无概念记录（' + sym + '）';
          $('ic-cat').innerHTML = '';
          return;
        }
        var i = j.info;
        var sec = SEC_CN[i.sector] || i.sector || '-';
        $('ic-cat').innerHTML =
          '<span class="ic-chip">📂 ' + esc(sec) + '</span>' +
          (i.lever ? '<span class="ic-chip">⚡ ' + esc(i.lever) + 'x</span>' : '');
        $('ic-concept').textContent = i.concept || '暂无概念介绍';
        $('ic-sub').textContent = sym + ' · 概念库实时查询 · ' + new Date(j.at).toLocaleTimeString('zh-CN');
      })
      .catch(function () { });
  }
  function esc(s) {
    return String((s === null || s === undefined) ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function init() {

    // ★全站自动播报（用户要求: 打开网站就播报最新行情 + 热门行情总结）
    if (window.PageCommon) {
      window.PageCommon.showLoader('正在搬运最新行情数据…');
      // ★用户 2026-10-25: "okx 页面选项卡有问题 打开居然播报语音了 给我禁止"
      //   → OKX 页不做语音播报(其他页面如需要由各自页面自行开启)
    }
    // ★URL 参数 ?inst=XXX 定位合约: 页头同步显示(修: 之前只有图表换了, 标题还写默认合约)
    $('inst-name').textContent = inst;
    $('st-line').textContent = inst + ' · ' + TF + ' · MA';
    renderTf();
    loadInstruments();
    // ★分类切换（事件委托: data-cat 芯片是动态生成的）
    var catBox = $('inst-cats');
    if (catBox) {
      catBox.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('.icat') : null;
        if (!t) return;
        CUR_CAT = t.getAttribute('data-cat') || '';
        renderCats();
        renderInstList($('inst-search') ? $('inst-search').value : '');
      });
    }
    loadKline(); loadAccount(); loadPnl(); loadTrades();
    // ★当前合约概念（10s 实时查询，切合约后自然跟随）
    loadInstConcept(); setInterval(loadInstConcept, 10000);
    // ★实时行情: 毫秒级 SSE(OKX公共WS) 优先, 失败回退 3 秒轮询 / 买卖队列(3秒) / 持仓(10秒)
    loadTickers();
    TICK_TIMER = setInterval(loadTickers, 3000);
    initWsStream();
    loadBook();    setInterval(loadBook, 3000);
    loadPositions(); setInterval(loadPositions, 10000);
    tick(); setInterval(tick, 1000);
    // ★60s 静默对账重载: 合并库里已收线K线 + 保留 SSE 拼的形成中K线(不闪回)
    setInterval(function () { loadKlineQuiet(); }, 60000);
    setInterval(function () { loadAccount(); loadTrades(); }, 60000);
    // ★侧栏折叠: 默认【展开】拉通到页面底部(用户 2026-10-25: "左边的列表给我拉长到页面下面10行显示"),
    //   仍可点标题折叠(折叠后只显示几行, 可滑动下拉)
    var sideEl = $('side'), sideTg = $('side-toggle');
    if (sideEl && sideTg) {
      sideTg.addEventListener('click', function () {
        sideEl.classList.toggle('collapsed');
      });
    }
    // ★自动补充数据: 页面打开后【只回填最近3天】(轻量, 秒开)
    //   更早的历史在【移动K线到左边界】时才分页往前翻(到本地共1000根为止)
    setTimeout(function () {
      api('backfill', { inst: inst, tf: TF, days: 3, rounds: 12 }).then(function (r) {
        if (r && r.ok && r.added > 0) { toast('自动补充最近3天 ' + r.added + ' 根K线'); loadKline(); }
      }).catch(function () {});
    }, 1500);
    $('inst-search').addEventListener('input', function () { renderInstList(this.value); });
    $('mainInd-sel').addEventListener('change', renderChart);
    $('subInd-sel').addEventListener('change', renderChart);
    $('btn-backfill').onclick = function () { doBackfill(30); };
    // ★自由布局(面板拖动/缩放/悬浮/隐藏/删除/复位)
    var bDock = $('btn-dock'), bDockR = $('btn-dock-reset');
    if (window.Dock) {
      if (bDock) bDock.onclick = function () {
        if (window.Dock.isOn()) { window.Dock.disable(); bDock.textContent = '🧩 布局'; toast('已关闭自由布局, 面板还原'); }
        else { window.Dock.enable(); bDock.textContent = '🧩 布局(开)'; toast('自由布局已开: 拖标题移动 / 拖边角缩放 / 双击标题悬浮 / 面板右上角 👁隐藏 ✕删除'); }
      };
      if (bDockR) bDockR.onclick = function () { if (window.Dock) { window.Dock.reset(); toast('面板布局已复位'); } };
    }
    $('btn-live').onclick = function () { doPull(2, 'live'); };
    $('btn-more').onclick = function () { doPull(12, 'more'); };
    $('btn-zoomin').onclick = function () { zoom(1 / 1.25); };
    $('btn-zoomout').onclick = function () { zoom(1.25); };
    $('btn-zoommax').onclick = function () { var cv = $('idxcv'); if (cv && cv._resetView) cv._resetView(); };
    initPop();
    initDraw();
    window.addEventListener('resize', renderChart);
  }
  // 缩放（滚轮同款）：改可见根数，标签同步
  function zoom(f) {
    var cv = $('idxcv');
    if (!cv || !cv._zoomBy) return;
    cv._zoomBy(f);
    updateZoomLabel();
  }
  function updateZoomLabel() {
    var cv = $('idxcv');
    var el = $('zoom-label');
    if (!cv || !el) return;
    var st = cv._kst;
    el.textContent = (st && st.vis ? st.vis : 100) + '根';
  }
  setInterval(updateZoomLabel, 400);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
