# DEBASER_OS

Companion website for my comic book "Debaser": a social simulation styled as an operating system (forum, comms, music, mini-games, lore directory, accounts, profiles, user presence).
<!-- Loaded into every session: keep it short. Area rules load by themselves when a file in their area is opened (.claude/rules/: frontend, backend, media, browser, art). Everything else is looked up (end of this file). Shortened 2026-11-27 with nothing lost: each moved line kept its date and my words in its new place. -->

## Stack
- Next.js (App Router; this version has breaking changes, see AGENTS.md), TypeScript, Tailwind. Supabase backend (self-hosted) and Google sign-in. Lore pages are edited live by several people at once (Tiptap + Yjs). The character workbench is three.js (`@react-three/fiber`).
- Hosted on SERVER (my HP, Windows 11, 16 GB) since 2026-11-22 (`SPEC-self-hosting.md`): https://debaser.site through a Cloudflare tunnel, Supabase in Docker (`G:\DEBASER-HOST`), rebuilt from `main` on `github.com/SpookySweden/debaser.site` every 5 hours and at once when asked (`npm run deploy-status` asks; I double-click `C:\DEBASER-SETUP\RUN-ME-rebuild-site.cmd`; 2026-11-27). Down while SERVER is off (my choice). The Vercel project and the old Supabase cloud project are kept, unused, as the way back; `debaser-site.vercel.app` forwards to debaser.site.
- The database tools (`npm run db`, `db:*`, `web:fetch`) and `.env.local` (`https://api.debaser.site`) act on the live database on SERVER. `--cloud` reaches the OLD cloud project: write nothing there.
- Most features have BOTH a mock and a Supabase repository (`app/lib/*/mock-*`, `supabase-*`; the `NEXT_PUBLIC_*_DATA_SOURCE` switches pick one). Update both, or tell me why you didn't.

## Commands (what each does in full: `docs/commands.md`; names in package.json)
`npm run verify` (lint, tokens, typecheck, build: must pass) · `verify:clean` (the same on your commit in a clean copy, before a push) · `checks:changed` (the checks this work can affect: the one for every task; says `FULL RUN DUE`) · `checks` (whole suite; `--only <prefix>`) · `tokens` · `capture` then `audit` · `deploy-status` (the only way to wait for a deploy) · `read` (confirms a change is live; never a hand grep) · `shot` · `db -- "select ..."` · `web:fetch` (my standing OK, 2026-11-03, to get fresh data for your check) · `node scripts/ctx.cjs <topic>` (a one-page digest of a topic).

## Who I am and how to talk to me
- I don't write code. I judge results by looking at the site, so describe changes by what I'll see, in plain English. Explain any jargon in one line. I like comprehensive reports (2026-11-21: "i like the comprehensive reports so dont neuter them too much").
- If my idea is risky or will cause trouble later, say so before building it. Disagreeing with me is part of the job.
- Never say "should work" or "that fixes it" without evidence. If you couldn't check something, say so.
- This is a forever project: methods that may not last (unofficial APIs, scraping-style sources) are fine. Say the risk once, build it with a fallback where one exists, and propose better or newer methods when you know of them; I'll notice breakage and adapt. The firm lines still hold: no handling my passwords or keys, the asset rules, database changes only with my OK.
- Questions to me: always the multiple-choice box, the `interview` skill (2026-11-27). In a session the coordinator started, they go through the coordinator (my choice, 2026-11-27: "Everything via coordinator").

