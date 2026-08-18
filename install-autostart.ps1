# Install the Token Trace WMI event guardian as a Windows logon scheduled task.

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$guardian = Join-Path $scriptDir "guardian.ps1"
if (-not (Test-Path -LiteralPath $guardian)) {
  Write-Host "guardian.ps1 not found." -ForegroundColor Red
  exit 1
}

$psExe = (Get-Command powershell.exe).Source
$guardianArgs = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $guardian + '"'
$taskName = "ccm-token-spend-guardian"

try {
  $action = New-ScheduledTaskAction -Execute $psExe -Argument $guardianArgs
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Token Trace WMI guardian: reacts to Codex process start/stop events without polling" -Force | Out-Null
  Write-Host ("Scheduled task registered: " + $taskName) -ForegroundColor Green
} catch {
  Write-Host ("Failed to register scheduled task: " + $_.Exception.Message) -ForegroundColor Red
  exit 1
}

$stateDir = Join-Path $env:LOCALAPPDATA "ccm-token-spend"
if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }

# This mode replaces the optional launcher mode. Stop its waiter so it cannot
# duplicate the lifecycle work or keep its old compatibility wait loop alive.
$launcherPid = Join-Path $stateDir "launcher.pid"
if (Test-Path -LiteralPath $launcherPid) {
  $rawLauncher = Get-Content -LiteralPath $launcherPid -Raw -ErrorAction SilentlyContinue
  if ($rawLauncher -match '^\s*(\d+)\s*$') {
    Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue
    Write-Host ("Previous launcher stopped: PID " + $Matches[1]) -ForegroundColor Green
  }
  Remove-Item -LiteralPath $launcherPid -Force -ErrorAction SilentlyContinue
}
$launcherShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Codex + Token Trace.lnk"
if (Test-Path -LiteralPath $launcherShortcut) {
  Remove-Item -LiteralPath $launcherShortcut -Force -ErrorAction SilentlyContinue
  Write-Host "Removed launcher-mode shortcut; WMI guardian now works from every Codex entry." -ForegroundColor Green
}

$guardianPid = Join-Path $stateDir "guardian.pid"
$guardianRunning = $false
if (Test-Path -LiteralPath $guardianPid) {
  $raw = Get-Content -LiteralPath $guardianPid -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') {
    $guardianRunning = $null -ne (Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue)
  }
}

if (-not $guardianRunning) {
  Start-Process -FilePath $psExe -ArgumentList $guardianArgs -WindowStyle Hidden
  Start-Sleep -Milliseconds 500
  Write-Host "WMI guardian started." -ForegroundColor Green
} else {
  Write-Host "WMI guardian is already running." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Token Trace WMI guardian is installed." -ForegroundColor Green
Write-Host "It waits for Windows Codex/ChatGPT process events; no 2-second polling is used."
Write-Host "When every Codex window closes, Token Trace stops too."
Write-Host "Dashboard: http://127.0.0.1:8766"
Write-Host "Logs: %LOCALAPPDATA%\ccm-token-spend\guardian.log and server.log"
Write-Host "Uninstall: .\uninstall-autostart.ps1"
