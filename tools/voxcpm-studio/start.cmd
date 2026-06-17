@echo off
chcp 65001 >nul
title VoxCPM Studio
rem One-click launcher: ensure VoxCPM online -> start studio -> open browser.
rem Prefer PowerShell 7 (pwsh); fall back to Windows PowerShell 5.1.
where pwsh >nul 2>nul && (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
) || (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
)
echo.
echo Studio stopped. Press any key to close.
pause >nul
