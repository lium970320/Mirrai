param(
  [string]$RunRoot = "F:\Code\Mirrai",
  [string]$NapCatRoot = "F:\.mirrai-local\Mirrai\tools\napcat\onekey-v4.18.1",
  [string]$LogRoot = "F:\.mirrai-local\Mirrai\logs",
  [string]$BaseUrl,
  [string]$AccessToken,
  [int]$MirraiPort = 3000,
  [int]$RecentLogLines = 160,
  [switch]$Json
)

$ErrorActionPreference = "SilentlyContinue"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

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

function Test-HttpJson([string]$Url, [hashtable]$Headers = @{}) {
  try {
    $response = Invoke-RestMethod -Uri $Url -Headers $Headers -TimeoutSec 5
    return [pscustomobject]@{
      ok = $true
      error = $null
      response = $response
    }
  } catch {
    return [pscustomobject]@{
      ok = $false
      error = $_.Exception.Message
      response = $null
    }
  }
}

function Test-Web([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return [pscustomobject]@{
      ok = $true
      statusCode = [int]$response.StatusCode
      error = $null
    }
  } catch {
    return [pscustomobject]@{
      ok = $false
      statusCode = $null
      error = $_.Exception.Message
    }
  }
}

function Protect-SecretText([string]$Text) {
  if ($null -eq $Text) {
    return $Text
  }

  $redacted = $Text
  $redacted = $redacted -replace "(?i)(token=)[^&\s`"]+", '${1}[redacted]'
  $redacted = $redacted -replace "(?i)(WebUi Token:\s*)\S+", '${1}[redacted]'
  $redacted = $redacted -replace "(?i)(Authorization:\s*Bearer\s+)\S+", '${1}[redacted]'
  $redacted = $redacted -replace "(?i)(Bearer\s+)\S+", '${1}[redacted]'
  return $redacted
}

function Get-ProcessByRoot([string]$Root, [string]$NamePattern) {
  $rootPattern = [regex]::Escape([System.IO.Path]::GetFullPath($Root))
  @(
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.ProcessId -ne $PID -and
        $_.CommandLine -match $rootPattern -and
        $_.Name -match $NamePattern
      } |
      Sort-Object ProcessId |
      ForEach-Object {
        [pscustomobject]@{
          processId = $_.ProcessId
          name = $_.Name
          command = $_.CommandLine
        }
      }
  )
}

function Read-RecentLogSignals([string]$Root, [int]$Tail) {
  $signals = @(
    "OneBot",
    "get_login_info",
    "[QQ] Queued message",
    "[QQ] Sent text",
    "[QQ] Handling image message",
    "voice_in_received",
    "voice_in_download_success",
    "voice_in_download_failed",
    "voice_in_normalize_failed_fallback_text",
    "voice_asr_failed_fallback_text",
    "voice_tts_start",
    "voice_send_success",
    "voice_send_failed_fallback_text",
    "sticker_not_found",
    "sticker_send_failed_fallback_text",
    "[Proactive] Sent scheduled qq message"
  )

  $files = @("dev.out.log", "dev.err.log", "qq-napcat.out.log", "qq-napcat.err.log")
  $result = @()
  foreach ($file in $files) {
    $path = Join-Path $Root $file
    if (-not (Test-Path -LiteralPath $path)) {
      $result += [pscustomobject]@{
        file = $path
        exists = $false
        matches = @()
      }
      continue
    }

    $lines = @(Get-Content -LiteralPath $path -Tail $Tail -Encoding UTF8)
    $matches = @(
      $lines |
        Where-Object {
          $line = $_
          $signals | Where-Object { $line.Contains($_) } | Select-Object -First 1
        } |
        Select-Object -Last 30 |
        ForEach-Object { Protect-SecretText ([string]$_) }
    )
    $result += [pscustomobject]@{
      file = $path
      exists = $true
      matches = $matches
    }
  }
  return $result
}

$runRootFull = [System.IO.Path]::GetFullPath($RunRoot)
$napCatRootFull = [System.IO.Path]::GetFullPath($NapCatRoot)
$logRootFull = [System.IO.Path]::GetFullPath($LogRoot)
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

$mirraiUrl = "http://localhost:$MirraiPort/"
$headers = @{}
if (-not [string]::IsNullOrWhiteSpace($AccessToken)) {
  $headers.Authorization = "Bearer $AccessToken"
}

$mirraiProcesses = Get-ProcessByRoot $runRootFull "^(node|cmd|powershell|pwsh)(\.exe)?$"
$napCatProcesses = Get-ProcessByRoot $napCatRootFull "^(NapCatWinBootMain|QQ|node|python)(\.exe)?$"
$mirraiWeb = Test-Web $mirraiUrl
$oneBot = Test-HttpJson "$($BaseUrl.TrimEnd('/'))/get_login_info" $headers

