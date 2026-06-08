@echo off
REM tools/cargo-msvc.bat
REM Initialize MSVC environment and run cargo. Use this to keep MSVC vars alive
REM across all subprocesses during a build.

setlocal EnableDelayedExpansion

call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64 >NUL
if errorlevel 1 (
  echo [cargo-msvc] vcvarsall failed
  exit /b 1
)

set "PATH=C:\Users\Administrator\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin;C:\Users\Administrator\.cargo\bin;C:\Users\Administrator\.bun\bin;%PATH%"
set "CARGO_TERM_COLOR=never"

cd /d C:\Users\Administrator\hermes-workspace\src-tauri

cargo %*
exit /b %ERRORLEVEL%
