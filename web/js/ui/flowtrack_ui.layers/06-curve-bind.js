  /* ===================== 曲线视图装配（盈利曲线 + 实时持仓曲线） ===================== */
  var closeView = null, equityView = null;

  function closeTip(r) {
    var up = r.profit >= 0;
    var inst = r.inst ? '<span class="ftc-inst" data-inst="' + esc(r.inst) + '" title="点击弹出共享K线">' + esc(r.inst) + ' ↗</span>' : '—';
    return '时间：<b>' + esc(dt(r.t)) + '</b><br>' +
      '合约：' + inst + (r.dir ? ' <span style="color:#8b9abc">(' + esc(r.dir) + ')</span>' : '') + '<br>' +
      '本笔净盈利：<b style="color:' + (up ? '#ff6b7d' : '#31c99a') + '">' + esc(sgn(r.profit, 6)) + ' $</b><br>' +
      '累计净USD：<b>' + esc(sgn(r.net, 6)) + ' $</b><br>' +
      '止盈目标价：<b>' + esc(num(r.tpPx, 6)) + '</b>' +
      (r.tpUsd != null ? ' <span style="color:#8b9abc">(目标 +' + esc(num(r.tpUsd, 6)) + '$)</span>' : '') + '<br>' +
      '实际平仓价：<b>' + esc(num(r.exitPx, 6)) + '</b>' +
      (r.avgPx != null ? ' <span style="color:#8b9abc">/ 均价 ' + esc(num(r.avgPx, 6)) + '</span>' : '') +
      '<div style="margin-top:4px;color:#7f92b8;font-size:10.5px">点击合约名 → 共享K线组件</div>';
  }
  function equityTip(r) {
    var up = r.net >= 0;
    return '时间：<b>' + esc(dt(r.t)) + '</b><br>' +
      '未平仓数：<b>' + esc(r.n) + '</b><br>' +
      '实时净浮盈USD：<b style="color:' + (up ? '#ff6b7d' : '#31c99a') + '">' + esc(sgn(r.net, 6)) + ' $</b><br>' +
      '持仓市值：<b>' + esc(num(r.holdingUSD, 6)) + ' $</b><br>' +
      '投入中：<b>' + esc(num(r.positionUSD, 6)) + ' $</b>';
  }

  function ensureViews() {
    if (closeView) return;
    closeView = new CurveView({
      canvasId: 'ftc-cv', tipId: 'ftc-tip', toolsId: 'ftc-tools', infoId: 'ftc-info',
      color: '#3d7bff', area: 'rgba(61,123,255,.12)', yLabel: '累计净USD',
      emptyText: '暂无平仓数据（浮盈 >10% 止盈后生成逐笔曲线点）', onTip: closeTip
    });
    equityView = new CurveView({
      canvasId: 'ftc-eq-cv', tipId: 'ftc-eq-tip', toolsId: 'ftc-eq-tools', infoId: 'ftc-eq-info',
      color: '#31c99a', area: 'rgba(49,201,154,.12)', yLabel: '实时净浮盈USD',
      emptyText: '暂无持仓采样（有未平仓金字塔后每 30 秒生成）', onTip: equityTip
    });
    closeView.peer = equityView; equityView.peer = closeView;
  }

  function renderChart(d) {
    if (!d) return;
    ensureViews();
    var closeSeries = ((d.curve) || []).slice().sort(function (a, b) { return (+a.t) - (+b.t); });
    closeView.render(closeSeries);
    var eqSeries = ((d.equity) || []).slice().sort(function (a, b) { return (+a.t) - (+b.t); });
    equityView.render(eqSeries);
  }
