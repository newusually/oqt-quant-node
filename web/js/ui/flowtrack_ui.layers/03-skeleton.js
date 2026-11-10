  function buildSkeleton() {
    var box = document.getElementById(BOX);
    if (!box) return false;
    box.innerHTML =
      '<h3>🧭 马丁格尔金字塔 · 模拟总览 <span class="live" id="ft-live"><i></i>实时</span>' +
      '<span class="sub" id="ft-upd" style="margin-left:8px"></span></h3>' +
      /* ★AI 策略面板：总览最上面，每天零点由服务器 CodeBuddy / Hy4 自动分析回写 */
      '<div id="ft-ai" class="ai-wrap"></div>' +
      '<div class="sub">策略：<b>MACD(12,26,60) 零轴翻转入场（★只 15m）</b>：当前 MACD 柱 <b>&gt;0</b> 且之前连续 <b>≥20 根 &lt;0</b> ⇒ <b>买多</b>；当前柱 <b>&lt;0</b> 且之前连续 <b>≥20 根 &gt;0</b> ⇒ <b>卖空</b>；其余不买卖。买多 / 卖空 / 加仓 每笔一律 <b>0.1 美金</b>；' +
      '加仓：<b>距开仓或上次加仓满 1 小时</b> 且 整仓<b>浮亏 &gt;1%</b> 且 <b>当前 15m MACD 柱方向与持仓同向</b>（买多仓需柱 &gt;0 / 卖空仓需柱 &lt;0，不要求零轴翻转）→ 加仓 <b>0.1 美金</b>；' +
      '<b>同根K线只允许一次买多/卖空/加仓</b>；整仓浮盈 <b>&gt;10%</b> 才止盈；无限资金、<b>不准爆仓/止损/按时间平仓</b>。' +
      '<b>买卖/加仓严格按每根 15m K线边界（:00/:15/:30/:45）后的窗口执行</b>，每 15 分钟最多一次，绝不"每时每刻都在买卖"；数据自 <b>2026-11-01 起永久保留</b>。' +
      '数据每 3 秒刷新，<b>点击表格行 / 曲线浮层内合约名可弹共享 K线悬浮窗</b>。</div>' +
      '<div class="cards" id="ft-cards"></div>' +
      '<div class="foot" id="ft-foot"></div>' +
      /* ★实时持仓列表：交易列表上方，只显示未平仓持仓（监控实时持仓） */
      '<div class="ft-sec-wrap" id="ft-hold-wrap"><h4 class="ft-sec">👁 实时持仓列表 <span class="live" id="ft-hold-live"><i></i>实时监控</span></h4>' +
      '<div class="tw"><table id="ft-hold-tbl"><thead><tr>' +
      '<th>合约</th><th>方向</th><th>周期</th><th>开仓价</th><th>现价</th><th>均价</th><th>数量</th><th>浮盈浮亏%</th><th>净浮盈USD</th><th>加仓次数</th><th>开仓时间</th>' +
      '</tr></thead><tbody id="ft-hold-rows"></tbody></table></div></div>' +
      '<div class="bar"><span class="lbl">周期</span><div class="tabs" id="ft-tabs"></div>' +
      '<span class="lbl">类型</span><div class="tabs" id="ft-evtabs"></div>' +
      '<span class="sbtn" id="ft-sort" title="按净USD排序">最新在前 ⇅</span></div>' +
      '<h4 class="ft-sec">📋 交易列表</h4>' +
      '<div class="tw"><table id="ft-tbl"><thead><tr>' +
      '<th>时间</th><th>合约</th><th>周期</th><th>方向</th><th>事件</th><th>价格</th><th>数量</th><th>成本$</th><th>开仓价格</th><th>浮盈浮亏%</th><th>净USD</th>' +
      '</tr></thead><tbody id="ft-rows"></tbody></table></div>' +
      '<div class="pager" id="ft-pager"></div>' +
      '<div class="chartbox"><h4 style="margin:0 0 6px;color:#8fa6d0;font-size:12.5px">盈利曲线（逐笔平仓 · 累计已实现净 USD）· ' +
      '拖拽平移 / 滚轮缩放 / 双击复位 · 悬停显示 合约 / 本笔盈利 / 止盈价，<b style="color:#7fb1ff">点击浮层内合约名弹共享K线</b></h4>' +
      '<div id="ft-chart" class="chart">' +
      '<div class="ftc-tools" id="ftc-tools"></div>' +
      '<canvas id="ftc-cv" class="ftc-cv" tabindex="0"></canvas>' +
      '<div class="ftc-tip" id="ftc-tip"></div>' +
      '</div>' +
      '<h4 style="margin:14px 0 6px;color:#8fe0c0;font-size:12.5px">实时持仓曲线（持仓期间实时净浮盈 USD · 含亏损 / 盈利，每 30 秒采样）· 与上方同步拖拽 / 缩放</h4>' +
      '<div id="ft-eq-chart" class="chart">' +
      '<div class="ftc-tools" id="ft-eq-tools"></div>' +
      '<canvas id="ft-eq-cv" class="ftc-cv" tabindex="0"></canvas>' +
      '<div class="ftc-tip" id="ft-eq-tip"></div>' +
      '</div></div>';
    return true;
  }

  function renderCards(s) {
    var el = document.getElementById('ft-cards'); if (!el || !s) return;
    var sm = s.summary || {};
    el.innerHTML =
      card('总模拟盈利 (USD)', sgn(sm.totalProfitUSD, 4), sm.totalProfitUSD >= 0 ? 'up' : 'dn', '已平仓 ' + num(sm.closedCount, 0) + ' 次（净USD）') +
      card('仓位 USD（投入中）', num(sm.positionUSD, 4), 'flat', '未平仓 ' + num(sm.openCount, 0) + ' 个金字塔') +
      card('持有 USD（市值）', num(sm.holdingUSD, 4), 'flat', '当前持仓名义市值') +
      card('亏损 USD（浮亏）', sgn(-sm.lossUSD, 4), sm.lossUSD > 0 ? 'dn' : 'flat', '未平仓浮亏合计');
  }
  function card(k, v, c, s) {
    return '<div class="card"><div class="k">' + esc(k) + '</div><div class="v ' + c + '">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>';
  }

  function renderFoot(d) {
    var el = document.getElementById('ft-foot'); if (!el || !d) return;
    var s = d.summary || {};
    el.innerHTML = '交易合计 <b>' + num(s.n, 0) + '</b> 笔（开仓 ' + num(s.opens, 0) +
      ' · <span style="color:#f0a020">买多加仓 ' + num(s.addLong, 0) + '</span>' +
      ' · <span style="color:#c07ae0">卖空加仓 ' + num(s.addShort, 0) + '</span>' +
      ' · 平仓 ' + num(s.closes, 0) + '） · 净USD <span class="' + cls(s.netBp) + '">' + sgn(s.netBp, 1) + '</span> · 第 ' +
      d.page + '/' + d.totalPages + ' 页（共 ' + d.total + ' 笔）';
  }

  /* 明细表选项卡：周期 + 事件两组，点选后回到第 1 页，筛选交给后端，分页总数按筛选后重算。 */
  function paintTabs(elId, tabs, cur, onPick) {
    var el = document.getElementById(elId); if (!el) return;
    el.innerHTML = tabs.map(function (c) {
      return '<span class="tab' + (c.id === cur ? ' on' : '') + '" data-v="' + esc(c.id) + '">' + esc(c.label) + '</span>';
    }).join('');
    [].forEach.call(el.querySelectorAll('.tab'), function (t) {
      t.onclick = function () {
        var v = t.getAttribute('data-v');
        if (v !== cur) onPick(v);
      };
    });
  }

  function renderTabs() {
    paintTabs('ft-tabs', TF_TABS, tfFilter, function (v) {
      tfFilter = v; activePage = 1; renderTabs(); load();
    });
    paintTabs('ft-evtabs', EV_TABS, evFilter, function (v) {
      evFilter = v; activePage = 1; renderTabs(); load();
    });
  }

  function renderSort() {
    var el = document.getElementById('ft-sort'); if (!el) return;
    var labels = { '': '最新在前 ⇅', net_desc: '净USD 大→小 ↓', net_asc: '净USD 小→大 ↑' };
    function paint() { el.textContent = labels[activeSort] || labels['']; el.className = 'sbtn' + (activeSort ? ' on' : ''); }
    paint();
    el.onclick = function () {
      activeSort = activeSort === '' ? 'net_desc' : (activeSort === 'net_desc' ? 'net_asc' : '');
      paint(); activePage = 1; load();
    };
  }
