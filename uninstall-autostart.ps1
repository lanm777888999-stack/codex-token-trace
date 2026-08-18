# Uninstall the Token Trace WMI guardian and stop only its running processes.
# Local preferences, prices, theme and floating-cover image are deliberately preserved.

$ErrorActionPreference = "Continue"
$taskName = "ccm-token-spend-guardian"

try {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host ("Scheduled task removed: " + $taskName) -ForegroundColor Green
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
foreach ($name in @("guardian.pid", "server.pid", "floating-panel.pid", "monitor.pid")) {
  $pidFile = Join-Path $stateDir $name
  if (-not (Test-Path -LiteralPath $pidFile)) { continue }
  $raw = Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') {
    Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Write-Host "WMI guardian removed. Token Trace processes stopped; local theme, prices and cover were kept." -ForegroundColor Green
