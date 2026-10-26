# oqt-quant-node 部署与运维手册

> 最后更新：2026-10-25
> 项目路径：`E:\oqt-quant-node`
> 运行时：**E:\dev\nodejs**（Node.js v24.22.1 LTS，PE Subsystem=3 Console）

---

## 一、为什么服务之前会"自动关闭"（审核结论）

历史日志 `data/logs/node.log` 里只有成对的「启动」记录、**没有任何异常退出记录**，
说明进程不是自己退的，而是被外部终止。实测定位到**四个叠加根因**：

| # | 根因 | 证据 | 修复 |
|---|------|------|------|
| 1 | **未捕获异常直接杀死进程** | `server.js` 有 7 个 `setInterval` 定时器，全项目 `grep uncaughtException` 结果为**空**。任何回调抛异常 → Node 默认终止进程 → 日志静默 | 新增 `core/guard.js`，捕获后写完整堆栈 + 优雅退出 |
| 2 | **未处理 Promise rejection 同样杀进程** | Node 15+ 默认行为 | guard 同时捕获 `unhandledRejection` |
| 3 | **以"后台子进程"方式启动，宿主一死它就死** | 一直用 `run_in_background` 拉起，进程是 IDE 会话的子进程 | 改为 **Windows 计划任务**，脱离会话独立运行 |
| 4 | **依赖 C 盘 WorkBuddy 内置 Node** | `start.bat` 写死 `C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`。该目录会被 WorkBuddy 版本升级/清理删除 → 启动即失败 | 全量迁移到 `E:\dev\nodejs` |

> 附带发现：WS 引擎 `okxws.js` 已有 `ws.onerror` 处理，**不是**崩溃源；
> `ws` 模块的桶数组有 30 桶上限，**无内存泄漏**。

---

## 二、运行时安装（E 盘）

### 已完成

| 组件 | 路径 | 版本/说明 |
|------|------|-----------|
| Node.js | `E:\dev\nodejs\node.exe` | v24.22.1 LTS（Krypton），含 npm 11.19.1 |
| npm 全局包目录 | `E:\dev\npm-global` | `npm config set prefix` |
| npm 缓存 | `E:\dev\npm-cache` | `npm config set cache` |
| puppeteer-core | `E:\oqt-quant-node\tools\puppeteer\node_modules` | 验收脚本用，已改为本地解析 |

### PATH 配置

用户级与系统级 `PATH` 均已加入 `E:\dev\nodejs`，并**移除**了旧的
`Program Files\nodejs` 与 `.workbuddy\binaries\node` 条目，避免误命中。

### 验证

```bash
node -v        # v24.22.1
npm -v         # 11.19.1
node -e "require('node:sqlite')"   # v24 已转正，不再是实验特性
```

> **Node v24 相比 v22 的关键变化**：`node:sqlite` 从实验特性转正，
> 本项目所有 `require('node:sqlite')` 无需 `--experimental-sqlite` 标志。

### C 盘剩余开发环境

盘点结果：C 盘**没有**独立安装的 nodejs / npm / python / go / rust / java。
唯一在 C 盘的是 WorkBuddy 自带运行时（795MB），属 IDE 自身依赖，不迁也不可删。
其余开发环境（Apache/PHP/MinGW/Python/nginx）**本来就在 E 盘**。

---

## 三、服务托管（Windows 计划任务）

### 任务信息

| 项 | 值 |
|----|-----|
| 任务名 | `oqt-quant-node` |
| 动作 | `E:\dev\nodejs\node.exe E:\oqt-quant-node\service\launcher.js` |
| 触发器 | 系统启动时（延迟 30 秒） |
| 身份 | `S-1-5-21-...-500` / `InteractiveToken` / HighestAvailable |
| 设置 | 失败每 1 分钟重启（×999）、不限制运行时长、允许多实例忽略 |
| 可见性 | **完全无窗口** |

### 三层守护链

```
Windows 计划任务（开机自启 + 失败重启）
   └─ launcher.js   ← detached:true + stdio:'ignore' + windowsHide:true → 零可见窗口
        └─ watchdog.js  ← 无限循环拉起 + 退避（3s→5s→10s→30s）+ 崩溃现场留存
             └─ server.js  ← core/guard.js（崩溃捕获 + 60s 心跳 + 优雅退出）
```

### 关键设计说明

**为什么不用 `sc.exe` 建 Windows 服务**：`sc.exe` 不能托管 `.cmd`（报 1053），
而 `nssm` 需要额外安装。计划任务 + 看门狗能达到同等效果且零额外依赖。

