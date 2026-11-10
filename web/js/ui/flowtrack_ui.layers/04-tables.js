  function renderRows(rows) {
    var tb = document.getElementById('ft-rows'); if (!tb) return;
    var flt = rows || [];
    if (tfFilter !== 'all') flt = flt.filter(function (r) { return r.tf === tfFilter; });
    if (evFilter !== 'all') flt = flt.filter(function (r) { return evKey(r) === evFilter || r.event === evFilter; });
    if (!flt.length) {
      tb.innerHTML = '<tr><td colspan="10" class="empty">当前筛选无数据（可切回「全部周期 / 全部事件」）</td></tr>';
      return;
    }
    tb.innerHTML = flt.map(function (r) {
      var ev = EV[evKey(r)] || { label: r.event, color: '#8b9abc', sym: 'circle' };
      var dirCls = r.dir === '多' ? 'up' : (r.dir === '空' ? 'dn' : '');
      return '<tr class="r">' +
        '<td>' + tf(r.ts) + '</td>' +
        '<td><span class="inst" data-inst="' + esc(r.inst) + '">' + esc(r.inst) + '</span></td>' +
        '<td>' + tfName(r.tf) + '</td>' +
        '<td class="' + dirCls + '">' + esc(r.dir) + '</td>' +
        '<td class="ev" style="color:' + ev.color + '">' + ev.label + '</td>' +
        '<td>' + num(r.px, 6) + '</td>' +
        '<td>' + num(r.qty, 6) + '</td>' +
        '<td>' + num(r.cost, 6) + '</td>' +
        '<td class="' + cls(r.unreal) + '">' + sgn(r.unreal, 6) + '</td>' +
        '<td class="' + cls(r.netBp) + '">' + sgn(r.netBp, 6) + '</td>' +
      '</tr>';
    }).join('');
    bindInstClicks(tb);
  }

  function renderPager(d) {
    var el = document.getElementById('ft-pager'); if (!el || !d) return;
    var tp = d.totalPages, p = d.page;
    var html = '<span class="pg' + (p <= 1 ? ' dis' : '') + '" data-pg="' + (p - 1) + '">‹ 上一页</span>';
    var from = Math.max(1, p - 3), to = Math.min(tp, from + 6); from = Math.max(1, to - 6);
    for (var i = from; i <= to; i++) html += '<span class="pg' + (i === p ? ' on' : '') + '" data-pg="' + i + '">' + i + '</span>';
    html += '<span class="pg' + (p >= tp ? ' dis' : '') + '" data-pg="' + (p + 1) + '">下一页 ›</span>';
    el.innerHTML = html;
    [].forEach.call(el.querySelectorAll('.pg'), function (b) {
      b.onclick = function () {
        var pg = parseInt(b.getAttribute('data-pg'), 10);
        if (!pg || pg < 1 || pg > tp || pg === p) return;
        activePage = pg; load();
      };
    });
  }
