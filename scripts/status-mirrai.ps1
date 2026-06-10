param(
  [string]$RunRoot = "F:\Code\Mirrai",
  [int]$Port = 3000,
  [string]$LogRoot = "F:\.mirrai-local\Mirrai\logs"
)

$ErrorActionPreference = "SilentlyContinue"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Get-MirraiProcess {
  $rootPattern = [regex]::Escape([System.IO.Path]::GetFullPath($RunRoot))
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -match $rootPattern -and
      ($_.CommandLine -match "pnpm run dev|server[/\\]_core[/\\]index\.ts|tsx|cross-env|corepack")
    } |
    Sort-Object ProcessId
}

$processes = @(Get-MirraiProcess)
$url = "http://localhost:$Port/"
$portOwners = @(
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
)

Write-Host "Mirrai status"
Write-Host "Run root: $RunRoot"
Write-Host "URL: $url"
Write-Host ""

if ($processes.Count -gt 0) {
  Write-Host "Process: RUNNING ($($processes.Count) related process(es))"
  $processes |
    Select-Object ProcessId, Name, @{ Name = "Command"; Expression = { $_.CommandLine } } |
    Format-Table -AutoSize |
    Out-String -Width 220 |
    Write-Host
} elseif ($portOwners.Count -gt 0) {
  Write-Host "Process: PORT LISTENER ($($portOwners -join ', '))"
  Get-Process -Id $portOwners -ErrorAction SilentlyContinue |
    Select-Object Id, ProcessName, Path, StartTime |
    Format-Table -AutoSize |
    Out-String -Width 220 |
    Write-Host
} else {
  Write-Host "Process: STOPPED"
}

try {
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
  Write-Host "Web: OK ($($response.StatusCode))"
} catch {
  Write-Host "Web: NOT RESPONDING ($($_.Exception.Message))"
}

Write-Host ""
Write-Host "Recent logs:"
foreach ($name in @("dev.out.log", "dev.err.log")) {
  $path = Join-Path $LogRoot $name
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Host "--- $path missing ---"
    continue
  }

  Write-Host "--- $path ---"
  Get-Content -LiteralPath $path -Tail 40 -Encoding UTF8
}
