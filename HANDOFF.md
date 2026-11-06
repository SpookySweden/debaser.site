# Handoff (2026-11-06)
Older notes: `docs/handoff-archive.md`, newest first. Search it when a past decision matters; don't read it all.

## Accounts lost, 2026-11-06 (read this first)
A clean-up through `npm run db` lost its filter and deleted every account at 21:11 UTC (13, plus test guests). Free plan, no backups we can reach. Luke emailed support@supabase.com from his Gmail, 21:55 UTC, thread `1a1b2dbd6820f284`: watch for a reply; a full restore would replace everything below.
- **Coming back:** `account_restores` (addresses from a 14 October log, Luke's details; rows never in this public repo; nobody can read it) and `restore_lost_account`: signing up with an old address restores the details and relinks posts by their `author_label`. A browser still holding a dead session gets `LostAccountWindow`. Only the address proves who you are, because sign-up doesn't confirm addresses and the server holds no secret: Luke knows.
- **House account:** `is_admin()` needs a `house_account` row now. Signing up with its address is refused unless `house_account_gate` has a row in date; the trigger fills `house_account` and shuts the gate. Claude can't create it (a firm limit), and doesn't need it: `npm run db` has full access. After Luke makes it: put its new id in `NEXT_PUBLIC_SITE_ACCOUNT_ID` in `.env.production`.
- **Moldavius figtree's song** isn't in storage under their folder: ask Luke. Moot's only picture on file is a ginger cat in headphones, used for his "lion".
- **Luke has decided to continue without the Supabase restore (2026-11-06).** DMs, rooms, canvases, playlists and likes are gone. Characters were only ever in each person's browser, so they survived; they're on the account now too (`user_characters`, `library-sync.ts`): signing in sends up what that browser holds, and the table can't lose them with an account or delete them.
- **Tests:** TEST ACCOUNT C and D don't exist until a check signs them in.

## Picked up again, 2026-11-06 afternoon
- **WATCH (SPEC-kino-sources.md):** replaced the free-copy key and the where-to-watch list. No real friends' server exists yet, so its server lines are only proven with fake servers (the KINO session's harness, run at desktop and two phone widths). Known, and older than WATCH: back on /media after a search, a video that was in its box can stay floating with the row off screen; its `[ BACK ]` still finds the row.
- **Live:** the last bar key is MODULOS, a solid block; the title stays `MODULES:`. DISCOVER starts off; DISCOVER, BEATBOX and ANIMATE wear WIP (`afd0576`). KINO: free copies behind `[ FREE COPIES ▾ ]`, licensed YouTube uploads offered, `[ SEE WHERE ↗ ]` gone, the rule that a server must hold what it lists gone (`listPath: '*'` stays, unused; `aaf51b8`). DISCOVER: FOUND SO FAR beside ON n ITEMS, ADD A WORD finds off-map words (`612b061`, `677e8eb`).
- **Luke's choices:** STREAM ART's HIDE stays on the house account. NVDA is installed on the desktop and off; the installer started it once and he had it quit, so don't start it.
- **KINO, later the same day:** `+1 MORE` is gone, and no evidence of the public domain is asked for (`bcf647c`, Luke: "Remove the evidence thing and serve the YouTube videos that are found"). Any linked upload that will play is served. Left on: Wikidata calling a film copyrighted keeps its Archive copy off, which he hasn't asked to change. Then a row lists every copy to choose from, up to 6 Archive and 8 YouTube, and JustWatch's credit lost its link but stays as words, which TMDB requires (`45558ad`).

## Paused by Luke, 2026-11-06 ("pause the work asap and we will pick up soon")
- **Live, proven by their sessions or the main session:** modules on the top bar (`app/lib/ui/modules.ts`, `user_modules`, `Temp/check-modules.cjs`), ANIMATE's new interface (`e5c3b09`), KINO sources (`d43be5c`), beat box layout C, `[ WATCH IN ROOM ]`, sign-in shown at once (`15d9326`).
- **Live, by DISCOVER's own report (`c6f42bb`; `SPEC-discover.md`), not re-checked by the main session:** tags reach readers: MEDIA search lists the catalogue, `[ MORE ]` digs further, any word can be searched, junk titles and no-player rows sink. Database 152 MB. MEDIA's DISCOVER now opens in about 3.5 s. Left: the whole suite is due (FULL RUN DUE), and the DISCOVER page's must-have and any-of boxes still take only map words.
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
