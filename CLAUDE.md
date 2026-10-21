# DEBASER_OS

Companion website for my comic book "Debaser": a social simulation styled as an operating system (forum, comms, music, mini-games, lore directory, accounts, profiles, user presence).

## Stack
- Next.js (App Router), TypeScript, Tailwind. Hosted on Vercel (builds from `main` on `github.com/SpookySweden/debaser.site`), not GitHub Pages.
- Supabase backend and Google sign-in. Most features have BOTH a mock repository and a Supabase repository (`app/lib/*/mock-*` and `supabase-*`; the `NEXT_PUBLIC_*_DATA_SOURCE` switches pick one). Update both, or tell me why you didn't.
- Lore pages are edited live by several people at once (Tiptap + Yjs). The character workbench is three.js (`@react-three/fiber`).

## Commands
Exact script names live in package.json. If a name here is wrong, fix this section and tell me.
- `npm run verify`: lint + typecheck + build. Must pass before any task counts as done.
- `npm run dev`: local dev server.
- `npm run checks`: runs every scratch check in `Temp/check-*.cjs` (about 75, gitignored, so they only exist on this machine). It runs them all; there is no per-area filter. A failing check is a finding: update it on purpose when the rule really changed and say why, never delete it to go green.
- `npm run capture` then `npm run audit`: the accessibility audit (unnamed controls, tiny tap targets, small text, low contrast). Always capture first, or the audit reads old snapshots.
- `npm run read`: reads the deployed `/forum` and confirms a change is live (`-- --url <address>` for another page, `--absent <text>` to prove something is gone). Use it instead of a hand grep: React wraps text in `<!-- -->` comments, so a plain search for `[ ♪ MUSIC ]` finds nothing even when it's there.
- Screenshots: Chrome is installed and `playwright-core` drives it. `npm run shot -- --url <address> --out Temp/browse/x.png` takes one; `npm run panes` counts the colours in it; `npm run browser -- --start --signin` opens a reusable session signed in as the kept test account (`TEST ACCOUNT A`; `B` exists for two-person tests; password in the gitignored `.env.test`). The tracked tools are all in `scripts/` (see `scripts/README.txt`).
- `npm run db -- "select ..."`: SQL against the live database. Writes need `--write`, and the script prints the statement first; leave that guard alone.

## Who I am and how to talk to me
- I don't write code. I judge results by looking at the site, so describe changes by what I'll see, in plain English. Explain any jargon in one line.
- If my idea is risky or will cause trouble later, say so before building it. Disagreeing with me is part of the job.
- Never say "should work" or "that fixes it" without evidence (see below). If you couldn't check something, say so.

