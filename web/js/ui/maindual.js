/* ============================================================================
 * web/js/ui/maindual.js —— ★首页最重要参考：板块涨跌 双曲线
 * ----------------------------------------------------------------------------
 * 用户需求（2026-10-25）：
 *   "首页 板块涨跌 ↔ takervol 双曲线 左轴=板块等权涨跌% · 右轴=主动买比偏离50
 *    r=-0.009（基本无关·方向互有，一致率 52%，样本 133）首页这个图形 作为最重要参考
 *    给我历史搞来最高三个月的数据"
 *   "往左移动可以查询更前面历史 一开始只显示100根K线的长度数据"
 *   "移动到K线或者曲线可以告诉我具体 哪个合约几点几分买的
 *    K线后面15分钟每隔5分钟的涨幅多少"
 *
 * ★功能：
 *   ① 双曲线：左轴=板块等权涨跌%，右轴=主动买比偏离50（十字光标 + 自定义悬浮窗）
 *   ② 历史窗口：初始 100 根（用户要求）→ 可选 100/500/1000/全部
 *   ③ 左移加载更早历史：「← 更早」按钮 + 滑块拖到最左自动加载（beforeTs 分页）
 *   ④ 悬浮窗：具体日期时间 + 涨跌幅 + 买比 + 净买量 + 涨跌家数
 *   ⑤ 周期切换：1H（三个月）/ 5m（近端）
 * ========================================================================== */
