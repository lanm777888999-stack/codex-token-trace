# Token Trace one-command installer. It never calls the GitHub API.
# See README.md for the copy-and-run installation command.

[CmdletBinding()]
param(
  [string]$Repository = "lanm777888999-stack/codex-token-trace",
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "TokenTrace"),
  [switch]$SkipAutoStart,
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
$ReleaseVersion = "v1.1.0"
$NodeVersion = "v24.14.0"
$NodeArchiveName = "node-$NodeVersion-win-x64.zip"
$NodeArchiveUrl = "https://nodejs.org/dist/$NodeVersion/$NodeArchiveName"
$RequiredFiles = @(
  "token-stats.mjs",
  "dashboard.html",
  "floating-panel.ps1",
  "guardian.ps1",
  "install-autostart.ps1",
  "uninstall-autostart.ps1",
  "start-token-trace.ps1",
  "assets/token_black_cat.png"
)
$Headers = @{ "User-Agent" = "TokenTrace-Installer" }

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

function Get-SourceUrls {
  param([string]$RelativePath)
  $cleanPath = $RelativePath.TrimStart("/")
  return @(
    "https://cdn.jsdelivr.net/gh/$Repository@$ReleaseVersion/$cleanPath",
    "https://raw.githubusercontent.com/$Repository/$ReleaseVersion/$cleanPath"
  )
}

function Get-RemoteFile {
  param([string]$RelativePath, [string]$Destination)
  $destinationDir = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
  $temporary = Join-Path $destinationDir ("." + [System.IO.Path]::GetFileName($Destination) + ".download")
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  foreach ($url in (Get-SourceUrls $RelativePath)) {
    try {
      Invoke-WebRequest -Uri $url -OutFile $temporary -Headers $Headers -ErrorAction Stop
      if (-not (Test-Path -LiteralPath $temporary) -or (Get-Item -LiteralPath $temporary).Length -eq 0) {
        throw "Downloaded file is empty."
      }
      Move-Item -LiteralPath $temporary -Destination $Destination -Force
      return $url
    } catch {
      Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
  }
  throw "Cannot download '$RelativePath': jsDelivr and GitHub Raw are both unavailable. This is a network/CDN access problem; check your connection and try again."
}

function Install-NodeRuntime {
  param([string]$BundledNode)
  Write-Step "Node.js >= 22 was not found; downloading the official portable runtime..."
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("token-trace-node-" + [guid]::NewGuid().ToString("N"))
  $archive = Join-Path $tempRoot $NodeArchiveName
  $extractRoot = Join-Path $tempRoot "extract"
  try {
    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    Invoke-WebRequest -Uri $NodeArchiveUrl -OutFile $archive -Headers $Headers -ErrorAction Stop
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot -Force
    $downloadedNode = Join-Path $extractRoot ("node-" + $NodeVersion + "-win-x64\node.exe")
    if (-not (Test-Path -LiteralPath $downloadedNode)) { throw "Official Node.js archive did not contain node.exe." }
    New-Item -ItemType Directory -Path (Split-Path -Parent $BundledNode) -Force | Out-Null
    Copy-Item -LiteralPath $downloadedNode -Destination $BundledNode -Force
  } catch {
    throw "Cannot download the official Node.js runtime. Check your network connection and try again."
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-SelfTest {
  $urls = Get-SourceUrls "dashboard.html"
  $expectedCdn = "https://cdn.jsdelivr.net/gh/$Repository@$ReleaseVersion/dashboard.html"
  $expectedRaw = "https://raw.githubusercontent.com/$Repository/$ReleaseVersion/dashboard.html"
  if ($urls.Count -ne 2 -or $urls[0] -ne $expectedCdn -or $urls[1] -ne $expectedRaw) {
    throw "Download URL construction self-test failed."
  }
  Write-Host "Installer self-test passed: CDN primary, Raw fallback, no GitHub API." -ForegroundColor Green
}

function Install-TokenTrace {
  if ($env:OS -ne "Windows_NT") { throw "Token Trace currently supports Windows only." }
  if (-not [Environment]::Is64BitOperatingSystem) { throw "Token Trace currently requires 64-bit Windows." }

  Write-Step ("Installing release " + $ReleaseVersion + " without GitHub API access.")
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  foreach ($relativePath in $RequiredFiles) {
    $destination = Join-Path $InstallDir $relativePath
    Write-Step ("Downloading " + $relativePath)
    Get-RemoteFile -RelativePath $relativePath -Destination $destination | Out-Null
  }

  $bundledNode = Join-Path $InstallDir "runtime\node.exe"
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  $systemNode = if ($nodeCommand) { $nodeCommand.Source } else { $null }
  if ($systemNode -and (Get-NodeMajor $systemNode) -ge 22) {
    Write-Step ("Using existing Node.js: " + (& $systemNode --version))
  } elseif (-not (Test-Path -LiteralPath $bundledNode) -or (Get-NodeMajor $bundledNode) -lt 22) {
    Install-NodeRuntime -BundledNode $bundledNode
    Write-Step ("Portable Node.js installed: " + (& $bundledNode --version))
  } else {
    Write-Step ("Using existing bundled Node.js: " + (& $bundledNode --version))
  }

  [ordered]@{
    repository = $Repository
    releaseVersion = $ReleaseVersion
    installedAt = (Get-Date).ToUniversalTime().ToString("o")
    nodeVersion = if (Test-Path -LiteralPath $bundledNode) { (& $bundledNode --version).Trim() } elseif ($systemNode) { (& $systemNode --version).Trim() } else { $null }
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallDir "install-info.json") -Encoding UTF8

  if (-not $SkipAutoStart) {
    Write-Step "Enabling Codex follow mode..."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir "install-autostart.ps1")
  }

  Write-Host ""
  Write-Host "Token Trace is ready." -ForegroundColor Green
  Write-Host "Open Codex normally from any entry; Token Trace will follow automatically."
  Write-Host "Dashboard: http://127.0.0.1:8766"
  Write-Host ("Installed files: " + $InstallDir)
}

try {
  if ($SelfTest) {
    Invoke-SelfTest
  } else {
    Install-TokenTrace
  }
} catch {
  Write-Host ("[Token Trace] Installation failed: " + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
