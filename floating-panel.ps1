param(
  [string]$ServerUrl = "http://127.0.0.1:8766",
  [switch]$SelfTest
)

$ErrorActionPreference = "Continue"

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Xaml
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if ($SelfTest) {
  if (-not ("System.Windows.Window" -as [type])) { throw "WPF is unavailable." }
  Write-Output "floating-panel.ps1 OK"
  exit 0
}

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne [System.Threading.ApartmentState]::STA) {
  throw "Token Trace floating panel requires an STA PowerShell process."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
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
$txtToday = T @(0x4ECA,0x65E5)
$txtCache = T @(0x7F13,0x5B58)
$txtOpen = T @(0x6253,0x5F00,0x9762,0x677F)
$txtCopy = T @(0x590D,0x5236,0x6570,0x636E,0x5305)
$txtCopied = T @(0x5DF2,0x590D,0x5236)
$txtWaiting = T @(0x7B49,0x5F85,0x6570,0x636E)
$txtDockTip = T @(0x6536,0x8FDB,0x4FA7,0x8FB9)
$txtRevealTip = T @(0x5C55,0x5F00,0x60AC,0x6D6E,0x7403)
$txtChevronLeft = T @(0x2039)
$txtChevronRight = T @(0x203A)

$ballSize = 72.0
$ballDiameter = 62.0
$dockTabWidth = 30.0
$dockHandleWidth = 36.0
$dockHandleHeight = 52.0
$panelWidth = 332.0
$panelHeight = 194.0
$panelGap = 10.0
$dockThreshold = 42.0

$script:theme = "dark"
$script:lastData = $null
$script:coverStamp = ""
$script:dockSide = ""
$script:tucked = $false
$script:dragging = $false
$script:moved = $false
$script:panelSide = "left"

function New-Brush {
  param([string]$Color)
  return (New-Object System.Windows.Media.BrushConverter).ConvertFromString($Color)
}

function New-CornerRadius {
  param([double]$Value)
  return New-Object System.Windows.CornerRadius($Value)
}

function New-Thickness {
  param([double]$Left, [double]$Top = $Left, [double]$Right = $Left, [double]$Bottom = $Top)
  return New-Object System.Windows.Thickness($Left, $Top, $Right, $Bottom)
}

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

function Open-Dashboard {
  try { Start-Process ($ServerUrl.TrimEnd("/") + "/") } catch {}
}

function Copy-Pack {
  try {
    $pack = Invoke-RestMethod -Uri ($ServerUrl.TrimEnd("/") + "/api/pack") -Method Get -TimeoutSec 2
    if ($pack.text) {
      [System.Windows.Clipboard]::SetText([string]$pack.text)
      $script:copyText.Text = $txtCopied
      $script:copyFeedbackTimer.Stop()
      $script:copyFeedbackTimer.Start()
    }
  } catch {}
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

function New-BitmapImage {
  param([string]$Path)
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $null }
  $stream = $null
  try {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $stream = New-Object -TypeName System.IO.MemoryStream -ArgumentList (,$bytes)
    $bitmap = New-Object System.Windows.Media.Imaging.BitmapImage
    $bitmap.BeginInit()
    $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $bitmap.StreamSource = $stream
    $bitmap.EndInit()
    $bitmap.Freeze()
    return $bitmap
  } catch {
    return $null
  } finally {
    if ($stream) { $stream.Dispose() }
  }
}

function Refresh-Cover {
  $bitmap = New-BitmapImage (Get-CoverPath)
  if ($bitmap) {
    $brush = New-Object System.Windows.Media.ImageBrush($bitmap)
    $brush.Stretch = [System.Windows.Media.Stretch]::UniformToFill
    $brush.AlignmentX = [System.Windows.Media.AlignmentX]::Center
    $brush.AlignmentY = [System.Windows.Media.AlignmentY]::Center
    $script:coverEllipse.Fill = $brush
    [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($script:coverEllipse, [System.Windows.Media.BitmapScalingMode]::HighQuality)
  } else {
    $script:coverEllipse.Fill = New-Brush "#30D5C8"
  }
  $script:coverStamp = Get-CoverStamp
}

function Get-ScreenDipForBall {
  try {
    $windowWidth = if ($script:ballWindow.ActualWidth -gt 0) { $script:ballWindow.ActualWidth } else { $script:ballWindow.Width }
    $windowHeight = if ($script:ballWindow.ActualHeight -gt 0) { $script:ballWindow.ActualHeight } else { $script:ballWindow.Height }
    $centerPx = $script:ballWindow.PointToScreen([System.Windows.Point]::new([double]($windowWidth / 2), [double]($windowHeight / 2)))
    $screen = [System.Windows.Forms.Screen]::FromPoint((New-Object System.Drawing.Point([int]$centerPx.X, [int]$centerPx.Y)))
    $area = $screen.WorkingArea
    $source = [System.Windows.PresentationSource]::FromVisual($script:ballWindow)
    if ($source -and $source.CompositionTarget) {
      $fromDevice = $source.CompositionTarget.TransformFromDevice
      $topLeft = $fromDevice.Transform([System.Windows.Point]::new([double]$area.Left, [double]$area.Top))
      $bottomRight = $fromDevice.Transform([System.Windows.Point]::new([double]$area.Right, [double]$area.Bottom))
      return [pscustomobject]@{
        Left = $topLeft.X
        Top = $topLeft.Y
        Right = $bottomRight.X
        Bottom = $bottomRight.Y
        Width = $bottomRight.X - $topLeft.X
        Height = $bottomRight.Y - $topLeft.Y
      }
    }
  } catch {}
  $fallback = [System.Windows.SystemParameters]::WorkArea
  return [pscustomobject]@{ Left = $fallback.Left; Top = $fallback.Top; Right = $fallback.Right; Bottom = $fallback.Bottom; Width = $fallback.Width; Height = $fallback.Height }
}

function Save-Position {
  try {
    @{
      x = [math]::Round($script:ballWindow.Left, 2)
      y = [math]::Round($script:ballWindow.Top, 2)
      dockSide = $script:dockSide
      tucked = $script:tucked
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath $posFile -Encoding UTF8
  } catch {}
}

function Load-Position {
  $screen = [System.Windows.SystemParameters]::WorkArea
  $fallback = [pscustomobject]@{
    x = $screen.Right - $ballSize - 18
    y = $screen.Bottom - $ballSize - 90
    dockSide = ""
    tucked = $false
  }
  try {
    if (Test-Path -LiteralPath $posFile) {
      $value = Get-Content -LiteralPath $posFile -Raw | ConvertFrom-Json
      if ($null -ne $value.x -and $null -ne $value.y) {
        return [pscustomobject]@{
          x = [double]$value.x
          y = [double]$value.y
          dockSide = if ($value.dockSide -in @("left", "right")) { [string]$value.dockSide } else { "" }
          tucked = [bool]$value.tucked
        }
      }
    }
  } catch {}
  return $fallback
}

function Clamp-BallToScreen {
  $screen = Get-ScreenDipForBall
  $script:ballWindow.Top = [math]::Max($screen.Top + 4, [math]::Min($script:ballWindow.Top, $screen.Bottom - $ballSize - 4))
  if (-not $script:dockSide) {
    $script:ballWindow.Left = [math]::Max($screen.Left + 4, [math]::Min($script:ballWindow.Left, $screen.Right - $ballSize - 4))
  }
}

function Apply-DockVisual {
  $screen = Get-ScreenDipForBall
  if (-not $script:dockSide) {
    $script:tucked = $false
    $script:ballWindow.Width = $ballSize
    $script:ballWindow.Height = $ballSize
    $script:ballRoot.Clip = $script:ballClip
    $script:ringEllipse.Visibility = [System.Windows.Visibility]::Visible
    $script:coverEllipse.Visibility = [System.Windows.Visibility]::Visible
    $script:dockButton.Visibility = [System.Windows.Visibility]::Collapsed
    Clamp-BallToScreen
    return
  }

  $script:dockButton.Visibility = [System.Windows.Visibility]::Visible
  if ($script:tucked) {
    Hide-Panel
    $script:ballWindow.Width = $dockHandleWidth
    $script:ballWindow.Height = $dockHandleHeight
    $script:ballRoot.Clip = $null
    $script:ringEllipse.Visibility = [System.Windows.Visibility]::Collapsed
    $script:coverEllipse.Visibility = [System.Windows.Visibility]::Collapsed
    $script:dockButton.Width = $dockHandleWidth
    $script:dockButton.Height = $dockHandleHeight
    $script:dockButton.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Stretch
    $script:dockButton.VerticalAlignment = [System.Windows.VerticalAlignment]::Stretch
    $script:dockButton.ToolTip = $txtRevealTip
    if ($script:dockSide -eq "left") {
      $script:dockButton.CornerRadius = [System.Windows.CornerRadius]::new(0, 18, 18, 0)
      $script:dockGlyph.Text = $txtChevronRight
      $script:ballWindow.Left = $screen.Left
    } else {
      $script:dockButton.CornerRadius = [System.Windows.CornerRadius]::new(18, 0, 0, 18)
      $script:dockGlyph.Text = $txtChevronLeft
      $script:ballWindow.Left = $screen.Right - $dockHandleWidth
    }
    $script:ballWindow.Top = [math]::Max($screen.Top + 4, [math]::Min($script:ballWindow.Top, $screen.Bottom - $dockHandleHeight - 4))
    return
  }

  $script:ballWindow.Width = $ballSize
  $script:ballWindow.Height = $ballSize
  $script:ballRoot.Clip = $script:ballClip
  $script:ringEllipse.Visibility = [System.Windows.Visibility]::Visible
  $script:coverEllipse.Visibility = [System.Windows.Visibility]::Visible
  $script:dockButton.Width = $dockTabWidth
  $script:dockButton.Height = 36
  $script:dockButton.CornerRadius = New-CornerRadius 14
  $script:dockButton.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  $script:dockButton.ToolTip = $txtDockTip
  if ($script:dockSide -eq "left") {
    $script:dockButton.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
    $script:dockGlyph.Text = $txtChevronLeft
    $script:ballWindow.Left = $screen.Left + 4
  } else {
    $script:dockButton.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
    $script:dockGlyph.Text = $txtChevronRight
    $script:ballWindow.Left = $screen.Right - $ballSize - 4
  }
  $script:ballWindow.Top = [math]::Max($screen.Top + 4, [math]::Min($script:ballWindow.Top, $screen.Bottom - $ballSize - 4))
}

function Apply-Theme {
  param([string]$Theme)
  $next = if ($Theme -eq "light") { "light" } else { "dark" }
  if ($script:theme -eq $next -and $script:themeReady) { return }
  $script:theme = $next
  if ($next -eq "light") {
    $card = "#FFFFFF"
    $text = "#121826"
    $muted = "#687287"
    $secondary = "#F2F0F8"
    $secondaryHover = "#E9E5F5"
    $accent = "#7657E8"
    $accentHover = "#6949DA"
    $accentText = "#FFFFFF"
    $border = "#E3E6EC"
    $ring = "#FFFFFF"
  } else {
    $card = "#121316"
    $text = "#F4F2ED"
    $muted = "#9DA3AC"
    $secondary = "#202329"
    $secondaryHover = "#2A2E35"
    $accent = "#30D5C8"
    $accentHover = "#50E0D5"
    $accentText = "#071A19"
    $border = "#30343A"
    $ring = "#17191D"
  }

  $script:cardBorder.Background = New-Brush $card
  $script:cardBorder.BorderBrush = New-Brush $border
  $script:titleText.Foreground = New-Brush $text
  $script:turnText.Foreground = New-Brush $text
  $script:todayText.Foreground = New-Brush $muted
  $script:cacheText.Foreground = New-Brush $muted
  $script:openAction.Background = New-Brush $secondary
  $script:openText.Foreground = New-Brush $text
  $script:copyAction.Background = New-Brush $accent
  $script:copyText.Foreground = New-Brush $accentText
  $script:dockButton.Background = New-Brush $card
  $script:dockButton.BorderBrush = New-Brush $border
  $script:dockGlyph.Foreground = New-Brush $text
  $script:ringEllipse.Fill = New-Brush $ring
  $script:ringEllipse.Stroke = New-Brush $border

  $script:secondaryBrush = New-Brush $secondary
  $script:secondaryHoverBrush = New-Brush $secondaryHover
  $script:accentBrush = New-Brush $accent
  $script:accentHoverBrush = New-Brush $accentHover
  $script:themeReady = $true
}

function Update-DataLabels {
  if (-not $script:lastData) {
    $script:turnText.Text = "--"
    $script:todayText.Text = $txtWaiting
    $script:cacheText.Text = ""
    return
  }
  $turn = 0
  if ($script:lastData.turns -and $script:lastData.turns.Count -gt 0) {
    $turn = [double]$script:lastData.turns[$script:lastData.turns.Count - 1].total
  }
  $daily = $script:lastData.daily
  $todayTotal = if ($daily -and $daily.total) { [double]$daily.total } else { 0 }
  $rate = "--"
  if ($daily -and $daily.input -and [double]$daily.input -gt 0) {
    $rate = ([math]::Round(([double]$daily.cached / [double]$daily.input) * 100)).ToString() + "%"
  }
  $script:turnText.Text = Format-Short $turn
  $script:todayText.Text = $txtToday + "  " + (Format-Short $todayTotal)
  $script:cacheText.Text = $txtCache + "  " + $rate
}

function Position-Panel {
  $screen = Get-ScreenDipForBall
  $spaceRight = $screen.Right - ($script:ballWindow.Left + $ballSize)
  $openRight = $script:dockSide -eq "left" -or ($script:dockSide -ne "right" -and $spaceRight -ge ($panelWidth + $panelGap))
  if ($openRight) {
    $script:panelWindow.Left = $script:ballWindow.Left + $ballSize + $panelGap
    $script:panelSide = "right"
  } else {
    $script:panelWindow.Left = $script:ballWindow.Left - $panelWidth - $panelGap
    $script:panelSide = "left"
  }
  $idealTop = $script:ballWindow.Top - (($panelHeight - $ballSize) / 2)
  $script:panelWindow.Top = [math]::Max($screen.Top + 4, [math]::Min($idealTop, $screen.Bottom - $panelHeight - 4))
}

function Show-Panel {
  if ($script:tucked -or $script:dragging) { return }
  $script:closeTimer.Stop()
  Position-Panel
  if ($script:panelWindow.IsVisible) { return }
  $script:panelWindow.Opacity = 0
  $offset = if ($script:panelSide -eq "right") { -8.0 } else { 8.0 }
  $translate = New-Object System.Windows.Media.TranslateTransform($offset, 0)
  $script:cardBorder.RenderTransform = $translate
  $script:panelWindow.Show()
  $fade = New-Object System.Windows.Media.Animation.DoubleAnimation(0, 1, (New-Object System.Windows.Duration([TimeSpan]::FromMilliseconds(130))))
  $slide = New-Object System.Windows.Media.Animation.DoubleAnimation($offset, 0, (New-Object System.Windows.Duration([TimeSpan]::FromMilliseconds(150))))
  $script:panelWindow.BeginAnimation([System.Windows.Window]::OpacityProperty, $fade)
  $translate.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $slide)
}

function Hide-Panel {
  $script:closeTimer.Stop()
  if ($script:panelWindow.IsVisible) { $script:panelWindow.Hide() }
}

function Schedule-PanelClose {
  $script:closeTimer.Stop()
  $script:closeTimer.Start()
}

function Test-CursorInsideWindow {
  param([System.Windows.Window]$Window)
  if (-not $Window -or -not $Window.IsVisible) { return $false }
  try {
    $cursor = [System.Windows.Forms.Cursor]::Position
    # PowerShell-hosted WPF windows normally use the same virtualized desktop
    # coordinates as Cursor.Position. Prefer that direct check first.
    if ($cursor.X -ge $Window.Left -and $cursor.Y -ge $Window.Top -and $cursor.X -lt ($Window.Left + $Window.ActualWidth) -and $cursor.Y -lt ($Window.Top + $Window.ActualHeight)) {
      return $true
    }
    # PointFromScreen covers per-monitor DPI configurations where the two spaces differ.
    $screenPoint = [System.Windows.Point]::new([double]$cursor.X, [double]$cursor.Y)
    $localPoint = $Window.PointFromScreen($screenPoint)
    return $localPoint.X -ge 0 -and $localPoint.Y -ge 0 -and $localPoint.X -lt $Window.ActualWidth -and $localPoint.Y -lt $Window.ActualHeight
  } catch {
    return $false
  }
}

function Test-IsDescendantOf {
  param($Source, $Ancestor)
  $current = $Source -as [System.Windows.DependencyObject]
  while ($current) {
    if ([object]::ReferenceEquals($current, $Ancestor)) { return $true }
    try { $current = [System.Windows.Media.VisualTreeHelper]::GetParent($current) } catch { $current = $null }
  }
  return $false
}

function Begin-BallDrag {
  param($Sender, $Event)
  if ($Event.ChangedButton -ne [System.Windows.Input.MouseButton]::Left) { return }
  if (Test-IsDescendantOf $Event.OriginalSource $script:dockButton) { return }
  if ($script:tucked) { return }
  Hide-Panel
  $script:dragging = $true
  $startLeft = $script:ballWindow.Left
  $startTop = $script:ballWindow.Top
  $script:dockSide = ""
  $script:tucked = $false
  $script:dockButton.Visibility = [System.Windows.Visibility]::Collapsed
  try { $script:ballWindow.DragMove() } catch {}
  $script:dragging = $false
  $script:moved = ([math]::Abs($script:ballWindow.Left - $startLeft) + [math]::Abs($script:ballWindow.Top - $startTop)) -gt 3
  if ($script:moved) {
    $screen = Get-ScreenDipForBall
    $leftDistance = [math]::Abs($script:ballWindow.Left - $screen.Left)
    $rightDistance = [math]::Abs(($script:ballWindow.Left + $ballSize) - $screen.Right)
    if ([math]::Min($leftDistance, $rightDistance) -le $dockThreshold) {
      $script:dockSide = if ($leftDistance -le $rightDistance) { "left" } else { "right" }
      $script:tucked = $false
      Apply-DockVisual
    } else {
      Clamp-BallToScreen
    }
    Save-Position
  } else {
    Show-Panel
  }
  $Event.Handled = $true
}

function Begin-DockHandleAction {
  param($Event)
  if ($Event.ChangedButton -ne [System.Windows.Input.MouseButton]::Left -or -not $script:dockSide) { return }
  $Event.Handled = $true
  Hide-Panel

  # On the full ball the edge arrow is a simple tuck action.
  if (-not $script:tucked) {
    $script:tucked = $true
    Apply-DockVisual
    Save-Position
    return
  }

  # In tucked mode the handle itself can be dragged. Native WPF dragging keeps
  # the handle under the pointer on mixed-DPI and multi-monitor desktops.
  $startLeft = $script:ballWindow.Left
  $startTop = $script:ballWindow.Top
  $script:dragging = $true
  try { $script:ballWindow.DragMove() } catch {}
  $script:dragging = $false
  $moved = ([math]::Abs($script:ballWindow.Left - $startLeft) + [math]::Abs($script:ballWindow.Top - $startTop)) -gt 3

  if ($moved) {
    $screen = Get-ScreenDipForBall
    $handleCenter = $script:ballWindow.Left + ($dockHandleWidth / 2)
    $script:dockSide = if ($handleCenter -le ($screen.Left + ($screen.Width / 2))) { "left" } else { "right" }
    $script:ballWindow.Top = [math]::Max($screen.Top + 4, [math]::Min($script:ballWindow.Top, $screen.Bottom - $dockHandleHeight - 4))
    Apply-DockVisual
    Save-Position
    return
  }

  # A click restores the full ball but deliberately does not open the card.
  $script:tucked = $false
  Apply-DockVisual
  Save-Position
}

# Floating ball window: WPF transparency keeps the circular edge anti-aliased.
$script:ballWindow = New-Object System.Windows.Window
$script:ballWindow.Width = $ballSize
$script:ballWindow.Height = $ballSize
$script:ballWindow.WindowStyle = [System.Windows.WindowStyle]::None
$script:ballWindow.ResizeMode = [System.Windows.ResizeMode]::NoResize
$script:ballWindow.AllowsTransparency = $true
$script:ballWindow.Background = [System.Windows.Media.Brushes]::Transparent
$script:ballWindow.ShowInTaskbar = $false
$script:ballWindow.Topmost = $true
$script:ballWindow.ShowActivated = $false
$script:ballWindow.SizeToContent = [System.Windows.SizeToContent]::Manual
$script:ballWindow.UseLayoutRounding = $true
$script:ballWindow.SnapsToDevicePixels = $true

$script:ballRoot = New-Object System.Windows.Controls.Grid
$script:ballRoot.Background = [System.Windows.Media.Brushes]::Transparent
$script:ballRoot.Cursor = [System.Windows.Input.Cursors]::Hand
$script:ballRoot.UseLayoutRounding = $true
$script:ballClip = New-Object System.Windows.Media.EllipseGeometry
$script:ballClip.Center = [System.Windows.Point]::new([double]($ballSize / 2), [double]($ballSize / 2))
$script:ballClip.RadiusX = $ballSize / 2
$script:ballClip.RadiusY = $ballSize / 2
$script:ballRoot.Clip = $script:ballClip
$script:ballWindow.Content = $script:ballRoot

$script:ringEllipse = New-Object System.Windows.Shapes.Ellipse
$script:ringEllipse.Width = 68
$script:ringEllipse.Height = 68
$script:ringEllipse.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$script:ringEllipse.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$script:ringEllipse.StrokeThickness = 1
$shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
$shadow.BlurRadius = 14
$shadow.ShadowDepth = 2
$shadow.Opacity = 0.26
$shadow.Color = [System.Windows.Media.Colors]::Black
$script:ringEllipse.Effect = $shadow
$script:ballRoot.Children.Add($script:ringEllipse) | Out-Null

$script:coverEllipse = New-Object System.Windows.Shapes.Ellipse
$script:coverEllipse.Width = $ballDiameter
$script:coverEllipse.Height = $ballDiameter
$script:coverEllipse.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$script:coverEllipse.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$script:coverEllipse.Stroke = New-Brush "#66FFFFFF"
$script:coverEllipse.StrokeThickness = 1
$script:ballRoot.Children.Add($script:coverEllipse) | Out-Null

$script:dockButton = New-Object System.Windows.Controls.Border
$script:dockButton.Width = $dockTabWidth
$script:dockButton.Height = 36
$script:dockButton.CornerRadius = New-CornerRadius 14
$script:dockButton.BorderThickness = New-Thickness 1
$script:dockButton.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$script:dockButton.Visibility = [System.Windows.Visibility]::Collapsed
$script:dockButton.Cursor = [System.Windows.Input.Cursors]::Hand
$script:dockButton.Opacity = 0.98
$script:dockGlyph = New-Object System.Windows.Controls.TextBlock
$script:dockGlyph.Text = $txtChevronLeft
$script:dockGlyph.FontFamily = New-Object System.Windows.Media.FontFamily("Segoe UI Symbol")
$script:dockGlyph.FontSize = 22
$script:dockGlyph.FontWeight = [System.Windows.FontWeights]::SemiBold
$script:dockGlyph.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$script:dockGlyph.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$script:dockButton.Child = $script:dockGlyph
$script:ballRoot.Children.Add($script:dockButton) | Out-Null
[System.Windows.Controls.Panel]::SetZIndex($script:dockButton, 20)

# Independent companion panel. Hovering the ball reveals it without replacing the ball.
$script:panelWindow = New-Object System.Windows.Window
$script:panelWindow.Width = $panelWidth
$script:panelWindow.Height = $panelHeight
$script:panelWindow.WindowStyle = [System.Windows.WindowStyle]::None
$script:panelWindow.ResizeMode = [System.Windows.ResizeMode]::NoResize
$script:panelWindow.AllowsTransparency = $true
$script:panelWindow.Background = [System.Windows.Media.Brushes]::Transparent
$script:panelWindow.ShowInTaskbar = $false
$script:panelWindow.Topmost = $true
$script:panelWindow.ShowActivated = $false

$script:panelRoot = New-Object System.Windows.Controls.Grid
$script:panelRoot.Background = [System.Windows.Media.Brushes]::Transparent
$script:panelWindow.Content = $script:panelRoot

$script:cardBorder = New-Object System.Windows.Controls.Border
$script:cardBorder.Margin = New-Thickness 10
$script:cardBorder.CornerRadius = New-CornerRadius 22
$script:cardBorder.BorderThickness = New-Thickness 1
$cardShadow = New-Object System.Windows.Media.Effects.DropShadowEffect
$cardShadow.BlurRadius = 22
$cardShadow.ShadowDepth = 4
$cardShadow.Opacity = 0.20
$cardShadow.Color = [System.Windows.Media.Colors]::Black
$script:cardBorder.Effect = $cardShadow
$script:panelRoot.Children.Add($script:cardBorder) | Out-Null

$cardGrid = New-Object System.Windows.Controls.Grid
$cardGrid.Margin = New-Thickness 18 14 18 16
$script:cardBorder.Child = $cardGrid
foreach ($height in @(22, 46, 28, 42)) {
  $row = New-Object System.Windows.Controls.RowDefinition
  $row.Height = New-Object System.Windows.GridLength($height)
  $cardGrid.RowDefinitions.Add($row)
}

$script:titleText = New-Object System.Windows.Controls.TextBlock
$script:titleText.Text = $txtRecent
$script:titleText.FontFamily = New-Object System.Windows.Media.FontFamily("Microsoft YaHei UI")
$script:titleText.FontSize = 13
$script:titleText.FontWeight = [System.Windows.FontWeights]::SemiBold
[System.Windows.Controls.Grid]::SetRow($script:titleText, 0)
$cardGrid.Children.Add($script:titleText) | Out-Null

$script:turnText = New-Object System.Windows.Controls.TextBlock
$script:turnText.Text = "--"
$script:turnText.FontFamily = New-Object System.Windows.Media.FontFamily("Segoe UI")
$script:turnText.FontSize = 30
$script:turnText.FontWeight = [System.Windows.FontWeights]::Bold
$script:turnText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
[System.Windows.Controls.Grid]::SetRow($script:turnText, 1)
$cardGrid.Children.Add($script:turnText) | Out-Null

$metaGrid = New-Object System.Windows.Controls.Grid
$metaGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition))
$metaGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition))
[System.Windows.Controls.Grid]::SetRow($metaGrid, 2)
$cardGrid.Children.Add($metaGrid) | Out-Null

