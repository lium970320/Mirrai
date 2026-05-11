param(
  [string]$RunRoot = "F:\Code\Mirrai"
)

$ErrorActionPreference = "SilentlyContinue"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$serviceScript = Join-Path ([System.IO.Path]::GetFullPath($RunRoot)) "scripts\voxcpm_tts_service.py"
$scriptPattern = [regex]::Escape($serviceScript)
$processes = @(
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -match $scriptPattern
    } |
    Sort-Object ProcessId -Descending
)

if ($processes.Count -eq 0) {
  Write-Host "VoxCPM service is not running."
  exit 0
}

Write-Host "Stopping VoxCPM service processes: $($processes.ProcessId -join ', ')"
foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

$remaining = @(
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -match $scriptPattern
    }
)

if ($remaining.Count -gt 0) {
  Write-Host "Some VoxCPM processes are still running: $($remaining.ProcessId -join ', ')"
  exit 1
}

Write-Host "VoxCPM service stopped."

