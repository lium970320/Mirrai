param(
  [string]$RunRoot = "F:\Code\Mirrai",
  [int]$Port = 3000,
  [string]$LogRoot = "F:\.mirrai-local\Mirrai\logs",
  [switch]$UseLocalDb,
  [switch]$UseRemoteDb
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

if ($UseLocalDb -and $UseRemoteDb) {
  throw "UseLocalDb and UseRemoteDb cannot be enabled together."
}
$useLocalDatabase = $UseLocalDb -or -not $UseRemoteDb

function Get-MirraiProcess {
  $rootPattern = [regex]::Escape([System.IO.Path]::GetFullPath($RunRoot))
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -match $rootPattern -and
      ($_.CommandLine -match "pnpm run dev|server[/\\]_core[/\\]index\.ts|tsx|cross-env|corepack")
    }
}

function Test-LocalDatabaseManagedMode {
  $rootPattern = [regex]::Escape([System.IO.Path]::GetFullPath($RunRoot))
  $processes = @(
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.ProcessId -ne $PID -and
        $_.CommandLine -match $rootPattern -and
        $_.CommandLine -match "pnpm run dev:local|scripts[/\\]dev-local\.mjs"
      }
  )
  return $processes.Count -gt 0
}

function Test-MirraiWeb {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch {
    return $false
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $RunRoot "package.json"))) {
  throw "Mirrai local worktree is missing or incomplete: $RunRoot"
}

$existing = @(Get-MirraiProcess)
if ($existing.Count -gt 0) {
  if ($useLocalDatabase -and -not (Test-LocalDatabaseManagedMode)) {
    Write-Host "Mirrai is running without the local database manager; restarting in dev:local mode."
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stop-mirrai.ps1") -RunRoot $RunRoot -Port $Port
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to stop the existing Mirrai process before switching to local database mode."
    }
  } else {
    Write-Host "Mirrai already appears to be running."
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "status-mirrai.ps1") -RunRoot $RunRoot -Port $Port -LogRoot $LogRoot
    exit 0
  }
}

if (Test-MirraiWeb) {
  Write-Host "Mirrai web endpoint is already responding at http://localhost:$Port/."
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "status-mirrai.ps1") -RunRoot $RunRoot -Port $Port -LogRoot $LogRoot
  exit 0
}

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$outLog = Join-Path $LogRoot "dev.out.log"
$errLog = Join-Path $LogRoot "dev.err.log"
Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue

$launcher = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $launcher) {
  $launcher = (Get-Command powershell.exe).Source
}

$runScript = if ($useLocalDatabase) { "dev:local" } else { "dev" }
$command = "`$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new(`$false); Set-Location -LiteralPath '$RunRoot'; corepack pnpm run $runScript"
$process = Start-Process `
  -FilePath $launcher `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
  -WorkingDirectory $RunRoot `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden `
  -PassThru

Write-Host "Started Mirrai launcher process: $($process.Id)"
Write-Host "Waiting for http://localhost:$Port/ ..."

$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      Write-Host "Mirrai is running at http://localhost:$Port/"
      exit 0
    }
  } catch {
    # Keep waiting.
  }
}

Write-Host "Mirrai did not respond before the timeout. Check status/logs:"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "status-mirrai.ps1") -RunRoot $RunRoot -Port $Port -LogRoot $LogRoot
exit 1
