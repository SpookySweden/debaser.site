<#
  Screen to screen, on one PC (engine/BENCH.md).

  Opens two small windows on the real screen for under a minute: the patch (a window that flips between two greys on
  timer of its own), in the middle of the screen where the engine is looking, and a viewer showing the engine's
  stream, off to the left where the engine is not looking. The rig only watches: it presses nothing and takes no
  window to the front. It reads both in one grab of the screen: the gap between the patch changing and the stream's copy of it changing is the stream's whole
  delay, browser drawing and screen refresh included. The network is this PC's own loopback, so a real network's
  time is NOT in it.

  Usage (from the engine folder, after `cargo build --release`):
    powershell -ExecutionPolicy Bypass -File bench\glass.ps1 -Name glass-60 -Fps 60
#>
param(
  [string]$Name = 'glass',
  [int]$Samples = 150,
  [int]$Fps = 60,
  [int]$Width = 1280,
  [int]$Height = 720,
  [int]$Port = 8495,
  [int]$Tweaks = -1,
  [string]$PageOptions = 'hold=1',
  # How the viewer draws the picture: 'fast' or 'normal' (see DRAWING in web/viewer.html); '' leaves it to the page.
  [string]$Draw = ''
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$engine = Join-Path $here '..\target\release\debaser-engine.exe'
# A set-aside copy of the engine, when there is one, so a measurement is not disturbed by the engine being rebuilt.
$setAside = Join-Path $here '..\target\glass-engine.exe'
if (Test-Path $setAside) { $engine = $setAside }

if (Get-Process | Where-Object { $_.ProcessName -eq 'League of Legends' }) { Write-Host 'A League match is running: not touching the screen.'; exit 3 }

# Windows may be scaling the desktop (125%, 150%): browsers place and size their windows in scaled units, while the
# engine and the rig work in the screen's real pixels. Both sizes are read here and every place is worked out in both.
Add-Type -AssemblyName System.Windows.Forms
$scaledW = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
$scaledH = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class RealScreen {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(System.IntPtr window, out RECT rect);
  [DllImport("user32.dll")] static extern bool ShowWindow(System.IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool MoveWindow(System.IntPtr window, int x, int y, int w, int h, bool repaint);
  // Puts a window, un-minimised, exactly here (real pixels): a browser does not always open where it is asked to.
  // On top of other windows so it can be read, but never made the active window: whoever is typing keeps typing.
  [DllImport("user32.dll")] static extern bool SetWindowPos(System.IntPtr window, System.IntPtr after, int x, int y, int w, int h, uint flags);
  public static void Place(System.IntPtr window, int x, int y, int w, int h) {
    ShowWindow(window, 4);
    MoveWindow(window, x, y, w, h, true);
    SetWindowPos(window, new System.IntPtr(-1), x, y, w, h, 0x0010 | 0x0040);
  }
  public static int[] Rect(System.IntPtr window) { RECT r; GetWindowRect(window, out r); return new int[] { r.Left, r.Top, r.Right, r.Bottom }; }
  public static int Width, Height;
  public static void Read() { SetProcessDPIAware(); Width = GetSystemMetrics(0); Height = GetSystemMetrics(1); }
}
'@
[RealScreen]::Read()
$screenW = [RealScreen]::Width; $screenH = [RealScreen]::Height
$scale = $screenW / $scaledW
$regionLeft = [int](($screenW - $Width) / 2)
if ($regionLeft -lt 700) { Write-Host "NOT MEASURED. This screen is too narrow to put the viewer beside a ${Width}-wide piece of it."; exit 2 }

# The patch: a small window in the very middle of the screen (the middle of the piece the engine sends).
$patchW = 400; $patchH = 300
$patchX = [int]($scaledW / 2 - $patchW / 2); $patchY = [int]($scaledH / 2 - $patchH / 2)
$sourceX = [int]($screenW / 2); $sourceY = [int]($screenH / 2 + 20 * $scale)
# The viewer: at the left, outside the piece being sent. The stream's middle is the middle of its picture.
$viewX = 20; $viewY = 200
$viewW = [int](($regionLeft - 40) / $scale) - $viewX; $viewH = [int]($viewW * 0.6)
$mirrorX = [int](($viewX + $viewW / 2) * $scale); $mirrorY = [int](($viewY + 31 + ($viewH - 39) / 2) * $scale)
Write-Host ("screen {0}x{1}, Windows scaling {2:P0}; patch read at {3},{4}; the stream's copy read at {5},{6}" -f $screenW, $screenH, $scale, $sourceX, $sourceY, $mirrorX, $mirrorY)

# Chrome, not Edge: in a fresh profile Edge signs itself in to the Windows account and puts a box saying so over
# the page, which covered the patch (seen 2026-11-20). Chrome opens a fresh profile with nothing on top.
$edge = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe' }
if (-not (Test-Path $edge)) { Write-Host 'NOT MEASURED. This measurement needs Chrome (Edge covers the test page with its own sign-in box).'; exit 2 }
$browserName = 'chrome'
# A fresh browser profile each run, removed afterwards: a profile whose browser was closed by force can reopen its
# windows minimised.
$profile = Join-Path $env:TEMP ('debaser-glass-profile-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$log = Join-Path $env:TEMP 'debaser-glass-engine.log'

$query = $PageOptions
if ($Draw -ne '') { $query = $query + '&drawing=' + $Draw }
$engineArgs = @('serve', '--width', $Width, '--height', $Height, '--fps', $Fps, '--port', $Port, '--seconds', '120')
if ($Tweaks -ge 0) { $engineArgs += @('--tweaks', $Tweaks) }
$engineProcess = Start-Process -FilePath $engine -ArgumentList $engineArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $log
try {
  Start-Sleep -Milliseconds 800
  $patchPage = 'file:///' + ((Join-Path $here 'patch.html') -replace '\\', '/') + '?full=1&auto=1'
  Start-Process -FilePath $edge -ArgumentList "--user-data-dir=`"$profile`"", '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen', '--disable-sync', "--window-position=$viewX,$viewY", "--window-size=$viewW,$viewH", "--app=http://127.0.0.1:$Port/?$query"
  Start-Sleep -Seconds 2
  Start-Process -FilePath $edge -ArgumentList "--user-data-dir=`"$profile-patch`"", '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen', '--disable-sync', "--window-position=$patchX,$patchY", "--window-size=$patchW,$patchH", "--app=$patchPage"
  Start-Sleep -Seconds 5
  # Where the two windows really are (a browser may not put a window exactly where it was asked to).
  $patchWindow = Get-Process $browserName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'DEBASER BENCH PATCH*' } | Select-Object -First 1
  $viewWindow = Get-Process $browserName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'DEBASER ENGINE VIEWER*' } | Select-Object -First 1
  if (-not $patchWindow -or -not $viewWindow) {
    $open = (Get-Process $browserName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { "'$($_.MainWindowTitle)'" }) -join ', '
    Write-Host "NOT MEASURED. One of the two test windows did not open. Edge windows found: $open"
    exit 2
  }
  [RealScreen]::Place($viewWindow.MainWindowHandle, 20, 200, $regionLeft - 60, [int](($regionLeft - 60) * 0.6))
  [RealScreen]::Place($patchWindow.MainWindowHandle, [int]($screenW / 2 - 250), [int]($screenH / 2 - 190), 500, 380)
  Start-Sleep -Seconds 2
  $pr = [RealScreen]::Rect($patchWindow.MainWindowHandle); $vr = [RealScreen]::Rect($viewWindow.MainWindowHandle)
  if ($vr[0] -lt 0 -or $vr[2] -gt $regionLeft -or $pr[0] -lt $regionLeft -or $pr[2] -gt ($regionLeft + $Width)) {
    Write-Host ("NOT MEASURED. The test windows are not where they need to be: patch {0},{1} to {2},{3}; viewer {4},{5} to {6},{7}; the engine sends x {8} to {9}." -f $pr[0], $pr[1], $pr[2], $pr[3], $vr[0], $vr[1], $vr[2], $vr[3], $regionLeft, ($regionLeft + $Width))
    exit 2
  }
  $sourceX = [int](($pr[0] + $pr[2]) / 2); $sourceY = [int](($pr[1] + $pr[3]) / 2 + 20 * $scale)
  $mirrorX = [int](($vr[0] + $vr[2]) / 2); $mirrorY = [int](($vr[1] + 31 * $scale + $vr[3] - 8 * $scale) / 2)
  Write-Host ("patch window {0},{1} to {2},{3} (read at {4},{5}); viewer window {6},{7} to {8},{9} (read at {10},{11}); the engine sends x {12} to {13}" -f $pr[0], $pr[1], $pr[2], $pr[3], $sourceX, $sourceY, $vr[0], $vr[1], $vr[2], $vr[3], $mirrorX, $mirrorY, $regionLeft, ($regionLeft + $Width))
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'rig.ps1') -Name $Name -Samples $Samples -Passive -X $sourceX -Y $sourceY -X2 $mirrorX -Y2 $mirrorY -CountdownSeconds 0
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    # When a run could not measure, keep one small picture of the two test windows as they were, to see why.
    try {
      Add-Type -AssemblyName System.Drawing
      foreach ($shot in @(@('patch', $pr), @('viewer', $vr))) {
        $r = $shot[1]; $w = $r[2] - $r[0]; $h = $r[3] - $r[1]
        $bitmap = New-Object System.Drawing.Bitmap $w, $h
        $g = [System.Drawing.Graphics]::FromImage($bitmap)
        $g.CopyFromScreen($r[0], $r[1], 0, 0, (New-Object System.Drawing.Size $w, $h))
        $small = New-Object System.Drawing.Bitmap $bitmap, ([int]($w / 2)), ([int]($h / 2))
        $small.Save((Join-Path $env:TEMP ("debaser-glass-fail-" + $shot[0] + ".png")), [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bitmap.Dispose(); $small.Dispose()
      }
    } catch { }
  }
} finally {
  Get-CimInstance Win32_Process -Filter "Name = '$browserName.exe'" | Where-Object { $_.CommandLine -like '*debaser-glass-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($engineProcess -and -not $engineProcess.HasExited) { Stop-Process -Id $engineProcess.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
  foreach ($used in @($profile, "$profile-patch")) { if (Test-Path $used) { Remove-Item -Recurse -Force $used -Confirm:$false -ErrorAction SilentlyContinue } }
}
if (Test-Path $log) {
  $last = Get-Content $log | Where-Object { $_ -match 'Windows showed it' } | Select-Object -Last 1
  if ($last) { Write-Host "  the engine's last second: $($last.Trim())" }
}
exit $code
