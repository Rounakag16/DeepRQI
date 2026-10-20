@echo off
title DeepRQI - Stop All Services
setlocal

cd /d "%~dp0"
color 0C
cls
echo =====================================================================
echo                     DEEPRQI SERVICE SHUTDOWN
echo =====================================================================
echo.
echo Stopping all running DeepRQI services on ports 5173, 5000, 8000...

powershell -Command "Get-NetTCPConnection -LocalPort 5000,8000,5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Write-Host 'Stopping PID' $_.OwningProcess 'on port' $_.LocalPort; Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo.
echo =====================================================================
echo All DeepRQI services have been stopped.
echo =====================================================================
ping 127.0.0.1 -n 3 >nul
