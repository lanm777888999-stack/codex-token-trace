# Read-only release readiness checks for the public one-command installer.

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$required = @(
  "Install-TokenTrace.ps1", "token-stats.mjs", "dashboard.html", "floating-panel.ps1",
  "guardian.ps1", "install-autostart.ps1", "uninstall-autostart.ps1", "start-token-trace.ps1",
  "assets\token_black_cat.png", "docs\images\dashboard-overview-demo.png", "LICENSE", "SECURITY.md", "THIRD_PARTY_NOTICES.md"
)

foreach ($relative in $required) {
  $path = Join-Path $scriptDir $relative
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing release file: $relative" }
}

foreach ($relative in @("Install-TokenTrace.ps1", "floating-panel.ps1", "guardian.ps1", "install-autostart.ps1", "uninstall-autostart.ps1", "start-token-trace.ps1")) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $scriptDir $relative), [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count) { throw ("PowerShell parse error in " + $relative + ": " + $errors[0].Message) }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & $node.Source --check (Join-Path $scriptDir "token-stats.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Node.js syntax check failed." }
}

$sensitivePath = "C:\Users\LKTX"
$publicFiles = $required | Where-Object { $_ -notmatch '\\.(png)$' }
foreach ($relative in $publicFiles) {
  $matches = Select-String -LiteralPath (Join-Path $scriptDir $relative) -Pattern $sensitivePath -SimpleMatch -ErrorAction SilentlyContinue
  if ($matches) { throw "Personal path found in public release file: $relative" }
}

Write-Host "Public release checks passed." -ForegroundColor Green
