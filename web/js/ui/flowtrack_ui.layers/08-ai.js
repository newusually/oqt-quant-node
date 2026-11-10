  /* ===================== AI 策略面板（每天零点自动分析回写） ===================== */
  /* ★2026-11-11p 所有表格统一走 FTable 独立组件（交易列表样式，多彩列头+淡色单元格+整行hover+统一分页） */
  var aiTimer = null, lastAiSig = '';
  var AI_TAGS = { danger: '🔴 高风险', warn: '🟠 需关注', ok: '🟢 正常', info: '🔵 建议' };
  var aiTradesPage = 1, aiTradesPer = 10, aiInstPage = 1, aiInstPer = 10, aiBtPage = 1, aiBtPer = 10;
  var aiHistPage = 1, aiHistPer = 10;
  var FT_FTBL = (typeof FTable !== 'undefined') ? FTable : null;   // 统一表格组件（独立共享）

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
  /* 单笔交易 → FTable 行 cells（轮次/合约/方向/入场/加仓/出场/净USD/浮亏/归类/持仓） */
  function tradeCells(t) {
    var net = (t.netUsd == null) ? null : +t.netUsd;
    var cls = net == null ? 'flat' : (net >= 0 ? 'up' : 'dn');
    var out = t.outcome === '持仓中' ? '持仓中' : (net >= 0 ? '盈利' : '亏损');
    var flPct = (t.floatPct == null) ? null : +t.floatPct;
    var flUsd = (t.floatUsd == null) ? null : +t.floatUsd;
    var flHtml = (t.outcome !== '持仓中' || flPct == null) ? '—'
      : '<span class="hl-red">' + flPct.toFixed(2) + '%</span>' + (flUsd == null ? '' : ' <span class="' + (flUsd >= 0 ? 'up' : 'dn') + '">' + sgn(flUsd, 4) + '</span>');
    return [
      '<span class="mono">' + esc((t.pid || '').slice(0, 18)) + '</span>',
      '<span class="inst">' + esc(t.inst) + '</span>',
      '<span class="' + (t.dir === '多' ? 'up' : 'dn') + '">' + esc(t.dir) + '</span>',
      num(t.entryPx, 4),
      num(t.adds, 0),
      (t.exitPx == null ? '—' : num(t.exitPx, 4)),
      '<span class="' + cls + '">' + (net == null ? '—' : sgn(net, 4)) + '</span>',
      flHtml,
      '<span class="' + cls + '">' + esc(out) + '</span>',
      (t.holdMin == null ? '—' : num(t.holdMin, 0) + '′')
    ];
  }
  /* 分合约净USD · 胜率：由全部 trades 实时聚合（权威，不依赖 backtest） */
  function aggByInst(trades) {
    var map = {};
    (trades || []).forEach(function (t) {
      var inst = t.inst || '—';
      var m = map[inst] || (map[inst] = { inst: inst, n: 0, win: 0, loss: 0, open: 0, net: 0 });
      m.n++;
      var net = (t.netUsd == null) ? 0 : +t.netUsd;
      m.net += net;
      if (t.outcome === '持仓中') m.open++;
      else if (net >= 0) m.win++;
      else m.loss++;
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    arr.forEach(function (m) { m.winRate = (m.win + m.loss) ? (m.win / (m.win + m.loss) * 100) : null; });
    arr.sort(function (a, b) { return b.net - a.net; });
    return arr;
  }
  /* 分合约净USD · 胜率：FTable 分页渲染（10/页），底部合计行 */
  function renderInstSummaryInto(trades) {
    var wrap = document.getElementById('ft-ai-inst');
    if (!wrap) return;
    if (!FT_FTBL) { wrap.innerHTML = '<div class="ai-empty">FTable 组件未加载</div>'; return; }
    var arr = aggByInst(trades);
    if (!arr.length) { wrap.innerHTML = '<div class="ai-empty">暂无交易</div>'; return; }
    var pg = FTable.slice(arr, aiInstPage, aiInstPer);
    aiInstPage = pg.page;
    var tot = { n: 0, win: 0, loss: 0, open: 0, net: 0 };
    arr.forEach(function (m) { tot.n += m.n; tot.win += m.win; tot.loss += m.loss; tot.open += m.open; tot.net += m.net; });
    var totWr = (tot.win + tot.loss) ? (tot.win / (tot.win + tot.loss) * 100) : null;
    FTable.render(wrap, {
      cols: [
        { label: '合约', align: 'l', w: '150px' },
        { label: '笔数', w: '60px' },
        { label: '胜/负 · 胜率', w: '150px' },
        { label: '净USD', w: '110px' },
        { label: '持仓', w: '80px' }
      ],
      rows: pg.slice.map(function (m) {
        var wr = m.winRate == null ? '—' : num(m.winRate, 1) + '%';
        return [
          '<span class="inst">' + esc(m.inst) + '</span>',
          num(m.n, 0),
          '<span class="' + ((m.win + m.loss) ? (m.winRate >= 50 ? 'up' : 'dn') : 'flat') + '">' + num(m.win, 0) + '胜/' + num(m.loss, 0) + '负 · ' + wr + '</span>',
          '<span class="' + (m.net >= 0 ? 'up' : 'dn') + '">' + sgn(m.net, 4) + '</span>',
          (m.open ? num(m.open, 0) + ' 持仓' : '—')
        ];
      }),
      foot: [[
        '合计', num(tot.n, 0),
        '<span class="' + (totWr >= 50 ? 'up' : 'dn') + '">' + num(tot.win, 0) + '胜/' + num(tot.loss, 0) + '负 · ' + (totWr == null ? '—' : num(totWr, 1) + '%') + '</span>',
        '<span class="' + (tot.net >= 0 ? 'up' : 'dn') + '">' + sgn(tot.net, 4) + '</span>',
        (tot.open ? num(tot.open, 0) + ' 持仓' : '—')
      ]],
      maxH: 460,
      empty: '暂无交易',
      pager: {
        page: aiInstPage, pages: pg.pages, total: arr.length, unit: '合约', per: aiInstPer, perOpts: [10, 50, 100],
        onPage: function (p) { aiInstPage = p; renderInstSummaryInto(trades); },
        onPer: function (v) { aiInstPer = v; aiInstPage = 1; renderInstSummaryInto(trades); }
      }
    });
  }
  /* 全量交易明细：FTable 分页渲染（10/页，可选 20/30/50/100） */
  function renderTradesTableInto(trades) {
    var wrap = document.getElementById('ft-ai-trades');
    if (!wrap) return;
    if (!FT_FTBL) { wrap.innerHTML = '<div class="ai-empty">FTable 组件未加载</div>'; return; }
    if (!trades || !trades.length) { wrap.innerHTML = '<div class="ai-empty">暂无交易明细</div>'; return; }
    var pg = FTable.slice(trades, aiTradesPage, aiTradesPer);
    aiTradesPage = pg.page;
    FTable.render(wrap, {
      cols: [
        { label: '轮次', align: 'l', w: '130px' },
        { label: '合约', align: 'l', w: '110px' },
        { label: '方向', w: '50px' },
        { label: '入场价', w: '90px' },
        { label: '加仓', w: '50px' },
        { label: '出场价', w: '90px' },
        { label: '净USD', w: '100px' },
        { label: '浮亏', w: '110px' },
        { label: '归类', w: '60px' },
        { label: '持仓', w: '70px' }
      ],
      rows: pg.slice.map(tradeCells),
      maxH: 460,
      empty: '暂无交易明细',
      pager: {
        page: aiTradesPage, pages: pg.pages, total: trades.length, unit: '笔', per: aiTradesPer, perOpts: [10, 20, 30, 50, 100],
        onPage: function (p) { aiTradesPage = p; renderTradesTableInto(trades); },
        onPer: function (v) { aiTradesPer = v; aiTradesPage = 1; renderTradesTableInto(trades); }
      }
    });
  }
  /* ===== 每笔事件明细（买入/卖出/加仓/平仓 · 每笔带规则原因 · FTable 分页） ===== */
  var aiEvPage = 1, aiEvPer = 10;
  var EV_NAMES = { buy: '买入开多', sell: '卖出开空', add: '加仓', close: '平仓' };
  function evReason(s) {
    if (s.ev === 'buy') return '入场做多：MACD 零轴翻转（前≥20 根反向柱后翻多），按 15m K线边界执行，投入 ' + num(s.cost, 4) + ' USD @ ' + num(s.px, 6);
    if (s.ev === 'sell') return '入场做空：MACD 零轴翻转（前≥20 根反向柱后翻空），按 15m K线边界执行，投入 ' + num(s.cost, 4) + ' USD @ ' + num(s.px, 6);
    if (s.ev === 'add') return '加仓摊薄：满 1 小时 + 该轮浮亏 > 0 + 出现同向零轴翻转信号，加投 ' + num(s.cost, 4) + ' USD @ ' + num(s.px, 6);
    if (s.ev === 'close') return (+s.net >= 0 ? '止盈平仓：浮盈 ≥ 5% 触发，净 ' + sgn(s.net, 4) + ' USD' : '平仓退出：净 ' + sgn(s.net, 4) + ' USD');
    return '事件 ' + (s.ev || '—');
  }
  function renderEventsTableInto(signals) {
    var wrap = document.getElementById('ft-ai-events');
    if (!wrap) return;
    if (!FT_FTBL) { wrap.innerHTML = '<div class="ai-empty">FTable 组件未加载</div>'; return; }
    if (!signals || !signals.length) { wrap.innerHTML = '<div class="ai-empty">暂无事件</div>'; return; }
    var pg = FTable.slice(signals, aiEvPage, aiEvPer);
    aiEvPage = pg.page;
    FTable.render(wrap, {
      cols: [
        { label: '时间', align: 'l', w: '120px' },
        { label: '事件', w: '80px' },
        { label: '合约', align: 'l', w: '110px' },
        { label: '方向', w: '50px' },
        { label: '价格', w: '90px' },
        { label: '成本USD', w: '90px' },
        { label: '净USD', w: '100px' },
        { label: '原因', align: 'l', wrap: true, w: '320px' }
      ],
      rows: pg.slice.map(function (s) {
        var net = (s.ev === 'close') ? +s.net : null;
        return [
          '<span class="mono">' + esc((s.t || '').replace(' (北京时间)', '')) + '</span>',
          esc(EV_NAMES[s.ev] || s.ev || '—'),
          '<span class="inst">' + esc(s.inst) + '</span>',
          '<span class="' + (s.dir === '多' ? 'up' : 'dn') + '">' + esc(s.dir) + '</span>',
          num(s.px, 6),
          num(s.cost, 4),
          '<span class="' + (net == null ? 'flat' : (net >= 0 ? 'up' : 'dn')) + '">' + (net == null ? '—' : sgn(net, 4)) + '</span>',
          '<span class="ev-why">' + esc(evReason(s)) + '</span>'
        ];
      }),
      maxH: 460,
      empty: '暂无事件',
      pager: {
        page: aiEvPage, pages: pg.pages, total: signals.length, unit: '笔事件', per: aiEvPer, perOpts: [10, 20, 50, 100],
        onPage: function (p) { aiEvPage = p; renderEventsTableInto(signals); },
        onPer: function (v) { aiEvPer = v; aiEvPage = 1; renderEventsTableInto(signals); }
      }
    });
  }
  /* ===== 归因列表 → 统一 FTable 表格（轮次/合约/方向/浮亏%/原因） ===== */
  function renderAnaList(list, empty) {
    if (!FT_FTBL) return '<div class="ai-empty">FTable 组件未加载</div>';
    var rows = (list || []).map(function (x) {
      return [
        '<span class="mono">' + esc(x.pid ? String(x.pid).slice(0, 20) : '—') + '</span>',
        '<span class="inst">' + esc(x.inst || '—') + '</span>',
        fmt(x.why || '—')
      ];
    });
    return FTable.html({
      cols: [
        { label: '轮次', align: 'l', w: '140px' },
        { label: '合约', align: 'l', w: '100px' },
        { label: '原因', align: 'l', wrap: true }
      ],
      rows: rows,
      maxH: 340,
      empty: empty || '暂无'
    });
  }
  /* 每小时浮亏归因表（AI 输出优先：带方向/浮亏%） */
  function renderFloatLoss(r) {
    if (!FT_FTBL) return '<div class="ai-empty">FTable 组件未加载</div>';
    var fl = r.floatingLossAnalysis;
    if (fl && fl.length) {
      return FTable.html({
        cols: [
          { label: '轮次', align: 'l', w: '140px' },
          { label: '合约', align: 'l', w: '100px' },
          { label: '方向', w: '50px' },
          { label: '浮亏%', w: '80px' },
          { label: '浮亏原因', align: 'l', wrap: true }
        ],
        rows: fl.map(function (x) {
          return [
            '<span class="mono">' + esc(x.pid ? String(x.pid).slice(0, 20) : '—') + '</span>',
            '<span class="inst">' + esc(x.inst || '—') + '</span>',
            '<span class="' + (x.dir === '多' ? 'up' : 'dn') + '">' + esc(x.dir || '—') + '</span>',
            (x.floatPct != null ? '<span class="hl-red">' + num(x.floatPct, 2) + '%</span>' : '—'),
            fmt(x.why || '—')
          ];
        }),
        maxH: 340,
        empty: '暂无'
      });
    }
    var ops = (Array.isArray(r.openPositions) ? r.openPositions : []).slice(0, 10);
    if (ops.length) {
      return FTable.html({
        cols: [
          { label: '轮次', align: 'l', w: '140px' },
          { label: '合约', align: 'l', w: '100px' },
          { label: '方向', w: '50px' },
          { label: '浮亏%', w: '80px' },
          { label: '浮亏USD', w: '100px' },
          { label: '成本USD', w: '100px' },
          { label: '加仓', w: '50px' },
          { label: '说明', align: 'l', wrap: true }
        ],
        rows: ops.map(function (t) {
          var fp = (t.floatPct == null) ? null : +t.floatPct;
          var fu = (t.floatUsd == null) ? null : +t.floatUsd;
          return [
            '<span class="mono">' + esc((t.pid || '').slice(0, 20)) + '</span>',
            '<span class="inst">' + esc(t.inst) + '</span>',
            '<span class="' + (t.dir === '多' ? 'up' : 'dn') + '">' + esc(t.dir) + '</span>',
            (fp == null ? '—' : '<span class="hl-red">' + fp.toFixed(2) + '%</span>'),
            '<span class="' + (fu >= 0 ? 'up' : 'dn') + '">' + (fu == null ? '—' : sgn(fu, 4)) + '</span>',
            num(t.totalCost, 2),
            num(t.adds, 0),
            '浮盈止盈线 +5%，浮亏>0 且出现零轴翻转信号同向才加仓'
          ];
        }),
        maxH: 340,
        empty: '暂无'
      }) +
      '<div class="ai-empty">以上为快照逐笔实时浮亏（最差前 10）；AI 文字归因下一轮生成。</div>';
    }
    return '<div class="ai-empty">本轮快照未含逐笔实时浮亏数据（旧版快照），下一轮分析起显示每小时浮亏归因。</div>';
  }
  function renderBacktestBox(bt) {
    if (!FT_FTBL) return '<div class="ai-empty">FTable 组件未加载</div>';
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
    return FTable.html({
      cols: [{ label: '指标', align: 'l', w: '160px' }, { label: '数值', w: '140px' }],
      rows: rows.map(function (x) {
        var cc = /^[-]/.test(String(x[1])) ? 'dn' : (/^[+]/.test(String(x[1])) ? 'up' : 'flat');
        return [esc(x[0]), '<span class="' + cc + '">' + x[1] + '</span>'];
      }),
      maxH: 0,
      empty: '暂无回测汇总'
    }) +
    '<div id="ft-ai-btinst" class="ai-btinst-wrap"></div>';
  }
  /* 回测分合约净USD · 胜率：FTable 分页渲染（10/页） */
  function renderBtInstInto(bt) {
    var wrap = document.getElementById('ft-ai-btinst');
    if (!wrap) return;
    var arr = (bt && Array.isArray(bt.byInstrument)) ? bt.byInstrument : [];
    if (!arr.length) { wrap.innerHTML = ''; return; }
    var pg = FTable.slice(arr, aiBtPage, aiBtPer);
    aiBtPage = pg.page;
    FTable.render(wrap, {
      cols: [
        { label: '合约', align: 'l', w: '150px' },
        { label: '笔数', w: '60px' },
        { label: '净USD', w: '110px' },
        { label: '胜率', w: '80px' }
      ],
      rows: pg.slice.map(function (x) {
        return [
          '<span class="inst">' + esc(x.inst) + '</span>',
          num(x.n, 0),
          '<span class="' + (x.net >= 0 ? 'up' : 'dn') + '">' + sgn(x.net, 4) + '</span>',
          '<span class="' + (x.winRate >= 50 ? 'up' : 'dn') + '">' + num(x.winRate, 1) + '%</span>'
        ];
      }),
      maxH: 460,
      empty: '暂无',
      pager: {
        page: aiBtPage, pages: pg.pages, total: arr.length, unit: '合约', per: aiBtPer, perOpts: [10, 50, 100],
        onPage: function (p) { aiBtPage = p; renderBtInstInto(bt); },
        onPer: function (v) { aiBtPer = v; aiBtPage = 1; renderBtInstInto(bt); }
      }
    });
  }
  /* 结论 / 改进 / 建议：统一 FTable 表格（序号 + 内容） */
  function renderConclTable(concl) {
    if (!FT_FTBL) return '<div class="ai-empty">FTable 组件未加载</div>';
    return FTable.html({
      cols: [{ label: '#', align: 'c', w: '34px' }, { label: '改进 / 建议', align: 'l', wrap: true }],
      rows: (concl || []).map(function (c, i) {
        var t = typeof c === 'string' ? c : (c.text || c.title || '');
        return [String(i + 1), fmt(t)];
      }),
      maxH: 0,
      empty: '暂无'
    });
  }
  /* 修改的代码：统一 FTable 表格（改动内容 + 自动应用状态） */
  function renderCodeTable(list, autoFix) {
    if (!FT_FTBL) return '<div class="ai-empty">FTable 组件未加载</div>';
    if (!list || !list.length) return '<div class="ai-empty">暂无代码修改（AI 仅在保守可验证时输出改动）</div>';
    var resMap = {};
    ((autoFix && autoFix.results) || []).forEach(function (x, i) { resMap[i] = x; });
    var rows = list.map(function (c, i) {
      var st = resMap[i];
      var stHtml = st
        ? (st.status === 'applied' ? '<span class="st-ok">✦ 已自动应用</span>'
          : st.status === 'rolledback' ? '<span class="st-bad">✗ 已回滚</span>'
          : '<span class="st-skip">⊘ 跳过</span>')
        : (c.newCode ? '<span class="st-skip">待应用</span>' : '<span class="st-note">仅说明</span>');
      var code = (c.newCode || c.code) ? '<pre class="ai-codeblock">' + esc(c.newCode || c.code) + '</pre>' : '';
      return [
        '<b>' + esc(c.title || ('改动 ' + (i + 1))) + '</b>' +
        (c.file ? '<div class="cf">' + esc(c.file) + '</div>' : '') +
        (c.desc ? '<div class="cd">' + fmt(c.desc) + '</div>' : '') +
        code,
        stHtml + (st && st.msg ? '<div class="cm">' + esc(st.msg) + '</div>' : '')
      ];
    });
    var head = (autoFix && autoFix.applied)
      ? '<div class="ai-sub">自动改码：<span class="hl-warn">已应用 ' + autoFix.applied + ' 处</span>' + (autoFix.needsRestart ? ' · 待引擎重启生效' : '') + '</div>'
      : '';
    return head + FTable.html({
      cols: [
        { label: '改动内容（文件 · 说明 · 代码）', align: 'l', wrap: true },
        { label: '状态', align: 'c', w: '110px' }
      ],
      rows: rows,
      maxH: 0,
      empty: '暂无代码修改'
    });
  }
  /* 亏损归因：模型未返回时用快照数据生成诚实说明，保证报表不空白（强制亏损归因） */
  function renderLossAnalysis(r) {
    var la = r.lossAnalysis;
    if (la && la.length) return renderAnaList(la);
    var bt = r.backtest || {};
    var closed = (bt.closed || 0), wins = (bt.wins || 0), losses = (bt.losses || 0);
    var open = (r.trades || []).filter(function (t) { return t.outcome === '持仓中'; }).length;
    var msg;
    if (!losses) {
      msg = '回测区间已平 **' + closed + ' 笔**（盈利 ' + wins + ' / 亏损 0），**暂无已平亏损可供归因**。当前 ' + open + ' 笔持仓中，浮亏原因见「未平仓位监控」。';
    } else {
      msg = '模型未返回亏损归因，但回测显示已平亏损 **' + losses + ' 笔**——请查看「全部交易明细」中归类为「亏损」的行逐笔核对（净USD<0）。';
    }
    return '<div class="ai-empty">' + fmt(msg) + '</div>';
  }
  /* 未平仓位监控：由全部交易实时聚合，统一 FTable 表格 + 阈值建议 */
  function renderOpenMonitor(trades) {
    if (!FT_FTBL) return '';
    var open = (trades || []).filter(function (t) { return t.outcome === '持仓中'; });
    if (!open.length) return '<div class="ai-empty">暂无未平仓位</div>';
    var d = { '多': 0, '空': 0 }, adds = {}, inst = {};
    open.forEach(function (t) {
      var dir = (t.dir === '空') ? '空' : '多';
      d[dir]++;
      var a = t.adds || 0; adds[a] = (adds[a] || 0) + 1;
      inst[t.inst] = (inst[t.inst] || 0) + 1;
    });
    var added = open.filter(function (t) { return (t.adds || 0) > 0; }).length;
    var noAdd = open.length - added;
    var avg = open.reduce(function (s, t) { return s + (t.adds || 0); }, 0) / open.length;
    var top = Object.keys(inst).map(function (k) { return { inst: k, n: inst[k] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
    var stats = [
      ['未平仓位总数', num(open.length, 0)],
      ['多 / 空', num(d['多'], 0) + ' / ' + num(d['空'], 0)],
      ['已加仓 / 未加仓', num(added, 0) + ' / ' + num(noAdd, 0)],
      ['平均加仓次数', num(avg, 2)]
    ];
    return '<div class="ai-sub">📡 未平仓位监控（实时聚合自交易明细）</div>' +
      FTable.html({
        cols: [{ label: '指标', align: 'l', w: '160px' }, { label: '数值', w: '140px' }],
        rows: stats.map(function (x) { return [esc(x[0]), '<span class="flat">' + x[1] + '</span>']; }),
        maxH: 0,
        empty: '暂无'
      }) +
      '<div class="ai-sub">监控阈值建议（基于当前引擎规则）</div>' +
      '<div class="ai-root">' +
      '· <b>止盈线</b>：浮盈 ≥ <b>+5%</b> 自动止盈<br>' +
      '· <b>加仓触发</b>：浮亏 > <b>0%</b> 且出现买卖信号(零轴翻转)同向 + 满 1h 间隔<br>' +
      '· <b>浮亏预警</b>：单仓浮亏 ≥ <b>-2%</b> 进入加仓关注区，留意同向信号<br>' +
      '· <b>持仓超时</b>：> 24h 未平且未加仓，关注方向与信号<br>' +
      '· 单笔实时浮盈/浮亏详见「实时持仓」面板' +
      '</div>' +
      (top.length ? '<div class="ai-sub">持仓最集中合约（Top 8）</div>' +
        FTable.html({
          cols: [{ label: '合约', align: 'l', w: '160px' }, { label: '持仓数', w: '90px' }],
          rows: top.map(function (x) { return ['<span class="inst">' + esc(x.inst) + '</span>', num(x.n, 0)]; }),
          maxH: 0,
          empty: '暂无'
        }) : '');
  }

  /* ===== 每小时 AI 总结（历史）：FTable 分页表 + 点击行在鼠标左侧弹详情浮窗 ===== */
  function loadHist() {
    var wrap = document.getElementById('ft-ai-hist');
    if (!wrap) return;
    fetch('/api/okx/ai_history?page=' + aiHistPage + '&per=' + aiHistPer + '&v=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) { wrap.innerHTML = '<div class="ai-empty">历史加载失败</div>'; return; }
        aiHistPage = d.page; renderHistTable(d);
      })
      .catch(function () { wrap.innerHTML = '<div class="ai-empty">历史加载失败</div>'; });
  }
  function renderHistTable(d) {
    var wrap = document.getElementById('ft-ai-hist'); if (!wrap) return;
    if (!FT_FTBL) { wrap.innerHTML = '<div class="ai-empty">FTable 组件未加载</div>'; return; }
    var items = d.items || [];
    if (!items.length) { wrap.innerHTML = '<div class="ai-empty">暂无历史（每次 AI 分析后自动保存，保留最近 200 份）</div>'; return; }
    var rows = items.map(function (x) {
      var net = x.netUsd == null ? null : +x.netUsd;
      return {
        cls: 'hist-row', attrs: 'data-id="' + esc(x.id) + '"',
        cells: [
          '<span class="mono">' + esc(x.id) + '</span>',
          '<span style="display:inline-block;max-width:270px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom" title="' + esc(x.verdict || '') + '">' + esc((x.verdict || '').slice(0, 60)) + '</span>',
          '<span class="' + (net == null ? 'flat' : (net >= 0 ? 'up' : 'dn')) + '">' + (net == null ? '—' : sgn(net, 4)) + '</span>',
          (x.winRate == null ? '—' : num(x.winRate, 2) + '%'),
          num(x.closed, 0) + ' / ' + num(x.open, 0),
          num(x.floats, 0),
          num(x.codes, 0) + (x.autoFixApplied ? ' <span class="hl-warn">✦改' + x.autoFixApplied + '</span>' : ''),
          '<span class="hist-open">详情 »</span>'
        ]
      };
    });
    FTable.render(wrap, {
      cols: [
        { label: '时间', align: 'l', w: '130px' },
        { label: '结论', align: 'l', wrap: false, w: '280px' },
        { label: '净USD', w: '100px' },
        { label: '胜率', w: '70px' },
        { label: '平/持', w: '70px' },
        { label: '浮亏归因', w: '80px' },
        { label: '代码改动', w: '80px' },
        { label: '操作', w: '60px' }
      ],
      rows: rows,
      maxH: 460,
      empty: '暂无历史',
      pager: {
        page: aiHistPage, pages: d.pages || 1, total: d.total, unit: '次', per: aiHistPer, perOpts: [10, 20, 50],
        onPage: function (p) { aiHistPage = p; loadHist(); },
        onPer: function (v) { aiHistPer = v; aiHistPage = 1; loadHist(); }
      }
    });
    /* 事件委托：点击行任意位置 → 在鼠标左侧打开详情浮窗 */
    wrap.onclick = function (e) {
      var tr = e.target && e.target.closest ? e.target.closest('tr.hist-row') : null;
      if (tr && tr.getAttribute('data-id')) openHistModal(tr.getAttribute('data-id'), e.clientX, e.clientY);
    };
  }
  /* ===== 详情浮窗：★出现在鼠标点击位置左侧（像右键菜单一样贴着鼠标弹出） =====
   * 透明捕获层 + fixed 浮窗；点空白处 / ✕ / Esc 关闭 */
  var _histEscH = null;
  function closeHistModal() {
    var ov = document.getElementById('ft-ai-modal-ov');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    if (_histEscH) { document.removeEventListener('keydown', _histEscH); _histEscH = null; }
  }
  function openHistModal(id, mx, my) {
    try {
      closeHistModal();
      var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
      mx = (typeof mx === 'number' && isFinite(mx)) ? mx : vw / 2;
      my = (typeof my === 'number' && isFinite(my)) ? my : vh / 3;
      var w = Math.min(880, vw - 28);
      var ov = document.createElement('div');
      ov.id = 'ft-ai-modal-ov';
      ov.innerHTML = '<div class="ai-modal"><div class="ai-modal-hd"><h4>🕐 AI 分析详情 · ' + esc(id) +
        '（北京时间）</h4><button class="ai-modal-x" type="button">✕</button></div>' +
        '<div class="ai-modal-bd"><div class="ai-empty">加载中…</div></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) { if (e.target === ov) closeHistModal(); });
      var xb = ov.querySelector('.ai-modal-x');
      if (xb) xb.addEventListener('click', closeHistModal);
      _histEscH = function (e) { if (e && e.key === 'Escape') closeHistModal(); };
      document.addEventListener('keydown', _histEscH);
      /* ★定位：右缘贴鼠标左侧 14px；左侧放不下则贴鼠标右侧；纵向贴点击点 */
      var el = ov.querySelector('.ai-modal');
      var left = mx - w - 14;
      if (left < 8) left = Math.min(mx + 14, vw - w - 8);
      if (left < 8) left = 8;
      var top = Math.max(8, Math.min(my - 30, vh - 160));
      el.style.width = w + 'px';
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      var bd = ov.querySelector('.ai-modal-bd');
      fetch('/api/okx/ai_history_detail?id=' + encodeURIComponent(id) + '&v=' + Date.now())
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok) { bd.innerHTML = '<div class="ai-empty">' + esc((d && d.err) || '加载失败') + '</div>'; return; }
          var r = d.report || {};
          var bt = r.backtest || {};
          var autoFix = r.autoFix || {};
          var h = '<div class="ai-verdict"><b>结论 · </b>' + fmt(r.verdict || '（无）') + '</div>' +
            '<div class="ai-meta-m">🕐 ' + esc(r.generatedAtBj || '') + ' · ' + esc(r.engine || r.source || '') +
            ' · 净USD <b class="' + ((bt.netUsd || 0) >= 0 ? 'up' : 'dn') + '">' + sgn(bt.netUsd || 0, 4) + '</b>' +
            ' · 胜率 ' + num(bt.winRate, 2) + '%（平 ' + num(bt.closed, 0) + ' / 持 ' + num(bt.open, 0) + '）</div>' +
            (r.rootCause ? '<h5 class="ai-gap">🧭 根因总结</h5><div class="ai-root">' + fmt(r.rootCause) + '</div>' : '') +
            '<h5 class="ai-gap">📉 每小时浮亏归因</h5>' + renderFloatLoss(r) +
            '<h5 class="ai-gap">✅ 盈利归因</h5>' + renderAnaList(r.profitAnalysis, '暂无') +
            '<h5 class="ai-gap">❌ 亏损归因</h5>' + renderAnaList(r.lossAnalysis, '暂无') +
            ((r.codeChanges || []).length ? '<h5 class="ai-gap">🛠 修改的代码（表格 · 自动应用状态）</h5>' +
              renderCodeTable(r.codeChanges, autoFix) : '') +
            (r.backtestText && r.backtestText.summary ? '<h5 class="ai-gap">🧪 回测结论</h5><div class="ai-root">' + fmt(r.backtestText.summary) + '</div>' : '') +
            ((r.conclusions || []).length ? '<h5 class="ai-gap">✅ 改进与建议（表格）</h5>' + renderConclTable(r.conclusions) : '');
          bd.innerHTML = h;
          bd.scrollTop = 0;
          /* 内容载入后纵向夹取：浮窗不得超出视口下缘 */
          var mh = el.offsetHeight || 0;
          if (top + mh > vh - 8) top = Math.max(8, vh - 8 - mh);
          el.style.top = top + 'px';
        })
        .catch(function (e) { bd.innerHTML = '<div class="ai-empty">加载失败: ' + esc(String(e && e.message || e)) + '</div>'; });
    } catch (e) {
      if (global && global.console) global.console.error('[ft-ai] 弹窗异常:', e);
    }
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
      /* 右：亏损归因 + 浮亏归因 + 根因 + 代码修改(表格) + 结论建议(表格) + 窗口 */
      '<div class="ai-col"><h5>❌ 亏损归因（全部亏损笔 · 为什么亏）</h5>' +
      renderLossAnalysis(r) +
      '<h5 class="ai-gap">📉 每小时浮亏归因（持仓中 · 为什么亏）</h5>' +
      renderFloatLoss(r) +
      (r.rootCause ? '<h5 class="ai-gap">🧭 强制根因总结</h5><div class="ai-root">' + fmt(r.rootCause) + '</div>' : '') +
      '<h5 class="ai-gap">🛠 修改的代码（表格 · 自动应用状态）</h5>' +
      renderCodeTable(r.codeChanges, r.autoFix) +
      (concl.length ? '<h5 class="ai-gap">✅ 改进与建议（表格）</h5>' + renderConclTable(concl) : '') +
      '<h5 class="ai-gap">🕐 分析数据窗口（北京时间）</h5>' +
      (pb ? '<div class="ai-window">' +
        '<div><span>起</span>' + esc(pb.from || '—') + '</div>' +
        '<div><span>止</span>' + esc(pb.to || '—') + '</div>' +
        '<div><span>跨度</span>' + esc(pb.spanText || '—') + ' · ' + esc(pb.events) + ' 笔事件</div>' +
        '</div>' : '<div class="ai-empty">—</div>') +
      '</div></div>' +
      /* ===== 全宽大表区：分合约 → 逐笔明细 → 每笔事件明细 → 未平仓监控 → 回测汇总 ===== */
      '<h5 class="ai-gap">📊 分合约净USD · 胜率（报表 · 分页 · 全宽）</h5>' +
      '<div id="ft-ai-inst" class="ai-inst-wrap"></div>' +
      '<h5 class="ai-gap">📋 全部交易明细（逐笔 · 全量 · 分页 · 含实时浮亏）</h5>' +
      '<div id="ft-ai-trades" class="ai-trades-wrap"></div>' +
      '<h5 class="ai-gap">📜 每笔事件明细（买入/卖出/加仓/平仓 · 每笔带原因 · 分页）</h5>' +
      '<div id="ft-ai-events" class="ai-trades-wrap"></div>' +
      renderOpenMonitor(r.trades) +
      '<h5 class="ai-gap">🧪 回测全量汇总</h5>' +
      renderBacktestBox(r.backtest) +
      (r.backtestText && r.backtestText.summary ? '<div class="ai-sub">AI 回测结论</div><div class="ai-root">' + fmt(r.backtestText.summary) + '</div>' : '') +
      /* 每小时 AI 总结（历史 · 分页 · 点击行在鼠标左侧弹详情浮窗） */
      '<h5 class="ai-gap">🕐 每小时 AI 总结（历史 · 分页 · 点击行看详情浮窗）</h5>' +
      '<div id="ft-ai-hist"></div>' +
      '<div class="ai-lock">🔒 <b>AI 不可修改</b>：' + esc(lock.join(' / ')) +
      ' ｜ 每笔 <b>' + esc(eff.entryUsd) + '$</b> · 加仓 <b>' + esc(eff.addUsd) + '$</b> · 周期 <b>' + esc((eff.tfs || []).join(',')) + '</b>' +
      ' ｜ 当前生效：<span class="hl-warn">止盈 ' + esc(eff.tpPct) + '%</span> / <span class="hl-warn">加仓浮亏 ' + esc(eff.addLossPct) + '%</span> / 间隔 ' + esc(Math.round((eff.addIntervalMs || 0) / 60000)) + ' 分钟' +
      ' ｜ 加仓需<b>买卖信号(零轴翻转)同向</b>' +
      (d.rejected && d.rejected.length ? ' ｜ <span class="hl-red">已拒绝参数：' + esc(d.rejected.join('、')) + '</span>' : '') +
      '</div></div>';
    el.innerHTML = h;
    renderInstSummaryInto(r.trades);
    renderTradesTableInto(r.trades);
    renderEventsTableInto(r.signals);
    renderBtInstInto(r.backtest);
    loadHist();
    renderAiOverview(lastSummary);
    aiMountCharts(r.charts);
    bindInstClicks(el);
  }
  /* ★AI 交易总览：统一 FTable 表格（随主面板每 3 秒轻量刷新，不重建整个 AI 面板） */
  function renderAiOverview(summary) {
    var el = document.getElementById('ft-ai-overview'); if (!el) return;
    if (!FT_FTBL) { el.innerHTML = ''; return; }
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
    FTable.render(el, {
      cols: [{ label: '指标', align: 'l', w: '200px' }, { label: '数值', w: '160px' }],
      rows: rows.map(function (x) {
        return [esc(x[0]), '<span class="' + x[2] + '">' + x[1] + '</span>'];
      }),
      maxH: 0,
      empty: '暂无'
    });
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
