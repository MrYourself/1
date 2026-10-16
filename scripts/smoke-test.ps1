# Starts the packaged app with --smoke-test and fails when its self-test fails.
# Used by the GitHub workflows after every build (see src/smoke-test.js).
param([string]$AppDir = 'dist/win-unpacked')

$ErrorActionPreference = 'Stop'
$exe = Get-ChildItem -Path $AppDir -Filter '*.exe' | Where-Object { $_.Name -notmatch '^Uninstall' } | Select-Object -First 1
if (-not $exe) { throw "Keine App-EXE in $AppDir gefunden." }
$report = Join-Path ([System.IO.Path]::GetTempPath()) 'twitch-chat-overlay-smoke.json'
Remove-Item -Path $report -ErrorAction SilentlyContinue

Write-Host "Starte $($exe.Name) --smoke-test"
$process = Start-Process -FilePath $exe.FullName -ArgumentList '--smoke-test' -PassThru
# Without touching the handle, PowerShell may report no exit code at all.
$null = $process.Handle
if (-not $process.WaitForExit(120000)) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw 'Selbsttest: Die App hat sich nach 120 Sekunden nicht beendet.'
}
if (Test-Path $report) { Get-Content -Path $report -Raw | Write-Host } else { Write-Host 'Kein Ergebnisbericht gefunden.' }
if ($process.ExitCode -ne 0) { throw "Selbsttest fehlgeschlagen (Exit-Code $($process.ExitCode))." }
Write-Host 'Selbsttest bestanden.'
