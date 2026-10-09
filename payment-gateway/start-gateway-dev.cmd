@echo off
setlocal
cd /d "%~dp0"
start "Louma Gateway API - dev" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0run-local.ps1" dev api
start "Louma Gateway Worker - dev" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0run-local.ps1" dev worker
endlocal
