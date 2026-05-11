param(
  [string]$RunRoot = "F:\Code\Mirrai",
  [string]$LogRoot = "F:\.mirrai-local\Mirrai\logs",
  [int]$Port = 8818
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
    Sort-Object ProcessId
)

Write-Host "VoxCPM status"
Write-Host "Service script: $serviceScript"
Write-Host "URL: http://127.0.0.1:$Port"
Write-Host ""

if ($processes.Count -gt 0) {
  Write-Host "Process: RUNNING ($($processes.Count) process(es))"
  $processes |
    Select-Object ProcessId, Name, @{ Name = "Command"; Expression = { $_.CommandLine } } |
    Format-Table -AutoSize |
    Out-String -Width 220 |
    Write-Host
} else {
  Write-Host "Process: STOPPED"
}

try {
  $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
  Write-Host "Health: OK"
  $response | ConvertTo-Json -Depth 4 | Write-Host
} catch {
  Write-Host "Health: NOT RESPONDING ($($_.Exception.Message))"
}

Write-Host ""
Write-Host "Recent logs:"
foreach ($name in @("voxcpm.out.log", "voxcpm.err.log")) {
  $path = Join-Path $LogRoot $name
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Host "--- $path missing ---"
    continue
  }
  Write-Host "--- $path ---"
  Get-Content -LiteralPath $path -Tail 60 -Encoding UTF8
}

