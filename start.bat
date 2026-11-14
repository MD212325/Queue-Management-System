@echo off
setlocal
cd /d "%~dp0"
title Queue Management System

echo Starting Queue Management System...
echo (run "start.bat rebuild" after updating the admin console source)
echo.

if not exist node_modules (
  echo Installing server packages...
  call npm install || goto :fail
)
if not exist frontend\node_modules (
  echo Installing admin console packages...
  call npm --prefix frontend install || goto :fail
)
if /i "%~1"=="rebuild" goto :build
if not exist frontend\dist\index.html goto :build
goto :run

:build
echo Building the admin console...
call npm --prefix frontend run build || goto :fail

:run
if not exist .env (
  echo.
  echo NOTE: there is no .env file yet. Copy .env.example to .env and set STAFF_KEY.
)
echo.
node server.js
goto :eof

:fail
echo.
echo Setup failed. Please read the messages above.
pause
