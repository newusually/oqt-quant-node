/* 实测 tradfi.js：分类/1D涨跌幅/5m/1m榜 */
const T = require('../modules/okx/engines/tradfi');
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

(async () => {
  console.log('=== 1. universe 分类 ===');
  const u = await T.universe(true);
  console.log('ok=' + u.ok + ' 总合约=' + u.list.length + ' [' + el() + ']');
  console.log('板块: ' + u.sectors.map(s => s.name + '(' + s.count + ')').join(' '));

  console.log('\n=== 2. 各板块 1D 当日涨跌幅 top3 ===');
  for (const s of u.sectors) {
    const r = await T.sectorQuotes(s.id, 3);
    if (!r.ok || !r.list.length) { console.log('  ' + s.name + ': 无行情'); continue; }
    console.log('  ' + s.icon + ' ' + s.name + ': ' + r.list.map(x => x.name + ' ' + x.pxText + ' ' + x.pctText).join(' | '));
  }

  console.log('\n=== 3. 1D 涨跌幅双榜 ===');
  const b1 = await T.boards('1d', { limit: 5 });
  console.log('  扫描=' + b1.scanned + ' 涨幅: ' + b1.gain.map(x => x.name + ' ' + x.pctText).join(', '));
  console.log('  跌幅: ' + b1.lose.map(x => x.name + ' ' + x.pctText).join(', '));

  console.log('\n=== 4. 5m 涨跌幅榜 ===');
  const b5 = await T.boards('5m', { limit: 5, scan: 40 });
  console.log('  扫描=' + b5.scanned + ' 涨幅: ' + (b5.gain || []).map(x => x.name + ' ' + x.pctText).join(', ') + ' [' + el() + ']');

  console.log('\n=== 5. 1m 涨跌幅榜 ===');
  const b1m = await T.boards('1m', { limit: 5, scan: 40 });
  console.log('  扫描=' + b1m.scanned + ' 涨幅: ' + (b1m.gain || []).map(x => x.name + ' ' + x.pctText).join(', ') + ' [' + el() + ']');

  console.log('\n总耗时 ' + el());
})().catch(e => { console.error('ERR', e); process.exit(1); });
