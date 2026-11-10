/* ============================================================================
 * web/js/ui/btpanel.js —— 总览底部「多策略族 × 多操作 · 极低胜率反向回测」面板
 * BUILD 20261107h1 ｜ 数据源 /web/bt/multi_inverse.json（唯一）｜ 图表 BTChart(chartkit.js)
 *
 * 7 个选项卡：5分钟 / 15分钟 / 1小时 / 三周期对比 / 极值搜索 / 每天几百笔 / 策略族与结论
 * 完全替代上一版(g1)的曲线与明细：本轮 10 策略族 × 4 持仓操作 × 6 档 × 双腿 × 3 周期，
 * 39.5 万组合三层搜索(极值/统计/高频/每天几百笔)，IS 挑组合、OOS 单独验证、无条件基线对比。
 * ========================================================================== */
(function (global) {
  'use strict';
  var CK = null, D = null;
  var S = { tab: '1h', page: 0, pageSize: 50 };
  var CSS_IN = false;
  var esc, num, sgn, row;
  var TFL = { '1h': '1小时', 'ALL': '合并' };   // ★2026-11-07 5m/15m 已彻底删除
  var COLS = ['#31c99a', '#3d7bff', '#e0a33a', '#ff6b7d'];

  function css() {
    if (CSS_IN) return; CSS_IN = true;
    var st = document.createElement('style'); st.setAttribute('data-btmi', '1');
    st.textContent =
      '#bt-causal-panel{background:#0e1728;border:1px solid #263553;border-radius:12px;padding:16px 18px;margin:16px 0 30px;color:#dbe6ff;font:13px/1.6 "Microsoft YaHei",sans-serif}' +
      '#bt-causal-panel h3{margin:0 0 8px;font-size:16px;color:#cfe0ff}' +
      '#bt-causal-panel h4{margin:14px 0 7px;font-size:12.5px;color:#8fa6d0}' +
      '#bt-causal-panel .sub{color:#8b9abc;font-size:12px;margin-bottom:10px}' +
      '#bt-causal-panel .hot{color:#ff7d8f;font-weight:700}#bt-causal-panel .mut{opacity:.55}' +
      '#bt-causal-panel .up{color:#ff6b7d;font-weight:600}#bt-causal-panel .dn{color:#31c99a;font-weight:600}' +
      '#bt-causal-panel .sec{background:#121e33;border:1px solid #243553;border-radius:9px;padding:12px 14px;margin-bottom:12px}' +
      '#bt-causal-panel .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}' +
      '#bt-causal-panel .kpis.k2{grid-template-columns:repeat(2,1fr)}' +
      '#bt-causal-panel .kpi{background:#16233b;border:1px solid #2b3f63;border-top:3px solid #3d7bff;border-radius:8px;padding:10px 12px}' +
      '#bt-causal-panel .kpi .kl{font-size:11px;color:#8fa6d0;font-weight:700}' +
      '#bt-causal-panel .kpi .kv{font-size:18px;font-weight:800;margin:3px 0}' +
      '#bt-causal-panel .kpi .ks{font-size:11px;color:#8b9abc}' +
      '#bt-causal-panel .kpi.good{border-top-color:#31c99a}#bt-causal-panel .kpi.bad{border-top-color:#ff6b7d}' +
      '#bt-causal-panel .kpi.warn{border-top-color:#e0a33a}' +
      '#bt-causal-panel .tw{overflow:auto;max-height:480px;border:1px solid #263553;border-radius:7px}' +
      '#bt-causal-panel table{width:100%;border-collapse:collapse;font-size:11.5px}' +
      '#bt-causal-panel th{background:#1b2a45;color:#a9c2ee;text-align:right;padding:6px 9px;position:sticky;top:0;white-space:nowrap;z-index:1}' +
      '#bt-causal-panel td{text-align:right;padding:5px 9px;border-top:1px solid #22314e;white-space:nowrap}' +
      '#bt-causal-panel th:first-child,#bt-causal-panel td:first-child{text-align:left}' +
      '#bt-causal-panel table.kv td:first-child{width:220px;color:#8fa6d0;white-space:normal}' +
      '#bt-causal-panel table.kv td{text-align:left;white-space:normal}' +
      '#bt-causal-panel .verdict{background:#2e2415;border:1px solid #7a5a1e;border-radius:9px;padding:12px 14px;margin-bottom:12px;color:#f0d49a;font-size:13px;line-height:1.75}' +
      '#bt-causal-panel .verdict.bad{background:#2e1c1c;border-color:#7a2f2f;color:#f0b3b3}' +
      '#bt-causal-panel .verdict.ok{background:#1c2a1e;border-color:#2f6b3e;color:#bfe9c8}' +
      '#bt-causal-panel .cov{background:#2a2413;border:1px solid #5b4a1e;border-radius:7px;padding:8px 11px;color:#e8c98a;font-size:12px;margin-bottom:10px}' +
      '#bt-causal-panel a{color:#7fa8ff}' +
      '#bt-causal-panel .tabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 12px;border-bottom:1px solid #263553;padding-bottom:9px}' +
      '#bt-causal-panel .tabs button{background:#16233b;border:1px solid #30456c;color:#cfe0ff;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12.5px}' +
      '#bt-causal-panel .tabs button.on{background:#3d7bff;color:#fff;border-color:#3d7bff;font-weight:700}' +
      '#bt-causal-panel .charts{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
      '#bt-causal-panel .chartbox{background:#121e33;border:1px solid #243553;border-radius:9px;padding:10px 12px;margin-bottom:12px}' +
      '#bt-causal-panel .chartbox.full{grid-column:1 / -1}' +
      '#bt-causal-panel .pager{display:flex;gap:6px;align-items:center;justify-content:flex-end;margin-top:9px;font-size:12px;color:#8b9abc}' +
      '#bt-causal-panel .pager button{background:#16233b;border:1px solid #30456c;color:#cfe0ff;border-radius:5px;padding:3px 10px;cursor:pointer}' +
      '#bt-causal-panel .pager button:disabled{opacity:.35;cursor:default}' +
      '#bt-causal-panel .tag{display:inline-block;background:#243553;border:1px solid #3a4e75;border-radius:4px;padding:1px 7px;margin-right:5px;font-size:11px;color:#cfe0ff}' +
      '#bt-causal-panel .tag.g{background:#1c3a2c;border-color:#2f6b3e;color:#bfe9c8}' +
      '#bt-causal-panel .tag.r{background:#3a1f1f;border-color:#7a2f2f;color:#f0b3b3}' +
      '#bt-causal-panel .tag.y{background:#3a3117;border-color:#7a5a1e;color:#f0d49a}' +
      '@media(max-width:980px){#bt-causal-panel .kpis,#bt-causal-panel .charts{grid-template-columns:1fr}#bt-causal-panel .kpis.k2{grid-template-columns:1fr 1fr}}';
    document.head.appendChild(st);
  }

  function sec(title, note, body) {
    return '<div class="sec"><h4>' + title + '</h4>' + (note ? '<div class="sub">' + note + '</div>' : '') + body + '</div>';
  }
  function table(head, rows, cls) {
    var h = '<div class="tw"><table class="' + (cls || '') + '"><thead><tr>' +
      head.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) { h += '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; });
    return h + '</tbody></table></div>';
  }
  function pct(v) { return (v == null ? '—' : num(v, 2) + ' %'); }
  function bp(v) { return sgn(v, 1, ' bp'); }
  function kpiCard(kl, kv, ks, cls) {
    return '<div class="kpi ' + (cls || '') + '"><div class="kl">' + kl + '</div><div class="kv">' + kv + '</div><div class="ks">' + (ks || '') + '</div></div>';
  }
  function tfLabel(id) { return TFL[id] || esc(String(id)); }
  function isPeriodTab() { return S.tab === '1h'; }   // ★2026-11-07 5m/15m 已彻底删除
  function curPeriod() { return D.periods[S.tab] || D.combined; }

  /* ---------------------------------------------------------------- 顶部结论 */
  function verdictHtml() {
    var v = D.verdict, q = v.qualifying || {};
    return '<div class="verdict bad">' +
      '<b>★ 直接回答：反转以后并没有赚更多。</b><br>' +
      '符合「IS 胜率 &lt;10% 且样本 ≥30 笔」的组合共 <b>' + num(q.count || 0, 0) + '</b> 个，' +
      '其中样本外有足够样本的仅 <b>' + num(q.withOos || 0, 0) + '</b> 个，' +
      '反转后 OOS 平均胜率 <b class="hot">' + pct(q.avgInvOosWinRate) + '</b>' +
      '（' + num(q.minInvOosWinRate, 2) + '% ~ ' + num(q.maxInvOosWinRate, 2) + '%），低于 50%。<br>' +
      '<span class="mut">' + esc(v.identity) + '</span><br>' +
      '<b>保证盈利：' + esc(v.guarantee) + '</b></div>';
  }

  /* ---------------------------------------------------------------- 周期 Tab（L0 极值策略） */
  function renderPeriod() {
    var p = curPeriod(), k = p.kpi, v = D.verdict;
    var selRows = (p.picks || []).map(function (g) {
      return [esc(g.tf), esc(g.fam), esc(g.op), '档' + g.buck, esc(g.dirLabel),
        num(g.isN, 0), '<span class="tag g">' + pct(g.isWinRate) + '</span>',
        pct(g.invIsWinRate), num(g.oosN, 0), pct(g.invOosWinRate), esc(g.layer)];
    });
    var selSec = sec('本周期选中的「极低胜率」组合（IS 挑出，OOS 单列）',
      '主策略取极值层 L0 每腿 IS 胜率最低的组合；样本外不参与挑选。',
      table(['周期', '策略族', '操作', '档位', '原方向', 'IS笔数', 'IS胜率', '反转IS胜率', 'OOS笔数', '反转OOS胜率', '层'],
        selRows.length ? selRows : [['<span class="mut">无</span>', '', '', '', '', '', '', '', '', '', '']]));

    var kpis = [
      kpiCard('反向后 全期胜率', pct(k.winRate), '含恒等式效应', k.winRate > 50 ? 'good' : 'bad'),
      kpiCard('样本内(IS) 胜率', pct(k.isWinRate), '方向取反 → 必然高', 'good'),
      kpiCard('样本外(OOS) 胜率', pct(k.oosWinRate), num(k.oosN, 0) + ' 笔 · 真检验', k.oosWinRate > 50 ? 'good' : 'bad'),
      kpiCard('成交笔数', num(k.n, 0), '平局 ' + num(k.flat, 0) + ' 笔'),
      kpiCard('毛收益(0bp)', bp(k.totalProfitBp), 'Σ 反转收益'),
      kpiCard('maker净(−2bp)', bp(k.netMakerBp), k.netMakerBp > 0 ? '为正' : '为负', k.netMakerBp > 0 ? 'good' : 'bad'),
      kpiCard('taker净(10bp)', bp(k.netTakerBp), '实盘近似', k.netTakerBp > 0 ? 'good' : 'bad'),
      kpiCard('复合收益 / 回撤', sgn(p.curve.compoundPct, 2, ' %') + ' / ' + pct(p.curve.maxDrawdownPct), '本周期 · 起始100')
    ].join('');

    var oosHtml = '<div class="kpis k2">' +
      kpiCard('OOS 反转胜率', pct(k.oosWinRate), num(k.oosN, 0) + ' 笔', 'warn') +
      kpiCard('无条件反向基线(OOS)', pct(v.baseline.buy.invOosWinRate), '无脑卖空 · 非选组合', 'warn') +
      kpiCard('相对基线超额', sgn(k.oosWinRate - v.baseline.buy.invOosWinRate, 2, ' pp'), '薄', (k.oosWinRate - v.baseline.buy.invOosWinRate) > 3 ? 'good' : 'bad') +
      kpiCard('OOS 扣 taker 全费', bp(k.oosNetTakerBp), '每笔 ' + num(k.oosN ? k.oosNetTakerBp / k.oosN : 0, 2) + ' bp', k.oosNetTakerBp > 0 ? 'good' : 'bad') +
      '</div><div class="cov">' + esc(v.why99IsNoise) + '</div>';
    var oosSec = sec('严格样本外验证 · ' + tfLabel(S.tab), '判断「反向做是否真的成功率更高」的唯一有效口径。', oosHtml);

    var tr = p.trades || [], total = p.tradesTotal || tr.length;
    var maxPage = Math.max(0, Math.ceil(tr.length / S.pageSize) - 1);
    if (S.page > maxPage) S.page = maxPage;
    var slice = tr.slice(S.page * S.pageSize, (S.page + 1) * S.pageSize);
    var detailRows = slice.map(function (t) {
      return [esc(String(t.iso).replace('T', ' ').slice(0, 19)), esc(t.inst), esc(t.fam), esc(t.op),
        (t.dir > 0 ? '卖空 → <b>买多</b>' : '买多 → <b>卖空</b>'),
        num(t.c0, 4), num(t.c1, 4), sgn(t.origRet, 1, ''), sgn(t.ret, 1, ''),
        t.hit ? '<span class="up">盈</span>' : '<span class="dn">亏</span>', t.oos ? '样本外' : '样本内'];
    });
    var pager = '<div class="pager">' +
      '<span>共 ' + num(total, 0) + ' 笔' + (p.tradesTruncated ? '（明细前 ' + num(tr.length, 0) + ' 笔，完整见 CSV）' : '') + '</span>' +
      '<button data-page="prev" ' + (S.page <= 0 ? 'disabled' : '') + '>上一页</button>' +
      '<span>' + (S.page + 1) + ' / ' + (maxPage + 1) + '</span>' +
      '<button data-page="next" ' + (S.page >= maxPage ? 'disabled' : '') + '>下一页</button></div>';
    var detailSec = sec('逐笔明细（分页） · ' + tfLabel(S.tab), '信号 UTC；收盘→持 N 根后收盘成交；反转收益 = −原方向收益。',
      table(['信号UTC', '标的', '策略族', '操作', '原方向 → 反向', '收盘', '平仓', '原收益bp', '反转收益bp', '结果', '区间'],
        detailRows.length ? detailRows : [['<span class="mut">无逐笔数据</span>', '', '', '', '', '', '', '', '', '', '']]) + pager);

    var feeRows = (k.cost || []).map(function (f) {
      return [esc(f.label), bp(f.netBp), pct(f.netPct), f.netBp > 0 ? '<span class="dn">为正</span>' : '<span class="up">为负</span>'];
    });
    var feeSec = sec('费用敏感', '净额 = 毛bp − 笔数 × 每笔成本。', table(['每笔成本', '净bp', '净%', '判定'], feeRows, 'kv'));

    var worst = (p.worstDays || []).slice(0, 12).map(function (x) {
      return [esc(x.day), num(x.n, 0), bp(x.origBp), bp(x.invBp)];
    });
    var worstSec = sec('每天亏损最多 · ' + tfLabel(S.tab), '原始（反转前）方向按日合计；反转后即当日盈利。',
      table(['日期', '笔数', '原策略当日bp', '反转后当日bp'], worst.length ? worst : [['<span class="mut">无</span>', '', '', '']]));

    return selSec + '<div class="kpis">' + kpis + '</div>' + oosSec +
      '<div class="charts">' +
      '<div class="chartbox"><h4>净值曲线（起始100）</h4><div id="btmi-eq"></div></div>' +
      '<div class="chartbox"><h4>累计盈利曲线（bp）</h4><div id="btmi-cum"></div></div>' +
      '<div class="chartbox full"><h4>扣费曲线（4 档成本，逐日累计 bp）</h4><div id="btmi-fee"></div></div>' +
      '<div class="chartbox"><h4>逐月盈亏</h4><div id="btmi-month"></div></div>' +
      '<div class="chartbox"><h4>逐笔盈亏</h4><div id="btmi-trade"></div></div>' +
      '</div>' + worstSec + detailSec + feeSec;
  }

  /* ---------------------------------------------------------------- 三周期对比 */
  function renderCompare() {
    var m = D.meta, v = D.verdict;
    var rows = (D.compare.rows || []).map(function (r) {
      return ['<b>' + esc(tfLabel(r.tf)) + '</b>', num(r.n, 0), pct(r.winRate), pct(r.isWinRate),
        pct(r.oosWinRate), bp(r.totalProfitBp), bp(r.netMakerBp), bp(r.netTakerBp),
        num(r.days, 0), num(r.avgPerDay, 0), num(r.maxPerDay, 0)];
    });
    var cmp = sec('L0 极值策略 · 三周期对照', '每周期买多/卖空各取 IS 最低胜率组合，反转后独立回测。',
      table(['周期', '笔数', '反转全期胜率', '反转IS胜率', '反转OOS胜率', '毛bp', 'maker净', 'taker净', '活跃天数', '日均笔数', '单日最多'], rows));

    var hf = D.hf.combined, hf2 = D.hf2.combined;
    var layerRows = [
      ['<b>L0 极值层</b>', '每周期每腿 IS 最低胜率（可 n=1）', num(D.combined.kpi.n, 0), pct(D.combined.kpi.winRate), pct(D.combined.kpi.oosWinRate), bp(D.combined.kpi.netTakerBp), num(D.combined.dailyStats.avgPerDay, 0)],
      ['<b>L2 高频层</b>', '日均 ≥100 笔（实际日均上万）', num(hf.kpi.n, 0), pct(hf.kpi.winRate), pct(hf.kpi.oosWinRate), bp(hf.kpi.netTakerBp), num(hf.dailyStats.avgPerDay, 0)],
      ['<b>L2b 每天几百笔</b>', '日均 200~1000 笔', num(hf2.kpi.n, 0), pct(hf2.kpi.winRate), pct(hf2.kpi.oosWinRate), bp(hf2.kpi.netTakerBp), num(hf2.dailyStats.avgPerDay, 0)]
    ];
    var cmp2 = sec('三条策略线 · 反转后对照', '同一套「挑最低 IS 胜率 → 反转」逻辑，只是样本规模约束不同。',
      table(['策略线', '筛选口径', '笔数', '全期胜率', 'OOS胜率', '扣taker全费净', '日均笔数'], layerRows) +
      '<div class="verdict bad"><b>关键：贴着「每天几百笔」口径做，反转后扣 taker 全费是亏的（' + bp(hf2.kpi.netTakerBp) + '）。</b> ' +
      '日均上万的 L2 线看似巨赚，但那是 ' + num(hf.kpi.n, 0) + ' 笔逐笔算术和 + 数据期单边漂移，不是资金收益。</div>');

    var baseRows = [
      ['无脑买多', num(v.baseline.buy.n, 0), pct(v.baseline.buy.winRate), pct(v.baseline.buy.invWinRate), pct(v.baseline.buy.invOosWinRate)],
      ['无脑卖空', num(v.baseline.sell.n, 0), pct(v.baseline.sell.winRate), pct(v.baseline.sell.invWinRate), pct(v.baseline.sell.invOosWinRate)]
    ];
    var baseSec = sec('无条件基线（不看任何条件）', esc(v.baseline.note),
      table(['基线', '事件数(含族重复)', '原胜率', '反转后胜率', '反转后OOS胜率'], baseRows) +
      '<div class="cov">L2 高频反转 ' + pct(v.hf.afterWinRate) + ' vs 基线 ' + pct(v.hf.baseWinRate) +
      '，超额 ' + sgn(v.hf.excessWinRate, 2, ' pp') + '（OOS ' + sgn(v.hf.excessOosWinRate, 2, ' pp') + '）。' +
      '超额主要来自「极端档位 = 结构性做空偏置」，不是信号预测力；实盘还有资金费率、借币成本与爆仓约束。</div>');

    var clean = m.dataCleaning || {};
    var exRows = (clean.excluded || []).map(function (x) {
      return [esc(x.tf), esc(x.inst), esc(x.src), esc(x.reason), x.sdBp == null ? '—' : num(x.sdBp, 2) + ' bp'];
    });
    var cleanSec = sec('数据清洗 · 稳定币永久禁令', '本轮剔除 ' + num(clean.excludedCount || 0, 0) + ' 项；全部产物中稳定币合约数 = 0。',
      table(['周期', '标的', '市场', '剔除原因', '收益标准差'], exRows.length ? exRows : [['<span class="mut">无</span>', '', '', '', '']]) +
      '<div class="cov">硬约束 ' + esc(clean.module) + '：base 命中稳定币名单，或单根收益标准差 &lt; ' + num(clean.minSdBp || 5, 0) + 'bp（零波动兜底）。所有回测引擎加载标的后第一件事必须调用。</div>');

    return cmp + cmp2 +
      '<div class="charts">' +
      '<div class="chartbox"><h4>L2b「每天几百笔」净值 / 累计</h4><div id="btmi-cmp-eq"></div></div>' +
      '<div class="chartbox"><h4>L2 高频层净值 / 累计</h4><div id="btmi-cmp-hf"></div></div>' +
      '<div class="chartbox full"><h4>两线扣费曲线对比（taker 全费 10bp）</h4><div id="btmi-cmp-fee"></div></div>' +
      '</div>' + baseSec + cleanSec;
  }

  /* ---------------------------------------------------------------- 极值搜索 Tab */
  function renderExtremes() {
    var v = D.verdict, L = D.layers;
    var order = ['L0', 'L1', 'L2', 'L2b'];
    var layerRows = order.map(function (key) {
      var x = L[key];
      return ['<b>' + esc(x.name) + '</b>', esc(x.note), num(x.poolSize, 0),
        '<span class="tag ' + (x.lt1 ? 'r' : 'mut') + '">' + num(x.lt1, 0) + '</span>',
        '<span class="tag ' + (x.lt5 ? 'y' : 'mut') + '">' + num(x.lt5, 0) + '</span>',
        '<span class="tag ' + (x.lt10 ? 'g' : 'mut') + '">' + num(x.lt10, 0) + '</span>',
        '<b>' + pct(x.minIsWinRate) + '</b>', num(x.minIsN, 0)];
    });
    var layerSec = sec('四层搜索 · 目标 5%~10% 胜率 / 亏损率 99%',
      '搜索空间共 ' + num(v.searchSpace, 0) + ' 个组合（粗层 ' + num(v.coarse, 0) + ' + 合约细层 ' + num(v.inst, 0) + ' + 时段细层 ' + num(v.hour, 0) + '）。全部只用 IS 挑，OOS 单独验证。',
      table(['层', '口径', '组合数', '≤1%胜率', '<5%', '<10%', '最低IS胜率', '该组合IS笔数'], layerRows) +
      '<div class="verdict bad"><b>' + esc(v.highFreqNote) + '</b><br>' + esc(v.why99IsNoise) + '</div>');

    var q = v.qualifying || {};
    var qRows = (q.rows || []).map(function (r) {
      return [esc(r.layer), esc(r.tf), esc(r.fam), esc(r.op), '档' + r.buck, esc(r.dirLabel),
        num(r.isN, 0), '<span class="tag g">' + pct(r.isWinRate) + '</span>', pct(r.invIsWinRate),
        num(r.oosN, 0), '<span class="tag ' + (r.invOosWinRate > 50 ? 'g' : 'r') + '">' + pct(r.invOosWinRate) + '</span>', bp(r.sumRet)];
    });
    var qSec = sec('★ 真正达标「IS 胜率 <10% 且 n≥30」的全部组合 · 反转后 OOS 实证',
      '共 ' + num(q.count || 0, 0) + ' 个；其中 OOS 有样本的 ' + num(q.withOos || 0, 0) + ' 个，平均反转 OOS 胜率 <b class="hot">' + pct(q.avgInvOosWinRate) + '</b>。',
      table(['层', '周期', '族', '操作', '档', '原方向', 'IS笔数', 'IS胜率', '反转IS胜率', 'OOS笔数', '反转OOS胜率', '毛bp'],
        qRows.length ? qRows : [['<span class="mut">无</span>', '', '', '', '', '', '', '', '', '', '', '']]) +
      '<div class="cov">这些组合几乎全部落在 VOLAT（波动率）极端档：极高波动时买多结构性亏损、卖空结构性盈利，是市场偏置，不是可复制的择时信号。</div>');

    var topRows = (L.L0.top || []).slice(0, 15).map(function (r) {
      return [esc(r.layer), esc(r.tf), esc(r.fam), esc(r.op), '档' + r.buck, esc(r.dirLabel),
        num(r.isN, 0), pct(r.isWinRate), num(r.oosN, 0), pct(r.invOosWinRate)];
    });
    var topSec = sec('L0 造出的「亏损率 ≥99%」组合（前15）',
      'IS 胜率 0% 看似完美，但 IS 样本多为 1~2 笔；反转后 OOS 只回到 51~58%。',
      table(['层', '周期', '族', '操作', '档', '原方向', 'IS笔数', 'IS胜率', 'OOS笔数', '反转OOS胜率'], topRows));

    var kp = [];
    ['L0', 'L1', 'L2', 'L2b'].forEach(function (key) {
      var x = L[key];
      kp.push(kpiCard(esc(x.name), pct(x.minIsWinRate), '组合 ' + num(x.poolSize, 0) + ' 个 · 最低样本 ' + num(x.minIsN, 0) + ' 笔',
        x.lt10 ? 'good' : 'bad'));
    });
    return '<div class="kpis">' + kp.join('') + '</div>' + layerSec + qSec + topSec +
      '<div class="charts"><div class="chartbox full"><h4>四层最低 IS 胜率 + 达标组合数</h4><div id="btmi-layer"></div></div></div>';
  }

  /* ---------------------------------------------------------------- 每天几百笔 Tab */
  function renderHundreds() {
    var hf2 = D.hf2, hf = D.hf, v = D.verdict, c = hf2.combined;
    var k = c.kpi, ds = c.dailyStats;
    var kpis = [
      kpiCard('反转前 IS 胜率', pct(c.before.winRate), '该层最低档位', 'bad'),
      kpiCard('反转后 全期胜率', pct(k.winRate), num(k.n, 0) + ' 笔', k.winRate > 50 ? 'good' : 'bad'),
      kpiCard('反转后 OOS 胜率', pct(k.oosWinRate), num(k.oosN, 0) + ' 笔', k.oosWinRate > 50 ? 'good' : 'bad'),
      kpiCard('日均笔数', num(ds.avgPerDay, 0), '单日最多 ' + num(ds.maxPerDay, 0)),
      kpiCard('扣 taker 全费净', bp(k.netTakerBp), '★ 实盘近似', k.netTakerBp > 0 ? 'good' : 'bad'),
      kpiCard('OOS 扣 taker 全费', bp(k.oosNetTakerBp), '样本外单独算', k.oosNetTakerBp > 0 ? 'good' : 'bad'),
      kpiCard('复合净值 / 回撤', sgn(c.curve.compoundPct, 2, ' %') + ' / ' + pct(c.curve.maxDrawdownPct), '等权分散口径'),
      kpiCard('相对基线超额(OOS)', sgn(v.hf2 ? k.oosWinRate - v.baseline.buy.invOosWinRate : 0, 2, ' pp'), '无脑反向基线 ' + pct(v.baseline.buy.invOosWinRate), 'warn')
    ].join('');

    var pickRows = (hf2.picks || []).map(function (r) {
      return [esc(tfLabel(r.tf)), esc(r.famName || r.fam), esc(r.op), esc(r.dirLabel),
        pct(r.isWinRate), num(r.perDay, 0), pct(r.invOosWinRate)];
    });
    var pickSec = sec('L2b 选中的组合（每周期买多/卖空各一）', '日均 200~1000 笔，严格对应用户「每天好几百笔交易」。',
      table(['周期', '策略族', '操作', '原方向', 'IS胜率', '日均笔数', '反转OOS胜率'], pickRows));

    var worst = (D.worstDays || []).slice(0, 20).map(function (x) {
      return [esc(x.day), num(x.n, 0), pct(x.loseRate), bp(x.origBp), bp(x.invBp)];
    });
    var worstSec = sec('每天亏损最多 · 排行前20（原始方向）', '反转前亏得越狠的日子，反转后赚得越多——但这只是同一笔钱的镜像。',
      table(['日期', '笔数', '亏损笔占比', '原策略当日bp', '反转后当日bp'], worst));

    var busy = (D.busiestDays || []).slice(0, 15).map(function (x) {
      return [esc(x.day), num(x.n, 0), pct(x.loseRate), bp(x.origBp), bp(x.invBp)];
    });
    var busySec = sec('交易最密集的日期（前15）', '看每天几百笔时，原方向的亏损分布。',
      table(['日期', '笔数', '亏损笔占比', '原策略当日bp', '反转后当日bp'], busy));

    var caveat = '<div class="verdict bad"><b>★ 口径警告（必读）</b><br>' + esc(v.caveat) + '</div>';

    return '<div class="kpis">' + kpis + '</div>' + caveat + pickSec +
      '<div class="charts">' +
      '<div class="chartbox"><h4>L2b 净值曲线（起始100）</h4><div id="btmi-h2-eq"></div></div>' +
      '<div class="chartbox"><h4>L2b 累计盈利（bp）</h4><div id="btmi-h2-cum"></div></div>' +
      '<div class="chartbox full"><h4>L2b 扣费曲线（4 档）</h4><div id="btmi-h2-fee"></div></div>' +
      '<div class="chartbox"><h4>每日亏损（原始方向，前30日）</h4><div id="btmi-h2-loss"></div></div>' +
      '<div class="chartbox"><h4>每日笔数分布</h4><div id="btmi-h2-n"></div></div>' +
      '</div>' + worstSec + busySec;
  }

  /* ---------------------------------------------------------------- 策略族与结论 */
  function renderFamilies() {
    var m = D.meta, v = D.verdict;
    var famRows = (D.famRows || []).slice(0, 40).map(function (r) {
      return [esc(r.tf), '<b>' + esc(r.famName || r.fam) + '</b>', esc(r.opName || r.op), '档' + r.buck, esc(r.dirLabel),
        num(r.isN, 0), pct(r.isWinRate), pct(r.invIsWinRate), num(r.oosN, 0), pct(r.invOosWinRate), num(r.perDay, 0)];
    });
    var famSec = sec('10 策略族 × 4 持仓操作 · IS 最低胜率前40',
      '全部粗层组合（每周期全合约全时段）；「反转OOS胜率」才是有效检验。',
      table(['周期', '策略族', '操作', '档', '方向', 'IS笔数', 'IS胜率', '反转IS胜率', 'OOS笔数', '反转OOS胜率', '日均笔数'], famRows));

    var famDef = sec('策略族与操作定义', '',
      '<table class="kv">' +
      (m.families || []).map(function (f) { return row(esc(f.id), esc(f.name) + ' — ' + esc(f.desc)); }).join('') +
      (m.ops || []).map(function (o) { return row(esc(o.id), esc(o.name) + '（持有 ' + o.h + ' 根）'); }).join('') +
      '</table>');

    var coarseRows = (D.coarseRows || []).slice(0, 20).map(function (r) {
      return [esc(r.tf), esc(r.fam), esc(r.op), '档' + r.buck, esc(r.dirLabel), num(r.isN, 0),
        pct(r.isWinRate), pct(r.invIsWinRate), num(r.oosN, 0), pct(r.invOosWinRate), num(r.perDay, 0)];
    });
    var coarseSec = sec('粗网格证据 · IS 最低胜率前20', '粗层共 ' + num(v.coarse, 0) + ' 组；完整网格见 /web/bt/multi_inverse_grid.csv。',
      table(['周期', '族', '操作', '档', '方向', 'IS笔数', 'IS胜率', '反转IS胜率', 'OOS笔数', '反转OOS胜率', '日均笔数'], coarseRows));

    var meth = sec('方法论 / 口径', '', '<table class="kv">' +
      row('范围', esc(m.scope)) +
      row('数据窗口', esc(m.start) + ' ~ ' + esc(m.end)) +
      row('样本内 / 外切分', esc(m.split)) +
      row('K线 / 标的', num(m.bars, 0) + ' 根 / ' + num(m.instruments, 0) + ' 标的(周期计)') +
      row('因果', esc(m.method)) +
      row('数据清洗', esc(m.dataCleaning.module) + '，剔除 ' + num(m.dataCleaning.excludedCount, 0) + ' 项') +
      row('数据覆盖', esc(m.caveat)) +
      row('成本', '每笔 ' + (m.fees || []).join(' / ') + ' bp；净额 = 毛bp − 笔数 × 成本') +
      row('bp 口径警告', esc(v.caveat)) +
      row('多重比较', esc(v.why99IsNoise)) +
      '</table>');

    var concl = sec('最终判定', '',
      '<div class="verdict bad" style="line-height:1.9">' + esc(v.conclusion) + '</div>' +
      '<table class="kv">' +
      row('算术恒等式', esc(v.identity)) +
      row('能保证盈利吗', esc(v.guarantee)) +
      row('能达到 99% 亏损率吗', v.canReach99 ? '能，但只在 n≈' + num(D.layers.L0.minIsN, 0) + ' 笔的噪声组合里' : '不能') +
      row('每天几百笔的胜率下限', pct(v.dayHundredsFloor)) +
      row('L2b 扣费后', bp(D.hf2.combined.kpi.netTakerBp) + '（亏）') +
      '</table>');

    return famSec + famDef + coarseSec + concl + meth +
      '<div class="charts"><div class="chartbox full"><h4>各族最低 IS 胜率对比</h4><div id="btmi-fam"></div></div></div>';
  }

  /* ---------------------------------------------------------------- 渲染 */
  function render() {
    if (!D || !CK) return;
    var root = document.getElementById('bt-causal-panel');
    var tabs = [['1h', '1小时'],   // ★2026-11-07 5m/15m 选项卡已彻底删除
      ['极值', '极值搜索'], ['几百笔', '每天几百笔'], ['族', '策略族与结论']];
    var bar = '<div class="tabs">' + tabs.map(function (t) {
      return '<button data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' class="on"' : '') + '>' + t[1] + '</button>';
    }).join('') + '</div>';
    var body;
    if (S.tab === '对比') body = renderCompare();
    else if (S.tab === '极值') body = renderExtremes();
    else if (S.tab === '几百笔') body = renderHundreds();
    else if (S.tab === '族') body = renderFamilies();
    else body = renderPeriod();

    root.innerHTML = '<h3>' + esc(D.meta.title) + '</h3>' +
      '<div class="sub">BUILD ' + esc(D.meta.build) + ' ｜ 生成 ' + esc(D.meta.generated) +
      ' ｜ 数据 /web/bt/multi_inverse.json ｜ 图表 BTChart ｜ ' +
      num(D.meta.bars, 0) + ' 根K线 / ' + num(D.verdict.searchSpace, 0) + ' 组合</div>' +
      verdictHtml() + bar + body;

    drawCharts();
    bind();
    root.setAttribute('data-ready', '1');
  }

  /* ---------------------------------------------------------------- 图表（BTChart 最新组件） */
  function lineSeries(id, series, metric, tipFn, height) {
    var el = document.getElementById(id);
    if (!el) return;
    CK.line(el, series, { metric: metric, height: height || 250, theme: 'dark', tip: tipFn });
  }
  function ptsOf(o) { return (o && o.curve && o.curve.points) || []; }
  function feeSeries(pts) {
    return (D.meta.fees || []).map(function (f, i) {
      return { name: (D.meta.feeLabels && D.meta.feeLabels[String(f)]) || (f + 'bp'), color: COLS[i % 4],
        pts: pts.map(function (x) { return { d: x.d, net: x['f' + i], bp: x.bp, eq: x.eq, n: x.n }; }) };
    });
  }
  function drawCharts() {
    var p, pts;
    if (isPeriodTab()) {
      p = curPeriod(); pts = ptsOf(p);
      lineSeries('btmi-eq', [{ name: '净值', color: '#3d7bff', width: 2.4, pts: pts }], 'eq', function (d, ps) {
        var x = ps[0] || {}; return '<div class="t">' + esc(d) + '</div>' + row('净值', num(x.eq, 3)) +
          row('累计盈利', sgn(x.bp, 1, ' bp')) + row('当日笔数', num(x.n, 0));
      });
      lineSeries('btmi-cum', [{ name: '累计盈利', color: '#ff6b7d', width: 2.2, pts: pts }], 'bp', function (d, ps) {
        var x = ps[0] || {}; return '<div class="t">' + esc(d) + '</div>' + row('累计 bp', sgn(x.bp, 1, ' bp')) +
          row('累计 %', sgn(x.pct, 2, ' %')) + row('净值', num(x.eq, 3));
      });
      var fs = feeSeries(pts);
      lineSeries('btmi-fee', fs, 'net', function (d, ps) {
        var h = '<div class="t">' + esc(d) + '</div>' + row('当日笔数', num((ps[0] || {}).n, 0));
        for (var i = 0; i < ps.length; i++) h += row(esc(fs[i].name), sgn(ps[i] ? ps[i].net : 0, 1, ' bp'));
        return h;
      }, 260);
      var monEl = document.getElementById('btmi-month');
      if (monEl) CK.bars(monEl, (p.monthlyBars || []).map(function (x) {
        return { label: x.d, value: x.ret, cumBp: x.cumBp, n: x.n, winRate: x.winRate };
      }), { height: 240, theme: 'dark', metric: 'bp', cumKey: 'cumBp', tip: function (it) {
        return '<div class="t">' + esc(it.label) + '</div>' + row('当月盈亏', sgn(it.value, 1, ' bp')) +
          row('累计', sgn(it.cumBp, 1, ' bp')) + row('笔数 / 胜率', num(it.n, 0) + ' / ' + pct(it.winRate));
      } });
      var trEl = document.getElementById('btmi-trade');
      if (trEl) CK.bars(trEl, (p.tradeBars || []).map(function (x) {
        return { label: x.iso ? String(x.iso).slice(5, 10) : ('#' + x.i), value: x.ret, cumBp: x.cumBp,
          iso: x.iso, isoEnd: x.isoEnd, n: x.n, winRate: x.winRate, inst: x.inst,
          bucketed: x.bucketed, c0: x.c0, c1: x.c1, oos: x.oos, fam: x.fam, op: x.op };
      }), { height: 240, theme: 'dark', metric: 'bp', cumKey: 'cumBp', tip: function (it) {
        var h = '<div class="t">' + esc(it.iso || it.label) + (it.isoEnd ? ' ~ ' + esc(it.isoEnd) : '') + '</div>' +
          row('盈亏', sgn(it.value, 1, ' bp')) + row('累计', sgn(it.cumBp, 1, ' bp'));
        if (it.bucketed) h += row('区间笔数 / 胜率', num(it.n, 0) + ' / ' + pct(it.winRate));
        else h += row('标的 / 族 / 操作', esc(it.inst || '—') + ' / ' + esc(it.fam || '—') + ' / ' + esc(it.op || '—')) +
          row('收盘 → 平仓', num(it.c0, 4) + ' → ' + num(it.c1, 4)) + row('区间', it.oos ? '样本外' : '样本内');
        return h;
      } });
      return;
    }
    if (S.tab === '对比') {
      var a = ptsOf(D.hf2.combined), b = ptsOf(D.hf.combined);
      lineSeries('btmi-cmp-eq', [
        { name: 'L2b 净值', color: '#3d7bff', width: 2.2, pts: a },
        { name: 'L2 净值', color: '#31c99a', width: 2.2, pts: b }
      ], 'eq', function (d, ps) {
        return '<div class="t">' + esc(d) + '</div>' + row('L2b 净值', num((ps[0] || {}).eq, 3)) + row('L2 净值', num((ps[1] || {}).eq, 3));
      });
      lineSeries('btmi-cmp-hf', [
        { name: 'L2b 累计bp', color: '#ff6b7d', width: 2.2, pts: a },
        { name: 'L2 累计bp', color: '#e0a33a', width: 2.2, pts: b }
      ], 'bp', function (d, ps) {
        return '<div class="t">' + esc(d) + '</div>' + row('L2b 累计', sgn((ps[0] || {}).bp, 1, ' bp')) + row('L2 累计', sgn((ps[1] || {}).bp, 1, ' bp'));
      });
      var f2 = feeSeries(a).slice(3, 4), f1 = feeSeries(b).slice(3, 4);
      lineSeries('btmi-cmp-fee', [
        { name: 'L2b taker10bp', color: '#ff6b7d', width: 2.2, pts: f2[0].pts },
        { name: 'L2 taker10bp', color: '#e0a33a', width: 2.2, pts: f1[0].pts }
      ], 'net', function (d, ps) {
        return '<div class="t">' + esc(d) + '</div>' + row('L2b 净', sgn((ps[0] || {}).net, 1, ' bp')) + row('L2 净', sgn((ps[1] || {}).net, 1, ' bp'));
      }, 260);
      return;
    }
    if (S.tab === '极值') {
      var el = document.getElementById('btmi-layer');
      if (el) {
        var L = D.layers, order = ['L0', 'L1', 'L2', 'L2b'];
        CK.bars(el, order.map(function (k) {
          var x = L[k]; return { label: x.label + ' ' + x.name, value: x.minIsWinRate || 0,
            lt10: x.lt10, pool: x.poolSize, minN: x.minIsN };
        }), { height: 240, theme: 'dark', metric: 'bp', tip: function (it) {
          return '<div class="t">' + esc(it.label) + '</div>' + row('最低 IS 胜率', pct(it.value)) +
            row('<10% 组合数', num(it.lt10, 0)) + row('该组合 IS 笔数', num(it.minN, 0)) + row('层内组合数', num(it.pool, 0));
        } });
      }
      return;
    }
    if (S.tab === '几百笔') {
      var q = ptsOf(D.hf2.combined);
      lineSeries('btmi-h2-eq', [{ name: '净值', color: '#3d7bff', width: 2.4, pts: q }], 'eq', function (d, ps) {
        var x = ps[0] || {}; return '<div class="t">' + esc(d) + '</div>' + row('净值', num(x.eq, 3)) + row('当日笔数', num(x.n, 0));
      });
      lineSeries('btmi-h2-cum', [{ name: '累计盈利', color: '#ff6b7d', width: 2.2, pts: q }], 'bp', function (d, ps) {
        var x = ps[0] || {}; return '<div class="t">' + esc(d) + '</div>' + row('累计 bp', sgn(x.bp, 1, ' bp')) + row('净值', num(x.eq, 3));
      });
      var fs2 = feeSeries(q);
      lineSeries('btmi-h2-fee', fs2, 'net', function (d, ps) {
        var h = '<div class="t">' + esc(d) + '</div>';
        for (var i = 0; i < ps.length; i++) h += row(esc(fs2[i].name), sgn(ps[i] ? ps[i].net : 0, 1, ' bp'));
        return h;
      }, 260);
      var lossEl = document.getElementById('btmi-h2-loss');
      if (lossEl) CK.bars(lossEl, (D.worstDays || []).slice(0, 30).slice().reverse().map(function (x) {
        return { label: x.day, value: x.origBp, inv: x.invBp, n: x.n, loseRate: x.loseRate };
      }), { height: 240, theme: 'dark', metric: 'bp', tip: function (it) {
        return '<div class="t">' + esc(it.label) + '</div>' + row('原策略当日', sgn(it.value, 1, ' bp')) +
          row('反转后当日', sgn(it.inv, 1, ' bp')) + row('笔数', num(it.n, 0));
      } });
      var nEl = document.getElementById('btmi-h2-n');
      if (nEl) CK.bars(nEl, q.slice(0, 120).map(function (x) {
        return { label: x.d, value: x.n, bp: x.bp };
      }), { height: 240, theme: 'dark', metric: 'bp', tip: function (it) {
        return '<div class="t">' + esc(it.label) + '</div>' + row('当日笔数', num(it.value, 0)) + row('累计 bp', sgn(it.bp, 1, ' bp'));
      } });
      return;
    }
    if (S.tab === '族') {
      var famEl = document.getElementById('btmi-fam');
      if (famEl) {
        var byFam = {}, list = [];
        (D.famRows || []).forEach(function (r) {
          var k = r.famName || r.fam;
          if (byFam[k] == null || r.isWinRate < byFam[k]) byFam[k] = r.isWinRate;
        });
        Object.keys(byFam).forEach(function (k) { list.push({ label: k, value: byFam[k] }); });
        CK.bars(famEl, list, { height: 240, theme: 'dark', metric: 'bp', tip: function (it) {
          return '<div class="t">' + esc(it.label) + '</div>' + row('最低 IS 胜率', pct(it.value));
        } });
      }
    }
  }

  /* ---------------------------------------------------------------- 事件 */
  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('#bt-causal-panel [data-tab]'), function (b) {
      b.addEventListener('click', function () { S.tab = b.getAttribute('data-tab'); S.page = 0; render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#bt-causal-panel [data-page]'), function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        S.page += (b.getAttribute('data-page') === 'next' ? 1 : -1);
        if (S.page < 0) S.page = 0;
        render();
      });
    });
  }

  function init() {
    CK = global.BTChart;
    if (!CK) { setTimeout(init, 200); return; }
    esc = CK.esc; num = CK.num; sgn = CK.sgn; row = CK.row;
    css();
    fetch('/web/bt/multi_inverse.json?v=' + Date.now())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { D = j; render(); })
      .catch(function (e) {
        document.getElementById('bt-causal-panel').innerHTML =
          '<h3>多策略回测数据载入失败</h3><div class="sub">' + esc(String(e && e.message || e)) + '</div>';
      });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
