# Switch Token Trace to low-resource launcher mode.
# This removes the logon guardian without deleting local settings, and creates a desktop shortcut.

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$launcher = Join-Path $scriptDir "launch-codex-token-trace.ps1"
if (-not (Test-Path -LiteralPath $launcher)) {
  Write-Host "launch-codex-token-trace.ps1 not found." -ForegroundColor Red
  exit 1
}

$taskName = "ccm-token-spend-guardian"
try {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host ("Scheduled task removed: " + $taskName) -ForegroundColor Green
  } else {
    Write-Host "Scheduled guardian task was not installed." -ForegroundColor Yellow
  }
} catch {
  Write-Host ("Failed to remove scheduled task: " + $_.Exception.Message) -ForegroundColor Yellow
}

$startupLink = Join-Path ([Environment]::GetFolderPath("Startup")) "ccm-token-spend-guardian.lnk"
if (Test-Path -LiteralPath $startupLink) {
  Remove-Item -LiteralPath $startupLink -Force
  Write-Host "Removed legacy Startup shortcut." -ForegroundColor Green
}

$stateDir = Join-Path $env:LOCALAPPDATA "ccm-token-spend"
$guardianPid = Join-Path $stateDir "guardian.pid"
if (Test-Path -LiteralPath $guardianPid) {
  $raw = Get-Content -LiteralPath $guardianPid -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') {
    Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue
    Write-Host ("Guardian stopped: PID " + $Matches[1]) -ForegroundColor Green
  }
  Remove-Item -LiteralPath $guardianPid -Force -ErrorAction SilentlyContinue
}

$psExe = (Get-Command powershell.exe).Source
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Codex + Token Trace.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $psExe
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'
$shortcut.WorkingDirectory = $scriptDir
$shortcut.WindowStyle = 7
$shortcut.Description = "Launch Codex with Token Trace, then stop Token Trace when Codex exits"
$shortcut.Save()

Write-Host ("Launcher shortcut created: " + $shortcutPath) -ForegroundColor Green
Write-Host "Use this shortcut to start Codex with Token Trace. No background guardian will run at logon." -ForegroundColor Green
