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
    npm run checks                      every check, in both directories

Runs every `check-*.cjs` in `Temp/` **and** in `scripts/`, in name order, compiling each one first
from the `npx tsc ...` lines in its own header comment. The live checks are skipped by name (they need
Supabase credentials and sometimes two accounts).

**Both directories, and that is a fix rather than a convenience.** It globbed only `Temp/` until the
CDP instruments were moved into `scripts/` - and moving `check-deployed.cjs` with them silently
dropped it from the suite, because the file changed address and the loop did not. The run still said
"all passed"; it just said it about 59 checks instead of 60. A check that leaves a suite by being
tidied is the same fault as a check that has never failed, and harder to notice, so a check the
documentation names is now tracked in `scripts/` *and* still run here.

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

**This is the agent's eyes for the *bytes*.** It reads the HTML a visitor's browser gets and reports
whether the text the caller names is present or absent - and it is not the only instrument now: a
capture is readable too (`npm run shot` writes one, `npm run panes` counts the colours inside a box of
it, `npm run stages` does that per render stage, and the file-reading tool opens the file). What no
tool here does is judge an aesthetic or watch motion - one still frame is one state, not a hover, and
a capture is evidence only if it is newer than the code it is said to prove.

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

browser.cjs
-----------
    npm run browser                     what session is up, if any
    npm run browser -- --start          open the reusable browser (detached, profile kept)
    npm run browser -- --start --signin ... and sign one throwaway account into it
    npm run browser -- --open <address> attach, arrive, and print what the page says
    npm run browser -- --stop           close it, and remove its profile

**Every browser tool here goes through this one file, and it is `playwright-core`, not a hand-rolled CDP
client.** The hand-rolled one worked, and was replaced on purpose: typing, keys, drags and media emulation are
a lot of protocol to write by hand, and each of them was a question that had to be answered by reading source
instead of by pressing something. `playwright-core` is the *core* package - it has no bundled browser and no
download step, which matters here: a full `playwright` install wants ~130MB of Chromium, and that download is
exactly what had silently failed before. It drives the Chrome already on the machine, with the same
`--use-angle=swiftshader --enable-unsafe-swiftshader` args, so WebGL still exists in a headless build.

**`--start` is what makes a session cost one sign-in instead of one per capture.** The browser is detached and
its profile is kept, so the signed-in page state, the loaded chunks and the cookies survive between tools;
every tool with `--attach` joins it. An attached browser is *stateful* - a capture from it is not a first visit
- so the tools say when they are attached, and `--fresh` reloads before the steps when it needs to be.

**A page that did not answer is a refusal, not a page.** Chrome's own error page renders, has a body, and
answers `0` canvases, so a capture taken at a dead address reads as "the pane is empty" - which is how
`Temp/browse/account.png` came to be a picture of *"This site can't be reached"* under the name of a page that
worked. The arrival **throws `NoAnswer`** before any file is written, and it does so on two independent
signals: the `net::ERR_*` name Chrome refuses the navigation with, and the arrival probe read out of the page
afterwards. `--allow-error-page` is the deliberate opt-out.

**A control is found by tier, and each tier was earned by a wrong press**: exact text, the first line, a
*prefix* of the whole text, then a substring - where an ambiguous substring is now a *refusal* rather than a
coin toss (`--allow-ambiguous` accepts it on purpose). The prefix tier is what stops `MASS` from finding the
palette's help text instead of the stage button, and the `within` scope is the **innermost** container holding
the phrase, because the first match in document order is the outer `<main>` and scopes to nothing.

screenshot.cjs, look.cjs, measure-panes.cjs, measure-stages.cjs, check-deployed.cjs
------------------------------------------------------------------------------------
    npm run shot -- --url <address>     take a picture after named presses; read it back as colour counts
    npm run look -- --url <address>     read the drawing buffer in-frame, and the DOM
    npm run panes -- --png <file>       read a PNG that is on disk - or capture one - and count colours per pane
    npm run stages -- --signin          the same, per render stage, reached through the workbench's own plates
    npm run deployed                    load the deployed site; read response BODIES, never hashed names
    scripts/png-read.cjs                the PNG decoder

`npm run shot` is the one to reach for when a question is about what the page *is*: it can name a sequence of
controls by their text (or a selector), hover them, focus them, press them, **type into one, press keys, drag
one onto another and scroll**, capture past the first screen or into one element, and it prints what it
pressed - because a sequence that quietly skipped its second press would write a picture nobody asked for and
call it a success. `--attach` reuses the session; `--scale 0.5` is a cheap reading; `--wait-for` waits for a
chunk to appear instead of for a stopwatch.

Chrome is installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`; `--use-angle=swiftshader` is
load-bearing, since without the software GL a headless build has no WebGL and a blank canvas would say
nothing. **Read pixels inside a `requestAnimationFrame`**: a WebGL buffer is cleared on present, so a zero read
from outside a frame is a statement about the probe, not the renderer. **And count colours, not lit pixels** -
an opaque clear makes every pixel non-zero-alpha, so an alpha count reported the same `21112/21112` for the
wireframe, the flat figure and the lit composer, which is a probe that cannot tell two states apart.

What they prove is narrow and worth saying: pixels on the canvas means the renderer ran - never that
it drew a person, or that the person looks right. A screenshot lands in `Temp/browse/`, which is
where it belongs: the code is tracked, the machine-local output is not. `AGENTS.md` has the two faults
that were hiding behind these (a `frameloop="demand"` nothing invalidated, and an `EffectComposer`
that cleared its own frame), and both were found only because a headless Chrome could be driven.
