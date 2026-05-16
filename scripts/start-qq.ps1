param(
  [string]$RunRoot = "F:\Code\Mirrai",
  [string]$NapCatRoot = "F:\.mirrai-local\Mirrai\tools\napcat\onekey-v4.18.1",
  [string]$BaseUrl,
  [string]$AccessToken,
  [string]$QuickLoginUin,
  [int]$WebUiPort = 6099,
  [int]$WaitSeconds = 60,
  [switch]$Restart
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Resolve-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Read-DotEnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $line = Get-Content -LiteralPath $Path -Encoding UTF8 |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -Last 1
  if (-not $line) {
    return $null
  }

  $value = ($line -replace "^\s*$([regex]::Escape($Name))\s*=", "").Trim()
  return $value.Trim('"').Trim("'")
}

$runRootFull = Resolve-FullPath $RunRoot
$napCatRootFull = Resolve-FullPath $NapCatRoot
$envPath = Join-Path $runRootFull ".env"

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = Read-DotEnvValue $envPath "QQ_ONEBOT_BASE_URL"
}
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = "http://127.0.0.1:3001"
}
if ([string]::IsNullOrWhiteSpace($AccessToken)) {
  $AccessToken = Read-DotEnvValue $envPath "QQ_ONEBOT_ACCESS_TOKEN"
}
if ([string]::IsNullOrWhiteSpace($QuickLoginUin)) {
  $QuickLoginUin = Read-DotEnvValue $envPath "QQ_QUICK_LOGIN_UIN"
}
if ([string]::IsNullOrWhiteSpace($QuickLoginUin)) {
  $QuickLoginUin = Read-DotEnvValue $envPath "QQ_BOT_UIN"
}

function Get-NapCatProcess {
  $napCatPattern = [regex]::Escape($napCatRootFull)
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -match $napCatPattern -and
      $_.Name -match "^(NapCatWinBootMain|QQ|node|python)(\.exe)?$"
    } |
    Sort-Object ProcessId
}

function Test-OneBot {
  try {
    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($AccessToken)) {
      $headers.Authorization = "Bearer $AccessToken"
    }
    $response = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/get_login_info" -Headers $headers -TimeoutSec 5
    return [pscustomobject]@{
      Ok = $true
      Response = $response
      Error = $null
    }
  } catch {
    return [pscustomobject]@{
      Ok = $false
      Response = $null
      Error = $_.Exception.Message
    }
  }
}

function Wait-OneBot([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $last = $null
  while ((Get-Date) -lt $deadline) {
    $last = Test-OneBot
    if ($last.Ok) {
      return $last
    }
    Start-Sleep -Seconds 2
  }

  if ($null -eq $last) {
    $last = Test-OneBot
  }
  return $last
}

function Get-NapCatLauncher {
  $preferredShell = Get-ChildItem -LiteralPath $napCatRootFull -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "NapCat.*.Shell" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($preferredShell) {
    $preferredShellLauncher = Join-Path $preferredShell.FullName "NapCatWinBootMain.exe"
    if (Test-Path -LiteralPath $preferredShellLauncher) {
      return $preferredShellLauncher
    }
  }

  $preferred = Join-Path $napCatRootFull "bootmain\NapCatWinBootMain.exe"
  if (Test-Path -LiteralPath $preferred) {
    return $preferred
  }

  $shellLauncher = Get-ChildItem -LiteralPath $napCatRootFull -Recurse -Filter "NapCatWinBootMain.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "\\versions\\" } |
    Select-Object -First 1
  if ($shellLauncher) {
    return $shellLauncher.FullName
  }

  $anyLauncher = Get-ChildItem -LiteralPath $napCatRootFull -Recurse -Filter "NapCatWinBootMain.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($anyLauncher) {
    return $anyLauncher.FullName
  }

  return $null
}

function Get-NapCatShellRoot {
  $preferredShell = Get-ChildItem -LiteralPath $napCatRootFull -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "NapCat.*.Shell" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($preferredShell) {
    return $preferredShell.FullName
  }

  return $napCatRootFull
}

function Get-NapCatConfigRoots {
  $shellRoot = Get-NapCatShellRoot
  $roots = @()
  $versionsRoot = Join-Path $shellRoot "versions"
  if (Test-Path -LiteralPath $versionsRoot) {
    $roots += Get-ChildItem -LiteralPath $versionsRoot -Directory -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      ForEach-Object { Join-Path $_.FullName "resources\app\napcat\config" } |
      Where-Object { Test-Path -LiteralPath $_ }
  }

  $shellConfigRoot = Join-Path $shellRoot "config"
  if (Test-Path -LiteralPath $shellConfigRoot) {
    $roots += $shellConfigRoot
  }

  return @($roots | Select-Object -Unique)
}

function Get-InferredQuickLoginUin {
  if (-not [string]::IsNullOrWhiteSpace($QuickLoginUin)) {
    return $QuickLoginUin
  }

  $uinCandidates = foreach ($configRoot in Get-NapCatConfigRoots) {
    Get-ChildItem -LiteralPath $configRoot -Recurse -Filter "onebot11_*.json" -ErrorAction SilentlyContinue |
      ForEach-Object {
        if ($_.BaseName -match "^onebot11_(\d+)$") {
          $Matches[1]
        }
      }
  }
  $uins = @($uinCandidates | Sort-Object -Unique)

  if ($uins.Count -eq 1) {
    return $uins[0]
  }

  return $null
}