## How to work
- Before a multi-file change, or anything you're unsure about: stay read-only, explore, then give me a short plan in plain English and wait for my OK. If the change is one sentence long (a typo, a colour), just do it.
- For a big new feature, interview me first (the `interview` skill), write the answers to a `SPEC-<name>.md`, then stop so I can start a fresh session to build from it.
- State up front how you'll prove the work is done, then prove it with evidence.
- IMPORTANT: nothing is finished until `npm run verify` passes and the change is live and verified on the deployed site. The loop: verify -> checks:changed -> capture + audit (for visual changes) -> commit and push to `main` -> `npm run deploy-status` -> `npm run read` to confirm it's live -> update `docs/STATE.md` if a line of it changed -> tell me what you checked and what you couldn't.
- Test locally, not on the live site (2026-11-14: live browser drives filled the free database and slowed the site for everyone). Prove behaviour on a local dev server, with mock data sources where they exist. On the live site, confirm only that the change is there (`deploy-status`, `npm run read`). A live browser drive or live-database check is only for what can't be proved locally (real auth, real-time between accounts, policies), kept short, one session at a time, at least 10 minutes apart (live database checks with no browser: 2 minutes, 2026-11-17). No screenshots to me unless I have a visual choice to make.
- Desktop first (2026-11-14: "dont worry about coding phone specific stuff, the phone version of the site will be worked on separately all in one go once the desktop version is feature complete and smooth"): build and prove for the desktop; at phone width only don't break it (no sideways scroll at 390 wide, one look).
- Save usage (2026-11-21: "to stop using so much we need to limit the longer thinking things that are less necessary such as the rampant checks"): `checks:changed` once, after the work; the whole suite only when I ask or it says FULL RUN DUE; `verify` once before the commit; one `verify:clean` per push and none for changes that can't affect the build (docs, SQL reference files, Temp/ checks only); capture + audit once, for visual changes; no repeated self-measurement. Save on checks and runs, not on telling me.
- Heavy steps (builds, verify, tsc, checks, a dev server in use, any browser drive, shot or capture) run one at a time on SERVER through the shared turn (2026-11-27, `docs/sessions.md`). Close every dev server and test browser when done.
- Smallest change that does the job. No refactors, renames or "tidying" I didn't ask for.
- One task per session. If I jump to something unrelated, remind me to start fresh. If I've corrected you twice on the same thing, stop and suggest a clean restart with a better prompt instead of a third attempt.
- Commit small and often, after each verified step, so I can roll back. Keep the task list honest: tick each step as it ends (2026-11-17).

## Delegating to agents
The main session plans, decides and talks to me. The agents in `.claude/agents/` do contained jobs and report back. A report is evidence to check, not proof. `code-reviewer` after larger work (the diff against the plan, fresh context; only gaps that affect correctness or what I asked for, no style opinions); `test-runner` when a long log fails; `mechanic` (Haiku) for spelled-out bulk edits, then look them over; `ui-ux-auditor`, `seo-metadata-analyzer`, `api-performance-monitor`, `systems-researcher`: read-only reports. At most 10 agents a session (`.claude/hooks/agent-limit.cjs` refuses the 11th): then do the rest here or tell me to start fresh.

