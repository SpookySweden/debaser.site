# Handoff (2026-11-06)
Older notes: `docs/handoff-archive.md`, newest first. Search it when a past decision matters; don't read it all.

## Paused by Luke, 2026-11-06 ("pause the work asap and we will pick up soon")
- **Live, proven by their sessions or the main session:** modules on the top bar (`app/lib/ui/modules.ts`, `user_modules`, `Temp/check-modules.cjs`), ANIMATE's new interface (`e5c3b09`), KINO sources (`d43be5c`), beat box layout C, `[ WATCH IN ROOM ]`, sign-in shown at once (`15d9326`).
- **Pushed, not proven:** DISCOVER's work so tags reach readers (`ccc4b35`, `0765b09`, `69abaf9`; `SPEC-discover.md`): MEDIA search lists the catalogue, `[ MORE ]` digs further, any word can be searched, junk titles and no-player rows sink, real counts. Next: its live before and after numbers, and measure file reads.
- **Tagging is OFF:** `web-sweep` and `web-tag` are inactive by Luke's choice. $59.25, 1.69 million items. The database choked at about 10:15 UTC, likely from tagging, not proven; the Disk IO graph (Supabase, Reports > Database) would settle it and needs his sign-in. Don't turn them back on without his OK. Left: batch 6797, the stop rule, the `web_word_vocabulary` fix, the 300,000 word cap.
- **For Luke:** tick BEATBOX and ANIMATE back on in MODULES; try one beat box save and post; try ANIMATE with a real pen (`docs/animate-pen-list.md`). Real friends' servers are untested. Claude keys expire Dec 5.
- **Limit that stays:** no session adds vidsrc, 2embed or similar. The code's block on them was removed at his choice.

## Tomorrow, from 2026-11-05 (Luke ran out of limit; he drives from a laptop, work runs on the desktop PC)
The main session answers side sessions from the specs and asks Luke only what is his. Database changes and spending wait for his OK.
- **Privacy:** phases 0, 1 and 2 pushed (`ef625a6` for 2: check its three-browser drive ran). Phase 3 next, then `[ WATCH IN ROOM ]` (`SPEC-floating-player.md` part 3). Decisions: `SPEC-privacy-decisions.md`. Phase 3 database changes need his OK.
- **DISCOVER (`SPEC-discover.md`):** rename and sweep pushed. Recommending, the two filters (blank until 10,000 tagged) and presets are next. Check the first sweep's real cost and the $50 and $60 stops. TMDB text never goes to Claude; KINO search stays as it is.
- **Beat box:** at /beatbox with saved songs. Left for Luke: listen to it, NVDA test (not installed, needs his OK), his art.
- **Animator:** started on branch `animator` (`SPEC-animator.md`, Luke's Living Plan doc). Not on main unless a phase says so.
- **Floating player:** live, with ADD TO ROOM and double-press fullscreen (`949a6b9`).
- **Game (`G:gane project`):** three minds faults fixed or partly fixed; the conductor runs the minds test nightly, a paid run there untested.
- **Security:** a Claude key fragment was printed in the session transcript on 2026-11-05; that key was deleted. Luke's current keys expire Dec 5, 2026: tagging stops then unless replaced in Vercel.
- **Check:** did the privacy session's two extra drawing-rule fixes go beyond his Phase 2 OK? Report what they changed.

## State
- MEDIA tagging's Claude key went into Vercel on 2026-11-05. Its first real batch is being watched: read `web_item_tags`
  and the `web-tag` cron's answers (`inputTokens`, `outputTokens`). Details and the cost reasoning: SPEC-media-picks.md.
- **Privacy plan:** phases 0 to 3 are live (`supabase/README.md`, "Privacy", `SPEC-privacy-phase-1.md` to `-3.md`, `Temp/check-visitor-limits.cjs`, `Temp/check-privacy-defaults.cjs`, `Temp/check-private-streams.cjs`). The live drives `Temp/private-streams-drive.cjs` and `Temp/private-outsiders-drive.cjs` each leave a private thread by TEST ACCOUNT A: delete them after (`supabase/cleanup/` has the pattern). Phases need
  `SPEC-privacy-decisions.md`, and each starts when Luke says. Profile reads must name their columns: `select *` on `profiles` fails.
- **ANIMATE** (`/animate`, SPEC-animator.md): all six phases of Luke's animator are live. Local to the browser, no database. Waiting on Luke's pen: `docs/animate-pen-list.md`. Proof: `scripts/drive-animate.cjs`, `Temp/check-animate-*.cjs`.
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
