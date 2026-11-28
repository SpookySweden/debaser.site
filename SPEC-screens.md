# SPEC: SCREENS — sharing a screen in a room and controlling your own devices, on our own engine

Luke, 2026-11-20: "do some research into the open source code of sunshine and moonlight the apps that allow you to stream
and recieve with extremely low latency, look for improvements and ways to best incorporate this as a feature in the site",
then "Spec it".

Status: **waiting for Luke's OK.** Nothing is built, installed or changed. The research behind this is in the sessions'
notes folder (`sunshine-research.md`); the parts that matter are repeated here.

Words used here: **the engine** is a small program of our own that runs on a PC, grabs its screen, and takes mouse, keys
and controller from another device. **A share** is one screen being shown in a room. **CONTROL** is one of your devices
driving another. **The relay** is Cloudflare's live-video service that copies one stream to many watchers.
**The yardstick** is Sunshine (on the PC) to the Moonlight app (on the laptop), the thing to beat.

## Where it stands (2026-11-21)
This section is the first slice as it was on 2026-11-21, before the merge: the engine is on `main` and running since
2026-11-22 ("Our engine both ways", below). The numbers and what is and is not proved are in `engine/BENCH.md`.
- **The engine** (`engine/`): grabs the screen, encodes on the NVIDIA chip, sends to a browser by WebRTC, changes
  shape, size, rate and bitrate while streaming, caps itself during a League match, takes mouse and keys from the
  viewer (`--allow-control`; refused during a match). Best measured on this PC: about 9.6 ms from its screen to the
  stream's copy of it.
- **In the site** (phase 3, first slice): `[ SCREEN ]` beside `[ VIS ]` and `[ CANVAS ]` in any room, shown to the
  PC's owner only, with `[ SETTINGS ]` and `[ CONTROL ]`. The site's server on the PC checks the sign-in and passes
  the "hello" to the engine on the same PC; no database change. Proved locally (`npm run verify`,
  `Temp/check-screens.cjs`, `scripts/drive-screens.cjs` 11 of 11). **Nobody has looked at it.**
- **Works today only in a browser on the PC itself.** The laptop needs the engine started with `--lan` (Windows will
  ask Luke about its firewall); away from home is phase 5; friends watching in a room is phase 4 (needs the
  Cloudflare key).
- **To go live it needs from Luke:** his OK for main; one line in the PC's site settings naming his account
  (`SCREENS_OWNER_ID`); the engine added to what the PC keeps running.

## Luke's answers (interviewed 2026-11-20, twelve questions)
| Question | Answer, in his words where he added any |
| --- | --- |
| How a screen is sent | "not using obs, whatever sunshine and moonlight uses is so much faster and low latency, it needs to be cutting edge to be implemented here and interactable even for gaming" |
| Who may share | "hosts and crowns, screen shares show as a tab next to vis and canvas." |
| The queue while sharing | The share is its own tab, so the queue carries on. "audio streams are kept separate, if the user is signed into the same account on two devices, they choose which device and which screen to share, and can control one device directly from the other with a "control" button which works as seamlessly as the referance" |
| Which engine | "find a way to surpass sunshines speed with our own, persist and loop" (first: "look into other ways perhaps through the planned extension persist") |
| The road | Fast lane for control, relay for watchers. |
| Who may control | Own devices only. |
| Earning the right to control | Signed in is enough. |
| How many shares at once | No limit. |
| Who may watch | Whoever the room lets in. |
| CONTROL from where | Anywhere, direct when possible. |

## Said once, before building (disagreeing is part of the job)
1. **Our own engine is the long road.** Sunshine is years of work by many people. Ours can be much smaller because it
   only has to do your case (Windows, an NVIDIA card first, a browser on the other end), but it is still the biggest
   thing this project has taken on: a second program, in a second language, outside the site's build and checks.
   My honest size: **25 to 40 sessions over several weeks**, and the engine is built with a programming toolchain
   (Rust, already on the PC).
2. **"Surpass Sunshine" is real in some places and not in others.** See the table below. The video chip is the same
   chip whoever drives it, so the win is not there. It is in what Sunshine doesn't do at all.
3. **"Signed in is enough" makes your site account the key to your PC**, and the PC is the site's server: database,
   keys, backups. Anyone who gets into your account (a guessed password, a stolen Google session, a laptop left open)
   has your desktop. I have built in the protections that cost you no clicks (below), and I recommend 2-step sign-in on
   the Google account you use here. It is your call and this spec follows it.
