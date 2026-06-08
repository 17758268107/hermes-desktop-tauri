#!/usr/bin/env pwsh
# Build hermes-workspace Tauri release binary + NSIS installer
# Run this from a normal PowerShell window (not inside the Trae IDE).
# The Trae IDE sandbox kills cargo build before it can finish.
#
# Usage:
#   .\scripts\build-tauri-release.ps1
#   .\scripts\build-tauri-release.ps1 -SkipFrontend     # skip vite build
#   .\scripts\build-tauri-release.ps1 -BundleOnly        # skip cargo build, just bundle existing binary
#
# Output:
#   src-tauri\target\release\hermes-workspace.exe                (unpacked binary)
#   src-tauri\target\release\bundle\nsis\Hermes Workspace_*.exe   (NSIS installer)

[CmdletBinding()]
param(
    [switch]$SkipFrontend,
    [switch]$BundleOnly,
    [switch]$NoBundle,
    [int]$Jobs = 0
)

$ErrorActionPreference = "Stop"
# scripts/ is the parent of $PSScriptRoot, so the repo root is
# $PSScriptRoot's parent.  We do not depend on a working-directory set
# by the caller — the script works from anywhere.
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

# Ensure Rust toolchain on PATH
$cargo = "C:\cargo\bin\cargo.exe"
$rustc = "C:\cargo\bin\rustc.exe"
$tauri = "C:\Users\Administrator\.cargo\bin\cargo-tauri.exe"
$env:PATH = "C:\cargo\bin;C:\Users\Administrator\.cargo\bin;$env:PATH"
$env:CARGO_HOME = "C:\cargo"
$env:RUSTUP_HOME = "C:\rustup"
$env:CI = "false"

if (-not (Test-Path $cargo)) { throw "cargo not found at $cargo" }
if (-not (Test-Path $tauri)) { throw "cargo-tauri not found at $tauri" }

Write-Host "=== Hermes Workspace Tauri release build ===" -ForegroundColor Cyan
Write-Host "Root:       $root"
Write-Host "Cargo:      $(& $cargo --version)"
Write-Host "Tauri CLI:  $(& $tauri tauri --version)"
Write-Host ""

if (-not $SkipFrontend) {
    Write-Host "[1/3] Frontend build (bun install + vite build)..." -ForegroundColor Yellow
    if (Test-Path bun.lock) {
        bun install
    } else {
        bun install   # migrate from pnpm-lock.yaml if needed
    }
    if ($LASTEXITCODE -ne 0) { throw "bun install failed" }
    bun run build
    if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
} else {
    Write-Host "[1/3] Frontend build SKIPPED" -ForegroundColor DarkGray
}

if (-not $BundleOnly) {
    Write-Host "[2/3] Rust release build (cargo build --release)..." -ForegroundColor Yellow
    $cargoArgs = @("build", "--release")
    if ($Jobs -gt 0) { $cargoArgs += @("-j", "$Jobs") }
    & $cargo @cargoArgs
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
} else {
    Write-Host "[2/3] Rust release build SKIPPED" -ForegroundColor DarkGray
}

if (-not $NoBundle) {
    Write-Host "[3/3] NSIS bundle (cargo tauri build --bundles nsis)..." -ForegroundColor Yellow
    & $tauri tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "tauri bundle failed" }
} else {
    Write-Host "[3/3] NSIS bundle SKIPPED" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "Binary:    $root\src-tauri\target\release\hermes-workspace.exe"
Write-Host "Installer: $root\src-tauri\target\release\bundle\nsis\"
Get-ChildItem "$root\src-tauri\target\release\bundle\nsis\*.exe" -ErrorAction SilentlyContinue | Select-Object Name, Length
