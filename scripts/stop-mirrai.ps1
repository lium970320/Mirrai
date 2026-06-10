param(
  [string]$RunRoot = "F:\Code\Mirrai",
  [int]$Port = 3000
)

$ErrorActionPreference = "SilentlyContinue"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$rootPattern = [regex]::Escape([System.IO.Path]::GetFullPath($RunRoot))
$processes = @(
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -match $rootPattern -and
      ($_.CommandLine -match "pnpm run dev|server[/\\]_core[/\\]index\.ts|tsx|cross-env|corepack|esbuild")
    } |
    Sort-Object ProcessId -Descending
)

if ($processes.Count -eq 0) {
  $portOwners = @(
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )

  if ($portOwners.Count -gt 0) {
    try {
      $response = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 3
      if ($response.Content -match "Mirrai") {
        $processes = @(
          Get-CimInstance Win32_Process |
            Where-Object { $portOwners -contains $_.ProcessId } |
            Sort-Object ProcessId -Descending
        )
      }
    } catch {
      # If the port does not return the Mirrai page, do not stop an unknown process.
    }
  }

  if ($processes.Count -eq 0) {
    Write-Host "Mirrai is not running."
    exit 0
  }
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
      ($_.CommandLine -match "pnpm run dev|server[/\\]_core[/\\]index\.ts|tsx|cross-env|corepack|esbuild")
    }
)

if ($remaining.Count -gt 0) {
  Write-Host "Some Mirrai processes are still running: $($remaining.ProcessId -join ', ')"
  exit 1
}

Write-Host "Mirrai stopped."
