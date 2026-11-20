<#
  The rig (SPEC-screens.md, "The loop"): one measuring stick for every contender.

  Run it on the device you are controlling FROM (the laptop). It presses a key, watches the middle of this device's
  own screen for the patch to change (engine/bench/patch.html, open and focused on the PC being streamed), and
  times the gap. It does that a few hundred times and reports the middle value and the worst 5%.

  It measures whatever window is in front: the Moonlight app, our browser tab, or the patch page itself with no
  streaming at all (the floor). The same stick for all three, so the numbers compare fairly.

  What one number contains: this device's key press -> the stream's input path -> the PC's browser drawing the
  flip -> capture -> encode -> network -> decode -> this device's screen -> this script reading the pixel.
  The PC's browser and this script's reading are the same for every contender, so they cancel in a comparison.

  Usage (from the repository's folder):
    powershell -ExecutionPolicy Bypass -File engine\bench\rig.ps1 -Name moonlight
  Then click into the stream's window during the countdown. Or name the window and the rig brings it forward:
    powershell -ExecutionPolicy Bypass -File engineenchig.ps1 -Name moonlight -Window Moonlight

  The key pressed is Right Ctrl: it does nothing by itself in Windows, a browser or a game.
#>
param(
  [string]$Name = 'run',
  [int]$Samples = 200,
  [int]$Key = 0xA3,
  [int]$X = -1,
  [int]$Y = -1,
  [int]$TimeoutMs = 1000,
  [int]$CountdownSeconds = 5,
  [string]$Window = '',
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class Rig {
  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint type; public InputUnion U; }

  [StructLayout(LayoutKind.Sequential)]
  struct BITMAPINFOHEADER {
    public uint biSize; public int biWidth; public int biHeight; public ushort biPlanes; public ushort biBitCount;
    public uint biCompression; public uint biSizeImage; public int biXPelsPerMeter; public int biYPelsPerMeter;
    public uint biClrUsed; public uint biClrImportant;
  }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  delegate bool EachWindow(IntPtr window, IntPtr extra);
  [DllImport("user32.dll")] static extern bool EnumWindows(EachWindow each, IntPtr extra);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER info, uint usage, out IntPtr bits, IntPtr section, uint offset);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dest, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool GdiFlush();

  const int Box = 4;
  const uint SRCCOPY = 0x00CC0020;
  const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  const uint KEYEVENTF_KEYUP = 0x0002;

  static IntPtr screen, memory, bitmap, old, bits;
  static int watchX, watchY;

  public static int ScreenWidth, ScreenHeight;
  public static double PollMs;
  public static int Timeouts;
  public static string Problem = "";

  public static void Open(int x, int y) {
    SetProcessDPIAware();
    ScreenWidth = GetSystemMetrics(0);
    ScreenHeight = GetSystemMetrics(1);
    watchX = (x < 0 ? ScreenWidth / 2 : x) - Box / 2;
    watchY = (y < 0 ? ScreenHeight / 2 : y) - Box / 2;
    screen = GetDC(IntPtr.Zero);
    memory = CreateCompatibleDC(screen);
    BITMAPINFOHEADER info = new BITMAPINFOHEADER();
    info.biSize = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER));
    info.biWidth = Box; info.biHeight = -Box; info.biPlanes = 1; info.biBitCount = 32;
    bitmap = CreateDIBSection(screen, ref info, 0, out bits, IntPtr.Zero, 0);
    old = SelectObject(memory, bitmap);
  }

  public static void Close() {
    SelectObject(memory, old); DeleteObject(bitmap); DeleteDC(memory); ReleaseDC(IntPtr.Zero, screen);
  }

  /** The brightness (0 to 255) of the little box of screen being watched, read from the screen as shown. */
  public static double Luma() {
    BitBlt(memory, 0, 0, Box, Box, screen, watchX, watchY, SRCCOPY);
    GdiFlush();
    double sum = 0;
    for (int i = 0; i < Box * Box; i++) {
      int pixel = Marshal.ReadInt32(bits, i * 4);
      int b = pixel & 0xFF, g = (pixel >> 8) & 0xFF, r = (pixel >> 16) & 0xFF;
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return sum / (Box * Box);
  }

  static string Title(IntPtr window) {
    System.Text.StringBuilder text = new System.Text.StringBuilder(256);
    GetWindowText(window, text, 256);
    return text.ToString();
  }

  public static string FrontWindow() { return Title(GetForegroundWindow()); }

  /**
   * Brings the first visible window whose title holds `part` to the front (the -Window option), so nobody has to
   * click in time. Windows only lets a background program do that after a key event of its own: a tap of Alt.
   */
  public static bool Bring(string part) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr window, IntPtr extra) {
      if (!IsWindowVisible(window)) return true;
      if (Title(window).IndexOf(part, StringComparison.OrdinalIgnoreCase) < 0) return true;
      found = window;
      return false;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return false;
    Press(0x12, false); Press(0x12, true);
    if (IsIconic(found)) ShowWindow(found, 9);
    SetForegroundWindow(found);
    Thread.Sleep(400);
    return GetForegroundWindow() == found;
  }

  static void Press(int vk, bool up) {
    INPUT[] one = new INPUT[1];
    one[0].type = 1;
    one[0].U.ki.wVk = (ushort)vk;
    one[0].U.ki.wScan = (ushort)MapVirtualKey((uint)vk, 0);
    // The right-hand Ctrl and Alt are "extended" keys.
    uint flags = (vk == 0xA3 || vk == 0xA5) ? KEYEVENTF_EXTENDEDKEY : 0;
    one[0].U.ki.dwFlags = flags | (up ? KEYEVENTF_KEYUP : 0);
    SendInput(1, one, Marshal.SizeOf(typeof(INPUT)));
  }

  static double Ms(long from, long to) { return (to - from) * 1000.0 / Stopwatch.Frequency; }

  /** A brightness that has held still for a moment: the patch's state before the next press. */
  static double Settled() {
    double last = Luma();
    long since = Stopwatch.GetTimestamp();
    long started = since;
    while (Ms(since, Stopwatch.GetTimestamp()) < 60) {
      double now = Luma();
      if (Math.Abs(now - last) > 6) { last = now; since = Stopwatch.GetTimestamp(); }
      if (Ms(started, Stopwatch.GetTimestamp()) > 2000) break;
      Thread.Sleep(1);
    }
    return last;
  }

  /** One press: the milliseconds until the watched box changes brightness, or -1 when it never did. */
  static double One(int vk, int timeoutMs, double threshold, ref long polls, ref double pollTime) {
    double before = Settled();
    long start = Stopwatch.GetTimestamp();
    Press(vk, false);
    double found = -1;
    while (true) {
      double now = Luma();
      long t = Stopwatch.GetTimestamp();
      polls++;
      double elapsed = Ms(start, t);
      if (Math.Abs(now - before) > threshold) { found = elapsed; break; }
      if (elapsed > timeoutMs) break;
    }
    pollTime += Ms(start, Stopwatch.GetTimestamp());
    Press(vk, true);
    return found;
  }

  /**
   * The whole run. First two presses are a trial: if the box doesn't change for either, nothing is measured and
   * Problem says why, instead of a table of timeouts.
   */
  public static int Interruptions;
  public static string Stopped = "";

  public static double[] Run(int samples, int vk, int timeoutMs, string window) {
    List<double> results = new List<double>();
    Random random = new Random();
    long polls = 0; double pollTime = 0;
    Timeouts = 0; Problem = ""; Interruptions = 0; Stopped = "";
    const double threshold = 30;

    double first = One(vk, timeoutMs, threshold, ref polls, ref pollTime);
    Thread.Sleep(300);
    double second = One(vk, timeoutMs, threshold, ref polls, ref pollTime);
    if (first < 0 && second < 0) {
      Problem = "The middle of this screen did not change when the key was pressed. Front window: \"" + FrontWindow() + "\".";
      return results.ToArray();
    }
    polls = 0; pollTime = 0;
    IntPtr front = GetForegroundWindow();

    for (int i = 0; i < samples; i++) {
      // An uneven wait, so presses don't fall in step with either screen's refresh.
      Thread.Sleep(180 + random.Next(220));
      // Keys go to whatever is in front: if that changes, the rest would measure the wrong window. With -Window the
      // rig takes the front back and carries on (some apps pull themselves forward by themselves); without it, it
      // stops and keeps only what was measured while the right window was in front.
      if (GetForegroundWindow() != front) {
        string thief = FrontWindow();
        if (window != "" && Interruptions < 20 && Bring(window)) {
          Interruptions++;
          front = GetForegroundWindow();
          Thread.Sleep(300);
          i--;
          continue;
        }
        Stopped = "Another window came to the front after " + i + " presses: \"" + thief + "\".";
        if (results.Count < 20) { Problem = Stopped; return new double[0]; }
        break;
      }
      double ms = One(vk, timeoutMs, threshold, ref polls, ref pollTime);
      if (ms < 0) Timeouts++; else results.Add(ms);
    }
    PollMs = polls > 0 ? pollTime / polls : 0;
    return results.ToArray();
  }
}
'@

