param(
  [string]$RunRoot = "F:\Code\Mirrai",
  [string]$RuntimeRoot = "F:\.mirrai-local\Mirrai\voxcpm",
  [string]$LogRoot = "F:\.mirrai-local\Mirrai\logs",
  [int]$Port = 8818,
  [string]$ModelId = "openbmb/VoxCPM2",
  [string]$Device = "auto",
  [int]$WarmupTimeoutSeconds = 300,
  [switch]$SkipWarmup,
  [switch]$Optimize
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$runtimeRootFull = [System.IO.Path]::GetFullPath($RuntimeRoot)
$runRootFull = [System.IO.Path]::GetFullPath($RunRoot)
$serviceScript = Join-Path $runRootFull "scripts\voxcpm_tts_service.py"
$venvPython = Join-Path $runtimeRootFull ".venv\Scripts\python.exe"
$envPath = Join-Path $runRootFull ".env"

if (-not (Test-Path -LiteralPath $serviceScript)) {
  throw "VoxCPM service script not found. Sync the local worktree first: $serviceScript"
}
if (-not (Test-Path -LiteralPath $venvPython)) {
  throw "VoxCPM venv not found. Run scripts/setup-voxcpm.ps1 first: $venvPython"
}

function Get-VoxcpmProcess {
  $scriptPattern = [regex]::Escape($serviceScript)
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -match $scriptPattern
    }
}

function Read-DotEnvValue([string]$Name) {
  if (-not (Test-Path -LiteralPath $envPath)) {
    return $null
  }

  $line = Get-Content -LiteralPath $envPath -Encoding UTF8 |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -Last 1
  if (-not $line) {
    return $null
  }

  $value = ($line -replace "^\s*$([regex]::Escape($Name))\s*=", "").Trim()
  return $value.Trim('"').Trim("'")
}

function Read-DotEnvBool([string]$Name) {
  return (Read-DotEnvValue $Name) -eq "true"
}

function Read-DotEnvInt([string]$Name, [int]$Default) {
  $value = Read-DotEnvValue $Name
  $parsed = 0
  if ([int]::TryParse($value, [ref]$parsed)) {
    return $parsed
  }
  return $Default
}

function Read-DotEnvFloat([string]$Name, [double]$Default) {
  $value = Read-DotEnvValue $Name
  $parsed = 0.0
  if ([double]::TryParse($value, [ref]$parsed)) {
    return $parsed
  }
  return $Default
}

function Invoke-VoxcpmWarmup {
  $health = $null
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
  } catch {
    Write-Warning "VoxCPM warmup skipped; health check failed: $($_.Exception.Message)"
    return
  }
  if ($health.modelLoaded) {
    Write-Host "VoxCPM model is already loaded; warmup skipped."
    return
  }

  $warmupPath = Join-Path (Join-Path $runtimeRootFull "..\tmp") "voxcpm-warmup.wav"
  New-Item -ItemType Directory -Path (Split-Path -Parent $warmupPath) -Force | Out-Null
  $control = Read-DotEnvValue "VOXCPM_CONTROL"
  $cloneMode = Read-DotEnvValue "VOXCPM_CLONE_MODE"
  $referenceAudioPath = Read-DotEnvValue "VOXCPM_REFERENCE_AUDIO_PATH"
  $promptText = Read-DotEnvValue "VOXCPM_PROMPT_TEXT"
  $cfgValue = Read-DotEnvFloat "VOXCPM_CFG_VALUE" 2.0
  $inferenceTimesteps = Read-DotEnvInt "VOXCPM_INFERENCE_STEPS" 20
  $normalize = Read-DotEnvBool "VOXCPM_NORMALIZE"
  $denoise = Read-DotEnvBool "VOXCPM_DENOISE"

  $payloadObject = @{}
  $payloadObject['text'] = 'ok.'
  $payloadObject['outputPath'] = $warmupPath
  $payloadObject['control'] = $control
  $payloadObject['cloneMode'] = $cloneMode
  $payloadObject['referenceAudioPath'] = $referenceAudioPath
  $payloadObject['promptText'] = $promptText
  $payloadObject['cfgValue'] = $cfgValue
  $payloadObject['inferenceTimesteps'] = $inferenceTimesteps
  $payloadObject['normalize'] = $normalize
  $payloadObject['denoise'] = $denoise
  $payload = $payloadObject | ConvertTo-Json -Depth 4

  Write-Host "Warming up VoxCPM model with a short TTS request..."
  $started = Get-Date
  try {
    $response = Invoke-RestMethod `
      -Uri "http://127.0.0.1:$Port/tts" `
      -Method Post `
      -ContentType "application/json" `
      -Body $payload `
      -TimeoutSec $WarmupTimeoutSeconds
    $elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds
    if ($response.ok -and (Test-Path -LiteralPath $warmupPath)) {
      Write-Host "VoxCPM warmup complete in $elapsedMs ms."
      return
    }
    Write-Warning "VoxCPM warmup returned an unsuccessful response."
  } catch {
    $elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds
    Write-Warning "VoxCPM warmup failed after $elapsedMs ms: $($_.Exception.Message)"
  }
}

$existing = @(Get-VoxcpmProcess)
if ($existing.Count -gt 0) {
  Write-Host "VoxCPM service already appears to be running."
  if (-not $SkipWarmup) {
    Invoke-VoxcpmWarmup
  }
  exit 0
}

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$outLog = Join-Path $LogRoot "voxcpm.out.log"
$errLog = Join-Path $LogRoot "voxcpm.err.log"
Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue

$env:HF_HOME = "F:\.mirrai-local\Mirrai\huggingface"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $env:HF_HOME "hub"
$env:MODELSCOPE_CACHE = "F:\.mirrai-local\Mirrai\modelscope"
$env:HF_HUB_DISABLE_XET = "1"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
$env:TOKENIZERS_PARALLELISM = "false"
New-Item -ItemType Directory -Path $env:HF_HOME, $env:HUGGINGFACE_HUB_CACHE, $env:MODELSCOPE_CACHE -Force | Out-Null

$args = @(
  $serviceScript,
  "--host", "127.0.0.1",
  "--port", "$Port",
  "--model-id", $ModelId,
  "--device", $Device
)
if ($Optimize) {
  $args += "--optimize"
}

$process = Start-Process `
  -FilePath $venvPython `
  -ArgumentList $args `
  -WorkingDirectory $runRootFull `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden `
  -PassThru

Write-Host "Started VoxCPM service process: $($process.Id)"
Write-Host "Waiting for http://127.0.0.1:$Port/health ..."

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
    if ($response.ok) {
      Write-Host "VoxCPM service is running at http://127.0.0.1:$Port"
      if (-not $SkipWarmup) {
        Invoke-VoxcpmWarmup
      }
      exit 0
    }
  } catch {
    # Keep waiting.
  }
}

Write-Host "VoxCPM service did not respond before timeout. Check logs:"
Write-Host $outLog
Write-Host $errLog
exit 1
