  function css() {
    if (CSS_IN) return; CSS_IN = true;
    var st = document.createElement('style'); st.setAttribute('data-ft', '1');
    st.textContent =
      '#' + BOX + '{background:#0e1728;border:1px solid #263553;border-radius:12px;padding:16px 18px;margin:16px 0 30px;color:#dbe6ff;font:13px/1.6 "Microsoft YaHei",sans-serif}' +
      '#' + BOX + ' h3{margin:0 0 6px;font-size:16px;color:#cfe0ff;display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
      '#' + BOX + ' .sub{color:#8b9abc;font-size:12px;margin-bottom:10px}' +
      '#' + BOX + ' .live{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#5ad19a}' +
      '#' + BOX + ' .live i{width:7px;height:7px;border-radius:50%;background:#5ad19a;display:inline-block;animation:ftpulse 1.4s infinite}' +
      '@keyframes ftpulse{0%,100%{opacity:1}50%{opacity:.25}}' +
      '#' + BOX + ' .cards{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0 14px}' +
      '#' + BOX + ' .card{flex:1;min-width:150px;background:#121e33;border:1px solid #243553;border-radius:10px;padding:12px 14px}' +
      '#' + BOX + ' .card .k{color:#8b9abc;font-size:12px;margin-bottom:6px}' +
      '#' + BOX + ' .card .v{font-size:22px;font-weight:700}' +
      '#' + BOX + ' .card .s{font-size:11.5px;color:#8b9abc;margin-top:4px}' +
      '#' + BOX + ' .bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}' +
      '#' + BOX + ' .lbl{color:#8b9abc;font-size:11.5px;font-weight:700;letter-spacing:.5px}' +
      '#' + BOX + ' .tabs{display:flex;gap:8px;flex-wrap:wrap}' +
      '#' + BOX + ' .tab{padding:7px 14px;border:1px solid #2b3f63;border-radius:20px;background:#16233b;color:#a9c2ee;cursor:pointer;font-size:12.5px;user-select:none}' +
      '#' + BOX + ' .tab:hover{border-color:#3d7bff}' +
      '#' + BOX + ' .tab.on{background:#3d7bff;border-color:#3d7bff;color:#fff;font-weight:700}' +
      '#' + BOX + ' .sbtn{padding:7px 14px;border:1px solid #2b3f63;border-radius:20px;background:#16233b;color:#a9c2ee;cursor:pointer;font-size:12.5px;user-select:none}' +
      '#' + BOX + ' .sbtn:hover{border-color:#3d7bff}' +
      '#' + BOX + ' .sbtn.on{background:#3d7bff;border-color:#3d7bff;color:#fff;font-weight:700}' +
      '#' + BOX + ' .tw{overflow:auto;max-height:460px;border:1px solid #263553;border-radius:7px;margin-bottom:10px}' +
      '#' + BOX + ' table{width:100%;border-collapse:collapse;font-size:11.5px}' +
      '#' + BOX + ' th{background:#1b2a45;color:#a9c2ee;text-align:right;padding:6px 9px;position:sticky;top:0;white-space:nowrap;z-index:1}' +
      '#' + BOX + ' td{text-align:right;padding:5px 9px;border-top:1px solid #22314e;white-space:nowrap}' +
      '#' + BOX + ' th:nth-child(2),#' + BOX + ' td:nth-child(2),#' + BOX + ' th:nth-child(3),#' + BOX + ' td:nth-child(3){text-align:left}' +
      /* ★整行 hover 高亮（覆盖单元格淡底色，让整行突出）；行可点击弹共享K线 */
      '#' + BOX + ' tr.r{cursor:pointer;transition:background .12s}' +
      '#' + BOX + ' tbody tr.r:hover td,#' + BOX + ' tbody tr.r:hover{' +
        'background:#27406e!important;color:#fff}' +
      '#' + BOX + ' tbody tr.r:hover .inst{color:#fff!important}' +
      /* 列表分区标题（交易列表 / 实时持仓列表） */
      '#' + BOX + ' .ft-sec{margin:16px 0 8px;font-size:14.5px;color:#cfe0ff;display:flex;align-items:center;gap:10px;font-weight:800;' +
        'border-left:4px solid #4f8cff;padding-left:10px}' +
      '#' + BOX + ' .ft-sec-wrap{margin-top:4px}' +
      '#' + BOX + ' .inst{color:#7fb1ff;cursor:pointer;text-decoration:underline dotted}' +
      '#' + BOX + ' .ev{font-weight:700}' +
      '#' + BOX + ' .up{color:#ff6b7d;font-weight:600}#' + BOX + ' .dn{color:#31c99a;font-weight:600}#' + BOX + ' .flat{color:#8b94ad}' +
      '#' + BOX + ' .pager{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}' +
      '#' + BOX + ' .pg{padding:4px 10px;border:1px solid #2b3f63;border-radius:6px;background:#16233b;color:#a9c2ee;cursor:pointer;font-size:12px;user-select:none}' +
      '#' + BOX + ' .pg:hover{border-color:#3d7bff}' +
      '#' + BOX + ' .pg.on{background:#3d7bff;border-color:#3d7bff;color:#fff;font-weight:700}' +
      '#' + BOX + ' .pg.dis{opacity:.4;cursor:default}' +
      '#' + BOX + ' .foot{background:#121e33;border:1px solid #243553;border-radius:8px;padding:9px 12px;margin-bottom:12px;font-size:12.5px;color:#cfe0ff}' +
      '#' + BOX + ' .chartbox{background:#121e33;border:1px solid #243553;border-radius:9px;padding:10px 12px;margin-top:6px}' +
      '#' + BOX + ' .chart{height:auto;width:100%;position:relative}' +
      '#' + BOX + ' .ftc-tools{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:2px 0 6px;font-size:12px}' +
      '#' + BOX + ' .ftc-tools button{background:#16203a;color:#c9d6ee;border:1px solid #2c3a5e;border-radius:5px;' +
      'padding:2px 8px;font-size:12px;cursor:pointer;line-height:18px;user-select:none}' +
      '#' + BOX + ' .ftc-tools button:hover{background:#22304f;border-color:#3d5a8e}' +
      '#' + BOX + ' .ftc-info{margin-left:auto;color:#8b9abc;font-size:11px;white-space:nowrap}' +
      '#' + BOX + ' .ftc-info b{color:#d7e2f7}' +
      '#' + BOX + ' .ftc-cv{width:100%;height:280px;display:block;background:#0e1422;border-radius:8px;cursor:grab}' +
      /* 曲线详情卡：固定在右上角、可交互，合约名超链接可点击 */
      '#' + BOX + ' .ftc-tip{position:absolute;right:10px;top:10px;display:none;z-index:6;' +
      'background:rgba(10,16,28,.97);border:1px solid #3d7bff;border-radius:7px;padding:8px 11px;' +
      'font-size:11.5px;color:#cfe0ff;line-height:1.65;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.6);' +
      'cursor:default;max-width:300px}' +
      '#' + BOX + ' .ftc-tip b{color:#fff}' +
      '#' + BOX + ' .ftc-tip .ftc-inst{color:#7fb1ff;text-decoration:underline;cursor:pointer;font-weight:700}' +
      '#' + BOX + ' .ftc-tip .ftc-inst:hover{color:#fff}' +
      '#' + BOX + ' .empty{color:#8b94ad;padding:24px;text-align:center}' +
      /* ===== AI 策略面板：重点红色加粗 + 曲线 / 饼图 / 柱状图 ===== */
      '#' + BOX + ' .ai-wrap{margin:12px 0 16px}' +
      '#' + BOX + ' .ai-box{background:linear-gradient(135deg,#14243f 0%,#0d1729 100%);border:1px solid #33507e;border-radius:14px;padding:16px 18px;box-shadow:0 8px 28px rgba(0,0,0,.3)}' +
      '#' + BOX + ' .ai-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}' +
      '#' + BOX + ' .ai-hd h4{margin:0;font-size:15.5px;color:#e6f0ff;font-weight:800;letter-spacing:.3px}' +
      '#' + BOX + ' .ai-badge{font-size:10.5px;color:#7fe0c0;background:#12332c;border:1px solid #216b56;border-radius:20px;padding:2px 9px;font-weight:700}' +
      '#' + BOX + ' .ai-badge.warn{color:#ffcf8b;background:#33271a;border-color:#7a5a26}' +
      '#' + BOX + ' .ai-meta{margin-left:auto;color:#a9bcda;font-size:11px;background:#101c31;border:1px solid #2a3f63;border-radius:6px;padding:3px 9px}' +
      '#' + BOX + ' .ai-verdict{font-size:14px;color:#eaf2ff;line-height:1.8;background:linear-gradient(90deg,rgba(63,123,255,.2),rgba(63,123,255,0));border-left:4px solid #4f8cff;border-radius:0 8px 8px 0;padding:10px 14px;margin-bottom:12px;font-weight:600}' +
      '#' + BOX + ' .hl-red{color:#ff5b6e!important;font-weight:800;background:rgba(255,91,110,.13);padding:0 3px;border-radius:3px}' +
      '#' + BOX + ' .hl-warn{color:#ffc46b;font-weight:800}' +
      '#' + BOX + ' strong{font-weight:800}' +
      '#' + BOX + ' .ai-hls{display:grid;grid-template-columns:repeat(auto-fit,minmax(218px,1fr));gap:9px;margin-bottom:12px}' +
      '#' + BOX + ' .ai-hl{border:1px solid;border-radius:9px;padding:9px 11px;font-size:12px;line-height:1.7}' +
      '#' + BOX + ' .ai-hl .tag{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.3px;padding:1px 7px;border-radius:4px;margin-right:6px}' +
      '#' + BOX + ' .ai-hl.danger{border-color:#7a3040;background:linear-gradient(135deg,rgba(255,75,95,.16),rgba(255,75,95,.03));color:#ffd9de}' +
      '#' + BOX + ' .ai-hl.danger .tag{background:#ff4b5f;color:#fff}' +
      '#' + BOX + ' .ai-hl.warn{border-color:#7a5a26;background:linear-gradient(135deg,rgba(232,161,58,.14),rgba(232,161,58,.02));color:#ffe9c4}' +
      '#' + BOX + ' .ai-hl.warn .tag{background:#e8a13a;color:#241704}' +
      '#' + BOX + ' .ai-hl.ok{border-color:#1f6a52;background:linear-gradient(135deg,rgba(49,201,154,.13),rgba(49,201,154,.02));color:#c9f3e2}' +
      '#' + BOX + ' .ai-hl.ok .tag{background:#31c99a;color:#06261c}' +
      '#' + BOX + ' .ai-hl.info{border-color:#2d4d80;background:linear-gradient(135deg,rgba(79,140,255,.14),rgba(79,140,255,.02));color:#d5e4ff}' +
      '#' + BOX + ' .ai-hl.info .tag{background:#4f8cff;color:#fff}' +
      '#' + BOX + ' .ai-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}' +
      '@media(max-width:900px){#' + BOX + ' .ai-charts{grid-template-columns:1fr}}' +
      '#' + BOX + ' .ai-chart-card{background:#0c1729;border:1px solid #22375a;border-radius:10px;padding:9px 10px 6px;min-width:0}' +
      '#' + BOX + ' .ai-chart-t{font-size:11.5px;color:#9fc0ff;font-weight:800;margin:0 0 4px 4px;letter-spacing:.3px}' +
      '#' + BOX + ' .ai-chart{height:158px;width:100%}' +
      '#' + BOX + ' .ai-chart-empty{height:158px;display:flex;align-items:center;justify-content:center;color:#7085a8;font-size:11.5px}' +
      '#' + BOX + ' .ai-fallback{padding:8px 4px;font-size:10.5px;color:#a9bcda;overflow:hidden}' +
      '#' + BOX + ' .ai-fb-row{display:flex;align-items:center;gap:6px;margin:4px 0}' +
      '#' + BOX + ' .ai-fb-row .nm{width:66px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none}' +
      '#' + BOX + ' .ai-fb-row b{color:#dbe8ff;font-size:10px}' +
      '#' + BOX + ' .ai-fb-bar{height:9px;border-radius:5px;min-width:2px}' +
      '#' + BOX + ' .ai-fb-pie{width:76px;height:76px;border-radius:50%;flex:none;box-shadow:0 0 0 1px #22375a}' +
      '#' + BOX + ' .ai-fb-legend{font-size:10.5px;line-height:1.8;color:#b8c9e6}' +
      '#' + BOX + ' .ai-fb-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px}' +
      '#' + BOX + ' .ai-fb-curve{width:100%;height:118px;display:block}' +
      '#' + BOX + ' .ai-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}' +
      '@media(max-width:1050px){#' + BOX + ' .ai-grid{grid-template-columns:1fr}}' +
      '#' + BOX + ' .ai-col{background:#0e1a2e;border:1px solid #22375a;border-radius:10px;padding:11px 13px;min-width:0}' +
      '#' + BOX + ' .ai-col h5{margin:0 0 8px;font-size:12px;color:#9fc0ff;letter-spacing:.4px;font-weight:800}' +
      '#' + BOX + ' .ai-gap{margin-top:12px!important;padding-top:9px;border-top:1px dashed #2a3e60}' +
      '#' + BOX + ' .ai-step{display:flex;gap:8px;margin:7px 0;font-size:11.8px;line-height:1.7;color:#c6d6f2}' +
      '#' + BOX + ' .ai-step .n{flex:none;width:18px;height:18px;border-radius:50%;background:#28467e;color:#cfe0ff;text-align:center;line-height:18px;font-size:10.5px;font-weight:800}' +
      '#' + BOX + ' .ai-step .t{font-weight:800;color:#e6f0ff}' +
      '#' + BOX + ' .ai-step .d{display:block;color:#a9bcda;margin-top:1px}' +
      '#' + BOX + ' .ai-mm{list-style:none;margin:0;padding-left:0;font-size:11.8px;color:#bcd0f0}' +
      '#' + BOX + ' .ai-mm ul{list-style:none;margin:3px 0 3px 14px;padding-left:10px;border-left:1px dashed #33507e}' +
      '#' + BOX + ' .ai-mm li{margin:3px 0}' +
      '#' + BOX + ' .ai-mm .root{color:#ffe0a0;font-weight:800}' +
      '#' + BOX + ' .ai-ov{margin:10px 0 12px}' +
      '#' + BOX + ' .ai-metrics{width:100%;font-size:11.3px}' +
      '#' + BOX + ' .ai-metrics td{border-top:1px solid #1e2f4c;padding:4px 5px;text-align:left;white-space:normal}' +
      '#' + BOX + ' .ai-metrics td:last-child{text-align:right;color:#dbe8ff;font-weight:800}' +
      '#' + BOX + ' .ai-concl{margin:6px 0 0;padding-left:18px;font-size:11.8px;color:#a8e6c8;line-height:1.8}' +
      '#' + BOX + ' .ai-code{font-size:11.2px;color:#f0b98a;line-height:1.75;margin:5px 0}' +
      '#' + BOX + ' .ai-window{font-size:11px;color:#c6d6f2;line-height:1.9}' +
      '#' + BOX + ' .ai-window span{display:inline-block;width:34px;color:#7f92b8}' +
      '#' + BOX + ' .ai-empty{color:#8b9abc;font-size:12px;padding:8px 0}' +
      '#' + BOX + ' .ai-lock{margin-top:12px;font-size:11px;color:#8fa4c8;border-top:1px dashed #2a3e60;padding-top:9px;line-height:1.8}' +
      '#' + BOX + ' .ai-lock b{color:#dbe8ff}' +
      /* ===== 全量 Forensic 报表：交易明细表 / 归因 / 根因 / 代码块 ===== */
      '#' + BOX + ' .ai-trades{max-height:330px;overflow:auto;border:1px solid #22375a;border-radius:8px;margin-bottom:6px;background:#0c1729}' +
      '#' + BOX + ' .ai-trades table{font-size:11px}' +
      '#' + BOX + ' .ai-trades .mono{font-family:Consolas,Menlo,monospace;font-size:10px;color:#8fb0e8}' +
      '#' + BOX + ' .ai-ana{list-style:none;margin:0;padding:0;font-size:11.6px;line-height:1.75;color:#d3e0f7}' +
      '#' + BOX + ' .ai-ana li{border-left:2px solid #33507e;padding:4px 0 4px 8px;margin:6px 0}' +
      '#' + BOX + ' .ai-ana-h{color:#ffd28a;font-weight:800;font-size:10.5px;display:inline-block;margin-right:5px}' +
      '#' + BOX + ' .ai-root{font-size:12px;line-height:1.85;color:#e8f0ff;background:#10203a;border:1px solid #2a4a7a;border-radius:8px;padding:9px 12px;margin-top:4px}' +
      '#' + BOX + ' .ai-sub{font-size:10.5px;color:#7f92b8;margin:9px 0 3px;font-weight:800;letter-spacing:.3px}' +
      '#' + BOX + ' .ai-codeblock{background:#0a1424;border:1px solid #2a3f63;border-radius:6px;padding:7px 10px;margin:4px 0 2px;' +
        'font-family:Consolas,Menlo,monospace;font-size:10.5px;color:#9fe0c0;white-space:pre-wrap;word-break:break-all;line-height:1.55;max-height:190px;overflow:auto}' +
      /* 全量交易明细报表：分合约净USD/胜率汇总 + 逐笔明细，均分页 */
      '#' + BOX + ' .ai-inst-wrap{margin-bottom:6px}' +
      '#' + BOX + ' .ai-trades thead th{background:#1b2a45;color:#a9c2ee;position:sticky;top:0;z-index:1;white-space:nowrap;padding:5px 7px}' +
      '#' + BOX + ' .ai-inst-tbl{font-size:11px}' +
      '#' + BOX + ' .ai-inst-tbl th{text-align:right}' +
      '#' + BOX + ' .ai-inst-tbl td{text-align:right;padding:4px 7px;border-top:1px solid #22314e;white-space:nowrap}' +
      '#' + BOX + ' .ai-inst-tbl th:first-child,#' + BOX + ' .ai-inst-tbl td:first-child{text-align:left;color:#7fb1ff}' +
      '#' + BOX + ' .ai-inst-tbl tr.ai-sum-row td{font-weight:800;background:#13203a;border-top:2px solid #33507e}' +
      '#' + BOX + ' .ai-inst-tbl tbody tr:hover td{background:#1a2c4a}' +
      '#' + BOX + ' .ai-trades-wrap{margin-bottom:6px}' +
      '#' + BOX + ' .ai-trades{max-height:460px;overflow:auto;border:1px solid #22375a;border-radius:8px;margin-bottom:6px;background:#0c1729}' +
      '#' + BOX + ' .ai-trades table{font-size:11px}' +
      '#' + BOX + ' .ai-trades .mono{font-family:Consolas,Menlo,monospace;font-size:10px;color:#8fb0e8}' +
      '#' + BOX + ' .pager .pg-info{color:#a9bcda;font-size:11.5px;white-space:nowrap;padding:0 6px}' +
      '#' + BOX + ' .pager .pg-per{background:#16233b;color:#a9c2ee;border:1px solid #2b3f63;border-radius:6px;padding:3px 6px;font-size:11.5px;cursor:pointer;margin-left:4px}' +
      '#' + BOX + ' .pager .pg-per:hover{border-color:#3d7bff}' +
      /* 每小时 AI 总结历史表 + 详情弹窗（悬浮窗，样式与面板一致） */
      '#' + BOX + ' .ai-btinst-wrap{margin-top:8px}' +
      '#' + BOX + ' .hist-row{cursor:pointer}' +
      '#' + BOX + ' .hist-row:hover td{background:#1a2c4a}' +
      '#' + BOX + ' .hist-verdict{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#' + BOX + ' .hist-open{color:#3d7bff;font-weight:700;white-space:nowrap}' +
      '#' + BOX + ' .ai-modal-ov{position:fixed;inset:0;z-index:9999;background:rgba(3,9,22,.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:26px}' +
      '#' + BOX + ' .ai-modal{width:min(940px,94vw);max-height:88vh;display:flex;flex-direction:column;background:#0e1a30;border:1px solid #2a3f63;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.55);overflow:hidden}' +
      '#' + BOX + ' .ai-modal-hd{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 18px;background:#12203a;border-bottom:1px solid #22314e;flex:0 0 auto}' +
      '#' + BOX + ' .ai-modal-hd h4{margin:0;font-size:14px;color:#a9c2ee}' +
      '#' + BOX + ' .ai-modal-x{background:#1b2a45;border:1px solid #2b3f63;color:#a9c2ee;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:14px;flex:0 0 auto}' +
      '#' + BOX + ' .ai-modal-x:hover{border-color:#3d7bff;color:#fff}' +
      '#' + BOX + ' .ai-modal-bd{overflow:auto;padding:14px 18px;font-size:12px;color:#c9d6ee;line-height:1.65;flex:1 1 auto}' +
      '#' + BOX + ' .ai-modal-bd h5{margin:12px 0 4px;font-size:12px;color:#cfe0ff}' +
      '#' + BOX + ' .ai-meta-m{color:#8b9abc;font-size:11.5px;margin-top:6px}' +
      /* 结论建议表 / 修改代码表（好看表格格式） */
      '#' + BOX + ' .ai-tbl{width:100%;font-size:11.3px;border-collapse:collapse;margin:4px 0 8px}' +
      '#' + BOX + ' .ai-tbl thead th{background:#1b2a45;color:#a9c2ee;text-align:left;padding:5px 7px;border:1px solid #22314e;position:sticky;top:0}' +
      '#' + BOX + ' .ai-tbl td{border:1px solid #1e2f4c;padding:5px 7px;vertical-align:top;line-height:1.6;color:#cddbf6}' +
      '#' + BOX + ' .ai-tbl tbody tr:hover td{background:#1a2c4a}' +
      '#' + BOX + ' .ai-tbl td.cn{width:26px;text-align:center;color:#7fb1ff;font-weight:800}' +
      '#' + BOX + ' .ai-tbl td.ct b{color:#ffe0a0}' +
      '#' + BOX + ' .ai-tbl td.cf{font-family:Consolas,Menlo,monospace;font-size:10px;color:#7fb1ff;margin-top:2px;word-break:break-all}' +
      '#' + BOX + ' .ai-tbl td.cd{color:#a9bcda;margin-top:2px}' +
      '#' + BOX + ' .ai-tbl td.cs{white-space:nowrap;font-size:10.5px}' +
      '#' + BOX + ' .ai-tbl td.cm{white-space:normal;color:#8b9abc;font-size:10px;margin-top:2px;max-width:110px}' +
      '#' + BOX + ' .st-ok{color:#7ce2a8;font-weight:800}' +
      '#' + BOX + ' .st-bad{color:#ff9a9a;font-weight:800}' +
      '#' + BOX + ' .st-skip{color:#ffcf8a;font-weight:800}' +
      '#' + BOX + ' .st-note{color:#8b9abc}' +
      /* 每笔事件明细原因列 */
      '#' + BOX + ' .ev-why{color:#a9bcda;font-size:10.5px;min-width:220px}';
    document.head.appendChild(st);
    /* ★弹窗全局样式（2026-11-11p）：浮窗定位到鼠标点击位置左侧，不再全屏居中遮罩。
     * .ai-modal-ov = 全屏透明捕获层（点空白关闭）；.ai-modal = fixed 浮窗，left/top 由 JS 按鼠标坐标设定 */
    var st2 = document.createElement('style');
    st2.textContent =
      '.ai-modal-ov{position:fixed;inset:0;z-index:99999;font:13px/1.6 "Microsoft YaHei",sans-serif}' +
      '.ai-modal{position:fixed;left:0;top:0;width:min(880px,92vw);max-height:82vh;display:flex;flex-direction:column;background:#0e1a30;border:1px solid #2a3f63;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.65);overflow:hidden}' +
      '.ai-modal-hd{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 18px;background:#12203a;border-bottom:1px solid #22314e;flex:0 0 auto}' +
      '.ai-modal-hd h4{margin:0;font-size:14px;color:#a9c2ee}' +
      '.ai-modal-x{background:#1b2a45;border:1px solid #2b3f63;color:#a9c2ee;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:14px;flex:0 0 auto}' +
      '.ai-modal-x:hover{border-color:#3d7bff;color:#fff}' +
      '.ai-modal-bd{overflow:auto;padding:14px 18px;font-size:12px;color:#c9d6ee;line-height:1.65;flex:1 1 auto}' +
      '.ai-modal-bd h5{margin:12px 0 4px;font-size:12px;color:#cfe0ff}' +
      '.ai-modal .ai-verdict{font-size:13px;color:#eaf2ff;line-height:1.8;background:linear-gradient(90deg,rgba(63,123,255,.2),rgba(63,123,255,0));border-left:4px solid #4f8cff;border-radius:0 8px 8px 0;padding:10px 14px;margin-bottom:10px;font-weight:600}' +
      '.ai-modal .ai-meta-m{color:#8b9abc;font-size:11.5px;margin-top:6px}' +
      '.ai-modal .ai-root{font-size:12px;line-height:1.85;color:#e8f0ff;background:#10203a;border:1px solid #2a4a7a;border-radius:8px;padding:9px 12px;margin-top:4px}' +
      '.ai-modal .ai-sub{font-size:10.5px;color:#7f92b8;margin:9px 0 3px;font-weight:800}' +
      '.ai-modal .ai-empty{color:#8b9abc;font-size:12px;padding:6px 0}' +
      '.ai-modal .ai-ana{list-style:none;margin:0;padding:0;font-size:11.6px;line-height:1.75;color:#d3e0f7}' +
      '.ai-modal .ai-ana li{border-left:2px solid #33507e;padding:4px 0 4px 8px;margin:6px 0}' +
      '.ai-modal .ai-ana-h{color:#ffd28a;font-weight:800;font-size:10.5px;display:inline-block;margin-right:5px}' +
      '.ai-modal .hl-red{color:#ff5b6e;font-weight:800;background:rgba(255,91,110,.13);padding:0 3px;border-radius:3px}' +
      '.ai-modal .hl-warn{color:#ffc46b;font-weight:800}' +
      '.ai-modal .up{color:#ff6b7d;font-weight:600}.ai-modal .dn{color:#31c99a;font-weight:600}' +
      '.ai-modal .ai-codeblock{background:#0a1424;border:1px solid #2a3f63;border-radius:6px;padding:7px 10px;margin:4px 0 2px;' +
        'font-family:Consolas,Menlo,monospace;font-size:10.5px;color:#9fe0c0;white-space:pre-wrap;word-break:break-all;line-height:1.55;max-height:190px;overflow:auto}' +
      '.ai-modal .ai-tbl{width:100%;font-size:11.3px;border-collapse:collapse;margin:4px 0 8px}' +
      '.ai-modal .ai-tbl thead th{background:#1b2a45;color:#a9c2ee;text-align:left;padding:5px 7px;border:1px solid #22314e}' +
      '.ai-modal .ai-tbl td{border:1px solid #1e2f4c;padding:5px 7px;vertical-align:top;line-height:1.6;color:#cddbf6}' +
      '.ai-modal .ai-tbl td.cn{width:26px;text-align:center;color:#7fb1ff;font-weight:800}' +
      '.ai-modal .ai-tbl td.ct b{color:#ffe0a0}' +
      '.ai-modal .ai-tbl td.cf{font-family:Consolas,Menlo,monospace;font-size:10px;color:#7fb1ff;margin-top:2px;word-break:break-all}' +
      '.ai-modal .ai-tbl td.cd{color:#a9bcda;margin-top:2px}' +
      '.ai-modal .ai-tbl td.cs{white-space:nowrap;font-size:10.5px}' +
      '.ai-modal .ai-tbl td.cm{white-space:normal;color:#8b9abc;font-size:10px;margin-top:2px;max-width:110px}' +
      '.ai-modal .st-ok{color:#7ce2a8;font-weight:800}.ai-modal .st-bad{color:#ff9a9a;font-weight:800}' +
      '.ai-modal .st-skip{color:#ffcf8a;font-weight:800}.ai-modal .st-note{color:#8b9abc}';
    document.head.appendChild(st2);
  }
