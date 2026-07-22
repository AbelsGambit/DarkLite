@echo off
title LostCity Launcher
color 0A

:: Save the root directory (where Launcher.bat lives)
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ==========================================
echo        LostCity Launcher v0.1
echo ==========================================
echo.

:: Check if Bun is installed
where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Bun is not installed. Get it from https://bun.sh
    pause
    exit /b 1
)

:: Check if Java is installed
where java >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Java is not installed. Get JDK 11+ from https://adoptium.net
    pause
    exit /b 1
)

echo [OK] Bun found
echo [OK] Java found
echo.

:menu
cd /d "%ROOT%"
echo ==========================================
echo  What would you like to do?
echo ==========================================
echo  1. Play (start server + launch client)
echo  2. Start Server only (bun start)
echo  3. Clean Build (wipe cache + restart)
echo  4. Open Dashboard (web UI for config)
echo  5. Install Dependencies (first time setup)
echo  6. Exit
echo ==========================================
set /p choice="Enter choice (1-6): "

if "%choice%"=="1" goto play
if "%choice%"=="2" goto server
if "%choice%"=="3" goto clean
if "%choice%"=="4" goto dashboard
if "%choice%"=="5" goto install
if "%choice%"=="6" exit
goto menu

:install
echo.
echo [1/2] Installing engine dependencies...
cd /d "%ROOT%engine"
call bun install
echo [2/2] Installing dashboard dependencies...
cd /d "%ROOT%dashboard"
call bun install
echo.
echo Done! Dependencies installed.
cd /d "%ROOT%"
goto end

:play
echo.
echo [1/3] Starting game server...
cd /d "%ROOT%engine"
start "LostCity Server" /b bun start
echo [2/3] Waiting for server to start...
timeout /t 8 /nobreak >nul
echo [3/3] Launching client...
cd /d "%ROOT%client"
call gradlew run
goto end

:server
echo.
echo Starting server...
cd /d "%ROOT%engine"
bun start
goto end

:clean
echo.
echo [1/3] Cleaning build...
cd /d "%ROOT%engine"
call npm run clean
echo [2/3] Cleaning .file_store_32...
if exist "C:\.file_store_32" rmdir /s /q "C:\.file_store_32"
if exist "%USERPROFILE%\.file_store_32" rmdir /s /q "%USERPROFILE%\.file_store_32"
echo [3/3] Starting fresh server...
cd /d "%ROOT%engine"
start "LostCity Server" /b bun start
timeout /t 8 /nobreak >nul
echo Done! Server is running.
goto end

:dashboard
echo.
echo Starting dashboard...
cd /d "%ROOT%dashboard"
:: Check if node_modules exists, if not run install first
if not exist "node_modules" (
    echo First run: installing dependencies...
    call bun install
)
start "LostCity Dashboard" /b bun run dev
echo Waiting for dashboard to start...
timeout /t 8 /nobreak >nul
echo Opening browser...
start http://localhost:3000
goto end

:end
echo.
cd /d "%ROOT%"
pause
goto menu
