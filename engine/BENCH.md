# BENCH: the measuring loop (SPEC-screens.md)

Nothing counts as faster until it is measured faster, with the same stick, on the same two machines.

## The stick
`engine/bench/rig.ps1`, run on the device you control FROM. It presses Right Ctrl (a key that does nothing by itself),
watches the middle of its own screen, and times how long the PC's answer takes to show: the grey square of
`engine/bench/patch.html`, open and in front on the PC being streamed. A few hundred presses; it reports the middle
value (p50) and the worst 5% (p95), and saves every press to `engine/bench/results/`.

One number holds the whole round trip: the key press, the stream's input path, the PC's browser drawing the flip,
capture, encode, network, decode, this device's screen, and the rig reading the pixel. The PC's browser and the rig's
own reading are the same for every contender, so they cancel when two contenders are compared. The rig also prints how
often it managed to read the screen: that is its fineness.

It refuses to report instead of guessing: when the square never changes ("NOT MEASURED"), and when another window comes
to the front part-way (keys would be going to the wrong place). Both seen working on the PC, 2026-11-20.

## The machines
| | |
| --- | --- |
| PC (shared, controlled) | Ryzen 5 3600, RTX 3060 (driver 32.0.16.1074), 16 GB, Windows 10 Home 19045, screen 3440x1440 at 180 Hz |
| Sunshine on the PC | 2026.715.205118, already installed and running; ViGEmBus controller driver installed |
| Laptop (controls) | to be filled in on the first run (screen, refresh rate, Wi-Fi or cable) |
| Rust on the PC | 1.99.1, MSVC toolchain, already installed (needed from phase 1) |

## Phase 0: the yardstick
Each run is one line on the laptop, in the repository's folder. Keep the same resolution, frame rate and bitrate in
Moonlight for every run, and write them in the Notes column.

1. **On the PC:** open `engine\bench\patch.html` in a browser, press F11 for full screen, click it once.
2. **On the laptop:** start the stream in Moonlight (Desktop), in **borderless or windowed** mode, filling the screen.
   Turn on Moonlight's own numbers with Ctrl+Alt+Shift+S and note what it shows.
3. **On the laptop:** `powershell -ExecutionPolicy Bypass -File engine\bench\rig.ps1 -Name moonlight-home -Window Moonlight`
4. **The floor (no streaming), on the PC**, with the patch page open:
   `powershell -ExecutionPolicy Bypass -File engine\bench\rig.ps1 -Name floor-pc -Window "DEBASER BENCH PATCH"`
   This is the part of every number that belongs to the PC's browser and the rig, not to any stream.
5. **What streaming costs a game:** League's Practice Tool, Ctrl+F for the frame counter; note the frames with nobody
   connected to Sunshine, then with the laptop connected.
6. **Vanguard:** in that Practice Tool game, try to move the pointer from the laptop through Moonlight. Note whether it
   moves. Nothing is worked around.

## Results
| Date | Contender | Line | p50 ms | p95 ms | Seen / pressed | Read every | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-20 | floor (patch page on the PC, no stream) | none | 8.4 | 13.9 | 200 / 200 | 5.5 ms | Edge, 3440x1440 at 180 Hz; fastest 4.4, slowest 16.2; `results/floor-pc-20261120-034325.json` |
| | **yardstick: Sunshine to Moonlight** | home network | | | | | |
| | yardstick | bad line (loss and jitter added) | | | | | phase 5 |

## Rounds
One line per change: what changed, the numbers before and after, kept or dropped. None yet.

## Not yet measured, and why
- The yardstick: needs the laptop. The floor above is the PC's own share of every number: about a frame and a half
  of its 180 Hz screen (the browser draws the flip on its next frame, Windows composes it, the rig reads it). The rig
  can only read the screen once per refresh of the screen it runs on, so on a 60 Hz laptop its fineness will be about
  17 ms; the middle value over 200 presses is still fair between contenders, since the presses are spread unevenly.
- With `-Window` the rig takes the front back when another app pulls itself forward (the Claude app did, twice in
  the first tries) and says how many times; without it, it stops and keeps only what was measured in front.
- Delay without input (a moving clock): the rig's second mode, not written yet; the key-press round trip comes first
  because CONTROL is the point.
