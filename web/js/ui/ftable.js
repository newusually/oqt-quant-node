/* ftable.js — ★统一表格组件（2026-11-11p）
 * 用户要求：所有 AI 表格 / 总结详情表格 / 条目多的表格 / 总览下方表格，
 *   统一为「交易列表」表格样式，做成独立组件共享，不要各写各的。
 * 视觉基准 = 金字塔面板交易列表：多彩列头 + 单元格同色淡底 + 整行 hover 高亮
 *   + sticky 表头 + 深色滚动容器 + 统一分页条（含每页条数选择）。
 * 独立组件：不依赖面板作用域，面板内 / 弹窗内 / 任何页面均可使用。
 *
 * 用法:
 *   FTable.render(hostEl, cfg)   // 渲染进宿主元素 + 绑定分页回调（推荐）
 *   FTable.html(cfg)             // 仅返回 HTML 字符串（弹窗等无宿主场景）
 *
 * cfg = {
 *   cols: [{label, align:'l'|'c'|'r'(默认r), w:'90px', wrap:true(该列允许换行)}],
 *   rows: [{cls:'', attrs:'', cells:[html,...]}] 或直接 [[cell,...], ...],
 *   foot: 同 rows（合计行，自动加 ftbl-sum 类）,
 *   empty: '暂无数据', maxH: 460(滚动区最大高, 0=不限),
 *   pager: {page, pages, total, unit:'条', per, perOpts:[10,20,50], onPage(p), onPer(v)}
 * }
 */
