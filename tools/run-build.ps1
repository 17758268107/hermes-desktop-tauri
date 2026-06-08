$ErrorActionPreference = 'Continue'
$logFile = 'C:\Users\Administrator\AppData\Local\Temp\cargo-build.log'
Add-Content -Path $logFile -Value "[wrapper] $(Get-Date -Format 'o') starting cargo build (pid=$PID)"
try {
    . C:\Users\Administrator\hermes-workspace\tools\init-msvc.ps1
    Add-Content -Path $logFile -Value "[wrapper] init-msvc.ps1 sourced ok"
    Set-Location C:\Users\Administrator\hermes-workspace\src-tauri
    Add-Content -Path $logFile -Value "[wrapper] cwd = $PWD"
    # Run cargo and tee output
    $p = Start-Process -FilePath "cargo" -ArgumentList "build","--release" -WorkingDirectory $PWD -PassThru -WindowStyle Hidden -RedirectStandardOutput "C:\Users\Administrator\AppData\Local\Temp\cargo-build.stdout.log" -RedirectStandardError "C:\Users\Administrator\AppData\Local\Temp\cargo-build.stderr.log"
    Add-Content -Path $logFile -Value "[wrapper] cargo started, pid=$($p.Id); waiting..."
    $p.WaitForExit()
    Add-Content -Path $logFile -Value "[wrapper] cargo exit=$($p.ExitCode)"
} catch {
    Add-Content -Path $logFile -Value "[wrapper] ERROR: $_"
}
Add-Content -Path $logFile -Value "[wrapper] $(Get-Date -Format 'o') done"
