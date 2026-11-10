/* ============================================================================
 * web/js/svc/download.js —— 【下载服务】（分层：服务层，与 UI/画图/取数分离）
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）："js 每个计算 画图 下载 搜索 都分类 分层架构做好 做到复用"
 *
 * 职责单一：把任意二维数据 / 榜单数据 导出为 CSV / JSON / 图片，供任何页面复用。
 *   Dl.csv(rows, cols, name)        表格 → CSV（带 BOM，Excel 打开中文不乱码）
 *   Dl.json(data, name)             任意对象 → JSON
 *   Dl.image(el, name)              图表容器 → PNG（复用 ECharts getDataURL）
 *   Dl.board(kind, sector, name)    ★直接下载某个榜单（内部走 Net 取数）
 * ========================================================================== */
(function (global) {
  'use strict';
  var Net = global.Net;

  // 触发浏览器下载（不依赖任何库）
  function save(blob, name) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }
  // CSV 单元格转义（含逗号/引号/换行都要包起来）
  function cell(v) {
    var s = String((v === null || v === undefined) ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* rows:[{a,b}]  cols:[['a','列1'],['b','列2']] 或 ['a','b']（简写=键名即列名） */
  function csv(rows, cols, name) {
    cols = (cols || (rows && rows.length ? Object.keys(rows[0]) : [])).map(function (c) {
      return Array.isArray(c) ? c : [c, c];
    });
    var lines = [cols.map(function (c) { return cell(c[1]); }).join(',')];
    (rows || []).forEach(function (r) {
      lines.push(cols.map(function (c) { return cell(r[c[0]]); }).join(','));
    });
    // ★BOM: 否则 Excel 打开中文是乱码
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    save(blob, (name || 'export') + '_' + stamp() + '.csv');
  }

  function json(data, name) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    save(blob, (name || 'export') + '_' + stamp() + '.json');
  }

  /* 图表存图：复用 EKit 实例，不重复 init */
  function image(el, name) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    var c = global.EKit && global.EKit.inst(el);
    var url = c ? c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#101420' }) : null;
    if (!url) return;
    var a = document.createElement('a');
    a.href = url; a.download = (name || 'chart') + '_' + stamp() + '.png';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); }, 200);
  }

  /* ★直接导出某个榜单（页面无需自己取数） */
  function board(kind, sector, name) {
    var url = '/api/boards/board?kind=' + encodeURIComponent(kind) +
      '&sector=' + encodeURIComponent(sector || '') + '&limit=100';
    return Net.get(url, { ttl: 3000 }).then(function (j) {
      if (!j || !j.ok) return;
      var rows = (j.gain || []).map(function (x, i) {
        return { rank: i + 1, type: '涨幅', name: x.name, sym: x.sym, px: x.pxText, pct: x.pctText };
      }).concat((j.lose || []).map(function (x, i) {
        return { rank: i + 1, type: '跌幅', name: x.name, sym: x.sym, px: x.pxText, pct: x.pctText };
      }));
      csv(rows, [['type', '榜别'], ['rank', '名次'], ['name', '名称'], ['sym', '代码'], ['px', '价格'], ['pct', '涨跌幅']],
        name || (kind + '_' + (sector || 'all')));
    });
  }

  global.Dl = { csv: csv, json: json, image: image, board: board, save: save, stamp: stamp };
})(typeof window !== 'undefined' ? window : globalThis);
