# State of the site (the one current picture)

Always true, under a page. Whoever changes a line of it changes it in the same commit (core.md, the house loop). History
goes to `docs/handoff-archive.md`, decisions to `docs/decisions.md`, a session's own progress to its hand-over note
(`docs/sessions.md`). Last full rewrite: 2026-11-27, from HANDOFF.md (2026-11-22), the coordinator's notes and the
working sessions' status notes.

## Where things run
- **SERVER** (HP ProDesk 600 G4, Win 11 Pro, 16 GB, 192.168.0.154) hosts debaser.site since 2026-11-22 and runs every
  Claude session: repo `G:\debaser.site` (G: = `C:\DRIVES\G`), host `G:\DEBASER-HOST`, external drive `I:` (backups
  `I:\DEBASER\backups`, 04:00, 30 kept). Rebuilds from `main` every 5 hours and at once after `npm run deploy-status`
  (2026-11-27). Whole setup and its traps: `SPEC-self-hosting.md`.
- Memory is tight (16 GB holds the site, its database and the media apps): WSL capped at 6 GB, Supabase Studio off
  (`C:\DEBASER-SETUP\dashboard-on.cmd` / `-off.cmd`), heavy steps one at a time (`docs/sessions.md`). Gotcha: force-closing
  Docker Desktop leaves `%LOCALAPPDATA%\docker-secrets-engine\engine.sock` stale; delete it and start Docker again.
- Also on SERVER: SSH (key only), Tailscale (`debaser-server`, nothing public), LibGen through a Proton WireGuard split
  tunnel plus the shadow proxy behind `/shadow`, SUNSHINE's screen engine (`G:\DEBASER-HOST\engine`).