(function (global) {
  'use strict';
  var CSS_IN = false;
  /* 与面板交易列表同一套列配色板 */
  var PALETTE = [
    { bg: '#27406e', fg: '#eaf2ff', cell: 'rgba(39,64,110,.20)' },
    { bg: '#5b3a78', fg: '#f3e6ff', cell: 'rgba(91,58,120,.20)' },
    { bg: '#1f5f52', fg: '#d9fff2', cell: 'rgba(31,95,82,.20)' },
    { bg: '#7a4a1f', fg: '#ffe9d2', cell: 'rgba(122,74,31,.20)' },
    { bg: '#7a1f49', fg: '#ffd9ec', cell: 'rgba(122,31,73,.20)' },
    { bg: '#1f5a78', fg: '#d6f3ff', cell: 'rgba(31,90,120,.20)' },
    { bg: '#4f6b1f', fg: '#eeffd6', cell: 'rgba(79,107,31,.20)' },
    { bg: '#6b5a1f', fg: '#fff6d6', cell: 'rgba(107,90,31,.20)' },
    { bg: '#3a6b1f', fg: '#ecffd6', cell: 'rgba(58,107,31,.20)' },
    { bg: '#1f467a', fg: '#d6e6ff', cell: 'rgba(31,70,122,.20)' },
    { bg: '#7a2626', fg: '#ffd6d6', cell: 'rgba(122,38,38,.20)' },
    { bg: '#1f6b4a', fg: '#d6ffea', cell: 'rgba(31,107,74,.20)' }
  ];
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function ensureCss() {
    if (CSS_IN || !document || !document.head) return; CSS_IN = true;
    var st = document.createElement('style');
    st.setAttribute('data-ftable', '1');
    st.textContent =
      /* 滚动容器（交易列表同款深底 + 边框 + 圆角） */
      '.ftbl-wrap{overflow:auto;border:1px solid #263553;border-radius:8px;background:#0c1729;margin-bottom:6px;isolation:isolate}' +
      /* 表格本体 = 交易列表样式 */
      'table.ftbl{width:100%;border-collapse:collapse;font-size:11.5px}' +
      '.ftbl thead th{background:#1b2a45;color:#a9c2ee;text-align:right;padding:6px 9px;position:sticky;top:0;white-space:nowrap;z-index:1;font-weight:700}' +
      '.ftbl td{text-align:right;padding:5px 9px;border-top:1px solid #22314e;white-space:nowrap;color:#dbe6ff}' +
      '.ftbl thead th.aL{text-align:left}.ftbl thead th.aC{text-align:center}' +
      '.ftbl td.aL{text-align:left}.ftbl td.aC{text-align:center}' +
      '.ftbl td.aW{white-space:normal;line-height:1.6;word-break:break-word;min-width:160px}' +
      '.ftbl tbody tr.ftbl-row{transition:background .12s}' +
      '.ftbl tbody tr.ftbl-row:hover td{background:#27406e!important;color:#fff}' +
      '.ftbl td.ftbl-empty{text-align:center;color:#8b94ad;padding:22px;white-space:normal}' +
      /* 合计行 */
      '.ftbl tr.ftbl-sum td{font-weight:800;background:#13203a!important;border-top:2px solid #33507e;color:#dbe8ff}' +
      /* 分页条（与交易列表 .pg 同款视觉，独立类名避免耦合） */
      '.ftbl-pager{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}' +
      '.ftbl-pg{padding:4px 10px;border:1px solid #2b3f63;border-radius:6px;background:#16233b;color:#a9c2ee;cursor:pointer;font-size:12px;user-select:none;font-family:inherit}' +
      '.ftbl-pg:hover{border-color:#3d7bff}' +
      '.ftbl-pg.on{background:#3d7bff;border-color:#3d7bff;color:#fff;font-weight:700}' +
      '.ftbl-pg.dis{opacity:.4;cursor:default}' +
      '.ftbl-info{color:#a9bcda;font-size:11.5px;white-space:nowrap;padding:0 6px}' +
      '.ftbl-per{background:#16233b;color:#a9c2ee;border:1px solid #2b3f63;border-radius:6px;padding:3px 6px;font-size:11.5px;cursor:pointer;font-family:inherit}' +
      '.ftbl-per:hover{border-color:#3d7bff}' +
      /* 单元格内常用元素（涨跌色 / 高亮 / 状态 / 代码块 / 等宽字体 / 合约链接） */
      '.ftbl .up{color:#ff6b7d;font-weight:600}.ftbl .dn{color:#31c99a;font-weight:600}.ftbl .flat{color:#8b94ad}' +
      '.ftbl .hl-red{color:#ff5b6e;font-weight:800;background:rgba(255,91,110,.13);padding:0 3px;border-radius:3px}' +
      '.ftbl .hl-warn{color:#ffc46b;font-weight:800}' +
      '.ftbl .st-ok{color:#7ce2a8;font-weight:800}.ftbl .st-bad{color:#ff9a9a;font-weight:800}' +
      '.ftbl .st-skip{color:#ffcf8a;font-weight:800}.ftbl .st-note{color:#8b9abc}' +
      '.ftbl .mono{font-family:Consolas,Menlo,monospace;font-size:10px;color:#8fb0e8}' +
      '.ftbl .inst{color:#7fb1ff;text-decoration:underline dotted;cursor:pointer}' +
      '.ftbl .ev-why{color:#a9bcda;font-size:10.5px}' +
      '.ftbl .cf{font-family:Consolas,Menlo,monospace;font-size:10px;color:#7fb1ff;word-break:break-all;margin-top:2px}' +
      '.ftbl .cd{color:#a9bcda;margin-top:2px;font-size:11px}' +
      '.ftbl .cm{white-space:normal;color:#8b9abc;font-size:10px;max-width:110px}' +
      '.ftbl pre.ai-codeblock{display:block;background:#0a1424;border:1px solid #2a3f63;border-radius:6px;padding:7px 10px;margin:4px 0 0;' +
      'font-family:Consolas,Menlo,monospace;font-size:10.5px;color:#9fe0c0;white-space:pre-wrap;word-break:break-all;line-height:1.55;max-height:190px;overflow:auto;text-align:left}';
    document.head.appendChild(st);
  }
  function alignCls(c) {
    return c.align === 'l' ? 'aL' : (c.align === 'c' ? 'aC' : '');
  }
  function normCells(r) {
    return Array.isArray(r) ? r : (r.cells || []);
  }
  function rowsHtml(rows, cols, isFoot) {
    var h = '';
    for (var r = 0; r < (rows || []).length; r++) {
      var row = rows[r];
      var cells = normCells(row);
      var attrs = (!Array.isArray(row) && row.attrs) ? ' ' + row.attrs : '';
      var cls = (!Array.isArray(row) && row.cls) ? row.cls : '';
      h += '<tr class="' + cls + (isFoot ? (cls ? ' ' : '') + 'ftbl-sum' : (cls ? '' : '') + ' ftbl-row') + '"' + attrs + '>';
      for (var c = 0; c < cols.length; c++) {
        var col = cols[c];
        var pc = PALETTE[c % PALETTE.length];
        var cl = alignCls(col) + (col.wrap ? ' aW' : '');
        var ta = 'text-align:' + (col.align === 'l' ? 'left' : col.align === 'c' ? 'center' : 'right');
        var v = (cells[c] != null && cells[c] !== '') ? cells[c] : '—';
        h += '<td class="' + cl + '"' +
          (isFoot ? ' style="' + ta + '"' : ' style="' + ta + ';background:' + pc.cell + '"') + '>' + v + '</td>';
      }
      h += '</tr>';
    }
    return h;
  }
  function pagerHtml(pg) {
    if (!pg) return '';
    var page = Math.max(1, pg.page || 1), pages = Math.max(1, pg.pages || 1);
    var h = '<div class="ftbl-pager">' +
      '<button type="button" class="ftbl-pg' + (page <= 1 ? ' dis' : '') + '" data-ftpg="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>« 上一页</button>' +
      '<span class="ftbl-info">第 ' + page + ' / ' + pages + ' 页 · 共 ' + esc(pg.total != null ? pg.total : pages) + ' ' + esc(pg.unit || '条') + '</span>' +
      '<button type="button" class="ftbl-pg' + (page >= pages ? ' dis' : '') + '" data-ftpg="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>下一页 »</button>';
    if (pg.perOpts && pg.perOpts.length) {
      h += '<select class="ftbl-per">' + pg.perOpts.map(function (p) {
        return '<option value="' + p + '"' + (p === (pg.per || p) ? ' selected' : '') + '>' + p + '/页</option>';
      }).join('') + '</select>';
    }
    h += '</div>';
    return h;
  }
  /* 核心：返回完整 HTML（多彩列头 / 淡色单元格全部内联配色，无需二次 paint） */
  function html(cfg) {
    ensureCss();
    cfg = cfg || {};
    var cols = cfg.cols || [];
    var h = '<div class="ftbl-wrap"' + (cfg.maxH ? ' style="max-height:' + (+cfg.maxH) + 'px"' : '') + '><table class="ftbl"><thead><tr>';
    for (var c = 0; c < cols.length; c++) {
      var col = cols[c];
      var pc = PALETTE[c % PALETTE.length];
      var ta = 'text-align:' + (col.align === 'l' ? 'left' : col.align === 'c' ? 'center' : 'right');
      h += '<th class="' + alignCls(col) + '" style="background:' + pc.bg + ';color:' + pc.fg + ';' + ta + ';' + (col.w ? 'width:' + col.w + ';' : '') + '">' + col.label + '</th>';
    }
    h += '</tr></thead><tbody>';
    if (!(cfg.rows || []).length) {
      h += '<tr><td class="ftbl-empty" colspan="' + cols.length + '">' + esc(cfg.empty || '暂无数据') + '</td></tr>';
    } else {
      h += rowsHtml(cfg.rows, cols, false);
    }
    h += '</tbody>';
    if (cfg.foot && cfg.foot.length) h += '<tfoot>' + rowsHtml(cfg.foot, cols, true) + '</tfoot>';
    h += '</table></div>';
    h += pagerHtml(cfg.pager);
    return h;
  }
  /* 渲染进宿主 + 绑定分页回调（分页按钮用事件监听，随每次渲染重建） */
  function render(host, cfg) {
    if (!host) return null;
    host.innerHTML = html(cfg);
    var pg = cfg && cfg.pager;
    if (pg) {
      var page = pg.page || 1, pages = pg.pages || 1;
      host.querySelectorAll('button[data-ftpg]').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = parseInt(b.getAttribute('data-ftpg'), 10);
          if (isNaN(p) || p < 1 || p > pages || p === page) return;
          if (pg.onPage) pg.onPage(p);
        });
      });
      var sel = host.querySelector('select.ftbl-per');
      if (sel) sel.addEventListener('change', function () {
        if (pg.onPer) pg.onPer(+sel.value);
      });
    }
    return host.querySelector('table.ftbl');
  }
  /* 客户端分页切片工具（各表格共用，避免重复实现） */
  function slice(rows, page, per) {
    rows = rows || [];
    var pages = Math.max(1, Math.ceil(rows.length / per));
    page = Math.max(1, Math.min(page || 1, pages));
    return { slice: rows.slice((page - 1) * per, (page - 1) * per + per), pages: pages, page: page };
  }
  global.FTable = {
    html: html,
    render: render,
    slice: slice,
    esc: esc,
    palette: PALETTE
  };
})(typeof window !== 'undefined' ? window : globalThis);
