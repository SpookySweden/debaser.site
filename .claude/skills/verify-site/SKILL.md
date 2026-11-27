---
name: verify-site
description: Run the full proof that a change is done - verify, the checks it can affect, capture + audit locally, then confirm the pushed commit is live on debaser.site and read it with `npm run read`. Use when finishing a task, or when Luke types /verify-site. Optional argument - a route to read instead of /forum (e.g. `/users`), and/or text to expect, passed through to `npm run read`.
---

# /verify-site

The ship loop from `.claude/rules/core.md`, as one run. Report pass/fail for every step in plain English. Stop at the
first failure, show the failing output, and say which step it was - do not carry on to later steps and do not "fix and
retry" without telling Luke.

Updated 2026-11-27 (the site moved to SERVER on 2026-11-22): it used to wait for Vercel and screenshot the deployed site
at desktop and phone width. Luke's rules since 2026-11-14 replace that: prove it locally, confirm only presence on the
live site, desktop first, no screenshots to him unless he has a visual choice. Heavy steps (1-3) take the one turn on
SERVER (`docs/sessions.md`).

Accounts: there are no account details to read or pass. `--signin` signs in as the kept `TEST ACCOUNT A`
itself and the scripts load the Supabase address on their own. Never open or name `.env.local`.

Arguments: if Luke gave a route (e.g. `/users`), use `https://debaser.site<route>` as ADDRESS; otherwise ADDRESS is
`https://debaser.site/forum`. Any quoted text he gave is an expectation for step 5.

## Part 1 - this machine

1. `npm run verify` (lint + tokens + typecheck + build). Must exit 0.
2. `npm run checks:changed`: the checks this work can affect. Must end with every one passing. If it prints
   `FULL RUN DUE`, or the work was a big feature built from a SPEC, run the whole `npm run checks` instead. A
   failing check is a finding - report it, never delete or loosen it to go green.
3. For visual changes only: on a local dev server with mock data, `npm run shot` at desktop width (one look at 390
   wide that nothing scrolls sideways), then `npm run capture` and `npm run audit`. Capture always first, or the
   audit reads old snapshots. The audit does not fail by exit code: read its output and report every unnamed
   control, small tap target, small text and low-contrast pair it lists. Look at the shots yourself with Read; they
   are for you, not for Luke.

## Gate - is this change actually live?

4. Run `git status --porcelain` and `git log origin/main..HEAD --oneline` (after `git fetch origin main`).
   - Anything uncommitted or unpushed: **stop here.** Tell Luke Part 1's result and that the live site would show
     the old version. Do not commit or push on his behalf from this skill.
   - Otherwise `npm run deploy-status`: it asks SERVER to rebuild from `main` at once and waits until
     `https://debaser.site/api/version` reports this commit. Exit 0 live - continue; 1 SERVER's build failed (see
     `G:\DEBASER-HOST\logs\update.log`) - stop and report it; 2 not pushed; 3 could not ask (SERVER off?) - stop and
     say so, never keep waiting; 4 still building - run it again. Run it in the background if it may take long;
     never write a hand-made polling loop instead.

## Part 2 - the live site

5. `npm run read -- --url ADDRESS` (plus any expected text, or `--absent <text>`). Must report present / absent as
   expected and exit 0. Nothing more on the live site unless something can't be proved locally (core.md says how).

## Report

- A short table: step, pass/fail, one-line note.
- What was **not** checked: whether it looks right is Luke's call; one still frame cannot show motion or hover/tap
  reveals; pages other than the ones looked at; anything skipped and why.
- Housekeeping: none from the checks. They sign in as the kept, hidden test accounts (TEST ACCOUNT A-D) and
  make no account. If `npm run db:sweep:review` ever lists leftovers, removing them is a delete - run
  `npm run db:sweep` only after Luke says yes.