function Get-Percentile([double[]]$sorted, [double]$p) {
  if ($sorted.Count -eq 0) { return [double]::NaN }
  $index = [math]::Ceiling($p / 100.0 * $sorted.Count) - 1
  if ($index -lt 0) { $index = 0 }
  return $sorted[[int]$index]
}

Write-Host ""
Write-Host "DEBASER BENCH RIG :: $Name :: $Samples presses"
Write-Host "Click into the window to measure now. The patch page must be open and focused on the PC being streamed."
for ($i = $CountdownSeconds; $i -gt 0; $i--) { Write-Host "  starting in $i"; Start-Sleep -Seconds 1 }

[Rig]::Open($X, $Y)
if ($Window -ne '') {
  if (-not [Rig]::Bring($Window)) {
    [Rig]::Close()
    Write-Host ""
    Write-Host "NOT MEASURED. No window with '$Window' in its title could be brought to the front (front now: '$([Rig]::FrontWindow())')."
    exit 2
  }
}
try {
  $front = [Rig]::FrontWindow()
  $values = [Rig]::Run($Samples, $Key, $TimeoutMs, $Window)
} finally {
  [Rig]::Close()
}

if ([Rig]::Problem -ne '') {
  Write-Host ""
  Write-Host "NOT MEASURED. $([Rig]::Problem)"
  Write-Host "Check: the patch page is in front on the PC; this stream is windowed or borderless (not exclusive full screen);"
  Write-Host "the stream fills this screen so the square sits in its middle; the stream passes keys to the PC."
  exit 2
}

