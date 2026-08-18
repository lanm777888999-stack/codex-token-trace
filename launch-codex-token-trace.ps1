# Launch Codex and Token Trace together, then stop Token Trace when Codex exits.

param(
  [int]$Port = 8766,
  [switch]$NoCodexLaunch
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$stateDir = Join-Path $env:LOCALAPPDATA "ccm-token-spend"
if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }

$launcherLog = Join-Path $stateDir "launcher.log"
$launcherPidFile = Join-Path $stateDir "launcher.pid"
$serverPidFile = Join-Path $stateDir "server.pid"
$panelPidFile = Join-Path $stateDir "floating-panel.pid"
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-LaunchLog {
  param([string]$Message)
  try {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    [System.IO.File]::AppendAllText($launcherLog, $line + [Environment]::NewLine, $utf8)
  } catch {}
}

function Get-CodexAppProcesses {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "ChatGPT.exe" -or ($_.Name -eq "codex.exe" -and $_.ExecutablePath -like "*OpenAI.Codex*")
  }
}

function Start-CodexApp {
  if ($NoCodexLaunch) { return }
  if (Get-CodexAppProcesses | Select-Object -First 1) { return }
  try {
    $app = Get-StartApps | Where-Object { $_.AppID -eq "OpenAI.Codex_2p2nqsd0c76g0!App" } | Select-Object -First 1
    if (-not $app) { $app = Get-StartApps | Where-Object { $_.Name -match "Codex|ChatGPT" } | Select-Object -First 1 }
    if ($app) {
      Start-Process explorer.exe ("shell:AppsFolder\" + $app.AppID)
      Write-LaunchLog ("Codex launched by AppID: " + $app.AppID)
    } else {
      Write-LaunchLog "Codex launch failed: Start menu AppID not found."
    }
  } catch {
    Write-LaunchLog ("Codex launch failed: " + $_.Exception.Message)
  }
}

function Stop-PidFile {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') {
    try {
      Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue
      Write-LaunchLog ($Name + " stopped (PID " + $Matches[1] + ")")
    } catch {}
  }
  Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}

Set-Content -LiteralPath $launcherPidFile -Value $PID -Encoding Ascii
Write-LaunchLog ("launcher started (PID " + $PID + ")")

Start-CodexApp
Start-Sleep -Seconds 1

$start = Join-Path $scriptDir "start-token-trace.ps1"
if (Test-Path -LiteralPath $start) {
  try {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $start -Port $Port | Out-Null
    Write-LaunchLog "Token Trace started."
  } catch {
    Write-LaunchLog ("Token Trace start failed: " + $_.Exception.Message)
  }
} else {
  Write-LaunchLog "start-token-trace.ps1 not found."
}

$waitUntil = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $waitUntil) {
  if (Get-CodexAppProcesses | Select-Object -First 1) { break }
  Start-Sleep -Milliseconds 500
}

while (Get-CodexAppProcesses | Select-Object -First 1) {
  Start-Sleep -Seconds 2
}

Write-LaunchLog "Codex exited; stopping Token Trace."
Stop-PidFile $panelPidFile "floating panel"
Stop-PidFile $serverPidFile "server"
Remove-Item -LiteralPath $launcherPidFile -Force -ErrorAction SilentlyContinue
Write-LaunchLog "launcher exited."