(function (global) {
  'use strict';
  var EKit = global.EKit, Net = global.Net;
  if (!EKit || !Net) return;

  var UID = 'md' + Math.random().toString(36).slice(2, 7);
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

  var SECTORS = [
    { id: '', name: '🌐 全市场' }, { id: 'l1', name: '⛓ 公链层' }, { id: 'l2', name: '🧱 扩容层' },
    { id: 'defi', name: '🔗 DeFi' }, { id: 'meme', name: '🐕 Meme' }, { id: 'ai', name: '🤖 AI' },
    { id: 'infra', name: '🧰 基础设施' }, { id: 'nft', name: '🎮 链游与NFT' },
    { id: 'rwa', name: '🏗 实物资产' }, { id: 'other', name: '🪙 其他加密' },
    { id: '', name: '🌐 全市场' }
  ];

  /* ---------------- 状态 ---------------- */
  function st() {
    if (!REG[UID]) {
      REG[UID] = {
        sector: '', grain: '1h', win: 100, beforeTs: 0,
        bars: [], stats: null, concl: '', loaded: 0, el: null, refs: {}
      };
    }
    return REG[UID];
  }

  /* ---------------- 骨架 ---------------- */
  function build(el, opt) {
    var s = st();
    s.el = el;
    el.innerHTML =
      '<div class="md-hd">' +
      '<span class="md-t">📈 板块涨跌 双曲线 <small>最重要参考</small></span>' +
      '<select class="md-sel" id="md-sec-' + UID + '">' +
      SECTORS.map(function (x) { return '<option value="' + x.id + '">' + x.name + '</option>'; }).join('') +
      '</select>' +
      '<select class="md-sel" id="md-grain-' + UID + '">' +
      '<option value="1h">1小时（最长三个月）</option>' +
      '<option value="5m">5分钟（近端）</option>' +
      '<option value="1d">1天（最长一年）</option>' +
      '</select>' +
      '<select class="md-sel" id="md-win-' + UID + '">' +
      '<option value="100">窗口 100 根</option>' +
      '<option value="500">窗口 500 根</option>' +
      '<option value="1000">窗口 1000 根</option>' +
      '<option value="2160">窗口 2160 根（90天）</option>' +
      '</select>' +
      '<button class="md-btn" id="md-earlier-' + UID + '" title="向左移动，加载更早历史">← 更早</button>' +
      '<button class="md-btn" id="md-max-' + UID + '" title="一次性加载最长历史（1H=三个月2160根）">三个月全览</button>' +
      '<button class="md-btn" id="md-latest-' + UID + '" title="回到最新">最新</button>' +
      '<span class="md-live"><i class="pn-dot"></i><span id="md-tm-' + UID + '">加载中…</span></span>' +
      '</div>' +
      '<div class="md-concl" id="md-concl-' + UID + '">正在计算…</div>' +
      '<div class="md-stats" id="md-stats-' + UID + '"></div>' +
      '<div class="md-chart" id="md-chart-' + UID + '"></div>' +
      '<div class="md-foot" id="md-foot-' + UID + '"></div>';

    s.refs = {
      sec: el.querySelector('#md-sec-' + UID),
      grain: el.querySelector('#md-grain-' + UID),
      win: el.querySelector('#md-win-' + UID),
      earlier: el.querySelector('#md-earlier-' + UID),
      maxBtn: el.querySelector('#md-max-' + UID),
      latest: el.querySelector('#md-latest-' + UID),
      tm: el.querySelector('#md-tm-' + UID),
      concl: el.querySelector('#md-concl-' + UID),
      stats: el.querySelector('#md-stats-' + UID),
      chart: el.querySelector('#md-chart-' + UID),
      foot: el.querySelector('#md-foot-' + UID)
    };
    s.refs.sec.value = s.sector;
    s.refs.grain.value = s.grain;
    s.refs.win.value = String(s.win);

    s.refs.sec.addEventListener('change', function () {
      s.sector = s.refs.sec.value; s.beforeTs = 0; load();
    });
    s.refs.grain.addEventListener('change', function () {
      s.grain = s.refs.grain.value; s.beforeTs = 0; load();
    });
    s.refs.win.addEventListener('change', function () {
      s.win = +s.refs.win.value || 100; s.beforeTs = 0; load();
    });
    s.refs.earlier.addEventListener('click', function () { loadEarlier(); });
    s.refs.maxBtn.addEventListener('click', function () { loadMax(); });
    s.refs.latest.addEventListener('click', function () { s.beforeTs = 0; load(); });
  }

  /* ---------------- 取数 ---------------- */
  function load() {
    var s = st();
    var url = '/api/boards/maindual?sector=' + encodeURIComponent(s.sector) +
      '&grain=' + encodeURIComponent(s.grain) + '&bars=' + s.win +
      (s.beforeTs ? '&beforeTs=' + s.beforeTs : '') + '&t=' + Date.now();
    return Net.get(url, { ttl: 4000, timeout: 40000 }).then(function (j) {
      if (!j || !j.ok) {
        if (s.refs.concl) s.refs.concl.textContent = '数据未就绪：' + ((j && j.err) || '未知错误');
        return null;
      }
      s.bars = j.bars || [];
      s.stats = j.stats;
      s.concl = j.concl || '';
      s.loaded = j.total || s.bars.length;
      s.range = { oldest: j.oldest, newest: j.newest };
      draw();
      return j;
    }).catch(function () { return null; });
  }

  /* ★左移加载更早历史：取当前窗口最早一根之前的同长窗口
   *   用户："往左移动可以查询更前面历史 一开始只显示100根K线的长度数据"
   *   → 初始 100 根；每次点「← 更早」再取一段更早的，累积到最长（1H=2160根/90天）
   *   → 画布上用 dataZoom 滑块在已加载的区间内左右移动 */
  function loadEarlier() {
    var s = st();
    if (!s.bars.length) return;
    var earliest = s.bars[0].ts;
    // 已加载的最大根数（1H 三个月 = 2160）
    var MAXW = (s.grain === '1h') ? 2160 : (s.grain === '1d' ? 400 : 3000);
    if (s.bars.length >= MAXW) {
      if (s.refs.foot) s.refs.foot.textContent = '已加载最长历史（' + fmtDT(earliest) + ' 起 ' + s.bars.length + ' 根）';
      return;
    }
    var url = '/api/boards/maindual?sector=' + encodeURIComponent(s.sector) +
      '&grain=' + encodeURIComponent(s.grain) + '&bars=' + s.win +
      '&beforeTs=' + (earliest - 1) + '&t=' + Date.now();
    if (s.refs.foot) s.refs.foot.textContent = '正在加载更早历史…';
    return Net.get(url, { ttl: 4000, timeout: 40000, priority: true }).then(function (j) {
      if (!j || !j.ok || !(j.bars || []).length) {
        if (s.refs.foot) s.refs.foot.textContent = '已到最早可用历史（' + fmtDT(earliest) + '）';
        return null;
      }
      // 合并（新数据在前面）
      var map = {};
      s.bars.concat(j.bars).forEach(function (b) { map[b.ts] = b; });
      var merged = Object.keys(map).map(function (k) { return map[k]; })
        .sort(function (a, b) { return a.ts - b.ts; });
      s.bars = merged.slice(-MAXW);
      s.stats = j.stats; s.concl = j.concl || s.concl;
      s.range = { oldest: merged[0].ts, newest: merged[merged.length - 1].ts };
      s.beforeTs = merged[0].ts - 1;    // 连续左移
      draw();
      if (s.refs.foot) {
        s.refs.foot.textContent = '已加载至 ' + fmtDT(merged[0].ts) + '（共 ' + s.bars.length +
          ' 根' + (s.bars.length >= MAXW ? ' · 已达最长历史' : ' · 继续点「← 更早」向前追溯') +
          '）· 拖动底部滑块可左右移动查看';
      }
      return j;
    }).catch(function () { return null; });
  }

  /* ★一次性加载最长历史（1H 三个月 = 2160 根 / 1D 400 天） */
  function loadMax() {
    var s = st();
    var MAXW = (s.grain === '1h') ? 2160 : (s.grain === '1d' ? 400 : 3000);
    var url = '/api/boards/maindual?sector=' + encodeURIComponent(s.sector) +
      '&grain=' + encodeURIComponent(s.grain) + '&bars=' + MAXW + '&t=' + Date.now();
    if (s.refs.foot) s.refs.foot.textContent = '正在加载最长历史…';
    return Net.get(url, { ttl: 4000, timeout: 40000, priority: true }).then(function (j) {
      if (!j || !j.ok || !(j.bars || []).length) {
        if (s.refs.foot) s.refs.foot.textContent = '最长历史加载失败';
        return null;
      }
      s.bars = j.bars;
      s.stats = j.stats; s.concl = j.concl || s.concl;
      s.range = { oldest: j.oldest, newest: j.newest };
      s.beforeTs = j.oldest - 1;
      draw();
      if (s.refs.foot) {
        s.refs.foot.textContent = '已加载最长历史 ' + s.bars.length + ' 根（' +
          fmtDT(j.oldest) + ' ~ ' + fmtDT(j.newest) + '，' + (j.stats ? j.stats.spanDays : 0) +
          ' 天）· 拖动底部滑块可左右移动';
      }
      return j;
    }).catch(function () { return null; });
  }

  /* ---------------- 渲染 ---------------- */
  function draw() {
    var s = st();
    if (!s.refs.chart || !s.bars.length) return;

    /* ★改用共享悬浮窗组件（Tip.curve）：自定义数据统一放 extra，
     *   悬浮窗只显示有值的字段（Tip.row 自动过滤 null/undefined/NaN） */
    var A = s.bars.map(function (b) {
      return { label: fmtDT(b.ts), value: (b.pctAvg === null || b.pctAvg === undefined) ? null : b.pctAvg, extra: b };
    });
    var B = s.bars.map(function (b) {
      return { label: fmtDT(b.ts), value: ((b.buyRatio === null || b.buyRatio === undefined) ? null : +(b.buyRatio - 50).toFixed(2)), extra: b };
    });

    Tip.curve(s.refs.chart, {
      a: A, b: B,
      n1: '板块等权涨跌%', n2: '主动买比偏离50',
      aName: '板块等权涨跌%', bName: '主动买比偏离50',
      xFmt: '{value}%', yFmt: '{value}',
      colorA: '#f0334b', colorB: '#4f8cff',
      zoom: true, zoomStart: 0,
      tip: function (p) {
        var b = p.extra || {};
        var rows = [];
        rows.push(Tip.row('板块等权涨跌', Tip.pct(b.pctAvg), b.pctAvg >= 0 ? 'up' : 'dn'));
        rows.push(Tip.row('主动买比', (b.buyRatio === null || b.buyRatio === undefined) ? '' : b.buyRatio + '%',
          b.buyRatio >= 50 ? 'up' : 'dn'));
        rows.push(Tip.row('买比偏离50', (b.buyRatio === null || b.buyRatio === undefined) ? '' :
          ((b.buyRatio - 50 > 0 ? '+' : '') + (b.buyRatio - 50).toFixed(1)), b.buyRatio >= 50 ? 'up' : 'dn'));
        rows.push(Tip.row('净买量', Tip.short(b.net), b.net >= 0 ? 'up' : 'dn'));
        rows.push(Tip.row('动能(3期)', Tip.short(b.momentum), b.momentum >= 0 ? 'up' : 'dn'));
        rows.push(Tip.row('累计净买', Tip.short(b.netCum), b.netCum >= 0 ? 'up' : 'dn'));
        rows.push(Tip.row('涨跌家数', ((b.up === null || b.up === undefined) ? '' : b.up + ' 涨 / ' + b.down + ' 跌'), 'flat'));
        rows.push(Tip.row('家数比', (b.ratio === null || b.ratio === undefined) ? '' :
          ((b.ratio > 0 ? '+' : '') + (b.ratio * 100).toFixed(0) + '%'), b.ratio > 0 ? 'up' : 'dn'));
        rows.push(Tip.row('情绪分', (b.score === null || b.score === undefined) ? '' : (b.score + ' · ' + (b.scoreLabel || '')),
          b.score >= 50 ? 'up' : 'dn'));
        return Tip.html(p.label, rows);
      }
    });

    // 统计条
    if (s.refs.stats && s.stats) {
      var st2 = s.stats;
      s.refs.stats.innerHTML =
        item('当前等权涨跌', pct(st2.lastPct), (st2.lastPct >= 0 ? 'up' : 'dn')) +
        item('主动买比', st2.lastBuyRatio + '%', st2.lastBuyRatio >= 50 ? 'up' : 'dn') +
        item('净买量', shortNum(st2.lastNet), st2.lastNet >= 0 ? 'up' : 'dn') +
        item('动能(3期)', shortNum(st2.lastMomentum), st2.lastMomentum >= 0 ? 'up' : 'dn') +
        item('累计净买', shortNum(st2.lastNetCum), st2.lastNetCum >= 0 ? 'up' : 'dn') +
        item('情绪分', st2.lastScore + ' (' + st2.lastScoreLabel + '', st2.lastScore >= 50 ? 'up' : 'dn') +
        item('相关性 r', st2.r, '') +
        item('一致率', st2.agree + '%', '') +
        item('覆盖天数', st2.spanDays + ' 天', '');
    }
    if (s.refs.concl) s.refs.concl.textContent = s.concl || '-';
    if (s.refs.tm) {
      s.refs.tm.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN') +
        (s.range ? ' · ' + fmtDT(s.range.oldest) + ' ~ ' + fmtDT(s.range.newest) : '');
    }
    if (s.refs.foot && !s.refs.foot.textContent) {
      s.refs.foot.textContent = '共 ' + s.bars.length + ' 根（窗口 ' + s.win +
        ' 根）· 拖动底部滑块左右移动 · 点「← 更早」向前追溯 · 点「三个月全览」加载最长历史';
    }
  }

  function item(k, v, cls) {
    return '<div class="md-stat"><span>' + esc(k) + '</span><b class="' + (cls || '') + '">' + esc(v) + '</b></div>';
  }

  /* ---------------- 挂载 ---------------- */
  function mount(elId, opt) {
    opt = Object.assign({
      sector: '', grain: '1h', win: 100, interval: 20000
    }, opt || {});
    var el = typeof elId === 'string' ? document.getElementById(elId) : elId;
    if (!el) return;
    var s = st();
    s.sector = opt.sector; s.grain = opt.grain; s.win = opt.win;
    build(el, opt);
    load();
    if (opt.interval) {
      clearInterval(s.timer);
      s.timer = setInterval(function () {
        if (!s.beforeTs) load();       // 处于左移浏览时不打断
      }, opt.interval);
    }
    return s;
  }

  global.MainDual = { mount: mount, state: st };
})(typeof window !== 'undefined' ? window : globalThis);
