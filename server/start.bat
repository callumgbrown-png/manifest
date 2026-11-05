@echo off
setlocal
cd /d "%~dp0"

rem --- Use the Node.js on this PC if there is one, otherwise download a private copy (no install, no admin) ---
if exist ".node\node.exe" set "PATH=%~dp0.node;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  if not exist ".node\node.exe" (
    echo Node.js was not found. Downloading a private copy, about 30 MB. This happens once.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip' -OutFile 'node.zip'; Expand-Archive 'node.zip' -DestinationPath '.node_tmp' -Force; Move-Item '.node_tmp\node-v22.14.0-win-x64' '.node' -Force; Remove-Item '.node_tmp' -Recurse -Force; Remove-Item 'node.zip' -Force"
    if not exist ".node\node.exe" (
      echo.
      echo Could not download Node.js. Check your internet connection, or install it from https://nodejs.org and run this again.
      pause
      exit /b 1
    )
  )
  set "PATH=%~dp0.node;%PATH%"
)

if not exist node_modules call npm install
set TICK_MS=5000
if not defined DIFFICULTY set DIFFICULTY=easy
if not defined ADMIN_TOKEN set ADMIN_TOKEN=my-secret-admin-token-123
start "" http://localhost:8080
call npx tsx src/main.ts
pause
