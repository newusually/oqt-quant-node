/* ============================================================================
 * service/watchdog.js —— 纯 Node 看门狗（不依赖 cmd.exe）
 * ----------------------------------------------------------------------------
 * 为什么用 JS 而不是 .cmd：
 *   Windows 计划任务的 Exec Action 直接执行 cmd.exe 会被安全策略拦截；
 *   而 .cmd 又不能直接作为 Action（Task Scheduler 只执行 PE 可执行文件）。
 *   → 折中：Task Action = E:\dev\nodejs\node.exe service\watchdog.js
 *     看门狗自身用 Node 启动子进程，行为等价但路径干净、且完全脱离 C 盘运行时。
 *
 * 职责（对应"服务自动关闭"三大根因）：
 *   ① 无限循环拉起：无论 Node 是崩溃(码≠0)还是正常退出(码=0)，都自动重启
 *   ② 退避策略：连续快速失败时逐步延长重启间隔，避免疯狂重启打爆 CPU/磁盘
 *   ③ 崩溃现场保留：每次异常退出把 stderr 尾部存一份 crash-<ts>.log
 *   ④ 自身存活记录：watchdog.log 记录每轮拉起时间与退出码
 *
 * 启动方式（三种任选）：
 *   · Windows 计划任务（开机自启，推荐）
 *   · 手动：node E:\oqt-quant-node\service\watchdog.js
 *   · Node 服务包装：service/run-server.cmd
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP_DIR = path.resolve(__dirname, '..');
const NODE_EXE = process.execPath;                     // 用运行本脚本的同一个 Node（保证在 E 盘）
const LOG_DIR = path.join(APP_DIR, 'data', 'logs');
const WD_LOG = path.join(LOG_DIR, 'watchdog.log');
const OUT_LOG = path.join(LOG_DIR, 'service-stdout.log');
const ERR_LOG = path.join(LOG_DIR, 'service-stderr.log');

try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { }

function ts() {
  const d = new Date();
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function wlog(msg) {
  const line = `[${ts()}] ${msg}\n`;
  try { fs.appendFileSync(WD_LOG, line); } catch (e) { }
  process.stdout.write(line);
}

/* 崩溃现场：把 stderr 尾部抄一份独立文件 */
function snapshot(reason) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(LOG_DIR, `crash-${stamp}.log`);
    let tail = '';
    if (fs.existsSync(ERR_LOG)) {
      const raw = fs.readFileSync(ERR_LOG, 'utf8');
      tail = raw.split('\n').slice(-100).join('\n');
    }
    fs.writeFileSync(file,
      `=== crash snapshot ${ts()}  reason=${reason} ===\n` +
      `node=${process.version} exec=${NODE_EXE}\n\n${tail}\n`);
    wlog('已保存崩溃现场: ' + path.basename(file));
  } catch (e) { }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  wlog(`===== watchdog 启动 (node=${process.version} exec=${NODE_EXE}) =====`);

  const outFd = fs.openSync(OUT_LOG, 'a');
  const errFd = fs.openSync(ERR_LOG, 'a');

  let failCount = 0;

  for (;;) {
    const restartDelay = failCount > 10 ? 30000 : failCount > 5 ? 10000 : failCount > 2 ? 5000 : 3000;
    wlog(`启动 node server.js ... (第 ${failCount + 1} 轮)`);

    const child = spawn(NODE_EXE, [path.join(APP_DIR, 'server.js')], {
      cwd: APP_DIR,
      stdio: ['ignore', outFd, errFd],
      env: Object.assign({}, process.env, {
        NODE_OPTIONS: '--max-old-space-size=2048',
        NODE_DISABLE_COLORS: '1',
      }),
      windowsHide: true,          // ★完全静默，不弹窗
    });

    const code = await new Promise((resolve) => {
      child.on('exit', (c, sig) => resolve(sig ? `signal:${sig}` : c));
      child.on('error', (e) => { wlog('spawn 失败: ' + e.message); resolve(-1); });
    });

    failCount++;
    wlog(`node 退出 code=${code} 累计失败 ${failCount} 次`);

    // 异常退出（码≠0 或被信号杀）→ 存崩溃现场
    if (code !== 0) snapshot('exit=' + code);

    // 正常退出（码=0）也留一份快照，便于判断是主动退出还是被杀
    if (code === 0) snapshot('graceful-exit');

    wlog(`${restartDelay / 1000} 秒后重启`);
    await delay(restartDelay);
  }
}

main().catch(e => {
  wlog('watchdog 自身异常: ' + (e && e.stack || e));
  process.exit(1);
});
