$ErrorActionPreference = "Continue"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logPath = Join-Path $root "logs\bun-build-claude-config.log"
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
if (Test-Path $logPath) { Remove-Item $logPath -Force }

$env:NODE_ENV = "production"
$env:HERMES_HOME = $null
$env:HOST = $null

Set-Location $root
Write-Host "=== bun run build (frontend) ===" -ForegroundColor Yellow
& bun run build *>&1 | ForEach-Object { Write-Host $_; Add-Content -Path $logPath -Value $_ }
$ec = $LASTEXITCODE
Write-Host "Exit: $ec" -ForegroundColor Cyan
Add-Content -Path $logPath -Value "=== Exit: $ec ==="
exit $ec
