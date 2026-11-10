@echo off
rem Opens the Manifest Simulator window (Start / Stop buttons). Needs the venv: see sim\ml\README.md.
cd /d "%~dp0"
if not exist "sim\ml\.venv\Scripts\pythonw.exe" (
  echo The Python environment is missing. Run these once from this folder:
  echo   py -3.13 -m venv sim\ml\.venv
  echo   sim\ml\.venv\Scripts\python -m pip install -r sim\ml\requirements.txt
  echo   cd server ^&^& npm ci
  pause
  exit /b 1
)
start "" "sim\ml\.venv\Scripts\pythonw.exe" -m sim.ml.app
