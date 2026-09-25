# DEPLOYMENT STALLED — Vercel is serving 659d856

**Written 2026-09-25 by the agent, because two pushes went to `main` and the live site did not move.**

## What is true

| | |
| --- | --- |
| `origin/main` | `73e4e6e` (CHAR tab) — pushed and confirmed by `git push` output |
| Live `debaser-site.vercel.app` | still serving **`659d856`** (Phase 1, the workbench frame) |
| Served build dir | `/_next/static/immutable/` — unchanged across all three commits |
| `x-vercel-cache` | `HIT`, `age` up to ~670s |

So the site is live and healthy — it is simply **two commits behind**, and nothing the agent can do
from here changes that. `git push` succeeded; the build that follows it did not happen.

## How this was established (not assumed)

```
node Temp/probe-all-chunks.cjs "NO RENDERER YET" "upper-arm.left" "[ CHAR "
```

| needle | where it comes from | deployed |
| --- | --- | --- |
| `BLOB HUMANOID` | commit `659d856` (Phase 1) | **PRESENT** |
| `upper-arm.left` | commit `4b089dd` (Phase 2, the rig) | absent |
| `[ CHAR ` / `NO RENDERER YET` | commit `73e4e6e` (the CHAR tab) | absent |

Polled three times over ~3.5 minutes after the third push, and four times over ~5 minutes after the
second: the build directory never changed.

## Why this took a while to see, and the trap worth remembering

The first probe searched for **Phase 1's own strings**, found them, and exited `0` — a stale deploy
reading as success. A chunk *hash* coming back identical across two phases is not evidence either
way: it cannot distinguish "the deploy is stale" from "the chunk did not change".

Hence `Temp/probe-all-chunks.cjs`, which unions the chunk lists from a cache-busted page *and* the
stored one (they listed different filenames), then reports PRESENT/ABSENT per needle. Two needles,
one from each commit, is the shape that makes the answer unambiguous.

## What the agent could not do

- Authenticate to the Vercel API (`403`) — no token on this machine, so the deployment state, the
  build log and whether the project is even wired to `main` are all unread.
- Redeploy. There is no CLI linked in this repository (`no .vercel` directory).

## What to check

1. **Vercel → the project → Deployments.** Is there a build for `73e4e6e`, and did it fail?
   A failed build would explain all of it and would not touch the live site.
2. **Settings → Git.** Which branch and which repository is the production branch? If it is not
   `SpookySweden/debaser.site` @ `main`, that is the cause.
3. **Settings → Git → Ignored Build Step.** A command here that exits non-zero skips the build
   silently — which produces exactly this symptom.
4. **Deploy Hooks / the dashboard's "Redeploy"** on the newest commit, to confirm a manual build works.

## Do not

- Do not re-push the same commit expecting a different result; `git push` already succeeded and the
  problem is downstream of it.
- Do not "fix" this by building locally and committing `out/` or `.next/` — the deploy is Vercel's job
  and a committed build directory would be a worse problem than a slow one.

Delete this file once a deployment carrying `73e4e6e` is live.
