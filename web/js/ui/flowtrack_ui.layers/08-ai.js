  /* ===================== AI 策略面板（每天零点自动分析回写） ===================== */
  var aiTimer = null, lastAiSig = '';
  var AI_TAGS = { danger: '🔴 高风险', warn: '🟠 需关注', ok: '🟢 正常', info: '🔵 建议' };

  function fmt(s) {
    return esc(String(s == null ? '' : s))
      .replace(/\*\*(.+?)\*\*/g, '<strong class="hl-red">$1</strong>')
      .replace(/\[!(.+?)\]/g, '<span class="hl-warn">$1</span>');
  }
  function mmNode(n) {
    if (!n) return '';
    var name = typeof n === 'string' ? n : (n.name || n.title || '');
    var kids = (n && n.children) || [];
    return '<li><span class="' + (kids.length ? 'root' : '') + '">' + esc(name) + '</span>' +
      (kids.length ? '<ul>' + kids.map(mmNode).join('') + '</ul>' : '') + '</li>';
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
  function renderAI(d) {
    var el = document.getElementById('ft-ai'); if (!el) return;
    var r = (d && d.report) || null;
    var when = r && r.generatedAtBj ? r.generatedAtBj : aiBjFallback(d && d.generatedAt);
    if (!r) {
      el.innerHTML = '<div class="ai-box"><div class="ai-hd"><h4>🤖 AI 策略分析 · WorkBuddy Hy4</h4>' +
        '<span class="ai-badge warn">等待首次分析</span></div>' +
        '<div class="ai-empty">每小时由服务器 CodeBuddy / Hy4 自动分析全部交易（累计复盘），生成逐步推理、思维导图、图表与改进结论。' +
        (d && d.error ? '<br><span class="hl-red">' + esc(d.error) + '</span>' : '') + '</div></div>';
      return;
    }
    var hls = r.highlights || [];
    var steps = r.steps || [];
    var concl = r.conclusions || [];
    var metrics = r.metrics || [];
    var codes = r.codeChanges || [];
    var mm = r.mindmap || { name: '策略分析', children: [] };
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
      /* 左：思维导图 + 逐步分析 */
      '<div class="ai-col"><h5>🧠 思维导图</h5><ul class="ai-mm">' + mmNode(mm) + '</ul>' +
      '<h5 class="ai-gap">🔍 一步一步分析</h5>' +
      (steps.length ? steps.map(function (s, i) {
        var t = typeof s === 'string' ? s : (s.title || '');
        var det = (s && s.detail) ? '<span class="d">' + fmt(s.detail) + '</span>' : '';
        return '<div class="ai-step"><span class="n">' + (i + 1) + '</span>' +
          '<span><span class="t">' + fmt(t) + '</span>' + det + '</span></div>';
      }).join('') : '<div class="ai-empty">暂无分析步骤</div>') +
      '</div>' +
      /* 中：数据明细 + 结论建议 */
      '<div class="ai-col"><h5>📊 数据明细</h5>' +
      (metrics.length ? '<table class="ai-metrics">' + metrics.map(function (m) {
        return '<tr><td>' + esc(m.k || m.name || '') + '</td><td>' + fmt(m.v != null ? m.v : m.value) + '</td></tr>';
      }).join('') + '</table>' : '<div class="ai-empty">暂无明细</div>') +
      (concl.length ? '<h5 class="ai-gap">✅ 结论与建议</h5><ul class="ai-concl">' +
        concl.map(function (c) { return '<li>' + fmt(typeof c === 'string' ? c : (c.text || c.title || '')) + '</li>'; }).join('') +
        '</ul>' : '') +
      '</div>' +
      /* 右：改进建议 + 数据窗口 + 锁定项 */
      '<div class="ai-col"><h5>🛠 策略 / 代码改进</h5>' +
      (codes.length ? codes.map(function (c) {
        return '<div class="ai-code">· ' + fmt(typeof c === 'string' ? c : (c.desc || c.title || '')) + '</div>';
      }).join('') : '<div class="ai-empty">暂无改进建议</div>') +
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
      ' ｜ 加仓需<b>MACD 柱方向同向</b>' +
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
