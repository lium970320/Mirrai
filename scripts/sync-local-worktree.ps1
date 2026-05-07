param(
  [string]$TargetRoot,
  [switch]$CopyEnv,
  [switch]$OverwriteEnv,
  [switch]$Install
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir ".."))
$sourceDrive = [System.IO.Path]::GetPathRoot($sourceRoot)

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
  $TargetRoot = Join-Path $sourceDrive "Code\Mirrai"
}

$targetFull = [System.IO.Path]::GetFullPath($TargetRoot)

if ($targetFull.StartsWith($sourceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "TargetRoot must be outside the Google Drive source folder: $targetFull"
}

New-Item -ItemType Directory -Path $targetFull -Force | Out-Null

$excludeDirs = @(
  ".git",
  "node_modules",
  "dist",
  ".vite",
  "uploads",
  "build-macos",
  ".mirrai-local",
  "tmp"
)

$excludeFiles = @(
  ".env",
  "*.log",
  "*.memory-card.json",
  "*.tsbuildinfo",
  "*(1)*"
)

Write-Host "Source: $sourceRoot"
Write-Host "Target: $targetFull"
Write-Host "Mirroring source files, excluding generated/runtime artifacts..."

$robocopyArgs = @(
  $sourceRoot,
  $targetFull,
  "/MIR",
  "/R:2",
  "/W:1",
  "/NFL",
  "/NDL",
  "/NP",
  "/XD"
) + $excludeDirs + @("/XF") + $excludeFiles

& robocopy @robocopyArgs | Out-Host
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -gt 7) {
  throw "robocopy failed with exit code $robocopyExit"
}

$sourceEnv = Join-Path $sourceRoot ".env"
$targetEnv = Join-Path $targetFull ".env"
if ($CopyEnv -and (Test-Path -LiteralPath $sourceEnv)) {
  if ((Test-Path -LiteralPath $targetEnv) -and -not $OverwriteEnv) {
    Write-Host "Skipped .env copy because target .env already exists."
  } else {
    Copy-Item -LiteralPath $sourceEnv -Destination $targetEnv -Force
    Write-Host "Copied .env to the local worktree. Keep editing the local copy there."
  }
}

if ($Install) {
  Push-Location $targetFull
  try {
    Write-Host "Installing dependencies in the local worktree..."
    & corepack pnpm install --no-frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
      throw "pnpm install failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "Done."
Write-Host "Run from the local worktree:"
Write-Host "  cd `"$targetFull`""
Write-Host "  corepack pnpm run dev"
