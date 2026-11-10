// api/market.js —— 全站行情摘要接口（总览页 / 全站自动播报 / AI 分析共用）
'use strict';
const market = require('../modules/okx/engines/market');

async function handle(ep, q) {
  switch (ep) {
    case 'summary':
      return await market.summary({ force: q.force === '1' || q.force === 'true' });
    case 'hot':
      return await market.summary({});
    // ★日涨幅排行榜页: A股全市场(5576) + OKX全合约(522) + NQ, 实时比较
    case 'rank':
      return await market.rankData({ limit: q.limit });
    // ★轻量行情快照(3秒秒级刷新用): 只取三市场实时报价, 不排榜/不算AI
    case 'quotes':
      return await market.quotesData();
    // ★分析数据(ECharts 图表 + AI 多参数研判): 涨跌分布/成交额TOP/信号多空/情绪
    case 'analyze':
      return await market.analyzeData();
    default:
      return { ok: false, err: 'unknown market ep ' + ep };
  }
}

module.exports = { handle };
