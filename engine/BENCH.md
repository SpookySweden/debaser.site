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

### 2026-11-20: the engine reaches a browser (`debaser-engine serve`, `node bench/webrtc-check.cjs`)
The engine now sends its frames over WebRTC to a page it serves itself (this PC only unless a token is set), and a
check opens that page in a hidden Chrome and reads the browser's own counts. Run by me after the helper built it,
1080p, real screen content, the PC in use (Minecraft and the Claude app on the card), engine graphics priority off:

| Asked for | Got | In the browser's queue | Decoding | Arrival to decoded | Lost / dropped |
| --- | --- | --- | --- | --- | --- |
| 60 a second | 60.4 | 0.65 ms a frame | 0.73 ms | 1.45 ms | 0 / 0 |
| 120 | 112.8 | 0.32 | 0.73 | 1.12 | 0 / 0 |
| 180 | 160.0 | 0.28 | 0.78 | 1.10 | 0 / 5 at start-up |

- The browser decodes on the graphics card (`D3D11VideoDecoder`), and the "show at once" marker works: without it one
  run held frames 3.85 ms in the queue, with it 0.1 to 0.65 ms.
- From the engine having a frame encoded to handing it to the network: 0.3 to 0.7 ms.
- **The stages added up, same PC, before the browser draws anything:** Windows showing a frame to encoded 5 to 6 ms
  (see below), hand-off 0.3 to 0.7, loopback about 0, browser 1.1 to 1.5: **about 6.5 to 8 ms from the PC showing a
  frame to the browser holding it decoded.** This is not the glass-to-glass number the 7 ms yardstick means: the
  browser's drawing and the viewer's screen refresh come on top, and a real network sits in the middle. That needs
  the rig with a visible window, and the laptop.
- Not checked: any address but this PC's own, real packet loss, Edge and Firefox, a visible window.

### 2026-11-20: frames were stale when picked up, and the fresh-frame rule (switch 16, not a default yet)
In the live stream "Windows showed it to encoded" is 5 to 6 ms, against 3.3 ms in the bench. The difference is age:
at 60 frames a second on a 180 Hz screen, the engine rests between frames and then takes the newest one waiting,
which is on average half a refresh old before any work starts.

The rule: learn how often the screen is really changing; when a frame is found waiting and the next is due within
1.5 ms, wait for that one, so what gets encoded was shown a moment ago.

| Run (60 a second asked) | Without | With | Frames a second with |
| --- | --- | --- | --- |
| screen changing every refresh, first version of the rule | middle 5.08 and 6.13 ms, worst 5% 9.3 and 9.8 | **3.90 and 4.26, worst 5% 4.4 and 5.0** | 51 (too slow: it waited a whole refresh) |
| screen changing slower and unevenly, final version | middle 7.7, 7.7, 8.1, worst 5% about 15 | 6.7, 6.2, 4.5, worst 5% 12 to 15 | 54 to 56 |

Real, but not settled: what was on screen changed between runs (it was whatever the PC was showing), and the rule
costs a few frames a second. At 120 and 180 asked it changed nothing: there the engine is already taking frames as
fast as it can finish them. **To tune it fairly it needs a steady moving picture on the real screen** (a small
animated window for 15 seconds a run), which I have not opened on a PC in use.

### 2026-11-20: the fresh-frame rule tuned with a steady moving window (Luke: "Yes, go ahead")
A small window with a sliding bar was opened on the real screen for each 15-second run and closed after it; runs
alternated one-for-one between the two versions, so whatever else the PC was doing (a helper was compiling, Minecraft
was open) fell on both equally. 60 frames a second asked, "Windows showed it to encoded", middle value of each run:

| | Runs | Middle, each run (ms) | Average | Frames a second |
| --- | --- | --- | --- | --- |
| no rule (as on the branch) | 8 | 8.46 8.54 7.80 7.98 8.00 7.68 7.72 7.42 | **7.95** | 60 to 61 |
| **rule, waking 3 ms early, waiting up to 4 ms** | 10 | 5.41 5.86 5.37 5.36 5.46 5.38 5.32 5.44 5.24 5.37 | **5.42** | 57 to 63 |
| waking 3 ms early without the rule | 2 | 7.67 8.05 | 7.86 | 70 (overshoots) |
| rule, waking 5 ms early, waiting up to 6 ms | 2 | 4.95 4.64 | 4.80 | 59 to 65 (less steady) |

