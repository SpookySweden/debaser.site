---
name: handoff
description: The one shape for a DEBASER_OS session's hand-over and status note, the coordinator's notes, and wrapping up. Use when Luke says "wrap up", when the context hook warns the conversation is near 300k tokens, when a task ends or pauses, or when keeping a *-handover.md or coordinator-notes.md current.
---

# Hand-overs and status

Where: the group's notes folder named in your brief (never another folder, never only in a message). One file per task:
`<task>-handover.md`. The coordinator's is `coordinator-notes.md`. What is true for the whole site goes in
`docs/STATE.md` instead (in the repo, with your commit).

## Shape (under one page; rewrite it, don't append a diary)

```
STATE: working | waiting on Luke | waiting on <session> | done

# <TASK>: where it stands (kept current by <session name>)
Brief: <file>. Spec: <SPEC file, section>. Worktree: <path>, branch <name>.

## Live
- <commit> <what Luke now sees, one line each>

## Half-done
- <what, which files, what is left to make it whole>

## Next
1. <in order>

## Waiting on Luke
- <question as asked, or not yet asked>; his answers so far quoted: LUKE, <date>: "<words>"

## Decisions taken and why
- <the default you took instead of asking, and why>

## Proof commands
- <the exact commands that prove this work, incl. the dev-server line and drives>

## Gotchas
- <what cost time and would again>

## Needs from <session>
- <a change you need in a file another session owns; told it by message on <date>>

## Not checked
- <what no proof covered, and why>

## Leftovers
- <test data your drives created, with ids: deleting them waits for Luke>
```

## When the context hook warns (near 300k tokens)
Bring this file up to date now, in full: after the automatic compaction you will be told to re-read it, and anything not
in it or in git is gone. Then carry on.

## When Luke says "wrap up"
Bring the hand-over up to date, update `docs/STATE.md` if a line of it changed (and commit it), and end with a report
whose first line is what is live.

## The coordinator's notes (`coordinator-notes.md`)
```
# DEBASER coordinator (restarted <date>; read docs/sessions.md)
## Running   <name · id · task · worktree · files owned · STATE>
## Waiting on Luke   <question · asked when · his answer quoted when it comes>
## Next   <in order>
## Log   <newest first, one line each, dated: what was started, decided, finished>
## HISTORY   <older than a week and no longer needed, or moved to docs/handoff-archive.md>
```
