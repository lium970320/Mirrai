@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo Starting Mirrai local service...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\start-mirrai.ps1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo Mirrai is available at:
  echo   http://localhost:3000/
  start "" "http://localhost:3000/"
) else (
  echo Mirrai start failed or timed out.
  echo Logs:
  echo   F:\.mirrai-local\Mirrai\logs
)

echo.
pause
exit /b %EXITCODE%
