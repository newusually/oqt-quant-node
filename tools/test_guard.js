/* 守护能力实测：故意在运行时抛异常 / 制造未处理 Promise rejection
 * 验证 core/guard.js 能捕获并留下完整堆栈日志
 * 用法: node tools/test_guard.js
 */
'use strict';


console.log('=== 守护能力实测 ===\n');

// ① 未捕获异常
setTimeout(function () {
  console.log('[测试] 触发未捕获异常...');
  setTimeout(function () { throw new Error('GUARD_TEST_UNCAUGHT_EXCEPTION'); }, 0);
}, 300);

// ② 未处理 Promise rejection
setTimeout(function () {
  console.log('[测试] 触发未处理 Promise rejection...');
  Promise.reject(new Error('GUARD_TEST_UNHANDLED_REJECTION'));
}, 800);

setTimeout(function () {
  console.log('\n=== 结束（进程应已因 guard 优雅退出）===');
  process.exit(0);
}, 2500);
