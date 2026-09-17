@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="
echo.
echo Syncing from Feishu...
echo.
rem Node runtime probe: the old hardcoded path "%NODEBASE%\22.22.2-2\node.exe"
rem no longer exists after the platform upgraded node, so double-click always hit :bad.
set "NODEBASE=C:\Users\QwQ\.workbuddy\binaries\node\versions"
set "NODE="
set "NODEVER="
if exist "%NODEBASE%\current" for /f "usebackq delims=" %%V in ("%NODEBASE%\current") do if not defined NODEVER set "NODEVER=%%V"
if defined NODEVER if exist "%NODEBASE%\%NODEVER%\node.exe" set "NODE=%NODEBASE%\%NODEVER%\node.exe"
if not defined NODE for /f "delims=" %%D in ('dir /b /ad /o-n "%NODEBASE%" 2^>nul') do (
    if not defined NODE if exist "%NODEBASE%\%%D\node.exe" set "NODE=%NODEBASE%\%%D\node.exe"
)
if not defined NODE for /f "delims=" %%P in ('where node 2^>nul') do (
    if not defined NODE set "NODE=%%P"
)
if not defined NODE set "NODE=node"
"%NODE%" "%~dp0sync_feishu.js"
echo.
pause
