@echo off
rem ============================================================================
rem  oqt-quant-node 手动启动脚本（E 盘 Node.js，不依赖 C 盘运行时）
rem ----------------------------------------------------------------------------
rem  ★ 推荐：无窗口启动（完全不弹黑框）
rem       E:\dev\nodejs\node.exe E:\oqt-quant-node\service\launcher.js
rem
rem  ★ 本脚本用于需要看到控制台输出时手动调试
rem
rem  ★ 生产运行请用 Windows 计划任务（开机自启 + 崩溃自动拉起）：
rem       任务名: oqt-quant-node
rem       动作:   E:\dev\nodejs\node.exe E:\oqt-quant-node\service\launcher.js
rem ============================================================================
chcp 65001 >nul
cd /d E:\oqt-quant-node
set "PORT=8080"
set "NODE_EXE=E:\dev\nodejs\node.exe"

if not exist "%NODE_EXE%" (
  echo [ERROR] Node.js not found: %NODE_EXE%
  echo         请检查 E:\dev\nodejs 是否存在
  pause
  exit /b 1
)

echo [oqt-quant-node] 使用 E 盘 Node 启动 (端口 %PORT%)...
"%NODE_EXE%" -v
echo.
"%NODE_EXE%" server.js

echo.
echo [oqt-quant-node] 服务已退出 (code=%ERRORLEVEL%)
pause
