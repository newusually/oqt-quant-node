# oqt-quant-node · 架构文档（一比一语言转换）

> 本项目是 `E:\oqt-quant-latest`（C++ / PHP / Go / Python 混合）的 **Node.js 一比一语言转换版**。
> 原项目的**分层架构 + 组件引擎（DLL）** 全部保留并 1:1 还原为 Node 模块；DLL 改为 Node 组件（纯 JS 引擎），
> 前端一律改为 **json + css + js + ajax + html + nodejs**（不再使用 Vue/Webpack 打包，纯原生 AJAX 调 JSON 接口）。
> **不使用 nginx**：Node 原生 http 直接服务静态资源 + JSON API。
> 最新版 `s`（AI 识别语音）整文件夹并入 `modules/s`。数据复制进 `data/`。

---

## 一、顶层十层（node 项目分十层）

| 层 | 目录 | 职责 | 原 latest 对应 |
|----|------|------|----------------|
| L1 配置层 | `config/` | 全局配置（端口/DB/API Key 占位） | `configs/` + `.oqtroot` |
| L2 核心层 | `core/` | 日志、数学、时间、编解码等基础工具 | `cpp/core/` |
| L3 依赖层 | `lib/` | 第三方/厂商封装（sqlite 等） | `cpp/vendor/` |
| L4 引擎层 | `engines/` | **业务引擎 = 原 DLL→Node 组件**：kline/ind/signal/trade/guard/tp/orch/bt | `cpp/bin/*.exe` + `cpp/{kline,ind,signal,...}` |
| L5 数据层 | `data/` | 数据访问 + 复制进来的数据（sqlite/json） | `cpp/db` + `cpp/store` + `datas/` |
| L6 服务层 | `services/` | 跨模块编排/工作流 | `cpp/orch` + `cpp/shell` |
| L7 接口层 | `api/` | HTTP/JSON 路由，分发到各子项目 | `web/src/js/service/api.js` + `astock/web/api.php` |
| L8 表现层 | `web/` | 顶层仪表盘：纯 HTML/CSS/JS/AJAX | `web/index.html` + `web/src` |
| L9 子项目层 | `modules/` | okx / nq / astock / s，每个再分十层 | `cpp/okx` + `astock/` + `s/` + NQ 相关 |
| L10 工具层 | `tools/` | 脚本、定时任务、测试、构建 | `cpp/tools` + `cpp/tests` + `*.py` |

### 引擎层 L4 的 1:1 映射（DLL → Node 组件）

| 原 cpp 模块 | Node 组件（engines/） | 说明 |
|-------------|----------------------|------|
| `cpp/kline` | `engines/kline` | K线拉取 + 周期聚合（2H/4H/6H/周/月） |
| `cpp/ind` | `engines/ind` | 指标：MA / EMA / MACD / KDJ / RSI 等 |
| `cpp/signal` | `engines/signal` | 缠论买卖点（EMA12/26 金叉/死叉） |
| `cpp/trade` | `engines/trade` | 下单/持仓/对账 |
| `cpp/guard` | `engines/guard` | 风控/守护 |
| `cpp/tp` | `engines/tp` | 止盈 |
| `cpp/orch` | `engines/orch` | 编排调度 |
| `cpp/bt` | `engines/bt` | 回测 |

---

## 二、子项目十层（每个子项目分十层）

以 `modules/astock` 为例，其它子项目（okx/nq/s）同构：

| 层 | 目录 | 职责 |
|----|------|------|
| M1 | `config/` | 子项目配置 |
| M2 | `core/` | 子项目基础工具 |
| M3 | `lib/` | 子项目依赖封装 |
| M4 | `engines/` | 子项目专属引擎（如 A股 Sina/Tencent 行情抓取、市场扫描） |
| M5 | `data/` | 子项目数据（缓存 json / 本地存储） |
| M6 | `services/` | 子项目业务服务（信号聚合、预警） |
| M7 | `api/` | 子项目 JSON 接口实现（被顶层 api/ 调用） |
| M8 | `web/` | 子项目前端（纯 HTML/CSS/JS/AJAX） |
| M9 | `tasks/` | 定时任务/守护进程（轮询行情、扫描信号） |
| M10 | `tests/` | 单元测试 |

---

## 三、技术栈（用户指定）

- 后端：**Node.js**（原生 `http`，无框架、无 nginx），统一返回 **JSON**。
- 前端：**HTML + CSS + 原生 JS + AJAX(fetch)**，Canvas 自研绘图引擎（1:1 原 `app.js` 的 `drawKline`）。
- 数据：复制原 `datas/`（json / compiled.json / export / main.sqlite）+ `configs/` 到 `data/`。
- 语音：`modules/s` 整文件夹并入（最新版 AI 识别语音）。

## 四、端口与运行

- `node server.js` 启动；默认 `:8080` 服务 web + api（可加 `:80` 直接对外，无需 nginx）。
- 静态根：`web/`；接口前缀：`/api/*`。

## 五、转换进度

- [x] 顶层十层骨架 + 本架构文档
- [x] 核心引擎移植：kline / ind / signal
- [x] Node 服务（去 nginx）
- [x] 子项目 astock 十层 + 原生 JS/AJAX 前端（K线 + DIF/DEA + 缠论买卖信号）
- [x] 并入 s + 复制数据
- [ ] okx / nq 子项目引擎与前端（后续按同样十层补齐）
- [ ] trade / guard / tp / orch / bt 引擎（后续）
