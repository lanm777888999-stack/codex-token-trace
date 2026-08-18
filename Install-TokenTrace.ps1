# One-command installer for Token Trace.
# Example (downloads the installer to the temporary folder before executing it):
# $u='https://raw.githubusercontent.com/lanm777888999-stack/codex-token-trace/main/Install-TokenTrace.ps1'; $p=Join-Path $env:TEMP 'Install-TokenTrace.ps1'; Invoke-WebRequest $u -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p

[CmdletBinding()]
param(
  [string]$Repository = "lanm777888999-stack/codex-token-trace",
  [string]$Branch = "main",
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "TokenTrace"),
  [switch]$SkipAutoStart
)

$ErrorActionPreference = "Stop"
$nodeVersion = "v24.14.0"
$nodeArchiveName = "node-$nodeVersion-win-x64.zip"
$nodeArchiveUrl = "https://nodejs.org/dist/$nodeVersion/$nodeArchiveName"
$requiredFiles = @(
  "token-stats.mjs",
  "dashboard.html",
  "floating-panel.ps1",
  "guardian.ps1",
  "install-autostart.ps1",
  "uninstall-autostart.ps1",
  "start-token-trace.ps1",
  "assets/token_black_cat.png"
)

function Write-Step {
  param([string]$Message)
  Write-Host ("[Token Trace] " + $Message) -ForegroundColor Cyan
}

function Get-NodeMajor {
  param([string]$NodePath)
  try {
    $version = (& $NodePath --version 2>$null).Trim()
    if ($version -match '^v(\d+)\.') { return [int]$Matches[1] }
  } catch {}
  return 0
}

if ($env:OS -ne "Windows_NT") {
  throw "Token Trace currently supports Windows only."
}
if (-not [Environment]::Is64BitOperatingSystem) {
  throw "Token Trace currently requires 64-bit Windows."
}

Write-Step "Resolving the published source revision..."
$headers = @{ "User-Agent" = "TokenTrace-Installer"; "Accept" = "application/vnd.github+json" }
$commit = Invoke-RestMethod -Uri ("https://api.github.com/repos/{0}/commits/{1}" -f $Repository, $Branch) -Headers $headers
$revision = $commit.sha
if (-not $revision) { throw "Could not resolve the GitHub revision for $Repository/$Branch." }

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
foreach ($relativePath in $requiredFiles) {
  $destination = Join-Path $InstallDir $relativePath
  $destinationDir = Split-Path -Parent $destination
  New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
  $url = "https://raw.githubusercontent.com/{0}/{1}/{2}" -f $Repository, $revision, $relativePath
  Write-Step ("Downloading " + $relativePath)
  Invoke-WebRequest -Uri $url -OutFile $destination -Headers $headers
}

$bundledNode = Join-Path $InstallDir "runtime\node.exe"
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$systemNode = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if ($systemNode -and (Get-NodeMajor $systemNode) -ge 22) {
  Write-Step ("Using existing Node.js: " + (& $systemNode --version))
} elseif (-not (Test-Path -LiteralPath $bundledNode) -or (Get-NodeMajor $bundledNode) -lt 22) {
  Write-Step "Node.js >= 22 was not found; downloading the portable runtime..."
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("token-trace-node-" + [guid]::NewGuid().ToString("N"))
  $archive = Join-Path $tempRoot $nodeArchiveName
  $extractRoot = Join-Path $tempRoot "extract"
  try {
    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    Invoke-WebRequest -Uri $nodeArchiveUrl -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot -Force
    $downloadedNode = Join-Path $extractRoot ("node-" + $nodeVersion + "-win-x64\node.exe")
    if (-not (Test-Path -LiteralPath $downloadedNode)) { throw "The downloaded Node.js archive did not contain node.exe." }
    New-Item -ItemType Directory -Path (Split-Path -Parent $bundledNode) -Force | Out-Null
    Copy-Item -LiteralPath $downloadedNode -Destination $bundledNode -Force
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Step ("Portable Node.js installed: " + (& $bundledNode --version))
} else {
  Write-Step ("Using existing bundled Node.js: " + (& $bundledNode --version))
}

$metadata = [ordered]@{
  repository = $Repository
  revision = $revision
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
  nodeVersion = if (Test-Path -LiteralPath $bundledNode) { (& $bundledNode --version).Trim() } elseif ($systemNode) { (& $systemNode --version).Trim() } else { $null }
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallDir "install-info.json") -Encoding UTF8

if (-not $SkipAutoStart) {
  Write-Step "Enabling Codex follow mode..."
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir "install-autostart.ps1")
}

Write-Host ""
Write-Host "Token Trace is ready." -ForegroundColor Green
Write-Host "Open Codex normally from any entry; Token Trace will follow automatically."
Write-Host "Dashboard: http://127.0.0.1:8766"
Write-Host ("Installed files: " + $InstallDir)
Write-Host "To uninstall follow mode: run uninstall-autostart.ps1 in the installed folder."
