# Handoff (2026-11-22: work moves to SERVER)
Older notes: `docs/handoff-archive.md`, newest first. The gaming PC's session notes (every brief, check-in and
hand-over, incl. `luke-list-agent-rules.md`, `heavy-step.cjs`, `list5-checkin.md`, `sunshine-handover.md`) are copied to
SERVER at `I:\work-data\claude-notes\` (one folder per old notes folder; the coordinator's is `local_27370d78-…`,
SUNSHINE's is `local_e225015a-…`). Read them as history; new sessions get their own notes folder.

## Where things run now
- SERVER (HP ProDesk 600 G4, Win 11 Pro, 192.168.0.154) hosts debaser.site since 2026-11-22 01:55, and from today all
  Claude work sessions run there too: the repo at `G:\debaser.site` (G: = `C:\DRIVES\G`), the host at
  `G:\DEBASER-HOST`, the external drive as `I:` (backups `I:\DEBASER\backups`, 04:00 daily, 30 kept). The db tools,
  `deploy-status`, `read` and `web:fetch` work from SERVER. SPEC-self-hosting.md has the whole setup, incl. the restore
  trap (fresh self-hosted Supabase adds default privileges: restore schema-only into a scratch database and compare ACLs).
- The gaming PC (Windows 10 Home, NVIDIA) is now only a SCREENS device: `G:\DEBASER-HOST\engine\debaser-engine.exe`
  streams it (LAN key + STUN, `--internet`). Its own start after a reboot: see `sunshine-handover.md`. The PC fallback
  site is gone (Luke, 2026-11-22: "delete the fallback now"): Docker data, site builds and the DebaserHost/Update/Backup
  tasks removed, Docker Desktop no longer starts with Windows. The way back is now SERVER's backups only.
- Off-site copy of the backups is still owed (SPEC-self-hosting Stage 7, deferred): the database dumps and the uploaded
  files sit on the same external drive.

## Recently done (all live; details in `list5-checkin.md`)
List 5 (asleep page + tunnel down-alert emails, COMIC phase 1, NOTIFY phases 1-2 incl. weekly email via Resend, first-
visit tour v2, MODERATION with Luke as owner moderator and hidden-by-default mod tools), Stage 6 (cloud files back),
ROOMBARS (fullscreen bar hides, MEDIA picture plays, KEYS IN THE PICTURE), buddies (sweden + moldavius figtree), DESK
rework, MODULOS always-ons, VIS/CANVAS back to words, SCREENS/SUNSHINE (own engine, REMOTE device list, FIT, server by
RDP through Guacamole with the Cloudflare Access lock, both machines' engines, Intel Quick Sync on SERVER, relay key form).

## Waiting on Luke
- SCREENS relay: activate Cloudflare Realtime/TURN on his account (free 1,000 GB a month, then $0.05/GB; he ticks the
  terms and authorises PayPal himself), then paste the key into the RELAY KEY form.
- SERVER: RAM to 16 GB; VS Code + its Claude extension if he wants them; whether to skip the bypass-mode prompt there.
- Google sign-in check on debaser.site from his own browser.
- The gaming PC: Windows Defender real-time protection is OFF; dead startup entries left from an old infection
  (Run keys pointing at missing files in C:\tmp, C:\ESD, C:\Dell\UpdatePackage\log); `C:\tmp` holds 2021 Babuk-encrypted
  files. Security settings are his to change. `ArcRaidersFix_CloseRazerUI` startup entry points at `G:\arc raiders fix`,
  which moved to `I:\work-data\personal\` on SERVER: copy it back if he still plays Arc Raiders on the PC.
- Test leftovers on TEST ACCOUNT A/B (ROOMCHAT lines, CANVAS rooms): a delete, waits for his OK. POPOUT on hold.
- Optional private GitHub backup of the game repo (needs his clear yes).

## Tooling and rules that carry over
- `luke-list-agent-rules.md`: FULL SPEED, live checks 2 min / live drives 10 min apart, honest task lists, SAVE USAGE
  (checks:changed once at the end, no full suite unless asked or due, one verify:clean per push, none for docs/SQL/Temp-
  only changes; reports stay comprehensive). `heavy-step.cjs` paces heavy steps (League match = keep load low; League is
  played on the gaming PC, so on SERVER it matters less).
- Known red: `check-hidden-accounts` (house account, Luke's choice).
