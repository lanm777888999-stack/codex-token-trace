param(
  [string]$ServerUrl = "http://127.0.0.1:8766",
  [switch]$SelfTest
)

$ErrorActionPreference = "Continue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

if ($SelfTest) {
  Write-Output "floating-panel.ps1 OK"
  exit 0
}

[System.Windows.Forms.Application]::EnableVisualStyles()

$stateDir = Join-Path $env:LOCALAPPDATA "ccm-token-spend"
if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
$posFile = Join-Path $stateDir "floating-panel-position.json"
$customCoverFile = Join-Path $stateDir "floating-cover.png"
$defaultCoverFile = Join-Path $scriptDir "assets\token_black_cat.png"

function T {
  param([int[]]$Codes)
  return (-join ($Codes | ForEach-Object { [char]$_ }))
}

$txtRecent = T @(0x6700,0x8FD1,0x6D3B,0x52A8,0x4EFB,0x52A1)
$txtTurn = T @(0x672C,0x8F6E)
$txtToday = T @(0x4ECA,0x65E5)
$txtCache = T @(0x7F13,0x5B58)
$txtOpen = T @(0x6253,0x5F00,0x9762,0x677F)
$txtCopy = T @(0x590D,0x5236,0x6570,0x636E,0x5305)
$txtCover = T @(0x66F4,0x6362,0x5C01,0x9762)
$txtNoPlugin = T @(0x65E0,0x9700,0x63D2,0x4EF6)
$txtCopied = T @(0x5DF2,0x590D,0x5236,0x6570,0x636E,0x5305)
$txtCopyFailed = T @(0x590D,0x5236,0x5931,0x8D25)
$txtCoverSaved = T @(0x5C01,0x9762,0x5DF2,0x66F4,0x65B0)
$txtCoverFailed = T @(0x5C01,0x9762,0x66F4,0x65B0,0x5931,0x8D25)
$txtSummary = ""
$txtWaiting = T @(0x7B49,0x5F85,0x672C,0x673A,0x670D,0x52A1)

$ballSize = 64
$expandedW = 340
$expandedH = 172
$script:expanded = $false
$script:lastData = $null
$script:dragging = $false
$script:mouseDown = $null
$script:formStart = $null
$script:moved = $false
$script:coverImage = $null
$script:coverStamp = ""
$script:theme = "dark"

function Format-Short {
  param([double]$Value)
  if ([double]::IsNaN($Value) -or [double]::IsInfinity($Value)) { return "--" }
  if ([math]::Abs($Value) -ge 1000000000) { return ("{0:N2}B" -f ($Value / 1000000000)).Replace(".00", "") }
  if ([math]::Abs($Value) -ge 1000000) { return ("{0:N1}M" -f ($Value / 1000000)).Replace(".0", "") }
  if ([math]::Abs($Value) -ge 1000) { return ("{0:N1}k" -f ($Value / 1000)).Replace(".0", "") }
  return [math]::Round($Value).ToString("N0")
}

function Get-State {
  try { return Invoke-RestMethod -Uri ($ServerUrl.TrimEnd("/") + "/api/state") -Method Get -TimeoutSec 1 } catch { return $null }
}

function Copy-Pack {
  try {
    $pack = Invoke-RestMethod -Uri ($ServerUrl.TrimEnd("/") + "/api/pack") -Method Get -TimeoutSec 2
    if ($pack.text) {
      [System.Windows.Forms.Clipboard]::SetText([string]$pack.text)
      $script:statusLabel.Text = $txtCopied
    }
  } catch {
    $script:statusLabel.Text = $txtCopyFailed
  }
}

function Open-Dashboard {
  try { Start-Process ($ServerUrl.TrimEnd("/") + "/") } catch {}
}

function Load-ImageUnlocked {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $bytes = $null
  $stream = $null
  $image = $null
  try {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $stream = New-Object -TypeName System.IO.MemoryStream -ArgumentList (,$bytes)
    $image = [System.Drawing.Image]::FromStream($stream)
    return New-Object -TypeName System.Drawing.Bitmap -ArgumentList $image
  } catch {
    return $null
  } finally {
    if ($image) { $image.Dispose() }
    if ($stream) { $stream.Dispose() }
  }
}