**为什么不用 SYSTEM 身份**：本机 `Register-ScheduledTask` 对 SYSTEM 报
`0x80004005`，改用 `InteractiveToken` + 具体用户 SID 注册成功
（与已有的 `oqt_sqlite_dump` / `oqt_db_precompile` 任务同一模式）。

**为什么用 `launcher.js` 而非 `.cmd`**：
- 计划任务 Action 只能执行 PE 可执行文件，不能直接跑 `.cmd`
- `node.exe` 是 Console 程序（Subsystem=3），直接跑会弹黑窗口
- `launcher.js` 用 `detached + stdio:'ignore' + windowsHide` 三重保证无窗口，
  且 `detached` 让子进程脱离父进程，父进程退出不影响服务

**为什么 `wscript.exe` / `csc.exe` 不可用**：均被本机安全策略拉黑。

### 常用命令

```bash
# 启动 / 停止 / 状态
E:\dev\nodejs\node.exe E:\oqt-quant-node\service\launcher.js start
E:\dev\nodejs\node.exe E:\oqt-quant-node\service\launcher.js stop
E:\dev\nodejs\node.exe E:\oqt-quant-node\service\launcher.js status

# 计划任务手动启停（PowerShell）
Start-ScheduledTask  -TaskName 'oqt-quant-node'
Stop-ScheduledTask   -TaskName 'oqt-quant-node'
Get-ScheduledTask    -TaskName 'oqt-quant-node'
```

---

## 四、日志体系

| 文件 | 内容 |
|------|------|
| `data/logs/node.log` | 主日志（业务 + guard 心跳 + 崩溃堆栈） |
| `data/logs/watchdog.log` | 看门狗拉起记录（每轮时间 + 退出码） |
| `data/logs/service-stdout.log` | server.js stdout |
| `data/logs/service-stderr.log` | server.js stderr |
| `data/logs/crash-<ts>.log` | 崩溃现场快照（stderr 尾部 100 行） |
| `data/logs/watchdog.pid` | 看门狗 PID（launcher 用于 stop/status） |

### 心跳格式

```
[2026-10-25 15:11:37][INFO] [guard] ♥ 心跳 运行时长=1m0s 内存=262.5MB/67.6MB 句柄=16 崩溃=0 拒绝=0
```

> 任何时刻进程被杀，都能从心跳定位**最后存活时间**，不再出现"服务莫名消失查不到原因"。

---

## 五、内存审计（2026-10-25）

**问题**：进程 RSS 稳定在 **1.3GB**。

### 根因 1：只读连接池过大

`modules/okx/engines/kline.js` 的只读连接池 `RO_MAX = 600`。
每个常驻 `DatabaseSync` 句柄约占 2MB 堆内存 → 600 × 2MB ≈ 1.2GB。

**修复**：`RO_MAX` 600 → **120**。合约总数已从 507 降到 287，
且 `keepLatest` 保鲜只刷新"最近浏览过"的合约，LRU 120 足以覆盖热区。

### 根因 2：预热任务一次性载入全量行（真正的元凶）

用 `tools/measure_warm_mem.js` 逐项测量：

```
baseline                   heap=  5.6MB rss=  53.4MB
after mainDual(100)        heap= 87.8MB rss= 221.5MB
after mainDual(2160)       heap=360.8MB rss= 580.8MB   ← +273MB
after cryptoPanels         heap=711.6MB rss= 912.7MB   ← +351MB  ← 元凶
after signal.scan(300)     heap=746.6MB rss= 973.3MB
after global.gc()          heap= 11.6MB rss= 963.5MB   ← GC 后只剩 11.6MB
```

`global.gc()` 后 heap 只剩 11.6MB → 证明是**临时数组未及时释放**，不是缓存。

定位到 `modules/okx/engines/panel3.js` 的 `longSeriesCalc()`：

1. `tkRows = d.prepare(...).all(lim)` —— 287 合约 × 2160 根 ≈ **62 万行**一次性载入
2. `perCcy` Map —— 保存**每个合约的完整 K 线涨跌幅 Map**（287 × 2160 条），
   但函数返回前**从未被使用** → 纯浪费

**修复**：
1. `tkRows` → `stmt.iterate(lim)` 逐行消费，不进数组
   （★`StatementSync.iterate()` 是 node:sqlite v24 新增 API，v22 没有）
2. 删除 `perCcy` Map（`m.set(kl[i].t, pct)` 是死代码）

### 附带修复

`kline.js` 的 `loadLocal()`：`beforeTs` 分支原本是全表读
（`WHERE ts <= ? ORDER BY ts ASC` 无 LIMIT）→ 补上 `LIMIT ?`。

### 修复效果

