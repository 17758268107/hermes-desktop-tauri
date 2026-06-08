# tools/init-msvc.ps1
# Initialize MSVC + Windows SDK + Rust + Bun environment in current PowerShell.
# Usage:  . .\tools\init-msvc.ps1

$ErrorActionPreference = 'Stop'

# 1. MSVC toolset
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat'
if (-not (Test-Path $vcvars)) {
  throw "vcvarsall.bat not found at $vcvars"
}

Write-Host "[init-msvc] sourcing vcvarsall.bat x64 ..." -ForegroundColor Cyan
$envDump = cmd /c "`"$vcvars`" x64 >NUL && set" 2>&1
foreach ($line in $envDump) {
  if ($line -match '^(PATH|INCLUDE|LIB|LIBPATH|VCINSTALLDIR|VCToolsInstallDir|WindowsSdkDir|UCRTVersion|WindowsSDKVersion)=(.+)$') {
    $name = $matches[1]
    $value = $matches[2]
    [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

# 2. Rust + Bun + cargo-tauri on PATH
$prepends = @(
  'C:\Users\Administrator\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin',
  'C:\Users\Administrator\.cargo\bin',
  'C:\Users\Administrator\.bun\bin'
)
$sep = [IO.Path]::PathSeparator
$cur = [System.Environment]::GetEnvironmentVariable('Path', 'Process')
$combined = ($prepends -join $sep) + $sep + $cur
[System.Environment]::SetEnvironmentVariable('Path', $combined, 'Process')

# 3. Persist for future shells
foreach ($entry in $prepends) {
  $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if ($user -notlike "*$entry*") {
    [System.Environment]::SetEnvironmentVariable('Path', $entry + $sep + $user, 'User')
  }
}

Write-Host "[init-msvc] ready: $(rustc --version 2>$null)  $(cargo --version 2>$null)  $(bun --version 2>$null)" -ForegroundColor Green
Write-Host "[init-msvc] cl.exe: $(where.exe cl.exe 2>$null | Select-Object -First 1)" -ForegroundColor Green
