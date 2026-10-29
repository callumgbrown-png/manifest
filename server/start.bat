@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
set TICK_MS=5000
if not defined DIFFICULTY set DIFFICULTY=easy
if not defined ADMIN_TOKEN set ADMIN_TOKEN=my-secret-admin-token-123
start "" http://localhost:8080
npx tsx src/main.ts
pause
