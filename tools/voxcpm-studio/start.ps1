#requires -Version 5.1
<#
.SYNOPSIS
  VoxCPM 试音台 · 一键启动。

  自动完成：① 确保 VoxCPM 服务在线（未在线则调用 scripts/start-voxcpm.ps1 拉起并等模型就绪）
            ② 启动试音台后端（自动建 venv / 装依赖）
            ③ 试音台就绪后自动打开浏览器

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools/voxcpm-studio/start.ps1

.EXAMPLE
  # 换端口、不自动开浏览器、假设 VoxCPM 已由外部启动
  powershell -ExecutionPolicy Bypass -File tools/voxcpm-studio/start.ps1 -Port 9000 -NoBrowser -SkipVoxcpm

.NOTES
  若从未安装过 VoxCPM 运行环境，请先执行一次：scripts/setup-voxcpm.ps1
#>
param(
  [int]$Port = 8820,
  [string]$VoxcpmServiceUrl = "http://127.0.0.1:8818",
  [string]$RuntimeRoot = "F:\.mirrai-local\Mirrai\voxcpm-studio",
  [int]$TimeoutSeconds = 180,
  [switch]$NoBrowser,
  [switch]$SkipVoxcpm,
  [switch]$Reinstall
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$studioUrl = "http://127.0.0.1:$Port"

function Test-HttpOk([string]$url, [int]$timeoutSec = 4) {
  try {
    Invoke-RestMethod -Uri $url -TimeoutSec $timeoutSec | Out-Null
    return $true
  } catch {
    return $false
  }
}

Write-Host "==== VoxCPM 试音台 · 一键启动 ====" -ForegroundColor Cyan

# 0) 试音台已经在运行 → 直接打开，不重复启动
if (Test-HttpOk "$studioUrl/api/config") {
  Write-Host "试音台已在运行：$studioUrl" -ForegroundColor Green
  if (-not $NoBrowser) { Start-Process $studioUrl }
  return
}

# 单实例互斥：避免在首次建 venv / 装依赖的窗口期被重复双击而并发启动（抢同一 .venv、同一端口）。
$mutex = [System.Threading.Mutex]::new($false, "Global\voxcpm-studio-start-$Port")
$hasHandle = $false
try {
  $hasHandle = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
  # 上一个实例异常退出残留的锁；当前进程接管所有权，视为获得。
  $hasHandle = $true
}
if (-not $hasHandle) {
  Write-Warning "另一个试音台启动流程正在进行中（端口 $Port）。请稍候片刻；若确认没有正在启动的窗口，关掉残留进程后重试。"
  $mutex.Dispose()
  return
}

try {
  # 1) 确保 VoxCPM 服务在线
  if (Test-HttpOk "$VoxcpmServiceUrl/health") {
    Write-Host "[1/3] VoxCPM 服务已在线：$VoxcpmServiceUrl" -ForegroundColor Green
  } elseif ($SkipVoxcpm) {
    Write-Warning "[1/3] VoxCPM 未在线，且指定了 -SkipVoxcpm；试音台仍会启动，但合成会失败。"
  } else {
    $startVox = Join-Path $here "..\..\scripts\start-voxcpm.ps1"
    if (-not (Test-Path -LiteralPath $startVox)) {
      throw "未找到 VoxCPM 启动脚本：$startVox`n请确认仓库结构完整，或加 -SkipVoxcpm 跳过自启。"
    }
    Write-Host "[1/3] VoxCPM 未在线，正在启动（首次会加载模型，可能需要 1-2 分钟）…" -ForegroundColor Yellow
    try {
      & $startVox
    } catch {
      throw "启动 VoxCPM 失败：$($_.Exception.Message)`n如未安装运行环境，请先执行：scripts/setup-voxcpm.ps1"
    }
    # 二次确认服务就绪（start-voxcpm.ps1 内部已等待，这里再兜底轮询）
    $voxReady = $false
    for ($i = 0; $i -lt 60; $i++) {
      if (Test-HttpOk "$VoxcpmServiceUrl/health") { $voxReady = $true; break }
      Start-Sleep -Seconds 2
    }
    if ($voxReady) {
      Write-Host "      VoxCPM 服务已就绪。" -ForegroundColor Green
    } else {
      Write-Warning "      VoxCPM 仍未响应；试音台会启动，但生成可能失败。日志：F:\.mirrai-local\Mirrai\logs\voxcpm.*.log"
    }
  }

  # 2) 安排浏览器在试音台就绪后自动打开（独立 job，不阻塞前台 uvicorn）
  if (-not $NoBrowser) {
    Write-Host "[2/3] 试音台就绪后将自动打开浏览器：$studioUrl" -ForegroundColor Green
    Get-Job -Name "voxcpm-open-browser" -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue
    Start-Job -Name "voxcpm-open-browser" -ScriptBlock {
      param($u)
      # 最长等待约 5 分钟，覆盖首次创建 venv + 安装依赖的时间
      for ($i = 0; $i -lt 400; $i++) {
        try {
          Invoke-WebRequest -Uri "$u/api/config" -TimeoutSec 2 -UseBasicParsing | Out-Null
          Start-Process $u
          return
        } catch {
          Start-Sleep -Milliseconds 750
        }
      }
    } -ArgumentList $studioUrl | Out-Null
  } else {
    Write-Host "[2/3] 已指定 -NoBrowser，跳过自动打开浏览器。" -ForegroundColor Green
  }

  # 3) 启动试音台后端（前台运行；Ctrl+C 停止。端口占用等错误由 run.ps1 抛出。）
  Write-Host "[3/3] 启动试音台后端（Ctrl+C 停止）…" -ForegroundColor Green
  Write-Host ""
  $runArgs = @{
    Port             = $Port
    VoxcpmServiceUrl = $VoxcpmServiceUrl
    RuntimeRoot      = $RuntimeRoot
    TimeoutSeconds   = $TimeoutSeconds
  }
  if ($Reinstall) { $runArgs.Reinstall = $true }
  & (Join-Path $here "run.ps1") @runArgs
} finally {
  Get-Job -Name "voxcpm-open-browser" -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue
  if ($hasHandle) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
