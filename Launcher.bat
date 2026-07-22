@echo off
title LostCity Launcher
color 0A

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
echo ==========================================
echo  What would you like to do?
echo ==========================================
echo  1. Play (build + launch client)
echo  2. Start Server only (bun start)
echo  3. Clean Build (wipe cache + restart)
echo  4. Open Dashboard (web UI)
echo  5. Exit
echo ==========================================
set /p choice="Enter choice (1-5): "

if "%choice%"=="1" goto play
if "%choice%"=="2" goto server
if "%choice%"=="3" goto clean
if "%choice%"=="4" goto dashboard
if "%choice%"=="5" exit
goto menu

:play
echo.
echo [1/3] Starting game server...
cd engine
start /b bun start
echo [2/3] Waiting for server to start...
timeout /t 8 /nobreak >nul
echo [3/3] Launching client...
cd ..\client
call gradlew run
goto end

:server
echo.
echo Starting server...
cd engine
bun start
goto end

:clean
echo.
echo [1/3] Cleaning build...
cd engine
call npm run clean
echo [2/3] Cleaning .file_store_32...
if exist "C:\.file_store_32" rmdir /s /q "C:\.file_store_32"
if exist "%USERPROFILE%\.file_store_32" rmdir /s /q "%USERPROFILE%\.file_store_32"
echo [3/3] Starting fresh server...
start /b bun start
timeout /t 8 /nobreak >nul
echo Done! Server is running.
goto end

:dashboard
echo.
echo Starting dashboard...
cd dashboard
start /b bun run dev
timeout /t 5 /nobreak >nul
start http://localhost:3000
goto end

:end
echo.
pause
