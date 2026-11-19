# Handoff (2026-11-18)
Older notes: `docs/handoff-archive.md`, newest first (the 2026-11-15 handoff is at its top). Coordinator notes, briefs
and every session's check-in lines: the shared notes folder
`AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_27370d78-4644-44af-a1d7-9888cfb5e583\`
(`list3-*`, `list4-*`, `*-brief.md`, `luke-list-agent-rules.md`, `heavy-step.cjs`).

## The big change: the site runs from Luke's desktop PC (2026-11-18, SPEC-self-hosting.md)
- The free Supabase cloud project was restricted on 2026-11-17 22:11 UTC (HTTP 402, file-serving quota, mostly songs).
  The site now runs on the desktop: self-hosted Supabase in Docker (data on G:), the app built from `main` by itself,
  behind a Cloudflare Tunnel at https://debaser.site (`api.debaser.site`). `debaser-site.vercel.app` only forwards.
- `npm run db`, `db:push`, `db:backup`, `web:fetch` act on the PC's database (`--cloud` reaches the old blocked one:
  write nothing there). Only the desktop reaches it, not the laptop. Worktrees made before the move: re-copy
  `.env.local` from `G:\debaser.site\` before any live check. `deploy-status` waits for debaser.site to report the commit.
- Backups: `DebaserBackup` (04:00) dumps the PC (database, roles, files, settings) to `I:\DEBASER\backups`, 30 kept, a
  desktop note on failure; a restore was proved. Luke: no Google Drive copies for now (everything is on one PC).
- Still to do (HOSTING session, kept open): Stage 6 copies songs, avatars and other files from the cloud when its block
  lifts (~20 Nov); until then many pictures/songs show as missing (re-uploads now work, 245a399). Windows (2026-11-19):
  automatic sign-in on, no update restarts while signed in (AUOptions=4 + NoAutoRebootWithLoggedOnUsers), active hours
  11:00-05:00 as the fallback; Luke restarts by hand monthly. Still owed: one test restart, then check everything returns.
- Docker stopped unnoticed 2026-11-18 18:58-22:06 UTC; `keep-running.cjs` now watches it (f09eed4). Quitting Docker on
  purpose: create `G:\DEBASER-HOST\docker.paused` first, or the watch starts it again.

## Done 2026-11-16 to 18 (all live, sessions archived; details in the check-in files)
Lists 3 and 4 (rooms, MEDIA, fluid, background THEME switch, room window and queue, forum fixes), 14 orange/green themes
(MARMALADE, OVERDRIVE, TIGERBREAD, CLEMENTINE), HISTORY window, livestreams (Twitch + YouTube lives in MEDIA and rooms),
LEAGUEBOT (keyless: OP.GG/U.GG; LIVE tab works), PERF (FLUID in its own thread, 180 fps drags; lighter database load),
FEEDALGO (PICKED FOR YOU ranked from every signal, why-lines), MEDIACARD (neat cards, source on expand), forum v2 and v3
parts 1-2 (tabs, DESK, site-wide SEARCH + Ctrl+K, TALKED ABOUT IN, settings that follow the account, MADE posts),
room chat anonymised for private rooms, lost canvas restored.

## Tooling the sessions share
- `heavy-step.cjs`: with no League match (process `League of Legends` only) heavy steps run side by side; `--live`
  (browser drives, 10 min apart) and `--live-check` (database checks, 2 min) queue; `verify:clean` has its own turn.
- Sessions must keep their pinned task lists honest (Luke watches them); ONE verify:clean per push.

## Waiting on Luke, or left on purpose
- Test leftovers on TEST ACCOUNT A/B (two ROOMCHAT chat lines; two ended rooms and one canvas from CANVAS): a delete,
  so it waits for his OK. TEST ACCOUNT A's own room `8853d917-…` is kept on purpose.
- POPOUT (dragging panels out of the browser): on hold (`popout-brief.md`).
- The first-visit "HAD AN ACCOUNT?" pop-up covers the whole page for new visitors; offered to make it smaller.
- Not proved by a real person: the fluid's feel, FIT, THEME switch, new themes, his own PICKED FOR YOU, LEAGUEBOT LIVE
  in his own match, Twitch autoplay in his browser.

## Known red checks
`check-hidden-accounts` (house account, Luke's choice). See the latest full run's line in `list4-checkin.md`.
