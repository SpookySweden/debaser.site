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
- The gaming PC is only a SCREENS device now. Old session notes from it: `I:\work-data\claude-notes\` (history only).

## Sessions now
The coordinator runs them; who is working on what, and their notes: the coordinator's notes and the group's notes folder
(`docs/sessions.md`). On 2026-11-27: BROWSER (the seeing machine, `SPEC-seeing-machine.md`, its hand-over
`browser-build-handover.md`), same-account room sync (rooms keep every device), hover explanations (EXPLAIN, top bar
built), this context system.

## Half-done
- EXPLAIN: hover words on every key; the top bar is built; side panel, rooms, MEDIA, profile, forum to go.
- BROWSER: lenses on the framed page, sign-in groups, the Chrome Web Store listing (pictures are Luke's).
- The shelf: BROWSER and REMOTE are marked WIP (f648c04).

## Waiting on Luke
- Tailscale: the laptop, phone and gaming PC join his tailnet (install, sign in with the same account) so sessions
  and the heavy lane can reach them (his choice, 2026-11-27; `docs/sessions.md`, "Which machine does what"). Then the
  laptop app gets an SSH connection to SERVER. Cloud sessions for reading work need the cloud set up for the repo (his
  click).
- SCREENS relay: activate Cloudflare Realtime/TURN on his account (he ticks the terms and pays himself), then paste the
  key into the RELAY KEY form.
- Off-site backup (Proton Drive, task `DebaserOffsite`) is built but off until he runs
  `C:\DEBASER-SETUP\proton-backup-setup.ps1`; then the first upload and a restore test are owed.
- BROWSER: `SEEING_OPEN`, the `see.debaser.site` DNS record, whether the machine puts away consent boxes, and his own
  word on changing "nothing of it is kept" (OWN WEB).
- Google sign-in check on debaser.site from his own browser.
- The gaming PC's security (Defender off, dead startup entries, old encrypted files in `C:\tmp`): his to change.
- Test leftovers on TEST ACCOUNT A/B (ROOMCHAT lines, CANVAS rooms): a delete, waits for his OK. POPOUT on hold.
- Optional private GitHub backup of the game repo (needs his clear yes).
- Asked by the PC setup session: whether SUNSHINE's engine can hold its frame buffers only while someone watches
  (about 1.5 GB held while idle).

## Known red checks
- `check-hidden-accounts` (the house account, Luke's choice).
- Listed as known reds in the old agent rules (2026-11-14 to 17), not re-checked since: `check-structure` ("any" in
  `shadow-books.ts`), `check-web-filters` (its SOURCE line), `check-web-live-merge`.
- Live-database checks that were red after the move to SERVER (coordinator, 2026-11-22; not re-checked since): `check-private-streams`, `check-auth-at-once`,
  `check-media-visitors`, `check-storage-rules`.
