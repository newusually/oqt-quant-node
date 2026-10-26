/* 预热任务内存增量测量：定位 827MB heap 峰值的来源
 * 用法: node tools/measure_warm_mem.js
 */
'use strict';

const APP = 'E:/oqt-quant-node';
const P3 = require(APP + '/modules/okx/engines/panel3');
const SIG = require(APP + '/modules/okx/engines/signal');

function mb() { return (process.memoryUsage().heapUsed / 1048576).toFixed(1); }
function rss() { return (process.memoryUsage().rss / 1048576).toFixed(1); }
function show(tag) {
  console.log(`${tag.padEnd(34)} heap=${mb().padStart(7)}MB rss=${rss().padStart(7)}MB`);
}

(async () => {
  show('baseline');
  await P3.mainDual({ sector: '', grain: '1h', bars: 100 });
  show('after mainDual(100)');
  await P3.mainDual({ sector: '', grain: '1h', bars: 2160 });
  show('after mainDual(2160)');
  await P3.cryptoPanels({ grain: '1h' });
  show('after cryptoPanels');
  await SIG.scan({ sector: '', bars: 300, ratio: 1, needUp: 3, limit: 400 });
  show('after signal.scan(300)');

  // 强制 GC 看真实留存
  if (global.gc) { global.gc(); show('after global.gc()'); }
  else console.log('\n（提示：用 --expose-gc 运行可看到 GC 后真实留存内存）');
  process.exit(0);
})();
