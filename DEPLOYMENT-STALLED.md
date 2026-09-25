# DEPLOYMENT: builds succeed, the production domain does not move

**Written 2026-09-25 by the agent. Supersedes an earlier note that named the wrong cause.**

## The short version

Every commit **built successfully**, and the address the site is read at still serves **`659d856`
(Phase 1)**. So this is not a failed build and not a missed push — the domain
`debaser-site.vercel.app` is not being updated by the builds, or is pinned to an old deployment.

| commit | Vercel status | GitHub deployment | on the domain? |
| --- | --- | --- | --- |
| `dd5cfd4` | success | Production, 19:07 | **no** |
| `73e4e6e` | success | Production, 19:03 | **no** |
| `4b089dd` | success | Production, 18:33 | **no** |
| `659d856` | success | Production, 07:29 | **yes — this is what is served** |

## How this was established

```
node Temp/which-commit.cjs https://debaser-site.vercel.app
node Temp/what-happened.cjs        # GitHub's record of Vercel's own statuses
node Temp/where-deployed.cjs       # the URL each deployment claims
```

`which-commit.cjs` searches every chunk a page references for one string from each commit:

| marker | from | on the domain |
| --- | --- | --- |
| `BLOB HUMANOID` | `659d856` | **PRESENT** |
| `upper-arm.left` | `4b089dd` | absent |
| `NO RENDERER YET` | `73e4e6e` | absent |

`what-happened.cjs` asks **GitHub**, which is where Vercel reports its builds:

```
combined : success
  success    Vercel  https://vercel.com/lukekeatinglk03-4424/debaser-site/AxdFGBdh2yPMjC3y5kHdbEVSgFpA

github deployments: 5
  Production  dd5cfd4  2026-09-25T19:07:08Z
  Production  73e4e6e  2026-09-25T19:03:05Z
  Production  4b089dd  2026-09-25T18:33:28Z
  Production  659d856  2026-09-25T07:29:50Z
```

That is what redirected the search: the builds are not missing, so an earlier guess (a failed or
skipped build) was wrong.

## Two traps that cost turns, both worth keeping

**1. A per-deployment URL is behind Vercel's SSO, and its status code does not say so.** The
addresses in `where-deployed.cjs` (`debaser-site-<hash>-….vercel.app`) return **HTTP 200** and
~340KB of HTML, so a check that reads only the status sees a healthy site. It is Vercel's login wall:
the response carries `x-matched-path: /login` and `zeit-theme` in its markup. Counting *chunks* was
the tell — 70 there against the real build's 12. Nothing in the deployment metadata says "protected".

**2. A successful build is not a moved domain.** Vercel writes `success` and an `environment_url` for
a deployment it has *built*, and neither implies the production alias points at it. The only evidence
that the domain updated is fetching the domain and finding a string from the new commit.

The rule, and the reason `which-commit.cjs` exists: **probe the address a visitor uses, with a marker
from the newest commit, and treat everything else as circumstantial.**

## What to check (dashboard-side; the agent cannot — the Vercel API returns 403 here)

1. **Settings → Domains.** Which deployment is `debaser-site.vercel.app` assigned to? If a specific
   deployment was pinned rather than "latest production", that is the cause.
2. **Deployments.** Are the newest listed as **Production** there, matching GitHub? If Vercel shows
   them as *Preview*, the production branch setting is wrong.
3. **Instant Rollback.** If a rollback was ever triggered, the domain stays on the rolled-back
   deployment until it is undone — and every later build reports success while the domain stays put.
4. If it is 3, **promote the newest deployment**, or use "Redeploy" on `dd5cfd4`.

## What not to do

- Do not re-push. `git push` succeeded, the builds succeeded, the commit is on `origin/main`.
- Do not commit a build directory (`.next/`, `out/`) to force the domain to change; that is a worse
  problem than a slow one.
- Do not trust a deployment URL's status code as evidence the site is served there.

Delete this file once `which-commit.cjs` reports `73e4e6e` or newer on `debaser-site.vercel.app`.
