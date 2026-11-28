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
night, on the lighter model: READER-FIXES (no EXPLAIN box over the book's page; the place saved on leaving) and (done, live as a8fe1d3 and archived; EXPLAIN-REST-2 follows it: comic studio, character workbench, animate, beatbox; and
FULL-RUN-DUE, done and live as 46d286c: the quick checks stop demanding the whole suite because of the one check that is red on purpose; and
STARFIELD-PLAY: pressing a star in the STARFIELD background does something to it, the way chosen in settings, Luke, 2026-11-28:
"physics inspired some options including laser beams, nudges, drag/throw"; of these three only FULL-RUN-DUE is live) EXPLAIN-REST-1
(hover words in letters, docs and lore), and ROOM-DEVICE-SYNC (one account's devices in a room staying linked: pause, play, mute,
and a device that wakes by itself where a browser allows it; Luke, 2026-11-28: "i need this sorted so they are all smoothly
linked"; nothing of it live yet), and INSTALL-APP (debaser.site installable as an app with the yellow text icon; Luke, 2026-11-28:
"Yes, yellow text icon (Recommended)"; no service worker, no push; done and live, 2b1980e: installed from the browser's own
menu; not yet tried as a real install on his PC or phone). Decided 2026-11-28 after an interview: no
server stream for rooms (Luke: "Keep today's way, fix it (Recommended)"); each device keeps playing the media itself, and
ROOM-DEVICE-SYNC also pulls one account's devices to about a tenth of a second apart (Luke: "Yes, pull them tight (Recommended)"),
keeps one player alive in a background tab and shows a short LINING UP line.

## Half-done
- EXPLAIN: hover words on every key, shown only while `[ EXPLAIN ]` (PREFERENCES, off by default) is on; top bar, side
  panel, MEDIA, the room and music bar, profile and settings, the forum, the book reader, and letters, docs and lore live
  (a8fcf58, eed29ea, e14e50d, 6c2601a, f3a9828, and 2026-11-28's letters/docs/lore push; 933 keys explained, 450 to do);
  next the rest (comic studio, character workbench, animate, beatbox, leaguebot, comms, tag station, recommendations), one
  fresh session per area (`Temp/check-explain.cjs` STILL_TO_DO; hand-over `explain-handover.md` in the group's notes folder).
- BROWSER: the easy install (`browser-easy-install-brief.md` in the 69ad notes folder). Live: Luke's text icon (extension 0.8.0), the
  Edge Add-ons pack (`docs/extension-store/README.md`, his steps; hidden; waits on him), [ CHOOSE AN EMPTY FOLDER ] (the site writes the
  extension into a new folder) and the copy key for the extensions page. Next, for a fresh session: the Firefox trial and the
  bookmarks-bar key (hand-over `browser-build-handover.md`), then the IMPROVE rounds. Also live: sign-in
  groups, IMPORT, the store pack (90d3d69), OWN WEB (8827218), lenses on pages OWN EYE shows inside BROWSER (7b85214), the address box
  following them (95a39db), EXPLAIN words on every BROWSER key and the first agent review's fixes (e71c71c, extension 0.7.1), every key
  named OWN EYE showing the page inside BROWSER (fa1c1b7), and the site's half of the morning's gaps (84517f1): one switch with both
  eyes named, hover words on the tray, a lens that can't be worn says why, a line on what works on an OWN EYE page, OWN EYE's pages in
  HISTORY (this browser only). Next extension version (0.8.1, built, held on branch `claude/gaps-ext-wip`): a clicked YouTube video
  followed, no ADD key that leads nowhere, hover words on the extension's own pages, with ALLOW EVERY SITE (Luke: "One optional key
  (Recommended)", decision 60) in the same version so he updates once. Then OWN WEB keeping OWN EYE's pages (his "Keep every page",
  decision 61: plan first, /privacy rewritten in the same push). Not built, his to choose: MEDIA, SEARCH THIS, WATCHERS and ERASE on a
  page OWN EYE shows.
- The shelf: BROWSER and REMOTE are marked WIP (f648c04).
- PLAYER-TV (Luke, 2026-11-28: "a small voxel tv at a 2.5d angle ... small enough to fit inside of the player bar ... the
  character will also crawl down and sit to watch the tv"): a session is writing the plan and his questions; SPEC first,
  nothing built (`player-tv-brief.md` in the 69ad notes folder).

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
- REMOTE to the gaming PC (2026-11-28): it stopped connecting because the PC's engine, started at sign-in, came up before
  the Wi-Fi had its address and handed viewers a dead one; the coordinator restarted it on his word ("Yes, restart it") and
  it now offers 192.168.0.30, but it breaks again at the PC's next restart. Two builders work on it since 2026-11-28 ~07:15Z:
  REMOTE-ENGINE-ADDRESS (the lasting fix) and REMOTE-ANYWHERE (his "get it working from any wifi, remotely, no setup": a way
  through the site itself, "okay but make sure it doesnt cost and look into it"; the engine opening a router port by itself,
  "Yes, automatically"; "Wait until sound works too"). Briefs and research: `remote-*.md` in the 69ad notes folder. His own
  try from the laptop on the home Wi-Fi is owed.
- SCREENS relay: activate Cloudflare Realtime/TURN on his account (he ticks the terms and pays himself), then paste the
  key into the RELAY KEY form.
- Off-site backup (Proton Drive, task `DebaserOffsite`) is built but off until he runs
  `C:\DEBASER-SETUP\proton-backup-setup.ps1`; then the first upload and a restore test are owed.
- BROWSER: the `see.debaser.site` DNS record, whether the machine puts away consent boxes; the Edge Add-ons listing (his eight steps in
  `docs/extension-store/README.md`, then the id; every new extension version is his upload again); whether OWN EYE's pages in HISTORY
  go on his account too (today: this browser only); which tools he wants on a page OWN EYE shows; Firefox signing (his Mozilla
  account), if the trial says go. Decided 2026-11-27: the server's eye stays his alone ("Only me (Recommended)", decision 62), the
  icon is the yellow square, no Chrome Web Store for now (decision 63).
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
