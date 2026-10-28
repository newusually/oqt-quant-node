/* ★2026-10-28 DetailTable —— 唯一明细表组件（用户要求: 所有分时详细表格 + 回测共用一个组件, 不要乱搞）
 *  职责: 表头/表体/空态/统计脚行(tfoot)/分页条/页码信息 的统一渲染。
 *  使用方:
 *    ① web/js/ui/updown.js  详细表格(所有分时, 服务端分页 + SSE 实时顶行 tipFn)
 *    ② web/js/ui/updown.js  连续涨跌信号·分时明细表(客户端分页)
 *    ③ web/js/ui/updown.js  BTC 买卖信号回测表(客户端分页 + tfoot 统计)
 *  设计:
 *    - 列由 cols 配置驱动: {label, cls, key, text(row,i,tip), cell(row,i,tip)}
 *        cell 优先(返回完整 <td>..</td>) > text(返回文本, 组件包 <td>) > row[key] 取值。
 *    - 分页双模式: mode='client'(默认, 全量本地切片) | 'server'(调用方已按页切好, rows=当前页, total=总行数)。
 *    - SSE 实时顶行: cfg.tipFn(slice, tip) -> 新 slice; patchTip(tip) 只替换表格本体(不闪信息行/分页条)。
 *    - 翻页: cfg.onPage(p) 外部取数(服务端模式); 缺省本地翻页重绘。
 *  静态工具: DetailTable.esc / pct / nv / signCls / td / pageBtns —— 各表格不再自带实现。
 */