$sorted = [double[]]($values | Sort-Object)
$mean = if ($sorted.Count -gt 0) { ($sorted | Measure-Object -Average).Average } else { [double]::NaN }
$summary = [ordered]@{
  name = $Name
  when = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  machine = $env:COMPUTERNAME
  frontWindow = $front
  screen = "$([Rig]::ScreenWidth)x$([Rig]::ScreenHeight)"
  samples = $sorted.Count
  timeouts = [Rig]::Timeouts
  minMs = [math]::Round($sorted[0], 1)
  p50Ms = [math]::Round((Get-Percentile $sorted 50), 1)
  meanMs = [math]::Round($mean, 1)
  p95Ms = [math]::Round((Get-Percentile $sorted 95), 1)
  p99Ms = [math]::Round((Get-Percentile $sorted 99), 1)
  maxMs = [math]::Round($sorted[$sorted.Count - 1], 1)
  readEveryMs = [math]::Round([Rig]::PollMs, 2)
  tookFrontBack = [Rig]::Interruptions
  stoppedEarly = [Rig]::Stopped
}

Write-Host ""
Write-Host "RESULT :: $Name"
Write-Host ("  front window   {0}" -f $summary.frontWindow)
Write-Host ("  presses seen   {0} of {1} ({2} never showed within {3} ms)" -f $summary.samples, $Samples, $summary.timeouts, $TimeoutMs)
Write-Host ("  middle (p50)   {0} ms" -f $summary.p50Ms)
Write-Host ("  worst 5% (p95) {0} ms" -f $summary.p95Ms)
Write-Host ("  fastest {0} ms, average {1} ms, p99 {2} ms, slowest {3} ms" -f $summary.minMs, $summary.meanMs, $summary.p99Ms, $summary.maxMs)
Write-Host ("  the screen was read every {0} ms (the stick's own fineness)" -f $summary.readEveryMs)
if ($summary.tookFrontBack -gt 0) { Write-Host ("  another window took the front {0} time(s); the rig took it back and carried on" -f $summary.tookFrontBack) }
if ($summary.stoppedEarly -ne '') { Write-Host ("  STOPPED EARLY. {0}" -f $summary.stoppedEarly) }

if ($OutDir -eq '') { $OutDir = Join-Path $PSScriptRoot 'results' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force $OutDir | Out-Null }
$file = Join-Path $OutDir ("{0}-{1}.json" -f $Name, (Get-Date).ToString('yyyyMMdd-HHmmss'))
$summary['valuesMs'] = @($values | ForEach-Object { [math]::Round($_, 2) })
($summary | ConvertTo-Json -Depth 4) | Out-File -Encoding utf8 $file
Write-Host "  saved $file"
