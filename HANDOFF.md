# Handoff (2026-11-04)
Older notes: `docs/handoff-archive.md`, newest first. Search it when a past decision matters; don't read it all.

## State
- MEDIA tagging's Claude key went into Vercel on 2026-11-05. Its first real batch is being watched: read `web_item_tags`
  and the `web-tag` cron's answers (`inputTokens`, `outputTokens`). Details and the cost reasoning: SPEC-media-picks.md.
- **Privacy plan:** phases 0 and 1 are live (`supabase/README.md`, "Privacy", `SPEC-privacy-phase-1.md`, `Temp/check-visitor-limits.cjs`, `Temp/check-privacy-defaults.cjs`). Phases need
  `SPEC-privacy-decisions.md`, and each starts when Luke says. Profile reads must name their columns: `select *` on `profiles` fails.
- Nothing else is half-done. Live: music rooms, the canvas + STREAM ART, CYTUBE, the MEDIA (/media) and FILES (/files) rename.
- Fewer checks per task (Luke's rule): every task runs `npm run checks:changed`; the whole `npm run checks` runs before a
  big feature and when it prints FULL RUN DUE. Details: core.md, scripts/README.txt.
- `Temp/check-*.cjs` are tracked now, except `check-resend.cjs` (it holds a mailbox password; the repo is public).
- Luke keeps the unused follow code on purpose for now (BroadcastHeartbeat, QueueFollower, QueueProfilePopout), so
  check-queues still tests it. Don't re-ask.

## Two machines
- **First time on the laptop:** its own `Temp/check-*.cjs` will stop `git pull` where the names match. Move them aside,
  pull, then put back only the ones git doesn't now have (check-stream-art, check-music-rooms, check-song-menu,
  check-stream-crawl, check-media-categories, check-character-place), run them, and commit them. For the rest compare
  before overwriting: the desktop's versions were brought up to date with the laptop's code on 2026-11-04.
- `.env.test` is on the desktop, where sign-in works; the laptop lacks it. The `drive-*` scripts are on the laptop only.
- The desktop's pre-restart history is on its local branch `backup/desktop-main-2026-11-03`. Never push it: the reason
  GitHub's history was restarted on 2026-11-01 is not recorded, and it may have been to remove something.

## Sessions sharing a folder
- Commit with named paths (`git commit -- <paths>`): another session's staged files go in otherwise. Check `git diff` on any
  shared check first, because its edits go in with yours.
- A whole `npm run checks` deletes the checks' compiled output first, so don't run one while another session runs checks.
- `npm run verify:clean` verifies your commit away from someone else's half-done files.

## Needs Luke
0. **MEDIA picks (SPEC-media-picks.md):** a newly made Claude key in Vercel as `ANTHROPIC_API_KEY`, or tagging stays idle.
   For YouTube: the Google Cloud and Supabase steps in that spec, then `NEXT_PUBLIC_GOOGLE_VIDEOS_LINK=on`. Neither job has
   run against the real services yet, so the first batch and first link need watching.
1. **Draw the art slots.** They show font stand-ins until filed: the CYTUBE icon (`assets/icons/cytube.png`), the canvas
   tools (pen, eraser, undo, save, the CANVAS key), the crowns (`mark-crown`, `mark-crown-filled`), the wide up arrow
   (`mark-up-wide`). Code never draws art.
2. **Read the CYTUBE ABOUT text**, written by the build session for him to check.
3. **Decide who gets HIDE on STREAM ART.** Today it is the house account (`is_admin()`), not his own. The spec said "only Luke".
4. **Feel test of "shake"** (older).
5. **Check a real phone.** `npm run shot -- --mobile` now draws the fitted 1280 desktop, which is what the viewport asks
   for, but no real phone has been looked at since that change.

## Not done yet
- Nobody has driven music rooms, the canvas or CYTUBE signed in on the live site, only on dev-mock.
