/* ============================================================================
 * charts.js —— 【全站共用】ECharts 图表组件（实时 ajax 驱动）
 * ----------------------------------------------------------------------------
 * 用户要求：
 *   "画图要用 echarts 柱状图 饼图 多使用echarts来画图做统计 要实时ajax
 *    多画表 多画图 多动画 多组件 然后在主页总览那边实时显示"
 *   "要求所有页面都要有共用API和接口和复用某一项功能都能力 组件复用"
 *
 * 用法（任何页面）：
 *   <script src="/web/js/vendor/echarts.min.js"></script>
 *   <script src="/web/js/charts.js"></script>
 *   var pie = Charts.pie('box-id', { title: '市场情绪' });
 *   pie.update([{name:'上涨', value: 120}, {name:'下跌', value: 80}]);   // 实时更新
 *
 * 提供：pie(玫瑰饼图) / bar(柱状图) / hist(涨跌分布直方图) / gauge(仪表)
 *   全部深色主题、tabular-nums、动画、resize 自适应、增量更新不重建。
 * ========================================================================== */
(function (global) {
  'use strict';
  if (!global.echarts) { console.warn('charts.js: echarts 未加载'); return; }

  var instances = {};

  var FONT = '#8b94ad';
  var BASE = {
    textStyle: { color: '#d7dcea', fontFamily: 'inherit' },
    animationDuration: 600,
    animationDurationUpdate: 400
  };

  function mount(id, option) {
    var el = document.getElementById(id);
    if (!el) return null;
    var ch = instances[id];
    if (!ch) {
      ch = echarts.init(el, null, { renderer: 'canvas' });
      instances[id] = ch;
      // 面板隐藏(dock)时尺寸为0 → 显示后再 resize
      if (global.ResizeObserver) {
        try { new ResizeObserver(function () { ch.resize(); }).observe(el); } catch (e) { }
      }
    }
    ch.setOption(option, { notMerge: false });
    return ch;
  }

  /* ---------------- 玫瑰饼图 ---------------- */
  function pie(id, opt) {
    opt = opt || {};
    return mount(id, Object.assign({}, BASE, {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, textStyle: { color: FONT, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      series: [{
        type: 'pie', radius: ['38%', '72%'], center: ['50%', '44%'],
        roseType: 'radius',
        itemStyle: { borderRadius: 5, borderColor: '#12172a', borderWidth: 2 },
        label: { color: '#d7dcea', fontSize: 11, formatter: '{b}\n{c}' },
        data: opt.data || []
      }]
    }));
  }

  /* ---------------- 柱状图 ---------------- */
  function bar(id, opt) {
    opt = opt || {};
    return mount(id, Object.assign({}, BASE, {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 12, top: 18, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category', data: opt.labels || [],
        axisLabel: { color: FONT, fontSize: 10, interval: 0, rotate: opt.rotate || 0 },
        axisLine: { lineStyle: { color: '#26304a' } }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: FONT, fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(38,48,74,.55)' } }
      },
      series: [{
        type: 'bar', data: opt.data || [], barMaxWidth: 22,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: { show: opt.showLabel !== false, position: 'top', color: FONT, fontSize: 10 }
      }]
    }));
  }

  /* ---------------- 涨跌分布直方图（红涨绿跌, 中国习惯） ---------------- */
  function hist(id, opt) {
    opt = opt || {};
    // 默认颜色: 负区间绿, 正区间红（中国市场惯例）
    var colors = (opt.labels || []).map(function (l) {
      return (l.indexOf('-') === 0 || l.indexOf('<') === 0) ? '#0bbf7a' : '#f0334b';
    });
    return mount(id, Object.assign({}, BASE, {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: '{b}<br/>数量: {c} 个' },
      grid: { left: 8, right: 12, top: 18, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category', data: opt.labels || [],
        axisLabel: { color: FONT, fontSize: 10, interval: 0 },
        axisLine: { lineStyle: { color: '#26304a' } }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: FONT, fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(38,48,74,.55)' } }
      },
      series: [{
        type: 'bar', data: (opt.data || []).map(function (v, i) {
          return { value: v, itemStyle: { color: colors[i] || '#3d7bff', borderRadius: [4, 4, 0, 0] } };
        }), barMaxWidth: 26
      }]
    }));
  }

  /* ---------------- 迷你横条图（TOP 榜） ---------------- */
  function hbar(id, opt) {
    opt = opt || {};
    var labels = opt.labels || [];
    var data = opt.data || [];
    return mount(id, Object.assign({}, BASE, {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 4, right: 46, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', axisLabel: { color: FONT, fontSize: 10 }, splitLine: { show: false } },
      yAxis: {
        type: 'category', data: labels.slice().reverse(),
        axisLabel: { color: '#d7dcea', fontSize: 11 },
        axisLine: { lineStyle: { color: '#26304a' } }, axisTick: { show: false }
      },
      series: [{
        type: 'bar', data: data.slice().reverse(), barMaxWidth: 14,
        itemStyle: { borderRadius: [0, 7, 7, 0] },
        label: { show: true, position: 'right', color: FONT, fontSize: 10, formatter: opt.fmt || '{c}' }
      }]
    }));
  }

  /* ---------------- 仪表盘 ---------------- */
  function gauge(id, opt) {
    opt = opt || {};
    return mount(id, Object.assign({}, BASE, {
      series: [{
        type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: 100,
        progress: { show: true, width: 12 },
        axisLine: { lineStyle: { width: 12, color: [[0.3, '#0bbf7a'], [0.45, '#3d7bff'], [0.58, '#f0a020'], [1, '#f0334b']] } },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: FONT, fontSize: 9, distance: 14 },
        pointer: { width: 4, length: '62%', itemStyle: { color: '#8fd0ff' } },
        anchor: { show: false },
        title: { show: true, offsetCenter: [0, '78%'], color: FONT, fontSize: 11 },
        detail: { valueAnimation: true, offsetCenter: [0, '8%'], fontSize: 26, color: '#d7dcea', formatter: '{value}' },
        data: [{ value: opt.value || 50, name: opt.name || '' }]
      }]
    }));
  }

  /* ---------------- 折线/曲线图（净值曲线、累计盈亏, 时间X轴） ---------------- */
  function line(id, opt) {
    opt = opt || {};
    var series = (opt.series || []).map(function (s, i) {
      var col = s.color || (i === 0 ? '#f0a020' : '#3d7bff');
      return {
        name: s.name || ('series' + i), type: 'line', showSymbol: false, smooth: true,
        data: s.data || [], connectNulls: true,
        lineStyle: { width: 2, color: col },
        itemStyle: { color: col },
        areaStyle: s.area === false ? null : { color: col + '22' },
        markLine: s.markLine || undefined
      };
    });
    return mount(id, Object.assign({}, BASE, {
      tooltip: { trigger: 'axis', axisPointer: { type: 'line' } },
      grid: { left: 8, right: 14, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'time',
        axisLabel: { color: FONT, fontSize: 10 },
        axisLine: { lineStyle: { color: '#26304a' } }
      },
      yAxis: {
        type: 'value', scale: true,
        axisLabel: { color: FONT, fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(38,48,74,.55)' } }
      },
      series: series
    }));
  }

  function resizeAll() {
    for (var k in instances) { try { instances[k].resize(); } catch (e) { } }
  }
  if (global.addEventListener) global.addEventListener('resize', resizeAll);

  global.Charts = { pie: pie, bar: bar, hist: hist, hbar: hbar, gauge: gauge, line: line, resizeAll: resizeAll };
})(typeof window !== 'undefined' ? window : globalThis);
