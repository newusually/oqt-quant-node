' ============================================================================
' service\run-hidden.vbs —— 无窗口启动包装器
' ----------------------------------------------------------------------------
' 用途：让看门狗在【完全隐藏】的窗口中运行
'   WshShell.Run 的第二个参数：
'     0 = 隐藏窗口（完全不显示）
'     1 = 显示正常窗口
'     7 = 最小化
'   第三个参数 bWaitOnReturn=False → 立即返回，调用方不阻塞
'
' 用途场景：
'   ① 计划任务（InteractiveToken）以用户会话运行，直接跑 node.exe 会弹出黑窗口
'   ② 手动双击启动时不希望看到任何控制台
'
' 本文件只做"隐藏窗口"这一件事，不含业务逻辑。
' ============================================================================
Option Explicit

Dim fso, shell, baseDir, nodeExe, watchdog, logDir, f
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir    = "E:\oqt-quant-node"
nodeExe    = "E:\dev\nodejs\node.exe"
watchdog   = baseDir & "\service\watchdog.js"
logDir     = baseDir & "\data\logs"

If Not fso.FolderExists(logDir) Then
  fso.CreateFolder(logDir)
End If

' 前置检查：node 不存在就直接退出（不弹错窗）
If Not fso.FileExists(nodeExe) Then
  Set f = fso.OpenTextFile(logDir & "\watchdog.log", 8, True)
  f.WriteLine "[" & Now() & "] FATAL: node.exe not found: " & nodeExe
  f.Close
  WScript.Quit 1
End If

' 0 = 隐藏窗口（完全不可见），False = 不等待
shell.CurrentDirectory = baseDir
shell.Run """" & nodeExe & """ """ & watchdog & """", 0, False
