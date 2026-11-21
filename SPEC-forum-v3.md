# SPEC: Forum v3, the rest of the vision (2026-11-17)

Follows `SPEC-forum-v2.md` (live, 33c09de). Luke, relayed by the coordinator: "Yes, go on" with the four next interviews
at its end. Interviewed in the FORUMUX session, 2026-11-17. Built in small steps, each its own commit, live and verified.
Nothing here is built yet.

## What exists today (read from the code, 2026-11-17)
- **Already posts to the board:** GO LIVE stream records, a doc or lore page the first time it goes public, public
  recommendations, book highlights (into the reader's thread for that book), beat box songs by their `[ SHARE ]` key.
- **Public, never reaches the board:** stream-art drawings on the art shelf (`room_canvas_snapshots`), characters shown
  on a profile (`profile_characters`), files on /files (`media_items`), music tracks on the shelf (`music_tracks`), letters
  made public (`letters.is_public`). ANIMATE exports never leave the browser.
- **The desk's data all exists:** reading places (`book_places`), notifications (`useNotifications`), presence
  (`usePresenceDirectory`), live rooms (`useLiveRooms`, `useLiveStreams`), closeness (`music_for_you`, behind VANITY),
  unread letters and recommendations (`useLettersOf`, `useUnreadRecommendations`).
- **Search:** about eight boxes, each for its own page (forum, MEDIA's outside search, /files, TAG STATION, the tag window,
  inside a book, picture searches, the letters person-finder). /users, /lore and /docs have none. Nothing searches the
  whole site.
- **Settings on the account:** modules, window layouts, aquarium, companion, reader settings, privacy columns. In one
  browser only: theme, cursor, background, the forum's tab/tags/sort/wire pause and read marks, MEDIA's filters and view,
  the player bar. Each per-person table follows one pattern (`user_modules`: a row per person, a jsonb column with a size
  check, owner-only Row Level Security).

## Luke's answers
**MADE THIS**
- M1A. Automatic: one quiet line per thing. Each person has a switch per kind in PRIVACY, on by default for things that
  are already public.
- M2B. Kinds: stream-art drawings, characters shown on a profile, files on /files, music tracks, and letters made public.
- M3A. On FEED as `[ MADE ]` rows, the picture or player shown when opened, with `HIDE MADE` in `[ FILTER ▾ ]`.
- M4A. One row per person per day that grows: `SWEDEN MADE 3 THINGS TODAY`, opening to each one.

**YOUR DESK**
- D1A+. A DESK window over the forum, from a `[ DESK ]` key on the top bar and the Start menu, and it opens by itself on
  the reader's first visit each day. Signed out: no desk.
- D2A. Five sections, each a few lines, each line a link to the thing; an empty section is not drawn:
  CONTINUE READING, REPLIES TO YOU, LIVE NOW (rooms and people online), FROM PEOPLE YOU TALK TO (their newest posts and
  MADE things, by the closeness VANITY already works out), WAITING FOR YOU (unread letters and recommendations).
- D3A. Fixed order; each section folds and stays folded in this browser. No database change.
- Reworked 2026-11-21 (Luke: "make it significantly more palatable and less intrusive, in the top right include an auto pop
  up toggle and have the desk be accessible near where notifications are accessible"): a 400-wide window as tall as its
  sections, set down just left of the side panel (never over it, never over + NEW POST) until the reader moves it; quiet
  section lines with a `N NEW` chip and a `[ − ]` fold key; `[ AUTO POP-UP: ON/OFF ]` in its title line (off: it never opens
  by itself), which follows the account (`deskAuto` in `user_settings`, no database change); its key is the side panel's
  shelf's last, straight above the COMMS line with the bell, and `[ ▭ DESK ]` in the bell's menu. The top bar's DESK key is
  gone (the Start menu entry stays, not drawn).

**ONE SEARCH BOX**
- S1B. The site's own things and the outside platforms' results in one list. Default taken: the site's groups first
  (POSTS & REPLIES, PEOPLE, DOCS & LORE, FILES & TRACKS, DRAWINGS, RECOMMENDATIONS, YOUR BOOKS), at once; the outside
  results (MEDIA's own search, `searchEverywhere`) arrive after as an OUTSIDE group, so a slow platform never holds the
  site's results back.
- S2A. A `[ ⌕ SEARCH ]` key on the top bar, and Ctrl+K, open a SEARCH window over the forum; each result opens its thing.
- S3A. Every existing search box stays as it is.
- S4A. TALKED ABOUT IN: a book, a doc or lore page, a song and a MEDIA item each get a line listing the forum threads
  about them (threads filed under them, and posts that link to them). A count of conversations, never likes or views.

**SETTINGS THAT FOLLOW THE ACCOUNT**
- F1B. Theme, cursor, background, the forum's tab, tags, sort and wire pause, MEDIA's filters and view, the player bar's
  settings, AND the forum's read marks (so NEW and the quiet rows match on both machines).
- F2A. Signed in, the account's choices win and every change saves to the account; signed out, the browser keeps its own.

## Database change (needs Luke's typed OK in the FORUMUX chat before it is applied)
One new table, re-runnable migration, on the `user_modules` pattern:
- `user_settings`: one row per person (`person` = their account), `settings` (their looks, filters and the MADE switches,
  capped small, ~8 KB) and `read_marks` (post id -> when last opened, the newest few hundred, capped ~64 KB).
- Row Level Security: a person can read, add and change only their own row; visitors and other people get nothing.
- In plain words: "a row per person holding their own settings and what they have read on the forum; nobody else can
  see or change it". Nothing existing is changed or deleted. Backup first, dry run, then apply.
- Read marks are saved in a batch (a few seconds after the last post opened, and when the tab is left), not one write
  per press, so the free database is not hammered.
- MADE posts and the search need no table: MADE rows are ordinary board posts (as stream records are), and search reads
  the existing tables with each reader's own access. If search ever needs an index to stay fast, that is a second
  database change, asked for separately.

## How each part works (defaults taken while writing; tell Luke if any change)
- **MADE rows** are board posts anchored `made:<person>:<day>`, filed by the maker's own tab the first time they make
  something that day with that kind's switch on. The row stores nothing else: what it lists is read live from the
  things themselves (as a stream record is drawn from its room), so it grows without edits and a thing deleted later
  drops out. Two tabs racing may file two rows for one day: the board shows one. Replies work like any post's.
  `HIDE MADE` is remembered with the other filters. A MADE row with replies stays, like any post.
- **The switches** sit in PRIVACY under `POST WHAT I MAKE TO THE BOARD`: DRAWINGS, CHARACTERS, FILES, TRACKS, PUBLIC
  LETTERS, each on by default. Turning one off stops new rows; it does not delete old ones.
- **DESK** is a window like MY MUSIC (`?desk=1` opens it, built and read in one place per the frontend rules). "Once a
  day" is this browser's memory of the last day it opened by itself; closing it is enough for the rest of the day.
- **SEARCH** asks a new server route that reads with the reader's own sign-in, so private docs, private rooms and
  owner-only things never come back to anyone who can't open them (the database rules decide, not the browser).
  Third-party text is shown as plain text. Visitors search public things.
- **Settings sync:** on sign-in the account's row is read and applied over the browser's; each change is written to the
  row (gathered for a second) and to the browser. An account with no row yet starts from the browser's choices, which
  are then saved, so nobody's first sign-in after this ships wipes their look.

## The plan, in steps (each: one commit, `npm run verify`, `checks:changed`, live, `npm run read`)
Part 1, no database change:
1. **DESK window** (D1-D3): the window, the five sections from the existing data, opening once a day, folds remembered.
2. **SEARCH window** (S1-S3): the top-bar key and Ctrl+K, the server route over posts, replies, people, docs and lore,
   files and tracks, drawings, recommendations and your books; the OUTSIDE group from MEDIA's search.
3. **TALKED ABOUT IN** (S4) on books, docs and lore, songs and MEDIA items.
Part 2, after Luke's typed OK for `user_settings`:
4. **The table**, migration and both repositories (mock and Supabase).
5. **Settings follow the account** (F1, F2): looks, the forum's place, sort and wire pause, MEDIA's filters and view,
   the player bar.
6. **Read marks follow the account** (F1B), batched.
7. **MADE posts** (M1-M4): switches in PRIVACY, filing on make for the five kinds, the growing row, `HIDE MADE`.

## How done is proven
- Local mock drives for each step (desk sections and links, once-a-day opening, folds; search groups, a private doc not
  found by another account in the mock, Ctrl+K; MADE: making a drawing files one row, a second thing the same day grows
  it, a switch off files nothing, HIDE MADE; settings: a change in one browser context appears in a second after sign-in),
  each seen failing on the old code first. Pure checks for the search grouping, the MADE row, settings merge rules.
- `npm run verify`, `checks:changed`, a full `npm run checks` once (SPEC work), capture + audit for the windows.
- One live database check after the migration (batched, through `heavy-step.cjs --live-check`): another account and a
  visitor cannot read or change someone's `user_settings` row; a private doc does not come back in another account's
  search. Then `deploy-status` and `npm run read` for each step.

## Out of scope
- Phone-specific layouts (desktop first). ANIMATE exports on the board (they would need uploading: ask first).
- Syncing anything beyond F1's list (beat box layouts, docs text size, room panel sizes stay per browser).
- A search index (only if search is slow, as its own database change).