$script:todayText = New-Object System.Windows.Controls.TextBlock
$script:todayText.FontFamily = New-Object System.Windows.Media.FontFamily("Microsoft YaHei UI")
$script:todayText.FontSize = 12
$script:todayText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
[System.Windows.Controls.Grid]::SetColumn($script:todayText, 0)
$metaGrid.Children.Add($script:todayText) | Out-Null

$script:cacheText = New-Object System.Windows.Controls.TextBlock
$script:cacheText.FontFamily = New-Object System.Windows.Media.FontFamily("Microsoft YaHei UI")
$script:cacheText.FontSize = 12
$script:cacheText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$script:cacheText.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
[System.Windows.Controls.Grid]::SetColumn($script:cacheText, 1)
$metaGrid.Children.Add($script:cacheText) | Out-Null

$actionGrid = New-Object System.Windows.Controls.Grid
$actionGrid.Margin = New-Thickness 0 6 0 0
$actionGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition))
$gapColumn = New-Object System.Windows.Controls.ColumnDefinition
$gapColumn.Width = New-Object System.Windows.GridLength(10)
$actionGrid.ColumnDefinitions.Add($gapColumn)
$actionGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition))
[System.Windows.Controls.Grid]::SetRow($actionGrid, 3)
$cardGrid.Children.Add($actionGrid) | Out-Null

