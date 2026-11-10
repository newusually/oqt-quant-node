@echo off
rem ============================================================================
rem  oqt-quant-node 服务启动包装器（Windows 服务用）
rem ----------------------------------------------------------------------------
rem  作用：
rem   1. 固定使用 E 盘的 Node.js（E:\dev\nodejs\node.exe），不依赖任何 C 盘运行时
rem   2. 重定向 stdout/stderr 到日志文件（服务模式下窗口不可见，日志必须落盘）
rem   3. 崩溃后由 Windows 服务控制器按 Recovery 策略自动重启
rem  4. 工作目录锁定项目目录（相对路径全部有效）
rem ============================================================================
setlocal

set "NODE_DIR=E:\dev\nodejs"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "APP_DIR=E:\oqt-quant-node"
set "LOG_DIR=%APP_DIR%\data\logs"

if not exist "%NODE_EXE%" (
  echo [FATAL] Node.js not found: %NODE_EXE%
  exit /b 1
)
if not exist "%LOG_DIR%" (
  mkdir "%LOG_DIR%" 2>nul
)

cd /d "%APP_DIR%"

rem node 的诊断日志单独出文件，便于事后定位崩溃
set "NODE_OPTIONS=--max-old-space-size=2048"
set "NODE_DISABLE_COLORS=1"

"%NODE_EXE%" "%APP_DIR%\server.js" >> "%LOG_DIR%\service-stdout.log" 2>> "%LOG_DIR%\service-stderr.log"

rem 只有非 0 退出码才记 ERROR，正常退出不算故障
set "RC=%ERRORLEVEL%"
echo [%DATE% %TIME%] oqt-quant-node exited with code %RC% >> "%LOG_DIR%\service-stdout.log"
exit /b %RC%
