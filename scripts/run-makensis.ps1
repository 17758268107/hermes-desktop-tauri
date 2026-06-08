$ErrorActionPreference = "Continue"
$nsisDir = "C:\Users\Administrator\AppData\Local\tauri\NSIS"
$makensis = Join-Path $nsisDir "Bin\makensis.exe"
$nsiDir = "C:\Users\Administrator\hermes-workspace\src-tauri\target\release\nsis\x64"
$logFile = "C:\Users\Administrator\hermes-workspace\logs\makensis.log"

if (Test-Path $logFile) { Remove-Item $logFile -Force }
$env:PATH = "$nsisDir\Bin;$env:PATH"
Set-Location $nsiDir

Write-Host "=== Running makensis via detached process ===" -ForegroundColor Yellow
Write-Host "  CWD: $(Get-Location)"
Write-Host "  NSIS: $makensis"
Write-Host "  Log: $logFile"

& $makensis /V2 installer.nsi *>&1 | ForEach-Object { Write-Host $_; Add-Content -Path $logFile -Value $_ }
$ec = $LASTEXITCODE
Write-Host "Exit: $ec" -ForegroundColor Cyan
Add-Content -Path $logFile -Value "=== Exit: $ec ==="
exit $ec