$script:openAction = New-Object System.Windows.Controls.Border
$script:openAction.CornerRadius = New-CornerRadius 11
$script:openAction.Cursor = [System.Windows.Input.Cursors]::Hand
[System.Windows.Controls.Grid]::SetColumn($script:openAction, 0)
$script:openText = New-Object System.Windows.Controls.TextBlock
$script:openText.Text = $txtOpen
$script:openText.FontFamily = New-Object System.Windows.Media.FontFamily("Microsoft YaHei UI")
$script:openText.FontSize = 13
$script:openText.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$script:openText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$script:openAction.Child = $script:openText
$actionGrid.Children.Add($script:openAction) | Out-Null

$script:copyAction = New-Object System.Windows.Controls.Border
$script:copyAction.CornerRadius = New-CornerRadius 11
$script:copyAction.Cursor = [System.Windows.Input.Cursors]::Hand
[System.Windows.Controls.Grid]::SetColumn($script:copyAction, 2)
$script:copyText = New-Object System.Windows.Controls.TextBlock
$script:copyText.Text = $txtCopy
$script:copyText.FontFamily = New-Object System.Windows.Media.FontFamily("Microsoft YaHei UI")
$script:copyText.FontSize = 13
$script:copyText.FontWeight = [System.Windows.FontWeights]::SemiBold
$script:copyText.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$script:copyText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$script:copyAction.Child = $script:copyText
$actionGrid.Children.Add($script:copyAction) | Out-Null