function Get-WebUiCredential {
  $candidateConfigPaths = @(
    foreach ($configRoot in Get-NapCatConfigRoots) {
      Join-Path $configRoot "webui.json"
    }
  ) | Where-Object { Test-Path -LiteralPath $_ }

  foreach ($configPath in $candidateConfigPaths) {
    try {
      $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $token = [string]$config.token
      if ([string]::IsNullOrWhiteSpace($token)) {
        continue
      }

      $port = $WebUiPort
      if ($config.port) {
        $port = [int]$config.port
      }

      $sha = [System.Security.Cryptography.SHA256]::Create()
      $bytes = [Text.Encoding]::UTF8.GetBytes($token + ".napcat")
      $hash = (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "")
      $body = @{ hash = $hash } | ConvertTo-Json -Compress
      $login = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/auth/login" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 5
      if ($login.code -eq 0 -and $login.data.Credential) {
        return [pscustomobject]@{
          Port = $port
          Credential = [string]$login.data.Credential
        }
      }
    } catch {
      # Try the next known WebUI config path.
    }
  }

  return $null
}

function Invoke-NapCatQuickLogin([string]$Uin) {
  if ([string]::IsNullOrWhiteSpace($Uin)) {
    Write-Host "No QQ quick-login UIN configured or inferred; skipping quick login."
    return $false
  }

  $credential = Get-WebUiCredential
  if (-not $credential) {
    Write-Host "NapCat WebUI is not ready or token auth failed; skipping quick login."
    return $false
  }

  try {
    $headers = @{ Authorization = "Bearer $($credential.Credential)" }
    $quickList = Invoke-RestMethod -Uri "http://127.0.0.1:$($credential.Port)/api/QQLogin/GetQuickLoginListNew" -Method Post -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 5
    $hasUin = @($quickList.data | Where-Object { [string]$_.uin -eq [string]$Uin }).Count -gt 0
    if (-not $hasUin) {
      Write-Host "QQ $Uin is not in NapCat quick-login list; manual login may be required."
      return $false
    }

    $body = @{ uin = [string]$Uin } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Uri "http://127.0.0.1:$($credential.Port)/api/QQLogin/SetQuickLogin" -Method Post -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 10
    if ($result.code -eq 0) {
      Write-Host "NapCat quick login requested for QQ $Uin."
      return $true
    }

    Write-Host "NapCat quick login failed for QQ $Uin`: $($result.message)"
    return $false
  } catch {
    Write-Host "NapCat quick login failed for QQ $Uin`: $($_.Exception.Message)"
    return $false
  }
}

Write-Host "QQ/NapCat startup"
Write-Host "Run root   : $runRootFull"
Write-Host "NapCat root: $napCatRootFull"
Write-Host "OneBot URL : $BaseUrl"

if (-not (Test-Path -LiteralPath $napCatRootFull)) {
  Write-Warning "NapCat root not found: $napCatRootFull"
  exit 1
}

if ($Restart) {
  $existingForRestart = @(Get-NapCatProcess)
  if ($existingForRestart.Count -gt 0) {
    Write-Host ""
    Write-Host ">>> Restart requested; stopping NapCat-managed QQ processes only..."
    foreach ($process in ($existingForRestart | Sort-Object ProcessId -Descending)) {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 3
  }
}

$oneBot = Test-OneBot
if ($oneBot.Ok) {
  Write-Host ""
  Write-Host "OneBot is already responding."
  if ($oneBot.Response.data) {
    Write-Host "Logged in: $($oneBot.Response.data.nickname) ($($oneBot.Response.data.user_id))"
  }
  exit 0
}

$existing = @(Get-NapCatProcess)
if ($existing.Count -gt 0) {
  Write-Host ""
  Write-Host "NapCat-managed QQ already appears to be running; waiting for OneBot..."
} else {
  $launcher = Get-NapCatLauncher
  if ([string]::IsNullOrWhiteSpace($launcher) -or -not (Test-Path -LiteralPath $launcher)) {
    Write-Warning "NapCat launcher not found under: $napCatRootFull"
    exit 1
  }

  Write-Host ""
  Write-Host "Starting NapCat launcher: $launcher"
  $process = Start-Process `
    -FilePath $launcher `
    -WorkingDirectory (Split-Path -Parent $launcher) `
    -PassThru
  Write-Host "Started NapCat launcher process: $($process.Id)"
}

Write-Host "Waiting for $($BaseUrl.TrimEnd('/'))/get_login_info ..."
$firstWaitSeconds = [Math]::Min([Math]::Max($WaitSeconds, 1), 10)
$ready = Wait-OneBot $firstWaitSeconds
if ($ready.Ok) {
  Write-Host "OneBot is ready."
  if ($ready.Response.data) {
    Write-Host "Logged in: $($ready.Response.data.nickname) ($($ready.Response.data.user_id))"
  }
  exit 0
}

$quickLoginTarget = Get-InferredQuickLoginUin
[void](Invoke-NapCatQuickLogin $quickLoginTarget)

$remainingWaitSeconds = [Math]::Max($WaitSeconds - $firstWaitSeconds, 10)
$ready = Wait-OneBot $remainingWaitSeconds
if ($ready.Ok) {
  Write-Host "OneBot is ready."
  if ($ready.Response.data) {
    Write-Host "Logged in: $($ready.Response.data.nickname) ($($ready.Response.data.user_id))"
  }
  exit 0
}

Write-Warning "OneBot did not respond before timeout: $($ready.Error)"
Write-Warning "If a QQ/NapCat login window is visible, finish login there, then rerun scripts/status-qq.ps1."
exit 1