## Safety
- IMPORTANT: no database changes (inserts, updates, deletes, schema, migrations) without my explicit OK and a plain-English description of what will happen. Read-only diagnostic queries are fine. Reason: a wrong query on live data can't be undone.
- Writing to the live database: never put SQL on the `npm run db` command line, because Windows keeps only its first line. On 2026-11-06 that turned a filtered clean-up into `delete from auth.users` and every account went. `scripts/db.cjs` now refuses it: writes come from `--file`, `delete` and `update` need a `where`, deleting from `auth` or emptying a table needs `--destructive`. Run a delete's `where` as a `select` from the same file first, and read the count. Run `npm run db:backup` before any delete. The daily copy (Windows task `DebaserBackup`, 04:00, `I:\DEBASER\backups` on SERVER, 30 kept) holds addresses and password hashes, so it stays out of the repo.
- When a database change is OK'd: schema goes through migrations (`npm run db:new -- name`, `npm run db:push:dry`, then `npm run db:push`), written so it can be re-run (`if not exists`, policies dropped and recreated by name). Every table gets Row Level Security so people can only edit or delete their own things. Deletes are reviewed first: list exactly what would go, check the survivors, then remove (`supabase/cleanup/` is the pattern).
- Checks and tools never sign up new accounts: they sign in as the kept test accounts TEST ACCOUNT A-D, which are hidden from every list of people on the site (`profiles.is_hidden`, set only by a migration). If old throwaways ever turn up, `npm run db:sweep:review` lists them and `npm run db:sweep` removes them; the sweep is a delete, so ask me first. Test with the kept test accounts or throwaways only, never real user accounts.
- IMPORTANT: secrets (API keys, passwords, the Supabase access token) live in `.env.local` only. Never write them into code, logs, commits or this file. `.env.production` is committed, so it only holds `NEXT_PUBLIC_*` values.
- Tell me before deleting files or large blocks of code.
- Hooks (`.claude/settings.json`): the typecheck when a turn ends (`guard.cjs`, which sends a session back only for errors in files it touched itself), the agent cap, and the context hooks (`context.cjs`: a warning before a session is shrunk at 300k tokens, and its notes re-read after; 2026-11-27). The secrets rules above are on trust, not enforced: my choice (2026-11-04), so don't suggest bringing that hook back. Everything else runs without a click (bypass mode), so database writes and Vercel/Supabase connector changes wait for my typed OK in chat, per the rules above.

## Asset Rules (firm; the exceptions and limits, with my words: `.claude/rules/art.md`)
No AI-generated artwork of any kind: all artwork is hand-drawn by me. Code never draws a character, icon or illustration (no CSS or SVG art); repeating tile patterns, dithers and dotted lines are fine. When something needs artwork, point at a placeholder file through a slot (`SpriteSlot`, `app/lib/ui/art/`) and stop.

## Hard-won lessons
<!-- One line each, with the reason. Keep only things Claude would otherwise get wrong. -->
- Nothing is finished until it's live and verified. Uncommitted work isn't deployed, and "done" was said once while the live site still showed the old version.
- A missing grep isn't an absent feature: React wraps text in comments. Use `npm run read`.
- Prove a new check fails before trusting it: revert the fix, watch it catch the bug, then restore. Run checks through `npm run checks`, not directly, or they test stale compiled code.
- A screenshot or captured snapshot only proves something if it's newer than the code it's about.
- Server-rendered checks can't see `ssr: false` components (the character workbench). Use a real browser capture for those, with `--use-angle=swiftshader` or there's no WebGL.
- A check that tests a string next to the behaviour can pass while the behaviour is broken. Test what the code does.
- Write code with the Edit and Write tools, not Bash heredocs: this Git Bash mangles backslashes, backticks and JSX in them (ten sessions lost attempts to it). For a scripted edit, Write a script file and run that.

## Where to look (read on demand, not up front)
- `docs/STATE.md`: the one current picture (where it runs, what's live, half-done, waiting on me, known red checks). Read it at the start of a session.
- `node scripts/ctx.cjs <topic>`: the SPECs, rule lines, my quoted decisions and recent commits on a topic, in one page. `docs/INDEX.md`: every SPEC and doc. `docs/decisions.md`: my standing decisions.
- When I say "wrap up", or your context is getting full: the `handoff` skill (it replaced HANDOFF.md, 2026-11-27).
- `docs/sessions.md`: how sessions are run (coordinator, briefs, hand-overs, messages, the heavy-step turn); skills `brief`, `interview`, `handoff`.
- `docs/design.md` before any UI work; `docs/theming.md` for a colour, font or size (`/specimen` shows every token); `supabase/README.md`; `scripts/README.txt`; `assets/README.txt`.
- If you learn something non-obvious about one part of the site, put it in that area's docs/ file or rule file, not here.

## Compact instructions
When compacting, always keep: the list of changed files, the current plan, the verification commands, the path of your notes or hand-over file, and my open questions and answers word for word.
