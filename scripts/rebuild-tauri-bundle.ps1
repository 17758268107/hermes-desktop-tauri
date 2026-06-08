$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$srcTaudi = Join-Path $root "src-tauri"
Set-Location $srcTaudi

$env:TAURI_SIGNING_PRIVATE_KEY = $null
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $null
$env:NODE_ENV = "production"

$logPath = Join-Path $root "logs\tauri-bundle3.log"
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null

Write-Host "=== cargo tauri bundle --bundles nsis ===" -ForegroundColor Yellow
cargo tauri bundle --bundles nsis *>&1 | Tee-Object -FilePath $logPath
Write-Host "Exit: $LASTEXITCODE" -ForegroundColor Cyan
