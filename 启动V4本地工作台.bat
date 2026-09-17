@echo off
rem ============================================================
rem  ITO v4.9.0 Local Workbench (semantic scoring) - one-click launcher
rem  Double-click this file to start the workbench and open the browser.
rem  Close the window = stop the workbench.
rem  First-run: it will ask for your DeepSeek API key once and save it to
rem  sem_key_local.txt (gitignored - never pushed to the repo).
rem ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
title ITO v4.9.0 Semantic Workbench (Local)
cd /d "%~dp0"

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
set "NODE_EXE=%NODE%"

set "KEYFILE=%~dp0sem_key_local.txt"
if "%DEEPSEEK_API_KEY%"=="" if exist "%KEYFILE%" set /p DEEPSEEK_API_KEY=<"%KEYFILE%"

if "%DEEPSEEK_API_KEY%"=="" (
  echo.
  echo   [First run] DeepSeek API Key not found.
  echo   Semantic scoring needs a valid DeepSeek key ^(sk-...^).
  echo   Paste it below - saved ONLY to sem_key_local.txt, never pushed:
  echo.
  set /p DEEPSEEK_API_KEY=  Key: 
  if "!DEEPSEEK_API_KEY!"=="" (
    echo   No key given - starting anyway; semantic will degrade to keyword mode.
  ) else (
    > "%KEYFILE%" echo !DEEPSEEK_API_KEY!
    echo   Saved to sem_key_local.txt
  )
)

echo.
echo   Starting ITO v4.9.0 local workbench at http://127.0.0.1:8791/v4/index.html
echo   (browser will open automatically; close this window to stop)
echo.
"%NODE_EXE%" "%~dp0v4\_v4_local_server.js" 8791
pause
