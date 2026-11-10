/* ============================================================================
 * web/js/chart/kit.js —— 【画图复用层】（ECharts 封装，所有板块共用）
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）：
 *   "多画图 画图的echarts源码是E:\apache-echarts 请分析并且画图 多画几种 要按需要画图"
 *   "每个板块都要好几种"  "同样的画图等都可以复用"  "饼图 柱状图都是这样"
 *
 * ★复用设计（一个组件画所有图，页面不重复写 option）：
 *   EKit.mount(el, 'bar',    data, opt)   柱状：涨跌排行 / 成交额排行
 *   EKit.mount(el, 'barH',   data, opt)   横向条：Top N 排行（名字长也不会挤）
 *   EKit.mount(el, 'barDual',data, opt)   双柱：主动买 vs 主动卖 对照
 *   EKit.mount(el, 'pie',    data, opt)   饼图：涨跌家数 / 板块占比
 *   EKit.mount(el, 'ring',   data, opt)   环形：买卖力量占比（中心可显示数字）
 *   EKit.mount(el, 'line',   data, opt)   折线：走势/累计
 *   EKit.mount(el, 'gauge',  data, opt)   仪表：情绪/强度
 *   EKit.mount(el, 'tree',   data, opt)   矩形树图：板块市值分布
 *
 * ★生命周期复用：每个容器只 init 一次，后续 setOption 更新（不重复 init，不泄漏）
 *   容器尺寸变化自动 resize（ResizeObserver）；销毁统一 dispose
 * ========================================================================== */
