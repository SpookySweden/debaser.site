# SPEC: Hidden test accounts

Interviewed 2026-10-21. Build this in a fresh session. Read CLAUDE.md first (database rules especially).

## Why
15 test scripts sign up a brand-new account on every run. Those pile up on `/users` and need a sweep (a delete,
so it needs Luke's OK every time). Instead: a small, fixed set of test accounts that real people never see, and
every test uses them. No new accounts, no more sweeping.

## What Luke asked for (his answers)
- **Hidden from people lists only.** The test accounts never appear in the user directory (`/users`), "who's
  online" (presence), any name picker (comms new message / add to group, game challenge, tagging people) or
  search. Their posts, replies, messages and tracks are *not* hidden. Each test cleans up what it posts.
- **The set is four accounts:** TEST ACCOUNT A and B (they already exist: `test-a@` / `test-b@debaser.site`,
  `KEPT` in `scripts/browser.cjs`), plus new C and D on the same pattern and the same `DEBASER_TEST_PASSWORD`
  in `.env.test`. Never write the password anywhere else.
- **Every test reuses them.** No script signs up a new account any more. The "does sign-up work" probes go
  (real sign-up is Google, which they never covered).
- **One last sweep** once the new setup works: review list first, show Luke, remove only on his yes.

## Decided while writing (tell Luke; change if he disagrees)
- Hidden means hidden from **everyone's** lists, the test accounts included. That way a check signed in as A can
  prove the directory has no A-D, with no real account needed. Tests reach each other by id or address
  (`?challenge=<userId>`, a thread id), not by picking from a list. If a test truly has to pick a test account
  from a list, stop and ask Luke.
- A test account's own profile page still opens by direct link (nothing lists it, so nobody finds it).
- **Nobody can make themselves hidden from the site.** The marker can only be set by a migration (or the
  service role), never by a signed-in user editing their own profile. Otherwise anyone could vanish from the
  directory.

## Out of scope
- Hiding what test accounts post. Changing who can see accounts in any other way. The Google sign-in flow.

## Work, in order (each database step needs Luke's typed OK with a plain-English description first)
1. Explore read-only: every query that lists people (start at `app/lib/auth/supabase-auth.ts`,
   `app/lib/forum/supabase-repository.ts`, `app/lib/profile/supabase-profile-repository.ts`, presence,
   comms and games pickers). Then a short plan for Luke.
2. Migration: the hidden marker and the list filters, re-runnable, with Row Level Security so users can't set it.
   `npm run db:new`, `db:push:dry`, then `db:push`.
3. Create C and D through `scripts/browser.cjs`'s existing "made just now" path, then mark A-D hidden.
4. Mock repository gets the same marker and filters (with a hidden mock person), so both data sources agree.
5. Switch the 15 scripts to the kept accounts: `auth-live-probe`, `check-account-music`, `check-channel-binding`,
   `check-comms-two-accounts`, `check-games-live`, `check-music-library-live`, `check-notifications-schema`,
   `check-profile-layout`, `check-realtime-events`, `check-realtime-scope`, `check-site-account`,
   `diag-notifications-insert`, `diag-notifications-return`, `signup-mail-probe`, `two-account-probe`
   (all in `Temp/`), and the throwaway fallback in `scripts/browser.cjs`.
6. Update CLAUDE.md's "checks sign up throwaway accounts" lines and the verify-site skill's housekeeping step.
7. The last sweep (review, show Luke, remove on yes).

## How to prove it's done
- A new check, proven by a deliberate break: signed in as A, and logged out, the directory, presence and every
  picker contain none of A-D. And a signed-in A cannot mark itself un-hidden or hide another account.
- `npm run checks` leaves the number of accounts in the database unchanged (count before and after with a
  read-only `npm run db` query).
- The deployed `/users` shows no TEST ACCOUNT names (`npm run read -- --url .../users --absent "TEST ACCOUNT"`),
  screenshots at desktop and phone width.