- **About 2.5 ms (a third) off the PC's side, every pair, with the frame rate kept.** What made the first versions
  fail: the engine rested until just before the next frame was due, woke a little late (Windows' sleeps are not exact)
  and so found the frame already waiting. Now it wakes 3 ms early and blocks inside Windows' own "next frame" call,
  which wakes it the instant the frame is shown.
- Waking early alone does nothing: it is the waiting-for-the-fresh-frame that pays.
- The worst 5% did not move (12 to 15 ms in both): that tail is something else, not yet found.
- Not shown: the rule on a screen that truly changes slowly. My window redrawing every second or third refresh gave
  the same numbers as every refresh, so something else on the desktop was changing every refresh anyway.
- **Kept: the rule becomes a default (waking 3 ms early, waiting up to 4 ms).**

### 2026-11-20: settings in the viewport, and the rule in the engine
- **Settings** (Luke: "it needs a settings button in the viewport ..."): the engine now takes a piece of the screen in
  any asked shape and shrinks it on the card, changes shape, size, frames a second and bitrate while the stream runs
  (`GET`/`POST /settings`), keeps to its own limits, and caps the stream while `League of Legends.exe` is running. The
  viewer page has the `[ SETTINGS ]` panel. `node bench/settings-check.cjs`, run by me: **10 of 10 parts pass**
  (`results/settings-check-20261120-073405.json`): MATCH THIS SCREEN on a pretend 1280x800 screen gives 1280x800 from
  the middle 2304x1440; 16:9 at 720 gives 1280x720; a 1920x1200 viewer gets 1728x1080; NATIVE gives 3440x1440; 30
  asked gives 30.8 a second; the pretend match caps it and what was asked comes back after; one connection throughout.
  A change freezes the picture for about 0.3 to 0.45 s (the encoder is reopened).
- Not judged by anyone's eyes: how the shrunk picture, SHARP and SHARPENED look; SHARPENED's added delay; the cap with
  the real game (only with a pretend switch); two viewers changing settings against each other.
- **The fresh-frame rule is now a default** (switch 16, waking 3 ms early, waiting up to 4 ms). Stream check with the
  defaults on a calm screen: 60.0 frames a second, Windows showed it to encoded **middle 3.88 ms, worst 5% 4.68 ms**,
  hand-off 0.10 ms, in the browser 0.58 ms: **about 4.6 ms from the PC showing a frame to the browser holding it
  decoded** (same PC, before the browser draws it; one run, a calm screen, so the encode was light).

### 2026-11-20 evening: the first screen-to-screen number, and CONTROL
**Screen to screen** (`bench/glass.ps1`): two small windows on the real screen, the patch flipping by itself in the
middle (where the engine looks) and a visible Edge viewer at the left (where it does not). The rig presses nothing and
takes no window to the front; it reads both in one grab of the screen and times the gap between the PC's own patch
changing and the stream's copy of it changing. That gap is the whole stream, browser drawing and screen refresh
included, on this one PC (no real network in it). Windows scales this desktop to 125%, which the runner allows for.

| Asked | Flips seen | Average | Middle | Worst 5% | Least | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 60 a second | 40 of 40 | **17.1 ms** | 16.7 | 28.0 | 5.7 | the PC in use, no match; `results/glass-60-20261120-205418.json` |
| 180 a second | 40 of 40 | 30.8 ms | 23.0 | 66.2 | 11.3 | **not to be trusted**: a League match was loading during this run; the next run was stopped by the match guard before its first flip |

- Against the assumed 7 ms yardstick: **not beaten. 17 ms at 60 a second.**
- Where the 17 ms goes, from the stages measured separately: the PC's side 3 to 4 ms; the browser about 1 ms to
  decoded. That leaves about 12 ms unaccounted for by those two. Two suspects, neither measured yet: a change on
  screen waiting for the stream's next frame (at 60 a second the engine rests about 14 ms of every 17, so a change
  waits about 5 to 6 ms on average: sending more frames a second removes most of it), and the browser getting a
  decoded frame onto the screen (its own drawing step and the screen's refresh).
- Next: clean runs at 60, 120 and 180 with no match loading; then the browser's drawing step.
- What went wrong on the way, now fixed in the runner: Windows' 125% scaling put the windows elsewhere than
  assumed; a browser profile that had been closed by force reopened its windows minimised (a fresh profile each run,
  and the runner places the windows itself); pressing keys and taking the front window fought the League client for
  it (now hands-off); a match starting mid-run now stops the rig at once.

Later the same evening, **no further clean number**: three runs straight after a match saw the patch covered by
the game's own after-match window (6 of 40 flips, then none), and six runs when the PC had gone quiet saw nothing
change at all, because with nobody at the PC its screen was off and nothing is drawn. So this measurement needs the
screen on and no match running, which means Luke at the PC and willing to have two small windows up for half a
minute a run. The spoiled runs' files are not kept.

### 2026-11-20 22:10: clean screen-to-screen runs (Luke at the PC: "Now is fine")
Same hands-off set-up, 60 flips a run, every flip seen in every run, one after another within five minutes:

| Asked | Switches | Average | Middle | Worst 5% | Least | Most | File |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 60 a second | defaults then (29) | **17.0 ms** | 16.3 | 26.3 | 5.4 | 45.4 | `glass-60-t29-20261120-221148.json` |
| 120 | 29 | **11.5 ms** | 11.0 | 16.7 | 9.4 | 17.9 | `glass-120-t29-20261120-221234.json` |
| 180 | 29 | 14.7 ms | 16.2 | 17.0 | 9.9 | 17.6 | `glass-180-t29-20261120-221316.json` |
| 60 | 29 + the piece rule (61) | **12.0 ms** | 9.9 | 20.8 | 8.2 | 27.9 | `glass-60-t61-20261120-221359.json` |
| 180 | 61 | **10.8 ms** | 10.6 | 12.1 | 9.4 | 17.0 | `glass-180-t61-20261120-221443.json` |

- **Best so far: 10.8 ms screen to screen, worst 5% 12.1 ms** (180 a second with the piece rule). The assumed 7 ms
  yardstick is still not beaten.
- **More frames a second is the biggest single lever**, as predicted: 17.0 at 60 against 11.5 at 120.
- **The piece rule (switch 32) is worth 4 to 5 ms in this set-up** (17.0 to 12.0 at 60; 14.7 to 10.8 at 180), one
  clean pair at each rate. In this set-up the viewer window sits on the PC's own screen, outside the piece being
  sent, and keeps changing; without the rule every one of those changes was encoded as a frame and the engine was
  resting when the patch flipped. On a second device the viewer is not on the PC's screen, so the gain there will be
  smaller: it applies to anything changing outside the piece (the cut-off sides of an ultrawide, a second monitor).
  **Kept: it is now a default.**
- **The floor of this set-up is two refreshes of the screen (about 11 ms)**: the least in the good runs is 9.4 to
  9.9 ms and the rig reads in steps of 5.6 ms. Getting under it means the browser showing a decoded frame one refresh
  sooner (its own drawing step), which is the next thing to look at; the PC's side and the network on one PC together
  are about 4 ms of it.
- A second series ten minutes later was thrown away: values below zero and above two seconds, which means something
  else was changing the two spots being watched (a pointer passing over them, a window moved or clicked while the PC
  was in use). The rig now sets such flips aside and refuses to report when more than a quarter are like that. Of that
  series only the middle values of two runs with the rule on looked sane (10.5 ms at 120, 11.0 ms at 180), which
  agrees with the table but is not counted.
- Earlier tonight the measurement also refused to see the patch when run in a row from one command and worked when
  each run was its own job; why is not known. It is run as its own job now.

### 2026-11-20 22:35: the browser's drawing step (Luke: "Drawing step")
The question: of the two screen refreshes the stream's copy lags by, can the browser be made to give one back? Two
experimental ways of drawing were added to the viewer, asked for in its address and not yet keys: `draw=fast` (each
frame taken straight off the stream as it is decoded and put on a low-latency 2D canvas) and `draw=fastgl` (the same
onto a low-latency WebGL canvas), against NORMAL (the `<video>` element). 180 a second, the piece rule on, two runs
of 50 flips each way, taken in turn, every flip seen, none disturbed. The viewer here is Chrome.

| Drawing | Average | Shown after 1 refresh or less | after 2 | after 3 or more |
| --- | --- | --- | --- | --- |
| NORMAL (`<video>`) | 10.99 ms (12.0, 9.97) | 9% | 81% | 10% |
| fast, 2D canvas | 10.46 ms (11.37, 9.55) | 12% | 83% | 5% |
| **fast, WebGL canvas** | **9.64 ms** (9.94, 9.34) | **28%** | 67% | 5% |

- **A modest, real gain from the WebGL way: about 1.3 ms on average**, by getting more than a quarter of frames onto
  the screen one refresh sooner (against a tenth), and none later than three. The 2D way is no better than NORMAL
  beyond what two runs can tell.
- **Most frames still take two refreshes whatever the browser does.** To be on the very next refresh of a 180 Hz
  screen, capture, encode, the hop, decode and drawing together have to finish in about 4 ms, and they take about
  4.5 to 5. On a 60 Hz screen (a laptop) one refresh is 16.7 ms, so the same chain would make the very next refresh
  every time: the viewer's own screen then sets the delay, not the stream. That cannot be measured without the laptop.
- **Best measured so far: 9.3 ms average** (one run), about 9.6 over two. The assumed 7 ms is not beaten on this PC's
  180 Hz screen.
- Not done: the WebGL way as a proper key. As an experiment it ignores the UPSCALING choice, and CONTROL's pointer
  mapping was not checked with it.

**What kept making runs fail tonight, found:** a fresh Edge profile signs itself in to the Windows account and puts
a box saying so over the page, which covered the patch. The test windows now open in Chrome (fresh profile, sync
off), and all six runs above worked first time. Every throwaway test profile is deleted after its run, and the
leftover ones from earlier tests were deleted too.

### 2026-11-21: the efficiency round (Luke: "get it implemented into the site at its best efficiency")
Built by the helper, every check run again by me (16 unit tests; settings 12 of 12; control 9 of 9 dry-run parts,
the real nudge not re-run by me this time; stream check passes):
- **FAST drawing is now a real choice and the default** (DRAWING: FAST / NORMAL): frames straight onto one
  low-latency WebGL canvas, every UPSCALING choice drawn by it, CONTROL's pointer places right in all of them
  (checked for each), falling back to NORMAL with a line saying so. This is the 9.64 ms way from the drawing-step
  table. Its delay was not re-measured after becoming a key.
- **FRAMES A SECOND has AUTO, the default**: the page measures its own screen's rate and the PC sends
  min(that, its own screen's rate, its limits, the match cap). Checked: a pretended 144 Hz viewer gets 144, a 240 Hz
  one gets 180, the match cap still gives 60. So a viewer on this PC now asks for 180.
- **A still screen costs a fifth** (switch 64, a default; defaults are now 125): `node bench/still-check.cjs`, run by
  me: 34.6 frames and 982 kbit a second before; **2.0 frames and 177 kbit a second** with the rule (18%); the picture
  stays up; a viewer joining mid-rest got its full picture 14 ms after connecting (helper's run). Not shown: that a
  busy screen keeps full speed (both runs fell on a nearly still screen and said "could not tell"); the code path
  for a changing screen is the one the other checks use.
- **The home-network link**: `--lan` (video reachable from the home network while the web address stays on this PC)
  and `--trust-host` (so the site's own server may pass requests on). **Never run**: binding the home network makes
  Windows show its firewall prompt, which is Luke's to answer. Unit tests only.

**Switch 32, written before those runs (kept for the record):** a change somewhere else on the screen is no longer treated as a new
frame of the piece being sent (Windows says which rectangles changed). It should stop identical frames being
encoded, and stop the engine resting just before the piece itself changes. It builds and the stream check still
passes with it on, but the only runs so far were on a still screen, where it has nothing to do.

Also seen on a still screen: the engine sends about 32 repeats a second at about 2.4 Mbit/s. That is bitrate spent
on a picture that is not changing; sending far fewer repeats when nothing changes is an easy saving, not yet made.

**CONTROL** (spec phase 2; `serve --allow-control`, off without it): mouse, keys, buttons and wheel from the viewer
page drive this PC over two WebRTC data channels, one device at a time. Refused while `League of Legends.exe` is
running and ended at once if a match starts; everything held is let go however control ends; Ctrl+Alt+Shift+End on
the PC stops it; a text strip along the top of the PC's screen while it is held. `node bench/control-check.cjs`, run
by me after the helper built it: **10 of 10** (`results/control-check-20261120-205252.json`), 12 unit tests, and the
settings and stream checks still pass (stream: 3.05 ms shown to encoded, worst 5% 3.68).
- Proved in a dry run that records what would be sent and touches nothing: pointer places within 1 pixel on two
  shapes and however the page draws the picture, scan codes for ten keys, buttons, wheel, every way of ending,
  one device at a time, the pretend match.
- Proved for real: Windows accepted a 2-pixel pointer nudge and back (1927,1347 to 1929,1347 to 1927,1347); the strip
  is up, on top, click-through and never active while controlled; the cut-off ends control when the engine is sent
  the signal Windows sends for that key.
- **Never done for real: a key press, a click, a wheel turn, an absolute pointer move, a real press of the cut-off
  keys, a real League match.** Nobody has used it by hand.
- Known gaps: killing the engine outright leaves a held key held; the stream carries no pointer, so the viewer draws
  a plain arrow, not the PC's own pointer shape; Windows refuses injected input over an administrator's window and
  the viewer is not told; controller and sound are not built.

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

## The second encoder: Windows' Media Foundation (2026-11-22)
For SERVER (Intel UHD 630, no NVENC): native/mf.cpp drives the card's own hardware encoder through Media Foundation
(low-latency mode, CBR, no B-frames, Baseline, the NV12 picture handed over card-side). Chosen when nvEncodeAPI64.dll
is missing, or with DEBASER_ENCODER=mf. Measured on the gaming PC through NVIDIA's own Media Foundation encoder
(bench-encode, 3440x1440 at 60 fps, 20 Mbit/s, 300 frames): encode middle 3.13 ms, worst 5% 5.34 ms, p99 16.4 ms;
Windows showing it -> encoded middle 3.68 ms. Stream: AUD, SPS, PPS, IDR, then P frames; profile 66 (Baseline).
drive-screens --only open with DEBASER_ENCODER=mf: 18 of 18 (decoded in Chrome, resized to 1280x720, control,
sound, controller, pointer). Intel's encoder itself not measured yet (on SERVER).

### Intel UHD 630 on SERVER (Windows 11), through Media Foundation (2026-11-22)
bench-encode 1920x1080 at 60 fps, 12 Mbit/s, 300 frames, DEBASER_MF_TRACE=1, from the console session:
- First builds: every way of getting a frame back took ~16 ms (low-latency mode on: 16.0 ms; off: 1 ms but one call
  late; drain-per-frame: 16 ms), at 720p and at 30 fps too. Cause: Windows 11 ignores a windowless program's fine-timer
  request, so the encoder wait's "Sleep(1)" was ~15.6 ms.
- After 9a19f64 (awake waits, ProcessPowerThrottling opt-out): low-latency mode, no settings: encode middle 6.33 ms,
  worst 5% 10.57, p99 11.70 (in -> ready 6.56 ms). Drain mode the same (6.48). At 1280x720: middle 3.81 ms, p99 7.40.
  SERVER's running engine uses this build, low-latency mode, no extra settings.

## The "wait in buffer" over the home network (2026-11-22, Luke: "why is the wait in buffer so high ... 9.7ms")
`node engine/bench/network-check.cjs` (new): a headless Edge on SERVER watches a running engine and reads the browser's
own counts in 2-second stretches. Chrome and Edge start the "wait in buffer" clock (jitterBufferDelay) when a frame's
FIRST packet arrives, so it includes the time the rest of the frame takes to arrive (totalAssemblyTime).

| Viewer on SERVER watching | wait in buffer | of it: packets arriving | of it: held by the browser | decode | round trip |
| --- | --- | --- | --- | --- | --- |
| SERVER's own engine (same machine, 720p, quiet screen) | 0.3 ms | 0.3 | about 0 | 0.5 | 1 ms |
| the gaming PC's engine over its Wi-Fi (2580x1080, 64 fps, 10.5 Mbit/s) | 9.1 ms | 8.9 | 0.2 | 0.7 | 11 to 33 ms |

- The first (full) picture, about 45 to 60 KB in 50 to 60 packets: first to last packet 0.3 to 0.4 ms on the same
  machine, 4.9 to 7.3 ms over the Wi-Fi. The engine sends a frame's packets at once (str0m's null pacer drains a frame
  in one go); the spread is the Wi-Fi hop.
- The playout-delay marker (least and most 0) is honoured: the browser holds a complete frame 0.1 to 0.2 ms.
  jitterBufferTarget = 0 and playoutDelayHint = 0 can only stop the browser adding a wait; they cannot shorten the
  network's.
- Frames arrive unevenly over that Wi-Fi (spread of the gap between frames 8 to 10 ms at 64 fps).
- The viewer's readout averaged since the start of the connection; it now looks at the last 3 seconds and splits the
  number into "frame arriving" and "held", with the round trip beside it (app/lib/screens/frame-times.ts).
- Not measured: Luke's laptop itself (the readout now shows it there); SERVER to a viewer on a cable.

## The picture's addresses, read at every hello (2026-11-28)
The gaming PC's engine, started at sign-in, read this PC's addresses once, before the Wi-Fi had one: four starts in a row
logged `video leaves from 127.0.0.1` only, and no viewer in those runs ever connected. They are now read at every
viewer's hello. `cargo test` on the gaming PC (2026-11-28): the new test (a pretend address list; the real hello)
fails with the list read once (`["127.0.0.1"]` after the Wi-Fi "came up") and passes with the fix. Run over SSH, 31 of
33 pass; `the_real_modes_are_listed_without_changing_anything` and `the_screen_is_found_without_opening_anything` need a
signed-in screen and fail the same way on the source before this change (the second crashes the test program, so skip
both there: `cargo test -- --skip the_real_modes --skip the_screen_is_found`).

On the real PC the same day (engine file swapped on Luke's OK): its log said `video leaves from ... 192.168.0.30`; a
watch-only viewer in SERVER's Edge (a local dev server on mock data, THE PC :: OUR ENGINE) decoded 2580x1080 H.264 sent
from 192.168.0.30, direct on the home network, and the PC logged `viewer 1 connected 128 ms after its hello`. Not tried:
a restart of the PC; Luke's laptop.

## The router port, and a viewer from an address it never announced (2026-11-28)
Luke, 2026-11-28, to whether the engine may ask the router for a port by itself: "Yes, automatically". `src/portmap.rs`
(new) asks the home router by UPnP for the picture's one UDP port, an hour at a time, and gives it back at the end;
`serve --internet --router-port` runs it. No delay was measured: the port changes which networks can connect, not how
fast a connected picture is (the line is the same direct one as `--internet`).

`cargo test` on the gaming PC over SSH (`-- --skip the_real_modes --skip the_screen_is_found`, as above): 41 of 41 pass.
Eight are the router port's, against a pretend router on 127.0.0.1 that answers in the Virgin Hub 5's own recorded words
(the Hub's own answers read, and a description that points anywhere but the router itself not followed; asked for an
hour and given back; nothing opened on any doubt; a router that will not say how long it holds the port; the keeper
asking again and giving back at the end; a refusal after it was open; a router that will not renew what it still
holds; a router that opens the port with no time limit and then refuses to close it: asked until it does, never asked
for a port again); one is the hello and the settings saying it; one is the direct way's own: a viewer that announces
one address and really sends from another still connects, over real sockets. One deliberately broken build (no time
limit asked instead of an hour; no give-back at the end; the opened port never offered; packets from an unannounced
port ignored; a description allowed to name any address; a port with no time limit never chased) fails 10 of the 41,
each of the six breaks caught by at least one test. Release file: 5,068,800 bytes, SHA256 B2CE8AF3...3ED9.

A fresh pair of eyes read the change before it was built for the last time (the `code-reviewer` agent) and found two
gaps, both closed and both now tested: a router's description could have sent the engine's requests to an address
off the home network, and a port a router opened with no time limit would have stayed if its removal failed once.

Not measured, not proved: the real Hub giving the port (no test engine may ask it; known once the PC runs this file);
a packet from outside the house; a phone hotspot or a campus network (Luke's own try).

## The way through the site: the gate (2026-11-28)

Measured before anything of it is built (SPEC-screens.md, "Away from home with no setup"): a made-up stream of random
bytes at the real size and pace (60 frames a second, 3.5 Mbit/s, one 45,000-byte "full picture" every ten seconds),
sent by `scripts/host/screens-site-gateway.cjs --gate` on SERVER and watched by `engine/bench/site-way-gate.cjs` down
three paths at the same time for ten minutes, with `npm run build` started 240 seconds in (it ran 59 seconds):

    node engine/bench/site-way-gate.cjs --via gateway=ws://127.0.0.1:8481 --via site=ws://127.0.0.1:3000 \
         --via tunnel=wss://debaser.site --browser tunnel --seconds 600 --during "npm run build" --at 240

Results file: `bench/results/site-way-gate-20261128-121948.json`. One run, SERVER, commit b52c814 live.

| path | there and back, ms (middle / 95% / 99% / worst) | frames lost or skipped | gaps over 100 ms / 250 ms | frames arriving paired |
|---|---|---|---|---|
| straight from the gateway (this script) | 0.5 / 1 / 2 / 17 | 0 | 1 / 1 (the last second, see below) | 0.06% |
| through the site's own program only (this script) | 0.7 / 1.8 / 5.2 / 385 | 0 | 6 / 2 | 0.24% |
| through Cloudflare and the tunnel (hidden browser on a page of debaser.site) | 52.1 / 63.4 / 69.9 / 172 | 0 | 6 / 0 | 4.48% |

- **There and back** is a frame out and the browser's word back, the browser's own handling time taken off, on the
  gateway's clock alone. One way, for the picture, is about half: 26 ms. The other reading, the frame's stamp against
  the browser's clock, said 38 ms in the middle (least 25, 95% 48, 99% 53, worst 268), but two programs on one machine
  do not agree on the time to better than a few ms (the script's own watcher read 5.7 ms on a path whose round trip
  was 0.5 ms), so the true one-way figure lies between the two. The plan's bar was 30 to 45 ms one way: met.
- **Lumps.** Through the tunnel about 1 frame in 22 arrived within a millisecond of the one before although they left
  16 ms apart, and the time between frames was 20 ms in the middle and 40 ms at 99%. Pairs, not batches: nothing was
  held back for longer and released together. The viewer will need a few frames of patience to play it evenly.
- **Stalls.** No gap over a quarter of a second through the tunnel in ten minutes; 36 gaps over 50 ms, 6 over 100 ms.
- **A heavy step on SERVER shows.** During the build the tunnel path's 99% went from about 52 ms late to 148 ms and
  its worst to 268 ms; the site-only path's worst went from about 15 ms to 159 ms; straight from the gateway stayed
  under 20 ms. So it is the hop through the site's own program (and the tunnel's) that waits when SERVER is busy, not
  the gateway. It recovered by itself, and nothing was lost or skipped. One more blip 30 to 60 seconds in (tunnel 211
  ms, site 118 ms) with nothing of mine running: SERVER was busy with something else.
- **The line never backed up:** the gateway skipped no frame and never had a byte waiting on the tunnel path.
- **The door:** by every path, a stranger with the wrong words or none got a closed line and no frame. With the
  gateway's check broken on purpose the same test fails (360 frames reached the stranger).
- **The site's program passes a websocket along** (one `rewrites()` line): first proved on a local build
  (127.0.0.1:3391: 1,199 frames in 20 s, none lost, no lumps), then on the live site above. No tunnel rule was added.

Not what it looks like: the "worst" of 413 and 463 ms on the two local paths is the last second of the run, when the
measuring script was busy fetching the browser's numbers and read its own two sockets late. The browser's path has
no such second.

Not measured, not proved: a real picture (these are random bytes: no decoding, no engine, no home-network hop from
the gaming PC); a viewer away from home (this browser sat on SERVER, so its leg to Cloudflare was the house's own
line; an away viewer has theirs instead); a poor line (a websocket resends what is lost instead of skipping it, so a
bad line will stall where the direct way would only smear); how it feels. Screen to screen through the site is still
an estimate: 80 to 150 ms, against 12 to 17 at home.