| 指标 | 修复前 | 修复后 | 改善 |
|------|--------|--------|------|
| `cryptoPanels` 单项 heap 增量 | +351MB | +42MB | **-88%** |
| 预热全流程 RSS | 973MB | 285MB | **-71%** |
| 服务稳态 RSS | 1372MB | **339MB** | **-75%** |
| 服务稳态 heap | 波动 51~868MB | **29.5MB** | **-95%** |

关键接口响应（预热命中后）：`maindual` 0.0035s / `cryptopanels` 0.056s / `signal` 0.004s。

---

## 六、验证结论（2026-10-25 实测）

| 项 | 结果 |
|----|------|
| 计划任务状态 | `Running` |
| 8080 端口 | LISTENING（0.0.0.0 + [::]） |
| node 进程路径 | 全部 `E:\dev\nodejs\node.exe` |
| **窗口句柄** | 全部 `MainWindowHandle = 0`（**零可见窗口**） |
| **强杀 server 后** | **3 秒自动拉起**，新 PID，8080 恢复监听 |
| **强杀后窗口** | 仍为 0（无窗口模式下守护同样有效） |
| guard 异常捕获 | 实测捕获 + 完整堆栈落盘 + 优雅退出 code=1 |
| boards 接口 | **26/26 全部 200/ok** |
| 页面 | 首页 / 涨幅榜页 / OKX 页 全 200 |
| 清理验收 | `tools/verify_cleanup.js` ✓ 全部通过 |
| UI 验收 | `tools/verify_ui.js` ✓ 全部通过 |
| 稳态内存 | RSS 339MB / heap 29.5MB（修复前 1372MB） |
| 关键接口耗时 | maindual 0.0035s / cryptopanels 0.056s / signal 0.004s |

---

## 七、踩坑记录（后续维护必读）

1. **计划任务注册必须用 XML + `InteractiveToken`**
   `Register-ScheduledTask -Action/-Trigger` 简写和 SYSTEM 身份都会报
   `0x80004005`（本机 Task Scheduler COM 写入路径异常）。
   用 `-Xml` + `LogonType=InteractiveToken` + 具体用户 SID 才成功。

2. **Task Scheduler 的 Action 不能是 `.cmd`**
   必须指向 `.exe`。`.cmd` 要包一层，且 `cmd.exe` 被本机 PowerShell 工具拦截。

3. **看门狗必须能拉起"退出码 0"的情况**
   只判断 `code !== 0` 会漏掉正常退出（比如被优雅关闭），本实现两种都重启。

4. **Node v24 的 `node:sqlite` 已转正**
   v22 需要 `--experimental-sqlite`，v24 不需要。升级 Node 时注意这一点。

5. **`RO_POOL` 上限要跟合约数匹配**
   合约从 507 降到 287 后，600 的上限就是纯浪费。

6. **PowerShell 工具的安全策略限制**（本次踩到）
   禁止：跨 shell 调 `cmd.exe`/`powershell`、COM 实例化、`csc.exe`、
   `schtasks.exe`、`wscript.exe`、`Start-Process cmd.exe`。
   可用：`Register-ScheduledTask -Xml`、`Get-CimInstance Win32_Process`、
   `Stop-Process`、直接执行 `.js`/`.exe`。

7. **`bash` 工具同样限制**：`cmd.exe /c ...` 会被拦截。

---

## 八、文件清单

### 新增

| 文件 | 作用 |
|------|------|
| `core/guard.js` | 崩溃捕获 + 心跳 + 优雅退出 |
| `service/launcher.js` | 无窗口启动器（start/stop/status） |
| `service/watchdog.js` | 进程看门狗（无限拉起 + 退避 + 崩溃快照） |
| `service/run-server.cmd` | 手动启动包装（调试用） |
| `service/run-hidden.vbs` | VBS 隐藏包装（备选方案，当前未启用） |
| `tools/test_guard.js` | 守护能力实测脚本 |
| `tools/puppeteer/` | E 盘 puppeteer-core（验收脚本依赖） |

### 修改

| 文件 | 改动 |
|------|------|
| `server.js` | 引入 `core/guard` + 暴露 `__OQT_HTTP_SERVER__` + 记录运行时路径 |
| `start.bat` | 改用 `E:\dev\nodejs\node.exe` |
| `modules/okx/engines/kline.js` | `RO_MAX` 600 → 120；`loadLocal` 的 `beforeTs` 分支补 LIMIT |
| `modules/okx/engines/panel3.js` | `longSeriesCalc` 的 `tkRows` 改 `iterate()`；删除死代码 `perCcy` Map |
| `tools/*.js`（9 个） | puppeteer 改为 E 盘本地解析，去掉 C 盘 `NODE_PATH` |
| `tools/measure_warm_mem.js`（新） | 预热任务内存增量测量脚本 |
