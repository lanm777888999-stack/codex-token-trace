# Builds the no-install portable ZIP published with each Token Trace release.

[CmdletBinding()]
param(
  [string]$ReleaseVersion = "v1.0.0",
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$sourceDir = $PSScriptRoot
if (-not $OutputDir) { $OutputDir = Join-Path $sourceDir "dist" }
$files = @(
  "token-stats.mjs",
  "dashboard.html",
  "floating-panel.ps1",
  "guardian.ps1",
  "install-autostart.ps1",
  "uninstall-autostart.ps1",
  "start-token-trace.ps1",
  "assets\token_black_cat.png",
  "LICENSE",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md"
)

function Get-NodeMajor {
  param([string]$NodePath)
  $version = (& $NodePath --version).Trim()
  if ($version -match '^v(\d+)\.') { return [int]$Matches[1] }
  return 0
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node -or (Get-NodeMajor $node.Source) -lt 22) {
  throw "Build-Portable.ps1 requires Node.js 22+ on the release machine."
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("token-trace-portable-" + [guid]::NewGuid().ToString("N"))
$packageRoot = Join-Path $tempRoot "TokenTrace"
$archive = Join-Path $OutputDir ("TokenTrace-" + $ReleaseVersion + "-portable.zip")

try {
  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
  foreach ($relative in $files) {
    $source = Join-Path $sourceDir $relative
    if (-not (Test-Path -LiteralPath $source)) { throw "Required portable file is missing: $relative" }
    $destination = Join-Path $packageRoot $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }

  $runtimeDir = Join-Path $packageRoot "runtime"
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  Copy-Item -LiteralPath $node.Source -Destination (Join-Path $runtimeDir "node.exe") -Force
  Set-Content -LiteralPath (Join-Path $runtimeDir "NODE-VERSION.txt") -Value ((& $node.Source --version).Trim()) -Encoding Ascii

  $installCmd = @'
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
echo.
pause
'@
  $startCmd = @'
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-token-trace.ps1"
pause
'@
  $uninstallCmd = @'
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-autostart.ps1"
echo.
pause
'@
  $portableReadme = @"
Token Trace $ReleaseVersion - Portable Windows package

1. Extract this ZIP to a normal local folder. Do not run it inside the ZIP viewer.
2. Double-click Install.cmd once. No administrator permission, GitHub login, or Node.js installation is required.
3. Open Codex / ChatGPT Desktop normally. Token Trace starts automatically and stops after every Codex window closes.

Manual options:
- Start.cmd: start the local dashboard and floating panel immediately.
- Uninstall.cmd: remove automatic follow mode. Theme, prices, and custom cover remain in %LOCALAPPDATA%\ccm-token-spend.

Dashboard: http://127.0.0.1:8766
"@
  Set-Content -LiteralPath (Join-Path $packageRoot "Install.cmd") -Value $installCmd -Encoding Ascii
  Set-Content -LiteralPath (Join-Path $packageRoot "Start.cmd") -Value $startCmd -Encoding Ascii
  Set-Content -LiteralPath (Join-Path $packageRoot "Uninstall.cmd") -Value $uninstallCmd -Encoding Ascii
  Set-Content -LiteralPath (Join-Path $packageRoot "README-PORTABLE.txt") -Value $portableReadme -Encoding UTF8

  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
  Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
  Compress-Archive -LiteralPath $packageRoot -DestinationPath $archive -CompressionLevel Optimal
  Get-FileHash -LiteralPath $archive -Algorithm SHA256 | ForEach-Object {
    Set-Content -LiteralPath ($archive + ".sha256") -Value ($_.Hash.ToLowerInvariant() + "  " + [System.IO.Path]::GetFileName($archive)) -Encoding Ascii
  }
  Write-Host ("Portable release created: " + $archive) -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
