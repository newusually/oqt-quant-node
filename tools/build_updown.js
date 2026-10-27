#!/usr/bin/env node
/* ============================================================================
 * tools/build_updown.js —— ★构建「涨跌家数」预计算表（2026-10-26）
 * ----------------------------------------------------------------------------
 * 用户需求："数据库的就要先计算然后存放补充数据 ... 历史就用数据库的"
 *
 * 用法：node tools/build_updown.js --grains=1h,2h,4h
 *   扫描 data/okx/kline/<inst>_<grain>.sqlite 全量K线，
 *   按时间片统计上涨/下跌家数（★平盘算跌），写入 data/okx/updown.sqlite。
 * ========================================================================== */
'use strict';
const path = require('path');
const ST = require(path.join(__dirname, '../modules/okx/engines/updownstore'));

function arg(k, dft) {
  const m = process.argv.slice(2).find(a => a.startsWith('--' + k + '='));
  return m ? m.split('=').slice(1).join('=') : dft;
}

(async function () {
  const grains = (arg('grains', '1h,2h,4h')).split(',').map(s => s.trim()).filter(Boolean);
  for (const g of grains) {
    const t0 = Date.now();
    const r = await ST.build(g);
    console.log('[' + g + '] ' + JSON.stringify(r) + ' · ' + Math.round((Date.now() - t0) / 1000) + 's');
  }
})();
