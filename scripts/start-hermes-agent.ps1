$ErrorActionPreference = "Continue"
$hermesExe = "C:\Users\Administrator\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe"
$logPath = "C:\Users\Administrator\hermes-workspace\logs\hermes-agent-start.log"
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
if (Test-Path $logPath) { Remove-Item $logPath -Force }

# hermes-agent opens a console window by default; we suppress it with
# CREATE_NO_WINDOW (0x08000000) on the Start-Process call. This matches the
# project rule "subprocesses must not show console windows".
$noWindow = 0x08000000
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $hermesExe
$psi.Arguments = "gateway run"
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WindowStyle = "Hidden"
$psi.EnvironmentVariables["PYTHONUNBUFFERED"] = "1"
$psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8"
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.WorkingDirectory = "C:\Users\Administrator"

Write-Host "Starting hermes gateway..." -ForegroundColor Yellow
$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "  PID: $($proc.Id)"

# Forward output in background
Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
  if ($EventArgs.Data) { Add-Content -Path $using:logPath -Value $EventArgs.Data; Write-Host $EventArgs.Data }
} | Out-Null
Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
  if ($EventArgs.Data) { Add-Content -Path $using:logPath -Value "[ERR] $EventArgs.Data" }
} | Out-Null
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()

# Wait up to 30s for /health to come up
Write-Host "Waiting for /health on 8642..." -ForegroundColor Yellow
for ($i=0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8642/health" -UseBasicParsing -TimeoutSec 2
    Write-Host "Health OK at $($i)s" -ForegroundColor Green
    Write-Host $r.Content
    break
  } catch {
    if ($i -eq 29) { Write-Host "Health check timed out" -ForegroundColor Red }
  }
}
exit 0
