@echo off
rem Paladin Command Center - double-click to start, then close this window (or press Ctrl+C) to stop.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22.13 or newer is required: https://nodejs.org & pause & exit /b 1)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" || (echo Your Node.js is too old. Install 22.13 or newer from https://nodejs.org & pause & exit /b 1)
if not exist node_modules\@anthropic-ai\sdk (call npm install --omit=dev || (pause & exit /b 1))
if not exist .env copy .env.example .env >nul
call npm start
pause
