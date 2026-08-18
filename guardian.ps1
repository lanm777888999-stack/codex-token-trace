# ccm-token-spend WMI guardian
# Uses Windows process start/stop events instead of polling. It starts Token Trace
# whenever Codex / ChatGPT starts, and stops it only after every Codex process exits.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File guardian.ps1

$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$stateDir = Join-Path $env:LOCALAPPDATA "ccm-token-spend"
if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }

$guardianLog = Join-Path $stateDir "guardian.log"
$serverLog = Join-Path $stateDir "server.log"
$serverPidFile = Join-Path $stateDir "server.pid"
$panelPidFile = Join-Path $stateDir "floating-panel.pid"
$guardianPidFile = Join-Path $stateDir "guardian.pid"
$lockFile = Join-Path $stateDir "guardian.lock"
$serverPort = 8766
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Log {
  param([string]$Message)
  try {
    $item = Get-Item -LiteralPath $guardianLog -ErrorAction SilentlyContinue
    if ($item -and $item.Length -gt 512KB) {
      Move-Item -LiteralPath $guardianLog -Destination ($guardianLog + ".old") -Force -ErrorAction SilentlyContinue
    }
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    [System.IO.File]::AppendAllText($guardianLog, $line + [Environment]::NewLine, $utf8)
  } catch {}
}

$global:guardianLock = $null
try {
  $global:guardianLock = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
  Write-Log "guardian already running; exit."
  exit 0
}

Set-Content -LiteralPath $guardianPidFile -Value $PID -Encoding Ascii
Write-Log ("WMI guardian started (PID " + $PID + "), dir: " + $scriptDir)

function Get-CodexAppProcesses {
  # The desktop app has used both ChatGPT.exe and codex.exe across releases.
  Get-Process -Name "chatgpt", "codex" -ErrorAction SilentlyContinue
}

function Resolve-ServerCommand {
  $bundledNode = Join-Path $scriptDir "runtime\node.exe"
  $nodePath = $null
  if (Test-Path -LiteralPath $bundledNode) {
    $nodePath = $bundledNode
  } else {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) { $nodePath = $node.Source }
  }
  if ($nodePath) {
    $stats = Join-Path $scriptDir "token-stats.mjs"
    if (-not (Test-Path -LiteralPath $stats)) { $stats = Join-Path $scriptDir "node-version\token-stats.mjs" }
    if (Test-Path -LiteralPath $stats) {
      return @{ File = $nodePath; Args = @('"' + $stats + '"', '--server', '--port', [string]$serverPort) }
    }
  }
  $exe = Join-Path $scriptDir "ccm-token-spend.exe"
  if (-not (Test-Path -LiteralPath $exe)) { $exe = Join-Path $scriptDir "exe-version\ccm-token-spend.exe" }
  if (Test-Path -LiteralPath $exe) {
    return @{ File = $exe; Args = @('--server', '--port', [string]$serverPort) }
  }
  return $null
}

function Test-PidFileRunning {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
  if ($raw -notmatch '^\s*\d+\s*$') { return $false }
  return $null -ne (Get-Process -Id ([int]$raw.Trim()) -ErrorAction SilentlyContinue)
}

function Start-Server {
  $cmd = Resolve-ServerCommand
  if (-not $cmd) {
    Write-Log "server start failed: token-stats.mjs or ccm-token-spend.exe not found."
    return
  }
  try {
    $p = Start-Process -FilePath $cmd.File -ArgumentList $cmd.Args -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError ($serverLog + ".err") -PassThru
    if ($p) {
      Set-Content -LiteralPath $serverPidFile -Value $p.Id -Encoding Ascii
      Write-Log ("server started (PID " + $p.Id + "), port " + $serverPort)
    }
  } catch {
    Write-Log ("server start failed: " + $_.Exception.Message)
  }
}

function Start-FloatingPanel {
  $panel = Join-Path $scriptDir "floating-panel.ps1"
  if (-not (Test-Path -LiteralPath $panel)) {
    Write-Log "floating panel not found."
    return
  }
  try {
    $psExe = (Get-Command powershell.exe).Source
    $args = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $panel + '" -ServerUrl "http://127.0.0.1:' + $serverPort + '"'
    $p = Start-Process -FilePath $psExe -ArgumentList $args -WindowStyle Hidden -PassThru
    if ($p) {
      Set-Content -LiteralPath $panelPidFile -Value $p.Id -Encoding Ascii
      Write-Log ("floating panel started (PID " + $p.Id + ")")
    }
  } catch {
    Write-Log ("floating panel start failed: " + $_.Exception.Message)
  }
}

