# DEPLOYMENT: every build succeeds, the domain never moves

**Written 2026-09-25 by the agent.** Four commits are on `origin/main`, all four report a successful
production build, and `debaser-site.vercel.app` still serves **`659d856`** (Phase 1).

## The evidence

```
node Temp/which-commit.cjs https://debaser-site.vercel.app   # what the domain serves
node Temp/where-deployed.cjs                                 # what each commit built
```

| commit | built | on the domain? |
| --- | --- | --- |
| `ca90dd7` (phase 3, drags) | success, 19:52 | **no** |
| `04160fd` (deploy note) | success, 19:32 | **no** |
| `73e4e6e` (CHAR tab) | success, 19:03 | **no** |
| `4b089dd` (phase 2, rig) | success, 18:33 | **no** |
| `659d856` (phase 1) | success, 07:29 | **yes** |

`which-commit.cjs` searches every chunk the served page references for one string from each commit —
`BLOB HUMANOID` (phase 1) is present, `upper-arm.left` (phase 2) and `NO RENDERER YET` (phase 3) are
absent. Two needles, one from each commit, is what makes that unambiguous.

**The code is not at fault.** A local `next start` build of `ca90dd7` contains all of it —
`NO RENDERER YET`, `upper-arm.left` and `setPointerCapture` are all present in `.next/static`. So the
problem is entirely between "Vercel built it" and "the domain serves it".

## What the agent cannot do, and why

- **The Vercel API returns `403`** - no token on this machine. The dashboard state, the build log and
  the domain assignment are all unread from here.
- **Every per-deployment URL is behind Vercel's SSO.** They answer **HTTP 200** with ~340KB, so a check
  that only reads the status sees a healthy site; but the response carries `x-matched-path: /login` and
  `zeit-theme` in its markup. It is the login wall, not the app. Counting chunks is the tell: 71 there
  against the real build's 12. **Nothing in the deployment metadata says "protected".**

## What to check (dashboard-side)

1. **Settings → Domains.** Which deployment is `debaser-site.vercel.app` assigned to? If a *specific*
   deployment was pinned rather than "latest production", that is the cause.
2. **Deployments.** Are the newest listed as **Production**? GitHub says they are; if Vercel's dashboard
   disagrees, the production branch setting is wrong.
3. **Instant Rollback.** If one was ever triggered, the domain stays on the rolled-back deployment until
   it is undone — and every later build reports success while the domain stays put. **This is the
   likeliest explanation** given that `659d856` is the commit from *before* the character work and every
   later one is ignored.
4. If it is 3: **undo the rollback**, or "Redeploy" / **Promote to Production** on `ca90dd7`.

## Two traps worth keeping

**A successful build is not a moved domain.** `success` and an `environment_url` mean *built*, not
*aliased*. The only evidence the domain updated is fetching the domain and finding a string from the new
commit — which is what `which-commit.cjs` does, and why it exists.

**A deployment URL's status code is not evidence the site is served there.** 200 with 340KB was the
login wall.

## What not to do

- Do not re-push. `git push` succeeded four times; the problem is downstream of it.
- Do not commit `.next/` or `out/` to force the domain to change. A committed build directory is a worse
  problem than a slow one.
- Do not trust a deployment URL's status code.

Delete this file once `which-commit.cjs` reports `ca90dd7` or newer on `debaser-site.vercel.app`.
