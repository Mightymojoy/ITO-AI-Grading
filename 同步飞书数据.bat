@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="
echo.
echo 正在从飞书多维表格同步数据，请稍候…
echo.
"C:\Users\QwQ\.workbuddy\binaries\node\versions\22.22.2\node.exe" "%~dp0sync_feishu.js"
echo.
pause
