  function load() {
    var url = '/api/okx/flowtrack?v=' + Date.now();
    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.ok === false) { var u = document.getElementById('ft-upd'); if (u) u.textContent = '接口异常: ' + ((d && d.err) || ''); return; }
      var u = document.getElementById('ft-upd'); if (u) u.textContent = '更新 ' + new Date().toLocaleTimeString();
      renderCards(d); renderChart(d);
    }).catch(function (e) { var u = document.getElementById('ft-upd'); if (u) u.textContent = '刷新失败: ' + e.message; });

    var aurl = '/api/okx/pyr_all?page=' + activePage +
      '&tf=' + encodeURIComponent(tfFilter) + '&ev=' + encodeURIComponent(evFilter) + '&v=' + Date.now();
    if (activeSort === 'net_desc') aurl += '&sort=net&order=desc';
    else if (activeSort === 'net_asc') aurl += '&sort=net&order=asc';
    fetch(aurl).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.ok === false) return;
      renderFoot(d); renderRows(d.rows); renderPager(d);
    }).catch(function () { });
  }

  /* 明细表 / 曲线浮层 共用入口：点击合约名 → 共享 K线悬浮窗组件 */
  function openSharedKline(inst) {
    if (!inst) return;
    if (global.LeadK && typeof global.LeadK.select === 'function') {
      try { global.LeadK.select(inst); } catch (e) { }
    }
    if (global.KlinePopup && typeof global.KlinePopup.open === 'function') {
      global.KlinePopup.open(inst, { tf: '15m' });
    } else {
      var u = document.getElementById('ft-upd');
      if (u) u.textContent = '悬浮窗组件(KlinePopup)未加载';
    }
  }
  function bindInstClicks(root) {
    if (!root || !root.querySelectorAll) return;
    [].forEach.call(root.querySelectorAll('.inst,.ftc-inst'), function (sp) {
      sp.onclick = function () { openSharedKline(sp.getAttribute('data-inst')); };
    });
  }
