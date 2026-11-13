# SPEC: live documents with a file browser (Luke, 2026-11-13)

Build this in a fresh session, after reading CLAUDE.md, `.claude/rules/core.md`, `docs/design.md`, and the lore code it
grows from: `app/lib/lore/session.ts`, `app/lib/lore/supabase-lore-repository.ts`, `app/components/LoreEditor.tsx`,
`LoreDirectory.tsx`, `NewLorePageWindow.tsx`. It's big: build it in steps, one commit each.

## What Luke asked for
Google Docs-style documents that anyone can make, for projects or anything else, edited live by several people at once,
with a file browser. While someone edits, their profile picture shows next to where they are in the text, and you can see
their mouse moving.

## What exists already (checked 2026-11-13)
- **Lore pages are already live documents.** Tiptap 3.31 + Yjs 13.6, synced over a private Supabase Realtime broadcast
  channel `lore:<slug>` by the site's own provider (`session.ts`: sync-request, state, update, awareness, gone; a 10 s
  heartbeat). It uses Awareness and `CollaborationCaret`, so each person's typing spot already shows their name in their
  colour. Status reads LIVE / ALONE / SYNCING.
- Lore saves to `lore_pages.yjs_state` (base64 Yjs state) plus `body_text` (plain text for signed-out readers), 2.5 s
  after typing stops, on tab hide and on leaving.
- Lore rules: anyone reads, any signed-in account edits any page, only the creator or an admin deletes.
- Extensions: StarterKit (undo off), Collaboration, CollaborationCaret.
- `lore_pages` had **0 rows** on 2026-11-13.
- Folder pieces to reuse: `TreePicker.tsx` (the forum composer's folder dialog) and the FILES archive folders
  (`archive-tree.ts`, `NewArchiveFolderWindow`).

## Decisions (Luke, 2026-11-13)
1. **A new DOCS module** at `/docs`, tickable in MODULES like the others. The file browser is its front page.
2. **Folders: a home folder each, plus shared folders.** Everyone has MY DOCS. Anyone signed in can make shared folders
   (for example DEBASER). You only ever see what you're allowed to see.
3. **One system with lore.** Lore pages become documents in a LORE shared folder, gaining everything below. `/lore` and
   `/lore/<slug>` keep working and show the same documents. Lore's rules carry over: public to read, any account edits.
4. **The owner picks who can see and edit, per document:**
   - PRIVATE: only them.
   - SHARED WITH: named people, each as CAN EDIT or CAN READ.
   - ANYONE SIGNED IN: can edit.
   - PUBLIC: anyone can read, accounts can edit, as lore is.

   Only the owner changes this. A folder can carry a default for new documents made in it.
5. **Profile pictures at typing spots.** Each person's caret wears their profile picture (small, about 20px) and name, in
   their name colour, readable in every theme (dark name colours get a light strip; see the review).
6. **Mouse pointers, stepped.** Everyone's pointer shows over the document, sent about 8 times a second and only while the
   mouse moves. Pointers jump between positions with no smoothing, which matches the site's no-easing rule. Each pointer
   wears that person's picture and name. A pointer fades out (in steps) after 10 s still, and goes when they leave.
   Positions are sent relative to the document's text, not the screen, so two different window sizes still agree.
7. **What a document holds:**
   - headings, lists and checklists;
   - pictures, uploaded to Supabase storage (counted against the free plan's 1 GB, with a size cap and resize on upload);
   - margin comments: select words, leave a comment beside them, reply, resolve;
   - version history: a list of earlier versions, with view and restore.
8. **Forum:**
   - A document made PUBLIC or ANYONE SIGNED IN makes one post on the board linking to it, with its title and first
     lines.
   - Every document has a `[ COMMENT ]` key that opens its own forum thread (a new anchor kind, `doc`). This is separate
     from margin comments, which stay inside the document.

## Realtime cost (say it again at build time)
Supabase's free plan allows roughly 2 million realtime messages a month and 200 connections at once. Check today's
figures on Supabase's pricing page before building. At 8 pointer messages a second while moving, one person's pointer
sent to three others is up to about 32 messages a second. For a few friends that's fine; for a crowded document it isn't.
Build in a safety valve: above 6 people in one document, pointers drop to 2 a second. Keep pointers and carets in the
same broadcast channel the text already uses, with no new channel per document.

## Database changes (need Luke's typed OK, with a plain-English description, before each)
- Documents table (or `lore_pages` widened): owner, folder, title, access level, Yjs state, plain text, timestamps.
- Folders table: owner, name, parent, shared or home, default access.
- Document shares: document, person, can edit / can read.
- Margin comments: document, anchor (a Yjs relative position), author, body, resolved.
- Versions: document, Yjs snapshot, who, when. Keep, say, one an hour while edited plus every named one, and cap the
  count per document to protect the 500 MB database.
- A storage bucket for document pictures.
- Realtime rules (`realtime.messages`) so a private document's channel only reaches people it's shared with.
- RLS on all of it: people edit only what they're allowed to, and only owners delete or change access.
- Moving lore into documents is a migration of existing rows. There are none today, but write it to carry rows anyway.

## Out of scope
- Spreadsheets, slides, drawing canvases inside documents.
- Exporting to Word or Google Docs (could come later).
- Offline editing.

## How it's proven
- Two browsers signed in as TEST ACCOUNT A and B, editing one document. Each sees the other's picture at the typing spot
  and the other's pointer moving, at desktop and phone width.
- A PRIVATE document can't be opened, listed or listened to by B, checked through the database and the realtime channel,
  not only the screen.
- Restoring a version, a margin comment surviving edits around it, a picture upload.
- An existing lore page opening from both `/lore/<slug>` and DOCS → LORE.
- A count of realtime messages during a one-minute two-person drive, written in the commit, so the cost is known.
