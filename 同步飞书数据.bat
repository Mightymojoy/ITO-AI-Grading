@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="
echo.
echo Syncing from Feishu...
echo.
"C:\Users\QwQ\.workbuddy\binaries\node\versions\22.22.2\node.exe" "%~dp0sync_feishu.js"
echo.
pause
