/* ============================================================================
 * web/js/ui/signal.js —— ★信号验证面板（用户 2026-10-25 第六轮核心需求）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   "在15分钟内 连续三次5分钟，板块涨跌比大于0的情况下 买入任何一个takervol 买卖比大于1的
 *    合约 最后5分钟都是涨的 并且核实涨幅是多少 哪个合约几点几分买的
 *    都要给我画出曲线和K线图"
 *   "移动到K线或者曲线可以告诉我具体 哪个合约几点几分买的
 *    K线后面15分钟每隔5分钟的涨幅多少"
 *
 * ★面板结构：
 *   ① 条件说明条（规则透明化）
 *   ② 汇总统计：四口径胜率 + 后续三段平均涨幅 + 分位数
 *   ③ 信号明细表：合约 / 买入时刻 / 买卖比 / 买比 / +5m +10m +15m / 累计 / 是否涨
 *      → 点击任一行 → 展开该信号的【K线图 + 双曲线】，悬浮显示买入点与后续15分钟
 *   ④ 板块总览表（各板块信号数与胜率）
 * ========================================================================== */
(function (global) {
  'use strict';
  var EKit = global.EKit, Net = global.Net;
  if (!EKit || !Net) return;

  var UID = 'sg' + Math.random().toString(36).slice(2, 7);
  var REG = {};

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
  function fmtT(ts) {
    if (!ts) return '-';
    var d = new Date(ts);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function pct(v, dg) {
    if ((v === null || v === undefined)) return '<span class="na">-</span>';
    var n = (dg === null || dg === undefined) ? 3 : dg;
    return '<span class="' + (v > 0 ? 'up' : (v < 0 ? 'dn' : '')) + '">' + (v > 0 ? '+' : '') + v.toFixed(n) + '%</span>';
  }

  var SECTORS = [
    { id: '', name: '🌐 全市场' }, { id: 'l1', name: '⛓ 公链层' }, { id: 'l2', name: '🧱 扩容层' },
    { id: 'defi', name: '🔗 DeFi' }, { id: 'meme', name: '🐕 Meme' }, { id: 'ai', name: '🤖 AI' },
    { id: 'infra', name: '🧰 基础设施' }, { id: 'nft', name: '🎮 链游与NFT' },
    { id: 'rwa', name: '🏗 实物资产' }, { id: 'other', name: '🪙 其他加密' }
  ];

  function st() {
    if (!REG[UID]) {
      REG[UID] = {
        sector: '', bars: 300, ratio: 1, needUp: 3,
        data: null, sel: null, detail: null, el: null, refs: {}
      };
    }
    return REG[UID];
  }

  function build(el) {
    var s = st();
    s.el = el;
    el.innerHTML =
      '<div class="sg-hd">' +
      '<span class="sg-t">🎯 信号验证 <small>板块连涨3次 × 涨跌家数比&gt;0</small></span>' +
      '<select class="md-sel" id="sg-sec-' + UID + '">' +
      SECTORS.map(function (x) { return '<option value="' + x.id + '">' + x.name + '</option>'; }).join('') +
      '</select>' +
      '<select class="md-sel" id="sg-bars-' + UID + '">' +
      '<option value="300">回看 300 根(25小时)</option>' +
      '<option value="600">回看 600 根(50小时)</option>' +
      '<option value="1000">回看 1000 根(83小时)</option>' +
      '<option value="2000">回看 2000 根(7天)</option>' +
      '<option value="4000">回看 4000 根(14天)</option>' +
      '<option value="8000">回看 8000 根(28天)</option>' +
      '</select>' +
      '<select class="md-sel" id="sg-ratio-' + UID + '">' +
      '<option value="1">买卖比 &gt; 1</option>' +
      '<option value="1.2">买卖比 &gt; 1.2</option>' +
      '<option value="1.5">买卖比 &gt; 1.5</option>' +
      '<option value="2">买卖比 &gt; 2</option>' +
      '</select>' +
      '<select class="md-sel" id="sg-up-' + UID + '">' +
      '<option value="3">连续 3 次板块上涨</option>' +
      '<option value="2">连续 2 次板块上涨</option>' +
      '<option value="4">连续 4 次板块上涨</option>' +
      '</select>' +
      '<span class="md-live"><i class="pn-dot"></i><span id="sg-tm-' + UID + '">加载中…</span></span>' +
      '</div>' +
      '<div class="sg-rule">' +
      '<b>规则</b>：板块在 15 分钟内【连续 ' +
      '<span id="sg-up-lbl-' + UID + '">3</span> 次 5 分钟】涨跌家数比 &gt; 0（多数合约上涨）' +
      ' → 该时刻买入【主动买量 ÷ 主动卖量 &gt; <span id="sg-ratio-lbl-' + UID + '">1</span>】的合约 ' +
      ' → 核实买入后 <b>15 分钟内每隔 5 分钟</b>的涨跌幅，以及最后 5 分钟是否上涨' +
      '</div>' +
      '<div class="sg-stats" id="sg-stats-' + UID + '"></div>' +
      '<div class="sg-tbwrap"><table class="sg-tb" id="sg-tb-' + UID + '"></table></div>' +
      '<div class="sg-detail" id="sg-detail-' + UID + '"></div>';

    s.refs = {
      sec: el.querySelector('#sg-sec-' + UID),
      bars: el.querySelector('#sg-bars-' + UID),
      ratio: el.querySelector('#sg-ratio-' + UID),
      up: el.querySelector('#sg-up-' + UID),
      tm: el.querySelector('#sg-tm-' + UID),
      upLbl: el.querySelector('#sg-up-lbl-' + UID),
      ratioLbl: el.querySelector('#sg-ratio-lbl-' + UID),
      stats: el.querySelector('#sg-stats-' + UID),
      tb: el.querySelector('#sg-tb-' + UID),
      detail: el.querySelector('#sg-detail-' + UID)
    };
    s.refs.sec.value = s.sector;
    s.refs.bars.value = String(s.bars);
    s.refs.ratio.value = String(s.ratio);
    s.refs.up.value = String(s.needUp);

    s.refs.sec.addEventListener('change', function () { s.sector = s.refs.sec.value; s.sel = null; load(); });
    s.refs.bars.addEventListener('change', function () { s.bars = +s.refs.bars.value; s.sel = null; load(); });
    s.refs.ratio.addEventListener('change', function () {
      s.ratio = +s.refs.ratio.value; s.refs.ratioLbl.textContent = s.ratio; s.sel = null; load();
    });
    s.refs.up.addEventListener('change', function () {
      s.needUp = +s.refs.up.value; s.refs.upLbl.textContent = s.needUp; s.sel = null; load();
    });
  }

  function load() {
    var s = st();
    var url = '/api/boards/signal?sector=' + encodeURIComponent(s.sector) +
      '&bars=' + s.bars + '&ratio=' + s.ratio + '&needUp=' + s.needUp + '&limit=400&t=' + Date.now();
    return Net.get(url, { ttl: 5000, timeout: 40000, priority: true }).then(function (j) {
      if (!j || !j.ok) {
        if (s.refs.stats) s.refs.stats.innerHTML = '<div class="sg-note">数据未就绪：' + esc((j && j.err) || '') + '</div>';
        return null;
      }
      s.data = j;
      renderStats();
      renderTable();
      if (s.sel) loadDetail(s.sel);
      if (s.refs.tm) s.refs.tm.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');
      return j;
    }).catch(function () { return null; });
  }

  function renderStats() {
    var s = st(), j = s.data;
    if (!j || !s.refs.stats) return;
    var st2 = j.stats || {};
    var r = st2.rates || {};
    var q = st2.quant || {};
    s.refs.stats.innerHTML =
      box('信号总数', st2.total, '') +
      box('有效样本', st2.valid, '') +
      box('最后5分钟涨', ((r.f15Only !== null && r.f15Only !== undefined) ? r.f15Only : st2.winRate) + '%', 'up') +
      box('三段全涨', ((r.allThree !== null && r.allThree !== undefined) ? r.allThree : 0) + '%', (r.allThree >= 50 ? 'up' : 'dn')) +
      box('累计>0', ((r.cumUp !== null && r.cumUp !== undefined) ? r.cumUp : 0) + '%', (r.cumUp >= 50 ? 'up' : 'dn')) +
      box('平均+5m', pct(st2.avgFwd5, 4), st2.avgFwd5 >= 0 ? 'up' : 'dn') +
      box('平均+10m', pct(st2.avgFwd10, 4), st2.avgFwd10 >= 0 ? 'up' : 'dn') +
      box('平均+15m', pct(st2.avgFwd15, 4), st2.avgFwd15 >= 0 ? 'up' : 'dn') +
      box('+5m 中位', q.f5 ? pct(q.f5.p50, 4) : '-', '') +
      box('+15m 中位', q.f15 ? pct(q.f15.p50, 4) : '-', '') +
      box('累计中位', q.cum ? pct(q.cum.p50, 4) : '');
  }
  function box(k, v, cls) {
    return '<div class="sg-stat"><span>' + esc(k) + '</span><b class="' + (cls || '') + '">' + v + '</b></div>';
  }

  function renderTable() {
    var s = st(), j = s.data;
    if (!s.refs.tb) return;
    var list = (j && j.signals) || [];
    var head = '<thead><tr><th>#</th><th>合约</th><th>买入时刻</th><th>买/卖比</th><th>主动买比</th>' +
      '<th class="r">+5分钟</th><th class="r">+10分钟</th><th class="r">+15分钟</th>' +
      '<th class="r">累计</th><th>最后5m</th></tr></thead>';
    if (!list.length) {
      s.refs.tb.innerHTML = head + '<tbody><tr><td colspan="10" class="na">该条件下暂无信号' +
        '（回看窗口内没有满足「连续' + s.needUp + '次板块涨跌比>0」的时点，可扩大回看范围或降低连续次数）</td></tr></tbody>';
      return;
    }
    var body = list.map(function (x, i) {
      return '<tr class="sg-row' + (s.sel && s.sel.ts === x.ts && s.sel.sym === x.sym ? ' on' : '') + '"' +
        ' data-sym="' + esc(x.sym) + '" data-ts="' + x.ts + '">' +
        '<td class="no">' + (i + 1) + '</td>' +
        '<td class="nm">' + esc(x.name || x.sym) + '<i>' + esc(x.sym) + '</i></td>' +
        '<td class="tm">' + fmtDT(x.ts) + '</td>' +
        '<td class="num r">' + x.ratio.toFixed(2) + '</td>' +
        '<td class="num">' + x.buyRatio + '%</td>' +
        '<td class="num r">' + pct(x.fwd5, 3) + '</td>' +
        '<td class="num r">' + pct(x.fwd10, 3) + '</td>' +
        '<td class="num r">' + pct(x.fwd15, 3) + '</td>' +
        '<td class="num r">' + pct(x.cum15, 3) + '</td>' +
        '<td>' + (x.lastUp ? '<span class="sg-yes">✓ 涨</span>' : '<span class="sg-no">✗</span>') +
        (x.allThreeUp ? ' <span class="sg-3">三段全涨</span>' : '') + '</td>' +
        '</tr>';
    }).join('');
    s.refs.tb.innerHTML = head + '<tbody>' + body + '</tbody>';
    s.refs.tb.onclick = function (e) {
      var tr = e.target.closest ? e.target.closest('.sg-row') : null;
      if (!tr) return;
      var sym = tr.getAttribute('data-sym'), ts = +tr.getAttribute('data-ts');
      s.sel = { sym: sym, ts: ts };
      renderTable();
      loadDetail(s.sel);
    };
  }

  /* ---------------- 信号详情：K线 + 双曲线 ---------------- */
  function loadDetail(sel) {
    var s = st();
    /* ★用户 2026-10-25: "要减去15分钟 也就是前面15分钟的数据 这样才可以看到后面15分钟的涨幅和信息"
     *   → before=0（去掉买入点之前的历史），after=18（买入后 15 分钟 + 3 根余量）
     *   → K线/曲线从【买入时刻】开始，后 15 分钟完整可见 */
    var url = '/api/boards/sigdetail?sym=' + encodeURIComponent(sel.sym) + '&ts=' + sel.ts +
      '&before=0&after=18&t=' + Date.now();
    return Net.get(url, { ttl: 5000, timeout: 40000, priority: true }).then(function (j) {
      if (!j || !j.ok) {
        if (s.refs.detail) s.refs.detail.innerHTML = '<div class="sg-note">详情未就绪：' + esc((j && j.err) || '') + '</div>';
        return null;
      }
      s.detail = j;
      renderDetail();
      return j;
    }).catch(function () { return null; });
  }

  function renderDetail() {
    var s = st(), j = s.detail;
    if (!j || !s.refs.detail) return;
    var fwd = j.fwd || [];
    var fwdRows = fwd.map(function (f) {
      return '<div class="sg-fwd-i"><span>' + esc(f.label) + '</span><b class="' +
        ((f.pct === null || f.pct === undefined) ? '' : (f.pct > 0 ? 'up' : 'dn')) + '">' +
        ((f.pct === null || f.pct === undefined) ? '-' : (f.pct > 0 ? '+' : '') + f.pct.toFixed(3) + '%') + '</b>' +
        '<i>' + esc(f.time) + '</i></div>';
    }).join('');

    s.refs.detail.innerHTML =
      '<div class="sg-d-hd">' +
      '<b>📍 ' + esc(j.name || j.sym) + '</b>' +
      '<span class="sg-d-sym">' + esc(j.sym) + ' · ' + esc(j.sector) + '</span>' +
      '<span class="sg-d-time">买入时刻 <b>' + esc(j.buyDate + ' ' + j.buyTime) + '</b></span>' +
      '<span class="sg-d-fwd">' + fwdRows + '</span>' +
      '</div>' +
      '<div class="sg-d-grid">' +
      '<div class="sg-d-box"><div class="sg-d-t">该合约 K 线（含买入点标记）</div><div id="sg-k-' + UID + '" class="sg-kchart"></div></div>' +
      '</div>';

    // K线（★共享悬浮窗组件 Tip.kline；markPoint 标出买入点）
    var kEl = s.refs.detail.querySelector('#sg-k-' + UID);
    if (kEl && j.candles && j.candles.length) {
      var buyCandle = j.candles[j.buyIdx] || j.candles[0];
      Tip.kline(kEl, {
        candles: j.candles.map(function (c, i) {
          /* ★算每根涨幅（相对前一根收盘）与累计涨幅（相对买入点收盘）
           *   → 用户: "K线后面15分钟每隔5分钟的涨幅多少" */
          var prevC = i > 0 ? j.candles[i - 1].c : null;
          var stepPct = (prevC && c.c) ? (c.c - prevC) / prevC * 100 : null;
          var buyC = j.candles[j.buyIdx] ? j.candles[j.buyIdx].c : null;
          var cumPct = (buyC && c.c) ? (c.c - buyC) / buyC * 100 : null;
          return {
            name: fmtT(c.t), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v,
            t: c.t,
            extra: {
              idx: i, ts: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v,
              isBuy: i === j.buyIdx,
              offset: i - j.buyIdx,
              stepPct: stepPct,
              cumPct: cumPct
            }
          };
        }),
        markPoint: {
          symbol: 'pin', symbolSize: 34,
          label: { formatter: '买', fontSize: 10, color: '#fff' },
          itemStyle: { color: '#f0a020' },
          data: [{ name: '买入', xAxis: fmtT(j.buyTs), yAxis: buyCandle ? buyCandle.c : null }]
        },
        tip: function (p) {
          var x = p.extra || {};
          var rows = [];
          rows.push(Tip.row('时间', fmtT(x.ts) + (x.isBuy ? '（买入点）' : ''), x.isBuy ? 'warn' : 'dim'));
          rows.push(Tip.row('相对买入', (x.offset === null || x.offset === undefined) ? '' :
            (x.offset === 0 ? '买入当根' : (x.offset > 0 ? '+' + x.offset * 5 + ' 分钟' : x.offset * 5 + ' 分钟')),
            x.offset > 0 ? 'up' : (x.offset < 0 ? 'dn' : 'warn')));
          /* ★本根涨幅 + 累计涨幅（用户要的核心信息） */
          rows.push(Tip.row('本根涨幅(5分钟)', Tip.pct(x.stepPct), x.stepPct >= 0 ? 'up' : 'dn'));
          rows.push(Tip.row('累计涨幅(相对买入)', Tip.pct(x.cumPct), x.cumPct >= 0 ? 'up' : 'dn'));
          rows.push(Tip.row('开', Tip.num(x.o), 'flat'));
          rows.push(Tip.row('高', Tip.num(x.h), 'up'));
          rows.push(Tip.row('低', Tip.num(x.l), 'dn'));
          rows.push(Tip.row('收', Tip.num(x.c), x.c >= x.o ? 'up' : 'dn'));
          rows.push(Tip.row('成交量', Tip.short(x.v), 'dim'));
          return Tip.html(fmtT(x.ts), rows);
        }
      });
    }
  }

  function mount(elId, opt) {
    opt = Object.assign({ sector: '', bars: 300, ratio: 1, needUp: 3, interval: 30000 }, opt || {});
    var el = typeof elId === 'string' ? document.getElementById(elId) : elId;
    if (!el) return;
    var s = st();
    s.sector = opt.sector; s.bars = opt.bars; s.ratio = opt.ratio; s.needUp = opt.needUp;
    build(el);
    load();
    if (opt.interval) {
      clearInterval(s.timer);
      s.timer = setInterval(function () { if (!s.sel) load(); }, opt.interval);
    }
    return s;
  }

  global.SignalPanel = { mount: mount, state: st };
})(typeof window !== 'undefined' ? window : globalThis);
