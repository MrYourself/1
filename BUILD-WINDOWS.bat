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
call npm install
if errorlevel 1 goto :error
call npm run check
if errorlevel 1 goto :error
call npm run dist:win
if errorlevel 1 goto :error
echo.
echo Fertig. Installer und portable EXE liegen im Ordner dist.
pause
exit /b 0
:error
echo.
echo Der Build ist fehlgeschlagen.
pause
exit /b 1

