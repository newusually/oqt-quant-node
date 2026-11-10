  /* ===================== AI 策略面板（每天零点自动分析回写） ===================== */
  var aiTimer = null, lastAiSig = '';
  var AI_TAGS = { danger: '🔴 高风险', warn: '🟠 需关注', ok: '🟢 正常', info: '🔵 建议' };

  function fmt(s) {
    return esc(String(s == null ? '' : s))
      .replace(/\*\*(.+?)\*\*/g, '<strong class="hl-red">$1</strong>')
      .replace(/\[!(.+?)\]/g, '<span class="hl-warn">$1</span>');
  }
  function hlCard(h) {
    var lv = AI_TAGS[h && h.level] ? h.level : 'info';
    return '<div class="ai-hl ' + lv + '"><span class="tag">' + AI_TAGS[lv] + '</span>' +
      fmt(h && h.text) + '</div>';
  }
  function aiBjFallback(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + ' (北京时间)'; }
    catch (e) { return ''; }
  }
  /* ===== 全量 Forensic 渲染：报表 + 归因 + 回测 + 根因 + 代码 ===== */
  function renderTradesTable(trades) {
    if (!trades || !trades.length) return '<div class="ai-empty">暂无交易明细</div>';
    var rows = trades.map(function (t) {
      var net = (t.netUsd == null) ? null : +t.netUsd;
      var cls = net == null ? 'flat' : (net >= 0 ? 'up' : 'dn');
      var out = t.outcome === '持仓中' ? '持仓中' : (net >= 0 ? '盈利' : '亏损');
      return '<tr>' +
        '<td class="mono">' + esc((t.pid || '').slice(0, 18)) + '</td>' +
        '<td>' + esc(t.inst) + '</td>' +
        '<td class="' + (t.dir === '多' ? 'up' : 'dn') + '">' + esc(t.dir) + '</td>' +
        '<td>' + num(t.entryPx, 4) + '</td>' +
        '<td>' + num(t.adds, 0) + '</td>' +
        '<td>' + (t.exitPx == null ? '—' : num(t.exitPx, 4)) + '</td>' +
        '<td class="' + cls + '">' + (net == null ? '—' : sgn(net, 4)) + '</td>' +
        '<td class="' + cls + '">' + esc(out) + '</td>' +
        '<td>' + (t.holdMin == null ? '—' : num(t.holdMin, 0) + '′') + '</td>' +
      '</tr>';
    }).join('');
    return '<div class="ai-trades"><table><thead><tr>' +
      '<th>轮次</th><th>合约</th><th>方向</th><th>入场价</th><th>加仓</th><th>出场价</th><th>净USD</th><th>归类</th><th>持仓</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function renderAnaList(list, empty) {
    if (!list || !list.length) return '<div class="ai-empty">' + (empty || '暂无') + '</div>';
    return '<ul class="ai-ana">' + list.map(function (x) {
      var head = (x.pid ? '【' + esc(x.pid) + '】' : '') + (x.inst ? esc(x.inst) + ' ' : '');
      return '<li><span class="ai-ana-h">' + head + '</span>' + fmt(x.why) + '</li>';
    }).join('') + '</ul>';
  }
  function renderBacktestBox(bt) {
    if (!bt) return '<div class="ai-empty">暂无回测汇总</div>';
    var dir = bt.byDirection || {};
    var rows = [
      ['总轮次', num(bt.totalRounds, 0)],
      ['已平 / 持仓', num(bt.closed, 0) + ' / ' + num(bt.open, 0)],
      ['盈利 / 亏损', num(bt.wins, 0) + ' / ' + num(bt.losses, 0)],
      ['胜率', num(bt.winRate, 2) + '%'],
      ['净USD', sgn(bt.netUsd, 4)],
      ['毛利 / 毛损', sgn(bt.grossProfit, 4) + ' / ' + sgn(bt.grossLoss, 4)],
      ['多方向 净', sgn(dir['多'] ? dir['多'].net : 0, 4) + ' (' + num(dir['多'] ? dir['多'].n : 0, 0) + '笔)'],
      ['空方向 净', sgn(dir['空'] ? dir['空'].net : 0, 4) + ' (' + num(dir['空'] ? dir['空'].n : 0, 0) + '笔)'],
      ['有加仓 / 无加仓', num(bt.withAdds, 0) + ' / ' + num(bt.noAdds, 0)],
      ['总信号数', num(bt.totalSignals, 0)]
    ];
    var bi = (bt.byInstrument || []).map(function (x) {
      return '<tr><td>' + esc(x.inst) + '</td><td>' + num(x.n, 0) + '</td><td class="' + (x.net >= 0 ? 'up' : 'dn') + '">' + sgn(x.net, 4) + '</td><td>' + num(x.winRate, 1) + '%</td></tr>';
    }).join('');
    return '<table class="ai-metrics"><tbody>' + rows.map(function (x) {
      var cc = (typeof x[1] === 'string' && /^[-]/.test(x[1])) ? 'dn' : ((typeof x[1] === 'string' && /^[+]/.test(x[1])) ? 'up' : 'flat');
      return '<tr><td>' + x[0] + '</td><td class="' + cc + '">' + x[1] + '</td></tr>';
    }).join('') + '</tbody></table>' +
    (bi ? '<div class="ai-sub">分合约净USD · 胜率</div><table class="ai-metrics"><thead><tr><th>合约</th><th>笔数</th><th>净USD</th><th>胜率</th></tr></thead><tbody>' + bi + '</tbody></table>' : '');
  }
  function renderCodeBox(list) {
    if (!list || !list.length) return '<div class="ai-empty">暂无代码修改</div>';
    return list.map(function (c) {
      var code = c.code ? '<pre class="ai-codeblock">' + esc(c.code) + '</pre>' : '';
      var desc = c.desc ? fmt(c.desc) : '';
      var title = c.title ? '<b>' + esc(c.title) + '</b> ' : '';
      return '<div class="ai-code">' + title + desc + code + '</div>';
    }).join('');
  }

  function renderAI(d) {
    var el = document.getElementById('ft-ai'); if (!el) return;
    var r = (d && d.report) || null;
    var when = r && r.generatedAtBj ? r.generatedAtBj : aiBjFallback(d && d.generatedAt);
    if (!r) {
      el.innerHTML = '<div class="ai-box"><div class="ai-hd"><h4>🤖 AI 策略分析 · WorkBuddy Hy4</h4>' +
        '<span class="ai-badge warn">等待首次分析</span></div>' +
        '<div class="ai-empty">每小时由服务器 CodeBuddy / Hy4 自动分析全部交易（累计复盘），生成逐笔归因、回测报表与代码修改结论。' +
        (d && d.error ? '<br><span class="hl-red">' + esc(d.error) + '</span>' : '') + '</div></div>';
      return;
    }
    var hls = r.highlights || [];
    var steps = r.steps || [];
    var concl = r.conclusions || [];
    var metrics = r.metrics || [];
    var pb = r.periodBj || null;
    var eff = d.effective || {}, lock = d.locked || [];

    var h = '<div class="ai-box"><div class="ai-hd">' +
      '<h4>🤖 AI 策略分析 · WorkBuddy Hy4</h4>' +
      '<span class="ai-badge">每小时自动更新 · 累计复盘</span>' +
      '<span class="ai-meta">🕐 ' + esc(when) + (r.engine ? ' · ' + esc(r.engine) : '') + '</span></div>' +
      '<div class="ai-verdict"><b>结论 · </b>' + fmt(r.verdict || '（无结论文本）') + '</div>' +
      (hls.length ? '<div class="ai-hls">' + hls.map(hlCard).join('') + '</div>' : '') +
      '<div id="ft-ai-overview" class="ai-ov"></div>' +
      aiChartsHtml(r.charts) +
      '<div class="ai-grid">' +
      /* 左：逐步分析 + 数据明细 + 盈利归因 */
      '<div class="ai-col"><h5>🔍 一步一步分析</h5>' +
      (steps.length ? steps.map(function (s, i) {
        var t = typeof s === 'string' ? s : (s.title || '');
        var det = (s && s.detail) ? '<span class="d">' + fmt(s.detail) + '</span>' : '';
        return '<div class="ai-step"><span class="n">' + (i + 1) + '</span>' +
          '<span><span class="t">' + fmt(t) + '</span>' + det + '</span></div>';
      }).join('') : '<div class="ai-empty">暂无分析步骤</div>') +
      '<h5 class="ai-gap">📊 数据明细</h5>' +
      (metrics.length ? '<table class="ai-metrics">' + metrics.map(function (m) {
        return '<tr><td>' + esc(m.k || m.name || '') + '</td><td>' + fmt(m.v != null ? m.v : m.value) + '</td></tr>';
      }).join('') + '</table>' : '<div class="ai-empty">暂无明细</div>') +
      '<h5 class="ai-gap">✅ 盈利归因（全部盈利笔 · 为什么赚）</h5>' +
      renderAnaList(r.profitAnalysis, '暂无盈利归因') +
      '</div>' +
      /* 中：全部交易明细报表 + 回测全量汇总 */
      '<div class="ai-col"><h5>📋 全部交易明细（报表 · 全量）</h5>' +
      renderTradesTable(r.trades) +
      '<h5 class="ai-gap">🧪 回测全量汇总</h5>' +
      renderBacktestBox(r.backtest) +
      (r.backtestText && r.backtestText.summary ? '<div class="ai-sub">AI 回测结论</div><div class="ai-root">' + fmt(r.backtestText.summary) + '</div>' : '') +
      '</div>' +
      /* 右：亏损归因 + 根因 + 代码修改 + 结论 + 窗口 */
      '<div class="ai-col"><h5>❌ 亏损归因（全部亏损笔 · 为什么亏）</h5>' +
      renderAnaList(r.lossAnalysis, '暂无亏损归因') +
      (r.rootCause ? '<h5 class="ai-gap">🧭 强制根因总结</h5><div class="ai-root">' + fmt(r.rootCause) + '</div>' : '') +
      '<h5 class="ai-gap">🛠 策略 / 代码修改</h5>' +
      renderCodeBox(r.codeChanges) +
      (concl.length ? '<h5 class="ai-gap">✅ 结论与建议</h5><ul class="ai-concl">' +
        concl.map(function (c) { return '<li>' + fmt(typeof c === 'string' ? c : (c.text || c.title || '')) + '</li>'; }).join('') +
        '</ul>' : '') +
      '<h5 class="ai-gap">🕐 分析数据窗口（北京时间）</h5>' +
      (pb ? '<div class="ai-window">' +
        '<div><span>起</span>' + esc(pb.from || '—') + '</div>' +
        '<div><span>止</span>' + esc(pb.to || '—') + '</div>' +
        '<div><span>跨度</span>' + esc(pb.spanText || '—') + ' · ' + esc(pb.events) + ' 笔事件</div>' +
        '</div>' : '<div class="ai-empty">—</div>') +
      '</div></div>' +
      '<div class="ai-lock">🔒 <b>AI 不可修改</b>：' + esc(lock.join(' / ')) +
      ' ｜ 每笔 <b>' + esc(eff.entryUsd) + '$</b> · 加仓 <b>' + esc(eff.addUsd) + '$</b> · 周期 <b>' + esc((eff.tfs || []).join(',')) + '</b>' +
      ' ｜ 当前生效：<span class="hl-warn">止盈 ' + esc(eff.tpPct) + '%</span> / <span class="hl-warn">加仓浮亏 ' + esc(eff.addLossPct) + '%</span> / 间隔 ' + esc(Math.round((eff.addIntervalMs || 0) / 60000)) + ' 分钟' +
      ' ｜ 加仓需<b>买卖信号(零轴翻转)同向</b>' +
      (d.rejected && d.rejected.length ? ' ｜ <span class="hl-red">已拒绝参数：' + esc(d.rejected.join('、')) + '</span>' : '') +
      '</div></div>';
    el.innerHTML = h;
    renderAiOverview(lastSummary);
    aiMountCharts(r.charts);
    bindInstClicks(el);
  }
  /* ★AI 交易总览表：用实时 flowtrack 统计展示关键累计数字（好看表格，列头多彩 + 单元格淡色）。
   *   随主面板每 3 秒轻量刷新（不重建整个 AI 面板，避免图表面板闪烁）。 */
  function renderAiOverview(summary) {
    var el = document.getElementById('ft-ai-overview'); if (!el) return;
    if (!summary) { el.innerHTML = ''; return; }
    var sm = summary;
    var ec = sm.eventCounts || {};
    var rows = [
      ['总模拟盈利 (USD)', sgn(sm.totalProfitUSD, 4), sm.totalProfitUSD >= 0 ? 'up' : 'dn'],
      ['未平仓投入 (仓位USD)', num(sm.positionUSD, 4), 'flat'],
      ['持仓市值 (持有USD)', num(sm.holdingUSD, 4), 'flat'],
      ['未平仓浮亏 (亏损USD)', sgn(-sm.lossUSD, 4), sm.lossUSD > 0 ? 'dn' : 'flat'],
      ['开仓次数', num((ec.buy || 0) + (ec.sell || 0), 0), 'flat'],
      ['加仓次数', num(ec.add || 0, 0), 'flat'],
      ['平仓次数', num(ec.close || 0, 0), 'flat'],
      ['未平仓金字塔', num(sm.openCount, 0), 'flat']
    ];
    el.innerHTML = '<table class="ai-metrics"><thead><tr><th>指标</th><th>数值</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr><td>' + esc(x[0]) + '</td><td class="' + x[2] + '">' + x[1] + '</td></tr>';
      }).join('') + '</tbody></table>';
    paintTable(el.querySelector('table'));
  }
  function loadAI() {
    fetch('/api/okx/ai_strategy?v=' + Date.now()).then(function (r) { return r.json(); }).then(function (d) {
      if (!d) return;
      var sig = JSON.stringify([d.generatedAt, d.report && d.report.verdict, d.applied, d.error]);
      if (sig === lastAiSig) return;
      lastAiSig = sig;
      renderAI(d);
    }).catch(function () { });
  }