function Get-CoverPath {
  if (Test-Path -LiteralPath $customCoverFile) { return $customCoverFile }
  if (Test-Path -LiteralPath $defaultCoverFile) { return $defaultCoverFile }
  return $null
}

function Get-CoverStamp {
  $path = Get-CoverPath
  if (-not $path) { return "" }
  try { return $path + "|" + ([System.IO.File]::GetLastWriteTimeUtc($path).Ticks.ToString()) } catch { return $path }
}

function New-FallbackCover {
  $bmp = New-Object -TypeName System.Drawing.Bitmap -ArgumentList 256, 256
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object -TypeName System.Drawing.Rectangle -ArgumentList 0, 0, 256, 256),
    [System.Drawing.Color]::FromArgb(70, 226, 216),
    [System.Drawing.Color]::FromArgb(41, 126, 255),
    45
  )
  $graphics.FillEllipse($brush, 2, 2, 252, 252)
  $font = New-Object System.Drawing.Font("Segoe UI", 92, [System.Drawing.FontStyle]::Bold)
  $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(8, 18, 30))
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object -TypeName System.Drawing.RectangleF -ArgumentList 0, 0, 256, 246
  $graphics.DrawString("T", $font, $textBrush, $rect, $format)
  $format.Dispose()
  $textBrush.Dispose()
  $font.Dispose()
  $brush.Dispose()
  $graphics.Dispose()
  return $bmp
}

