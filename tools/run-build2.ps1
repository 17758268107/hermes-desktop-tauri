$ErrorActionPreference = 'Continue'
$logFile = 'C:\Users\Administrator\AppData\Local\Temp\cargo-build2.log'
$stdoutLog = 'C:\Users\Administrator\AppData\Local\Temp\cargo-build.stdout.log'
$stderrLog = 'C:\Users\Administrator\AppData\Local\Temp\cargo-build.stderr.log'

Add-Content -Path $logFile -Value "[wrapper2] $(Get-Date -Format 'o') starting cargo build (pid=$PID)"

# Truncate stdout/stderr logs
"" | Out-File -FilePath $stdoutLog -Encoding utf8
"" | Out-File -FilePath $stderrLog -Encoding utf8

try {
    . C:\Users\Administrator\hermes-workspace\tools\init-msvc.ps1
    Add-Content -Path $logFile -Value "[wrapper2] init-msvc.ps1 sourced ok"
    Set-Location C:\Users\Administrator\hermes-workspace\src-tauri
    Add-Content -Path $logFile -Value "[wrapper2] cwd = $PWD"

    $env:PATH = 'C:\Users\Administrator\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin;C:\Users\Administrator\.cargo\bin;' + $env:PATH

    $p = Start-Process -FilePath "cargo.exe" -ArgumentList "build","--release" -WorkingDirectory $PWD -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
    Add-Content -Path $logFile -Value "[wrapper2] cargo started, pid=$($p.Id); waiting for exit..."
    $p.WaitForExit()
    Add-Content -Path $logFile -Value "[wrapper2] cargo exit code=$($p.ExitCode)"
} catch {
    Add-Content -Path $logFile -Value "[wrapper2] ERROR: $_"
}
Add-Content -Path $logFile -Value "[wrapper2] $(Get-Date -Format 'o') done"
