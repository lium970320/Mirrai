param(
  [string]$RunRoot = "F:\Code\Mirrai"
)

$ErrorActionPreference = "SilentlyContinue"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$rootPattern = [regex]::Escape([System.IO.Path]::GetFullPath($RunRoot))
$processes = @(
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -match $rootPattern -and
      ($_.CommandLine -match "pnpm run dev|server/_core/index.ts|tsx|cross-env|corepack|esbuild")
    } |
    Sort-Object ProcessId -Descending
)

if ($processes.Count -eq 0) {
  Write-Host "Mirrai is not running."
  exit 0
}

Write-Host "Stopping Mirrai processes: $($processes.ProcessId -join ', ')"
foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

$remaining = @(
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -match $rootPattern -and
      ($_.CommandLine -match "pnpm run dev|server/_core/index.ts|tsx|cross-env|corepack|esbuild")
    }
)

if ($remaining.Count -gt 0) {
  Write-Host "Some Mirrai processes are still running: $($remaining.ProcessId -join ', ')"
  exit 1
}

Write-Host "Mirrai stopped."