$script:closeTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:closeTimer.Interval = [TimeSpan]::FromMilliseconds(240)
$script:closeTimer.Add_Tick({
  $script:closeTimer.Stop()
  if (-not $script:ballRoot.IsMouseOver -and -not $script:panelRoot.IsMouseOver) { Hide-Panel }
})

$script:copyFeedbackTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:copyFeedbackTimer.Interval = [TimeSpan]::FromMilliseconds(1100)
$script:copyFeedbackTimer.Add_Tick({
  $script:copyFeedbackTimer.Stop()
  $script:copyText.Text = $txtCopy
})

# Transparent windows can occasionally miss MouseLeave during a rapid cross-window
# move. This low-cost hit test keeps the ball/panel pair stable without resizing either.
$script:hoverTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:hoverTimer.Interval = [TimeSpan]::FromMilliseconds(100)
$script:hoverTimer.Add_Tick({
  if ($script:tucked -or $script:dragging) {
    if ($script:panelWindow.IsVisible) { Hide-Panel }
    return
  }
  $insideBall = Test-CursorInsideWindow $script:ballWindow
  $insidePanel = Test-CursorInsideWindow $script:panelWindow
  if ($insideBall -or $insidePanel) {
    $script:closeTimer.Stop()
    if ($insideBall -and -not $script:panelWindow.IsVisible) { Show-Panel }
  } elseif ($script:panelWindow.IsVisible -and -not $script:closeTimer.IsEnabled) {
    Schedule-PanelClose
  }
})

