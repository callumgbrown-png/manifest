@echo off
setlocal
set "NODE_OPTIONS="
set "NODE_PATH="
if not exist "%~dp0runtime\node.exe" (
  echo Manifest's bundled runtime is missing. Extract the entire ZIP and try again.
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0play.mjs" %*
set "manifest_result=%errorlevel%"
if not "%manifest_result%"=="0" if not "%~1"=="--no-browser" pause
exit /b %manifest_result%
