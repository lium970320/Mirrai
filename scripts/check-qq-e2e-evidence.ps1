param(
  [string]$LogRoot = "F:\.mirrai-local\Mirrai\logs",
  [datetime]$Since,
  [string]$CreateBaselinePath,
  [string]$BaselinePath,
  [int]$RecentLogLines = 800,
  [switch]$WaitForTextE2E,
  [int]$TimeoutSeconds = 120,
  [int]$PollSeconds = 3,
  [switch]$Json
)

$ErrorActionPreference = "SilentlyContinue"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

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

function Read-LogLines([string]$Path, [int]$Tail) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return @()
  }

  @(
    Get-Content -LiteralPath $Path -Tail $Tail -Encoding UTF8 |
      ForEach-Object { Protect-SecretText ([string]$_) }
  )
}

function Read-LogLinesFromOffset([string]$Path, [int]$Offset) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return @()
  }

  $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
  if ($Offset -lt 0) {
    $Offset = 0
  }
  if ($Offset -ge $lines.Count) {
    return @()
  }

  @(
    $lines |
      Select-Object -Skip $Offset |
      ForEach-Object { Protect-SecretText ([string]$_) }
  )
}

function Get-LogLineCount([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return 0
  }
  return @(Get-Content -LiteralPath $Path -Encoding UTF8).Count
}

function Select-Matches([string[]]$Lines, [string[]]$Patterns, [int]$Limit = 12) {
  @(
    $Lines |
      Where-Object {
        $line = $_
        $Patterns | Where-Object { $line.Contains($_) } | Select-Object -First 1
      } |
      Select-Object -Last $Limit
  )
}

function Get-Check([string]$Name, [string]$Description, [string[]]$Lines, [string[]]$PositivePatterns, [string[]]$FallbackPatterns = @()) {
  $positive = Select-Matches $Lines $PositivePatterns
  $fallback = Select-Matches $Lines $FallbackPatterns
  [pscustomobject]@{
    name = $Name
    description = $Description
    ok = $positive.Count -gt 0
    fallbackSeen = $fallback.Count -gt 0
    positiveMatches = $positive
    fallbackMatches = $fallback
  }
}

$logRootFull = [System.IO.Path]::GetFullPath($LogRoot)
$files = @("dev.out.log", "dev.err.log", "qq-napcat.out.log", "qq-napcat.err.log")

if (-not [string]::IsNullOrWhiteSpace($CreateBaselinePath)) {
  $baseline = [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    logRoot = $logRootFull
    files = @(
      foreach ($file in $files) {
        $path = Join-Path $logRootFull $file
        [pscustomobject]@{
          name = $file
          path = $path
          exists = Test-Path -LiteralPath $path
          lineCount = Get-LogLineCount $path
          lastWriteTime = if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).LastWriteTime.ToString("o") } else { $null }
        }
      }
    )
  }

  $baselinePathFull = [System.IO.Path]::GetFullPath($CreateBaselinePath)
  $baselineDir = Split-Path -Parent $baselinePathFull
  if (-not [string]::IsNullOrWhiteSpace($baselineDir)) {
    New-Item -ItemType Directory -Path $baselineDir -Force | Out-Null
  }
  $baseline | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $baselinePathFull -Encoding UTF8

  if ($Json) {
    $baseline | ConvertTo-Json -Depth 5
  } else {
    Write-Host "QQ E2E evidence baseline created"
    Write-Host "Path     : $baselinePathFull"
    Write-Host "Log root : $logRootFull"
    foreach ($file in $baseline.files) {
      Write-Host "  $($file.name) exists=$($file.exists) lineCount=$($file.lineCount)"
    }
  }
  exit 0
}

$baselineByName = @{}
if (-not [string]::IsNullOrWhiteSpace($BaselinePath)) {
  $baselinePathFull = [System.IO.Path]::GetFullPath($BaselinePath)
  if (Test-Path -LiteralPath $baselinePathFull) {
    $baseline = Get-Content -LiteralPath $baselinePathFull -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($entry in @($baseline.files)) {
      $baselineByName[[string]$entry.name] = [int]$entry.lineCount
    }
  }
}

