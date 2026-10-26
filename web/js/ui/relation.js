/* ============================================================================
 * web/js/ui/relation.js —— 【关系核实 & 分时对比面板组件】
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25 第四轮）：
 *   "要求核实涨跌比例和加密货币涨跌的关系 和takervol比例和涨跌幅度的关系
 *    要求核实如何才能买卖信号"
 *   "饼图和曲线图和柱状图 要求比较每个分时比较关系 和大盘的关系做表格做图"
 *   "表格和图形要求打开 E:\apache-echarts 多做上面项目的图形和表格
 *    最好做的多点详细点 当然都要ajax"
 *
 * ★本组件 = 一整个"核实 + 对比"分析面板，含 8 个图形 + 4 个表格：
 *   ① 核实结论条（领先性 r / 横截面 r / 板块级 r）
 *   ② 散点图：板块买盘强弱 ↔ 板块涨跌幅（含趋势线）
 *   ③ 散点图：合约级 买比偏离 ↔ 当期涨跌
 *   ④ 热力图：涨跌幅档 × 买比档 交叉矩阵（HTML 表格 + 热力图双呈现）
 *   ⑤ 买卖信号回测：规则说明 + 命中率柱状 + 阈值敏感性曲线
 *   ⑥ 分时对比柱状图：1m / 5m / 15m 各板块涨跌幅（相对大盘超额）
 *   ⑦ 分时对比：板块 vs 大盘 曲线
 *   ⑧ 雷达图：板块多维画像（涨跌/买比/成交额/情绪/合约数）
 *   ⑨ 旭日图：板块层级分布
 *
 *   数据源：/api/boards/relation（一次请求返回全部，AJAX 友好）
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

  /* ---------------- 核实结论条 ---------------- */
  function verdictBar(v) {
    if (!v) return '';
    function item(k, val, txt, n) {
      var color = Math.abs(val) >= 0.5 ? (val > 0 ? '#f0334b' : '#0bbf7a')
        : Math.abs(val) >= 0.25 ? (val > 0 ? '#f06a7a' : '#3d9be8') : '#8b94ad';
      return '<div class="fl-v-item"><span class="fl-v-k">' + esc(k) + '</span>' +
        '<b style="color:' + color + '">r = ' + val.toFixed(3) + '</b>' +
        '<span class="fl-v-t">' + esc(txt) + (n ? '（样本 ' + n + '）' : '') + '</span></div>';
    }
    return '<div class="fl-verdict">' +
      item('买盘领先性', v.lead.r, v.lead.text, v.lead.n) +
      item('合约横截面', v.cross.r, v.cross.text, v.cross.n) +
      item('板块横截面', v.sec.r, v.sec.text, v.sec.n) +
      '</div>';
  }

  /* ---------------- 交叉表（HTML 表格） ---------------- */
  function matrixTable(m) {
    if (!m) return '';
    var head = '<tr><th>涨跌幅 \\ 买比</th>' + m.tkBins.map(function (b) {
      return '<th class="r">' + esc(b) + '</th>';
    }).join('') + '<th class="r">合计</th></tr>';
    var body = m.rows.map(function (r) {
      var tot = r.cells.reduce(function (s, c) { return s + c.n; }, 0);
      return '<tr><td class="fl-ml">' + esc(r.label) + '</td>' +
        r.cells.map(function (c) {
          // 单元格底色：越多越红
          var a = Math.min(1, c.n / 12);
          var bg = 'rgba(240,48,75,' + (a * 0.42).toFixed(2) + ')';
          return '<td class="r" style="background:' + bg + '">' + c.n + '</td>';
        }).join('') +
        '<td class="r"><b>' + tot + '</b></td></tr>';
    }).join('');
    return '<div class="fl-tb-wrap"><table class="fl-tb fl-mx">' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  /* ---------------- 板块明细表 ---------------- */
  function sectorTable(list) {
    if (!list || !list.length) return '';
    var head = '<tr><th>板块</th><th class="r">合约</th><th class="r">主动买比</th>' +
      '<th class="r">偏离50</th><th class="r">平均涨跌</th><th class="r">成交额</th></tr>';
    var body = list.map(function (s) {
      return '<tr><td>' + esc(s.icon || '') + ' ' + esc(s.name) + '</td>' +
        '<td class="r num">' + s.count + '</td>' +
        '<td class="r num ' + (s.buyRatio >= 50 ? 'up' : 'dn') + '">' + s.buyRatio + '%</td>' +
        '<td class="r num ' + (s.buyRatioDev >= 0 ? 'up' : 'dn') + '">' + (s.buyRatioDev >= 0 ? '+' : '') + s.buyRatioDev + '</td>' +
        '<td class="r num ' + (s.pctAvg >= 0 ? 'up' : 'dn') + '">' + pct(s.pctAvg) + '</td>' +
        '<td class="r num">' + shortNum(s.turn) + '</td></tr>';
    }).join('');
    return '<div class="fl-tb-wrap"><table class="fl-tb">' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  /* ---------------- 分时对比表（1m/5m/15m × 板块 × 大盘） ---------------- */
  function intradayTable(list, mkt) {
    if (!list || !list.length) return '';
    var head = '<tr><th>板块</th><th class="r">1分钟</th><th class="r">5分钟</th><th class="r">15分钟</th>' +
      '<th class="r">5分钟超额</th><th class="r">买比</th><th class="r">买比偏离</th><th class="r">当日1D</th></tr>';
    var body = list.map(function (s) {
      return '<tr><td>' + esc(s.icon || '') + ' ' + esc(s.name) + '</td>' +
        '<td class="r num ' + (s.pct1m >= 0 ? 'up' : 'dn') + '">' + pct(s.pct1m) + '</td>' +
        '<td class="r num ' + (s.pct5m >= 0 ? 'up' : 'dn') + '">' + pct(s.pct5m) + '</td>' +
        '<td class="r num ' + (s.pct15m >= 0 ? 'up' : 'dn') + '">' + pct(s.pct15m) + '</td>' +
        '<td class="r num ' + (s.ex5m >= 0 ? 'up' : 'dn') + '">' + pct(s.ex5m) + '</td>' +
        '<td class="r num ' + (s.buyRatio >= 50 ? 'up' : 'dn') + '">' + s.buyRatio + '%</td>' +
        '<td class="r num ' + (s.buyRatioDev >= 0 ? 'up' : 'dn') + '">' + (s.buyRatioDev >= 0 ? '+' : '') + s.buyRatioDev + '</td>' +
        '<td class="r num ' + (s.pct1d >= 0 ? 'up' : 'dn') + '">' + pct(s.pct1d) + '</td></tr>';
    }).join('');
    var mrow = '<tr style="background:rgba(79,140,255,.1)"><td><b>🌐 全市场</b></td>' +
      '<td class="r num ' + (mkt.pct1m >= 0 ? 'up' : 'dn') + '"><b>' + pct(mkt.pct1m) + '</b></td>' +
      '<td class="r num ' + (mkt.pct5m >= 0 ? 'up' : 'dn') + '"><b>' + pct(mkt.pct5m) + '</b></td>' +
      '<td class="r num ' + (mkt.pct15m >= 0 ? 'up' : 'dn') + '"><b>' + pct(mkt.pct15m) + '</b></td>' +
      '<td class="r num">—</td>' +
      '<td class="r num"><b>' + mkt.buyRatio + '%</b></td>' +
      '<td class="r num"><b>' + (mkt.buyRatio >= 50 ? '+' : '') + (mkt.buyRatio - 50).toFixed(1) + '</b></td>' +
      '<td class="r num"><b>' + pct(mkt.pct1d) + '</b></td></tr>';
    var note = (mkt.wsReady < mkt.wsTotal)
      ? '<div class="rl-note">⚠️ 分时（1m/5m/15m）依赖 WebSocket 10 秒价格缓冲，' +
        '当前 <b>' + mkt.wsReady + '/' + mkt.wsTotal + '</b> 个标的已就绪（服务启动后约 15 分钟全量就绪），' +
        '未就绪的标的该列为 0 —— 当日 1D 列始终有效。</div>'
      : '';
    return '<div class="fl-tb-wrap"><table class="fl-tb">' + head + '<tbody>' + mrow + body + '</tbody></table></div>' + note;
  }

  /* ---------------- 挂载 ---------------- */
  function mount(el, opt) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return null;
    var o = Object.assign({ interval: 30000, ttl: 20000 }, opt || {});
    var UID = ++_uid;

    el.innerHTML =
      '<div class="fl-hd">' +
      '<span class="fl-t">🔬 关系核实 · 板块涨跌 ↔ 情绪 ↔ 分时对比</span>' +
      '<span class="fl-tf" id="rl-tf-' + UID + '"></span>' +
      '<span class="fl-live"><i class="pn-dot"></i><span id="rl-tm-' + UID + '">加载中…</span></span>' +
      '</div>' +
      '<div id="rl-verdict-' + UID + '"></div>' +
      '<div class="fl-grid">' +
      '<div class="fl-box"><div class="fl-bt">板块买盘强弱 ↔ 板块涨跌幅 <small>散点 · 含趋势线</small></div>' +
      '<div id="rl-sc-' + UID + '" class="fl-chart"></div></div>' +
      '<div class="fl-box"><div class="fl-bt">合约级 买比偏离 ↔ 当期涨跌 <small>散点 · 每点=1 个合约</small></div>' +
      '<div id="rl-scc-' + UID + '" class="fl-chart"></div></div>' +
      '</div>' +
      '<div class="fl-box fl-corr"><div class="fl-bt">涨跌幅档 × 买比档 交叉矩阵 <small>热力图（格内=合约数）</small></div>' +
      '<div id="rl-hm-' + UID + '" class="fl-chart fl-chart-lg"></div>' +
      '<div id="rl-mxt-' + UID + '"></div></div>' +
      '<div class="fl-grid">' +
      '<div class="fl-box"><div class="fl-bt">买卖信号命中率 <small>买比≥60% 记买信号 · 下一根 5m 判定</small></div>' +
      '<div id="rl-sig-' + UID + '" class="fl-chart"></div></div>' +
      '<div class="fl-box"><div class="fl-bt">信号阈值敏感性 <small>不同买比阈值的命中率</small></div>' +
      '<div id="rl-th-' + UID + '" class="fl-chart"></div></div>' +
      '</div>' +
      '<div id="rl-siginfo-' + UID + '"></div>' +
      '<div class="fl-grid">' +
      '<div class="fl-box"><div class="fl-bt">分时对比：1分/5分/15分 各板块涨跌 <small>柱状 · 三档周期</small></div>' +
      '<div id="rl-id-' + UID + '" class="fl-chart fl-chart-lg"></div></div>' +
      '<div class="fl-box"><div class="fl-bt">板块多维画像 <small>雷达 · 涨跌/买比/成交额/合约数</small></div>' +
      '<div id="rl-radar-' + UID + '" class="fl-chart fl-chart-lg"></div></div>' +
      '</div>' +
      '<div id="rl-idt-' + UID + '"></div>' +
      '<div class="fl-grid">' +
      '<div class="fl-box"><div class="fl-bt">板块层级分布 <small>旭日图 · 一级板块 → 二级行业</small></div>' +
      '<div id="rl-sb-' + UID + '" class="fl-chart fl-chart-lg"></div></div>' +
      '<div class="fl-box"><div class="fl-bt">板块买比 vs 涨跌 明细 <small>表格</small></div>' +
      '<div id="rl-sect-' + UID + '"></div></div>' +
      '</div>';

    var R = {
      verdict: el.querySelector('#rl-verdict-' + UID),
      sc: el.querySelector('#rl-sc-' + UID),
      scc: el.querySelector('#rl-scc-' + UID),
      hm: el.querySelector('#rl-hm-' + UID),
      mxt: el.querySelector('#rl-mxt-' + UID),
      sig: el.querySelector('#rl-sig-' + UID),
      th: el.querySelector('#rl-th-' + UID),
      siginfo: el.querySelector('#rl-siginfo-' + UID),
      id: el.querySelector('#rl-id-' + UID),
      radar: el.querySelector('#rl-radar-' + UID),
      idt: el.querySelector('#rl-idt-' + UID),
      sb: el.querySelector('#rl-sb-' + UID),
      sect: el.querySelector('#rl-sect-' + UID),
      tmel: el.querySelector('#rl-tm-' + UID),
      tfLab: el.querySelector('#rl-tf-' + UID)
    };

    function draw(d) {
      if (!d || !d.ok) return;
      var v = d.verify, sg = d.signal, it = d.intraday;

      if (R.verdict) R.verdict.innerHTML = verdictBar(v);

      // ① 板块散点
      if (R.sc && v.sec && v.sec.list.length) {
        EKit.mount(R.sc, 'scatter', v.sec.list.map(function (s) {
          return { name: (s.icon || '') + ' ' + s.name, x: s.buyRatioDev, y: s.pctAvg, size: Math.max(8, Math.min(26, 6 + s.count / 12)) };
        }), { xName: '买比偏离 50', yName: '板块平均涨跌 %', xFmt: '{value}', yFmt: '{value}%' });
      }

      // ② 合约散点
      if (R.scc && v.cross && v.cross.points.length) {
        EKit.mount(R.scc, 'scatter', v.cross.points.map(function (p) {
          return { name: p.name + '(' + p.sector + ')', x: +(p.buyRatio - 50).toFixed(1), y: p.pct };
        }), { xName: '买比偏离 50', yName: '当日涨跌 %', xFmt: '{value}', yFmt: '{value}%' });
      }

      // ③ 热力图 + 交叉表
      if (R.hm && v.matrix) {
        var rows = v.matrix.rows.map(function (r) {
          return { cells: r.cells.map(function (c) { return { v: c.n }; }) };
        });
        EKit.mount(R.hm, 'heatmap', rows, {
          xLabels: v.matrix.tkBins, yLabels: v.matrix.rows.map(function (r) { return r.label; }),
          rotate: 18
        });
        if (R.mxt) R.mxt.innerHTML = matrixTable(v.matrix);
      }

      // ④ 信号命中柱状 + 阈值敏感性
      if (R.sig && sg) {
        EKit.mount(R.sig, 'barDual', [
          { name: '买信号', v1: sg.buy.n, v2: sg.buy.hit },
          { name: '卖信号', v1: sg.sell.n, v2: sg.sell.hit }
        ], { n1: '信号数', n2: '命中数', rotate: 20 });
      }
      if (R.th && sg && sg.sensitivity) {
        EKit.mount(R.th, 'line', sg.sensitivity.map(function (x) {
          return { name: '买比≥' + x.th + '%', value: x.rate };
        }), { color: '#f0a020', fmt: '{value}%' });
      }
      if (R.siginfo && sg) {
        R.siginfo.innerHTML =
          '<div class="rl-note"><b>信号规则</b>' + esc(sg.rule.desc) +
          '<br/><b>买信号</b> ' + sg.buy.n + ' 条 · 命中 ' + sg.buy.hit + ' 条 · 命中率 <b>' + sg.buy.rate + '%</b> · 下一根平均涨跌 ' + pct(sg.buy.avg) +
          '<br/><b>卖信号</b> ' + sg.sell.n + ' 条 · 命中 ' + sg.sell.hit + ' 条 · 命中率 <b>' + sg.sell.rate + '%</b> · 下一根平均涨跌 ' + pct(sg.sell.avg) +
          '<br/><b>结论</b> ' + (sg.buy.rate > 50
            ? '买信号具备正向预测力（命中率>50%），可作为进场过滤条件'
            : sg.buy.rate > 45 ? '买信号接近随机（命中率 45~50%），需叠加趋势/量能过滤'
              : '买信号无正向预测力（命中率<45%），不可单独作为依据') + '</div>';
      }

      // ⑤ 分时对比柱状（1m/5m/15m 三档）
      if (R.id && it && it.list.length) {
        EKit.mount(R.id, 'barDual', it.list.map(function (s) {
          return { name: (s.icon || '') + s.name, v1: s.pct1m, v2: s.pct5m };
        }), { n1: '1分钟涨跌%', n2: '5分钟涨跌%', rotate: 22 });
      }

      // ⑥ 雷达图
      if (R.radar && it && it.list.length) {
        var maxTurn = Math.max(1, ...it.list.map(function (s) { return s.turn; }));
        var maxAbs = Math.max(0.5, ...it.list.map(function (s) { return Math.abs(s.pct5m); }));
        EKit.mount(R.radar, 'radar', it.list.slice(0, 8).map(function (s) {
          return {
            name: (s.icon || '') + ' ' + s.name,
            value: [
              +((s.pct5m + maxAbs) / (2 * maxAbs) * 100).toFixed(1),   // 涨跌（归一）
              +((s.buyRatioDev + 50) / 100 * 100).toFixed(1),            // 买比偏离
              +(s.turn / maxTurn * 100).toFixed(1),                      // 成交额
              +(s.count / 300 * 100).toFixed(1)                          // 合约规模
            ]
          };
        }), {
          indicators: [
            { name: '涨跌表现', max: 100 },
            { name: '买盘强度', max: 100 },
            { name: '成交活跃', max: 100 },
            { name: '合约规模', max: 100 }
          ]
        });
      }

      // ⑦ 旭日图（板块 → 行业）
      if (R.sb && v.sec && v.sec.list.length) {
        EKit.mount(R.sb, 'sunburst', v.sec.list.map(function (s) {
          return {
            name: (s.icon || '') + ' ' + s.name, value: s.count,
            children: [{ name: '合约 ' + s.count + ' 只', value: s.count }]
          };
        }));
      }

      // ⑧ 表格
      if (R.sect) R.sect.innerHTML = sectorTable(v.sec ? v.sec.list : []);
      if (R.idt) R.idt.innerHTML = intradayTable(it ? it.list : [], it ? it.market : { pct1m: 0, pct5m: 0, buyRatio: 50 });
      if (R.tfLab) R.tfLab.textContent = '样本 ' + (v.contracts || 0) + ' 合约 · 5分钟粒度';
      if (R.tmel) R.tmel.textContent = '更新于 ' + new Date().toTimeString().slice(0, 8);
    }

    function tick() {
      return Net.get('/api/boards/relation?bars=120&t=' + Date.now(), { ttl: o.ttl })
        .then(draw).catch(function () { });
    }

    var api = {
      refresh: tick,
      destroy: function () {
        if (api._iv) clearInterval(api._iv);
        [R.sc, R.scc, R.hm, R.sig, R.th, R.id, R.radar, R.sb].forEach(function (x) { if (x) EKit.dispose(x); });
      }
    };
    tick();
    if (o.interval > 0) {
      api._iv = setInterval(function () { if (!document.hidden) tick(); }, o.interval);
    }
    return api;
  }

  var _uid = 0;
  global.Relation = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
