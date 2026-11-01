@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install from nodejs.org.
  pause
  exit /b 1
)
echo Opening CreatorPulse at http://127.0.0.1:8787
start "" "http://127.0.0.1:8787"
node apps/api/server.mjs
pause
