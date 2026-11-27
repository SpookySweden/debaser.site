# How the Claude sessions get their instructions (for Luke, 2026-11-27)

## What every session reads
Before: every session read about 7,200 tokens of rules at the start of every turn, including MEDIA's long section in
sessions that never touch MEDIA, and every builder the coordinator started also read a 19,000-character rules file
from the notes folder, a third of it out of date (Vercel, the gaming PC, League). About 14,600 tokens before a builder
read its own brief.

Now there are three layers:
1. **Always (about 3,900 tokens):** who you are and how to talk to you, the firm lines (database OKs, secrets, art,
   deletes, test accounts), the house loop, and where to look. `.claude/rules/core.md`, with `CLAUDE.md` as a short
   signpost. Out-of-date facts fixed (SERVER, rebuild every 5 hours, backups on `I:`).
2. **Only when a session opens a file in that area:** pages and windows, server and database, MEDIA (books and the
   reader included), BROWSER, and artwork with every one of your exceptions. MEDIA and BROWSER moved there word for
   word, with your dates and quotes. The firm art line stays in the always layer too.
3. **Looked up when needed:**
   - `docs/STATE.md`: the one current picture of the site (where it runs, half-done, waiting on you, known red
     checks). It replaces HANDOFF.md, whose last version moved into `docs/handoff-archive.md`.
   - `docs/decisions.md`: your standing decisions, one line each, dated, in your words, saying where each rule lives.
   - `docs/INDEX.md`: a map of all 71 SPECs and every doc by area and size, made by a script so it never goes stale.
   - `node scripts/ctx.cjs <topic>`: the look-up tool you OK'd. A session asks for "rooms queue" and gets one page:
     the SPECs to read and which sections, your quoted words, the rule lines, the decisions and recent commits.
   A builder now starts on about 7,000-8,000 tokens instead of about 14,600.

## How sessions are run (`docs/sessions.md`)
- **The coordinator** plans, writes briefs, starts sessions, tracks them and asks you the questions. It doesn't build.
- **Builders** work in their own copy of the code (a worktree) and only edit the files their brief gives them.
- **Briefs** follow one template (the `brief` skill): goal, your exact words with the date, what's already decided,
  files owned, how it will be proved, and where the hand-over goes.
- **Notes** live in one folder per group, named the same way (`<task>-brief.md`, `<task>-handover.md`), each starting
  with a STATE line (working / waiting on Luke / done). Hand-overs have one shape (the `handoff` skill).
- **Messages** between sessions are short, in a fixed shape, and point at a notes file for anything long.
- **Heavy steps** (builds, checks, browser drives) still take turns on SERVER, one at a time.

## Your choices, now in place
- **Auto-shrink at 300k tokens:** every session on the site is summarised automatically when its conversation reaches
  300,000 tokens. At 250,000 it is told once to bring its notes up to date first, and right after the shrink it is
  told to re-read them. You'll see a "compacted" line in its chat. The first coordinator reached 750,000; every reply
  re-read all of that, so this is the biggest saving of all.
- **Questions all go through the coordinator,** always as multiple-choice boxes like the ones you answered: my
  recommendation first with one line of why, each option saying what you'll see, and a note of which SPEC or earlier
  decision it touches (the `interview` skill). Sessions check `docs/decisions.md` first, so nothing is asked twice.
  When the coordinator passes on your answer it quotes it exactly, with the date and the question. That quote is
  what counts as your OK for a database change.
- **The look-up tool** is built (above).

## Which machine does what (your choices, 2026-11-27)
- **SERVER runs every session**, whether you prompt from the laptop, the phone or SERVER itself. The laptop and phone
  are windows onto it: Remote Control, or the laptop app's SSH connection to SERVER over Tailscale. Nothing builds on
  the laptop: a session that finds itself anywhere else stops and says so.
- **The gaming PC is the heavy lane:** the clean builds and the full checks are shared evenly between SERVER and the PC,
  and go to the PC whenever SERVER is over 60% memory, unless the PC is off, asleep or in a League match. The site,
  database and live tests always stay on SERVER. It is live (2026-11-27): a clean build took 71 seconds on the PC
  against about 5 minutes on SERVER. If a match starts part-way, the job drops to the lowest priority so your game
  comes first. The full checks join it once you OK putting the test keys on the PC; until then they stay on SERVER.
- **Tailscale is the road between them**, except the heavy lane, which uses a direct SSH connection over the home
  network for now. Only SERVER has joined Tailscale so far: the laptop, phone and gaming PC each need it installed and
  signed in with the same account (in `docs/STATE.md`, "Waiting on Luke").
- **Cloud sessions only for reading work** (research, reviews, SPEC drafts), once you've set the cloud up for the repo.

## What you might notice
- Sessions shrink themselves and carry on, instead of growing for days.
- Question boxes come from the coordinator, never from a builder.
- `docs/STATE.md` is the place to read where everything stands.
