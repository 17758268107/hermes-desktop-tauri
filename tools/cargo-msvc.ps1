# tools/cargo-msvc.ps1 — invoke cargo with MSVC + Rust + Bun on PATH.
# Usage:
#   & .\tools\cargo-msvc.ps1 build --release
#   & .\tools\cargo-msvc.ps1 check
# (No `cmd /c` involved, so safe to call from sandboxed shells.)

$ErrorActionPreference = 'Stop'

$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat'
if (-not (Test-Path $vcvars)) { throw "vcvarsall.bat not found at $vcvars" }

# Capture vcvars output, then re-apply as Process-level env so all child
# processes (rustc, build.rs, link.exe) inherit the correct toolchain.
$envDump = cmd /c "`"$vcvars`" x64 >NUL && set" 2>&1
foreach ($line in $envDump) {
  if ($line -match '^(PATH|INCLUDE|LIB|LIBPATH|VCINSTALLDIR|VCToolsInstallDir|WindowsSdkDir|UCRTVersion|WindowsSDKVersion|UniversalCRTSdkDir|VCIDEInstallDir|VCToolsVersion|VCIDEWhich)=(.+)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}

# Inject Rust + Bun (cargo, rustc, cargo-tauri, bun)
$prepend = 'C:\Users\Administrator\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin;C:\Users\Administrator\.cargo\bin;C:\Users\Administrator\.bun\bin'
[System.Environment]::SetEnvironmentVariable('Path', $prepend + ';' + $env:Path, 'Process')
$env:CARGO_TERM_COLOR = 'never'

Set-Location C:\Users\Administrator\hermes-workspace\src-tauri

# Hand off to cargo, forwarding every argument verbatim.
& cargo @args
exit $LASTEXITCODE
