$logFile = 'C:\Users\Administrator\AppData\Local\Temp\cargo-build.log'
Add-Content -Path $logFile -Value "[host] $(Get-Date -Format 'o') start"
. C:\Users\Administrator\hermes-workspace\tools\init-msvc.ps1
Set-Location C:\Users\Administrator\hermes-workspace\src-tauri
$job = Start-Job -ScriptBlock { Set-Location C:\Users\Administrator\hermes-workspace\src-tauri; & cargo build --release *>&1 | Out-File C:\Users\Administrator\AppData\Local\Temp\cargo-build.stdout.log -Encoding utf8 } -Name "cargo-build"
Add-Content -Path $logFile -Value "[host] job started id=$($job.Id); waiting..."
$done = Wait-Job -Job $job -Timeout 1800
if ($done) {
    $output = Receive-Job -Job $job -Keep
    Add-Content -Path $logFile -Value "[host] job finished; output first 500 chars: $($output -join "`n" | Out-String).Substring(0, [Math]::Min(500, ($output -join "`n").Length))"
    Remove-Job -Job $job
} else {
    Add-Content -Path $logFile -Value "[host] job still running after 30min"
}
Add-Content -Path $logFile -Value "[host] $(Get-Date -Format 'o') done"
