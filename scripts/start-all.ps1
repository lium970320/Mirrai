param(
  [string]$SourceRoot,
  [string]$RunRoot = "F:\Code\Mirrai",
  [string]$RuntimeRoot = "F:\.mirrai-local\Mirrai",
  [string]$NapCatRoot = "F:\.mirrai-local\Mirrai\tools\napcat\onekey-v4.18.1",
  [int]$MirraiPort = 3000,
  [int]$VoxcpmPort = 8818,
  [int]$QqWaitSeconds = 60,
  [string]$QqBaseUrl,
  [string]$QqAccessToken,
  [switch]$SkipSync,
  [switch]$SkipVoxCPM,
  [switch]$SkipQQ,
  [switch]$Restart,
  [switch]$RestartMirrai,
  [switch]$RestartQQ,
  [switch]$OptimizeVoxCPM,
  [switch]$UseLocalDb,
  [switch]$UseRemoteDb
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

if ($UseLocalDb -and $UseRemoteDb) {
  throw "UseLocalDb and UseRemoteDb cannot be enabled together."
}
$useLocalDatabase = $UseLocalDb -or -not $UseRemoteDb

function Resolve-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Invoke-ProjectScript([string]$ScriptPath, [string[]]$Arguments = @()) {
  if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Script not found: $ScriptPath"
  }

  Write-Host ""
  Write-Host ">>> $ScriptPath $(Format-SafeArguments $Arguments)"
  & powershell -ExecutionPolicy Bypass -File $ScriptPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Script failed with exit code $LASTEXITCODE`: $ScriptPath"
  }
}

function Invoke-OptionalProjectScript([string]$ScriptPath, [string[]]$Arguments = @()) {
  if (-not (Test-Path -LiteralPath $ScriptPath)) {
    Write-Warning "Optional script not found: $ScriptPath"
    return $false
  }

  Write-Host ""
  Write-Host ">>> $ScriptPath $(Format-SafeArguments $Arguments)"
  & powershell -ExecutionPolicy Bypass -File $ScriptPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Optional script failed with exit code $LASTEXITCODE`: $ScriptPath"
    return $false
  }

  return $true
}

function Format-SafeArguments([string[]]$Arguments = @()) {
  $safe = @()
  $redactNext = $false
  foreach ($argument in $Arguments) {
    if ($redactNext) {
      $safe += "******"
      $redactNext = $false
      continue
    }

    $safe += $argument
    if ($argument -in @("-AccessToken", "-QqAccessToken", "-Token")) {
      $redactNext = $true
    }
  }

  return ($safe -join " ")
}

function Test-VoxcpmRunning([string]$Root) {
  $serviceScript = Join-Path (Resolve-FullPath $Root) "scripts\voxcpm_tts_service.py"
  $scriptPattern = [regex]::Escape($serviceScript)
  $processes = @(
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.ProcessId -ne $PID -and
        $_.CommandLine -match $scriptPattern
      }
  )
  return $processes.Count -gt 0
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
  $SourceRoot = Join-Path $scriptDir ".."
}

$sourceRootFull = Resolve-FullPath $SourceRoot
$runRootFull = Resolve-FullPath $RunRoot
$runtimeRootFull = Resolve-FullPath $RuntimeRoot
$napCatRootFull = Resolve-FullPath $NapCatRoot
$logRoot = Join-Path $runtimeRootFull "logs"

Write-Host "Mirrai full startup"
Write-Host "Source root : $sourceRootFull"
Write-Host "Run root    : $runRootFull"
Write-Host "Runtime root: $runtimeRootFull"
Write-Host "NapCat root : $napCatRootFull"
Write-Host "Database    : $(if ($useLocalDatabase) { 'local managed PostgreSQL' } else { 'remote DATABASE_URL' })"

if (-not $SkipSync -and -not $sourceRootFull.Equals($runRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
  $syncScript = Join-Path $sourceRootFull "scripts\sync-local-worktree.ps1"
  $syncArgs = @("-TargetRoot", $runRootFull)
  Invoke-ProjectScript $syncScript $syncArgs
} else {
  Write-Host ""
  Write-Host ">>> Sync skipped."
}

if (-not (Test-Path -LiteralPath (Join-Path $runRootFull "package.json"))) {
  throw "Local run root is missing package.json: $runRootFull"
}

$envPath = Join-Path $runRootFull ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
  Write-Warning "Local .env is missing: $envPath"
  Write-Warning "Mirrai may start without your Neon/LLM/QQ settings. Copy or create .env in the local run root."
}

