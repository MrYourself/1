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
if "%GH_TOKEN%"=="" (
  echo Die Umgebungsvariable GH_TOKEN ist nicht gesetzt.
  echo Lege auf GitHub einen Fine-grained Token mit "Contents: Read and write" fuer das Repository an
  echo und setze ihn einmalig mit:  setx GH_TOKEN "dein-token"
  echo Danach dieses Fenster schliessen und das Skript erneut starten.
  pause
  exit /b 1
)
call npm install
if errorlevel 1 goto :error
call npm run check
if errorlevel 1 goto :error
call npm run release:win
if errorlevel 1 goto :error
echo.
echo Fertig. Die Version liegt jetzt als Entwurf in GitHub Releases.
echo Pruefe den Entwurf auf GitHub und klicke auf "Publish release".
echo Erst danach erhalten installierte Apps das Update.
pause
exit /b 0
:error
echo.
echo Das Release ist fehlgeschlagen.
pause
exit /b 1
