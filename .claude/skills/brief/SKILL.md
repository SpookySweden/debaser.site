---
name: brief
description: The DEBASER_OS template for starting another Claude session (a builder, a reader, a fresh coordinator) - the brief's shape, worktree and file ownership, notes folder, proof and report. Use whenever about to call start_session, write a *-brief.md, or hand a task to another session.
---

# Writing a brief

Rules behind it: `docs/sessions.md`. A brief is the only context the new session has, so it carries Luke's words and
the decisions; it points at files instead of copying them.

## Before starting it
- Its own worktree (`use_worktree: true`) unless it only reads. Check no running session owns the files you will give
  it (`coordinator-notes.md`). Few heavy builders at once: SERVER has 16 GB.
- Write the brief to `<task>-brief.md` in the group's notes folder first, then start the session with a short prompt
  that names that file and repeats the goal, so nothing depends on the message alone.
- Record it in `coordinator-notes.md`: name, id, task, worktree, files owned, STATE.

## The template (`<task>-brief.md`)

```
STATE: working

# <TASK NAME> (<area>; <one line of what Luke will get>)

## Luke's words
<date>, <where: typed to the coordinator / in a box>: "<exact words>"
<later words that widened or narrowed it, each dated>

## What it means
<numbered list: what Luke will see when it is done, in plain English>

## Fixed (already decided; don't reopen)
<decisions with dates and where they live: SPEC section, docs/decisions.md line, earlier answers quoted>
<plan-and-wait or not: small items from his lists need none; SPEC FIRST items interview, write the SPEC, wait for OK>

## Files you own
<paths or folders; everything else is read-only for you. Shared files (app/globals.css, shared checks): your own
block and assertions only>

## Read first
docs/STATE.md, <area rule file>, <the SPEC sections and docs that matter>, `node scripts/ctx.cjs <topic>`

## Proof
<how it will be proved: which checks, which local drive on a mock server, what `npm run read` should find live; any
live step and why nothing local can prove it>

## Report
- Hand-over: `<task>-handover.md` in <notes folder path>, the `handoff` skill's shape, kept current as items land.
- Questions for Luke: to the coordinator (<id>), ready to ask (`interview` skill). Never the box yourself.
- End of every turn: first line = what is now live (commit); then what Luke will see, how it was proved, what wasn't.
- When done (Luke, 2026-11-27: "check to see when the work is done and archive yourselves"): archive yourself
  (`archive_session` "self") only when ALL hold: pushed and confirmed live, nothing uncommitted in your worktree;
  hand-over `STATE: done`; your final report SENT to the coordinator by message first; nothing waits on Luke or another
  session, and no side session of yours is working. Otherwise stay idle and list what is open
  (`docs/sessions.md`, "Archiving when done").

## Limits
No database writes, deletes, DNS, tunnels, keys or security settings without Luke's quoted OK. Don't edit
`G:\gane-conductor`; don't touch or extend the shadow-books feature unless this brief is about it (2026-11-14).
"Remove X but keep the code" means the code stays, unreferenced or switched off, with a one-line comment (2026-11-14).
```

## The `background` field of start_session
Two or three sentences: DEBASER_OS is Luke's comic companion site on SERVER; he doesn't write code and judges by
looking; read docs/sessions.md; the notes folder path; which sessions are working on what nearby.

## A fresh coordinator
Brief: "You are the DEBASER coordinator. Read docs/sessions.md, docs/STATE.md and <notes folder>\coordinator-notes.md,
then carry on from its NEXT list. You plan, brief, track and ask Luke; you don't build. Pin yourself so you are never
archived." No worktree.
