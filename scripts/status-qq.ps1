param(
  [string]$RunRoot = "F:\Code\Mirrai",
  [string]$NapCatRoot = "F:\.mirrai-local\Mirrai\tools\napcat\onekey-v4.18.1",
  [string]$BaseUrl,
  [string]$AccessToken
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

$runRootFull = [System.IO.Path]::GetFullPath($RunRoot)
$napCatRootFull = [System.IO.Path]::GetFullPath($NapCatRoot)
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

$napCatPattern = [regex]::Escape($napCatRootFull)
$processes = @(
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -match $napCatPattern -and
      $_.Name -match "^(NapCatWinBootMain|QQ|node|python)(\.exe)?$"
    } |
    Sort-Object ProcessId
)

Write-Host "QQ/NapCat status"
Write-Host "NapCat root: $napCatRootFull"
Write-Host "OneBot URL : $BaseUrl"
Write-Host ""

if ($processes.Count -gt 0) {
  Write-Host "Process: RUNNING ($($processes.Count) related process(es))"
  $processes |
    Select-Object ProcessId, Name, @{ Name = "Command"; Expression = { $_.CommandLine } } |
    Format-Table -AutoSize |
    Out-String -Width 220 |
    Write-Host
} else {
  Write-Host "Process: STOPPED"
}

try {
  $headers = @{}
  if (-not [string]::IsNullOrWhiteSpace($AccessToken)) {
    $headers.Authorization = "Bearer $AccessToken"
  }
  $status = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/get_status" -Headers $headers -TimeoutSec 5
  if ($status.status -ne "ok" -or $status.data.online -ne $true -or $status.data.good -eq $false) {
    Write-Host "OneBot: OFFLINE (online=$($status.data.online), good=$($status.data.good))"
    exit 1
  }
  $response = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/get_login_info" -Headers $headers -TimeoutSec 5
  $friends = Invoke-RestMethod -Uri "$($BaseUrl.TrimEnd('/'))/get_friend_list" -Headers $headers -TimeoutSec 8
  $friendCount = @($friends.data).Count
  if ($friends.status -ne "ok" -or $friendCount -le 0) {
    Write-Host "OneBot: DEGRADED (friend list unavailable or empty)"
    exit 1
  }
  Write-Host "OneBot: OK"
  if ($response.data) {
    Write-Host "Logged in: $($response.data.nickname) ($($response.data.user_id))"
    Write-Host "Friends : $friendCount"
  } else {
    $response | ConvertTo-Json -Depth 4 | Write-Host
  }
} catch {
  Write-Host "OneBot: NOT RESPONDING ($($_.Exception.Message))"
}