- The gaming PC (192.168.0.30, SSH alias `gaming-pc` from SERVER) is a SCREENS device and, since 2026-11-27, the heavy
  lane: `verify:clean` (about 70 s there) and the full checks (about 18 min; the same results as on SERVER, proved
  2026-11-27) run there through heavy-step first, since 2026-11-28 (Luke: "PC first (Recommended)"; until then they took
  turns with SERVER); off, asleep, busy or in a League match, they stay on SERVER. Off switch
  `remote-lane.off` beside heavy-step.cjs (`docs/sessions.md`). No sessions run there. Old session notes from it:
  `I:\work-data\claude-notes\` (history only).

## Sessions now
One coordinator, the only main session (top level, pinned; the first coordinator and PC setup archived 2026-11-27 at
Luke's word). Its notes: `coordinator-notes.md` in the group's notes folder (`docs/sessions.md`). Working under it since the
evening of 2026-11-27, each in its own worktree: BROWSER-FIREFOX (first the key named OWN EYE showing its page inside BROWSER,
then the Firefox trial and the bookmarks-bar key; hand-over `browser-firefox-handover.md` in the `local_83ffacf4-…` notes folder; then the morning's BROWSER gaps and Luke's two evening choices: an optional ALLOW EVERY SITE key, and OWN WEB
keeping the pages OWN EYE shows). Done, live and archived
that day: the book reader's EXPLAIN words (f3a9828), a profile track version's "pause" key in the history really pauses (e6c051f), the room builder (the
FULL key ccb030a, your own devices' volume 05f4f90, `[ DEVICES ]` 2c51b18), EXPLAIN for profile, settings and the forum, BROWSER's
review fixes and easy-install items 1 and 2, room sync and the context system. The gaming PC's heavy lane is on again
since 2026-11-28 (Luke: "league is done we can open the pc switch and use it at full capacity too"). Also working since that
night, on the lighter model: READER-FIXES (done, live as 3868301: no EXPLAIN box over the book's page; the place saved on leaving) and (done, live as a8fe1d3 and archived; EXPLAIN-REST-2 followed it: comic studio, character workbench, animate, beatbox, done and live as bd99483; EXPLAIN-REST-3, the last areas, done and live 2026-11-28, so every key now has its hover words (none left; shown
only while `[ EXPLAIN ]` in PREFERENCES is on, off by default; `Temp/check-explain.cjs` fails a new key without them); and
FULL-RUN-DUE, done and live as 46d286c: the quick checks stop demanding the whole suite because of the one check that is red on purpose; and
STARFIELD-PLAY: pressing a star in the STARFIELD background does something to it, the way chosen in settings, Luke, 2026-11-28:
"physics inspired some options including laser beams, nudges, drag/throw"; done and live, b0f7e43: NUDGE (as it comes),
LASER, THROW, PULL, BURST, TIE or OFF; with a mode on, hyperspace takes two presses on empty sky; how it looks not yet
judged by him) EXPLAIN-REST-1
(hover words in letters, docs and lore), and ROOM-DEVICE-SYNC (one account's devices in a room staying linked: pause, play, mute,
and a device that wakes by itself where a browser allows it; Luke, 2026-11-28: "i need this sorted so they are all smoothly
linked"; first push live: an untouched device starts muted and in step (video) or says SOUND IS WAITING (the music bar
alone), and no longer pauses the others; second push: devices pulled tight (on a local stand-in 0.03 s apart on a file and
about 0.11 s on a server film, from 0.33 s and swings to 0.8 s) with a LINING UP line; not yet tried on a real phone or a real
server film), and INSTALL-APP (debaser.site installable as an app with the yellow text icon; Luke, 2026-11-28:
"Yes, yellow text icon (Recommended)"; no service worker, no push; done and live, 2b1980e: installed from the browser's own
menu; not yet tried as a real install on his PC or phone). Decided 2026-11-28 after an interview: no
server stream for rooms (Luke: "Keep today's way, fix it (Recommended)"); each device keeps playing the media itself, and
ROOM-DEVICE-SYNC also pulls one account's devices to about a tenth of a second apart (Luke: "Yes, pull them tight (Recommended)")
and shows a short LINING UP line (the one kept player needed no change in a front tab; a background tab not tested).

## Half-done
- BROWSER: the easy install (`browser-easy-install-brief.md` in the 69ad notes folder). Live: Luke's text icon (extension 0.8.0), the
  Edge Add-ons pack (`docs/extension-store/README.md`, his steps; hidden; waits on him), [ CHOOSE AN EMPTY FOLDER ] (the site writes the
  extension into a new folder) and the copy key for the extensions page. Next, for a fresh session: the Firefox trial and the
  bookmarks-bar key (hand-over `browser-build-handover.md`), then the IMPROVE rounds. Also live: sign-in
  groups, IMPORT, the store pack (90d3d69), OWN WEB (8827218), lenses on pages OWN EYE shows inside BROWSER (7b85214), the address box
  following them (95a39db), EXPLAIN words on every BROWSER key and the first agent review's fixes (e71c71c, extension 0.7.1), every key
  named OWN EYE showing the page inside BROWSER (fa1c1b7), and the site's half of the morning's gaps (84517f1): one switch with both
  eyes named, hover words on the tray, a lens that can't be worn says why, a line on what works on an OWN EYE page, OWN EYE's pages in
  HISTORY. Extension 0.8.1 (2026-11-28; Luke updates his copy from the EXTENSION window): a clicked YouTube video followed, no ADD
  key that leads nowhere, hover words on the extension's own pages, and `[ ALLOW EVERY SITE ]` on its SITES page (Luke: "One optional
  key (Recommended)", decision 60; off until pressed). Every site allowed never switches a site's script-safety rules off; a site
  added by name is shown with them off, and ADD says so ("Keep your default", decision 67: DuckDuckGo and GitHub need ADD by name).
  OWN EYE's pages in HISTORY now go on the account too ("On the account too", decision 64). The extension's lines in a framed page
  now speak only for the one frame BROWSER made for OWN EYE, never the floating player or another embed on the site. Extension 0.8.2 (2026-11-28, a14ec2d; Luke updates his copy
  again): OWN WEB keeps the pages OWN EYE shows inside BROWSER (his "Keep every page", decision 61; never-keep list "none", decision
  66) behind a switch that is the extension's own, off for everybody and per browser: on only by two presses on its SITES page
  (`[ KEEP OWN EYE'S PAGES ]`, `[ YES, KEEP THEM ]`), off from either side; visible words only, never a box, password or hidden field;
  no database change (proved live with TEST ACCOUNT A and B). MEDIA, SEARCH THIS, WATCHERS and ERASE work on a page OWN EYE shows
  (decision 65). The bookmarks-bar key (DEBASER LENSES, no install) is in the EXTENSION window for a browser without the extension:
  tried in Edge only so far. Next: openfront.io playing inside BROWSER (Luke, 2026-11-28: "find a way at all costs and persist in
  making openfront.io work and be user friednly within debaser.site browser"), then the theme as the default lens, more sites and
  daily use (plan first), and the Firefox/Chrome trial in a lighter session (`browser-firefox-trial-brief.md`).
- The shelf: BROWSER and REMOTE are marked WIP (f648c04).
- REMOTE through the site, the third way: HIDDEN, half built (2026-11-28). Its GATE came first (b52c814): a
  measurement with made-up frames (`scripts/host/screens-site-gateway.cjs --gate`, started and stopped by
  `engine/bench/site-way-gate.cjs`; one line in `next.config.ts` passes `debaser.site/api/screens/site-socket` to
  it, so no tunnel rule). Measured once, ten minutes, 3.5 Mbit/s, 60 frames a second, from a hidden browser on
  SERVER through Cloudflare and the tunnel: there and back 52 ms in the middle (99%: 70 ms), no frame lost or
  skipped, no pause over a quarter second; about 1 frame in 22 arrives paired with the one before; a build on
  SERVER at the same time made frames up to 268 ms late for a few seconds (`engine/BENCH.md`). On those numbers the
  coordinator gave the go. SERVER's half is on `main`: the owner's pass (`/api/screens/site-way`), the gateway
  carrying real frames, sound and control between a browser and the PC's engine without ever queueing, and the
  20 GB month counted in `G:\DEBASER-HOST\screens-site-usage.json` (no database; a lost file restarts that month's
  count), proved against a pretend engine. The PC's half is built and tested on the gaming PC (50 of 50 tests,
  2026-11-28; file SHA256 9E7E38A5...1D96) but NOT installed: the PC still runs B2CE8AF3...; NOT there yet: the
  browser's side is not written, the gateway is not kept running and no page asks for it. No real picture has gone through the site.
- REMOTE from any Wi-Fi (REMOTE-ANYWHERE; plan `remote-anywhere-plan.md` in the 69ad notes folder): three ways, tried in
  order: the direct line as today; a port on his router opened by the PC's engine itself (his "Yes, automatically"; the
  Virgin Hub 5 answers and has a public address, seen 2026-11-28); and through the site as the slow fallback (Luke,
  2026-11-28: "Build, capped, 20 GB (Recommended)", after being told Cloudflare's free-plan video rule covers the tunnel, no
  bill, at worst the free account cut off; his Cloudflare billing lists "Only the domain"). The first two ways are on
  `main` (0d7275df, 2026-11-28; SPEC-screens.md "Away from home with no setup"): the engine's `--router-port` asks the
  router for the picture's one port, an hour at a time, and gives it back when it stops; the view says `OVER THE
  INTERNET (DIRECT, ROUTER PORT OPENED BY THE ENGINE)` and `[ SETTINGS ]` gets a ROUTE part. Proved on the gaming PC by
  the engine's own tests (41 of 41, against a pretend router; a broken copy fails 10). RUNNING ON THE GAMING PC since
  2026-11-28 14:29Z (file SHA256 B2CE8AF3...3ED9, swapped in on Luke's word; the earlier engine is kept beside it as
  `debaser-engine.before-router-port-2026-11-28.exe`). The real Virgin Hub 5 gave the port: the engine's log says
  `router port: OPEN: outside port 54321 ... for an hour at a time, asked for again every 20 minutes`, and the Hub,
  asked one read-only question, said UDP outside port 54321 leads to 192.168.0.30:54321, named "DEBASER engine video",
  3540 s left (so it does give a timed port). The port number is a new one at each engine start. One watch-only viewer
  from SERVER (home network) got the picture, and `[ SETTINGS ]` showed ROUTE `ROUTER PORT: OPEN (54321)`. NOT PROVED,
  and not provable from inside the house: a connection from outside (his own try from a phone hotspot, owed). The site
  way: half built (the bullet above), hidden until picture, control and sound all work.

## Waiting on Luke
- Tailscale: the laptop, phone and gaming PC join his tailnet so sessions and the heavy lane can reach them (his choice,
  2026-11-27; `docs/sessions.md`, "Which machine does what"). On each: get Tailscale (tailscale.com/download on the laptop
  and PC, the app store on the phone), open it, sign in with the same account SERVER (`debaser-server`) uses; nothing else
  to set. Then tell the coordinator: a session writes the exact clicks for the laptop app's SSH connection to SERVER.
  Cloud sessions for reading work need the cloud set up for the repo (his click).
- Edge on SERVER (asked by the PC setup session, 2026-11-27; it needs admin rights a session doesn't have): Settings,
  System and performance, switch off "Startup boost" and "Continue running background extensions and apps", to free memory.
  Optional, never answered: moving the database tools off the connection pooler (about 210 MB freed, a minute of database
  downtime).
- REMOTE to the gaming PC was off for about ten minutes (2026-11-28, 14:19Z to 14:29Z) and is back. Its graphics card
  had failed at 13:36Z while the game Deadlock was open (Windows: NVIDIA GeForce RTX 3060 "status Error, device problem
  code 43"; dwm.exe crashed seven times), so no engine, old or new, could start: `NOT SERVING. Could not open the
  graphics card (0x887a0004)`. The first run of the router-port swap met that and put everything back. Luke restarted
  the PC himself ("I'll restart it (Recommended)"), the card read well again, and the second run went through. If REMOTE
  to the PC ever gives no picture again and the engine's log says that line: look at the card first; a restart cured it.
- REMOTE to the gaming PC (2026-11-28): the lasting fix is in. It had stopped connecting because the PC's engine, started
  at sign-in, came up before the Wi-Fi had its address; the engine now reads the PC's addresses at every viewer's hello,
  and the PC runs that engine (swapped on his "Yes, swap it"; old file kept beside it). A test viewer from SERVER got the
  picture over the home network. Owed: his own try from the laptop on the home Wi-Fi. A real PC restart happened
  2026-11-28 14:26Z: the engine came up by itself at his sign-in and answered.
  REMOTE-ANYWHERE is still working (his "get it working from any wifi, remotely, no setup": a way through the site itself,
  "okay but make sure it doesnt cost and look into it"; the engine opening a router port by itself, "Yes, automatically";
  "Wait until sound works too"). Briefs and research: `remote-*.md` in the 69ad notes folder.
- REMOTE from any Wi-Fi (2026-11-28): the engine that asks the router for a port is on the gaming PC and the port is
  open (above). Owed: his own try from his phone's hotspot, the only proof that it works away from home (the clicks
  went to the coordinator with the swap's result). Later, each on his own word through the coordinator: the engine
  with the way through the site (a second swap) and the site's gateway on SERVER's kept-running list.
- SCREENS relay: activate Cloudflare Realtime/TURN on his account (he ticks the terms and pays himself), then paste the
  key into the RELAY KEY form.
- Off-site backup (Proton Drive, task `DebaserOffsite`) is built but off until he runs
  `C:\DEBASER-SETUP\proton-backup-setup.ps1`; then the first upload and a restore test are owed.
- BROWSER: the `see.debaser.site` DNS record, whether the machine puts away consent boxes; the Edge Add-ons listing (his eight steps in
  `docs/extension-store/README.md`, then the id; every new extension version is his upload again); updating his Edge copy to 0.8.2
  and, if he wants them, one press on `[ ALLOW EVERY SITE ]` (the browser's own box is his first real press: not driven) and the two
  presses that switch OWN WEB on for OWN EYE's pages; Firefox
  signing (his Mozilla account), if the trial says go. Decided 2026-11-27: the server's eye stays his alone ("Only me (Recommended)", decision 62), the
  icon is the yellow square, no Chrome Web Store for now (decision 63).
- PLAYER-TV, done and live 2026-11-28 (SPEC-player-tv.md; he said "Yes, push it" to local screenshots; not yet seen by
  him on the live site): while a video plays, a small voxel TV sits at the right of the player bar's black and the
  character crawls down to watch it at half size. A file of the site's own plays on the screen; YouTube shows stills;
  Vimeo, Twitch and his server films a dark screen ("Not now" to the bridge change that would show them). Proved on a
  local mock server only; the floating player's TV was not driven.
- Google sign-in check on debaser.site from his own browser.
- The gaming PC's security (Defender off, dead startup entries, old encrypted files in `C:\tmp`): his to change.
- Test leftovers on TEST ACCOUNT A/B (ROOMCHAT lines, CANVAS rooms): a delete, waits for his OK. POPOUT on hold.
- Optional private GitHub backup of the game repo (needs his clear yes).
- Asked by the PC setup session: whether SUNSHINE's engine can hold its frame buffers only while someone watches
  (about 1.5 GB held while idle).

## Known red checks
The list the runner reads is `scripts/known-red-checks.cjs` (with each one's date and reason; adding to it is Luke's
call): a full run failing only these no longer makes `checks:changed` say FULL RUN DUE.
- `check-hidden-accounts` (the house account, Luke's choice).
- The whole suite on SERVER, 2026-11-27 (475d48d): 268/269, only `check-hidden-accounts`. Earlier that day: 261/264, then the two that were the coordinator's own change fixed (check-backdrops,
  check-build-trace); the live-database checks that were red after the move pass since 2026-11-22 (vault locks re-made,
  Edge fallback, check-auth-at-once reads the site's own address).
