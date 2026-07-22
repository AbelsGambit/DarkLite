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
echo  4. Clean Client Data (.file_store_32)
echo  5. Open Dashboard (web UI for config)
echo  6. Install Dependencies (first time setup)
echo  7. Exit
echo ==========================================
set /p choice="Enter choice (1-7): "

if "%choice%"=="1" goto play
if "%choice%"=="2" goto server
if "%choice%"=="3" goto clean
if "%choice%"=="4" goto cleanclient
if "%choice%"=="5" goto dashboard
if "%choice%"=="6" goto install
if "%choice%"=="7" exit
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
pause
goto menu

:play
echo.
echo [1/3] Starting game server...
cd /d "%ROOT%engine"
start "LostCity Server" /b bun start
echo [2/3] Waiting for server to start...
timeout /t 10 /nobreak >nul
echo [3/3] Launching client...
cd /d "%ROOT%client"
call gradlew run
cd /d "%ROOT%"
pause
goto menu

:server
echo.
echo Starting server...
cd /d "%ROOT%engine"
bun start
cd /d "%ROOT%"
pause
goto menu

:clean
echo.
echo [1/3] Cleaning engine build cache...
cd /d "%ROOT%engine"
call npm run clean
echo [2/3] Cleaning client data (.file_store_32)...
if exist "C:\.file_store_32" rmdir /s /q "C:\.file_store_32"
if exist "%USERPROFILE%\.file_store_32" rmdir /s /q "%USERPROFILE%\.file_store_32"
echo [3/3] Starting fresh server...
cd /d "%ROOT%engine"
start "LostCity Server" /b bun start
timeout /t 10 /nobreak >nul
echo Done! Server is running.
cd /d "%ROOT%"
pause
goto menu

:cleanclient
echo.
echo Cleaning .file_store_32 (client stored data)...
if exist "C:\.file_store_32" rmdir /s /q "C:\.file_store_32"
if exist "%USERPROFILE%\.file_store_32" rmdir /s /q "%USERPROFILE%\.file_store_32"
echo Done! Client data cleaned.
cd /d "%ROOT%"
pause
goto menu

:dashboard
echo.
echo Starting dashboard...
cd /d "%ROOT%dashboard"
:: Check if node_modules exists, if not run install first
if not exist "node_modules" (
    echo First run: installing dashboard dependencies...
    call bun install
)
start "LostCity Dashboard" /b bun run dev
echo Waiting for dashboard to start...
timeout /t 10 /nobreak >nul
echo Opening browser at http://localhost:3000
start http://localhost:3000
cd /d "%ROOT%"
pause
goto menu
