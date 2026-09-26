@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte installiere zuerst Node.js LTS von https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\electron\package.json" (
  echo Installiere benoetigte Pakete ...
  call npm install
  if errorlevel 1 (
    echo Installation fehlgeschlagen.
    pause
    exit /b 1
  )
)
call npm start
if errorlevel 1 pause

