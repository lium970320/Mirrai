param(
  [string]$RunRoot = "F:\Code\Mirrai",
  [string]$BaseUrl = "http://localhost:3000",
  [string]$WebhookSecret,
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

function Invoke-Smoke([string]$Url, [hashtable]$Headers, [string]$Body) {
  try {
    $response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers -ContentType "application/json" -Body $Body -TimeoutSec 8
    return [pscustomobject]@{
      ok = $true
      error = $null
      response = $response
    }
  } catch {
    $statusCode = $null
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }
    return [pscustomobject]@{
      ok = $false
      error = $_.Exception.Message
      statusCode = $statusCode
      response = $null
    }
  }
}

$runRootFull = [System.IO.Path]::GetFullPath($RunRoot)
$envPath = Join-Path $runRootFull ".env"
if ([string]::IsNullOrWhiteSpace($WebhookSecret)) {
  $WebhookSecret = Read-DotEnvValue $envPath "QQ_ONEBOT_WEBHOOK_SECRET"
}

$url = "$($BaseUrl.TrimEnd('/'))/api/qq/onebot/event"
$headers = @{}
if (-not [string]::IsNullOrWhiteSpace($WebhookSecret)) {
  $headers["x-mirrai-token"] = $WebhookSecret
}

$selfId = "3321802943"
$bodyObject = [ordered]@{
  post_type = "message"
  message_type = "private"
  self_id = $selfId
  user_id = $selfId
  message_id = "codex-smoke-$(Get-Date -Format 'yyyyMMddHHmmss')"
  sender = @{
    nickname = "webhook-smoke-self"
  }
  message = @(
    @{
      type = "text"
      data = @{
        text = "webhook smoke self-message; should be ignored"
      }
    }
  )
  raw_message = "webhook smoke self-message; should be ignored"
}

$body = $bodyObject | ConvertTo-Json -Depth 8 -Compress
$result = Invoke-Smoke $url $headers $body
$responseStatus = if ($result.response) { [string]$result.response.status } else { $null }
$responseHandled = if ($result.response -and ($result.response.PSObject.Properties.Name -contains "handled")) { [bool]$result.response.handled } else { $null }
$responseReason = if ($result.response) { [string]$result.response.reason } else { $null }
$passed = $result.ok -and $responseStatus -eq "ok" -and $responseHandled -eq $false -and $responseReason -eq "ignored_self_message"

$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  passed = [bool]$passed
  url = $url
  envExists = Test-Path -LiteralPath $envPath
  webhookSecretConfigured = -not [string]::IsNullOrWhiteSpace($WebhookSecret)
  requestKind = "self_message_should_be_ignored"
  httpOk = [bool]$result.ok
  httpError = $result.error
  httpStatusCode = $result.statusCode
  response = [ordered]@{
    status = $responseStatus
    handled = $responseHandled
    reason = $responseReason
  }
  nextSteps = if ($passed) {
    @(
      "Webhook route, auth token, JSON body parsing, and QQ handler entry are responding.",
      "This smoke test does not prove real QQ inbound delivery; continue with a test contact message and check-qq-e2e-evidence.ps1."
    )
  } else {
    @(
      "Check that Mirrai is running on the selected BaseUrl.",
      "If webhook secret is configured, verify F:/Code/Mirrai/.env has the current QQ_ONEBOT_WEBHOOK_SECRET.",
      "Run scripts/check-qq-e2e-readiness.ps1 to confirm Mirrai web and OneBot status."
    )
  }
}

if ($Json) {
  $report | ConvertTo-Json -Depth 6
  exit 0
}

Write-Host "QQ webhook smoke"
Write-Host "Generated                 : $($report.generatedAt)"
Write-Host "Passed                    : $($report.passed)"
Write-Host "URL                       : $($report.url)"
Write-Host "Env exists                : $($report.envExists)"
Write-Host "Webhook secret configured : $($report.webhookSecretConfigured)"
Write-Host "Request kind              : $($report.requestKind)"
Write-Host "HTTP OK                   : $($report.httpOk)"
if (-not $report.httpOk) {
  Write-Host "HTTP error                : $($report.httpError)"
  Write-Host "HTTP status code          : $($report.httpStatusCode)"
}
Write-Host "Response status           : $($report.response.status)"
Write-Host "Response handled          : $($report.response.handled)"
Write-Host "Response reason           : $($report.response.reason)"
Write-Host ""
Write-Host "Next steps"
$report.nextSteps | ForEach-Object { Write-Host "  - $_" }
