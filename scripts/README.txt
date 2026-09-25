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
    node Temp/qa-audit.cjs              reads what it wrote

Writes `Temp/qa/<route>.html` - the pre-JavaScript HTML of every route, which is also what a screen
reader and a crawler get. `Temp/qa-audit.cjs` reads those files and reports unnamed fields, controls
too small for a thumb, text too small to read, and colour pairs below the contrast floor.

It exists because those captures used to be made **by hand** and went two days stale, so the audit
reported on a build nobody was shipping. The route list is read out of `qa-audit.cjs` so the two
cannot disagree about what is being audited.

A capture is a snapshot: `Temp/qa/` must be newer than the components, or the audit's pass means
nothing. Re-capture after any change that alters what a component renders.

Read the output: it ends with the questions no script can answer, which is where a person comes in.
