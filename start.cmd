@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js 20 tro len de chay website.
  echo Tai tai: https://nodejs.org/
  pause
  exit /b 1
)
node scripts/open-web.mjs
if errorlevel 1 pause
