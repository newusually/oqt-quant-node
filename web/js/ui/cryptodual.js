/* ============================================================================
 * web/js/ui/cryptodual.js —— ★加密货币板块双面板（用户 2026-10-25 第六轮）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   "就是 加密货币板块 根据净买量和动能 和加密货币板块涨幅做双曲线对比
 *    看具体时间涨跌是多少 移动到哪个曲线位置就悬浮窗告诉我具体时间和涨跌幅"
 *   "另外加密货币情绪值和涨跌幅也做面板也在下面做双曲线也是一样的悬浮窗和功能"
 *
 * ★两块图：
 *   ① 加密货币板块 净买量 + 动能 ↔ 板块涨幅（双曲线，十字光标悬浮窗）
 *   ② 加密货币板块 情绪值 ↔ 板块涨幅（双曲线，同样悬浮窗）
 *
 * ★悬浮窗内容：
 *   ① 具体日期时间 + 板块涨幅% + 净买量 + 动能 + 累计净买 + 涨跌家数
 *   ② 具体日期时间 + 情绪分 + 情绪标签 + 涨幅% + 主动买比 + 涨跌家数
 * ========================================================================== */
(function (global) {
  'use strict';
  var EKit = global.EKit, Net = global.Net;
  if (!EKit || !Net) return;

  var UID = 'cd' + Math.random().toString(36).slice(2, 7);
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
  function pct(v, dg) {
    if ((v === null || v === undefined)) return '-';
    var n = (dg === null || dg === undefined) ? 3 : dg;
    return (v > 0 ? '+' : '') + v.toFixed(n) + '%';
  }
  function shortNum(v) {
    if ((v === null || v === undefined)) return '-';
    var a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(1) + '万';
    return v.toFixed(0);
  }

  function st() {
    if (!REG[UID]) {
      REG[UID] = { grain: '1h', data: null, el: null, refs: {} };
    }
    return REG[UID];
  }

  function build(el) {
    var s = st();
    s.el = el;
    el.innerHTML =
      '<div class="md-hd">' +
      '<span class="md-t">₿ 加密货币板块 · 资金动能 & 情绪 双曲线</span>' +
      '<select class="md-sel" id="cd-grain-' + UID + '">' +
      '<option value="1h">1小时（最长三个月）</option>' +
      '<option value="5m">5分钟（近端）</option>' +
      '<option value="1d">1天（最长一年）</option>' +
      '</select>' +
      '<span class="md-live"><i class="pn-dot"></i><span id="cd-tm-' + UID + '">加载中…</span></span>' +
      '</div>' +
      '<div class="cd-stats" id="cd-stats-' + UID + '"></div>' +
      '<div class="cd-grid">' +
      '<div class="cd-box">' +
      '<div class="cd-t">① 净买量 & 动能 ↔ 板块涨幅 <small>左轴=涨幅% · 右轴=净买量/动能</small></div>' +
      '<div id="cd-net-' + UID + '" class="cd-chart"></div>' +
      '</div>' +
      '<div class="cd-box">' +
      '<div class="cd-t">② 情绪值 ↔ 板块涨幅 <small>左轴=涨幅% · 右轴=情绪分 0~100</small></div>' +
      '<div id="cd-mood-' + UID + '" class="cd-chart"></div>' +
      '</div>' +
      '</div>' +
      '<div class="cd-note" id="cd-note-' + UID + '"></div>';

    s.refs = {
      grain: el.querySelector('#cd-grain-' + UID),
      tm: el.querySelector('#cd-tm-' + UID),
      stats: el.querySelector('#cd-stats-' + UID),
      net: el.querySelector('#cd-net-' + UID),
      mood: el.querySelector('#cd-mood-' + UID),
      note: el.querySelector('#cd-note-' + UID)
    };
    s.refs.grain.value = s.grain;
    s.refs.grain.addEventListener('change', function () { s.grain = s.refs.grain.value; load(); });
  }

  function load() {
    var s = st();
    var url = '/api/boards/cryptopanels?grain=' + encodeURIComponent(s.grain) + '&t=' + Date.now();
    return Net.get(url, { ttl: 5000, timeout: 40000 }).then(function (j) {
      if (!j || !j.ok) {
        if (s.refs.stats) s.refs.stats.innerHTML = '<div class="sg-note">数据未就绪：' + esc((j && j.err) || '') + '</div>';
        return null;
      }
      s.data = j;
      render();
      if (s.refs.tm) s.refs.tm.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN');
      return j;
    }).catch(function () { return null; });
  }

  function render() {
    var s = st(), j = s.data;
    if (!j || !s.refs.net) return;
    var stx = j.stats || {};

    // ① 净买量 & 动能 ↔ 涨幅（★共享悬浮窗组件 Tip.curve）
    var nm = j.netMomentum || [];
    Tip.curve(s.refs.net, {
      a: nm.map(function (x) { return { label: fmtDT(x.ts), value: x.pct, extra: x }; }),
      b: nm.map(function (x) { return { label: fmtDT(x.ts), value: x.net, extra: x }; }),
      n1: '板块涨幅%', n2: '净买量',
      aName: '板块涨幅%', bName: '净买量',
      xFmt: '{value}%', yFmt: '{value}',
      colorA: '#f0334b', colorB: '#4f8cff',
      zoom: true,
      tip: function (p) {
        var x = p.extra || {};
        var rows = [];
        rows.push(Tip.row('板块涨幅', Tip.pct(x.pct), x.pct >= 0 ? 'up' : 'dn'));
        rows.push(Tip.row('净买量', Tip.short(x.net), x.net >= 0 ? 'up' : 'dn'));
        rows.push(Tip.row('动能(3期均)', Tip.short(x.momentum), x.momentum >= 0 ? 'up' : 'dn'));
        rows.push(Tip.row('累计净买', Tip.short(x.netCum), x.netCum >= 0 ? 'up' : 'dn'));
        rows.push(Tip.row('主动买比', (x.buyRatio === null || x.buyRatio === undefined) ? '' : x.buyRatio + '%',
          x.buyRatio >= 50 ? 'up' : 'dn'));
        rows.push(Tip.row('涨跌家数', ((x.up === null || x.up === undefined) ? '' : x.up + ' 涨 / ' + x.down + ' 跌'), 'flat'));
        rows.push(Tip.row('家数比', (x.ratio === null || x.ratio === undefined) ? '' :
          ((x.ratio > 0 ? '+' : '') + (x.ratio * 100).toFixed(0) + '%'), x.ratio > 0 ? 'up' : 'dn'));
        return Tip.html((x.date || '') + ' ' + (x.time || ''), rows);
      }
    });

    // ② 情绪值 ↔ 涨幅（★共享悬浮窗组件 Tip.curve）
    var mp = j.moodPct || [];
    Tip.curve(s.refs.mood, {
      a: mp.map(function (x) { return { label: fmtDT(x.ts), value: x.pct, extra: x }; }),
      b: mp.map(function (x) { return { label: fmtDT(x.ts), value: x.score, extra: x }; }),
      n1: '板块涨幅%', n2: '情绪分',
      aName: '板块涨幅%', bName: '情绪分',
      xFmt: '{value}%', yFmt: '{value}',
      colorA: '#f0334b', colorB: '#f0a020',
      zoom: true,
      tip: function (p) {
        var x = p.extra || {};
        var rows = [];
        rows.push(Tip.row('板块涨幅', Tip.pct(x.pct), x.pct >= 0 ? 'up' : 'dn'));
        rows.push(Tip.row('情绪分', (x.score === null || x.score === undefined) ? '' : (x.score + ' · ' + (x.scoreLabel || '')),
          x.score >= 50 ? 'up' : 'dn'));
        rows.push(Tip.row('主动买比', (x.buyRatio === null || x.buyRatio === undefined) ? '' : x.buyRatio + '%',
          x.buyRatio >= 50 ? 'up' : 'dn'));
        rows.push(Tip.row('涨跌家数', ((x.up === null || x.up === undefined) ? '' : x.up + ' 涨 / ' + x.down + ' 跌'), 'flat'));
        rows.push(Tip.row('家数比', (x.ratio === null || x.ratio === undefined) ? '' :
          ((x.ratio > 0 ? '+' : '') + (x.ratio * 100).toFixed(0) + '%'), x.ratio > 0 ? 'up' : 'dn'));
        return Tip.html((x.date || '') + ' ' + (x.time || ''), rows);
      }
    });

    // 统计条
    if (s.refs.stats) {
      s.refs.stats.innerHTML =
        b('当前涨幅', pct(stx.lastPct), stx.lastPct >= 0 ? 'up' : 'dn') +
        b('主动买比', stx.lastBuyRatio + '%', stx.lastBuyRatio >= 50 ? 'up' : 'dn') +
        b('净买量', shortNum(stx.lastNet), stx.lastNet >= 0 ? 'up' : 'dn') +
        b('动能', shortNum(stx.lastMomentum), stx.lastMomentum >= 0 ? 'up' : 'dn') +
        b('累计净买', shortNum(stx.lastNetCum), stx.lastNetCum >= 0 ? 'up' : 'dn') +
        b('情绪分', stx.lastScore + ' (' + stx.lastScoreLabel + ')', stx.lastScore >= 50 ? 'up' : 'dn') +
        b('涨跌↔买比 r', stx.r, '') +
        b('情绪↔涨幅 r', (j.moodCorr && j.moodCorr.r !== null && j.moodCorr && j.moodCorr.r !== undefined) ? j.moodCorr.r : '-', '');
    }
    if (s.refs.note) {
      s.refs.note.innerHTML =
        '共 <b>' + (j.netMomentum || []).length + '</b> 个数据点 · 覆盖 ' +
        '<b>' + fmtDT(j.oldest) + '</b> ~ <b>' + fmtDT(j.newest) + '</b>（' +
        (j.stats ? j.stats.spanDays : 0) + ' 天）· ' + j.count + ' 个合约 · ' +
        '涨跌 ↔ 买比 <b>' + esc(stx.corrText || '-') + '</b> · 情绪 ↔ 涨幅 <b>' +
        esc((j.moodCorr && j.moodCorr.text) || '-') + '</b> · ' +
        '<span class="muted">把鼠标移到曲线上任意位置即可看到该时刻的具体数值；拖动底部滑块可缩放</span>';
    }
  }

  function b(k, v, cls) {
    return '<div class="md-stat"><span>' + esc(k) + '</span><b class="' + (cls || '') + '">' + esc(v) + '</b></div>';
  }

  function mount(elId, opt) {
    opt = Object.assign({ grain: '1h', interval: 30000 }, opt || {});
    var el = typeof elId === 'string' ? document.getElementById(elId) : elId;
    if (!el) return;
    var s = st();
    s.grain = opt.grain;
    build(el);
    load();
    if (opt.interval) {
      clearInterval(s.timer);
      s.timer = setInterval(load, opt.interval);
    }
    return s;
  }

  global.CryptoDual = { mount: mount, state: st };
})(typeof window !== 'undefined' ? window : globalThis);
