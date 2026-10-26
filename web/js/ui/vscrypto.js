/* ============================================================================
 * web/js/ui/vscrypto.js —— 【与数字货币比较】面板组件
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25 第五轮）：
 *   "要求全部变成和合约数字货币比较曲线"
 *   "所有主页的面板能和合约数字货币比较就比较"
 *   "多用曲线 多用K线 曲线和K线都开始双条跑"
 *   "多和数字货币比较 告诉我 所有指标和数据 和合约数字货币比较涨跌如何情况"
 *
 * ★本面板 = 数字货币基准的「全指标对比」总览：
 *   ① 结论条：谁比数字货币强 / 谁弱 / 谁与数字货币同向
 *   ② 指标对比表：每个板块的 涨跌幅/超额/主动买比/差值/净买/情绪/成交额倍数
 *   ③ 双曲线：基准 vs 对比对象 的累计涨跌（两条线同图）
 *   ④ 双 K 线：基准 K线 + 对比 K线（上下并排，横轴对齐）
 *   ⑤ 散点：板块超额涨跌 vs 买比偏离（谁跟数字货币越不像）
 *   ⑥ 相关性：各板块与数字货币的涨跌/买盘同步度
 *
 *   数据源：/api/boards/vscrypto（一次请求返回全部，AJAX 友好）
 * ========================================================================== */
