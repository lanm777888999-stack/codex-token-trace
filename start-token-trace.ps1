# Starts Token Trace without Codex++.
# It launches the local dashboard/API server and the floating panel.

param(
  [int]$Port = 8766
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$stateDir = Join-Path $env:LOCALAPPDATA "ccm-token-spend"
if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }

$serverPidFile = Join-Path $stateDir "server.pid"
$panelPidFile = Join-Path $stateDir "floating-panel.pid"
$serverLog = Join-Path $stateDir "server.log"
$panelLog = Join-Path $stateDir "floating-panel.log"

function Test-PidFileRunning {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
  if ($raw -notmatch '^\s*\d+\s*$') { return $false }
  return $null -ne (Get-Process -Id ([int]$raw.Trim()) -ErrorAction SilentlyContinue)
}

function Stop-PidFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') {
    Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}

$bundledNode = Join-Path $scriptDir "runtime\node.exe"
$nodePath = $null
if (Test-Path -LiteralPath $bundledNode) {
  $nodePath = $bundledNode
} else {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { $nodePath = $node.Source }
}
if (-not $nodePath) { throw "Node.js was not found. Download the portable ZIP (which includes the runtime) or install Node.js >= 22." }

$stats = Join-Path $scriptDir "token-stats.mjs"
$panel = Join-Path $scriptDir "floating-panel.ps1"
if (-not (Test-Path -LiteralPath $stats)) { throw "token-stats.mjs not found." }
if (-not (Test-Path -LiteralPath $panel)) { throw "floating-panel.ps1 not found." }

if (-not (Test-PidFileRunning $serverPidFile)) {
  $args = @('"' + $stats + '"', '--server', '--port', [string]$Port)
  $proc = Start-Process -FilePath $nodePath -ArgumentList $args -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError ($serverLog + ".err") -PassThru
  Set-Content -LiteralPath $serverPidFile -Value $proc.Id -Encoding Ascii
  Write-Host ("Token Trace server started: http://127.0.0.1:" + $Port)
} else {
  Write-Host ("Token Trace server is already running: http://127.0.0.1:" + $Port)
}

Stop-PidFile $panelPidFile
$psExe = (Get-Command powershell.exe).Source
$panelArgs = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $panel + '" -ServerUrl "http://127.0.0.1:' + $Port + '"'
$proc = Start-Process -FilePath $psExe -ArgumentList $panelArgs -WindowStyle Hidden -RedirectStandardOutput $panelLog -RedirectStandardError ($panelLog + ".err") -PassThru
Set-Content -LiteralPath $panelPidFile -Value $proc.Id -Encoding Ascii
Write-Host "Floating panel started."

Write-Host ("Dashboard: http://127.0.0.1:" + $Port)
