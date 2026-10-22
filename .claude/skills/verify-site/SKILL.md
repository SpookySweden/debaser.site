---
name: verify-site
description: Run the full proof that a change is done - verify, checks, capture + audit locally, then confirm the pushed commit is built on Vercel, screenshot the deployed site at desktop and phone width, and read it with `npm run read`. Use when finishing a task, or when Luke types /verify-site. Optional argument - a route to screenshot and read instead of /forum (e.g. `/users`), and/or text to expect, passed through to `npm run read`.
---

# /verify-site

The ship loop from `.claude/rules/core.md`, as one run. Report pass/fail for every step in plain English, with the
two screenshots. Stop at the first failure, show the failing output, and say which step it was - do not
carry on to later steps and do not "fix and retry" without telling Luke.

Accounts: there are no account details to read or pass. `--signin` signs in as the kept `TEST ACCOUNT A`
itself and the scripts load the Supabase address on their own. Never open or name `.env.local`.

Arguments: if Luke gave a route (e.g. `/users`), use `https://debaser-site.vercel.app<route>` as ADDRESS;
otherwise ADDRESS is `https://debaser-site.vercel.app/forum`. Any quoted text he gave is an expectation
for step 6.

## Part 1 - this machine

1. `npm run verify` (lint + typecheck + build). Must exit 0.
2. `npm run checks`. Must end with every check passing. A failing check is a finding - report it, never
   delete or loosen it to go green.
3. `npm run capture`, then `npm run audit`. Capture always first, or the audit reads old snapshots. The
   audit does not fail by exit code: read its output and report every unnamed control, small tap target,
   small text and low-contrast pair it lists, plus the questions it ends with.

## Gate - is this change actually live?

4. Run `git status --porcelain` and `git log origin/main..HEAD --oneline` (after `git fetch origin main`).
   - Anything uncommitted or unpushed: **stop here.** Tell Luke Part 1's result and that the deployed
     steps would show the old site. Do not commit or push on his behalf from this skill - pushing to
     `main` puts the change live, and that click is his last look.
   - Otherwise wait for Vercel to finish building this exact commit. Vercel reports to GitHub's public
     API, so poll (every ~20s, up to ~5 minutes) with:

     ```bash
     curl -s https://api.github.com/repos/SpookySweden/debaser.site/commits/$(git rev-parse HEAD)/status | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const v=(j.statuses||[]).find(x=>x.context==='Vercel');console.log(v?v.state:'no Vercel status yet')})"
     ```

     `success` - continue. `failure`/`error` - stop and report the build failed on Vercel.
     Still `pending` after ~5 minutes - stop and say so; do not screenshot a site that may be stale.

## Part 2 - the deployed site

5. Screenshots, one sign-in (the kept test account) shared by both:

   ```bash
   npm run browser -- --start --signin
   npm run shot -- --attach --fresh --url ADDRESS --width 1440 --height 1000 --out Temp/browse/verify-desktop.png
   npm run shot -- --attach --fresh --url ADDRESS --width 390 --height 844 --mobile --out Temp/browse/verify-phone.png
   npm run browser -- --stop
   ```

   A shot that reports `NOTHING IS LISTENING` or an `ERR_...` is a failure, not a picture. Open both PNGs
   with the Read tool and look at them: say what is on screen, and anything visibly broken (overlapping,
   cut off, empty panes, a `READING...` that never resolved). Then send both to Luke with SendUserFile.
6. `npm run read -- --url ADDRESS` (plus any expected text, or `--absent <text>`). Must report present /
   absent as expected and exit 0.

## Report

- A short table: step, pass/fail, one-line note.
- The two screenshots.
- What was **not** checked: whether it looks right is Luke's call; one still frame cannot show motion or
  hover/tap reveals; pages other than ADDRESS were not screenshotted; anything skipped and why.
- Housekeeping: none from the checks. They sign in as the kept, hidden test accounts (TEST ACCOUNT A-D) and
  make no account. If `npm run db:sweep:review` ever lists leftovers, removing them is a delete - run
  `npm run db:sweep` only after Luke says yes.