function Save-CircularCover {
  param([string]$SourcePath)
  $source = Load-ImageUnlocked $SourcePath
  if (-not $source) { return $false }
  $dest = $null
  $graphics = $null
  $path = $null
  try {
    $size = 256
    $dest = New-Object -TypeName System.Drawing.Bitmap -ArgumentList $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($dest)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $srcSize = [Math]::Min($source.Width, $source.Height)
    $srcX = [int](($source.Width - $srcSize) / 2)
    $srcY = [int](($source.Height - $srcSize) / 2)
    $srcRect = New-Object -TypeName System.Drawing.Rectangle -ArgumentList $srcX, $srcY, $srcSize, $srcSize
    $destRect = New-Object -TypeName System.Drawing.Rectangle -ArgumentList 0, 0, $size, $size

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(0, 0, $size - 1, $size - 1)
    $graphics.SetClip($path)
    $graphics.DrawImage($source, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.ResetClip()

    $dest.Save($customCoverFile, [System.Drawing.Imaging.ImageFormat]::Png)
    return $true
  } catch {
    return $false
  } finally {
    if ($path) { $path.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    if ($dest) { $dest.Dispose() }
    if ($source) { $source.Dispose() }
  }
}

function Refresh-Cover {
  if ($script:coverImage) {
    $script:coverImage.Dispose()
    $script:coverImage = $null
  }
  $path = Get-CoverPath
  if ($path) { $script:coverImage = Load-ImageUnlocked $path }
  if (-not $script:coverImage) { $script:coverImage = New-FallbackCover }
  $script:coverStamp = Get-CoverStamp
  if ($script:ballCanvas) { $script:ballCanvas.Invalidate() }
}

function Draw-Cover {
  param($Graphics)
  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $Graphics.Clear($form.BackColor)

  $margin = 1
  $size = $ballSize - ($margin * 2)
  $rect = New-Object -TypeName System.Drawing.Rectangle -ArgumentList $margin, $margin, $size, $size

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($rect)
  $Graphics.SetClip($path)
  if ($script:coverImage) { $Graphics.DrawImage($script:coverImage, $rect) }
  $Graphics.ResetClip()

  $path.Dispose()
}

function New-RoundedRectPath {
  param([int]$Width, [int]$Height, [int]$Radius)
  $d = [Math]::Max(2, $Radius * 2)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($Width - $d - 1, 0, $d, $d, 270, 90)
  $path.AddArc($Width - $d - 1, $Height - $d - 1, $d, $d, 0, 90)
  $path.AddArc(0, $Height - $d - 1, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Apply-Theme {
  param([string]$Theme)
  $script:theme = if ($Theme -eq "light") { "light" } else { "dark" }
  if ($script:theme -eq "light") {
    $script:panelBg = [System.Drawing.Color]::FromArgb(255, 255, 255)
    $script:textColor = [System.Drawing.Color]::FromArgb(16, 24, 39)
    $script:mutedColor = [System.Drawing.Color]::FromArgb(102, 112, 133)
    $script:secondaryBg = [System.Drawing.Color]::FromArgb(243, 244, 248)
    $script:accentColor = [System.Drawing.Color]::FromArgb(118, 87, 232)
    $script:accentText = [System.Drawing.Color]::White
  } else {
    $script:panelBg = [System.Drawing.Color]::FromArgb(18, 19, 22)
    $script:textColor = [System.Drawing.Color]::FromArgb(242, 240, 234)
    $script:mutedColor = [System.Drawing.Color]::FromArgb(157, 162, 168)
    $script:secondaryBg = [System.Drawing.Color]::FromArgb(31, 34, 39)
    $script:accentColor = [System.Drawing.Color]::FromArgb(48, 213, 200)
    $script:accentText = [System.Drawing.Color]::FromArgb(6, 19, 19)
  }
  if ($form) {
    $form.BackColor = $script:panelBg
    $form.TransparencyKey = [System.Drawing.Color]::Empty
    $form.ForeColor = $script:textColor
    $form.Invalidate()
  }
  foreach ($label in @($titleLabel, $turnLabel)) {
    if ($label) {
      $label.ForeColor = $script:textColor
      $label.BackColor = $script:panelBg
    }
  }
  foreach ($label in @($todayLabel, $cacheLabel, $script:statusLabel)) {
    if ($label) {
      $label.ForeColor = $script:mutedColor
      $label.BackColor = $script:panelBg
    }
  }
  if ($openButton) {
    $openButton.BackColor = $script:secondaryBg
    $openButton.ForeColor = $script:textColor
    $openButton.FlatAppearance.BorderColor = $script:secondaryBg
  }
  if ($copyButton) {
    $copyButton.BackColor = $script:accentColor
    $copyButton.ForeColor = $script:accentText
    $copyButton.FlatAppearance.BorderColor = $script:accentColor
  }
  foreach ($button in @($openButton, $copyButton)) {
    if ($button) { Apply-ButtonShape $button }
  }
  if ($script:ballCanvas) {
    $script:ballCanvas.BackColor = $script:panelBg
    $script:ballCanvas.Invalidate()
  }
}

function Apply-ButtonShape {
  param($Button)
  if (-not $Button) { return }
  $path = New-RoundedRectPath $Button.Width $Button.Height 8
  $Button.Region = New-Object System.Drawing.Region($path)
  $path.Dispose()
}

function Save-Position {
  try {
    $p = @{ x = $form.Location.X; y = $form.Location.Y }
    $p | ConvertTo-Json -Compress | Set-Content -LiteralPath $posFile -Encoding UTF8
  } catch {}
}

function Load-Position {
  try {
    if (Test-Path -LiteralPath $posFile) {
      $p = Get-Content -LiteralPath $posFile -Raw | ConvertFrom-Json
      if ($null -ne $p.x -and $null -ne $p.y) { return New-Object System.Drawing.Point([int]$p.x, [int]$p.y) }
    }
  } catch {}
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  return New-Object System.Drawing.Point(($screen.Right - $ballSize - 18), ($screen.Bottom - $ballSize - 90))
}

function Clamp-To-Screen {
  $screen = [System.Windows.Forms.Screen]::FromPoint($form.Location).WorkingArea
  $x = [math]::Max($screen.Left + 4, [math]::Min($form.Left, $screen.Right - $form.Width - 4))
  $y = [math]::Max($screen.Top + 4, [math]::Min($form.Top, $screen.Bottom - $form.Height - 4))
  $form.Location = New-Object System.Drawing.Point([int]$x, [int]$y)
}

function Apply-Shape {
  if ($script:expanded) {
    $form.Region = $null
    return
  }
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse(0, 0, $form.Width, $form.Height)
  $form.Region = New-Object System.Drawing.Region($path)
  $path.Dispose()
}

function Set-Expanded {
  param([bool]$Value)
  $script:expanded = $Value
  $form.SuspendLayout()
  if ($Value) {
    $form.Width = $expandedW
    $form.Height = $expandedH
  } else {
    $form.Width = $ballSize
    $form.Height = $ballSize
  }
  if ($Value) {
    $form.BackColor = $script:panelBg
  } else {
    $form.BackColor = $script:panelBg
  }
  $script:ballCanvas.Visible = -not $Value
  foreach ($control in @($titleLabel, $turnLabel, $todayLabel, $cacheLabel, $openButton, $copyButton, $script:statusLabel)) {
    $control.Visible = $Value
    $control.BringToFront()
  }
  $form.ResumeLayout()
  Clamp-To-Screen
  Apply-Shape
  Save-Position
}

function Toggle-Expanded {
  Set-Expanded (-not $script:expanded)
}

function Update-DataLabels {
  if (-not $script:lastData) { return }
  $turn = 0
  if ($script:lastData.turns -and $script:lastData.turns.Count -gt 0) {
    $turn = [double]$script:lastData.turns[$script:lastData.turns.Count - 1].total
  }
  $daily = $script:lastData.daily
  $turnLabel.Text = Format-Short $turn
  $todayTotal = 0
  if ($daily -and $daily.total) { $todayTotal = [double]$daily.total }
  $todayLabel.Text = $txtToday + " " + (Format-Short $todayTotal)
  $rate = "--"
  if ($daily.input -and [double]$daily.input -gt 0) {
    $rate = ([math]::Round(([double]$daily.cached / [double]$daily.input) * 100)).ToString() + "%"
  }
  $cacheLabel.Text = $txtCache + " " + $rate
}

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 19, 22)
$form.ForeColor = [System.Drawing.Color]::FromArgb(242, 240, 234)
$form.Opacity = 0.98
$form.Width = $ballSize
$form.Height = $ballSize
$form.Location = Load-Position
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

$script:panelBg = [System.Drawing.Color]::FromArgb(18, 19, 22)
$script:textColor = [System.Drawing.Color]::FromArgb(242, 240, 234)
$script:mutedColor = [System.Drawing.Color]::FromArgb(157, 162, 168)
$script:secondaryBg = [System.Drawing.Color]::FromArgb(31, 34, 39)
$script:accentColor = [System.Drawing.Color]::FromArgb(48, 213, 200)
$script:accentText = [System.Drawing.Color]::FromArgb(6, 19, 19)

$script:ballCanvas = New-Object System.Windows.Forms.Panel
$script:ballCanvas.BackColor = $form.BackColor
$script:ballCanvas.Dock = [System.Windows.Forms.DockStyle]::Fill
$script:ballCanvas.Cursor = [System.Windows.Forms.Cursors]::Hand
$script:ballCanvas.Add_Paint({ Draw-Cover $_.Graphics })
$form.Controls.Add($script:ballCanvas)
Refresh-Cover

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = $txtRecent
$titleLabel.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9, [System.Drawing.FontStyle]::Bold)
$titleLabel.Location = New-Object System.Drawing.Point(18, 16)
$titleLabel.Size = New-Object System.Drawing.Size(270, 20)
$titleLabel.Visible = $false
$form.Controls.Add($titleLabel)

$turnLabel = New-Object System.Windows.Forms.Label
$turnLabel.Text = $txtTurn + " --"
$turnLabel.Font = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
$turnLabel.Location = New-Object System.Drawing.Point(18, 42)
$turnLabel.Size = New-Object System.Drawing.Size(176, 42)
$turnLabel.Visible = $false
$form.Controls.Add($turnLabel)

$todayLabel = New-Object System.Windows.Forms.Label
$todayLabel.Text = $txtToday + " --"
$todayLabel.ForeColor = $script:mutedColor
$todayLabel.Location = New-Object System.Drawing.Point(20, 88)
$todayLabel.Size = New-Object System.Drawing.Size(130, 20)
$todayLabel.Visible = $false
$form.Controls.Add($todayLabel)

$cacheLabel = New-Object System.Windows.Forms.Label
$cacheLabel.Text = $txtCache + " --"
$cacheLabel.ForeColor = $script:mutedColor
$cacheLabel.Location = New-Object System.Drawing.Point(154, 88)
$cacheLabel.Size = New-Object System.Drawing.Size(130, 20)
$cacheLabel.Visible = $false
$form.Controls.Add($cacheLabel)

$openButton = New-Object System.Windows.Forms.Button
$openButton.Text = $txtOpen
$openButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$openButton.FlatAppearance.BorderColor = $script:secondaryBg
$openButton.BackColor = $script:secondaryBg
$openButton.ForeColor = [System.Drawing.Color]::White
$openButton.Location = New-Object System.Drawing.Point(20, 120)
$openButton.Size = New-Object System.Drawing.Size(126, 34)
$openButton.Visible = $false
$openButton.Add_Click({ Open-Dashboard })
$form.Controls.Add($openButton)

$copyButton = New-Object System.Windows.Forms.Button
$copyButton.Text = $txtCopy
$copyButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$copyButton.FlatAppearance.BorderColor = $script:accentColor
$copyButton.BackColor = $script:accentColor
$copyButton.ForeColor = $script:accentText
$copyButton.Location = New-Object System.Drawing.Point(156, 120)
$copyButton.Size = New-Object System.Drawing.Size(126, 34)
$copyButton.Visible = $false
$copyButton.Add_Click({ Copy-Pack })
$form.Controls.Add($copyButton)

$script:statusLabel = New-Object System.Windows.Forms.Label
$script:statusLabel.Text = $txtNoPlugin
$script:statusLabel.ForeColor = $script:mutedColor
$script:statusLabel.Location = New-Object System.Drawing.Point(21, 156)
$script:statusLabel.Size = New-Object System.Drawing.Size(260, 18)
$script:statusLabel.Visible = $false
$form.Controls.Add($script:statusLabel)

function Begin-Drag {
  param($Sender, $Event)
  if ($Event.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
  $script:dragging = $true
  $script:moved = $false
  $script:mouseDown = [System.Windows.Forms.Cursor]::Position
  $script:formStart = $form.Location
}

function Move-Drag {
  param($Sender, $Event)
  if (-not $script:dragging) { return }
  $pos = [System.Windows.Forms.Cursor]::Position
  $dx = $pos.X - $script:mouseDown.X
  $dy = $pos.Y - $script:mouseDown.Y
  if ([math]::Abs($dx) + [math]::Abs($dy) -gt 3) { $script:moved = $true }
  $form.Location = New-Object System.Drawing.Point(($script:formStart.X + $dx), ($script:formStart.Y + $dy))
  Clamp-To-Screen
}

function End-Drag {
  param($Sender, $Event)
  if (-not $script:dragging) { return }
  $script:dragging = $false
  Save-Position
  if (-not $script:moved -and -not ($Sender -is [System.Windows.Forms.Button])) { Toggle-Expanded }
}

foreach ($control in @($form, $script:ballCanvas, $titleLabel, $turnLabel, $todayLabel, $cacheLabel, $script:statusLabel)) {
  $control.Add_MouseDown({ Begin-Drag $this $_ })
  $control.Add_MouseMove({ Move-Drag $this $_ })
  $control.Add_MouseUp({ End-Drag $this $_ })
}

Apply-Theme $script:theme

$dataTimer = New-Object System.Windows.Forms.Timer
$dataTimer.Interval = 1000
$dataTimer.Add_Tick({
  if ((Get-CoverStamp) -ne $script:coverStamp) { Refresh-Cover }
  $data = Get-State
  if ($data) {
    $script:lastData = $data
    Apply-Theme $data.theme
    Update-DataLabels
    $script:statusLabel.Text = $txtSummary
  } else {
    $script:statusLabel.Text = $txtWaiting
  }
})
$dataTimer.Start()

Apply-Shape
[System.Windows.Forms.Application]::Run($form)