(function (global) {
  'use strict';

  var E = global.echarts;
  var INST = new Map();          // el → chart 实例（复用）
  var RO = null;

  // 涨红跌绿（中国惯例）
  var UP = '#f0334b', DN = '#0bbf7a', FLAT = '#8b94ad';
  var AXIS = '#8b94ad', GRID = 'rgba(139,148,173,.16)', TXT = '#e6ebf5';
  var PALETTE = ['#4f8cff', '#f0334b', '#0bbf7a', '#ffa726', '#ab6cf0', '#26c6da', '#ec407a', '#8d6e63'];

  function col(v) { return v > 0 ? UP : (v < 0 ? DN : FLAT); }
  function ensure(el) {
    if (!E) return null;
    var c = INST.get(el);
    if (c) return c;
    c = E.init(el, null, { renderer: 'canvas' });
    INST.set(el, c);
    return c;
  }
  function base() {
    return {
      backgroundColor: 'transparent',
      textStyle: { color: TXT, fontSize: 11, fontFamily: 'inherit' },
      grid: { left: 8, right: 12, top: 26, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis', confine: true,
        backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box',
        textStyle: { color: TXT, fontSize: 11 },
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(79,140,255,.08)' } }
      }
    };
  }
  function axisX(rotate) {
    return {
      type: 'category', data: [],
      axisLine: { lineStyle: { color: GRID } },
      axisTick: { show: false },
      axisLabel: { color: AXIS, fontSize: 10, interval: 0, rotate: rotate || 0, hideOverlap: true }
    };
  }
  function axisY(fmt) {
    return {
      type: 'value',
      splitLine: { lineStyle: { color: GRID } },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: AXIS, fontSize: 10, formatter: fmt || '{value}' }
    };
  }
  function leg(show) {
    return show === false ? null : {
      show: true, top: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: AXIS, fontSize: 10 }
    };
  }
  function short(n) {
    // 数字缩写：12345 → 1.2万 ；1.2e8 → 1.2亿
    n = +n || 0;
    var a = Math.abs(n);
    if (a >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (n / 1e4).toFixed(1) + '万';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(+n.toFixed(a < 1 ? 3 : 0));
  }

  /* ---------------- 各图表类型 ---------------- */
  var TYPES = {
    /* 柱状：data=[{name,value}] —— 正负自动红绿 */
    bar: function (d, o) {
      var names = d.map(function (x) { return x.name; });
      return {
        grid: { left: 8, right: 12, top: 26, bottom: 6, containLabel: true },
        xAxis: axisX(o.rotate), yAxis: axisY(o.fmt),
        series: [{
          type: 'bar', barMaxWidth: 22,
          itemStyle: {
            borderRadius: [3, 3, 0, 0],
            color: function (p) { return col(p.value); }
          },
          data: d.map(function (x) { return { value: x.value, name: x.name }; })
        }]
      };
    },

    /* 横向条：名字长也不挤，适合 Top 排行 */
    barH: function (d, o) {
      d = d.slice().sort(function (a, b) { return a.value - b.value; });
      return {
        grid: { left: 8, right: 46, top: 10, bottom: 6, containLabel: true },
        xAxis: axisY(o.fmt), yAxis: {
          type: 'category',
          data: d.map(function (x) { return x.name; }),
          axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false },
          axisLabel: { color: TXT, fontSize: 10 }
        },
        series: [{
          type: 'bar', barMaxWidth: 16,
          itemStyle: { borderRadius: [0, 3, 3, 0], color: o.color || '#4f8cff' },
          label: { show: true, position: 'right', color: AXIS, fontSize: 10, formatter: function (p) { return short(p.value); } },
          data: d.map(function (x) { return x.value; })
        }]
      };
    },

    /* 双柱：两组值对照（涨跌分布 / 分时对比 / 信号命中 复用） */
    barDual: function (d, o) {
      var names = d.map(function (x) { return x.name; });
      return {
        legend: leg(o.legend),
        grid: { left: 8, right: 12, top: 30, bottom: 6, containLabel: true },
        xAxis: axisX(o.rotate), yAxis: axisY(o.fmt),
        series: [
          { name: o.n1 || '主动买', type: 'bar', barMaxWidth: 16, itemStyle: { borderRadius: [3, 3, 0, 0], color: UP }, data: d.map(function (x) { return x.v1; }) },
          { name: o.n2 || '主动卖', type: 'bar', barMaxWidth: 16, itemStyle: { borderRadius: [3, 3, 0, 0], color: DN }, data: d.map(function (x) { return x.v2; }) }
        ]
      };
    },

    /* 饼图 */
    pie: function (d, o) {
      return {
        tooltip: { trigger: 'item', confine: true, backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box', textStyle: { color: TXT, fontSize: 11 } },
        legend: { show: true, bottom: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: AXIS, fontSize: 10 } },
        series: [{
          type: 'pie', radius: o.radius || ['0%', '66%'], center: ['50%', '46%'],
          itemStyle: { borderColor: 'rgba(16,20,32,.6)', borderWidth: 1 },
          label: { color: TXT, fontSize: 10, formatter: '{b}\n{c} ({d}%)' },
          labelLine: { length: 6, length2: 6, lineStyle: { color: GRID } },
          data: d.map(function (x, i) { return { name: x.name, value: x.value, itemStyle: { color: x.color || PALETTE[i % PALETTE.length] } }; })
        }]
      };
    },

    /* 环形：中心显示主数字（买卖力量/占比） */
    ring: function (d, o) {
      var main = d.length ? d[0] : { value: 0 };
      return {
        tooltip: { trigger: 'item', confine: true, backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box', textStyle: { color: TXT, fontSize: 11 } },
        series: [{
          type: 'pie', radius: ['58%', '78%'], center: ['50%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: { borderColor: 'rgba(16,20,32,.6)', borderWidth: 1 },
          label: {
            show: true, position: 'center', color: TXT,
            fontSize: 15, fontWeight: 600,
            formatter: o.center || (main.value.toFixed(1) + '%')
          },
          emphasis: { label: { show: true } },
          labelLine: { show: false },
          data: d.map(function (x, i) { return { name: x.name, value: x.value, itemStyle: { color: x.color || PALETTE[i % PALETTE.length] } }; })
        }]
      };
    },

    /* 折线 */
    line: function (d, o) {
      return {
        grid: { left: 8, right: 12, top: 26, bottom: 6, containLabel: true },
        xAxis: { type: 'category', data: d.map(function (x) { return x.name; }), boundaryGap: false, axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 10, hideOverlap: true } },
        yAxis: axisY(o.fmt),
        series: [{
          type: 'line', smooth: true, showSymbol: false,
          lineStyle: { width: 2, color: o.color || '#4f8cff' },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: (o.color || '#4f8cff') + '55' },
                { offset: 1, color: (o.color || '#4f8cff') + '00' }
              ]
            }
          },
          data: d.map(function (x) { return x.value; })
        }]
      };
    },

    /* 双轴双曲线：两条量纲不同的曲线放同一张图对比
     * data: [{name, x, y}]，x = 左轴值，y = 右轴值
     * opt: {n1, n2, xFmt, yFmt, color1, color2, labels}
     */
    lineDual: function (d, o) {
      var n1 = o.n1 || '左轴', n2 = o.n2 || '右轴';
      var labels = o.labels || null;
      return {
        legend: leg(o.legend),
        grid: { left: 8, right: 8, top: 30, bottom: 6, containLabel: true },
        tooltip: {
          trigger: 'axis', confine: true,
          backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box',
          textStyle: { color: TXT, fontSize: 11 },
          axisPointer: { type: 'cross', crossStyle: { color: 'rgba(139,148,173,.4)' } }
        },
        xAxis: {
          type: 'category', data: labels || [], boundaryGap: false,
          axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false },
          axisLabel: { color: AXIS, fontSize: 10, hideOverlap: true }
        },
        yAxis: [
          {
            type: 'value', name: n1, nameTextStyle: { color: AXIS, fontSize: 10 },
            splitLine: { lineStyle: { color: GRID } }, axisLine: { show: false }, axisTick: { show: false },
            axisLabel: { color: AXIS, fontSize: 10, formatter: o.xFmt || '{value}%' },
            // ★两轴都以 0 为中心 → 曲线形态可直接目视比较是否同向
            min: (o.xMin !== null && o.xMin !== undefined) ? o.xMin : undefined,
            max: (o.xMax !== null && o.xMax !== undefined) ? o.xMax : undefined,
            scale: o.xScale !== false
          },
          {
            type: 'value', name: n2, nameTextStyle: { color: AXIS, fontSize: 10 },
            splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false },
            axisLabel: { color: AXIS, fontSize: 10, formatter: o.yFmt || '{value}%' },
            scale: true
          }
        ],
        series: [
          {
            name: n1, type: 'bar', barMaxWidth: 8, yAxisIndex: 0,
            itemStyle: {
              borderRadius: [2, 2, 0, 0],
              color: function (p) { return col(p.value); }
            },
            // ★零轴基准线：柱子向上=涨(红) 向下=跌(绿)
            markLine: {
              silent: true, symbol: 'none',
              lineStyle: { color: 'rgba(139,148,173,.45)', width: 1, type: 'solid' },
              data: [{ yAxis: 0 }]
            },
            data: d.map(function (x) { return x.x; })
          },
          {
            name: n2, type: 'line', smooth: true, showSymbol: false, yAxisIndex: 1,
            lineStyle: { width: 2, color: c2 },
            areaStyle: {
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: c2 + '55' },
                  { offset: 1, color: c2 + '00' }
                ]
              }
            },
            data: d.map(function (x) { return x.y; })
          }
        ]
      };
    },

    /* 散点：两个变量的关系（板块买盘强弱 vs 涨跌幅 / 相关性散点）
     * data: [{name, x, y, size?}]  opt: {xName, yName, xFmt, yFmt, trend:true}
     * ★用户 2026-10-25 第四轮: "要求核实涨跌比例和takervol比例和涨跌幅度的关系" */
    scatter: function (d, o) {
      var pts = d.map(function (p) {
        return { name: p.name, value: [p.x, p.y], symbolSize: p.size || 8 };
      });
      var opt = {
        grid: { left: 8, right: 16, top: 30, bottom: 6, containLabel: true },
        tooltip: {
          trigger: 'item', confine: true,
          backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box',
          textStyle: { color: TXT, fontSize: 11 },
          formatter: function (p) {
            return p.name + '<br/>' + (o.xName || 'X') + ': ' + (+p.value[0]).toFixed(2) +
              '<br/>' + (o.yName || 'Y') + ': ' + (+p.value[1]).toFixed(2) + '%';
          }
        },
        xAxis: {
          type: 'value', name: o.xName || '', nameLocation: 'middle', nameGap: 26,
          nameTextStyle: { color: AXIS, fontSize: 10 },
          splitLine: { lineStyle: { color: GRID } }, axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: AXIS, fontSize: 10, formatter: o.xFmt || '{value}' }
        },
        yAxis: {
          type: 'value', name: o.yName || '', nameTextStyle: { color: AXIS, fontSize: 10 },
          splitLine: { lineStyle: { color: GRID } }, axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: AXIS, fontSize: 10, formatter: o.yFmt || '{value}%' }
        },
        series: [{
          type: 'scatter', data: pts,
          itemStyle: { color: function (p) { return col(p.value[1]); }, opacity: .78 },
          markLine: o.trend === false ? undefined : {
            silent: true, symbol: 'none',
            lineStyle: { color: '#f0a020', type: 'dashed', width: 1.5 },
            label: { color: '#f0a020', fontSize: 10, formatter: o.trendLabel || '趋势' },
            data: [{ type: 'average' }]
          }
        }]
      };
      return opt;
    },

    /* 热力图：板块 × 维度 的矩阵（涨跌 / 买比 / 超额）
     * data: [{x:[列名], y:[行名], v:[值]}] 或二维数组
     * opt: {xName, yName, visualMax, fmt} */
    heatmap: function (d, o) {
      var xs = o.xLabels || [], ys = o.yLabels || [];
      var data = [];
      d.forEach(function (row, ri) {
        (row.cells || []).forEach(function (c, ci) {
          data.push([ci, ri, c.v]);
        });
      });
      var max = 0, min = 0;
      data.forEach(function (p) { if (p[2] > max) max = p[2]; if (p[2] < min) min = p[2]; });
      return {
        grid: { left: 8, right: 16, top: 26, bottom: 6, containLabel: true },
        tooltip: {
          position: 'top', confine: true,
          backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box',
          textStyle: { color: TXT, fontSize: 11 },
          formatter: function (p) {
            return (ys[p.value[1]] || '') + ' × ' + (xs[p.value[0]] || '') + '<br/>值: ' + p.value[2];
          }
        },
        xAxis: {
          type: 'category', data: xs, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,.02)', 'transparent'] } },
          axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false },
          axisLabel: { color: AXIS, fontSize: 10, rotate: o.rotate || 0 }
        },
        yAxis: {
          type: 'category', data: ys, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,.02)', 'transparent'] } },
          axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false },
          axisLabel: { color: TXT, fontSize: 10 }
        },
        visualMap: {
          min: min, max: max, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
          itemHeight: 80, itemWidth: 12,
          textStyle: { color: AXIS, fontSize: 10 },
          inRange: { color: ['#0bbf7a', '#3d7bff', '#f0a020', '#f0334b'] }
        },
        series: [{
          type: 'heatmap', data: data,
          label: { show: true, color: '#fff', fontSize: 10, formatter: function (p) { return o.fmt ? o.fmt(p.value[2]) : p.value[2]; } },
          itemStyle: { borderColor: 'rgba(16,20,32,.6)', borderWidth: 1 },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,.5)' } }
        }]
      };
    },

    /* 雷达：板块多维画像（涨跌/买比/成交额/情绪/合约数）
     * data: [{name, value:[...]}]  opt: {indicators:[{name,max}]} */
    radar: function (d, o) {
      var ind = o.indicators || [];
      return {
        tooltip: { confine: true, backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box', textStyle: { color: TXT, fontSize: 11 } },
        legend: leg(o.legend),
        radar: {
          indicator: ind,
          center: ['50%', '55%'], radius: '62%',
          axisName: { color: AXIS, fontSize: 10 },
          splitLine: { lineStyle: { color: GRID } },
          splitArea: { areaStyle: { color: ['rgba(255,255,255,.015)', 'transparent'] } },
          axisLine: { lineStyle: { color: GRID } }
        },
        series: [{
          type: 'radar', data: d,
          symbolSize: 4,
          lineStyle: { width: 2 },
          areaStyle: { opacity: .18 }
        }]
      };
    },

    /* K线（OHLC）
     * data: [{ id, o, h, l, c, v, name }]   opt: {kName, volName}
     * ★2026-10-26: 支持 dataZoom 平移缩放
     *   o.zoomRoots=N → 默认只显示最近 N 根，向左拖动/滚轮显示更早历史（OKX K线体验）
     *   需要自定义悬浮窗时用 opt.tip；顶部可选 title】
     *
     * ★用户 2026-10-25 第四轮: "根据takervol ... 做成K线涨跌 画成曲线"
     * ★用户 2026-10-26: "K线要求放大到和OKX选项卡里面的K线图一样大
     *   只显示最近100根K线 左移动才显示更远的历史K线和信号"  → 增加 dataZoom */
    candle: function (d, o) {
      var cats = d.map(function (x) { return x.name; });
      var kd = d.map(function (x) { return [x.o, x.c, x.l, x.h]; });
      var vd = d.map(function (x) { return x.v; });
      var tipFn = o.tip;
      var N = d.length;
      /* ★默认显示最近 zoomRoots 根（left 平移可看更早） */
      var zoomRoots = (o.zoomRoots === null || o.zoomRoots === undefined) ? 100 : +o.zoomRoots;
      var zs = Math.max(0, Math.min(100, (N - zoomRoots) / N * 100));   // dataZoom start(百分比)
      if (!isFinite(zs) || zs < 0) zs = N ? 0 : 100;
      if (o.noZoom) zs = 0;
      var dz = o.noZoom ? undefined : [
        { type: 'inside', start: zs, end: 100, xAxisIndex: [0, 1] },
        {
          type: 'slider', start: zs, end: 100, height: 16, bottom: 6,
          xAxisIndex: [0, 1], dataBackground: { lineStyle: { color: 'rgba(139,148,173,.25)' }, areaStyle: { color: 'rgba(139,148,173,.06)' } }
        }
      ];
      return {
        legend: leg(o.legend),
        grid: [
          { left: 8, right: 12, top: 26, height: o.kH || '52%', containLabel: true },
          { left: 8, right: 12, top: (o.kH || '52%') + 46, bottom: o.noZoom ? 6 : 30, containLabel: true }
        ],
        dataZoom: dz,
        tooltip: {
          trigger: 'axis', confine: true, axisPointer: { type: 'cross' },
          backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box',
          textStyle: { color: TXT, fontSize: 11 },
          /* ★自定义悬浮窗（共享组件 Tip.kline 用） */
          formatter: tipFn ? function (ps) {
            if (!ps || !ps.length) return '';
            var i = ps[0].dataIndex;
            var it = d[i] || {};
            /* ★try/catch 兜底（同 dualTip）：抛异常会让 tooltip 静默消失 */
            try {
              return tipFn({
                item: it, extra: it.extra || null,
                index: i, label: cats[i]
              });
            } catch (err) {
              if (global.__tipErrs) global.__tipErrs.push(String((err && err.stack) || err));
              if (global.console && console.warn) console.warn('[tip] kline formatter 异常:', err);
              return '<div style="color:#f0a020">数据渲染异常</div>';
            }
          } : undefined
        },
        xAxis: [
          { type: 'category', data: cats, gridIndex: 0, axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false }, axisLabel: { show: false } },
          { type: 'category', data: cats, gridIndex: 1, axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 10, hideOverlap: true } }
        ],
        yAxis: [
          { type: 'value', gridIndex: 0, scale: true, name: o.kName || '', nameTextStyle: { color: AXIS, fontSize: 10 }, splitLine: { lineStyle: { color: GRID } }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 10 } },
          { type: 'value', gridIndex: 1, scale: true, name: o.volName || '', nameTextStyle: { color: AXIS, fontSize: 10 }, splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 10 } }
        ],
        series: [
          {
            type: 'candlestick', data: kd, xAxisIndex: 0, yAxisIndex: 0,
            /* ★支持 markPoint（标记买入点等关键位置） */
            markPoint: o.markPoint || undefined,
            itemStyle: {
              color: UP, color0: DN,            // 涨=红(实心) 跌=绿(空心) —— 中国惯例
              borderColor: UP, borderColor0: DN
            }
          },
          {
            type: 'bar', data: vd, xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 8,
            itemStyle: { color: function (p) { return col(p.value); } }
          }
        ]
      };
    },

    /* 旭日图：板块层级分布（比 treemap 更直观）
     * data: [{name, value, children:[{name, value}]}] */
    sunburst: function (d, o) {
      return {
        tooltip: {
          confine: true, backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box',
          textStyle: { color: TXT, fontSize: 11 },
          formatter: function (p) { return p.name + ': ' + p.value; }
        },
        series: [{
          type: 'sunburst',
          radius: [o.inner || '18%', '88%'],
          center: ['50%', '52%'],
          data: d,
          itemStyle: { borderColor: 'rgba(16,20,32,.7)', borderWidth: 1, gapWidth: 1 },
          label: { color: '#fff', fontSize: 10, rotate: 'radial' },
          levels: [
            { itemStyle: { borderWidth: 2, borderColor: 'rgba(16,20,32,.6)' }, label: { rotate: 'radial', fontSize: 11 } },
            { itemStyle: { borderWidth: 1, borderColor: 'rgba(16,20,32,.5)' }, label: { rotate: 'tangential', fontSize: 10 } }
          ]
        }]
      };
    },

    /* ★双 K 线对比（用户 2026-10-25 第五轮: "曲线和K线都开始双条跑"）
     *   上下并排两幅 K 线：上=基准(数字货币)，下=对比对象，横轴严格对齐
     *   data: {a:[{o,h,l,c,v,name}], b:[{...}], aName, bName}
     */
    candleDual: function (d, o) {
      var A = d.a || [], B = d.b || [];
      var L = Math.min(A.length, B.length);
      if (!L) return { series: [] };
      A = A.slice(-L); B = B.slice(-L);
      var cats = A.map(function (x) { return x.name || ''; });
      var kdA = A.map(function (x) { return [x.o, x.c, x.l, x.h]; });
      var kdB = B.map(function (x) { return [x.o, x.c, x.l, x.h]; });
      var vdA = A.map(function (x) { return x.v; });
      var vdB = B.map(function (x) { return x.v; });
      function gridItem(top, height) {
        return { left: 8, right: 12, top: top, height: height, containLabel: true };
      }
      var h1 = o.h || '38%';
      var h2 = o.h2 || '34%';
      return {
        legend: {
          show: true, top: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: AXIS, fontSize: 10 },
          data: [d.aName || '基准', d.bName || '对比']
        },
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        tooltip: {
          trigger: 'axis', confine: true, axisPointer: { type: 'cross' },
          backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box',
          textStyle: { color: TXT, fontSize: 11 }
        },
        grid: [gridItem(26, h1), gridItem('46%', h2)],
        xAxis: [
          { type: 'category', data: cats, gridIndex: 0, boundaryGap: true, axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false }, axisLabel: { show: false }, axisPointer: { label: { show: false } } },
          { type: 'category', data: cats, gridIndex: 1, boundaryGap: true, axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 10, hideOverlap: true }, axisPointer: { label: { show: false } } }
        ],
        yAxis: [
          { type: 'value', gridIndex: 0, scale: true, name: d.aName || '基准', nameTextStyle: { color: AXIS, fontSize: 10 }, splitLine: { lineStyle: { color: GRID } }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 10 } },
          { type: 'value', gridIndex: 1, scale: true, name: d.bName || '对比', nameTextStyle: { color: AXIS, fontSize: 10 }, splitLine: { lineStyle: { color: GRID } }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 10 } }
        ],
        series: [
          { name: d.aName || '基准', type: 'candlestick', data: kdA, xAxisIndex: 0, yAxisIndex: 0, itemStyle: { color: UP, color0: DN, borderColor: UP, borderColor0: DN } },
          { name: d.bName || '对比', type: 'candlestick', data: kdB, xAxisIndex: 1, yAxisIndex: 1, itemStyle: { color: '#4f8cff', color0: '#2a4c8f', borderColor: '#4f8cff', borderColor0: '#2a4c8f' } },
          { name: (d.aName || '基准') + ' 量', type: 'bar', data: vdA, xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 6, itemStyle: { color: 'rgba(139,148,173,.28)' } },
          { name: (d.bName || '对比') + ' 量', type: 'bar', data: vdB, xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 6, itemStyle: { color: 'rgba(79,140,255,.32)' } }
        ]
      };
    },

    /* ★双序列对比曲线（用户 2026-10-25 第五轮: "曲线...都开始双条跑"）
     *   两条序列画在同一坐标系（同一量纲，如都是 %）
     *   data: {a:[{k,value,name}], b:[{k,value,name}], aName, bName, fmt}
     *   → 基准(数字货币) vs 对比对象，一眼看出谁强谁弱、是否同向
     */
    /* ★双轴双曲线 + 自定义悬浮窗 + 缩放条（2026-10-25 第六轮）
     *   用户需求："移动到K线或者曲线可以告诉我具体 哪个合约几点几分买的
     *              K线后面15分钟每隔5分钟的涨幅多少"
     *            "移动到哪个曲线位置就悬浮窗告诉我具体时间和涨跌幅"
     *   data: {a:[{label,value,extra}], b:[{label,value,extra}], c:[{label,value,extra}](可选第3条)}
     *   opt:  {n1, n2, n3(可选), xFmt, yFmt, tip(o) -> html, zoom:true, colorA, colorB, colorC,
     *          axisC(第3序列的yAxisIndex 0|1|2, 默认1与b同右轴), dashC}
     */
    dualTip: function (d, o) {
      var A = d.a || [], B = d.b || [], C = d.c || [];
      var hasC = C.length > 0;
      var L = hasC ? Math.min(A.length, B.length, C.length) : Math.min(A.length, B.length);
      if (!L) return { series: [] };
      A = A.slice(-L); B = B.slice(-L); if (hasC) C = C.slice(-L);
      var cats = A.map(function (x, i) { return (x.label || ((x.k !== null && x.k !== undefined) ? String(x.k) : String(i))); });
      var tipFn = o.tip;
      var dtC = d.cName || '第三曲线';
      var cAxis = (o.axisC === null || o.axisC === undefined) ? 1 : o.axisC;
      /* 第3序列独立轴(axisC=2)时才加第3条 yAxis */
      var yAxis = [
        {
          type: 'value', name: o.n1 || '左轴', nameTextStyle: { color: AXIS, fontSize: 10 },
          splitLine: { lineStyle: { color: GRID } }, axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: AXIS, fontSize: 10, formatter: o.xFmt || '{value}%' },
          scale: o.xScale !== false
        },
        {
          type: 'value', name: o.n2 || '右轴', nameTextStyle: { color: AXIS, fontSize: 10 },
          splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: AXIS, fontSize: 10, formatter: o.yFmt || '{value}%' },
          scale: true
        }
      ];
      if (hasC && cAxis === 2) {
        yAxis.push({
          type: 'value', name: o.n3 || dtC, nameTextStyle: { color: AXIS, fontSize: 10 },
          splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: AXIS, fontSize: 10, formatter: o.zFmt || '{value}' }, scale: true
        });
      }
      var series = [
        {
          name: d.aName || '左轴', type: 'line', smooth: true, showSymbol: false,
          yAxisIndex: 0,
          lineStyle: { width: 2, color: o.colorA || '#f0334b' },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: (o.colorA || '#f0334b') + '3a' }, { offset: 1, color: (o.colorA || '#f0334b') + '00' }]
            }
          },
          data: A.map(function (x) { return x.value; })
        },
        {
          name: d.bName || '右轴', type: 'line', smooth: true, showSymbol: false,
          yAxisIndex: 1,
          lineStyle: { width: 2, color: o.colorB || '#4f8cff' },
          data: B.map(function (x) { return x.value; })
        }
      ];
      if (hasC) {
        series.push({
          name: dtC, type: 'line', smooth: true, showSymbol: false, yAxisIndex: cAxis,
          lineStyle: { width: 2, color: o.colorC || '#f0a020', type: o.dashC ? 'dashed' : 'solid' },
          data: C.map(function (x) { return x.value; })
        });
      }
      var legendData = [d.aName || '左轴', d.bName || '右轴'];
      if (hasC) legendData.push(dtC);
      return {
        legend: {
          show: true, top: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: AXIS, fontSize: 10 },
          data: legendData
        },
        grid: { left: 8, right: 12, top: 30, bottom: o.zoom ? 46 : 8, containLabel: true },
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        tooltip: {
          trigger: 'axis', confine: true,
          axisPointer: { type: 'cross', crossStyle: { color: 'rgba(139,148,173,.45)' }, label: { backgroundColor: '#2a4c8f' } },
          backgroundColor: 'rgba(16,20,32,.96)', borderColor: 'rgba(139,148,173,.35)', className: 'tip-box',
          textStyle: { color: TXT, fontSize: 11 },
          formatter: function (ps) {
            if (!ps || !ps.length) return '';
            if (tipFn) {
              var i = ps[0].dataIndex;
              try {
                return tipFn({
                  a: A[i], b: B[i], c: hasC ? C[i] : null,
                  extra: (A[i] && A[i].extra) || (B[i] && B[i].extra) || (hasC && C[i] && C[i].extra) || null,
                  index: i, label: cats[i]
                });
              } catch (err) {
                if (global.__tipErrs) global.__tipErrs.push(String((err && err.stack) || err));
                if (global.console && console.warn) console.warn('[tip] formatter 异常:', err);
                return '<div style="color:#f0a020">数据渲染异常</div>';
              }
            }
            var out = '<div style="font-size:11px;color:#8b94ad;margin-bottom:3px">' + cats[ps[0].dataIndex] + '</div>';
            ps.forEach(function (p) {
              var v = p.value;
              var txt = (typeof v === 'number') ? (o.yFmt || '{value}').replace('{value}', v.toFixed(3)) : '-';
              out += '<div>' + p.marker + p.seriesName + ' <b>' + txt + '</b></div>';
            });
            return out;
          }
        },
        xAxis: {
          type: 'category', data: cats, boundaryGap: false,
          axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false },
          axisLabel: { color: AXIS, fontSize: 10, hideOverlap: true }
        },
        yAxis: yAxis,
        dataZoom: o.zoom ? [
          { type: 'inside', start: o.zoomStart || 0, end: 100 },
          {
            type: 'slider', height: 16, bottom: 8,
            start: o.zoomStart || 0, end: 100,
            borderColor: 'rgba(139,148,173,.25)', backgroundColor: 'rgba(20,26,40,.6)',
            fillerColor: 'rgba(61,123,255,.16)',
            handleStyle: { color: '#3d6bb5' },
            textStyle: { color: AXIS, fontSize: 9 },
            dataBackground: { lineStyle: { color: 'rgba(139,148,173,.4)' }, areaStyle: { color: 'rgba(139,148,173,.12)' } },
            selectedDataBackground: { lineStyle: { color: '#4f8cff' }, areaStyle: { color: 'rgba(79,140,255,.2)' } }
          }
        ] : undefined,
        series: series
      };
    },

    line2: function (d, o) {
      var A = d.a || [], B = d.b || [];
      var L = Math.min(A.length, B.length);
      if (!L) return { series: [] };
      A = A.slice(-L); B = B.slice(-L);
      var cats = A.map(function (x, i) { return (x.label || ((x.k !== null && x.k !== undefined) ? String(x.k) : String(i))); });
      return {
        legend: {
          show: true, top: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: AXIS, fontSize: 10 },
          data: [d.aName || '基准', d.bName || '对比']
        },
        grid: { left: 8, right: 12, top: 30, bottom: 6, containLabel: true },
        tooltip: {
          trigger: 'axis', confine: true, axisPointer: { type: 'cross' },
          backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box',
          textStyle: { color: TXT, fontSize: 11 }
        },
        xAxis: {
          type: 'category', data: cats, boundaryGap: false,
          axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false },
          axisLabel: { color: AXIS, fontSize: 10, hideOverlap: true }
        },
        yAxis: {
          type: 'value', scale: true,
          splitLine: { lineStyle: { color: GRID } }, axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: AXIS, fontSize: 10, formatter: o.fmt || '{value}%' }
        },
        series: [
          {
            name: d.aName || '基准', type: 'line', smooth: true, showSymbol: false,
            lineStyle: { width: 2, color: o.colorA || '#f0a020' },
            areaStyle: {
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [{ offset: 0, color: (o.colorA || '#f0a020') + '44' }, { offset: 1, color: (o.colorA || '#f0a020') + '00' }]
              }
            },
            data: A.map(function (x) { return x.value; })
          },
          {
            name: d.bName || '对比', type: 'line', smooth: true, showSymbol: false,
            lineStyle: { width: 2, color: o.colorB || '#4f8cff' },
            areaStyle: {
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [{ offset: 0, color: (o.colorB || '#4f8cff') + '44' }, { offset: 1, color: (o.colorB || '#4f8cff') + '00' }]
              }
            },
            data: B.map(function (x) { return x.value; })
          }
        ]
      };
    },

    /* 仪表：情绪/强度 0~100 */
    gauge: function (d, o) {
      var v = d && d.length ? d[0].value : (o.value || 50);
      return {
        series: [{
          type: 'gauge', min: 0, max: 100, startAngle: 200, endAngle: -20,
          radius: '92%', center: ['50%', '62%'],
          progress: { show: true, width: 10, roundCap: true, itemStyle: { color: col(v - 50) } },
          axisLine: { lineStyle: { width: 10, color: [[1, 'rgba(139,148,173,.18)']] } },
          axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
          pointer: { show: false },
          detail: { valueAnimation: true, offsetCenter: [0, 0], fontSize: 20, fontWeight: 600, color: col(v - 50), formatter: '{value}' },
          title: { show: !!o.title, offsetCenter: [0, '32%'], color: AXIS, fontSize: 10 },
          data: [{ value: v, name: o.title || '' }]
        }]
      };
    },

    /* 矩形树图：板块分布 */
    tree: function (d, o) {
      return {
        tooltip: { confine: true, backgroundColor: 'rgba(16,20,32,.94)', borderColor: 'rgba(139,148,173,.3)', className: 'tip-box', textStyle: { color: TXT, fontSize: 11 } },
        series: [{
          type: 'treemap', roam: false, nodeClick: false,
          breadcrumb: { show: false },
          width: '100%', height: '100%',
          label: { show: true, color: '#fff', fontSize: 10, formatter: '{b}\n{c}' },
          itemStyle: { borderColor: 'rgba(16,20,32,.6)', borderWidth: 1, gapWidth: 1 },
          data: d.map(function (x, i) { return { name: x.name, value: x.value, itemStyle: { color: x.color || PALETTE[i % PALETTE.length] } }; })
        }]
      };
    }
  };

  /* ---------------- 对外 ---------------- */
  // mount(el, type, data, opt) —— 复用实例，只 setOption
  function mount(el, type, data, opt) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return null;
    var c = ensure(el);
    if (!c) return null;
    var fn = TYPES[type] || TYPES.bar;
    var part = fn(data || [], opt || {});
    var o = base();
    Object.keys(part).forEach(function (k) { o[k] = part[k]; });
    if (opt && opt.title) {
      o.title = { text: opt.title, left: 0, top: 0, textStyle: { color: TXT, fontSize: 12, fontWeight: 600 } };
      o.grid = Object.assign({}, o.grid, { top: 34 });
    }
    c.setOption(o, true);
    watch(el);
    return c;
  }

  // 自适应（共用一份 ResizeObserver，不重复创建）
  function watch(el) {
    if (!global.ResizeObserver) return;
    if (!RO) {
      RO = new global.ResizeObserver(function (entries) {
        entries.forEach(function (e) {
          var c = INST.get(e.target);
          if (c) { try { c.resize(); } catch (err) { } }
        });
      });
    }
    RO.observe(el);
  }
  function resize(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    var c = INST.get(el); if (c) { try { c.resize(); } catch (e) { } }
  }
  function dispose(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    var c = INST.get(el);
    if (c) { try { c.dispose(); } catch (e) { } INST.delete(el); }
  }
  function inst(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    return INST.get(el) || null;
  }

  global.EKit = {
    mount: mount, resize: resize, dispose: dispose, inst: inst,
    types: Object.keys(TYPES), UP: UP, DN: DN, PALETTE: PALETTE, short: short, col: col
  };
})(typeof window !== 'undefined' ? window : globalThis);
