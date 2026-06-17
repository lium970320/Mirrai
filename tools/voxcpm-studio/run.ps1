#requires -Version 5.1
<#
.SYNOPSIS
  仅启动 VoxCPM Studio 试音台后端（自动创建 venv、安装依赖、拉起服务）。
  想要「一键全栈启动 + 自动开浏览器」请用 start.ps1 / 双击 start.cmd。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools/voxcpm-studio/run.ps1

.NOTES
  前置：先把现有 VoxCPM 服务跑起来（scripts/start-voxcpm.ps1，默认 127.0.0.1:8818）；
  若想自动确保 VoxCPM 在线，请改用 start.ps1。
  本脚本只负责试音台前端 + 轻量代理，不加载任何模型。
  运行时产物（.venv、生成音频、上传文件）落在源码树之外的 -RuntimeRoot，
  避免被 Google Drive 同步（遵循 AGENTS.md）。
#>
param(
  [int]$Port = 8820,
  [string]$VoxcpmServiceUrl = "http://127.0.0.1:8818",
  [string]$RuntimeRoot = "F:\.mirrai-local\Mirrai\voxcpm-studio",
  [int]$TimeoutSeconds = 180,
  [switch]$Reinstall
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$requirements = Join-Path $here "requirements.txt"

# 运行时根放在源码树之外（默认与 VoxCPM 运行时并列），避免 .venv / 生成数据被同步盘拖累。
New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
$venvDir = Join-Path $RuntimeRoot ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

function Resolve-BasePython {
  foreach ($name in @("python", "py", "python3")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) {
      if ($name -eq "py") { return @{ Exe = $cmd.Source; Args = @("-3") } }
      return @{ Exe = $cmd.Source; Args = @() }
    }
  }
  throw "未找到 Python，请先安装 Python 3.9+ 并加入 PATH。"
}

function Test-PortBusy([int]$port) {
  # 试着在 127.0.0.1:$port 上临时监听；绑不上即说明端口已被占用。
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    $listener.Start()
    $listener.Stop()
    return $false
  } catch {
    return $true
  }
}

if (-not (Test-Path -LiteralPath $venvPython)) {
  $base = Resolve-BasePython
  Write-Host "创建虚拟环境：$venvDir"
  & $base.Exe @($base.Args + @("-m", "venv", $venvDir))
  if ($LASTEXITCODE -ne 0) { throw "创建 venv 失败。" }
  $Reinstall = $true
}

if ($Reinstall) {
  Write-Host "安装依赖（首次会下载 fastapi/uvicorn 等）..."
  & $venvPython -m pip install --upgrade pip | Out-Null
  & $venvPython -m pip install -r $requirements
  if ($LASTEXITCODE -ne 0) { throw "安装依赖失败。" }
}

$env:VOXCPM_SERVICE_URL = $VoxcpmServiceUrl
$env:VOXCPM_STUDIO_TIMEOUT = "$TimeoutSeconds"
$env:VOXCPM_STUDIO_RUNTIME_DIR = $RuntimeRoot
# 把 __pycache__ 字节码也重定向到运行时根，避免在源码盘（可能被 Google Drive 同步）落缓存。
$env:PYTHONPYCACHEPREFIX = Join-Path $RuntimeRoot "pycache"

if (Test-PortBusy $Port) {
  throw "端口 $Port 已被占用，试音台无法启动。请关闭占用该端口的进程，或用 -Port 指定其它端口（例如 -Port 8821）。"
}

Write-Host ""
Write-Host "VoxCPM Studio 启动中..." -ForegroundColor Green
Write-Host "  试音台地址 : http://127.0.0.1:$Port"
Write-Host "  VoxCPM 服务: $VoxcpmServiceUrl"
Write-Host "  运行时目录 : $RuntimeRoot"
Write-Host "  按 Ctrl+C 停止。"
Write-Host ""

# venv 在 $RuntimeRoot，但 app.py 在源码树 $here；Push-Location 让 uvicorn 能 import app。
Push-Location $here
try {
  & $venvPython -m uvicorn app:app --host 127.0.0.1 --port $Port
} finally {
  Pop-Location
}