function New-EvidenceReport {
  $fileReports = @()
  $allLines = @()

  foreach ($file in $files) {
    $path = Join-Path $logRootFull $file
    $usedBaseline = $baselineByName.ContainsKey($file)
    $lines = if ($usedBaseline) {
      Read-LogLinesFromOffset $path $baselineByName[$file]
    } else {
      Read-LogLines $path $RecentLogLines
    }
    if ($Since) {
      $lastWriteTime = if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).LastWriteTime } else { $null }
      if ($lastWriteTime -and $lastWriteTime -lt $Since) {
        $lines = @()
      }
    }

    $fileReports += [pscustomobject]@{
      file = $path
      exists = Test-Path -LiteralPath $path
      inspectedLines = $lines.Count
      baselineOffset = if ($usedBaseline) { $baselineByName[$file] } else { $null }
    }
    $allLines += $lines
  }

  $checks = @(
    Get-Check "private_text_inbound" "Private QQ text entered the Mirrai queue." $allLines @("[QQ] Queued message contact=qq:private:")
    Get-Check "text_outbound" "Mirrai sent QQ text through OneBot." $allLines @("[QQ] Sent text contact=qq:")
    Get-Check "voice_input" "QQ voice input entered the download / ASR flow." $allLines @("voice_in_received", "voice_in_download_success") @("voice_in_download_failed", "voice_in_normalize_failed_fallback_text", "voice_asr_failed_fallback_text")
    Get-Check "voice_output" "QQ voice output entered the TTS / record-send flow." $allLines @("voice_tts_start", "voice_send_success") @("voice_tts_failed", "voice_send_failed_fallback_text")
    Get-Check "image_or_sticker_input" "QQ image or sticker input entered media flow or text-placeholder fallback." $allLines @("[QQ] Handling image message", "[QQ] Received image media") @("[QQ] Falling back to text-only image placeholder")
    Get-Check "sticker_output" "Sticker output policy was triggered, or failed without breaking the main reply." $allLines @("sticker_selected", "sticker_send_success") @("sticker_not_found", "sticker_send_failed_fallback_text")
    Get-Check "proactive_qq" "QQ proactive message was sent." $allLines @("[Proactive] Sent scheduled qq message")
  )

  $requiredForFirstPass = @("private_text_inbound", "text_outbound")
  $firstPassReady = @(
    $checks |
      Where-Object { $requiredForFirstPass -contains $_.name -and -not $_.ok }
  ).Count -eq 0

  [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    logRoot = $logRootFull
    since = if ($Since) { $Since.ToString("o") } else { $null }
    recentLogLines = $RecentLogLines
    waiting = [bool]$WaitForTextE2E
    timeoutSeconds = if ($WaitForTextE2E) { $TimeoutSeconds } else { $null }
    pollSeconds = if ($WaitForTextE2E) { $PollSeconds } else { $null }
    firstPassTextE2EReady = [bool]$firstPassReady
    files = $fileReports
    checks = $checks
    nextSteps = if ($firstPassReady) {
      @(
        "Text E2E evidence exists. Continue with voice input/output, image/sticker input, sticker output, and proactive message cases.",
        "If you need a cleaner run, rerun with -Since set to the timestamp just before the next manual QQ test; note that dev logs do not carry stable per-line timestamps."
      )
    } else {
      @(
        "Send a private QQ text message to the bot account.",
        "Then rerun this script and verify private_text_inbound and text_outbound are both OK.",
        "Use -Since with the test start time to ignore files not touched since the run; use a small -RecentLogLines value if old lines in an active log make the result ambiguous."
      )
    }
  }
}

if ($PollSeconds -lt 1) {
  $PollSeconds = 1
}
if ($TimeoutSeconds -lt 1) {
  $TimeoutSeconds = 1
}

$report = $null
if ($WaitForTextE2E) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $report = New-EvidenceReport
    if ($report.firstPassTextE2EReady) {
      break
    }
    if ((Get-Date) -ge $deadline) {
      break
    }
    Start-Sleep -Seconds $PollSeconds
  } while ($true)
} else {
  $report = New-EvidenceReport
}

if ($Json) {
  $report | ConvertTo-Json -Depth 8
  if ($WaitForTextE2E -and -not $report.firstPassTextE2EReady) {
    exit 2
  }
  exit 0
}

Write-Host "QQ E2E evidence"
Write-Host "Generated         : $($report.generatedAt)"
Write-Host "Log root          : $logRootFull"
Write-Host "Recent log lines  : $RecentLogLines"
Write-Host "Since             : $(if ($Since) { $Since.ToString('o') } else { '(not set)' })"
Write-Host "Wait mode         : $($report.waiting)"
if ($report.waiting) {
  Write-Host "Timeout seconds   : $TimeoutSeconds"
  Write-Host "Poll seconds      : $PollSeconds"
}
Write-Host "Text first pass   : $($report.firstPassTextE2EReady)"
Write-Host ""
Write-Host "Files"
foreach ($file in $report.files) {
  Write-Host "  $($file.file) exists=$($file.exists) inspectedLines=$($file.inspectedLines)"
}
Write-Host ""
Write-Host "Checks"
foreach ($check in $report.checks) {
  $state = if ($check.ok) { "OK" } elseif ($check.fallbackSeen) { "FALLBACK_ONLY" } else { "MISSING" }
  Write-Host "[$state] $($check.name) - $($check.description)"
  if ($check.positiveMatches.Count -gt 0) {
    $check.positiveMatches | ForEach-Object { Write-Host "  + $_" }
  }
  if ($check.fallbackMatches.Count -gt 0) {
    $check.fallbackMatches | ForEach-Object { Write-Host "  ! $_" }
  }
}
Write-Host ""
Write-Host "Next steps"
$report.nextSteps | ForEach-Object { Write-Host "  - $_" }

if ($WaitForTextE2E -and -not $report.firstPassTextE2EReady) {
  exit 2
}
