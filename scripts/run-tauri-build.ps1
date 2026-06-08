#!/usr/bin/env pwsh
# Run cargo tauri build via cmd.exe with PATH properly set.
# The Tauri CLI spawns "cargo metadata" internally; this script makes
# sure cargo is on PATH for both layers.

$ErrorActionPreference = "Stop"
$cargoHome = "C:\cargo"
$tauriHome = "C:\Users\Administrator\.cargo\bin"

# Ensure PATH is set for the Tauri CLI so it can find cargo
$env:PATH = "$cargoHome\bin;$tauriHome;$env:PATH"
$env:CARGO_HOME = $cargoHome
$env:RUSTUP_HOME = "C:\rustup"
$env:CI = "false"

$root = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $root

Write-Host "=== Tauri build (NSIS) ===" -ForegroundColor Cyan
Write-Host "Working dir: $root"
Write-Host "Cargo:       $(& "$cargoHome\bin\cargo.exe" --version)"
Write-Host "Tauri CLI:   $(& "$tauriHome\cargo-tauri.exe" --version)"
Write-Host ""

# Run cargo tauri build via cmd.exe so PATH is inherited correctly
# The Tauri CLI invokes "cargo metadata" / "cargo build" as child
# processes; we want them to find cargo on PATH.
$cmd = "set PATH=$cargoHome\bin;$tauriHome;%PATH% && cd /d `"$root`" && `"$tauriHome\cargo-tauri.exe`" tauri build --bundles nsis"
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput "C:\Users\Administrator\AppData\Local\Temp\tb_cmd.out" -RedirectStandardError "C:\Users\Administrator\AppData\Local\Temp\tb_cmd.err"
Write-Host "Tauri build PID: $($proc.Id)"
Wait-Process -Id $proc.Id -Timeout 1800 -ErrorAction SilentlyContinue
if (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) {
    Stop-Process -Id $proc.Id -Force
    Write-Host "TIMEOUT 30min" -ForegroundColor Red
    exit 1
}
Write-Host "DONE" -ForegroundColor Green
Write-Host ""
Write-Host "--- last 30 stderr ---"
Get-Content "C:\Users\Administrator\AppData\Local\Temp\tb_cmd.err" -Tail 30
Write-Host ""
Write-Host "--- last 15 stdout ---"
Get-Content "C:\Users\Administrator\AppData\Local\Temp\tb_cmd.out" -Tail 15
Write-Host ""
Write-Host "--- NSIS bundle ---"
Get-ChildItem "$root\src-tauri\target\release\bundle\nsis\*.exe" -ErrorAction SilentlyContinue | Select-Object Name, Length
