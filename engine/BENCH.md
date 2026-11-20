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
| 2026-11-20 | **yardstick: Sunshine to Moonlight** | home network | **7 (assumed)** | | | | Luke: "for now assume the yardstick is 7ms". Not measured: taken as what the stream adds on top of the floor, glass to glass. To be replaced by the laptop run. |
| | yardstick | bad line (loss and jitter added) | | | | | phase 5 |

## Rounds
One line per change: what changed, the numbers before and after, kept or dropped.

### 2026-11-20: the engine's first piece (grab the screen, encode on the NVIDIA chip)
`engine/` builds with `cargo build --release`; `debaser-engine bench-encode` times each step on this PC. No network,
no viewer yet, so nothing here is comparable with the 7 ms yardstick: these are the host's share only.

| What | Result | Status |
| --- | --- | --- |
| Taking the frame from Windows and copying it on the card | under 0.1 ms (worst 5% 0.13 ms) | solid: the same in every run |
| Encoding 3440x1440 H.264, fastest preset | middle 5.4 ms, worst 5% 11 ms (one run) | one run only |
| Encoding 1920x1080 H.264 | middle between 1.6 and 4.9 ms across runs with identical settings | **not settled**: the PC's other work (a game and browsers were open) moves it more than any setting |
| Graphics priority for the engine (tweak 1) | worst 5% of "shown to encoded" 5.1 ms against 9.8 ms without, one run each | promising, not proved |
| The encoder's event mode (tweak 4), one-pass (tweak 8) | faster in some runs (1.6 to 2.0 ms), no different in others | not proved |
| Fine Windows timer (tweak 2) | no change seen | dropped unless a later run says otherwise |

What this does say: the grab is free, the encoded stream is valid H.264 (checked: it starts with a proper header), and
the encode is the host's whole cost: 2 to 5 ms at 1080p, so the 7 ms target leaves 2 to 5 ms for the network, the
decode and the viewer's screen together.

Single runs disagree with themselves, so settings are judged only by `bench/compare.ps1`, which takes every setting
in turn several times round (`-TweakList "0,1,4,8,13"`; its first two runs were thrown away: `powershell -File` read
the list 0,1,4,8,13 as the one number 148,513).

### 2026-11-20: which settings to keep (1080p H.264 at 60 fps, changed frames only, middle of the rounds)
Quiet PC, 6 rounds (`results/compare-tweaks-20261120-060623.json`):

| Setting | Encode middle | Encode worst 5% | Shown to encoded, middle | worst 5% |
| --- | --- | --- | --- | --- |
| none | 3.03 ms | 4.38 | 3.66 | 5.23 |
| graphics priority (1) | 3.26 | 4.09 | 3.90 | 4.41 |
| event mode (4) | 3.50 | 4.25 | 3.98 | 5.02 |
| one pass (8) | 2.74 | 3.57 | 3.25 | 3.99 |
| priority + event (5) | 3.18 | 3.89 | 3.70 | 4.36 |
| **priority + event + one pass (13)** | **2.79** | **3.51** | **3.26** | **3.82** |

**While a game was running** (Luke started GTA V during the confirming run; the game was using about 75% of the
graphics card), 8 rounds (`results/compare-confirm-20261120-060912.json`):

| Setting | Encode middle | Encode worst 5% | Shown to encoded, middle | worst 5% |
| --- | --- | --- | --- | --- |
| none | 16.37 ms | 33.76 | 17.70 | 39.69 |
| one pass (8) | 13.41 | 29.53 | 16.69 | 37.26 |
| priority + one pass (9) | 14.25 | 32.12 | 17.27 | 37.46 |
| **priority + event + one pass (13)** | **11.57** | **29.37** | **12.72** | **32.98** |

Kept as the engine's defaults: **13** (priority, event mode, one pass). Dropped: the fine timer (no change).

What this says:
- On a quiet PC the host's whole share is about **3.3 ms** from Windows showing a frame to the encoded frame in
  memory, worst 5% under 4 ms.
- **With a game on the card it is four to five times worse** (12 to 18 ms, worst 5% over 30 ms). The encoder chip is
  separate, but the frame has to queue behind the game for the card's attention before it gets there. This, not the
  quiet number, is what "streaming a game" costs, and it is the biggest thing found so far.
- The settings help by about 30% under load, which is nowhere near enough for a 7 ms target while a game runs.