function Stop-ByPidFile {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') {
    try {
      Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue
      Write-Log ($Name + " stopped (PID " + $Matches[1] + ")")
    } catch {
      Write-Log ($Name + " stop failed: " + $_.Exception.Message)
    }
  }
  Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}

function Ensure-TokenTraceRunning {
  if (-not (Test-PidFileRunning $serverPidFile)) { Start-Server }
  if (-not (Test-PidFileRunning $panelPidFile)) { Start-FloatingPanel }
}

function Stop-TokenTraceIfCodexClosed {
  # A single exit event is not enough: multiple Codex windows/processes may exist.
  if (Get-CodexAppProcesses | Select-Object -First 1) { return }
  if (Test-PidFileRunning $panelPidFile) { Stop-ByPidFile $panelPidFile "floating panel" }
  if (Test-PidFileRunning $serverPidFile) { Stop-ByPidFile $serverPidFile "server" }
}

$eventMode = $null
try {
  $startQuery = "SELECT * FROM Win32_ProcessStartTrace WHERE ProcessName = 'ChatGPT.exe' OR ProcessName = 'codex.exe'"
  $stopQuery = "SELECT * FROM Win32_ProcessStopTrace WHERE ProcessName = 'ChatGPT.exe' OR ProcessName = 'codex.exe'"
  try {
    Register-WmiEvent -Query $startQuery -SourceIdentifier "TokenTrace.CodexStarted" -ErrorAction Stop | Out-Null
    Register-WmiEvent -Query $stopQuery -SourceIdentifier "TokenTrace.CodexStopped" -ErrorAction Stop | Out-Null
    $eventMode = "trace"
    Write-Log "WMI process trace subscriptions registered; no polling loop is running."
  } catch {
    # Some locked-down Windows builds deny Win32_Process*Trace to a normal user.
    # Keep the same event-driven script behavior through WMI instance events instead.
    Unregister-Event -SourceIdentifier "TokenTrace.CodexStarted" -ErrorAction SilentlyContinue
    Unregister-Event -SourceIdentifier "TokenTrace.CodexStopped" -ErrorAction SilentlyContinue
    Write-Log ("WMI trace events unavailable (" + $_.Exception.Message + "); use WMI instance event fallback.")

    $startInstance = "SELECT * FROM __InstanceCreationEvent WITHIN 1 WHERE TargetInstance ISA 'Win32_Process' AND (TargetInstance.Name = 'ChatGPT.exe' OR TargetInstance.Name = 'codex.exe')"
    $stopInstance = "SELECT * FROM __InstanceDeletionEvent WITHIN 1 WHERE TargetInstance ISA 'Win32_Process' AND (TargetInstance.Name = 'ChatGPT.exe' OR TargetInstance.Name = 'codex.exe')"
    Register-WmiEvent -Namespace "root\cimv2" -Query $startInstance -SourceIdentifier "TokenTrace.CodexStarted" -ErrorAction Stop | Out-Null
    Register-WmiEvent -Namespace "root\cimv2" -Query $stopInstance -SourceIdentifier "TokenTrace.CodexStopped" -ErrorAction Stop | Out-Null
    $eventMode = "instance"
    Write-Log "WMI instance event subscriptions registered; no PowerShell polling loop is running."
  }

  # Covers the case where Codex was already open when Windows logon triggered the guardian.
  if (Get-CodexAppProcesses | Select-Object -First 1) {
    Write-Log "Codex already running at guardian startup; start Token Trace."
    Ensure-TokenTraceRunning
  }

  while ($true) {
    # Wait-Event sleeps without a timer loop until Windows delivers one of the two filtered events.
    $event = Wait-Event -Timeout 86400
    if (-not $event) { continue }

    try {
      if ($event.SourceIdentifier -eq "TokenTrace.CodexStarted") {
        Write-Log "Codex start event received; start Token Trace."
        Ensure-TokenTraceRunning
      } elseif ($event.SourceIdentifier -eq "TokenTrace.CodexStopped") {
        Write-Log "Codex stop event received; confirm all Codex processes are closed."
        Stop-TokenTraceIfCodexClosed
      }
    } catch {
      Write-Log ("WMI event handler error: " + $_.Exception.Message)
    } finally {
      Remove-Event -EventIdentifier $event.EventIdentifier -ErrorAction SilentlyContinue
    }
  }
} catch {
  Write-Log ("WMI guardian setup failed: " + $_.Exception.Message)
} finally {
  Unregister-Event -SourceIdentifier "TokenTrace.CodexStarted" -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier "TokenTrace.CodexStopped" -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $guardianPidFile -Force -ErrorAction SilentlyContinue
  if ($global:guardianLock) { $global:guardianLock.Dispose() }
  Write-Log "WMI guardian exited."
}