$envSummary = [ordered]@{
  exists = Test-Path -LiteralPath $envPath
  qqEnabled = Read-DotEnvValue $envPath "QQ_ENABLED"
  oneBotBaseUrl = $BaseUrl
  oneBotAccessTokenConfigured = -not [string]::IsNullOrWhiteSpace($AccessToken)
  oneBotWebhookSecretConfigured = -not [string]::IsNullOrWhiteSpace((Read-DotEnvValue $envPath "QQ_ONEBOT_WEBHOOK_SECRET"))
  qqAllowGroups = Read-DotEnvValue $envPath "QQ_ALLOW_GROUPS"
  qqAutoBindSingleReadyPersona = Read-DotEnvValue $envPath "QQ_AUTO_BIND_SINGLE_READY_PERSONA"
  qqQuickLoginUinConfigured = -not [string]::IsNullOrWhiteSpace((Read-DotEnvValue $envPath "QQ_QUICK_LOGIN_UIN"))
}

$ready = $envSummary.exists -and
  ($envSummary.qqEnabled -eq "true") -and
  $mirraiWeb.ok -and
  ($napCatProcesses.Count -gt 0) -and
  $oneBot.ok

$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  readyForManualE2E = [bool]$ready
  paths = [ordered]@{
    runRoot = $runRootFull
    napCatRoot = $napCatRootFull
    logRoot = $logRootFull
    env = $envPath
  }
  env = $envSummary
  mirrai = [ordered]@{
    url = $mirraiUrl
    processCount = $mirraiProcesses.Count
    webOk = $mirraiWeb.ok
    webStatusCode = $mirraiWeb.statusCode
    error = $mirraiWeb.error
  }
  napCat = [ordered]@{
    processCount = $napCatProcesses.Count
    processes = @($napCatProcesses)
  }
  oneBot = [ordered]@{
    ok = $oneBot.ok
    baseUrl = $BaseUrl
    error = $oneBot.error
    loggedInUser = if ($oneBot.response.data) { "$($oneBot.response.data.nickname) ($($oneBot.response.data.user_id))" } else { $null }
  }
  recentLogSignals = Read-RecentLogSignals $logRootFull $RecentLogLines
  nextSteps = if ($ready) {
    @(
      "Send a private QQ text message to the bot account.",
      "Verify Mirrai logs contain [QQ] Queued message and [QQ] Sent text.",
      "Then verify voice, image/sticker, and proactive message cases from docs/qq-e2e-verification.md."
    )
  } else {
    @(
      "Ensure F:/Code/Mirrai/.env has QQ_ENABLED=true and the correct QQ_ONEBOT_BASE_URL.",
      "Start NapCat with scripts/start-qq.ps1 and complete login if a QQ window appears.",
      "Run scripts/status-qq.ps1 until OneBot reports OK, then rerun this readiness check."
    )
  }
}

if ($Json) {
  $report | ConvertTo-Json -Depth 8
  exit 0
}

Write-Host "QQ / OneBot E2E readiness"
Write-Host "Generated : $($report.generatedAt)"
Write-Host "Ready     : $($report.readyForManualE2E)"
Write-Host ""
Write-Host "Paths"
Write-Host "  Run root   : $runRootFull"
Write-Host "  NapCat root: $napCatRootFull"
Write-Host "  Logs       : $logRootFull"
Write-Host "  Env        : $envPath"
Write-Host ""
Write-Host "Environment"
Write-Host "  .env exists                 : $($envSummary.exists)"
Write-Host "  QQ_ENABLED                  : $($envSummary.qqEnabled)"
Write-Host "  QQ_ONEBOT_BASE_URL          : $($envSummary.oneBotBaseUrl)"
Write-Host "  QQ_ONEBOT_ACCESS_TOKEN      : $($envSummary.oneBotAccessTokenConfigured)"
Write-Host "  QQ_ONEBOT_WEBHOOK_SECRET    : $($envSummary.oneBotWebhookSecretConfigured)"
Write-Host "  QQ_ALLOW_GROUPS             : $($envSummary.qqAllowGroups)"
Write-Host "  QQ_AUTO_BIND_SINGLE_READY   : $($envSummary.qqAutoBindSingleReadyPersona)"
Write-Host "  QQ_QUICK_LOGIN_UIN          : $($envSummary.qqQuickLoginUinConfigured)"
Write-Host ""
Write-Host "Runtime"
Write-Host "  Mirrai web                  : $(if ($mirraiWeb.ok) { "OK ($($mirraiWeb.statusCode))" } else { "NOT RESPONDING ($($mirraiWeb.error))" })"
Write-Host "  NapCat process count        : $($napCatProcesses.Count)"
Write-Host "  OneBot                      : $(if ($oneBot.ok) { "OK $($report.oneBot.loggedInUser)" } else { "NOT RESPONDING ($($oneBot.error))" })"
Write-Host ""
Write-Host "Recent QQ log signals"
foreach ($entry in $report.recentLogSignals) {
  Write-Host "--- $($entry.file) ---"
  if (-not $entry.exists) {
    Write-Host "missing"
    continue
  }
  if ($entry.matches.Count -eq 0) {
    Write-Host "no recent QQ signals"
    continue
  }
  $entry.matches | ForEach-Object { Write-Host $_ }
}
Write-Host ""
Write-Host "Next steps"
$report.nextSteps | ForEach-Object { Write-Host "  - $_" }
