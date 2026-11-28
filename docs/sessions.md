# How sessions are run

Read this when you are the coordinator or a session it started. It replaces the old notes-folder file
`luke-list-agent-rules.md` (2026-11-14 to 11-27, kept there as history): every rule of it that still holds is here,
in `.claude/rules/core.md` or in `docs/decisions.md`, with its date and Luke's words. Skills: `brief` (starting a
session), `interview` (asking Luke), `handoff` (hand-overs and status).

## Roles
- **Luke** decides. He follows sessions in the Claude desktop app, often from his phone over Remote Control, by their
  task lists and end-of-turn reports.
- **The coordinator** plans, writes briefs, starts sessions, tracks them, asks Luke the questions and relays his answers.
  It does not build. It keeps one notes file (below) and `docs/STATE.md`'s "Sessions now" line current.
- **Builders** each do one task from a brief, in their own git worktree, editing only the files their brief gives them,
  and report back. A builder that needs another session's file asks that session (or the coordinator), never edits it.
- **Agents** (`.claude/agents/`) do contained jobs inside a session; at most 10 a session.

## Notes: one folder, one shape
- Every session of a group writes in the group's notes folder: the one the app names in the brief ("Shared notes folder
  for this group of sessions"). Never in another group's folder, never only in a message. A note written anywhere else
  is a note nobody reads (2026-11-23: the paid fallback nearly didn't start because a hand-over was in the wrong folder).
- Which folder, in practice (2026-11-27): the app gives each starting session a folder of its own, so there are three.
  Briefs, hand-overs and `coordinator-notes.md` live in `local_69ad3dc0-…`; a brief names it by its full path, and that
  path wins over the app's "Shared notes folder" line (two builders followed the app's line and wrote their hand-overs
  in `local_83ffacf4-…`: the coordinator's notes say where each one is). `heavy-step.cjs` and its locks: `local_4199eda8-…`.
- Names, so nothing is hunted for: `<task>-brief.md` (from the coordinator), `<task>-handover.md` (the builder's living
  status and hand-over, one file per task, kept current as items land), `<task>-report.md` (a long finding), and the
  coordinator's own `coordinator-notes.md`. Drafts of SQL: `<task>-<what>-draft.sql`.
- Every brief and hand-over starts with one line: `STATE: working | waiting on Luke | waiting on <session> | done`.
- The hand-over shape is in the `handoff` skill. `docs/STATE.md` holds what is true for the whole site; the hand-over
  holds one task's progress. git log is the truth for what landed.

## The coordinator
- **Keeps:** `coordinator-notes.md` in its notes folder: who is running (name, id, task, worktree), what each waits on,
  Luke's open questions and his answers word for word with dates, and what is next. Newest at the top; anything older
  than a week that no longer matters moves to the bottom under HISTORY. It keeps this current as it goes, so a restart
  loses nothing.
- **Delegates:** all building, reading of long files and checks. It reads reports and hand-overs, not code.
- **Restart (Luke, 2026-11-27: "Auto-shrink", at "300k tokens"):** every session on this repo is compacted automatically
  when its conversation reaches 300,000 tokens (`autoCompactWindow` in `.claude/settings.json`). The context hook warns
  at 250,000: bring your notes up to date now. After the compaction it tells the session to re-read `docs/STATE.md` and
  its own notes or hand-over before carrying on. Sub-sessions stay nested and keep reporting; it works over Remote
  Control. Why it matters: the first coordinator ran past 750,000 tokens and every reply re-read all of it.
- **Starting fresh instead** (a new day of work, or a compaction that lost the thread): write the notes, then start a
  new coordinator with `start_session` (fresh, no worktree), brief: "You are the DEBASER coordinator. Read
  docs/sessions.md, docs/STATE.md and <notes folder>\coordinator-notes.md, then carry on from its NEXT list." Running
  sessions still report to the old one until they finish, so each is told by message to report to the new one. The new
  coordinator pins itself; the old one is archived once nothing reports to it (Luke, 2026-11-27: "i need you to supervise
  them and archive them as soon as possible and then continue their work perfectly under this coorindator").

## Archiving when done (Luke, 2026-11-27, to the coordinator: "can you set it so that they and you check to see when the work is done and archive yourselves, along with the sessions under pc setup and sync, i want the coordinator to be the main session, along with the leftover cooridnator.")
- The sidebar is the one coordinator and whatever is still working (the old coordinator and PC setup were archived the
  same day, at his word: "supervise them and archive them as soon as possible"). Every other session archives
  itself (`archive_session` with "self") once its work is truly done, and only when ALL of these hold:
  1. Its work is pushed and confirmed live (`npm run deploy-status`, `npm run read`; docs-only work: pushed to
     `main`), and nothing is uncommitted in its worktree (archiving deletes the worktree).
  2. Its hand-over says `STATE: done`.
  3. Its final report has been SENT to the coordinator by message first (archiving ends the conversation, so the
     end-of-turn report can't be relied on to arrive).
  4. Nothing of it waits on Luke or on another session's answer, and no side session of its own is working.
  If any of these fails, it stays idle and its report lists what is still open.
- Remote Control first: the app refuses to archive a session while its Remote Control is on, and it is on by default
  (PC setup's own archive was refused for it, 2026-11-27). So the last two steps are: turn your own Remote Control off
  (`mcp__ccd_session_mgmt__set_remote_control` "self" false), then `archive_session` "self".
- Never archive a working session, or one waiting on Luke (2026-11-22: "make sure we dont close any of the working
  sessions"). The coordinator checks each report against git and archives a finished session that didn't archive
  itself. The coordinator pins itself: a pinned session is never archived, not even when a parent's archive takes
  its finished side sessions with it. Luke's memory file "Closing sessions" holds the same rule.

## Starting a session (the `brief` skill has the template)
- Its own worktree by default. A session that only reads may share a checkout. Two sessions never edit the same files;
  a shared checkout is used by one writer at most, and that writer commits only its own files.
- The brief gives: goal, Luke's exact words with the date, what is fixed, files owned, how to prove it, report shape,
  and the notes folder. A builder reads `docs/STATE.md` and its area's rule file, not every rule file.
- Big work: at most one heavy builder per area at a time, and few at once: SERVER ran out of memory with four heavy
  steps side by side (2026-11-27).

## Questions and approvals
- Luke chose (2026-11-27): "Everything via coordinator". A builder never asks Luke itself. It sends the coordinator its
  questions ready to ask: each with 2-4 options, its recommendation first with one line of why, what Luke will see for
  each, and the SPEC or decision it touches. The coordinator asks Luke with the multiple-choice box (`interview` skill)
  and relays his answer word for word.
- A relayed answer counts as Luke's own word, database changes and deletes included, when the coordinator's message
  quotes it exactly, with the date and the question it answered: `LUKE, 2026-11-27, to "<question>": "<his answer>"`.
  A paraphrase or "Luke said yes" without that is not an OK: ask the coordinator for the quote.
- Ask rarely: when a safe, easily changed default exists, take it and say which in the report. Never ask what
  `docs/decisions.md`, a SPEC or the brief already answers.

## Messages between sessions
- Short and fixed in shape, so the first lines carry it (a message waits in a session's queue until its turn ends,
  sometimes an hour; a report is cut to its first 400 characters):
  `FROM <name> TO <name> | WHAT: <one line> | NEEDS: <answer, file, nothing> | DETAIL: <notes file path>`.
- Anything longer goes in a notes file; the message names it.
- A message never carries an approval of its own and never widens one: only Luke's quoted words do (above).
- A message can arrive hours late (2026-11-27: a question box waiting on Luke held the coordinator's turn for nine hours;
  three final reports landed after their senders had archived). "Queued" is not "read". Before saying something is or
  isn't done, look at git (`git fetch; git merge-base --is-ancestor <sha> origin/main`) and the hand-over file, not at
  silence or the order of messages.
- `start_session` is refused on a turn that another session's message or a notification started, and while Luke is on
  Remote Control: propose a card instead, which he starts with a click in the desktop app.
- End-of-turn reports start with what is now live (commit) in one line, then in plain English what Luke will see, how it
  was proved, and what wasn't. Never "should work".

## The heavy-step turn (ONE AT A TIME ON SERVER, 2026-11-27)
SERVER hosts the live site, its database and the media apps in 16 GB, and four heavy steps side by side took it to
15.5 GB. Heavy: `npm run build`/`verify`/`verify:clean`, `npx tsc --noEmit`, `npm run checks` in any form, `next dev`
while used, and every browser drive, shot, capture or audit. Run each through the tool in the first coordinator's notes
folder (`local_4199eda8-…`): `node "<that folder>\heavy-step.cjs" <GROUP> -- <command>`. A dev server plus drives: `--claim
"<what>"`, do the lot, stop the server, `--release` (a claim is taken back after 30 minutes). Live steps: `--live`
(browser on the live site, 10 minutes apart) or `--live-check` (live database, no browser, 2 minutes). `--who` says who
has the turn; never delete a lock by hand. A wait can be long: run it in the background and carry on. Cheap steps need
no turn: reading, editing, git, `npm run tokens`, `read`, `deploy-status`, read-only `db`.

**The gaming PC lane (live and proved 2026-11-27):** `verify:clean` and the full `npm run checks` may run on the gaming
PC instead; nothing changes for the session asking. Commit first, then `node "<that folder>\heavy-step.cjs" <GROUP> --
npm run verify:clean` (optionally `-- <sha>`) or `-- npm run checks`. heavy-step prints where it went and why:
`heavy-step: remote lane: running on the GAMING PC (<why>)` or `... running on SERVER (<why>)`. The output streams
back; the exit code and the final CLEAN VERIFY PASSED/FAILED line are the same as on SERVER (the PC's line adds "on the
gaming PC"). Which machine, and what never goes: "Which machine does what" below.

## Builders' setup and loop
1. In your worktree: `git fetch origin`, start from `origin/main`. Copy `.env.local` and `.env.test` from
   `G:\debaser.site\` if missing (never print or commit them). `npm ci` in the background if `node_modules` is missing.
2. Read `docs/STATE.md`, your area's rule file and the docs your brief names; `node scripts/ctx.cjs <topic>` for the
   rest.
3. Proving it locally (2026-11-14): a dev server on a port of your own (`npm run dev -- -p <port>`) with
   `NEXT_PUBLIC_*_DATA_SOURCE=mock` for every switch in `.env.example`, set in that server's environment, never in a
   tracked file (a local server pointed at the live database is a live test). Never `preview_start` or the in-app
   browsers (`mcp__Claude_Browser__*`, `mcp__claude-in-chrome__*`, `mcp__computer-use__*`): their approval prompts
   stall unattended sessions. Use `npm run shot`, `npm run look`, `scripts/browser.cjs` and the drive scripts. The
   reusable browser (`npm run browser -- --start`) has one port for the whole machine: prefer `npm run shot -- --signin`
   or your own `--profile Temp/browse/<name>`, and never `--stop` a browser you didn't start. Visual changes: dark theme
   first, then the bright one; `npm run contrast` for colour changes. Test accounts A to D are used by other sessions
   at the same moment: don't assume their state.
4. Live steps, when nothing local can prove it: short, no watch loops or 30-60 second observation windows, close the
   browser at once, read-only `db` selects not looped. In the report, say for each item which proofs were local, which
   were `npm run read`, and which needed a live step and why. Don't wait on background work with a hand-made
   `until grep` loop: run it in the background and carry on.
5. The house loop (core.md), batched: one `verify`, one `checks:changed`, then commit with an explicit pathspec
   (`git commit -m "..." -- <paths>`), `git fetch` and `git rebase origin/main`, ONE `verify:clean` through the turn
   (merge origin/main first; the clean copy is `G:\debaser-clean-verify`), push `git push origin HEAD:main`,
   `npm run deploy-status`, `npm run read`.
6. Shared files several sessions touch (`app/globals.css`, shared checks): add beside your feature's block, change only
   your own assertions, keep both sides on a conflict. A key that folds something open in place carries
   `aria-expanded`, and there is one global "this is open" look: don't invent another (2026-11-14).
7. Leftovers your tests made (ids) go in your hand-over: deleting them waits for Luke.
8. Done: hand-over to `STATE: done`, final report sent to the coordinator by message, then your own Remote Control off
   and archive yourself ("Archiving when done" above, all four conditions). If anything is still open, stay idle and say what.

## Which machine does what (Luke, 2026-11-27, typed to the coordinator: "splitting the workload intelligently between my active devices … utilise the thing we set up that allows the devices to communicate … make sure this also works when prompting on my laptop"; his choices the same day: "Tailscale", "On SERVER", "Heavy lane", "Only for reading work")
- **SERVER runs every session**, whichever device Luke prompts from. It alone has the code with its notes, the
  database, `.env.local`/`.env.test` and the heavy-step turn. The **laptop and the phone are windows onto it**: Remote
  Control (on by default for SERVER sessions), or the laptop app's SSH connection to SERVER over Tailscale. A session
  never builds on the laptop: one that finds itself on a machine other than SERVER (`hostname` is not `server`, or
  `G:\debaser.site` is missing) stops and says so.
- **The gaming PC is the heavy lane** (live and proved 2026-11-27, built by the PC setup session, which owns
  `heavy-step.cjs` and `remote-lane.cjs`; Luke: "an even split... leave the server at no more than 60%"; on the PC "Full
  speed"; League match or PC off: "Run on the server instead"). Since 2026-11-28 the PC is the FIRST choice and SERVER the
  fallback (Luke, to "should the gaming PC become the FIRST choice, with SERVER as the fallback, instead of today's taking
  turns?": "PC first (Recommended)"; the old taking-turns rule is kept beside it as `remote-lane.before-pc-first.cjs`).
  How a session uses it: "The heavy-step turn" above.
  - **Only** `verify:clean` and the full `npm run checks` can go to the PC. Never `--live`, `--live-check`, `--claim`,
    dev servers, browser drives, `checks:changed` or `checks --only`; never the live site, database, Docker, tunnel or
    engines; never whole sessions.
  - **Stays on SERVER** when the PC is off, asleep or unreachable (a probe of about 3 seconds), a League match is on
    the PC, the PC is already running a job, the full checks are asked for and the PC has no `.env.local`/`.env.test`
    (copied there on 2026-11-27 at Luke's word "Yes, copy them", relayed by PC setup; its probe says `checksReady`), or
    the off switch is set: a file `remote-lane.off` beside
    `heavy-step.cjs` (everything stays on SERVER while it exists).
  - **Goes to the PC** when SERVER's memory is over 60% in use (Luke's ceiling) or another heavy step holds SERVER's
    turn. Otherwise the two take turns (`remote-lane.next` beside the script remembers whose turn is next).
  - **Failures:** if SSH drops part-way, or the PC reports it is busy or its setup failed, the step re-runs on SERVER by
    itself. A real verify or check failure on the PC comes back as a failure, like one on SERVER.
  - **How it runs:** the exact commit goes to the PC as a git bundle over `scp`, into the PC's own clean clone
    `G:\debaser-worker\repo` (on the PC's SSD), and `G:\debaser-worker\run-job.cjs` there runs the same steps as on
    SERVER (its source is `C:\DEBASER-SETUP\pc-worker\run-job.cjs` on SERVER). Full speed on the PC; if a League match
    starts part-way, the job drops to idle priority. For a checks job the PC runner also opens an SSH tunnel from the
    PC's `127.0.0.1:5432` to SERVER's `127.0.0.1:5432` (the PC's own key to `debaser-server`), because
    check-db-guard, check-guests and check-moderation reach the database through `scripts/db.cjs` at that address; the
    tunnel closes when the job ends. `scripts/db.cjs` reads `POSTGRES_PASSWORD` from `G:\DEBASER-HOST\supabase\.env`:
    the PC has that file holding only that one value (Luke, 2026-11-27, relayed by PC setup: "Yes, password only"),
    readable only by his account and Administrators. The runner sets `CLAUDECODE=1` for every job, because the
    Supabase CLI answers in JSON only then and check-guests reads that JSON.
  - **Proof (PC setup, 2026-11-27):** an unpushed test commit verified on the PC in 71 seconds through heavy-step (147
    seconds the first time, with `npm ci`; SERVER takes about 5 minutes). The full suite at 9aa047e: 264 of 268 in
    about 18 minutes; after the two fixes above, check-db-guard, check-guests and check-moderation passed on a re-run,
    so the PC's suite matches SERVER's (only check-hidden-accounts red, the known one). PC unreachable, checks without
    the env files and the off switch each went to SERVER; a faked League process kept it on SERVER, and it went back to
    the PC after.
  - **Times on the PC:** `verify:clean` about 70 seconds, the full `npm run checks` about 18 minutes.
- **Between devices:** the lane uses key-only SSH from SERVER to the gaming PC over the home network: SSH alias
  `gaming-pc` (192.168.0.30), SERVER's key, the PC's port 22 open only to SERVER. Tailscale is the road Luke chose for
  the rest (`debaser-server` is on it; on 2026-11-27 the laptop, phone and gaming PC had not joined; when the PC joins,
  the lane may use it too). `docs/STATE.md`, "Waiting on Luke".
- **Cloud sessions only for reading work** that needs no database or house machine: research, reviews, SPEC drafts.
  They start from the pushed `main` and never push; building stays on SERVER. Setting the cloud up for the repo is
  Luke's click.
- **Which model:** a new session starts on the lightest model that can do its job (Luke, 2026-11-28: "new tasks need to
  be started in lighter models where possible"; the `brief` skill says which for what).
- **Inside a session:** subagents for contained jobs, read-only ones on a cheaper model where they suit; skills for
  repeated recipes (`brief`, `interview`, `handoff`, `verify-site`, `add-web-adapter`); hooks for the guards; memory
  for Luke's standing rules about Claude itself.
- `heavy-step.cjs`, `remote-lane.cjs` and their locks live in the coordinator's first notes folder (`local_4199eda8-…`), outside the repo,
  on SERVER: sessions on SERVER reach it by that path.