## How to work
- Before a multi-file change, or anything you're unsure about: stay read-only, explore, then give me a short plan in plain English and wait for my OK. If the change is one sentence long (a typo, a colour), just do it.
- For a big new feature, interview me first (edge cases, how it should feel, what's out of scope), write the answers to SPEC.md, then stop so I can start a fresh session to build from it.
- State up front how you'll prove the work is done, then prove it with evidence: check output, or screenshots at desktop and phone width for visual changes.
- IMPORTANT: nothing is finished until `npm run verify` passes and the change is live and verified on the deployed site. The loop: verify -> checks -> capture + audit (for visual changes) -> commit and push to `main` -> `npm run read` to confirm it's live -> tell me what you checked and what you couldn't.
- Smallest change that does the job. No refactors, renames or "tidying" I didn't ask for.
- One task per session. If I jump to something unrelated, remind me to start fresh. If I've corrected you twice on the same thing, stop and suggest a clean restart with a better prompt instead of a third attempt.
- After larger work, have a subagent review the diff against the plan in a fresh context. Report only gaps that affect correctness or what I asked for. No style opinions.
- Commit small and often, after each verified step, so I can roll back.

## Safety
- IMPORTANT: no database changes (inserts, updates, deletes, schema, migrations) without my explicit OK and a plain-English description of what will happen. Read-only diagnostic queries are fine. Reason: a wrong query on live data can't be undone.
- When a database change is OK'd: schema goes through migrations (`npm run db:new -- name`, `npm run db:push:dry`, then `npm run db:push`), written so it can be re-run (`if not exists`, policies dropped and recreated by name). Every table gets Row Level Security so people can only edit or delete their own things. Deletes are reviewed first: list exactly what would go, check the survivors, then remove (`supabase/cleanup/` is the pattern).
- Checks and tools never sign up new accounts: they sign in as the kept test accounts TEST ACCOUNT A-D, which are hidden from every list of people on the site (`profiles.is_hidden`, set only by a migration). If old throwaways ever turn up, `npm run db:sweep:review` lists them and `npm run db:sweep` removes them; the sweep is a delete, so ask me first.
- IMPORTANT: secrets (API keys, passwords, the Supabase access token) live in `.env.local` only. Never write them into code, logs, commits or this file. `.env.production` is committed, so it only holds `NEXT_PUBLIC_*` values.
- Test with the kept test accounts or throwaways only, never real user accounts.
- Tell me before deleting files or large blocks of code.
- Hooks enforce some of this (`.claude/settings.json`, logic in `.claude/hooks/guard.cjs`): `.env.local` can't be read or named in a command, secret-looking text can't be written, and the typecheck runs when a turn ends. Everything else runs without a click (bypass mode), so database writes and Vercel/Supabase connector changes wait for my typed OK in chat, per the rules above. A refusal from them is the rule working; don't route around it.

## Continuing across sessions
- At the start of a session, read HANDOFF.md if it exists.
- When I say "wrap up", or when the context is getting full, write HANDOFF.md: what's done, what's half-done, next steps, decisions made and why, gotchas. Under one page.
- When compacting, always preserve: the list of changed files, the current plan, and the verification commands.

## Where the details live
- Visual design, palette and feel: read `docs/design.md` before any UI work.
- The character workbench's live pixel render (passes, switches, three.js traps): `docs/character-render.md`. Its simple figures (touching, validity, sag, placing): `docs/character-figures.md`.
- Database setup and migration history: `supabase/README.md`. The tools in `scripts/`: `scripts/README.txt`. Artwork slots: `assets/README.txt`.
- If you learn something non-obvious about one part of the site, suggest putting it in a docs/ file instead of growing this one. Keep this file short.

## Asset Rules
These are firm, unlike most of the design notes.
- No AI-generated artwork of any kind. All artwork is hand-drawn by me on a Kamvas tablet and added by hand.
- Code never draws a character, icon or illustration (no CSS or SVG art). Repeating tile patterns, dithers and dotted lines are fine.
- When something needs artwork, point at a placeholder file through a slot (`SpriteSlot`, the registry in `app/lib/ui/art/`) and stop. Don't make a stand-in.

## How the site behaves
Guidelines that came from real bugs. Bend them if there's a good reason, but tell me.
- **The board (`/forum`) is the desktop.** The arcade and the music archive are windows drawn in `app/layout.tsx`, not pages; don't add `/games` or `/music` routes back. A window opens from an address (`/forum?arcade=1`, `?music=1`, `?invite=<id>`, `?challenge=<userId>&game=<gameId>`), built and read in one place per window (`app/lib/games/arcade-window.ts`, `app/lib/audio/music-window.ts`).
- **Windows don't re-render the page.** Each window's state lives in a small store (`app/lib/ui/window-slot.ts`) that only that window reads.
- **A window with unsaved work asks before it closes** (the customiser; see `app/lib/profile/unsaved-changes.ts`).
- **Starting something from the board takes two presses**: one to open, one to commit.
- **Reveals take their space in both states.** Anything that appears on hover, focus or tap must not move what you're pointing at or push other content around. Either position it absolutely, or reserve its box and swap only what's inside. Never turn a `hidden` element visible on hover inside a row. A keyboard reveal uses `:focus-visible`, never `:focus-within`, because a mouse click leaves focus behind and the panel stays stuck open.
- **Colours come from the theme.** The palette tokens live in `app/globals.css` and are applied through `app/lib/ui/controls.ts` and `app/lib/ui/themes.ts`; components don't write their own hex values. Text must stay readable (4.5:1 contrast) in every theme. Motion stops under `prefers-reduced-motion`.
- **A profile shows a person, not a console**: no ids, counts or settings read back at visitors.

## Hard-won lessons
<!-- One line each, with the reason. Keep only things Claude would otherwise get wrong. The long history is in git (AGENTS.md, removed 2026-10-11). -->
- Nothing is finished until it's live and verified. Uncommitted work isn't deployed, and "done" was said once while the live site still showed the old version.
- A missing grep isn't an absent feature: React wraps text in comments. Use `npm run read`.
- Prove a new check fails before trusting it: revert the fix, watch it catch the bug, then restore. Run checks through `npm run checks`, not directly, or they test stale compiled code.
- A screenshot or captured snapshot only proves something if it's newer than the code it's about.
- Server-rendered checks can't see `ssr: false` components (the character workbench). Use a real browser capture for those, with `--use-angle=swiftshader` or there's no WebGL.
- A check that tests a string next to the behaviour can pass while the behaviour is broken. Test what the code does.
- On this Windows machine, Node can't spawn `npx.cmd`; the db scripts call `node node_modules/supabase/dist/supabase.js` directly.
- Migration timestamps are section numbers, so `db push` needs `--include-all` (already in the npm scripts).
