// M10 / L10 tools/tests · 引擎单元测试（验证一比一转换的逻辑正确）
'use strict';
const assert = require('assert');
const kline = require('../../engines/kline');
const ind = require('../../engines/ind');
const sig = require('../../engines/signal');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  -> ' + e.message); }
}

console.log('engines/kline');
t('aggConsecutive 合并 N 根', () => {
  const rows = [[0,1,2,0,1,10],[1,1,3,0,2,20],[2,2,4,1,3,30],[3,3,5,2,4,40]];
  const out = kline.aggConsecutive(rows, 2);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0][2], 3); // high = max(2,3)
  assert.strictEqual(out[0][3], 0); // low = min(0,0)
  assert.strictEqual(out[0][5], 30); // vol sum
});
t('aggPeriod 周聚合', () => {
  const rows = [[0,1,1,1,1,1],[7*86400,1,1,1,1,1]]; // 相差一周
  const out = kline.aggPeriod(rows, 'w');
  assert.strictEqual(out.length, 2);
});

console.log('engines/ind');
t('macdFull 返回等长数组', () => {
  const cl = [10,11,10,12,13,12,14,15,14,16,17,16,18,19,20];
  const r = ind.macdFull(cl);
  assert.strictEqual(r.dif.length, cl.length);
  assert.strictEqual(r.dea.length, cl.length);
  assert.strictEqual(r.hist.length, cl.length);
  // 上涨趋势 DIF 应高于 DEA（后期）
  assert.ok(r.dif[cl.length-1] > r.dea[cl.length-1]);
});
t('rsi 边界', () => {
  const cl = Array.from({length:30},(_,i)=>i+1); // 单调涨
  const r = ind.rsi(cl, 14);
  assert.strictEqual(r[29], 100);
});

console.log('engines/signal');
t('chanSignals 金叉=买 死叉=卖', () => {
  // 构造 先涨(30)→跌(15)→涨(15) 的较长序列，EMA12/26 才能出现交叉
  const cl = [];
  for (let i = 0; i < 30; i++) cl.push(10 + i * 0.3);      // 上涨
  for (let i = 0; i < 15; i++) cl.push(19 - i * 0.4);      // 下跌
  for (let i = 0; i < 15; i++) cl.push(13 + i * 0.5);      // 再涨
  const s = sig.chanSignals(cl);
  assert.ok(s.length >= 2, '应至少 2 个交叉, 实际 ' + s.length);
  assert.ok(s.some(x => x.side === 1), '应有买入(金叉)');
  assert.ok(s.some(x => x.side === -1), '应有卖出(死叉)');
});

console.log('\n结果: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