### 2026-11-20: shortcuts that did NOT help (Luke: "continue on optimisations with creative methods")
Tried in a side copy of the engine, on a steady moving picture (the desktop slid sideways 8 pixels a frame, so every
run encodes the same motion whatever is on screen), 1080p H.264, every setting in turn 6 to 8 times round. GTA V was
still open at about 60% of the card for these, and the base figure was the same 3 ms as on the quiet PC, so the
12 to 18 ms above belongs to what the game was doing then, not to a game merely being open.

| Tried | Encode middle | against base | Verdict |
| --- | --- | --- | --- |
| base (the kept defaults) | 3.04 ms | | |
| simpler bit-packing (CAVLC) | 2.98 | -0.06 | noise |
| no edge-smoothing pass | 3.01 | -0.03 | noise |
| one reference frame | 2.93 | -0.11 | noise |
| four strips per frame | 3.01 | -0.03 | noise |
| colour conversion on the card's video unit | 3.29 | +0.25 | slower |
| no-sleep wait for the encoder (burns a core) | 3.28 against 3.29 | 0 | nothing |
| telling the card to start the copy early | 3.10 against 3.29, but shown-to-encoded 3.23 against 3.30 | 0 | only moves time between columns |

None is kept. The encode is not waiting on our code or on coding choices: it is the chip's own speed.

**Where the 3 ms goes** (same moving picture, three times round):

| Picture | Pixels | Encode middle |
| --- | --- | --- |
| 640x360 | 0.2 million | 1.7 ms |
| 1280x720 | 0.9 million | 2.2 ms |
| 1920x1080 | 2.1 million | 3.1 ms |
| 2560x1440 | 3.7 million | 4.2 ms |
| 3440x1440 (the whole screen) | 5.0 million | 5.4 ms |

About **1.5 ms that every frame pays, plus 0.8 ms per million pixels**. So on the host there are only three real
levers left, and they are where the creative work goes next:
1. **Fewer pixels.** 720p costs 0.9 ms less than 1080p here and about half the decode on the viewer; a sharpening
   upscale on the viewer (the trick games use to render small and show large) would hide most of the difference.
2. **Less waiting, not faster work.** At 3 ms a frame the engine can keep up with this 180 Hz screen. A viewer that is
   sent 180 frames a second always has a frame at most 5.6 ms old when its screen refreshes, against up to 16.7 ms at
   60: an average of about 5 ms saved for no faster encoding. Then timing each frame to land just before the viewer's
   refresh.
3. **Not queueing behind a game** (below).

**Rate.** Asked for 60, 120, 180 and 240 frames a second of the same moving 1080p picture, the encode stayed at 3.2 to
3.4 ms a frame in the two undisturbed rounds (the other two were disturbed by programs starting and stopping). So the
host can feed a 180 Hz viewer a fresh frame every refresh; lever 2 is open on this side.

**This PC is never quiet.** With no game at all, the Claude app itself was using about 39% of the card's 3D unit and
Minecraft 15% during the last runs; the kept defaults still beat no settings by about 12% (3.28 against 3.72 ms). A
true empty-card figure has not been taken and would need the PC left alone with the apps closed.

Next things to try for the under-load number, in order:
1. **Top graphics priority.** Windows has a "realtime" class above the "high" one used here; it needs the engine to
   run with administrator rights (Sunshine gets it by running as a Windows service). Needs Luke's click on a
   permission prompt.
2. Hand the encoder the picture already in its own colour format, converted on the card's video unit instead of its
   3D unit (the 3D unit is what the game is saturating).
3. Capture only when the game has a new frame ready, and cap what is asked of the card.
Benchmarks stop while a game is running unless Luke asks for the under-load number: the high-priority setting takes
card time from the game.

## Not yet measured, and why
- The yardstick: needs the laptop. The floor above is the PC's own share of every number: about a frame and a half
  of its 180 Hz screen (the browser draws the flip on its next frame, Windows composes it, the rig reads it). The rig
  can only read the screen once per refresh of the screen it runs on, so on a 60 Hz laptop its fineness will be about
  17 ms; the middle value over 200 presses is still fair between contenders, since the presses are spread unevenly.
- With `-Window` the rig takes the front back when another app pulls itself forward (the Claude app did, twice in
  the first tries) and says how many times; without it, it stops and keeps only what was measured in front.
- Delay without input (a moving clock): the rig's second mode, not written yet; the key-press round trip comes first
  because CONTROL is the point.