$script:ballRoot.Add_MouseEnter({ if (-not $script:tucked) { Show-Panel } })
$script:ballRoot.Add_MouseLeave({ Schedule-PanelClose })
$script:panelRoot.Add_MouseEnter({ $script:closeTimer.Stop() })
$script:panelRoot.Add_MouseLeave({ Schedule-PanelClose })
$script:ballRoot.Add_MouseLeftButtonDown({ Begin-BallDrag $this $_ })
$script:dockButton.Add_MouseLeftButtonDown({ Begin-DockHandleAction $_ })
$script:openAction.Add_MouseLeftButtonUp({ Open-Dashboard })
$script:copyAction.Add_MouseLeftButtonUp({ Copy-Pack })
$script:openAction.Add_MouseEnter({ $script:openAction.Background = $script:secondaryHoverBrush })
$script:openAction.Add_MouseLeave({ $script:openAction.Background = $script:secondaryBrush })
$script:copyAction.Add_MouseEnter({ $script:copyAction.Background = $script:accentHoverBrush })
$script:copyAction.Add_MouseLeave({ $script:copyAction.Background = $script:accentBrush })

$dataTimer = New-Object System.Windows.Threading.DispatcherTimer
$dataTimer.Interval = [TimeSpan]::FromSeconds(1.5)
$dataTimer.Add_Tick({
  if ((Get-CoverStamp) -ne $script:coverStamp) { Refresh-Cover }
  $data = Get-State
  if ($data) {
    $script:lastData = $data
    Apply-Theme $data.theme
    Update-DataLabels
  }
})

$saved = Load-Position
$script:ballWindow.Left = $saved.x
$script:ballWindow.Top = $saved.y
$script:dockSide = $saved.dockSide
$script:tucked = $saved.tucked -and [bool]$script:dockSide
$script:themeReady = $false
Apply-Theme $script:theme
Refresh-Cover
Update-DataLabels

$app = New-Object System.Windows.Application
$app.ShutdownMode = [System.Windows.ShutdownMode]::OnExplicitShutdown
$script:ballWindow.Add_Closed({
  $dataTimer.Stop()
  $script:closeTimer.Stop()
  $script:copyFeedbackTimer.Stop()
  $script:hoverTimer.Stop()
  if ($script:panelWindow.IsVisible) { $script:panelWindow.Close() }
  $app.Shutdown()
})

$script:ballWindow.Show()
Apply-DockVisual
Save-Position
$dataTimer.Start()
$script:hoverTimer.Start()
$null = $app.Run()
