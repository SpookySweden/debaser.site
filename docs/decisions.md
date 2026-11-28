# Luke's standing decisions

One line each, newest first: date, area, his words where they were recorded, and where the rule lives now. Before asking
Luke anything, look here, in the area's SPEC ("Decisions" sections) and with `node scripts/ctx.cjs <topic>`: never ask
twice. When he decides something new, add a line here in the same commit as the change (the `interview` skill says how).
Product decisions for one feature stay in its SPEC; this file is for the ones that steer how work is done, plus pointers.

## How work is done
- 2026-11-28 · sessions · Gaming PC first (box, to "should the gaming PC become the FIRST choice, with SERVER as the fallback, instead of today's taking turns?"): "PC first (Recommended)" → `remote-lane.cjs` beside heavy-step.cjs sends `verify:clean` and the full checks to the PC whenever it is reachable, free and not in a League match; replaces the 2026-11-27 "even split".
- 2026-11-28 · sessions · Lighter models (typed to the coordinator, after two sessions hit the 5-hour usage limit): "new tasks need to be started in lighter models where possible" → `brief` skill ("Before starting it"), `docs/sessions.md`.
- 2026-11-27 · sessions · Archive when done (typed to the coordinator): "can you set it so that they and you check to see when the work is done and archive yourselves, along with the sessions under pc setup and sync, i want the coordinator to be the main session, along with the leftover cooridnator." Every session but the coordinator (pinned; the old coordinator and PC setup were archived the same day at his word, "supervise them and archive them as soon as possible") archives itself once pushed, live, hand-over done, report sent, nothing waiting → `docs/sessions.md`, "Archiving when done"; `brief` and `handoff` skills; memory "Closing sessions".
- 2026-11-27 · devices · The test keys on the gaming PC so the full checks can run there: "Yes, copy them" (relayed by the PC setup session) → `docs/sessions.md`, "Which machine does what".
- 2026-11-27 · devices · "splitting the workload intelligently between my active devices … make sure this also works when prompting on my laptop"; his choices: the link is "Tailscale"; sessions run "On SERVER" (laptop and phone are windows onto it); the gaming PC is the "Heavy lane"; cloud sessions "Only for reading work" → `docs/sessions.md`, "Which machine does what".
- 2026-11-27 · sessions · Coordinator restart: "Auto-shrink" at "300k tokens" for every session on the repo → `docs/sessions.md`, `.claude/settings.json`.
- 2026-11-27 · sessions · Questions: "Everything via coordinator"; always the multiple-choice box, recommendation first → `docs/sessions.md`, `interview` skill. (Replaces the 2026-11-14 rule that builders never used the box: they still don't; the coordinator does.)
- 2026-11-27 · sessions · A look-up tool instead of reading whole SPECs: "Build it" → `scripts/ctx.cjs`.
- 2026-11-27 · sessions · The context system itself (typed to the coordinator): "work on efficiently ordering our set of instructions and context for each session … interviews always given as well thought out and referenced multiple choice selection prompts" → this file, `docs/sessions.md`, the skills.
- 2026-11-27 · SERVER · ONE AT A TIME ON SERVER: every heavy step takes the one turn (four side by side took 16 GB to 15.5 GB) → `docs/sessions.md`. It retires FULL SPEED (2026-11-16) and the League pacing (2026-11-14) below.
- 2026-11-27 · hosting · The site rebuilds every 5 hours, and at once when `deploy-status` asks → core.md.
- 2026-11-22 · sessions · "make sure we dont close any of the working sessions, any new sessions should open under this one" → memory, "Closing sessions".
- 2026-11-21 · usage · "to stop using so much we need to limit the longer thinking things that are less necessary such as the rampant checks"; and "i like the comprehensive reports so dont neuter them too much" → core.md, "Save usage".
- 2026-11-17 · sessions · Keep the task list honest: tick each step as it ends (sessions sat on step 1 for an hour) → core.md.
- 2026-11-17 · live checks · "Yes, 2 minutes" between live database checks; browser drives stay 10 → core.md, `docs/sessions.md`.
- 2026-11-16 · usage · "limit the live site drives and verify: cleans where feasible to promote efficiency": one verify:clean per push, live drives batched into one run → core.md.
- 2026-11-16 · art · "be leniant with the rules where necessary for the sake of creativity and fun" (smears); simulated backgrounds "allow yourself liberty for the sake of quality and style" → `.claude/rules/art.md`.
- 2026-11-15 · media · Downloading, caching, transcoding and self-hosting media allowed (he removed those rules) → `.claude/rules/media.md`.
- 2026-11-15 · media · Scraping a platform's pages only with his OK each time and a fallback → `.claude/rules/media.md`.
- 2026-11-14 · testing · "since live tests take a lot of time and seem to cause some issues then lets find ways to reduce them where possible and test on local dev servers" → core.md.
- 2026-11-14 · phones · "dont worry about coding phone specific stuff, the phone version of the site will be worked on separately all in one go once the desktop version is feature complete and smooth" → core.md, frontend.md.
- 2026-11-14 · reports · "dont worry about sending the screenshots i can look at the site myself" (except a visual choice) → core.md.
- 2026-11-14 · coordinated sessions · Small items from his lists need no plan-and-wait (build, prove, ship); items marked SPEC FIRST do → `brief` skill.
- 2026-11-14 · coordinated sessions · "Remove X but keep the code" means the code stays in the repo, unreferenced or switched off, with a one-line comment saying why → `brief` skill.
- 2026-11-14 · coordinated sessions · Don't edit `G:\gane-conductor`; don't touch or extend the shadow-books feature unless the brief is about it → `brief` skill.
- 2026-11-14 · retired · League pacing ("slow down the work in such a way where league of legends stops stuttering") and FULL SPEED (2026-11-16, "allow as many as you like use my pcs full resources"): both on the gaming PC; League is not played on SERVER. Replaced by ONE AT A TIME (2026-11-27).
- 2026-11-06 · database · After `delete from auth.users`: writes from `--file` only, guards in `scripts/db.cjs` → core.md, Safety.
- 2026-11-04 · hooks · The secrets rules stay on trust; don't suggest bringing that hook back → core.md.
- 2026-11-03 · media · Standing OK to run `npm run web:fetch` for fresh data to check work → core.md.
- 2026-11-02 · phones · Phones get the desktop zoomed out (1280px viewport) until a real phone design → frontend.md.

## Where the rest are
- Each feature's choices: its `SPEC-*.md` (`docs/INDEX.md` lists them all; BROWSER's are numbered in SPEC-seeing-machine.md, "Decisions taken for Luke").
- MEDIA, BROWSER and art rules, each with its dates: `.claude/rules/media.md`, `browser.md`, `art.md`.
- Older hand-overs and what was decided along the way: `docs/handoff-archive.md`; commit messages quote him (`git log --grep "Luke"`).
