SCRIPTS
=======

Tools the agent uses to *see* this site, kept in the repository rather than in `Temp/`.

Three of them are trivial to write and were, for most of this project's life, not written at all -
they were command lines retyped each time, which meant they were retyped wrongly. They live here
rather than in `Temp/` for a reason worth stating once: `Temp/` is gitignored, so a tool kept there
**does not exist on a fresh clone**, and a rule that says "use `Temp/verify-live.cjs`" is not a
guarantee when the file it names may be absent.

The distinction is deliberate:

    Temp/       scratch - check output, captures, one-off probes. Gitignored, and expected to be
                thrown away. Temp/qa/*.html and Temp/check-*.cjs live here.
    scripts/    tools that outlive a session, and that a rule points at by name.

run-checks.cjs
--------------
    npm run checks                      every scratch check that needs no network

Runs every `Temp/check-*.cjs`, in name order, compiling each one first from the `npx tsc ...` lines
in its own header comment. The live checks are skipped by name (they need Supabase credentials and
sometimes two accounts).

**The checks that run are not the quiet ones.** A live check is skipped here, but several of the rest
sign accounts up too - a policy cannot be asked anything without a session - and the client cannot
delete what it made, so the directory on `/users` fills up with `probe actor` and `diag <stamp>`.
`npm run db:sweep` is the command that clears it, and it goes **after** the last check run, never
before.

There used to be a second copy of this runner in `Temp/`, and this file used to invite people to run
it. It had drifted a thousand bytes behind the tracked one, which made it a runner that silently
skipped the tracked one's own fixes. It is deleted; there is one.

**The header is read to its closing `*/`, not to line 20.** It used to be `slice(0, 20)`, and that
broke a check whose header grew past twenty lines: its compiles never ran, so it was handed whatever
the *previous* check had left in a scratch output directory. It reported a pass against stale
compiled code, and when it failed it failed for a reason unrelated to the source - which made a
working check look flaky for three separate turns. A header may now be as long as it needs to be.

read-site.cjs
-------------
    npm run read                        the deployed site, default expectations
    npm run read:local                  a local `next start` on :3210
    npm run read -- "[ ♪ MUSIC ]"       expect this text to be present
    npm run read -- --absent "[ SHELF (" expect this text to be gone
    npm run read -- --url <address>     read any route

**This is the agent's eyes.** There is no browser here - no screenshots, no clicking, no layout, no
colour - so this script is what stands in for looking at the site, and it is the one that matters
most. It reads the HTML a visitor's browser gets and reports whether the text the caller names is
present or absent.

It strips React's text-node comments before matching, which is the whole reason it is a script: the
player's music key is served as `[ <!-- -->♪<!-- --> <!-- -->MUSIC<!-- --> ]`, so a plain grep for
`[ ♪ MUSIC ]` finds nothing and reports a change missing that is present. That misled twice here,
each time looking like a stale deploy rather than a wrong pattern.

What it proves: the bytes are right. What it does not prove: that the page reads well. A passing read
is *"the served HTML contains X"*, never *"it looks right"*.

capture-qa.cjs
--------------
    npm run capture                     build first, then this starts a server and captures 12 routes
    npm run audit                       reads what it wrote

Writes `Temp/qa/<route>.html` - the pre-JavaScript HTML of every route, which is also what a screen
reader and a crawler get. `qa-audit.cjs` reads those files and reports unnamed fields, controls
too small for a thumb, text too small to read, and colour pairs below the contrast floor.

It exists because those captures used to be made **by hand** and went two days stale, so the audit
reported on a build nobody was shipping. The route list is read out of `qa-audit.cjs` so the two
cannot disagree about what is being audited.

A capture is a snapshot: `Temp/qa/` must be newer than the components, or the audit's pass means
nothing. Re-capture after any change that alters what a component renders.

Read the output: it ends with the questions no script can answer, which is where a person comes in.

qa-audit.cjs
------------
    npm run audit                       reads Temp/qa/*.html and reports

**Tracked in `scripts/`, not `Temp/`.** `AGENTS.md` names this as step 3 of the ship loop, and
`capture-qa.cjs` reads `ROUTES` out of this file so the two cannot disagree about what is being
audited - so neither works from the gitignored folder. Its *input* is the snapshot in `Temp/qa/`;
what it holds is the route list and the rules.

db.cjs
------
    npm run db -- "select count(*) from public.profiles;"
    npm run db -- --file supabase/cleanup/verify-live-schema.sql
    npm run db -- --json "select ..."
    npm run db -- --write "..."         changes something - refused without the flag
    npm run db -- --dry-run "..."       print the command, and run nothing

SQL against the deployed project, through `supabase db query` - the same instrument the dashboard's
SQL editor is, with a personal access token read from `.env.local`. This is the only tool here that
can ask the *database* a question rather than asking what a visitor would see, and it is what the
standing SQL grant in `AGENTS.md` runs on. The write guard is deliberate: leave it alone.

db-cli.cjs, db-repair.cjs
-------------------------
    npm run db:list                     the migration history, remote against local
    npm run db:push:dry, db:push        `--include-all` is on both, and has to be (section numbers)
    npm run db:pull                     pull remote schema changes back
    npm run db:repair:list, :applied    adopt an existing schema into the migration history

Both supply `--linked --project-ref <ref>` themselves, reading the ref out of
`NEXT_PUBLIC_SUPABASE_URL`, because `supabase link` writes per-machine state that a fresh clone does
not have. Both run the CLI as `node node_modules/supabase/dist/supabase.js` rather than `npx`: Node
24 on Windows refuses to spawn the `.cmd` shim.

sweep-throwaways.cjs
--------------------
    npm run db:sweep:review             the list, and it changes nothing
    npm run db:sweep                    the same list, then the removal

Every check that talks to the project signs accounts up - a policy cannot be asked anything without
a session - and it cannot delete them, because that takes the service role the site never holds. They
end up in the directory on `/users`, which is where visitors meet them: 284 of the 293 accounts there
on 2026-09-29 were the suite's. This runs the reviewed pair in `supabase/cleanup/`, review first, so
the survivors are read rather than assumed. **Run it after the last check run, never before it.**

cdp-look.cjs, measure-panes.cjs, measure-stages.cjs, check-deployed.cjs (and their two libraries)
-------------------------------------------------------------------------------------------------
    npm run look -- --url <address>     drive Chrome over CDP; read the drawing buffer and the DOM
    npm run panes -- --png <file>       decode the screenshot's PNG by hand; count colours per pane
    npm run stages -- --url <address>   the same, per render stage, so two stages can be told apart
    npm run deployed                    load the deployed site; read response BODIES, never hashed names
    scripts/cdp-socket.cjs              the CDP socket all four require
    scripts/png-read.cjs                the PNG decoder, no dependency added for a diagnostic

Chrome is installed at `C:\Program Files\Google\Chrome\Application\chrome.exe` and needs no Puppeteer
and no download; `--use-angle=swiftshader` is load-bearing, since without the software GL a headless
build has no WebGL and a blank canvas would say nothing. **Read pixels inside a
`requestAnimationFrame`**: a WebGL buffer is cleared on present, so a zero read from outside a frame
is a statement about the probe, not the renderer.

What they prove is narrow and worth saying: pixels on the canvas means the renderer ran - never that
it drew a person, or that the person looks right. A screenshot lands in `Temp/browse/`, which is
where it belongs: the code is tracked, the machine-local output is not. `AGENTS.md` has the two faults
that were hiding behind these (a `frameloop="demand"` nothing invalidated, and an `EffectComposer`
that cleared its own frame), and both were found only because a headless Chrome could be driven.
