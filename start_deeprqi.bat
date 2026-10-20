@echo off
title DeepRQI - System Launcher

REM Ensure we run from the repository root directory
cd /d "%~dp0"

color 0B
cls
echo =====================================================================
echo                     DEEPRQI SYSTEM LAUNCHER
echo          AI-Powered Road Quality and Distress Inspection
echo =====================================================================
echo.

REM 1. Verify Node.js availability
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found in PATH!
    echo Please install Node.js from https://nodejs.org/ to run DeepRQI.
    echo.
    pause
    exit /b 1
)

REM 2. Verify Python executable
set "PYTHON_EXE=deeprqi-ai-service\.venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
    where python >nul 2>&1
    if %errorlevel% equ 0 (
        set "PYTHON_EXE=python"
        echo [INFO] .venv not found in deeprqi-ai-service. Using system Python.
    ) else (
        echo [ERROR] Python not found in deeprqi-ai-service\.venv or system PATH!
        echo Please ensure Python is installed and configured.
        echo.
        pause
        exit /b 1
    )
)

REM 3. Initialize missing environment files
if not exist "deeprqi-ai-service\.env" (
    if exist "deeprqi-ai-service\.env.example" (
        echo [*] Initializing deeprqi-ai-service\.env from .env.example
        copy /y "deeprqi-ai-service\.env.example" "deeprqi-ai-service\.env" >nul
    )
)

if not exist "deeprqi-backend\.env" (
    if exist "deeprqi-backend\.env.example" (
        echo [*] Initializing deeprqi-backend\.env from .env.example
        copy /y "deeprqi-backend\.env.example" "deeprqi-backend\.env" >nul
    )
)

REM 4. Install dependencies if node_modules are missing
if not exist "deeprqi-backend\node_modules\" (
    echo [*] Installing backend dependencies
    pushd deeprqi-backend
    call npm install
    popd
)

if not exist "deeprqi-frontend\node_modules\" (
    echo [*] Installing frontend dependencies
    pushd deeprqi-frontend
    call npm install
    popd
)

echo.
echo =====================================================================
echo  Starting all DeepRQI services...
echo =====================================================================
echo  [1/3] Launching AI Service      -^> http://localhost:8000
echo  [2/3] Launching Backend API     -^> http://localhost:5000
echo  [3/3] Launching Frontend Web UI -^> http://localhost:5173
echo =====================================================================
echo.

REM Launch 1: AI Service (FastAPI + YOLO26)
start "DeepRQI [1/3] - AI Service (Port 8000)" cmd /k "title DeepRQI AI Service [Port 8000] && cd /d "%~dp0deeprqi-ai-service" && "%~dp0%PYTHON_EXE%" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

REM Launch 2: Backend API (Express + Prisma)
start "DeepRQI [2/3] - Backend API (Port 5000)" cmd /k "title DeepRQI Backend API [Port 5000] && cd /d "%~dp0deeprqi-backend" && npm run dev"

REM Launch 3: Frontend (Vite + React)
start "DeepRQI [3/3] - Frontend UI (Port 5173)" cmd /k "title DeepRQI Frontend UI [Port 5173] && cd /d "%~dp0deeprqi-frontend" && npm run dev"

echo Waiting for services to initialize...
ping 127.0.0.1 -n 5 >nul

REM Automatically open default browser to Frontend
echo Opening DeepRQI in your browser: http://localhost:5173
start http://localhost:5173

:MENU
cls
color 0A
echo =====================================================================
echo                     DEEPRQI CONTROL CENTER
echo =====================================================================
echo  All services are up and running!
echo.
echo    [1] Frontend UI:   http://localhost:5173
echo    [2] Backend API:   http://localhost:5000
echo    [3] AI Service:    http://localhost:8000
echo    [4] Swagger Docs:  http://localhost:8000/docs
echo =====================================================================
echo.
echo  Quick Actions:
echo    [1] Open Frontend in Browser
echo    [2] Open AI Docs / Swagger (/docs)
echo    [3] Check Service Health / Active Ports
echo    [4] Stop All Services and Exit
echo    [5] Exit Launcher (Leave Services Running)
echo.
set "CHOICE="
set /p "CHOICE=Enter choice [1-5]: "

if "%CHOICE%"=="1" start http://localhost:5173 & goto MENU
if "%CHOICE%"=="2" start http://localhost:8000/docs & goto MENU
if "%CHOICE%"=="3" goto CHECK_PORTS
if "%CHOICE%"=="4" goto STOP_ALL
if "%CHOICE%"=="5" exit /b 0
goto MENU

:CHECK_PORTS
cls
echo Checking active listening ports (5173, 5000, 8000):
echo.
powershell -Command "Get-NetTCPConnection -LocalPort 5000,8000,5173 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess, State | Format-Table -AutoSize"
echo.
pause
goto MENU

:STOP_ALL
echo.
echo Stopping all DeepRQI services...
powershell -Command "Get-NetTCPConnection -LocalPort 5000,8000,5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo All services stopped successfully.
ping 127.0.0.1 -n 3 >nul
exit /b 0