(function (global) {
  'use strict';
  var Net = global.Net, EKit = global.EKit;

  function esc(s) {
    return String((s === null || s === undefined) ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pct(v) { return (v >= 0 ? '+' : '') + (+v).toFixed(2) + '%'; }
  function shortNum(v) {
    v = +v || 0;
    var a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(1) + '万';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return String(+v.toFixed(a < 1 ? 3 : 1));
  }

  /* ---------------- 指标对比表 ---------------- */
  function table(list, bench) {
    if (!list || !list.length) return '';
    var head = '<tr><th>#</th><th>板块 / 分类</th><th class="r">合约</th>' +
      '<th class="r">涨跌%</th><th class="r">超额(对比数字货币)</th>' +
      '<th class="r">主动买比</th><th class="r">买比差</th>' +
      '<th class="r">净买%</th><th class="r">情绪分</th>' +
      '<th class="r">成交额</th><th class="r">vs数字货币</th><th class="r">同向</th></tr>';
    var body = list.map(function (s) {
      var stronger = s.dPct >= 0;
      return '<tr><td class="fl-no">' + s.strength + '</td>' +
        '<td class="fl-nm">' + esc(s.icon || '') + ' ' + esc(s.name) + '</td>' +
        '<td class="r num">' + s.count + '</td>' +
        '<td class="r num ' + (s.pctAvg >= 0 ? 'up' : 'dn') + '">' + pct(s.pctAvg) + '</td>' +
        '<td class="r num ' + (stronger ? 'up' : 'dn') + '"><b>' + pct(s.dPct) + '</b></td>' +
        '<td class="r num ' + (s.buyRatio >= 50 ? 'up' : 'dn') + '">' + s.buyRatio + '%</td>' +
        '<td class="r num ' + (s.dBuy >= 0 ? 'up' : 'dn') + '">' + (s.dBuy >= 0 ? '+' : '') + s.dBuy + '</td>' +
        '<td class="r num ' + (s.netRatio >= 0 ? 'up' : 'dn') + '">' + pct(s.netRatio) + '</td>' +
        '<td class="r num">' + s.score + '<i class="fl-sub">' + esc(s.label) + '</i></td>' +
        '<td class="r num">' + shortNum(s.turn) + '</td>' +
        '<td class="r num">' + ((s.xTurn === null || s.xTurn === undefined) ? '-' : s.xTurn + '×') + '</td>' +
        '<td class="r num ' + (s.sameDir ? 'up' : 'dn') + '">' + (s.sameDir ? '同向' : '反向') + '</td>' +
        '</tr>';
    }).join('');
    var brow = '<tr style="background:rgba(240,160,32,.1)"><td class="fl-no">★</td>' +
      '<td class="fl-nm">' + esc(bench.icon || '₿') + ' ' + esc(bench.name) + '（基准）</td>' +
      '<td class="r num">' + bench.count + '</td>' +
      '<td class="r num ' + (bench.pctAvg >= 0 ? 'up' : 'dn') + '"><b>' + pct(bench.pctAvg) + '</b></td>' +
      '<td class="r num">基准</td>' +
      '<td class="r num"><b>' + bench.buyRatio + '%</b></td>' +
      '<td class="r num">—</td>' +
      '<td class="r num ' + (bench.netRatio >= 0 ? 'up' : 'dn') + '"><b>' + pct(bench.netRatio) + '</b></td>' +
      '<td class="r num"><b>' + bench.score + '</b></td>' +
      '<td class="r num"><b>' + shortNum(bench.turn) + '</b></td>' +
      '<td class="r num">1.00×</td><td class="r num">—</td></tr>';
    return '<div class="fl-tb-wrap"><table class="fl-tb">' + head + '<tbody>' + brow + body + '</tbody></table></div>';
  }

  /* ---------------- 结论条 ---------------- */
  function verdict(d) {
    if (!d || !d.sectors || !d.sectors.list || !d.sectors.list.length) return '';
    var list = d.sectors.list;
    var bench = d.sectors.benchmark;
    var stronger = list.filter(function (x) { return x.dPct > 0; });
    var weaker = list.filter(function (x) { return x.dPct < 0; });
    var same = list.filter(function (x) { return x.sameDir; });
    var top = list[0], bot = list[list.length - 1];
    var txt = '比数字货币强：' + (stronger.length ? stronger.map(function (x) {
      return x.icon + x.name + '(' + pct(x.dPct) + ')';
    }).join('、') : '无') +
      '；更弱：' + (weaker.length ? weaker.map(function (x) {
        return x.icon + x.name + '(' + pct(x.dPct) + ')';
      }).join('、') : '无') +
      '；与数字货币同向 ' + same.length + '/' + list.length + ' 个板块';
    return '<div class="fl-verdict">' +
      '<div class="fl-v-item"><span class="fl-v-k">基准（数字货币）</span>' +
      '<b style="color:#f0a020">涨跌 ' + pct(bench.pctAvg) + '</b>' +
      '<span class="fl-v-t">主动买 ' + bench.buyRatio + '% · 净买 ' + pct(bench.netRatio) +
      ' · 情绪 ' + bench.score + ' · ' + bench.count + ' 合约</span></div>' +
      '<div class="fl-v-item"><span class="fl-v-k">最强（相对数字货币）</span>' +
      '<b class="up">' + pct(top.dPct) + '</b>' +
      '<span class="fl-v-t">' + esc(top.icon || '') + ' ' + esc(top.name) +
      '：涨跌 ' + pct(top.pctAvg) + '，买比 ' + top.buyRatio + '%（差 ' + (top.dBuy >= 0 ? '+' : '') + top.dBuy + '）</span></div>' +
      '<div class="fl-v-item"><span class="fl-v-k">最弱（相对数字货币）</span>' +
      '<b class="dn">' + pct(bot.dPct) + '</b>' +
      '<span class="fl-v-t">' + esc(bot.icon || '') + ' ' + esc(bot.name) +
      '：涨跌 ' + pct(bot.pctAvg) + '，买比 ' + bot.buyRatio + '%（差 ' + (bot.dBuy >= 0 ? '+' : '') + bot.dBuy + '）</span></div>' +
      '<div class="fl-v-item"><span class="fl-v-k">结论</span>' +
      '<b>' + (same.length >= list.length * 0.6 ? '整体同步' : same.length >= list.length * 0.4 ? '部分同步' : '明显分化') + '</b>' +
      '<span class="fl-v-t">' + esc(txt) + '</span></div>' +
      '</div>';
  }

  /* ---------------- 挂载 ---------------- */
  function mount(el, opt) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return null;
    var o = Object.assign({ sector: '', interval: 30000, ttl: 20000 }, opt || {});
    var UID = ++_uid;

    el.innerHTML =
      '<div class="fl-hd">' +
      '<span class="fl-t">₿ 与数字货币比较 · 全指标对比</span>' +
      /* ★对比对象可选（默认选一个细分板块 —— 全市场与数字货币几乎重合 r≈1，对比无意义） */
      '<select class="vc-sel" id="vc-sel-' + UID + '">' +
      '<option value="l1">⛓ 公链层</option>' +
      '<option value="l2">🧱 扩容层</option>' +
      '<option value="defi">🔗 DeFi</option>' +
      '<option value="meme">🐕 Meme</option>' +
      '<option value="ai">🤖 AI</option>' +
      '<option value="infra">🧰 基础设施</option>' +
      '<option value="nft">🎮 链游与NFT</option>' +
      '<option value="rwa">🏗 实物资产</option>' +
      '<option value="other">🪙 其他加密</option>' +
      '<option value="">🌐 全市场</option>' +
      '</select>' +
      '<span class="fl-tf" id="vc-tf-' + UID + '"></span>' +
      '<span class="fl-live"><i class="pn-dot"></i><span id="vc-tm-' + UID + '">加载中…</span></span>' +
      '</div>' +
      '<div id="vc-verdict-' + UID + '"></div>' +
      '<div class="fl-box fl-corr"><div class="fl-bt" id="vc-k-t-' + UID + '">数字货币 ↔ 对比对象 双 K 线 <small>上=基准等权K线 · 下=对比K线 · 横轴对齐</small></div>' +
      '<div id="vc-k-' + UID + '" class="fl-chart fl-chart-lg"></div></div>' +
      '<div class="fl-grid">' +
      '<div class="fl-box"><div class="fl-bt" id="vc-c-t-' + UID + '">累计涨跌对比曲线 <small>双线同图 · 基准=加密货币等权</small></div>' +
      '<div id="vc-c-' + UID + '" class="fl-chart fl-chart-lg"></div></div>' +
      '<div class="fl-box"><div class="fl-bt">超额涨跌 ↔ 买比偏离 <small>散点 · 谁跟数字货币越不像</small></div>' +
      '<div id="vc-sc-' + UID + '" class="fl-chart fl-chart-lg"></div></div>' +
      '</div>' +
      '<div id="vc-tbl-' + UID + '"></div>';

    var R = {
      verdict: el.querySelector('#vc-verdict-' + UID),
      k: el.querySelector('#vc-k-' + UID), kT: el.querySelector('#vc-k-t-' + UID),
      c: el.querySelector('#vc-c-' + UID), cT: el.querySelector('#vc-c-t-' + UID),
      sc: el.querySelector('#vc-sc-' + UID),
      tbl: el.querySelector('#vc-tbl-' + UID),
      tm: el.querySelector('#vc-tm-' + UID), tf: el.querySelector('#vc-tf-' + UID),
      sel: el.querySelector('#vc-sel-' + UID)
    };

    /* ★切换对比对象 */
    var curSector = o.sector || 'l1';
    if (R.sel) {
      R.sel.value = curSector;
      R.sel.addEventListener('change', function () {
        curSector = R.sel.value;
        Net.invalidate('/api/boards/vscrypto');
        tick();
      });
    }

    function draw(d) {
      if (!d || !d.ok || !d.sectors) return;
      if (R.verdict) R.verdict.innerHTML = verdict(d);
      if (R.tbl) R.tbl.innerHTML = table(d.sectors.list, d.sectors.benchmark);
      var du = d.dual;
      if (du && du.ok) {
        /* ① 双 K 线 */
        if (R.k && du.candles && du.candles.bench.length) {
          var cb = du.candles.bench, co = du.candles.obj;
          var lbl = function (x) {
            var dt = new Date(x.t);
            return ('0' + dt.getHours()).slice(-2) + ':' + ('0' + dt.getMinutes()).slice(-2);
          };
          EKit.mount(R.k, 'candleDual', {
            a: cb.map(function (x) { return { o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, name: lbl(x) }; }),
            b: co.map(function (x) { return { o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, name: lbl(x) }; }),
            aName: (du.bench.icon || '₿') + ' ' + du.bench.name + ' 等权K线',
            bName: (du.obj.icon || '') + ' ' + (du.obj.name || '对比') + ' K线'
          }, { h: '34%', h2: '30%' });
          if (R.kT) R.kT.innerHTML = '数字货币 ↔ ' + (du.obj.name || '对比') + ' 双 K 线 ' +
            '<small>上=基准(加密货币等权指数) · 下=对比对象 · 5分钟粒度 · ' + cb.length + ' 根</small>';
        }
        /* ② 累计涨跌双曲线 */
        var pa = du.px.bench || [], pb = du.px.obj || [];
        var L = Math.min(pa.length, pb.length);
        if (L > 1 && R.c) {
          EKit.mount(R.c, 'line2', {
            a: pa.slice(-L).map(function (x, i) { return { k: i, value: x.value }; }),
            b: pb.slice(-L).map(function (x, i) { return { k: i, value: x.value }; }),
            aName: (du.bench.icon || '₿') + ' ' + du.bench.name,
            bName: (du.obj.icon || '') + ' ' + (du.obj.name || '对比')
          }, { fmt: '{value}%', colorA: '#f0a020', colorB: '#4f8cff' });
          if (R.cT) R.cT.innerHTML = '累计涨跌对比曲线 ' +
            '<small>基准=加密货币等权指数 · 相关 r=' + (du.corr && (du.corr.px !== null && du.corr.px !== undefined) ? du.corr.px : '-') +
            ' · 买盘相关 r=' + (du.corr && (du.corr.tk !== null && du.corr.tk !== undefined) ? du.corr.tk : '-') + '</small>';
        }
      }
      /* ③ 散点：超额涨跌 vs 买比偏离 */
      var lst = d.sectors.list || [];
      if (R.sc && lst.length) {
        EKit.mount(R.sc, 'scatter', lst.map(function (s) {
          return { name: (s.icon || '') + ' ' + s.name, x: s.dBuy, y: s.dPct, size: Math.max(9, Math.min(24, 6 + s.count / 14)) };
        }), { xName: '买比差(对比数字货币)', yName: '超额涨跌 %', xFmt: '{value}', yFmt: '{value}%' });
      }
      if (R.tf) R.tf.textContent = '基准 加密货币等权 · ' + (lst.length) + ' 个板块对比' +
        (du && du.obj ? ' · 对比对象=' + (du.obj.name || '全市场') : '');
      if (R.tm) R.tm.textContent = '更新于 ' + new Date().toTimeString().slice(0, 8);
    }

    function tick() {
      return Net.get('/api/boards/vscrypto?sector=' + encodeURIComponent(curSector) + '&t=' + Date.now(), { ttl: o.ttl })
        .then(draw).catch(function () { });
    }

    var api = {
      refresh: tick,
      destroy: function () {
        if (api._iv) clearInterval(api._iv);
        [R.k, R.c, R.sc].forEach(function (x) { if (x) EKit.dispose(x); });
      }
    };
    tick();
    if (o.interval > 0) api._iv = setInterval(function () { if (!document.hidden) tick(); }, o.interval);
    return api;
  }

  var _uid = 0;
  global.VsCrypto = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
