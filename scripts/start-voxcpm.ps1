param(
  [string]$RunRoot = "F:\Code\Mirrai",
  [string]$RuntimeRoot = "F:\.mirrai-local\Mirrai\voxcpm",
  [string]$LogRoot = "F:\.mirrai-local\Mirrai\logs",
  [int]$Port = 8818,
  [string]$ModelId = "openbmb/VoxCPM2",
  [string]$Device = "auto",
  [switch]$Optimize
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$runtimeRootFull = [System.IO.Path]::GetFullPath($RuntimeRoot)
$runRootFull = [System.IO.Path]::GetFullPath($RunRoot)
$serviceScript = Join-Path $runRootFull "scripts\voxcpm_tts_service.py"
$venvPython = Join-Path $runtimeRootFull ".venv\Scripts\python.exe"

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

$existing = @(Get-VoxcpmProcess)
if ($existing.Count -gt 0) {
  Write-Host "VoxCPM service already appears to be running."
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
