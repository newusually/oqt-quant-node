  /* ============ AI 面板图表：ECharts 优先，纯 HTML/SVG 降级 ============ */
  var aiChartInst = [], aiResizeBound = false;
  var AI_COLORS = ['#ff6b7d', '#4f8cff', '#ffc46b', '#31c99a', '#a97bff', '#42c6e8'];

  function aiChartCard(id, title) {
    return '<div class="ai-chart-card"><div class="ai-chart-t">' + esc(title) +
      '</div><div class="ai-chart" id="' + id + '"></div></div>';
  }
  function aiChartsHtml(charts) {
    var hasClose = charts && charts.curve && charts.curve.length;
    var t1 = hasClose ? '📈 累计已实现净 USD（逐笔平仓）'
      : '📈 累计开仓投入 USD（暂无平仓样本）';
    return '<div class="ai-charts">' +
      aiChartCard('ft-ai-c', t1) +
      aiChartCard('ft-ai-p', '🥧 事件类型分布') +
      aiChartCard('ft-ai-b', '📊 事件最多合约 Top 8') +
      aiChartCard('ft-ai-t', '💰 关键金额对比（USD）') +
      '</div>';
  }
  function aiChartEmpty(el, msg) {
    el.innerHTML = '<div class="ai-chart-empty">' + esc(msg || '暂无数据') + '</div>';
  }
  function aiFallbackCurve(el, arr, isCost) {
    var vs = arr.map(function (x) { return +x.v || 0; });
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if (hi === lo) hi = lo + 1;
    var n = vs.length - 1 || 1;
    var pts = vs.map(function (v, i) {
      return (i / n * 100).toFixed(2) + ',' + (50 - (v - lo) / (hi - lo) * 42).toFixed(2);
    }).join(' ');
    el.innerHTML = '<svg class="ai-fb-curve" viewBox="0 0 100 56" preserveAspectRatio="none">' +
      '<line x1="0" y1="50" x2="100" y2="50" stroke="#2a3f63" stroke-width=".4"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="#4f8cff" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>' +
      '<div class="ai-fallback">最新累计 <b>' + vs[vs.length - 1].toFixed(6) + '</b> USD · ' +
      (isCost ? '累计开仓投入 · ' + vs.length + ' 笔开仓/加仓事件' : '共 ' + vs.length + ' 笔平仓') + '</div>';
  }
  function aiFallbackBars(el, arr, money) {
    var mx = 1;
    arr.forEach(function (x) { mx = Math.max(mx, +x.value || 0); });
    el.innerHTML = '<div class="ai-fallback">' + arr.map(function (x, i) {
      var v = +x.value || 0;
      return '<div class="ai-fb-row"><span class="nm" title="' + esc(x.name) + '">' + esc(x.name) + '</span>' +
        '<div class="ai-fb-bar" style="width:' + (v / mx * 68).toFixed(1) + '%;background:' + AI_COLORS[i % AI_COLORS.length] + '"></div>' +
        '<b>' + esc(money ? v.toFixed(4) : v) + '</b></div>';
    }).join('') + '</div>';
  }
  function aiFallbackPie(el, arr) {
    var tot = 0, acc = 0;
    arr.forEach(function (x) { tot += +x.value || 0; });
    var stops = arr.map(function (x, i) {
      var from = acc / tot * 100; acc += +x.value || 0;
      return AI_COLORS[i % AI_COLORS.length] + ' ' + from.toFixed(2) + '% ' + (acc / tot * 100).toFixed(2) + '%';
    }).join(',');
    el.innerHTML = '<div class="ai-fallback" style="display:flex;align-items:center;gap:14px">' +
      '<div class="ai-fb-pie" style="background:conic-gradient(' + stops + ')"></div>' +
      '<div class="ai-fb-legend">' + arr.map(function (x, i) {
        return '<span class="ai-fb-dot" style="background:' + AI_COLORS[i % AI_COLORS.length] + '"></span>' +
          esc(x.name) + ' <b>' + esc(x.value) + '</b>';
      }).join('<br>') + '</div></div>';
  }

  function aiLineOpt(arr) {
    return {
      backgroundColor: 'transparent',
      textStyle: { color: '#a9bcda', fontSize: 10 },
      grid: { left: 52, right: 14, top: 14, bottom: 22 },
      tooltip: { trigger: 'axis', backgroundColor: '#101c31', borderColor: '#3d5a8e', textStyle: { color: '#e6f0ff', fontSize: 11 } },
      xAxis: {
        type: 'category', boundaryGap: false,
        data: arr.map(function (x) { return String(x.t || '').slice(5, 16); }),
        axisLine: { lineStyle: { color: '#2a3f63' } },
        axisLabel: { color: '#8b9abc', fontSize: 9, interval: Math.max(0, Math.floor(arr.length / 5)) }
      },
      yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#1c2b45' } }, axisLabel: { color: '#8b9abc', fontSize: 9 } },
      series: [{
        type: 'line', smooth: true, showSymbol: false,
        data: arr.map(function (x) { return +x.v || 0; }),
        lineStyle: { color: '#4f8cff', width: 2 },
        areaStyle: { color: 'rgba(79,140,255,.20)' },
        markLine: { silent: true, symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { color: '#52688f', type: 'dashed', width: 1 } }
      }]
    };
  }
  function aiBarOpt(arr, color, money) {
    return {
      backgroundColor: 'transparent',
      textStyle: { color: '#a9bcda', fontSize: 10 },
      grid: { left: 74, right: 36, top: 8, bottom: 18 },
      tooltip: { trigger: 'axis', backgroundColor: '#101c31', borderColor: '#3d5a8e', textStyle: { color: '#e6f0ff', fontSize: 11 } },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: '#1c2b45' } }, axisLabel: { color: '#8b9abc', fontSize: 9 } },
      yAxis: {
        type: 'category', data: arr.map(function (x) { return x.name; }).reverse(),
        axisLine: { lineStyle: { color: '#2a3f63' } }, axisLabel: { color: '#a9bcda', fontSize: 9.5 }
      },
      series: [{
        type: 'bar', barWidth: '58%',
        data: arr.map(function (x) { return +x.value || 0; }).reverse(),
        itemStyle: { color: color, borderRadius: [0, 4, 4, 0] },
        label: {
          show: true, position: 'right', color: '#cfe0ff', fontSize: 9,
          formatter: function (p) { return money ? (+p.value).toFixed(4) : p.value; }
        }
      }]
    };
  }
  function aiPieOpt(arr) {
    return {
      backgroundColor: 'transparent', color: AI_COLORS,
      tooltip: { trigger: 'item', backgroundColor: '#101c31', borderColor: '#3d5a8e', textStyle: { color: '#e6f0ff', fontSize: 11 } },
      legend: { bottom: 0, textStyle: { color: '#a9bcda', fontSize: 10 }, itemWidth: 9, itemHeight: 9 },
      series: [{
        type: 'pie', radius: ['38%', '66%'], center: ['50%', '43%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: '#0c1729', borderWidth: 2 },
        label: { show: true, color: '#cfe0ff', fontSize: 10, formatter: '{b} {c}' },
        data: arr.map(function (x) { return { name: x.name, value: +x.value || 0 }; })
      }]
    };
  }

  function aiMountCharts(charts) {
    aiChartInst.forEach(function (c) { try { c.dispose(); } catch (e) { } });
    aiChartInst = [];
    charts = charts || {};
    var E = global.echarts;
    var curve = charts.curve || [];
    var costCurve = charts.costCurve || [];
    var curveData = curve.length ? curve : costCurve;
    var pie = (charts.pie || []).filter(function (x) { return (+x.value || 0) > 0; });
    var bars = charts.bars || [], money = charts.metricsBars || [];
    function put(id, opt, fallback, arr, arg) {
      var el = document.getElementById(id); if (!el) return;
      if (!arr || !arr.length) { aiChartEmpty(el, id === 'ft-ai-c' ? '暂无任何事件数据' : '暂无数据'); return; }
      if (E) {
        try {
          var c = E.init(el, null, { renderer: 'canvas' });
          c.setOption(opt); aiChartInst.push(c); return;
        } catch (e) { }
      }
      try { fallback(el, arr, arg); } catch (e2) { aiChartEmpty(el, '图表渲染失败'); }
    }
    put('ft-ai-c', aiLineOpt(curveData), aiFallbackCurve, curveData, !curve.length);
    put('ft-ai-p', aiPieOpt(pie), aiFallbackPie, pie);
    put('ft-ai-b', aiBarOpt(bars, '#4f8cff', false), aiFallbackBars, bars, false);
    put('ft-ai-t', aiBarOpt(money, '#31c99a', true), aiFallbackBars, money, true);
    if (!aiResizeBound) {
      aiResizeBound = true;
      global.addEventListener('resize', function () {
        aiChartInst.forEach(function (c) { try { c.resize(); } catch (e) { } });
      });
    }
  }
