# Handoff (2026-11-15)
Older notes: `docs/handoff-archive.md`, newest first (the 2026-11-06 handoff is at its top). Search it when a past
decision matters; don't read it all.

## Done
- **Luke's big list (2026-11-14) is all live**, and every group session is archived: MEDIA (slimmer rows, LANGUAGE
  filter, keeps its state, ORDER key, Shorts removed only when YouTube confirms them), the frame (highlighter module
  look, one "open" look, UNDO/REDO on the top-left arrows and Ctrl+Z/Ctrl+Y, MEDIA panel picks undoable via
  `data-undo-picks`), YOUR YOUTUBE (seven ideas, dead-subscription surprises, feedback key, IMPORT YOUTUBE HISTORY),
  profile (newswire COMMENTS, character speech with blip voice, `[ + NEW LETTER ]` window), letters (slim, drag onto a
  person), player, companion throwing, and rooms (`SPEC-rooms-queues.md` phases 0-7 plus joining by link, then a
  tightening migration at `31dfc24`). Per-group records: `luke-list-status-*.md` in the shared notes folder
  (`AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_27370d78-4644-44af-a1d7-9888cfb5e583\`).
- **Rules removed (Luke, 2026-11-15, `3851ed2`):** no more rules against downloading, copying, caching, transcoding or
  self-hosting media, ahead of a move to a local server. Kept: privacy and security lines (no engagement counts shown,
  third-party text as plain text, browser code never imports the server's fetching code). Scraping web pages was
  softened the same day from never to a last resort with Luke's OK each time and a fallback.
- **Test locally** (core.md, 2026-11-14): live checks are `deploy-status` and `npm run read`; live drives only for what
  can't be proved locally, one at a time through the notes folder's `heavy-step.cjs`.

## Open, not website code
- **Blitz (League app) settings, not done:** turn off start-with-Windows and its automatic rune, item and spell imports.
  Only while League is not being played. Computer use couldn't find its settings; they live in its Electron storage.
- **League priority watcher, NOT running now:** `Documents\game-first\game-first.ps1` raises League's in-match process
  to High and drops node and headless browsers to Idle only during a match. Start it hidden:
  `powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "$HOME\Documents\game-first\game-first.ps1"`;
  stop it by ending the PowerShell whose id it writes to `game-first.pid` beside it.
- **Game minds** (`G:\gane project`): paused by Luke on branch `minds-test-fixes`; its session is still open.

## Waiting on Luke, or left on purpose
- TEST ACCOUNT A's own room `8853d917-…` with its link row and B's REMOVED row: kept on purpose (Luke, 2026-11-15).
- Rooms phase 8 (a quieter heartbeat) is optional and needs his OK. The owner can't see a link joiner's drawing.
- Not proved on the live site: a second person in step in a room, real YouTube/Vimeo in the queue, a real outside
  picture, real accounts' companions speaking, the speech voice's sound (tune it in its numbers once he listens).
- The board NEWSWIRE's reply rows open the post, not the reply (`app/lib/forum/news-feed.ts`). TEST ACCOUNT A's BOARD
  ACTIVITY shows nothing though it has 14 stream threads: not looked into.
- Undo marks (`data-undo-picks`) could go on PROFILE's COMMENTS `[ HOLD ]` and the `[ YOUR YOUTUBE ]` switch (it needs
  its own wrapper). Never on anything that saves (feedback lists, audio key, LINK/IMPORT keys).

## Known red checks (not from this work)
`check-structure` (`any` in shadow-books.ts), `check-hidden-accounts` (house account, Luke's choice), book editions and
book search, MEDIA's web-filters SOURCE line, web-live-merge and web-sort.
