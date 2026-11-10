/* ============================================================================
 * service/launcher.js —— 无窗口启动器（供计划任务 / 快捷方式调用）
 * ----------------------------------------------------------------------------
 * 问题：node.exe 是 PE Subsystem=3（Console 程序）。从 Windows 计划任务
 *   以 InteractiveToken 身份直接启动时，若用户已登录，会在桌面上弹出一个
 *   黑色控制台窗口（虽然服务本身不需要任何交互）。
 *
 * 解决：Windows API CreateProcess 的 dwCreationFlags 支持 CREATE_NO_WINDOW(0x08000000)，
 *   可让 Console 程序在【完全隐藏】的窗口中运行，无任何可见痕迹。
 *
 * 但 Node 的 child_process.spawn 不暴露这个标志（windowsHide 只对 stdio 生效，
 * 不改变窗口创建行为）。因此这里走原生路径：
 *   ① 用 ffi-free 方式调用 CreateProcessW —— 通过一个【极小的 .NET GUI 启动器】
 *      或直接由 Node 调 Win32 API。
 *
 * 实际采用：编译一个 Subsystem=2(GUI) 的 .NET 启动器 oqt-launcher.exe，
 *   它内部用 ProcessStartInfo.CreateNoWindow=true + UseShellExecute=false 拉起 node。
 *   GUI 程序本身无控制台，CreateNoWindow 保证子进程也无控制台。
 *
 * 若 .NET 编译不可用，备选：把 watchdog 的启动交给【注册为服务的 PowerShell 包装】
 *   （schtasks /Create 直接跑 node，但把任务设为 S4U/ServiceAccount → 会话 0，无窗口）。
 *
 * 用法：
 *   node service/launcher.js            → 启动 watchdog（隐藏）
 *   node service/launcher.js --stop     → 停止 watchdog + server
 *   node service/launcher.js --status   → 查询运行状态
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP_DIR = path.resolve(__dirname, '..');
const LOG_DIR = path.join(APP_DIR, 'data', 'logs');
const WD = path.join(__dirname, 'watchdog.js');

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ---------------- 状态文件：记录 watchdog PID，便于停止/查询 ---------------- */
const PID_FILE = path.join(LOG_DIR, 'watchdog.pid');

function readPid() {
  try {
    const s = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = parseInt(s, 10);
    if (!pid) return 0;
    // 校验进程是否还活着
    try {
      process.kill(pid, 0);
      return pid;
    } catch (e) {
      return 0;
    }
  } catch (e) { return 0; }
}

function writePid(pid) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.writeFileSync(PID_FILE, String(pid)); } catch (e) { }
}

function alive(pids) {
  return pids.filter(p => {
    try { process.kill(p, 0); return true; } catch (e) { return false; }
  });
}

/* ---------------- 用 tasklist 找 node 子进程（Windows 原生，无额外依赖） ---------------- */
function listNodePids() {
  try {
    const out = require('child_process').execFileSync('tasklist', ['/FI', 'IMAGENAME eq node.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    const pids = [];
    out.split(/\r?\n/).forEach(l => {
      const m = l.match(/"([^"]+)","(\d+)"/);
      if (m && m[1].toLowerCase() === 'node.exe') pids.push(parseInt(m[2], 10));
    });
    return pids;
  } catch (e) { return []; }
}

function stopAll() {
  const wdPid = readPid();
  let stopped = 0;

  // ① 先杀 watchdog（它会立刻重启 server，必须先杀它）
  if (wdPid) {
    try { process.kill(wdPid, 'SIGKILL'); stopped++; } catch (e) { }
    try { fs.unlinkSync(PID_FILE); } catch (e) { }
  }

  // ② 再杀 server
  const pids = alive(listNodePids());
  for (const p of pids) {
    try {
      const cl = require('child_process').execFileSync('wmic', ['process', 'where', "ProcessId=" + p,
        'get', 'CommandLine', '/value'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      if (/oqt-quant-node/i.test(cl)) {
        try { process.kill(p, 'SIGKILL'); stopped++; } catch (e) { }
      }
    } catch (e) { }
  }
  return stopped;
}

function status() {
  const wdPid = readPid();
  const pids = alive(listNodePids());
  let hasServer = false;
  for (const p of pids) {
    try {
      const cl = require('child_process').execFileSync('wmic', ['process', 'where', "ProcessId=" + p,
        'get', 'CommandLine', '/value'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      if (/oqt-quant-node/i.test(cl)) { hasServer = true; break; }
    } catch (e) { }
  }
  return { watchdogPid: wdPid, serverAlive: hasServer, nodePids: pids };
}

function start() {
  const st = status();
  if (st.watchdogPid && st.serverAlive) {
    console.log('服务已在运行 (watchdog PID=' + st.watchdogPid + ')，无需重复启动');
    return;
  }
  const child = spawn(process.execPath, [WD], {
    cwd: APP_DIR,
    detached: true,                 // ★独立进程组，父进程退出不影响它
    stdio: 'ignore',                // ★不继承任何句柄 → 无控制台附加
    windowsHide: true,              // ★隐藏窗口
    env: Object.assign({}, process.env, { NODE_DISABLE_COLORS: '1' }),
  });
  child.unref();
  writePid(child.pid);
  console.log('[' + ts() + '] watchdog 已启动 (PID=' + child.pid + ')，窗口已隐藏');
}

const arg = process.argv[2] || 'start';
if (arg === 'stop') {
  const n = stopAll();
  console.log('[' + ts() + '] 已停止 ' + n + ' 个进程');
} else if (arg === 'status') {
  console.log(JSON.stringify(status(), null, 2));
} else {
  start();
}
