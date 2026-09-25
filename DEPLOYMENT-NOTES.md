# Corrected: the deploy IS live — my probes were reading the wrong chunks

**Written 2026-09-25, replacing an earlier note that said the domain was stale. That note was wrong, and
the mistake is worth keeping because it cost several turns and nearly hid a real bug.**

## What was actually true

Every commit deployed. `debaser-site.vercel.app` serves the newest build. The earlier note concluded
otherwise because of how it looked for evidence.

## The mistake

`which-commit.cjs` searched only the chunks **referenced by the pre-JavaScript HTML of `/account` and
`/forum`**. The character panel lives inside `ProfileCustomiserWindow`, which mounts only behind a
signed-in press, so its chunk is *not linked from any route a stranger can fetch*. The probe therefore
found Phase 1's string (inlined by luck) and reported every later phase absent — a healthy deploy read
as stale, four times, each time with more confidence.

```
node Temp/probe-every-chunk.cjs https://debaser-site.vercel.app "NO RENDERER YET" "upper-arm.left"
```

This one seeds from four routes, then **expands**: it reads each chunk it finds and adds every chunk
*those* name, because Next splits per-route and lazily-loads the rest. With that, all four markers are
`PRESENT`.

| marker | from | the old probe | the new probe |
| --- | --- | --- | --- |
| `BLOB HUMANOID` | Phase 1 | present | present |
| `upper-arm.left` | Phase 2 | absent | **present** |
| `NO RENDERER YET` | Phase 3 | absent | **present** |

## Why it matters beyond this task

The wrong conclusion was expensive in a specific way: it said "nothing you build is reviewable", which
is a reason to stop looking for bugs in what had already shipped. A **selector bug was live** — opening
the CHAR tab threw *"Maximum update depth exceeded"* — and the owner found it, not the checks and not
the agent. Believing the deploy was stale made "the site is broken" and "the site is old" look like
the same sentence.

**The rule, which generalises:** a search for a string proves something only if the search covers
where the string can *be*. Searching a page's linked scripts answers "is this in the initial bundle",
which is a different question from "is this deployed". For anything lazily loaded, the search has to
follow the bundle graph, or it reports absence and means "not in the entry point".

## The two real traps, kept

**A per-deployment URL is behind Vercel's SSO, and its status code does not say so.** Those addresses
answer **HTTP 200** with ~340KB, so a check that reads only the status sees a healthy site; the
response carries `x-matched-path: /login` and `zeit-theme`. Counting chunks is the tell: 71 there
against the real build's 12.

**A successful build is not a moved domain** — still true, and still the reason to fetch the domain and
look for a string from the newest commit rather than trusting a status. But it cuts both ways: the
*only* reliable evidence is a well-aimed marker, and a badly-aimed marker is worse than none, because
it produces a confident answer.
