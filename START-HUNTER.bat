@echo off
title RH Freemint Hunter
cd /d "%~dp0"

echo.
echo   ========================================
echo      RH FREEMINT HUNTER
echo   ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed.
  echo.
  echo   1. Go to  https://nodejs.org
  echo   2. Download the "LTS" version and install it
  echo   3. Run this file again
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   First time setup - installing. This takes a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   Setup failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo   Creating your settings file...
  copy ".env.example" ".env" >nul
)

echo   Starting the dashboard...
echo   Your browser will open in a moment.
echo.
echo   Keep this window open while the bot runs.
echo   Close it to shut everything down.
echo.

start "" http://127.0.0.1:4663
call npm run ui

echo.
echo   The hunter has stopped.
pause