$nodeModules = Join-Path $runRootFull "node_modules"
if (-not (Test-Path -LiteralPath $nodeModules)) {
  Write-Host ""
  Write-Host ">>> node_modules is missing; installing dependencies in local run root..."
  Push-Location $runRootFull
  try {
    & corepack pnpm install --no-frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
      throw "pnpm install failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

$localScripts = Join-Path $runRootFull "scripts"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

if ($Restart) {
  if (-not $SkipVoxCPM) {
    Invoke-ProjectScript (Join-Path $localScripts "stop-voxcpm.ps1") @("-RunRoot", $runRootFull)
  }
}

if ($Restart -or $RestartMirrai) {
  Invoke-ProjectScript (Join-Path $localScripts "stop-mirrai.ps1") @("-RunRoot", $runRootFull)
}

if (-not $SkipVoxCPM) {
  $voxcpmArgs = @(
    "-RunRoot", $runRootFull,
    "-RuntimeRoot", (Join-Path $runtimeRootFull "voxcpm"),
    "-LogRoot", $logRoot,
    "-Port", "$VoxcpmPort",
    "-SkipWarmup"
  )
  if ($OptimizeVoxCPM) {
    $voxcpmArgs += "-Optimize"
  }

  if (Test-VoxcpmRunning $runRootFull) {
    Write-Host ""
    Write-Host ">>> VoxCPM already appears to be running; skipping warmup."
    Invoke-ProjectScript (Join-Path $localScripts "start-voxcpm.ps1") $voxcpmArgs
  } else {
    Invoke-ProjectScript (Join-Path $localScripts "start-voxcpm.ps1") $voxcpmArgs
  }
} else {
  Write-Host ""
  Write-Host ">>> VoxCPM skipped."
}

$mirraiArgs = @(
  "-RunRoot", $runRootFull,
  "-Port", "$MirraiPort",
  "-LogRoot", $logRoot
)
if ($useLocalDatabase) {
  $mirraiArgs += "-UseLocalDb"
} else {
  $mirraiArgs += "-UseRemoteDb"
}
Invoke-ProjectScript (Join-Path $localScripts "start-mirrai.ps1") $mirraiArgs

if (-not $SkipQQ) {
  $qqArgs = @(
    "-RunRoot", $runRootFull,
    "-NapCatRoot", $napCatRootFull,
    "-WaitSeconds", "$QqWaitSeconds"
  )
  if (-not [string]::IsNullOrWhiteSpace($QqBaseUrl)) {
    $qqArgs += @("-BaseUrl", $QqBaseUrl)
  }
  if (-not [string]::IsNullOrWhiteSpace($QqAccessToken)) {
    $qqArgs += @("-AccessToken", $QqAccessToken)
  }
  if ($RestartQQ) {
    $qqArgs += "-Restart"
  }

  [void](Invoke-OptionalProjectScript (Join-Path $localScripts "start-qq.ps1") $qqArgs)
} else {
  Write-Host ""
  Write-Host ">>> QQ/NapCat skipped."
}

Write-Host ""
Write-Host "===== Final status ====="
if (-not $SkipVoxCPM) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $localScripts "status-voxcpm.ps1") -RunRoot $runRootFull -LogRoot $logRoot -Port $VoxcpmPort
}
& powershell -ExecutionPolicy Bypass -File (Join-Path $localScripts "status-mirrai.ps1") -RunRoot $runRootFull -Port $MirraiPort -LogRoot $logRoot
if (-not $SkipQQ) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $localScripts "status-qq.ps1") -RunRoot $runRootFull -NapCatRoot $napCatRootFull
}

Write-Host ""
Write-Host "Done."
Write-Host "Mirrai: http://localhost:$MirraiPort/"
if (-not $SkipVoxCPM) {
  Write-Host "VoxCPM: http://127.0.0.1:$VoxcpmPort/health"
}
if (-not $SkipQQ) {
  if ([string]::IsNullOrWhiteSpace($QqBaseUrl)) {
    $qqDisplayUrl = "see QQ_ONEBOT_BASE_URL in .env"
  } else {
    $qqDisplayUrl = $QqBaseUrl
  }
  Write-Host "QQ/NapCat: $qqDisplayUrl"
}
