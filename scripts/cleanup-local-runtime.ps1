param(
  [string]$RunRoot = "F:\Code\Mirrai",
  [string]$RuntimeRoot = "F:\.mirrai-local\Mirrai",
  [switch]$Apply,
  [switch]$IncludeUploads,
  [switch]$IncludeTtsCache,
  [switch]$IncludeLogs,
  [switch]$IncludeTmp,
  [switch]$IncludePlaywright,
  [switch]$IncludeScreenshots,
  [switch]$IncludeNapCatDownloads,
  [switch]$IncludeNapCatRuntime,
  [switch]$IncludeVoxcpmRuntime,
  [switch]$IncludeTorchRuntime,
  [switch]$IncludeModelCaches,
  [string]$ConfirmLargeRuntimeCleanup
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Resolve-StrictPath([string]$Path) {
  [System.IO.Path]::GetFullPath($Path)
}

function Assert-WithinRoot([string]$Path, [string[]]$AllowedRoots) {
  $fullPath = Resolve-StrictPath $Path
  foreach ($root in $AllowedRoots) {
    $fullRoot = Resolve-StrictPath $root
    if ($fullPath.Equals($fullRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($fullRoot.TrimEnd('\') + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
      return $fullPath
    }
  }
  throw "Refusing to clean outside allowed local roots: $fullPath"
}

function Add-Target([System.Collections.Generic.List[string]]$Targets, [string]$Path, [string[]]$AllowedRoots) {
  $resolved = Assert-WithinRoot $Path $AllowedRoots
  if (Test-Path -LiteralPath $resolved) {
    $Targets.Add($resolved)
  }
}

function Add-LargeRuntimeTarget(
  [System.Collections.Generic.List[string]]$Targets,
  [System.Collections.Generic.List[string]]$LargeTargets,
  [string]$Path,
  [string[]]$AllowedRoots
) {
  $resolved = Assert-WithinRoot $Path $AllowedRoots
  if (Test-Path -LiteralPath $resolved) {
    $Targets.Add($resolved)
    $LargeTargets.Add($resolved)
  }
}

$runRootFull = Resolve-StrictPath $RunRoot
$runtimeRootFull = Resolve-StrictPath $RuntimeRoot
$allowedRoots = @($runRootFull, $runtimeRootFull)
$targets = [System.Collections.Generic.List[string]]::new()
$largeRuntimeTargets = [System.Collections.Generic.List[string]]::new()
$largeRuntimeConfirmText = "DELETE LARGE MIRRAI RUNTIME"

if ($IncludeUploads) {
  Add-Target $targets (Join-Path $runRootFull "uploads") $allowedRoots
}

if ($IncludeTtsCache) {
  Add-Target $targets (Join-Path $runRootFull "uploads\tts") $allowedRoots
}

if ($IncludeLogs) {
  Add-Target $targets (Join-Path $runtimeRootFull "logs") $allowedRoots
}

if ($IncludeTmp) {
  Add-Target $targets (Join-Path $runtimeRootFull "tmp") $allowedRoots
  Add-Target $targets (Join-Path $runRootFull "tmp") $allowedRoots
}

if ($IncludePlaywright) {
  Add-Target $targets (Join-Path $runRootFull ".playwright-cli") $allowedRoots
}

if ($IncludeScreenshots) {
  Add-Target $targets (Join-Path $runtimeRootFull "screenshots") $allowedRoots
}

if ($IncludeNapCatDownloads) {
  Add-Target $targets (Join-Path $runtimeRootFull "tools\napcat\downloads") $allowedRoots
}

if ($IncludeNapCatRuntime) {
  Add-LargeRuntimeTarget $targets $largeRuntimeTargets (Join-Path $runtimeRootFull "tools\napcat") $allowedRoots
}

if ($IncludeVoxcpmRuntime) {
  Add-LargeRuntimeTarget $targets $largeRuntimeTargets (Join-Path $runtimeRootFull "voxcpm") $allowedRoots
}

if ($IncludeTorchRuntime) {
  Add-LargeRuntimeTarget $targets $largeRuntimeTargets (Join-Path $runtimeRootFull "torch") $allowedRoots
}

if ($IncludeModelCaches) {
  Add-LargeRuntimeTarget $targets $largeRuntimeTargets (Join-Path $runtimeRootFull "huggingface") $allowedRoots
  Add-LargeRuntimeTarget $targets $largeRuntimeTargets (Join-Path $runtimeRootFull "modelscope") $allowedRoots
}

$uniqueTargets = @($targets | Sort-Object -Unique | Sort-Object Length)
$effectiveTargets = [System.Collections.Generic.List[string]]::new()
foreach ($target in $uniqueTargets) {
  $isNested = $false
  foreach ($existing in $effectiveTargets) {
    if ($target.Equals($existing, [System.StringComparison]::OrdinalIgnoreCase) -or
        $target.StartsWith($existing.TrimEnd('\') + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
      $isNested = $true
      break
    }
  }
  if (-not $isNested) {
    $effectiveTargets.Add($target)
  }
}
$targets = $effectiveTargets

Write-Host "Mirrai local runtime cleanup"
Write-Host "Run root: $runRootFull"
Write-Host "Runtime root: $runtimeRootFull"
Write-Host "Mode: $(if ($Apply) { 'APPLY' } else { 'DRY RUN' })"
Write-Host ""

if ($targets.Count -eq 0) {
  Write-Host "No existing targets selected."
  Write-Host "Choose one or more switches, for example: -IncludeTtsCache -IncludeTmp -IncludePlaywright"
  Write-Host "Large runtime switches such as -IncludeNapCatRuntime, -IncludeVoxcpmRuntime, -IncludeTorchRuntime and -IncludeModelCaches are dry-run by default and require explicit confirmation when using -Apply."
  exit 0
}

Write-Host "Targets:"
foreach ($target in $targets) {
  $item = Get-Item -LiteralPath $target -Force
  $size = 0L
  if ($item.PSIsContainer) {
    $size = (Get-ChildItem -LiteralPath $target -Force -Recurse -File -ErrorAction SilentlyContinue |
      Measure-Object -Property Length -Sum).Sum
  } else {
    $size = $item.Length
  }
  Write-Host ("- {0} ({1:N0} bytes)" -f $target, $size)
}

if ($largeRuntimeTargets.Count -gt 0) {
  Write-Host ""
  Write-Host "Large/runtime login targets selected:"
  foreach ($target in $largeRuntimeTargets) {
    Write-Host "- $target"
  }
  Write-Host "These may require QQ re-login, VoxCPM setup, or large model re-downloads."
  Write-Host "To delete them with -Apply, pass: -ConfirmLargeRuntimeCleanup '$largeRuntimeConfirmText'"
}

if (-not $Apply) {
  Write-Host ""
  Write-Host "Dry run only. Re-run with -Apply to delete these local runtime targets."
  exit 0
}

if ($largeRuntimeTargets.Count -gt 0 -and $ConfirmLargeRuntimeCleanup -ne $largeRuntimeConfirmText) {
  Write-Host ""
  Write-Host "Refusing to delete large/runtime login targets without explicit confirmation."
  Write-Host "Re-run with: -ConfirmLargeRuntimeCleanup '$largeRuntimeConfirmText'"
  exit 2
}

foreach ($target in $targets) {
  $resolved = Assert-WithinRoot $target $allowedRoots
  if (Test-Path -LiteralPath $resolved) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
    Write-Host "Deleted: $resolved"
  }
}

Write-Host "Cleanup complete."