(function (global) {
  'use strict';

  function esc(x) {
    if (x === null || x === undefined) return '';
    return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function nv(x) { return (x === null || x === undefined) ? '-' : x; }
  /* 带符号百分比: +12.34% / -5.00% / -（空值安全） */
  function pct(v, dg) {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return (v > 0 ? '+' : '') + v.toFixed(dg === undefined ? 2 : dg) + '%';
  }
  /* 涨跌色类: v>=0 红(涨) / <0 绿(跌)（中国市场惯例）; 空值无类 */
  function signCls(v) {
    return (v === null || v === undefined || isNaN(v)) ? '' : (v >= 0 ? 'num-up' : 'num-dn');
  }
  function td(content, cls) { return '<td class="' + (cls || 'num') + '">' + content + '</td>'; }

  /* 分页按钮条（唯一实现; 数据属性 data-<prefix>=页码, 由 bindPager/使用方处理点击） */
  function pageBtns(pages, cur, prefix) {
    cur = cur || 1;
    var s = '', i, win = 8;
    function pb(num, label, dis, act) {
      return '<button class="tbl-pg-btn' + (act ? ' on' : '') + '" data-' + prefix + '="' + num + '"' + (dis ? ' disabled' : '') + '>' + label + '</button>';
    }
    s += pb(1, '«', cur <= 1, false);
    s += pb((cur - 1) || 1, '‹', cur <= 1, false);
    var lo = Math.max(1, cur - win), hi = Math.min(pages, cur + win);
    for (i = lo; i <= hi; i++) s += pb(i, i, false, i === cur);
    s += pb(Math.min(cur + 1, pages), '›', cur >= pages, false);
    s += pb(pages, '»', cur >= pages, false);
    return s;
  }

  /* ================== DetailTable 组件本体 ==================
   * cfg = {
   *   cols: [{label, cls, key, text(row,i,tip), cell(row,i,tip)}],
   *   mode: 'client'(默认) | 'server',
   *   pageSize: 10,
   *   total: 服务端模式总行数(可后补 setData),
   *   page: 初始页(默认 1),
   *   emptyText: '无数据', tableClass: 'ud-excel',
   *   onPage: function(p),        // 翻页回调(服务端取数); 缺省本地翻页重绘
   *   tipFn: function(slice, tip) // SSE 实时顶行注入钩子(可选)
   * }
   */
  function DetailTable(cfg) {
    this.cfg = cfg || {};
    this.cols = this.cfg.cols || [];
    this.rows = this.cfg.rows || [];
    this.total = (this.cfg.total !== undefined) ? this.cfg.total : this.rows.length;
    this.page = this.cfg.page || 1;
    this._tip = null;
    this._host = null;
    this._opts = null;
    this._tableEl = null;
  }

  DetailTable.prototype.pageSize = function () { return this.cfg.pageSize || 10; };
  DetailTable.prototype.pages = function () {
    var n = (this.cfg.mode === 'server') ? this.total : this.rows.length;
    return Math.max(1, Math.ceil(n / this.pageSize()));
  };
  /* 当前页可见行 —— client 本地切片 / server 直接用调用方切片 */
  DetailTable.prototype.slice = function () {
    if (this.cfg.mode === 'server') return this.rows || [];
    var ps = this.pageSize();
    var p = Math.max(1, Math.min(this.page, this.pages()));
    return (this.rows || []).slice((p - 1) * ps, (p - 1) * ps + ps);
  };
  /* rows: 当前页行(server) 或 全量行(client); total: server 总行数; page: 跳页 */
  DetailTable.prototype.setData = function (rows, total, page) {
    this.rows = rows || [];
    if (total !== undefined) this.total = total;
    else if (this.cfg.mode !== 'server') this.total = this.rows.length;
    if (page !== undefined) this.page = page;
    this.page = Math.max(1, Math.min(this.page, this.pages()));
    this._tip = null;
    return this;
  };
  DetailTable.prototype.setPage = function (p) {
    p = Math.max(1, Math.min(this.pages(), p || 1));
    if (p === this.page && !this.cfg.onPage) return this;
    this.page = p;
    if (this.cfg.onPage) this.cfg.onPage(p);
    else if (this._host) this.render(this._host, this._opts);
    return this;
  };
  /* 绑定分页条容器点击(data-<prefix>=页码); prefix 如 'tp'/'sp'/'spage' */
  DetailTable.prototype.bindPager = function (el, prefix, onPage) {
    if (!el) return this;
    var self = this;
    el.onclick = function (e) {
      var t = e.target;
      if (t && t.dataset && t.dataset[prefix] !== undefined && t.dataset[prefix] !== '') {
        var p = parseInt(t.dataset[prefix], 10);
        if (!isNaN(p)) {
          if (onPage) onPage(p);
          else self.setPage(p);
        }
      }
    };
    return this;
  };
  DetailTable.prototype.pagerHTML = function (prefix, extras) {
    return (extras || '') + pageBtns(this.pages(), this.page, prefix);
  };
  /* 页码信息行: 第 x / y 页 · 共 n <unit> */
  DetailTable.prototype.infoHTML = function (unit) {
    return '第 <b>' + this.page + '</b> / <b>' + this.pages() + '</b> 页 · 共 <b>' + ((this.cfg.mode === 'server') ? this.total : this.rows.length) + '</b> ' + (unit || '条');
  };

  /* 完整表格 html; opts = { info(表格上方信息行html), foot(tfoot内容html), tip(SSE tip) } */
  DetailTable.prototype.html = function (opts) {
    opts = opts || {};
    var slice = this.slice();
    if (opts.tip && this.cfg.tipFn) slice = this.cfg.tipFn(slice, opts.tip) || slice;
    var h = (opts.info || '') +
      '<table class="' + (this.cfg.tableClass || 'ud-excel') + '"><thead><tr>';
    for (var c = 0; c < this.cols.length; c++) h += '<th>' + this.cols[c].label + '</th>';
    h += '</tr></thead><tbody>';
    if (!slice.length) {
      h += '<tr><td colspan="' + this.cols.length + '" class="num">' + esc(this.cfg.emptyText || '无数据') + '</td></tr>';
    } else {
      for (var r = 0; r < slice.length; r++) {
        h += '<tr>';
        for (var k = 0; k < this.cols.length; k++) {
          var col = this.cols[k];
          if (col.cell) h += col.cell(slice[r], r, this._tip);
          else {
            var v = col.text ? col.text(slice[r], r, this._tip) : nv(slice[r][col.key]);
            var cls = col.cls || 'num';
            if (col.sign) cls += (cls ? ' ' : '') + signCls(slice[r][col.key]);
            h += '<td class="' + cls + '">' + v + '</td>';
          }
        }
        h += '</tr>';
      }
    }
    h += '</tbody>';
    if (opts.foot) h += '<tfoot>' + opts.foot + '</tfoot>';
    h += '</table>';
    return h;
  };
  /* 渲染进 host（host.innerHTML = 表格）; 保留 host 引用供 patchTip 增量换表 */
  DetailTable.prototype.render = function (host, opts) {
    this._host = host;
    this._opts = opts || {};
    host.innerHTML = this.html(this._opts);
    this._tableEl = host.querySelector('table');
    return this;
  };
  /* SSE 实时顶行: 只替换表格本体(信息行/分页条不动, 不闪); 返回是否已应用 */
  DetailTable.prototype.patchTip = function (tip) {
    if (!this.cfg.tipFn || !this._host || !this._tableEl) return false;
    this._tip = tip;
    if (this._opts) this._opts.tip = tip;
    var wrap = document.createElement('div');
    wrap.innerHTML = this.html(this._opts);
    var nt = wrap.querySelector('table');
    if (nt && this._tableEl.parentNode) {
      this._tableEl.parentNode.replaceChild(nt, this._tableEl);
      this._tableEl = nt;
    }
    return true;
  };

  /* 静态工具导出（唯一实现, 各表格复用） */
  DetailTable.esc = esc;
  DetailTable.nv = nv;
  DetailTable.pct = pct;
  DetailTable.signCls = signCls;
  DetailTable.td = td;
  DetailTable.pageBtns = pageBtns;

  global.DetailTable = DetailTable;
})(typeof window !== 'undefined' ? window : globalThis);
