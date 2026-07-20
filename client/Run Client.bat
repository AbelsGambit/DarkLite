@echo off
:menu
cls
cd /d "%~dp0"
echo ===================================
echo   GRADLE CLIENT MANAGER
echo ===================================
echo 1. Build Client
echo 2. Run Client
echo 3. Exit
echo ===================================
echo.

set /p choice="Enter your choice (1-3): "

if "%choice%"=="1" (
    echo.
    echo Running: .\gradlew build
    call .\gradlew build
    echo.
    pause
    goto menu
)

if "%choice%"=="2" (
    echo.
    echo Running: .\gradlew run
    call .\gradlew run
    echo.
    pause
    goto menu
)

if "%choice%"=="3" (
    exit
)

echo Invalid choice, please try again.
pause
goto menu