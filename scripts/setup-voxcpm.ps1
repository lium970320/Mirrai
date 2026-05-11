param(
  [string]$RuntimeRoot = "F:\.mirrai-local\Mirrai\voxcpm",
  [string]$Python = "python",
  [switch]$UseHfMirror,
  [switch]$SkipCudaTorch,
  [string]$TorchIndexUrl = "https://download.pytorch.org/whl/cu130",
  [string[]]$TorchPackages = @("torch==2.11.0+cu130", "torchaudio==2.11.0+cu130")
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$runtimeRootFull = [System.IO.Path]::GetFullPath($RuntimeRoot)
$sourceRootFull = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

if ($runtimeRootFull.StartsWith($sourceRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to install VoxCPM runtime inside the Google Drive source tree: $runtimeRootFull"
}

New-Item -ItemType Directory -Path $runtimeRootFull -Force | Out-Null
$venv = Join-Path $runtimeRootFull ".venv"

if (-not (Test-Path -LiteralPath (Join-Path $venv "Scripts\python.exe"))) {
  Write-Host "Creating Python venv: $venv"
  & $Python -m venv $venv
}

$venvPython = Join-Path $venv "Scripts\python.exe"
$env:HF_HOME = "F:\.mirrai-local\Mirrai\huggingface"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $env:HF_HOME "hub"
$env:MODELSCOPE_CACHE = "F:\.mirrai-local\Mirrai\modelscope"
$env:HF_HUB_DISABLE_XET = "1"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"

if ($UseHfMirror) {
  $env:HF_ENDPOINT = "https://hf-mirror.com"
}

New-Item -ItemType Directory -Path $env:HF_HOME, $env:HUGGINGFACE_HUB_CACHE, $env:MODELSCOPE_CACHE -Force | Out-Null

Write-Host "Upgrading pip..."
& $venvPython -m pip install --upgrade pip

Write-Host "Installing VoxCPM into: $venv"
& $venvPython -m pip install voxcpm

$hasNvidia = $false
try {
  $null = Get-Command nvidia-smi -ErrorAction Stop
  $hasNvidia = $true
} catch {
  $hasNvidia = $false
}

if ((-not $SkipCudaTorch) -and $hasNvidia) {
  Write-Host "NVIDIA GPU detected. Installing CUDA PyTorch wheels from: $TorchIndexUrl"
  $pipArgs = @("-m", "pip", "install", "--upgrade", "--force-reinstall") + $TorchPackages + @("--index-url", $TorchIndexUrl)
  & $venvPython @pipArgs

  Write-Host "Restoring VoxCPM dataset-compatible fsspec version..."
  & $venvPython -m pip install "fsspec[http]==2025.3.0"
} elseif ($SkipCudaTorch) {
  Write-Host "Skipping CUDA PyTorch install because -SkipCudaTorch was specified."
} else {
  Write-Host "No NVIDIA GPU detected. Keeping the PyTorch build selected by VoxCPM dependencies."
}

Write-Host "Verifying VoxCPM import..."
& $venvPython -c "from voxcpm import VoxCPM; print('VoxCPM import OK')"
& $venvPython -c "import torch; print('torch', torch.__version__); print('cuda_available', torch.cuda.is_available()); print('cuda_version', torch.version.cuda)"

Write-Host "Done."
Write-Host "Runtime root: $runtimeRootFull"
Write-Host "HF cache: $env:HF_HOME"
