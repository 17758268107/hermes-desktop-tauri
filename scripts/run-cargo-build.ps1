$ErrorActionPreference = "Continue"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$srcTaudi = Join-Path $root "src-tauri"
$logPath = Join-Path $root "logs\cargo-build-claude-config.log"
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
if (Test-Path $logPath) { Remove-Item $logPath -Force }

$env:TAURI_SIGNING_PRIVATE_KEY = $null
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $null
$env:NODE_ENV = "production"

Set-Location $srcTaudi
Write-Host "=== cargo build --release ===" -ForegroundColor Yellow
cargo build --release *>&1 | ForEach-Object { Write-Host $_; Add-Content -Path $logPath -Value $_ }
$ec = $LASTEXITCODE
Write-Host "Exit: $ec" -ForegroundColor Cyan
Add-Content -Path $logPath -Value "=== Exit: $ec ==="
exit $ec