4. **League cannot be controlled this way, by us or by Sunshine.** Since May 2024 Riot's anti-cheat (Vanguard) ignores
   mouse input that software injects once a match starts. 27 people report it for Sunshine and Parsec on one tracker,
   open since 2024-05-24 (github.com/RiotVanguard/Vanguard/issues/70, read today; that tracker is not Riot's own). The only
   workaround reported forwards a real USB mouse over the network, and one person there says they were banned while
   trying. **Sharing League for others to watch works; playing League from your laptop does not, and I advise against
   trying workarounds on your account.** "Interactable even for gaming" holds for other games.
5. **"No limit" on shares** can use up Cloudflare's free allowance (below). The spec pauses new shares at the free
   limit instead of ever billing you, unless you say otherwise (decision D2).
6. **No "planned extension" is written down anywhere I could find.** What I checked: a browser extension can do nothing
   a page can't for speed, and neither may move a PC's mouse or keys; browsers forbid it. So a device that is
   controlled needs the engine installed once. If you meant a specific extension, tell me (decision D5).

## The honest target
Estimates until the yardstick is measured on your own two machines (phase 0). "Frame" = one sixtieth of a second, 17 ms.

| Where | Sunshine to the Moonlight app | Ours | How |
| --- | --- | --- | --- |
| Moving the pointer on a desktop | the whole round trip, 2 to 4 frames | **feels instant** | the viewing device draws the pointer itself |
| Wobbly Wi-Fi or the internet | fixed quality: smears, freezes, big catch-up frames | **stays smooth, softens instead** | it watches the line and adjusts (Sunshine only writes losses to its log); gentle repair instead of full-picture resends |
| A room of watchers | one encode per viewer | **one encode for everyone** | the relay |
| What the other device needs | the Moonlight app | **a browser tab** | |
| Who can get in | anyone paired sees and drives everything | **the site's accounts, rooms and crowns** | |
| Raw delay on a clean home network | about 1 to 2 frames | first **within one frame of it** (a browser tab costs about a frame), then the loop below to equal and beat it | capture faster than the screen, time the send to the viewer's screen, skip the browser's queue, send strips of a frame as they finish |
| The video chip's own time | the same chip | **the same** | cannot be beaten |
| Playing League from another device | blocked by Vanguard | **blocked too** | not attempted |

## What Luke will see

### In a room
- **`[ SHARE SCREEN ]`** on the room's bar, for the host and anyone with a crown. It opens a small list: **your devices**
  that run the engine (`DESKTOP`, `LAPTOP`), each with its screens and open windows to pick from, and **THIS BROWSER**
  (the browser's own share prompt, nothing installed, watch-only).
- **Each share is a key beside `[ VIS ]` and `[ CANVAS ]`**, named for the sharer: `[ LUKE'S SCREEN ]`. Pressing it puts
  that screen on your own copy of the room's screen; pressing it again goes back. It is each viewer's own choice, like
  VIS and CANVAS today (`ScreenView` in `app/lib/watch/canvas.ts`). Any number of shares; the keys scroll when they
  don't fit. Only the screen you are looking at is sent to you.
- **The queue carries on.** Videos and songs keep playing for the room whether or not you are looking at a share.
- **Sound is separate.** A share has its own sound and its own volume in its tab; the room's music has its own, as
  now. From the engine, a share's sound is the chosen game or window only where Windows allows it, otherwise the PC's
  sound with the browser left out, so the room's music is never sent back into the room as an echo.
- **Watchers** are whoever the room lets in, guests and visitors included. They never share and never control.
  No count of who is watching is shown, stored or sent (the MEDIA rule).
- A share ends when the sharer presses `[ STOP SHARING ]`, leaves, or loses their crown. The key goes; nothing is kept.

### Your own devices
- **Any device signed in to your account with the engine running is listed** under `[ SHARE SCREEN ]` in your room, on
  every other device signed in to that account.
- **`[ CONTROL ]`** shows on a share of **your own** device, to you alone. Press it: your mouse, keys and controller
  drive that device, full screen, straight between the two devices. `[ RELEASE ]` or the escape chord gives them back.
  Nobody else ever gets this key (your answer: own devices only).
- Your room is private until you press GO LIVE, so sharing your desktop to yourself in it **is** your private remote
  desktop: no new window to learn.
- **On the device being controlled:** a small mark in the system tray, a line across the top of the screen while
  someone holds CONTROL (`CONTROLLED FROM LAPTOP`), and one key chord that cuts it at once.
- Works on the home network, and from anywhere else: the two devices try a direct line first and fall back to a
  relayed one (slower, about 0.1 to 0.3 s).

### The server: Remote Desktop (Luke, 2026-11-21)
Luke's server has no keyboard or mouse of its own: "remove the prompt to share the screen ... I need the control to
engage automatically too ... I need to control it now". Nothing installed on the server ("find a way without the need
for downloads"); Windows Remote Desktop already works to it. A page can never share its screen or move its own mouse
without somebody pressing something on that device, so the way in is Windows' own Remote Desktop, turned into a
picture in the room on the PC: "since remote desktop is likely less efficient than our solution make it a clear toggle".
- `[ REMOTE ]` lists `THE SERVER :: CONTROL BY REMOTE DESKTOP (SLOWER THAN OUR ENGINE)` (alone, it goes straight there).
- In the view: a WAY IN switch, `[ REMOTE DESKTOP ]` (pressed) beside `[ OUR ENGINE ]` (pressable once SERVER's own engine answers) (shown,
  not pressable until the engine runs on the server, which needs its AMD/Intel encoder path). Control is on from the
  start; holding Esc a second or `[ RELEASE ]` lets go, a click takes it back; a short Esc is the server's. The
  server's desktop starts at the size of the viewer's own screen, drawn whole (nothing cropped or stretched);
  `[ FIT THE SERVER TO THIS VIEW ]`, a separate switch (off at first, remembered in that browser), makes it the view's
  size and has it follow the view, as FIT does for the PC.
- How: guacd (Apache Guacamole's translator, Apache-2.0) in Docker on the PC (`debaser-guacd`, 127.0.0.1:4822) speaks
  Remote Desktop to the server; the gateway (`scripts/host/rdp-gateway.cjs`, 127.0.0.1:8479) carries it as a websocket
  at `debaser.site/api/screens/rdp-socket` (one tunnel route); the browser draws it with Guacamole's own client
  (`vendor/guacamole-common-js/`). The site (owner only, `/api/screens/rdp`) hands the browser a pass signed with a
  secret it shares with the gateway, good for 60 seconds, once. The server's address and Windows sign-in are only in
  `G:\DEBASER-HOST\rdp.env`, typed by Luke; the site and the browser never see them.
- Set up on the PC by `node scripts/host/server-remote.cjs on|off|status`.
- SERVER SIGN-IN (Luke could not edit the settings file himself, and Claude never types his passwords): a form in the
  view, shown by itself while no server is named and behind `[ OPTIONS ]` after. Address, user and password go once
  through the site (owner only) to the gateway (signed over the exact body) into rdp.env; the fields start empty every
  time, an empty field keeps its line, a line break is refused, and nothing is answered back or logged.
- The view's corner stays short so a small room's picture stays clickable: the WAY IN row
  (`[ WINDOWS REMOTE DESKTOP (GUACAMOLE) ]`, `[ OUR ENGINE ]` (pressable once SERVER's own engine answers), `[ OPTIONS ]`), the route, and
  one status or control line. The server switch, FIT and SERVER SIGN-IN are under OPTIONS, which opens by itself when
  the remote is off or the server is not named.
- Its own switch (Luke, 2026-11-21: "make sure it is a toggle since it is a separate thing to our tech"): off until he
  switches it on. `[ REMOTE ]` lists `[ SERVER REMOTE (WINDOWS REMOTE DESKTOP THROUGH GUACAMOLE): OFF ]`; on, THE SERVER
  becomes a choice, labelled `WINDOWS REMOTE DESKTOP THROUGH GUACAMOLE, NOT OUR ENGINE (SLOWER)`. The view carries
  `[ SERVER REMOTE: ON ]` to switch it off. The switch is kept by the gateway on the PC (`rdp-switch.json`), set
  through the site (owner only, signed with the shared secret): off, the gateway opens nothing.
- The extra lock, his choice: Cloudflare Access (a one-time code sent to his email) in front of the route, on top of
  the site's sign-in. The gateway checks Access's signed token itself on everything that came through Cloudflare, so a
  route left unguarded by mistake still opens nothing; until `RDP_ACCESS_TEAM` and `RDP_ACCESS_AUD` are in rdp.env the
  server is never opened over the internet. Locked, the view shows `[ UNLOCK WITH AN EMAIL CODE ]`: Cloudflare's own
  page in a small window; once through, it closes itself and the room connects.
- Desktop-grade, not gaming: Remote Desktop's picture is pictures and screen updates, not a video stream.

### Our engine both ways (Luke, 2026-11-22: "get our engine working both ways")
The site moved to SERVER (HP ProDesk, Windows 11 Pro, Intel UHD 630, no NVIDIA). Our engine now runs on either machine:
- **The engine's second encoder**: `engine/native/mf.cpp`, Windows' own Media Foundation driving the card's hardware
  encoder (Intel Quick Sync on SERVER): low-latency mode, CBR, no B-frames, Baseline, the picture handed over on the
  card. Chosen when there is no NVIDIA encoder, or with `DEBASER_ENCODER=mf`. Nothing installed: it is part of Windows.
- **The site reaches both engines**: THE PC's (`SCREENS_ENGINE_URL` + `SCREENS_ENGINE_TOKEN`, across the home network
  since the site left the PC; the engine runs `--listen 0.0.0.0 --token <key>`, the key worked out on both machines
  from the secret they already share) and THE SERVER's (`SCREENS_SERVER_ENGINE_URL`, on its own machine). The browser
  names one with `?engine=server`.
- `[ REMOTE ]` lists `THE PC :: OUR ENGINE` and `THE SERVER :: OUR ENGINE` when each answers. The server's WAY IN switch
  goes both ways: `[ OUR ENGINE ]` / `[ WINDOWS REMOTE DESKTOP (GUACAMOLE) ]`, from either view.
- **The addresses a viewer is told to send the picture to are read at every hello** (2026-11-28), never once at start:
  the gaming PC's engine starts at sign-in, before its Wi-Fi has an address, and handed viewers only `127.0.0.1` (the
  viewer's own device) until it was restarted. The engine's log says `video leaves from ...` at start and again whenever
  a hello finds the addresses changed. Its test: `cargo test a_hello` in `engine/`, on a PC with the Rust tools (the
  gaming PC; SERVER has none, so the site's checks do not run it).
- Catches, said once: the engine captures the screen session on the physical display, so SERVER's login must be on
  its screen (the Kamvas), not inside Remote Desktop or disconnected after it: a restart puts it back (auto sign-in), or
  `C:\DEBASER-SETUP\back-to-screen.ps1` from inside Remote Desktop (admin). Windows' firewall on each machine must let
  the engine in on the home network (Luke's call when asked). The gaming PC must be on the home network.

### Which way each connection goes (Luke, 2026-11-21)
"Make sure its clear when something is done over lan vs port forwarding or whatever its technically called." Port
forwarding (a port opened on the router so the internet can reach in) is used in one place only, and never set by
hand: since 2026-11-28 the gaming PC's engine may ask the router for one port by itself, and the view says so when a
connection comes in through it ("Away from home with no setup", below). Nothing else in SCREENS opens a port. Every
REMOTE choice says its way, with a one-line tip:
- THE PC (our engine) and other devices: `DIRECT (HOME NETWORK OR INTERNET)` before connecting, since which of the two
  it will be is only known once connected.
- THE SERVER: `OVER THE INTERNET (CLOUDFLARE TUNNEL)`: out to Cloudflare and back through the tunnel the PC dials out
  to, then across the home network to the server; over the internet even from home.
- Once connected, the view reads the real route from the connection itself (`app/lib/screens/net-route.ts`):
  `ON THIS PC`, `HOME NETWORK (LAN, DIRECT)`, `OVER THE INTERNET (DIRECT)`,
  `OVER THE INTERNET (DIRECT, ROUTER PORT OPENED BY THE ENGINE)` or `OVER THE INTERNET (RELAYED)`.

### Away from home with no setup (Luke, 2026-11-28)
Luke, 2026-11-28: "okay now we need to pick up and get it working from any wifi, remotely, no setup, do more research ot
persist in this result as a separate solution". "It" is REMOTE to the gaming PC from his laptop, inside debaser.site,
with nothing installed: no app, no account, no key, no router page opened by him.

His three choices the same day, word for word:
- To a way through the site itself (the picture carried by debaser.site's own address when nothing direct works):
  **"okay but make sure it doesnt cost and look into it"**.
- To whether the engine may ask the router to open a port by itself: **"Yes, automatically"**.
- To whether a first version of the site way may show before it has sound: **"Wait until sound works too"**.

**Why it does not work everywhere today.** Away from home the laptop and the PC each sit behind a router. The direct
way (2026-11-22, the engine's `--internet`) has each side learn its own address on the internet and both knock at the
same moment, which opens a way through two ordinary home routers. It fails where the laptop's network hands every
connection a different outside address (phone hotspots, many campus and hotel networks), because the PC then knocks
at an address the laptop is not really using, and the home router throws away the laptop's knock as a stranger's.

**The layers, tried in this order, each saying which one it is:**
1. **Direct, as before.** `HOME NETWORK (LAN, DIRECT)` at home, `OVER THE INTERNET (DIRECT)` away. Checked in the
   engine's own tests: a viewer that arrives from an address it never announced is still let in when it knows the
   connection's password, so the engine was never the one turning hotspots away; the home router was.
2. **The router port, opened by the engine itself** ("Yes, automatically"). The engine on the gaming PC, started with
   `--router-port`, asks the home router (a Virgin Hub 5, by UPnP, the router's own "a program may ask for a port"
   service) for ONE port: its picture's own UDP port, under the same number outside. With that port open the router
   lets the laptop's knock through whatever network it comes from. The view then says
   `OVER THE INTERNET (DIRECT, ROUTER PORT OPENED BY THE ENGINE)`, and `[ SETTINGS ]` has a ROUTE part:
   `ROUTER PORT: OPEN (number)`, `NOT GIVEN` with the router's own answer, or `NOT ASKED YET`. The rules it keeps:
   - Only that one port, only for an hour at a time, asked for again every 20 minutes while the engine runs, and
     given back when the engine stops (it waits two and a half seconds at most for the router at its goodbye). If
     the engine is killed without a goodbye, the router lets the port go by itself within the hour.
   - It opens nothing on any doubt, and says why in its log and in `[ SETTINGS ]`: no router answering, a router whose
     own outside address is not a public one or is not the address the world sees the PC at (a port there would lead
     nowhere), the port already taken, a refusal. A router that would only open a port with NO time limit is treated
     as a refusal: nothing is opened (asking Luke about that is held until a real router does it). One that takes
     the request for an hour and then opens the port with no time limit anyway has it taken straight back, is asked
     to close it again and again until it has, and is not asked for a port again while the engine runs.
   - The engine only ever talks to the device on the home network that answered its question, at that device's own
     address: nothing the router's answer or description names can send its requests anywhere else.
   - A refusal never breaks the other ways; the direct way and the home network carry on as before.
   - What is behind the open port: the engine's video socket, which answers only a connection that already holds the
     one-time password the site handed out for it after checking the sign-in. Anything else that arrives is dropped.
   - Never used by SERVER's own engine or a test engine: only an engine started with `--router-port`.
   - Code: `engine/src/portmap.rs` (written by hand on the standard library, no new package), hooked into
     `engine/src/serve.rs`; the site's words in `app/lib/screens/net-route.ts` and `wishes.ts`.
3. **Through the site** ("okay but make sure it doesnt cost and look into it"; "Wait until sound works too"). NOT
   BUILT: only its gate, a measurement (below). Looked into (2026-11-28): Cloudflare has no way to bill a free
   account that has no paid add-on, but its rule against serving video through the free service does cover the
   tunnel debaser.site uses; the consequence it names is limiting the traffic and an email, at worst ending the free
   service. Luke's two answers, 2026-11-28, word for word:
   - To "REMOTE through debaser.site (the slow fallback for networks that block everything but web pages): the
     session looked into it. It can't bill you on the free plan, but Cloudflare's rule against video on the free
     plan DOES cover the tunnel. What they say they do is limit that traffic and email you; at the far end they can
     stop serving a free account, which would take debaser.site down until fixed. Your films on media.debaser.site
     already go the same way, at many times the volume. Build it?": **"Build, capped, 20 GB (Recommended)"**. As he
     read that choice: "On a blocked network the PC's screen still comes up through the site, at 720 lines, slower
     (estimated 80 to 150 ms against 12 to 17 at home), with a line saying how much of the month's 20 GB (about 12
     hours) is left; used up, it says so until next month. Why: small beside the films, with a hard stop on a
     mistake. Four more pushes of work." He passed over "Build, capped, no limit", "After the hotspot try" and
     "Don't build it".
   - To "So "it can't cost" is checked and not assumed: in your Cloudflare dashboard (Manage Account, Billing,
     Subscriptions), is anything listed besides the domain? A paid add-on already switched on is the only way found
     for the site way to cost anything, and no session may log in to your account.": **"Only the domain"** (as he
     read it: "You're sure nothing else is listed. The session builds on that."). So there is nothing on the account
     a bill could come from.

   When built it will say `OVER THE INTERNET (THROUGH THE SITE)`, be used only when both direct ways fail, for the
   owner only, capped at 720 lines and 3.5 Mbit/s with a 20 GB monthly allowance, and show nothing until picture,
   control and sound all work.

   **Its path, and why no tunnel rule is needed.** The browser opens one websocket (a kept-open two-way line) at
   `debaser.site/api/screens/site-socket`. The site's own program on SERVER only passes it along (one `rewrites()`
   line in `next.config.ts`) to a gateway on the same PC, `scripts/host/screens-site-gateway.cjs`, on 127.0.0.1:8481.
   The tunnel already carries the site's address, so nothing is added to it.

   **The gate (2026-11-28): measure before building.** The gateway so far has one mode, `--gate`: it sends MADE-UP
   frames (random bytes at the real size and pace: 60 a second, 3.5 Mbit/s, each stamped with the moment it left) to
   a viewer that says how late each one came. `engine/bench/site-way-gate.cjs` starts it, watches the stream down
   several paths at once (straight from the gateway, through the site's program only, and through Cloudflare and the
   tunnel from a hidden browser), runs something heavy part-way through, and stops it again. It first checks the
   door: a stranger with the wrong words or none gets a closed line and not one frame (broken on purpose, the check
   fails: 360 frames reached the stranger). The gate carries no picture, sound or control, and the gateway is not on
   SERVER's kept-running list. The rest is written only if the numbers are good (`engine/BENCH.md`).

**What is and is not proved.** The engine's tests play the router with the Virgin Hub 5's own recorded answers, and
the Hub itself was asked read-only questions from SERVER (it offers the service and has a public address). Built and
tested on the gaming PC, 2026-11-28: 41 of 41 tests pass, and a deliberately broken copy (a port asked for with no
time limit, never given back, never offered to a viewer, an engine deaf to an address a viewer did not announce, a
router's description allowed to name any address, a no-time-limit port never chased) fails 10 of them
(`engine/BENCH.md`). What no test here can show is a knock arriving from outside the house: that is
Luke's own try from his phone's hotspot. Whether the real Hub gives a port for an hour is known only once the PC runs
this engine.

### Settings in the viewport
Luke, 2026-11-20: "it needs a settings button in the viewport for the low latency desktop control streaming feature we
are working on. include everything necessary such as upscaling settings and the ability to switch the aspect ratio the
streaming display is rendering and sending, for example if its ultrawide it turns to 16:9 when streaming to my laptop
or whatever size of the screen being streamed to with a toggle."

A `[ SETTINGS ]` key in the corner of the picture (words: the room already has a cog of its own) opens a panel over it.
Built first in the engine's own viewer page (it is the only viewport that exists yet); the room's SCREEN tab gets the
same panel, in the site's tokens, in phase 3.

- **PICTURE**
  - `MATCH THIS SCREEN` (on by default): the PC sends its picture in the shape and size of the screen you are watching
    on. Your ultrawide sends 16:9 to the laptop, 16:10 to a 16:10 screen, and so on.
  - Off: SHAPE (NATIVE, 16:9, 16:10, 21:9, 4:3), SIZE (720, 1080, 1440, NATIVE), FRAMES A SECOND (30, 60, 120, 180),
    BITRATE.
  - The panel shows what the PC is **really** sending, and says so when the PC has capped it.
- **How the PC changes shape, and what each way costs** (said plainly because they are different features):
  1. **Send a piece of the screen** (built now). The PC sends the middle of its screen in the asked shape, scaled on
     the graphics card. Instant, nothing on the PC changes. On an ultrawide the two sides are cut off: a game is not
     re-drawn narrower, you see its middle.
  2. **Change the PC's real screen mode** while a device is controlling it (not built). The PC switches to a 16:9
     resolution, so games and the desktop really re-draw in that shape, and switches back after. A second or two of
     black on the PC's own monitor each way, windows get rearranged, and it is a Windows setting being changed, so it
     would be its own switch, off by default, tested only with Luke watching.
  3. **A virtual screen** made at exactly the viewer's size (not built). The best: the real monitor is untouched and
     the game draws for the viewer. Needs a screen driver installed and signed: the last item in the loop.
- **UPSCALING** (on the watching device only): OFF (real size, not stretched), SMOOTH (the browser's own), SHARP
  (hard pixels, for pixel art), SHARPENED (a sharpening pass drawn on the watching device's graphics card, the trick
  games use to render small and show large; it redraws every frame and may add delay, to be measured). The stream's
  real resolution is always shown.
- **READOUT**: resolution, frames a second, time in the browser's queue, decode time, lost packets, the PC's own time
  from showing a frame to having it encoded.
- **FULLSCREEN.**
- **Comes with CONTROL (phase 2), shown as "not built yet" until then, never as dead keys:** mouse mode (pointer or
  game-style), keyboard capture, controller. **Sound** likewise. **HEVC and AV1** when the pieces allow (this PC's card
  cannot encode AV1).
- **Remembered per watching device** (in that browser's own storage, nowhere else).
- **The PC's own limits win.** Whoever is watching cannot ask for more than the PC allows (size, frames a second,
  bitrate), and **while a League match is running the PC caps the stream** (1080 lines, 60 frames a second, 12 Mbit/s)
  whatever is asked; the panel says CAPPED BY THE PC: LEAGUE MATCH, and the asked-for settings come back when the match
  ends. One encoder serves everyone, so settings belong to the stream: the last change wins and every viewer's panel
  shows what is really being sent. In a room, only the sharer and their own devices may change them (phase 4).

### Not in this spec
- Anyone controlling a device that isn't their own (no controller hand-over to friends).
- Phones as sharers or controllers (they can watch). Mac and Linux engines. Recording or replays.
- League through CONTROL. Any anti-cheat workaround.

## How it works

```
 THE DEVICE BEING SHARED                                              THE OTHER SIDE
 ┌──────────────────────────────┐   fast lane: straight, device to    ┌───────────────────────────────┐
 │ the engine (ours, installed) │   device, video out, input back     │ your other device: a browser  │
 │  grab screen off the card    │ ══════════════════════════════════> │ tab on debaser.site, CONTROL  │
 │  squeeze with the video chip │                                     └───────────────────────────────┘
 │  move mouse / keys / pad     │   one copy, dialled OUT             ┌───────────────────────────────┐
 │  game's sound                │ ───────────> Cloudflare relay ────> │ everyone watching in the room │
 └──────────────┬───────────────┘                                     └───────────────┬───────────────┘
                └── "hello" only (who, which room, may they?) ── debaser.site, through the tunnel ──┘
```

- **The engine** (a folder `engine/` in this repository, kept out of the site's build and checks; its own proofs).
  Written by us from NVIDIA's, Microsoft's and the web standards' own documents. **No code is copied from Sunshine,
  Moonlight or any GPL project** (decision D1 is the alternative). Building blocks, all permissively licensed:
  Windows' own screen-grab that leaves the picture on the graphics card; NVIDIA's encoder through its MIT-licensed
  header (it ships inside the driver, nothing to bundle); a WebRTC library that accepts ready-made video (`str0m`,
  MIT); Opus for sound; Windows' own call for mouse and keys. Language: Rust.
- **The recipe** starts as Sunshine's (read in its source: fastest tuning, no frame ever waits for a later one, no
  look-ahead, full pictures only on request, a one-frame budget) and adds what Sunshine leaves unused in the same
  chip: gradual repair instead of a full-picture resend, long-term reference frames, changing quality on the fly
  without a hiccup, strips of a frame handed over as they finish (all present in NVIDIA's header, read today).
- **The browser side** asks for no waiting queue (`jitterBufferTarget = 0`, the "show as soon as possible" marker on
  every frame), decodes on the graphics card, and for CONTROL reads the mouse raw (not once per frame), locks the
  pointer and the keyboard (Chrome and Edge), and draws the pointer itself.
- **The roads.** Fast lane: WebRTC straight between the two devices; it finds its own way through home routers, with
  Cloudflare's relay as the fallback. Watchers: one copy to Cloudflare Realtime, which hands it to each viewer; the PC
  uploads once however many watch, so League's ping is safe. The tunnel carries only the "hello".
- **The site's part.** A new screen view per share in the room; the share list and keys; two small server routes that
  check the account, the room and the crown before asking Cloudflare for anything; your devices found through the
  site's live channels. Mock and Supabase versions of anything stored, as the house rule asks.

## The loop ("persist and loop")
Nothing counts as faster until it is measured faster. One measuring stick for every contender:
- **The rig.** A script on the laptop presses a key and watches the laptop's own screen for the PC's answer (a patch
  that changes colour), hundreds of times, and reports the middle value and the worst 5%. It measures the Moonlight app
  and our browser tab **the same way**, so the comparison is fair. A second mode reads a moving clock for delay without
  input. One cross-check by filming both screens with a phone in slow motion, if you are willing.
- **The yardstick.** Sunshine to Moonlight on your two machines, home network, 1080p60: measured first, written down.
- **Each round:** change one thing, run the rig, keep the change only if the numbers improve, write the round in
  `engine/BENCH.md`. Also run on a deliberately bad line (packet loss and jitter added by a tool), where the win
  should be largest.
- **The list to work through, in order of likely gain** (each is a hypothesis until the rig says so):
  1. Pointer drawn on the viewing device (felt delay on a desktop: to zero).
  2. Watch the line and adjust quality; gradual repair; long-term references (bad lines: tens of ms off the worst case).
  3. Capture faster than the screen and send the newest frame (4 to 10 ms).
  4. Time capture and send to the viewer's screen refresh (4 to 8 ms).
  5. Skip the browser's own drawing queue (a low-latency canvas; up to a frame, unproven on Windows).
  6. Our own packets instead of the browser's video lane, decoded frame by frame in the page (control over every wait).
  7. Strips of a frame sent as they finish (1 to 3 ms, needs 6).
  8. A virtual screen driver, so capture no longer waits for Windows to compose the desktop (needs a signed driver; last).
- **Done means:** the browser tab beats the yardstick's middle value and its worst 5% on the home network, and stays
  watchable on the bad line where the yardstick freezes. Until then the loop continues; if a round shows a limit that
  cannot be passed in a browser tab, I say so with the numbers.

## Phases (each proved before the next; each its own session or few)
0. **Yardstick and go/no-go.** L: Moonlight on the laptop (Sunshine is already on the PC). C: the rig (written
   2026-11-20: `engine/bench/`, steps in `engine/BENCH.md`); the baseline numbers; what streaming costs League in frames (Practice Tool, Ctrl+F);
   confirm the Vanguard finding on your own machine by trying to move the pointer in a Practice Tool game through
   Moonlight (nothing is worked around). *Proof: `engine/BENCH.md` with the yardstick's numbers.*
1. **The engine shows a screen.** Grab, encode, send to a plain test page on the laptop, home network, watch-only.
   *Proof: the rig's clock mode against the yardstick.*
2. **CONTROL.** Mouse, keys, controller; pointer drawn locally; pointer and keyboard lock; the cut-off chord and the
   on-screen line. *Proof: the rig's key-press mode against the yardstick.*
3. **In the site, your own devices.** Linking a device to your account; the device list; your room's `[ SHARE SCREEN ]`,
   the share's key beside VIS and CANVAS, `[ CONTROL ]`. *Proof: local drive on mock data; one short live check with the
   two test accounts that account B never sees account A's devices.*
4. **Rooms.** Shares through the relay for watchers; hosts and crowns; any number of shares; sound per share;
   THIS BROWSER sharing with nothing installed. *Proof: local drive; one live check, two accounts and a visitor.*
5. **Away from home.** Direct through routers, relayed fallback, the line-watching and repair work. *Proof: the rig on
   the bad line; one test from the laptop on a phone's hotspot.*
6. **The loop**, items 3 to 8 above, until "done means".
Later, separately: the laptop as a device that can be shared at engine speed (its graphics chip is not NVIDIA's, so it
needs a second encoder path).

## Safety
- Watching can touch nothing: video goes out, only "hello" requests come in, and the site checks each one.
- CONTROL exists only between devices of one account; there is no code path that hands it to anyone else.
- The device being controlled always shows it and can always cut it. The engine runs as you, not as Windows itself, so
  it cannot press through a Windows permission prompt or a lock screen (someone at the PC must).
- The fast lane is encrypted between the two devices; the site only introduces them.
- A device joins your account by one press on that device when the engine is installed. Its sign-in is kept in
  Windows' protected store, never in a file, a log or the repository. The Cloudflare key is pasted by you into the PC's
  settings file, like the others.
- A share shows what is on that screen. The picker offers single windows first so a password manager or a Claude
  session doesn't go out to a room by accident.
- The engine is unsigned at first: Windows will warn when it is first run on each of your machines. Fine for your two
  devices; signing (about 10 USD a month, and individuals may not be eligible) matters only if friends install it.

## What it costs the PC and the allowance
- One encode on the video chip whatever the audience. Expected cost to a game: a few percent of frames; measured in
  phase 0, not promised. Memory is the tight thing (16 GB); the engine is small (tens of MB).
- Upload: one stream to the relay (about 6 Mbit/s of your 54) plus one on the fast lane while you CONTROL.
- Cloudflare Realtime: the first 1,000 GB a month is free, then 5 cents a GB (their pricing page, read today). A 1080p
  share is about 2.7 GB per watcher per hour: about 370 watcher-hours a month free. The site keeps its own tally.

## Database changes (none made; each needs Luke's typed OK when its phase comes)
- Phase 3: one rule letting an account's own devices and tabs talk on a private live channel, and nobody else's.
- Phase 4: probably none (who is sharing rides on the room's existing live channel; the server routes check crowns
  from tables that exist). If the monthly tally must survive a restart: one small table.

## What Luke has to do
- Phase 0: Moonlight on the laptop, and the measuring steps in `engine/BENCH.md`. (Found 2026-11-20: Sunshine, its
  controller driver and the Rust toolchain are already on the PC, so nothing is installed there.)
- Phase 3: press LINK on each device once.
- Phase 4: make a Cloudflare Realtime app and paste its two keys into the PC's settings file yourself.
- Everything else is mine.

## Risks, said once
- The size (above). A second language and program to keep alive across Windows and driver updates.
- A browser tab may never beat the Moonlight app's raw number on a clean home network; the loop will show it. It
  should win clearly on feel and on real lines.
- Pretend game controllers on Windows rest on a driver its author retired in 2023 (Sunshine added a second driver this
  September). Controller support may need a driver install, tested in phase 2.
- Chrome asks permission before a page may talk to a program on the same PC; the rules changed in 2025 and may again.
- Game-only sound needs a newer Windows than this PC's Windows 10 may offer; the fallback is the PC's sound minus the
  browser.
- Cloudflare can change the free allowance. The fallback is a relay program on the PC with one router port opened
  (shows the home address to watchers), or a small rented server.
- Full-screen games sometimes need borderless mode to be grabbed.

## Decisions still open
- **D1. A shortcut exists:** if the engine itself is released under the same open licence as Sunshine (GPL-3: anyone
  given the program can ask for its source), we may legally build on Sunshine's and Moonlight's proven code instead of
  writing every part. Faster and safer; the engine is then "ours, grown from theirs". This spec assumes **all our own**,
  as you said. Say if you'd take the shortcut.
- **D2. At the free limit:** pause new shares until next month (assumed), or let Cloudflare bill a few cents.
- **D3. The engine's name** as you'll see it in the tray and the installer (working name: DEBASER ENGINE).
- **D4. THIS BROWSER sharing** (nothing installed, watch-only, relay speed) is in phase 4 so friends aren't shut out.
  Say if you'd rather shares come only from the engine.
- **D5. The planned extension:** if there is one, what it is.

## How it will be proved
The rig's numbers against the yardstick, round by round, in `engine/BENCH.md`. For the site's part: `npm run verify`,
`npm run checks:changed`, local drives on mock data, the short live checks named in phases 3 and 4, then the house loop
(push, `deploy-status`, `npm run read`). What cannot be checked by me: how it feels in your hands, which is the point.

## Sources
- Sunshine's and Moonlight's code, Cloudflare's pages, and the first round of findings: `sunshine-research.md` in the
  sessions' notes folder.
- NVIDIA's encoder header (MIT-style notice; `enableIntraRefresh`, `enableLTR`, `enableSubFrameWrite`,
  `NV_ENC_CAPS_SUPPORT_SUBFRAME_READBACK`): github.com/FFmpeg/nv-codec-headers, `include/ffnvcodec/nvEncodeAPI.h`.
- "Show as soon as possible" marker: webrtc.googlesource.com, `docs/native-code/rtp-hdrext/playout-delay`.
- Browser pieces (MDN): `RTCRtpReceiver.jitterBufferTarget`, `VideoDecoder.configure` (`optimizeForLatency`),
  `pointerrawupdate`, `requestPointerLock` (`unadjustedMovement`), `Keyboard.lock`, `getDisplayMedia`.
- Building blocks: github.com/algesten/str0m (MIT), github.com/NiiightmareXD/windows-capture (MIT).
- Vanguard and remote input: github.com/RiotVanguard/Vanguard/issues/70.
- Not verified by anyone today, to be settled by the phase named: the delay of each stage on this PC (0); whether
  Windows Chrome honours the low-latency canvas (6); whether `str0m` exposes every control we want (1); game-only sound
  on this Windows (4); the controller driver on current Windows (2); Cloudflare Realtime's limits on a free account (4).
