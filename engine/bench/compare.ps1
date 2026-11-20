<#
  Fair comparison of engine settings (engine/BENCH.md). One run of `bench-encode` can't be trusted: what else the PC
  is doing moves the numbers more than a setting does. So this runs every setting in turn, several times round, and
  compares the middle of each setting's results: whatever the PC was doing, every setting met it equally.

  Usage (from the engine folder, after `cargo build --release`):
    powershell -ExecutionPolicy Bypass -File bench\compare.ps1 -Name tweaks -Tweaks 0,1,4,8,13 -Rounds 6
#>
param(
  [string]$Name = 'compare',
  [int[]]$Tweaks = @(0, 1, 4, 8, 13),
  [int]$Rounds = 6,
  [int]$Frames = 240,
  [int]$Width = 1920,
  [int]$Height = 1080,
  [int]$Fps = 60,
  [int]$Bitrate = 20000,
  [switch]$Hevc
)
$ErrorActionPreference = 'Stop'
$engine = Join-Path $PSScriptRoot '..\target\release\debaser-engine.exe'
$scratch = Join-Path $env:TEMP "debaser-compare-$Name"
if (-not (Test-Path $scratch)) { New-Item -ItemType Directory -Force $scratch | Out-Null }

function Get-Middle([double[]]$values) {
  if ($values.Count -eq 0) { return [double]::NaN }
  $sorted = [double[]]($values | Sort-Object)
  return $sorted[[int][math]::Floor(($sorted.Count - 1) / 2)]
}

$seen = @{}
foreach ($t in $Tweaks) { $seen[$t] = @{ changed = @(); changedP95 = @(); shown = @(); shownP95 = @() } }

for ($round = 1; $round -le $Rounds; $round++) {
  foreach ($t in $Tweaks) {
    $run = "$Name-t$t-r$round"
    $arguments = @('bench-encode', '--name', $run, '--width', $Width, '--height', $Height, '--fps', $Fps, '--bitrate', $Bitrate, '--frames', $Frames, '--tweaks', $t, '--out', $scratch)
    if ($Hevc) { $arguments += '--hevc' }
    & $engine @arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "run $run failed"; continue }
    $json = Get-Content (Join-Path $scratch "$run.json") -Raw | ConvertFrom-Json
    if ($json.encodeChangedOnly) {
      $seen[$t].changed += [double]$json.encodeChangedOnly.p50Ms
      $seen[$t].changedP95 += [double]$json.encodeChangedOnly.p95Ms
    }
    if ($json.presentToEncoded) {
      $seen[$t].shown += [double]$json.presentToEncoded.p50Ms
      $seen[$t].shownP95 += [double]$json.presentToEncoded.p95Ms
    }
  }
}

Write-Host ""
Write-Host "COMPARE :: $Name :: ${Width}x${Height} at $Fps fps, $Rounds rounds of $Frames frames each, settings taken in turn"
Write-Host "  (each figure: the middle of that setting's rounds; changed frames only)"
Write-Host ("  {0,-8} {1,14} {2,16} {3,22} {4,22}" -f 'tweaks', 'encode middle', 'encode worst 5%', 'shown->encoded middle', 'shown->encoded worst 5%')
$rows = @()
foreach ($t in $Tweaks) {
  $row = [ordered]@{
    tweaks = $t
    encodeP50 = [math]::Round((Get-Middle $seen[$t].changed), 2)
    encodeP95 = [math]::Round((Get-Middle $seen[$t].changedP95), 2)
    shownP50 = [math]::Round((Get-Middle $seen[$t].shown), 2)
    shownP95 = [math]::Round((Get-Middle $seen[$t].shownP95), 2)
    rounds = $seen[$t].changed.Count
  }
  $rows += $row
  Write-Host ("  {0,-8} {1,11} ms {2,13} ms {3,19} ms {4,19} ms" -f $t, $row.encodeP50, $row.encodeP95, $row.shownP50, $row.shownP95)
}
$out = Join-Path $PSScriptRoot 'results'
if (-not (Test-Path $out)) { New-Item -ItemType Directory -Force $out | Out-Null }
$file = Join-Path $out ("compare-{0}-{1}.json" -f $Name, (Get-Date).ToString('yyyyMMdd-HHmmss'))
([ordered]@{ name = $Name; when = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'); encode = "${Width}x${Height}"; fps = $Fps; bitrateKbps = $Bitrate; rounds = $Rounds; framesPerRun = $Frames; rows = $rows } | ConvertTo-Json -Depth 5) | Out-File -Encoding utf8 $file
Write-Host "  saved $file"
