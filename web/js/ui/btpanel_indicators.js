/* ============================================================================
 * web/js/ui/btpanel_indicators.js —— 全指标库 × 去噪 90% 亏损 · 反向回测 面板
 * BUILD 20261107i1 ｜ 数据源 /web/bt/all_indicators_inverse.json ｜ 图表 BTChart
 *
 * 7 个选项卡：5分钟 / 15分钟 / 1小时 / 去噪漏斗 / 频次Pareto / 全量网格 / 结论方法
 * 对应需求：① 所有股票/期货指标统统测一遍 ② 90%+亏损买多卖空→反向回测
 *          ③ 去噪后仍 90% 亏损(八级漏斗) ④ 5分钟总是亏损核实原因
 *          ⑤ 每月几万笔交易(频次Pareto)。
 * ========================================================================== */
(function (global) {
  'use strict';
  var CK = null, D = null;
  var S = { tab: '1h', page: 0, pageSize: 50, dir: 'all', sort: 'isWin' };   // ★2026-11-07 5m 已禁用
  var CSS_IN = false;
  var esc, num, sgn, row;
  var TFL = { '1h': '1小时' };   // ★2026-11-07 5m/15m 已彻底删除
  var COLS = ['#3d7bff', '#ff6b7d', '#31c99a', '#e0a33a', '#b07cff', '#16c0c0'];

  function css() {
    if (CSS_IN) return; CSS_IN = true;
    var st = document.createElement('style'); st.setAttribute('data-btip', '1');
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
      '#bt-causal-panel .tw{overflow:auto;max-height:520px;border:1px solid #263553;border-radius:7px}' +
      '#bt-causal-panel table{width:100%;border-collapse:collapse;font-size:11.5px}' +
      '#bt-causal-panel th{background:#1b2a45;color:#a9c2ee;text-align:right;padding:6px 9px;position:sticky;top:0;white-space:nowrap;z-index:1;cursor:pointer}' +
      '#bt-causal-panel td{text-align:right;padding:5px 9px;border-top:1px solid #22314e;white-space:nowrap}' +
      '#bt-causal-panel th:first-child,#bt-causal-panel td:first-child{text-align:left}' +
      '#bt-causal-panel table.kv td:first-child{width:240px;color:#8fa6d0;white-space:normal}' +
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
      '#bt-causal-panel .filters{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;font-size:12px;color:#8b9abc}' +
      '#bt-causal-panel .filters select{background:#16233b;border:1px solid #30456c;color:#cfe0ff;border-radius:5px;padding:3px 8px}' +
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
  function curPeriod() { return D.periods[S.tab] || null; }

  /* ---------------------------------------------------------------- 顶部结论 */
  function verdictHtml() {
    var v = D.verdict;
    var sCount = v.strictCount, nCount = v.nearCount;
    var cls = (sCount === 0 && nCount === 0) ? 'bad' : (sCount > 0 ? 'ok' : 'bad');
    var headline;
    if (sCount === 0) {
      headline = '<b>★ 直接回答：去噪之后，没有任何组合能稳定「亏损 90% 后反转赚钱」。</b><br>' +
        '全库 ' + num(v.totalCombosTested, 0) + ' 个组合（' + v.indicatorCount + ' 指标 × ' + v.opsCount + ' 操作 × 6 档 × 双腿 × ' + v.tfCount + ' 周期）里，' +
        '未去噪 IS&lt;10% 的有 ' + num(v.rawLt10Count, 0) + ' 个；但经过 D1~D6+D8 八级去噪漏斗后，<b class="hot">严格达标(strict) = ' + sCount + ' 个</b>。';
    } else {
      headline = '<b>★ 去噪漏斗筛出 ' + sCount + ' 个「原方向 OOS 亏损 ≥90%」组合。</b><br>但反转后 OOS 仍无法稳定盈利（见各周期选项卡与扣费）。';
    }
    return '<div class="verdict ' + cls + '">' + headline + '<br><span class="mut">' + esc(v.target) + '</span></div>';
  }

  /* ---------------------------------------------------------------- 曲线/费用序列映射（适配引擎 equity/cumBp 字段） */
  function ptsOf(p) { return (p && p.curve && p.curve.points) || []; }
  function eqPts(p) {
    return ptsOf(p).map(function (x) { return { d: x.d, n: x.n, eq: x.equity, bp: x.cumBp, pct: x.equity - 100 }; });
  }
  function feeSeries(p) {
    var fps = (p && p.curve && p.curve.feePoints) || {};
    return (D.meta.fees || []).map(function (f, i) {
      var arr = fps[String(f)] || [];
      return { name: (D.meta.feeLabels && D.meta.feeLabels[String(f)]) || (f + 'bp'), color: COLS[i % COLS.length],
        pts: arr.map(function (x) { return { d: x.d, net: x.cumBp }; }) };
    });
  }

  /* ---------------------------------------------------------------- 周期 Tab（反向回测） */
  function renderPeriod() {
    var p = curPeriod(), tf = S.tab;
    if (!p) return '<div class="mut">无该周期数据</div>';
    var k = p.kpi || {};
    var n = k.n || 0, flatRate = n ? (k.flat || 0) / n * 100 : 0;
    var origWin = (k.winRate != null) ? (100 - k.winRate - flatRate) : null;   /* 原方向(反转前)胜率估算 */
    var diag = p.diagnostics || null;

    var kpis = [
      kpiCard('反转后 全期胜率', pct(k.winRate), '原方向≈' + pct(origWin) + '(估算)', k.winRate > 50 ? 'good' : 'bad'),
      kpiCard('反转后 IS胜率', pct(k.isWinRate), '样本内·方向取反恒等式', 'warn'),
      kpiCard('反转后 OOS胜率', pct(k.oosWinRate), num(k.oosN || 0, 0) + ' 笔 · 唯一有效检验', (k.oosWinRate || 0) > 50 ? 'good' : 'bad'),
      kpiCard('成交笔数', num(n, 0), '平局 ' + num(k.flat || 0, 0) + ' 笔'),
      kpiCard('毛收益(0bp)', bp(k.sumBp), 'Σ 反转收益'),
      kpiCard('maker净(−2bp)', bp(k.netMakerBp), k.netMakerBp > 0 ? '为正' : '为负', k.netMakerBp > 0 ? 'good' : 'bad'),
      kpiCard('taker净(10bp)', bp(k.netTakerBp), '实盘近似', k.netTakerBp > 0 ? 'good' : 'bad'),
      kpiCard('复合收益 / 回撤', sgn((p.curve ? p.curve.compoundPct : 0), 2, ' %') + ' / ' + pct(p.curve ? p.curve.maxDrawdownPct : 0), '本周期 · 起始100')
    ].join('');

    /* OOS 验证小卡 */
    var oosHtml = '';
    if (k.oosWinRate != null) {
      var lift = k.oosWinRate - 50;
      oosHtml = '<div class="kpis k2">' +
        kpiCard('OOS 反转胜率', pct(k.oosWinRate), num(k.oosN, 0) + ' 笔', 'warn') +
        kpiCard('相对 50% 基线', sgn(lift, 2, ' pp'), '无脑反向基线 50%', (lift > 3) ? 'good' : 'bad') +
        kpiCard('OOS 扣 taker 全费', bp(k.oosFeeNets ? k.oosFeeNets['10'] : (k.netTakerBp)), '每笔 10bp', (k.oosFeeNets ? k.oosFeeNets['10'] : k.netTakerBp) > 0 ? 'good' : 'bad') +
        kpiCard('OOS 扣 maker 返佣', bp(k.oosFeeNets ? k.oosFeeNets['-2'] : (k.netMakerBp)), '每笔 −2bp', (k.oosFeeNets ? k.oosFeeNets['-2'] : k.netMakerBp) > 0 ? 'good' : 'bad') +
        '</div><div class="cov">判定：OOS 反转胜率 ' + pct(k.oosWinRate) + '，若接近 50% 即说明「原方向亏损 90%」是样本内噪声、反转后并无真实预测力；若 &gt;50% 且扣费仍为正，才可能构成优势。本组合扣 taker 全费净额 ' + bp(k.oosFeeNets ? k.oosFeeNets['10'] : k.netTakerBp) + '。</div>';
    }
    var oosSec = sec('严格样本外验证 · ' + tfLabel(tf), '判断「反向做是否真的成功率更高」的唯一有效口径。', oosHtml);

    /* 5m 诊断（仅 5m tab） */
    var diagSec = '';
    if (tf === '5m' && diag) {
      var fs = (diag.feeSensitivity || []).map(function (f) {
        return [esc(f.fee + 'bp'), bp(f.perTradeNetBp), bp(f.totalNetBp)];
      });
      var monthly = (diag.monthly || []).slice(0, 12).map(function (m) {
        return [esc(m.m), num(m.n, 0), bp(m.sumBp), pct(m.winRate)];
      });
      diagSec = sec('5分钟为什么总是亏损 · 数据质量与微观结构诊断',
        '覆盖 ' + num(diag.bars, 0) + ' 根K线（IS ' + num(diag.isPct, 1) + '%）；数据窗 ' + esc(diag.from ? diag.from.slice(0,10) : '-') + ' ~ ' + esc(diag.to ? diag.to.slice(0,10) : '-'),
        '<div class="kpis k2">' +
        kpiCard('每根收益中位数', bp(diag.retMedianBp), '≈0 → 无方向性', 'mut') +
        kpiCard('每根收益均值', bp(diag.retMeanBp), 'taker10bp 吃掉后净', diag.retMeanBp >= 0 ? 'good' : 'bad') +
        kpiCard('重复收盘占比', pct(diag.dupClosePct), '相邻K线收盘价相同→噪声', diag.dupClosePct > 2 ? 'bad' : 'warn') +
        kpiCard('平局(零收益)占比', pct(diag.flatRatePct), '收益=0 的笔', 'warn') +
        kpiCard('极端(&gt;1000bp)占比', pct(diag.extremePct), '异常跳变', 'warn') +
        kpiCard('买多/卖空 均值bp', bp(diag.buyMeanBp) + ' / ' + bp(diag.sellMeanBp), '结构偏置', 'mut') +
        '</div>' +
        sec('费用敏感性（每笔净收益 = 均值 − 费用）', '5m 收益幅度小、taker 10bp 一笔就吞掉', table(['每笔费用', '每笔净bp', '合计净bp'], fs, 'kv')) +
        sec('逐月（前12个月）', '看是否系统性亏损还是个别月份', table(['月份', '笔数', '合计bp', '胜率'], monthly.length ? monthly : [['<span class="mut">无</span>', '', '', '']])));
    }

    /* 图表 */
    var charts = '<div class="charts">' +
      '<div class="chartbox"><h4>净值曲线（起始100）</h4><div id="bti-eq"></div></div>' +
      '<div class="chartbox"><h4>累计盈利曲线（bp）</h4><div id="bti-cum"></div></div>' +
      '<div class="chartbox full"><h4>扣费曲线（多档成本，逐日累计 bp）</h4><div id="bti-fee"></div></div>' +
      '<div class="chartbox"><h4>逐月盈亏</h4><div id="bti-month"></div></div>' +
      '<div class="chartbox"><h4>逐笔盈亏</h4><div id="bti-trade"></div></div>' +
      '</div>';

    /* 逐笔明细 */
    var tr = p.trades || [], total = p.tradesTotal || tr.length;
    var maxPage = Math.max(0, Math.ceil(tr.length / S.pageSize) - 1);
    if (S.page > maxPage) S.page = maxPage;
    var slice = tr.slice(S.page * S.pageSize, (S.page + 1) * S.pageSize);
    var detailRows = slice.map(function (t) {
      return [esc(String(t.iso).replace('T', ' ').slice(0, 19)), esc(t.inst), esc(t.ind), esc(t.op),
        (t.dirLabel === '卖空' ? '<span class="dn">卖空→买多</span>' : '<span class="up">买多→卖空</span>'),
        num(t.c0, 4), num(t.c1, 4), sgn(t.origRet, 1, ''), sgn(t.ret, 1, ''),
        t.ret > 0 ? '<span class="up">盈</span>' : '<span class="dn">亏</span>', t.oos ? '样本外' : '样本内'];
    });
    var pager = '<div class="pager">' +
      '<span>共 ' + num(total, 0) + ' 笔' + (p.tradesTruncated ? '（明细前 ' + num(tr.length, 0) + ' 笔，完整见 CSV）' : '') + '</span>' +
      '<button data-page="prev" ' + (S.page <= 0 ? 'disabled' : '') + '>上一页</button>' +
      '<span>' + (S.page + 1) + ' / ' + (maxPage + 1) + '</span>' +
      '<button data-page="next" ' + (S.page >= maxPage ? 'disabled' : '') + '>下一页</button></div>';
    var detailSec = sec('逐笔明细（分页） · ' + tfLabel(tf), '信号 UTC；收盘→持 N 根后收盘成交；反转收益 = −原方向收益。',
      table(['信号UTC', '标的', '指标', '操作', '原方向→反向', '收盘', '平仓', '原收益bp', '反转收益bp', '结果', '区间'],
        detailRows.length ? detailRows : [['<span class="mut">无逐笔数据</span>', '', '', '', '', '', '', '', '', '', '']]) + pager);

    return '<div class="kpis">' + kpis + '</div>' + oosSec + diagSec + charts + detailSec;
  }

  /* ---------------------------------------------------------------- 去噪漏斗 Tab */
  function renderDenoise() {
    var v = D.verdict, dn = D.denoise || [], strict = D.strictRows || [], near = D.nearRows || [];
    var funnel = sec('八级去噪漏斗（D1~D6 + D8）', '「去噪声以后的亏损 90%」= 原方向 OOS 胜率 &lt;10% 且通过全部漏斗；D7(反转扣费为正) 由回测给出。',
      table(['漏斗', '名称', '规则'],
        v.denoiseFunnel.map(function (f) { return [esc(f.id), esc(f.name), esc(f.rule)]; }), 'kv'));

    var sKpi = '<div class="kpis">' +
      kpiCard('严格达标(D1~D6+D8)', num(v.strictCount, 0), '去噪后仍 90% 亏损', v.strictCount > 0 ? 'good' : 'bad') +
      kpiCard('近达标(IS过/OOS回)', num(v.nearCount, 0), '样本外回归对照', v.nearCount > 0 ? 'warn' : 'bad') +
      kpiCard('未去噪 IS&lt;5%', num(v.rawLt5Count, 0), '含噪声极值', 'mut') +
      kpiCard('未去噪 IS&lt;10%', num(v.rawLt10Count, 0), '含噪声极值', 'mut') +
      '</div>';

    /* 四组反向回测 */
    var groups = [['strict', '去噪达标'], ['near', 'IS达标/OOS回归'], ['raw', '未去噪极值(对照)'], ['highFreq', '每月几万笔(对照)']];
    var gRows = groups.map(function (g) {
      var s = D.strategies[g[0]] || {}, sk = s.kpi || {};
      return ['<b>' + esc(g[1]) + '</b>', num(s.comboCount || 0, 0), num(sk.n || 0, 0), pct(sk.winRate),
        pct(sk.isWinRate), pct(sk.oosWinRate), bp(sk.netMakerBp), bp(sk.netTakerBp)];
    });
    var gSec = sec('四组反向回测对照', '原方向选亏损组合 → 反转后回测；OOS 胜率才是有效口径。',
      table(['组', '组合数', '笔数', '反转全期胜率', '反转IS胜率', '反转OOS胜率', 'maker净', 'taker净'], gRows));

    var strictRowsT = strict.map(function (d) {
      return [esc(d.tf), esc(d.indName), esc(d.cat), esc(d.op), '档' + d.buck, esc(d.dirLabel),
        num(d.isN, 0), pct(d.origIsWin), pct(d.origOosWin), 'D' + [d.D1,d.D2,d.D3,d.D4,d.D5,d.D6,d.D8].map(function(x){return x?'✓':'✗';}).join(''),
        pct(d.trimOrigWin), pct(d.invOosWin)];
    });
    var sSec = sec('★ 严格达标组合（D1~D6+D8 全过）', v.strictCount > 0 ? '这些组合原方向 OOS 仍亏损 ≥90%，反转后表现见上组。' : '没有任何组合通过全部漏斗 —— 即「去噪声以后的亏损 90%」不存在可交易组合。',
      table(['周期', '指标', '类别', '操作', '档', '方向', 'IS笔数', '原IS胜率', '原OOS胜率', '漏斗', '去尾原胜率', '反转OOS胜率'],
        strictRowsT.length ? strictRowsT : [['<span class="mut">无</span>', '', '', '', '', '', '', '', '', '', '', '']]));

    var nearRowsT = near.slice(0, 30).map(function (d) {
      return [esc(d.tf), esc(d.indName), esc(d.op), '档' + d.buck, esc(d.dirLabel), num(d.isN, 0),
        pct(d.origIsWin), pct(d.origOosWin), pct(d.invOosWin)];
    });
    var nSec = sec('近达标组合（IS 达标但样本外回归，对照前30）', '证明「IS 亏损 90%」在 OOS 大多回到 ~50%，是噪声而非预测力。',
      table(['周期', '指标', '操作', '档', '方向', 'IS笔数', '原IS胜率', '原OOS胜率', '反转OOS胜率'],
        nearRowsT.length ? nearRowsT : [['<span class="mut">无</span>', '', '', '', '', '', '', '', '']]));

    return sKpi + funnel + gSec + sSec + nSec;
  }

  /* ---------------------------------------------------------------- 频次Pareto Tab */
  function renderPareto() {
    var p = D.pareto || {};
    var bands = (p.bands || []).map(function (b) {
      return [esc(b.band), num(b.combos, 0), b.minWinRate == null ? '—' : pct(b.minWinRate),
        num(b.combosLt10, 0), num(b.combosLt5, 0)];
    });
    var bandSec = sec('频次分层 · 月均笔数 vs 最低胜率', '月均笔数 = 组合总笔数 / 有交易月份（每根 bar 每周期只下注一次；不同指标是同一批交易的不同切分，不可相加）。',
      table(['月均笔数档', '组合数', '最低胜率', '<10%组合数', '<5%组合数'], bands.length ? bands : [['<span class="mut">无</span>', '', '', '', '']]));

    var t = p.tensOfThousands || {};
    var tkpi = '<div class="kpis k2">' +
      kpiCard('目标月均笔数', '≥ ' + num(t.requiredPerMonth || 0, 0), '用户要求「每月几万笔」', 'warn') +
      kpiCard('达标组合数', num(t.combos || 0, 0), '该频次档下的组合', (t.combos || 0) > 0 ? 'mut' : 'bad') +
      kpiCard('最低胜率', t.minWinRate == null ? '—' : pct(t.minWinRate), '该档最低', (t.minWinRate != null && t.minWinRate < 10) ? 'good' : 'bad') +
      kpiCard('<10% 组合数', num(t.combosLt10 || 0, 0), '即「亏 90%+」候选', (t.combosLt10 || 0) > 0 ? 'good' : 'bad') +
      '</div>';

    /* 前沿图 */
    var fr = (p.frontier || []).map(function (f) {
      return { label: (f.atLeastPerMonth >= 1000 ? (f.atLeastPerMonth / 1000) + 'k/月' : f.atLeastPerMonth + '/月'),
        value: f.minWinRate == null ? 100 : f.minWinRate, combos: f.combos };
    });
    var frChart = '<div class="chartbox full"><h4>累积前沿：月均笔数阈值 → 该阈值下可达最低胜率</h4><div id="bti-front"></div></div>';

    var note = sec('结论', '大数定律下「每月几万笔 + 亏损 90%」不可兼得。',
      '<div class="cov">' + esc(p.note || '') + '</div>');

    return tkpi + bandSec + frChart + note;
  }

  /* ---------------------------------------------------------------- 全量网格 Tab */
  function renderGrid() {
    var rows = (D.rows || []).slice();
    if (S.dir !== 'all') rows = rows.filter(function (r) { return r.dirLabel === S.dir; });
    rows.sort(function (a, b) {
      if (S.sort === 'isWin') return (a.isWinRate || 0) - (b.isWinRate || 0);
      if (S.sort === 'oosWin') return (a.oosWinRate == null ? 99 : a.oosWinRate) - (b.oosWinRate == null ? 99 : b.oosWinRate);
      if (S.sort === 'perMonth') return (b.perMonth || 0) - (a.perMonth || 0);
      if (S.sort === 'n') return (b.n || 0) - (a.n || 0);
      return 0;
    });
    var maxPage = Math.max(0, Math.ceil(rows.length / S.pageSize) - 1);
    if (S.page > maxPage) S.page = maxPage;
    var slice = rows.slice(S.page * S.pageSize, (S.page + 1) * S.pageSize);
    var body = slice.map(function (r) {
      var origOos = r.oosWinRate == null ? null : r.oosWinRate;
      return [esc(r.tf), esc(r.indName), esc(r.cat), esc(r.opName), '档' + r.buck, esc(r.dirLabel),
        num(r.n, 0), pct(r.winRate), pct(r.isWinRate), pct(origOos),
        pct(r.invWinRate), pct(r.invOosWinRate), num(r.perMonth || 0, 0),
        (r.oosWinRate != null && r.oosWinRate < 10) ? '<span class="tag r">OOS亏&gt;90%</span>' : ''];
    });
    var pager = '<div class="pager">' +
      '<span>共 ' + num(rows.length, 0) + ' 个组合（全库 ' + num((D.rows || []).length, 0) + '）</span>' +
      '<button data-page="prev" ' + (S.page <= 0 ? 'disabled' : '') + '>上一页</button>' +
      '<span>' + (S.page + 1) + ' / ' + (maxPage + 1) + '</span>' +
      '<button data-page="next" ' + (S.page >= maxPage ? 'disabled' : '') + '>下一页</button></div>';
    var filters = '<div class="filters">方向：' +
      '<select data-f="dir"><option value="all"' + (S.dir === 'all' ? ' selected' : '') + '>全部</option>' +
      '<option value="买多"' + (S.dir === '买多' ? ' selected' : '') + '>买多</option>' +
      '<option value="卖空"' + (S.dir === '卖空' ? ' selected' : '') + '>卖空</option></select>' +
      ' 排序：<select data-f="sort"><option value="isWin"' + (S.sort === 'isWin' ? ' selected' : '') + '>样本内胜率(低→高)</option>' +
      '<option value="oosWin"' + (S.sort === 'oosWin' ? ' selected' : '') + '>样本外胜率(低→高)</option>' +
      '<option value="perMonth"' + (S.sort === 'perMonth' ? ' selected' : '') + '>月均笔数(高→低)</option>' +
      '<option value="n"' + (S.sort === 'n' ? ' selected' : '') + '>笔数(高→低)</option></select>' +
      ' <span class="mut">点击表头也可排序；完整网格见 /web/bt/all_indicators_grid.csv</span></div>';
    return filters + table(['周期', '指标', '类别', '操作', '档', '方向', '笔数', '胜率', 'IS胜率', 'OOS胜率', '反转胜率', '反转OOS胜率', '月均笔', '标记'],
      body.length ? body : [['<span class="mut">无</span>', '', '', '', '', '', '', '', '', '', '', '', '', '']]) + pager;
  }

  /* ---------------------------------------------------------------- 结论方法 Tab */
  function renderVerdict() {
    var m = D.meta, v = D.verdict;
    var cat = (D.categoryStats || []).map(function (c) {
      return [esc(c.cat), num(c.combos, 0), num(c.n, 0), pct(c.minWinRate), num(c.lt10, 0)];
    });
    var catSec = sec('类别统计（8 大类指标）', '每类最低胜率与「亏损&lt;10%」组合数。',
      table(['类别', '组合数', '总笔数', '最低胜率', '<10%组合数'], cat.length ? cat : [['<span class="mut">无</span>', '', '', '', '']]));

    var clean = m.dataCleaning || {};
    var exRows = (clean.excluded || []).slice(0, 30).map(function (x) {
      return [esc(x.tf), esc(x.inst), esc(x.src), esc(x.reason), x.sdBp == null ? '—' : num(x.sdBp, 2) + ' bp'];
    });
    var cleanSec = sec('数据清洗 · 稳定币永久禁令', '本轮剔除 ' + num(clean.excludedCount || 0, 0) + ' 项；全部产物稳定币合约数 = 0。',
      table(['周期', '标的', '市场', '剔除原因', '收益标准差'], exRows.length ? exRows : [['<span class="mut">无</span>', '', '', '', '']]) +
      '<div class="cov">硬约束 ' + esc(clean.module || '') + '：base 命中稳定币名单，或单根收益标准差 &lt; ' + num(clean.minSdBp || 5, 0) + 'bp（零波动兜底）。所有回测引擎加载标的后第一件事必须调用。</div>');

    var meth = sec('方法论 / 口径', '', '<table class="kv">' +
      row('范围', esc(m.scope)) +
      row('数据窗口', esc(m.start) + ' ~ ' + esc(m.end)) +
      row('样本内 / 外切分', esc(m.split)) +
      row('K线 / 标的', num(m.bars, 0) + ' 根 / ' + num(m.instruments, 0) + ' 标的(周期计)') +
      row('因果', esc(m.causal)) +
      row('数据限制', esc(m.dataLimit)) +
      row('费用', '每笔 ' + (m.fees || []).join(' / ') + ' bp；净额 = 毛bp − 笔数 × 成本') +
      row('去噪漏斗', 'D1 双样本量 / D2 Wilson上界 / D3 月度稳定 / D4 跨合约分散 / D5 去尾稳健 / D6 样本外一致 / D8 Bonferroni') +
      '</table>');

    var fixRows = (m.fixedProblems || []).map(function (x) { return '<div class="r" style="display:block"><span style="opacity:.66">•</span> ' + esc(x) + '</div>'; }).join('');
    var fixSec = sec('本轮修复的旧版问题', '', '<div style="font-size:12px;line-height:1.8">' + (fixRows || '—') + '</div>');

    var concl = sec('最终判定', '',
      '<div class="verdict bad" style="line-height:1.9">' + esc(v.conclusion) + '</div>' +
      '<table class="kv">' +
      row('能保证盈利吗', esc(v.guarantee)) +
      row('去噪后 90% 亏损组合', v.strictCount > 0 ? ('有 ' + v.strictCount + ' 个') : '不存在') +
      row('未去噪 IS&lt;10% 组合', num(v.rawLt10Count, 0, 0) + ' 个（含噪声）') +
      row('最低 IS 胜率', v.minIsWinRate == null ? '—' : pct(v.minIsWinRate)) +
      row('每月几万笔档最低胜率', (v.paretoAt30k && v.paretoAt30k.minWinRate != null) ? pct(v.paretoAt30k.minWinRate) : '—') +
      '</table>');

    return catSec + cleanSec + meth + fixSec + concl;
  }

  /* ---------------------------------------------------------------- 渲染 */
  function render() {
    if (!D || !CK) return;
    var root = document.getElementById('bt-causal-panel');
    var tabs = [['1h', '1小时'], ['去噪', '去噪漏斗'], ['pareto', '频次Pareto'], ['网格', '全量网格'], ['结论', '结论方法']];   // ★2026-11-07 5m/15m 选项卡已彻底删除
    var bar = '<div class="tabs">' + tabs.map(function (t) {
      return '<button data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' class="on"' : '') + '>' + t[1] + '</button>';
    }).join('') + '</div>';
    var body;
    if (S.tab === '去噪') body = renderDenoise();
    else if (S.tab === 'pareto') body = renderPareto();
    else if (S.tab === '网格') body = renderGrid();
    else if (S.tab === '结论') body = renderVerdict();
    else body = renderPeriod();

    root.innerHTML = '<h3>' + esc(D.meta.title) + '</h3>' +
      '<div class="sub">BUILD ' + esc(D.meta.build) + ' ｜ 生成 ' + esc(D.meta.generated) +
      ' ｜ 数据 /web/bt/all_indicators_inverse.json ｜ 图表 BTChart ｜ ' +
      num(D.meta.bars, 0) + ' 根K线 / ' + num(D.verdict.searchSpace, 0) + ' 组合 / ' + D.verdict.indicatorCount + ' 指标</div>' +
      verdictHtml() + bar + body;

    drawCharts();
    bind();
    root.setAttribute('data-ready', '1');
  }

  /* ---------------------------------------------------------------- 图表 */
  function lineSeries(id, series, metric, tipFn, height) {
    var el = document.getElementById(id);
    if (!el) return;
    CK.line(el, series, { metric: metric, height: height || 250, theme: 'dark', tip: tipFn });
  }
  function drawCharts() {
    if (isPeriodTab()) {
      var p = curPeriod();
      if (!p) return;
      var eq = eqPts(p);
      lineSeries('bti-eq', [{ name: '净值', color: '#3d7bff', width: 2.4, pts: eq }], 'eq', function (d, ps) {
        var x = ps[0] || {}; return '<div class="t">' + esc(d) + '</div>' + row('净值', num(x.eq, 3)) +
          row('累计盈利', sgn(x.bp, 1, ' bp')) + row('当日笔数', num(x.n, 0));
      });
      lineSeries('bti-cum', [{ name: '累计盈利', color: '#ff6b7d', width: 2.2, pts: eq }], 'bp', function (d, ps) {
        var x = ps[0] || {}; return '<div class="t">' + esc(d) + '</div>' + row('累计 bp', sgn(x.bp, 1, ' bp')) +
          row('净值', num(x.eq, 3));
      });
      var fs = feeSeries(p);
      lineSeries('bti-fee', fs, 'net', function (d, ps) {
        var h = '<div class="t">' + esc(d) + '</div>';
        for (var i = 0; i < ps.length; i++) h += row(esc(fs[i].name), sgn(ps[i] ? ps[i].net : 0, 1, ' bp'));
        return h;
      }, 260);
      var monEl = document.getElementById('bti-month');
      if (monEl) CK.bars(monEl, (p.monthlyBars || []).map(function (x) {
        return { label: x.d, value: x.ret, cumBp: x.cumBp, n: x.n, winRate: x.winRate };
      }), { height: 240, theme: 'dark', metric: 'bp', cumKey: 'cumBp', tip: function (it) {
        return '<div class="t">' + esc(it.label) + '</div>' + row('当月盈亏', sgn(it.value, 1, ' bp')) +
          row('累计', sgn(it.cumBp, 1, ' bp')) + row('笔数 / 胜率', num(it.n, 0) + ' / ' + pct(it.winRate));
      } });
      var trEl = document.getElementById('bti-trade');
      if (trEl) CK.bars(trEl, (p.tradeBars || []).map(function (x) {
        return { label: x.iso ? String(x.iso).slice(5, 10) : ('#' + x.i), value: x.ret, cumBp: x.cumBp };
      }), { height: 240, theme: 'dark', metric: 'bp', cumKey: 'cumBp', tip: function (it) {
        return '<div class="t">' + esc(it.label) + '</div>' + row('当笔盈亏', sgn(it.value, 1, ' bp')) +
          row('累计', sgn(it.cumBp, 1, ' bp'));
      } });
      return;
    }
    if (S.tab === 'pareto') {
      var fr = (D.pareto.frontier || []).map(function (f) {
        return { label: (f.atLeastPerMonth >= 1000 ? (f.atLeastPerMonth / 1000) + 'k/月' : f.atLeastPerMonth + '/月'),
          value: f.minWinRate == null ? 100 : f.minWinRate, combos: f.combos };
      });
      var el = document.getElementById('bti-front');
      if (el) CK.bars(el, fr, { height: 280, theme: 'dark', metric: 'pct', tip: function (it) {
        return '<div class="t">' + esc(it.label) + '</div>' + row('最低胜率', pct(it.value)) + row('组合数', num(it.combos, 0));
      } });
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
    Array.prototype.forEach.call(document.querySelectorAll('#bt-causal-panel [data-f]'), function (s) {
      s.addEventListener('change', function () {
        var f = s.getAttribute('data-f');
        if (f === 'dir') S.dir = s.value; else if (f === 'sort') S.sort = s.value;
        S.page = 0; render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#bt-causal-panel th'), function (th) {
      th.addEventListener('click', function () {
        var txt = th.textContent || '';
        if (txt.indexOf('IS胜率') >= 0 || txt.indexOf('样本内') >= 0) { S.sort = 'isWin'; S.page = 0; render(); }
        else if (txt.indexOf('OOS') >= 0 || txt.indexOf('样本外') >= 0) { S.sort = 'oosWin'; S.page = 0; render(); }
      });
    });
  }

  function init() {
    CK = global.BTChart;
    if (!CK) { setTimeout(init, 200); return; }
    esc = CK.esc; num = CK.num; sgn = CK.sgn; row = CK.row;
    css();
    fetch('/web/bt/all_indicators_inverse.json?v=' + Date.now())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { D = j; render(); })
      .catch(function (e) {
        document.getElementById('bt-causal-panel').innerHTML =
          '<h3>全指标回测数据载入失败</h3><div class="sub">' + esc(String(e && e.message || e)) + '</div>';
      });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
