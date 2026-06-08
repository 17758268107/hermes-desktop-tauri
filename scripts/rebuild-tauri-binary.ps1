$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$srcTaudi = Join-Path $root "src-tauri"
Set-Location $srcTaudi

Write-Host "=== cargo build --release (recompile with new dist/client) ===" -ForegroundColor Yellow
$env:TAURI_SIGNING_PRIVATE_KEY = $null
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $null
$env:NODE_ENV = "production"

$buildLog = Join-Path $root "logs\cargo-rebuild.log"
New-Item -ItemType Directory -Force -Path (Split-Path $buildLog) | Out-Null

$ps = Start-Process -FilePath powershell.exe `
  -ArgumentList "-NoProfile","-Command","Set-Location '$srcTaudi'; `$env:TAURI_SIGNING_PRIVATE_KEY = `$null; `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = `$null; `$env:NODE_ENV = 'production'; cargo build --release *>&1 | Tee-Object -FilePath '$buildLog'" `
  -PassThru -WindowStyle Hidden

Write-Host "Build PID=$($ps.Id), waiting up to 15 min..."
$exited = $ps.WaitForExit(900000)
if (-not $exited) {
  Write-Host "Build did not finish in 15 min, killing..." -ForegroundColor Red
  Stop-Process -Id $ps.Id -Force -ErrorAction SilentlyContinue
  exit 2
}
Write-Host "Build exit: $($ps.ExitCode)" -ForegroundColor Cyan
Write-Host "Log: $buildLog"
exit $ps.ExitCode
