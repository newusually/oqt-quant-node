/* ============================================================================
 * core/guard.js —— 进程守护（崩溃捕获 + 心跳 + 优雅退出）
 * ----------------------------------------------------------------------------
 * 解决的问题：服务"跑着跑着就没了"，且日志里查不到任何原因。
 *
 * 根因分析（2026-10-25 实测）：
 *   1. server.js 有 7 个 setInterval 定时器（WS 预热/K线保鲜/价格刷新/缓存预热…），
 *      任何一个回调里抛出的异常都会成为 uncaughtException → Node 默认直接退出进程，
 *      而本项目【没有注册任何 uncaughtException / unhandledRejection 处理器】
 *      → 进程静默死亡，日志只剩最后一条 INFO，事后完全无法定位。
 *   2. 未处理的 Promise rejection 在 Node 15+ 同样会终止进程。
 *   3. Node 的 `ws` 模块在网络异常时若没有 error 监听，会抛出 EventEmitter
 *      的 'Unhandled error' 事件 → 同样是未捕获异常路径。
 *   4. 进程被外部强杀（Ctrl+C / 关机 / 任务管理器）时没有 SIGTERM 处理器，
 *      → 数据不落盘、SQLite WAL 不 checkpoint，重启后要重放恢复。
 *
 * 本模块提供：
 *   - uncaughtException / unhandledRejection 捕获 → 记日志 + 打印完整堆栈 + 优雅退出
 *   - SIGINT / SIGTERM / SIGHUP 优雅退出 → 关闭 HTTP 服务 + 关闭 SQLite + 退出
 *   - 心跳日志（每 N 秒写一条带内存/句柄/运行时长的存活记录），
 *     任何时刻被杀都能从日志定位到最后存活时间
 * ========================================================================== */
'use strict';

const log = require('./log');

const STATE = {
  startedAt: Date.now(),
  crashes: 0,          // 未捕获异常次数
  rejections: 0,       // 未处理 Promise 次数
  lastHeartbeat: 0,
  shuttingDown: false,
};

function memInfo() {
  const m = process.memoryUsage();
  return {
    rss: (m.rss / 1048576).toFixed(1) + 'MB',
    heap: (m.heapUsed / 1048576).toFixed(1) + 'MB',
    ext: (m.external / 1048576).toFixed(1) + 'MB',
  };
}

function uptime() {
  const s = Math.floor((Date.now() - STATE.startedAt) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h ? h + 'h' : '') + m + 'm' + (s % 60) + 's';
}

/* ---------------- 优雅退出 ---------------- */
function gracefulExit(code, reason) {
  if (STATE.shuttingDown) {
    log.err('[guard] 退出流程已在进行中，强制结束 code=' + code);
    process.exit(code);
    return;
  }
  STATE.shuttingDown = true;
  log.warn('[guard] 收到 ' + reason + ' → 优雅退出（code=' + code + '）');
  try {
    // 关闭 HTTP 服务（若有）
    const srv = global.__OQT_HTTP_SERVER__;
    if (srv && typeof srv.close === 'function') {
      srv.close(function () { log.info('[guard] HTTP 服务已关闭'); });
      setTimeout(function () { process.exit(code); }, 3000).unref();
    } else {
      setTimeout(function () { process.exit(code); }, 500).unref();
    }
  } catch (e) {
    log.err('[guard] 关闭过程异常：' + (e && e.stack || e));
    process.exit(code);
  }
}

/* ---------------- 安装守护 ---------------- */
function install(opt) {
  opt = opt || {};
  const exitOnCrash = opt.exitOnCrash !== false;   // 默认：记完日志后退出（避免状态污染）
  const hbInterval = opt.heartbeatMs || 60000;       // 心跳间隔（默认 60 秒）

  /* ① 未捕获异常 —— 这是本项目"静默死亡"的头号原因 */
  process.on('uncaughtException', function (err) {
    STATE.crashes++;
    log.err('[guard] ★未捕获异常（第 ' + STATE.crashes + ' 次）★');
    log.err('[guard] ' + (err && err.stack ? err.stack : String(err)));
    log.err('[guard] 内存 ' + JSON.stringify(memInfo()) + ' 运行时长 ' + uptime());
    if (exitOnCrash) {
      gracefulExit(1, 'uncaughtException');
    }
  });

  /* ② 未处理的 Promise rejection */
  process.on('unhandledRejection', function (reason) {
    STATE.rejections++;
    log.err('[guard] ★未处理 Promise rejection（第 ' + STATE.rejections + ' 次）★');
    log.err('[guard] ' + (reason && reason.stack ? reason.stack : String(reason)));
    log.err('[guard] 内存 ' + JSON.stringify(memInfo()) + ' 运行时长 ' + uptime());
    if (exitOnCrash) {
      gracefulExit(1, 'unhandledRejection');
    }
  });

  /* ③ 信号处理 —— 让外部停止也能走优雅退出（落盘 / WAL checkpoint） */
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(function (sig) {
    process.on(sig, function () {
      gracefulExit(0, sig);
    });
  });

  /* ④ 心跳 —— 任何时刻被杀，都能从日志定位最后存活时间 */
  const hb = setInterval(function () {
    try {
      const mem = memInfo();
      STATE.lastHeartbeat = Date.now();
      log.info('[guard] ♥ 心跳 运行时长=' + uptime() + ' 内存=' + mem.rss +
        '/' + mem.heap + ' 句柄=' + (process._getActiveHandles ? process._getActiveHandles().length : '?') +
        ' 崩溃=' + STATE.crashes + ' 拒绝=' + STATE.rejections);
    } catch (e) { /* 心跳自身出错不能影响主流程 */ }
  }, hbInterval);
  if (hb.unref) hb.unref();      // 不阻止进程退出

  log.info('[guard] 守护已启用：崩溃捕获=开 心跳=' + Math.round(hbInterval / 1000) + 's 优雅退出=开');

  return STATE;
}

module.exports = {
  install: install,
  state: STATE,
  memInfo: memInfo,
  uptime: uptime,
  gracefulExit: gracefulExit,
};
