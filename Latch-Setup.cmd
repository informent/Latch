@echo off
setlocal
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node 24 from https://nodejs.org/en/download and reopen this file.
  pause
  exit /b 1
)
node "%~dp0scripts\launch.js" setup
set "opendeskResult=%errorlevel%"
echo.
pause
exit /b %opendeskResult%
