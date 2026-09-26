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
where git >nul 2>nul
if errorlevel 1 set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>nul
if errorlevel 1 (
  echo Git wurde nicht gefunden. Bitte Git fuer Windows installieren.
  pause
  exit /b 1
)

echo Pruefe den Code ...
call npm run check
if errorlevel 1 goto :error

rem Offene Aenderungen werden vor dem Release gesichert.
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Aenderungen vor dem Release"
  if errorlevel 1 goto :error
)

echo Erhoehe die Versionsnummer ...
call npm version patch -m "Release %%s"
if errorlevel 1 goto :error

echo Lade zu GitHub hoch ...
git push --follow-tags origin main
if errorlevel 1 goto :error

echo.
echo Fertig. GitHub baut und veroeffentlicht die neue Version jetzt automatisch.
echo Fortschritt: https://github.com/MrYourself/1/actions
echo Installierte Apps finden das Update innerhalb von 4 Stunden und installieren es beim Beenden.
pause
exit /b 0
:error
echo.
echo Das Release ist fehlgeschlagen.
pause
exit /b 1
