# SPEC: COMIC, the comic reader, lore links and the ARG (2026-11-20)

Luke's picks from list 5 ("do these ones"):
- "A comic reader: your pages in the site's style, with chapters, a release schedule, and 'new page' alerts for
  followers. Readers could leave comments pinned to a panel."
- "Lore that ties in, with characters' pages linked from the panels they appear in."
- "An ARG layer: hidden files, passwords in panels, things that unlock on the site."

Interview answers, 2026-11-20, round 1: `1a 2a 3c 4a 5b 6b 7c 8b 9a 10a 11a 12a 13a 14a`;
round 2: `15a 16a 17a 18a 19a 20abcdef 21a 22a 23a 24a`. The answer behind each rule is given as (Q#).

Two phases. **Phase 1** is the reader, the studio, panels, panel comments, following and lore links. **Phase 2** is
the ARG, built after phase 1 is live (Q18), because its clues hide in released pages.

Nothing here is built until Luke OKs this SPEC. Every database change below still needs his typed OK in the
building session's chat, with a plain-English description, a dry run and `npm run db:backup` first.

---

## What exists today (mapped 2026-11-20)
- **Lore pages** are DOCS documents in the LORE folder (`docs` table, Tiptap + Yjs). They live at `/lore/<slug>`, any
  signed-in account can edit them, and there is no page type, so no "character" kind (`app/lib/docs/`).
- **FILES** (`/files`, `app/lib/media/`): any account can upload. The `images` bucket caps pictures at 2 MB, and the
  site makes no thumbnails of its own.
- **Notifications**: one table, `forum_notifications` (kinds tag, reply, invite, recommend), shown by the bell in the
  side panel and on DESK. Nothing on the site has a "follow".
- **Comments**: each object gets one forum thread (`anchor_kind` + `anchor_id`, one thread per object, opened with
  `CommentPopout`). Nothing pins a comment to part of a picture.
- **The reader at `/read`** (foliate-js) has a COMIC layout for EPUB comics. It is built for books; COMIC gets its
  own scroll reader (below) rather than bending foliate.
- **Admin**: `public.is_admin()` in the database, and `isSiteAccount()` / `useAdmin()` in the browser (the house
  account). Row Level Security is the real lock.
- **Room passwords**, the pattern phase 2 copies: stored as `crypt` hashes in a table nobody can read, checked by a
  definer function, 5 wrong tries then a 10-minute wait (`20261105145655_private_streams.sql`).
- **Timers**: pg_cron runs on the PC's database (SPEC-self-hosting.md, "Schedules"). Phase 1 needs no timer, because
  release is by hand (Q7).

---

## Phase 1: the reader

### Where it lives (Q1, Q15)
- A new module, **COMIC**, at `/comic`, on the top bar for first visits (`startsOn: true` in `app/lib/ui/modules.ts`,
  next to FORUM, MEDIA and STREAM). Its default hover colour is picked from the existing module colours at build time.
- Luke's studio is at `/comic/studio`. It is not on the bar: he reaches it from a `[ STUDIO ]` key that only he sees
  on `/comic`.
- FIRSTVISIT's guided tour may want a COMIC stop. The coordinator passes that on; this SPEC doesn't touch the tour.

### Structure (Q6, Q16)
- **VOLUME > CHAPTER > PAGE.** Volumes are numbered and titled. Chapters are numbered straight through the whole
  comic (volume 2 starts at whatever chapter comes next, not chapter 1), and each has a title and a cover, which is
  one of its own pages. Pages are numbered inside their chapter.
- Addresses: `/comic` is the contents. `/comic/<chapter>` is a chapter. `/comic/<chapter>/<page>` is the same
  chapter, opened scrolled to that page; it is the address the "new page" alerts and comments link to.

### Who reads (Q9)
- Everyone reads released pages, signed in or not. Commenting and following need an account (one
  `[ LOG IN ] TO COMMENT` line, per design.md's "Say it once").
- Unreleased pages, chapters and volumes are seen only by Luke: in the studio, and in a preview of the reader marked
  `PREVIEW: NOT RELEASED` (a Rose chip).
- This is enforced in the database and on the file server, not by the browser. A visitor who guesses an address gets
  nothing back.

### Reading (Q4, Q5)
- **Scroll only.** A chapter is one column of pages, top to bottom, as wide as the window allows, up to a reading
  width. It is not paged, and has no two-page view. `[ FILL WINDOW ]` works as on any other page.
- **Spreads** (Q4): a page marked SPREAD in the studio shows at the column's full width, so it reads wide.
- Between pages: no gap, or a thin dotted rule (`rule-pixel`), picked when the look is built.
- **End of a chapter**: `[ NEXT CHAPTER ]`. If there is no next chapter yet, the line `THAT'S ALL FOR NOW.` and the
  `[ FOLLOW ]` key.
- **The contents page** (`/comic`): volumes as title lines (`——— VOLUME 1: <TITLE> ———`), and under each, the
  chapters with their covers and titles. A `[ CONTINUE: CH 3 P 12 ]` key brings a returning reader back to where they
  stopped. Their place is kept in the browser, and in `user_settings` for signed-in readers, so it follows the
  account.
- **Zoom** (Q17): every page has a `[ ZOOM ]` key that opens it alone at the sharper zoom copy, panned by dragging
  and closed with Esc or `[ CLOSE ]`. Readers never receive Luke's original.
- Words: titles and labels in capitals. No page counts, read counts or "new" badges, beyond the alert itself.
- Accessibility: each page can carry an optional **WORDS ON THIS PAGE** text, typed by Luke, for screen readers.
  It is never required. **Warning for phase 2:** anything typed there can be read in the page source, so it must
  never hold an ARG answer.
- Desktop first. At phone width: no sideways scroll, and pages shrink to fit. Nothing phone-specific is built.

### Page files (Q3, Q17)
Luke's pages are over 30 MB as exported.

Each page is kept as **three files**:

| File | Size | Who gets it |
|---|---|---|
| ORIGINAL | Luke's file as uploaded | Luke only |
| ZOOM | about 4000 px on the long side | readers, after release |
| READING | about 2000 px wide | readers, after release |

- The copies are made **on the server (the PC)** with `sharp`, a new dependency and the standard image library.
  They are not made in the browser, whose canvas limits a huge PNG can hit. They are written as high-quality JPEG
  or WebP, chosen at build time by comparing the two on one of Luke's pages.
- **Uploading big files**: Cloudflare's tunnel refuses any single request over 100 MB, so the studio sends files in
  pieces with Supabase Storage's resumable (TUS) upload. A page of any size goes through, and an interrupted upload
  carries on from where it stopped.
- **Storage**: a new **private** bucket, `comic`, laid out as `original/`, `zoom/` and `reading/`. Its size cap
  comes from Luke's largest real page plus headroom (at least 200 MB). The PC has the space (`I:\DEBASER\files`,
  3.5 TB), and the nightly backup already copies storage.
- **Serving**: readers never get a storage address. They get `/api/comic/page/<pageId>/<reading|zoom>?v=<version>`,
  which streams the file only if the page is released (or if Luke is asking), and otherwise answers 404.
  - A released file never changes. A replaced page gets a new version, so the route answers with
    `Cache-Control: public, max-age=31536000, immutable`, and Cloudflare carries most of the load, not the PC.
  - The ORIGINAL is served to Luke only.

### The studio (Q2, Q7, Q8), Luke only
- Gated on the page by `useAdmin()`, and by `is_admin()` in every database policy, function and route.
- **CONTENTS**: add, rename and reorder volumes and chapters, and set a chapter's cover from its pages.
- **PAGES**: drop files onto a chapter. They upload with a progress line for each page, and the copies are made as
  each one lands. Drag to reorder. Mark a page SPREAD. Type WORDS ON THIS PAGE. Replace a page's file. Delete a page:
  an unreleased page goes with two presses; a released page needs a typed `DELETE` first.
- **PANELS** (see below).
- **LORE**: tag panels with lore pages; mark lore pages as CHARACTER (see below).
- **RELEASE** (Q7, Q8): the queue holds every unreleased page, in reading order. Luke ticks the pages to send out,
  usually the next few in order, and presses `[ RELEASE ]` then `[ YES, RELEASE <N> PAGES ]`, so it takes two presses
  (frontend.md).
  - That one action releases them all, now, as **one batch**, and sends one "new page" alert.
  - There is no schedule and no upcoming date shown to readers (Q7: release by hand). The pages he has already
    finished go into this queue and come out by hand like any others (Q8).
  - A chapter or volume shows to readers once its first page is released.
- **Undo a release**: none. Alerts have already gone out, and a release is "sent", like a post. A released page can
  still be replaced or deleted (above).

### Panels (Q10)
- A panel is a box on a page, stored as fractions of the page (`x, y, w, h` from 0 to 1), so it fits every copy.
- **Guessed, then fixed by hand.** When a page is uploaded, the server looks for its gutters on the READING copy:
  rows and columns that are all one background colour, split again and again (an "XY-cut"). That gives a first set of
  boxes.
- In PANELS, Luke drags a box's edges to fix it, draws a new box, deletes one, and sets the reading order. The code
  only reads the art to find the gutters; it never draws on it. Boxes show only in the studio and in the reader's
  `[ COMMENTS ]` view. They are outlines in the accent ink, the site's own furniture, not art.
- A page with no panels (a splash page) is fine. It can be one whole-page panel or none.

### Panel comments (Q11)
- Hidden by default, so the art stays clean.
- A `[ COMMENTS ]` switch on the reader's bar (`aria-pressed`, kept in the browser) lights every panel that has
  comments or lore tags with a thin outline. Every panel can then be clicked.
- **Clicking a panel** opens a pane beside the column, `——— CH 3 · P 12 · PANEL 2 ———`, holding:
  1. **WHO**: the lore links for that panel (below).
  2. **The panel's comment thread.**
- **Each panel's comments are an ordinary forum thread.** It has a new anchor kind, `comic`, with
  `anchor_id = <panelId>` (one thread per panel, as the existing unique index already gives). The thread is started
  by the house account on the first comment, as DOCS threads are, so it brings the rest of the site with it:
  - replies, and reply alerts through the existing `reply` kind;
  - DESK's REPLIES TO YOU;
  - site SEARCH;
  - Luke's existing hide and delete;
  - MODERATION's report and block, once that ships.
- The thread's title reads `COMIC · CH 3 · P 12 · PANEL 2`, with a link back to `/comic/3/12?panel=<id>`. Opening
  that address scrolls to the page with the panel's pane open.
- A thread on the board shows a small crop of its panel (a CSS crop of the READING copy, no new file) as its
  preview.

### Following and "new page" alerts (Q12), agreed with NOTIFY (`local_825a751c-…`, SPEC-notifications.md)
- A `[ FOLLOW ]` key on `/comic` and at the end of each chapter. It reads `[ FOLLOWING ]` when on. It **is** NOTIFY's
  COMIC NEW PAGES switch (in `user_settings`), so there is no separate follows table. Signed out, it is the
  `[ LOG IN ] TO FOLLOW` line.
- A release is one batch and one alert, `3 NEW PAGES IN CHAPTER 2` (or `NEW PAGE IN CHAPTER 2`), linking to the first
  new page (`/comic/<chapter>/<page>`). It reaches followers on the bell, and in the weekly email for those who
  switched email on (NOTIFY's part).
- **The mechanism**, owned by NOTIFY, called by COMIC:
  - NOTIFY adds the kind `comic` and an `href` column to `forum_notifications`, and a definer function
    `public.notify_comic_page(p_ref, p_title, p_body, p_href)`. Browsers can't call it.
  - COMIC's `comic_release(page_ids uuid[])`, a definer function checked with `is_admin()`, marks the pages
    released, writes one `comic_releases` row, and calls `notify_comic_page('comic:release:<release id>', …)` once.
  - The function is idempotent on that ref, so a batch can never alert twice.
- **If NOTIFY hasn't shipped when COMIC's release step is built**: `comic_release` checks that `notify_comic_page`
  exists and skips the alert if it doesn't. The release still works, and alerts start once NOTIFY lands.
- Replies to a panel comment arrive through the forum's existing `reply` alerts. NOTIFY may later give them their own
  kind (`comic_reply` with an `href`); nothing in COMIC depends on that.

### Lore links (Q13, Q14)
- **Tagging, Luke only** (Q13): in the studio's LORE tab, he picks a panel and adds lore pages to it, searching lore
  by title. He tags the characters and places that appear in it. Other people can't tag.
- **WHO** in the panel pane: the tagged pages as links to `/lore/<slug>`, characters first.
- **APPEARS IN** on a lore page: a list under its body, `CH 1 P 4 · CH 3 P 12 …`, each a link to the panel. It is
  built from the tags on **released** pages only, so it never spoils an unreleased page. It shows only when there
  is at least one.
- **CHARACTER pages** (Q14): Luke marks a lore page as a CHARACTER in the studio. The page then shows, at the top, the
  panel where that character first appears (the earliest released panel tagged with them), as a crop of his own page:
  a CSS crop of the READING copy, so no new art and no new file.
  - It updates by itself as pages are released.
  - When the character hasn't appeared in a released page yet, nothing shows.
- Lore pages stay editable by everyone, as today. Only the CHARACTER mark and the tags are Luke's.

### Database (phase 1). Needs Luke's typed OK at build time; RLS on every table.
- `comic_volumes`: id, number, title, created_at.
- `comic_chapters`: id, volume_id, number (unique across the comic), title, cover_page_id, created_at.
- `comic_pages`:
  - id, chapter_id, position, is_spread;
  - width and height (of the original);
  - version, and the three storage paths;
  - words (optional text);
  - release_id (null until released), released_at;
  - created_at.
- `comic_releases`: id, released_at, page_count, first_page_id.
- `comic_panels`: id, page_id, position, x, y, w, h (numbers from 0 to 1), guessed (true until Luke touches it).
- `comic_panel_tags`: panel_id, doc_id (a LORE document), primary key on both.
- `comic_characters`: doc_id (primary key, a LORE document), created_at.
- **Policies**:
  - Everyone, visitors included, may read a page, its panels and its tags only once the page is released. A volume
    or chapter becomes readable once it holds a released page.
  - Only `is_admin()` reads unreleased rows, and only `is_admin()` writes anything.
  - Release happens only through `comic_release`.
- **Storage**: the private `comic` bucket, with storage policies of `is_admin()` only. Readers are served by the
  route above, which checks release with the server key.
- **Forum**: `comic` added to the anchor kinds, in `app/lib/forum/types.ts` and in any database check that lists
  anchor kinds.
- **Reading place**: one key in `user_settings`; no new table.
- **Both repositories** (core.md): a mock comic repository (`app/lib/comic/mock-*`) and a Supabase one, picked by
  `NEXT_PUBLIC_COMIC_DATA_SOURCE`.
  - The mock's pages are blank dithered sheets with `PAGE 3` in text (a tile pattern and text, never drawn art), or
    Luke's own files if he drops some into `assets/comic/` for local testing.

### Build order (phase 1), one verified push per step
1. Database, storage bucket, file route and repositories (mock and Supabase). The module key and the empty
   `/comic` page.
2. The studio: CONTENTS, PAGES and the upload (resumable, copies made on the server).
3. The reader: contents page, chapter column, spreads, zoom, continue, preview of unreleased pages for Luke.
4. RELEASE (`comic_release`) and `[ FOLLOW ]`, hooked to NOTIFY's function.
5. Panels: the guess and the studio editor.
6. Panel comments: the `comic` anchor, the switch, the pane, the board preview.
7. Lore: tags, WHO, APPEARS IN, CHARACTER pages.

**Proof**: every step is proved locally on mock data (`npm run verify`, `checks:changed`, new `Temp/check-comic-*.cjs`
checks that are watched failing first, screenshots at 1440 in the dark theme, capture and audit). Then it goes live
with deploy-status and `npm run read -- --url https://debaser.site/comic`. One short live check covers the release
policies (a visitor can't read an unreleased page row or its file) and runs through `heavy-step.cjs --live-check`.

---

## Phase 2: the ARG (built after phase 1 is live, Q18)

Rules settled now. The fine detail is settled when phase 2 starts.

### Where passwords are typed (Q19)
- **Locked files**: a hidden file can show in FILES (or anywhere a file shows) as locked, `⚿ <NAME>`. Opening it asks
  for its password.
- **TERMINAL**: a hidden window that takes typed commands and passwords. It is *found*, not listed on the top bar or
  in MODULOS: it opens from an address and from a hidden file, and how readers learn of it is a clue Luke draws.
  - It knows a few plain commands (`HELP`, `DIR`, `CLS`, `EXIT`), which never count as guesses.
  - Any other word is checked as an answer against every terminal puzzle.

### What can unlock (Q20: all six)
1. Hidden files in FILES: his pictures, notes, audio.
2. Hidden lore pages.
3. A secret module on the top bar.
4. A mark on the solver's profile. It is a text-character mark, never drawn art, with no counts read back at
   visitors.
5. Bonus comic pages: pages marked SECRET in the studio, outside the chapter order, served only to those who unlocked
   them.
6. A secret theme or cursor, added to Preferences for whoever unlocked it.

### Who sees an unlock (Q21)
- Per puzzle, in the studio. The default is **just the solver**. The other choice is **everyone, once someone solves
  it** (the first solve opens it for the whole site).
- Whether the first solver is named on an everyone-unlock (`FOUND BY <NAME>`) is to be asked at phase 2.

### Guessing (Q22, Q23)
- 5 wrong tries on a puzzle, then a 10-minute wait on it, as with room passwords. In the terminal, the count is per
  reader across all terminal guesses.
- **Hints** (Q23): optional per puzzle, written by Luke, shown after 10 wrong tries in all.

### Signed-out visitors (Q24)
- They can find and try puzzles.
- What they unlock is kept in that browser only, as a token signed by the server, so it can't be forged by editing
  storage.
- It moves to their account when they sign in.
- Their guesses are rate-limited by the server (by connection) as well as by the wait above.

### Firm rules
- **Answers are checked on the server, never in the browser.** They are stored as `crypt` hashes in a table no one can
  read, and checked by a definer function (or a server route for signed-out visitors). An answer is never in the page,
  its code or any response.
- **Hidden things never reach a browser until unlocked.** The files sit in a private bucket and are served by a route
  that checks the unlock. Hidden lore pages, bonus pages and secret modules are absent from every list and response
  until unlocked, so viewing the page source reveals nothing.
- **Clues live in Luke's art.** WORDS ON THIS PAGE, alt text, file names and hover tips are readable in the source, so
  they may hold a clue on purpose, but never an answer.
- **Puzzles are made only by Luke**, in a PUZZLES tab of the studio, with: name (private), answer, where it is typed
  (file or terminal), what it unlocks, who sees the unlock, hint.
- Spoilers on the forum are not policed.
- Database tables (puzzles, solves, attempts, unlocks) are described and OK'd when phase 2 starts.

### To ask at the start of phase 2
- How the terminal is first found.
- FOUND BY names.
- The profile mark's look.
- Whether a hidden lore page can be edited by those who unlocked it, or only read.

---

## Out of scope
- A release schedule or timers (Q7 is by hand; a timer can be added later, since pg_cron is there).
- Paged or two-page reading (Q5).
- Other people tagging panels (Q13).
- Phone-specific design.
- Selling or locking pages behind accounts: every released page is open to all.
- Translating pages.
- Downloads of whole chapters.
- Comic pages in MEDIA or in the `/read` book reader.

## Risks, said once
- **Very big originals take time.** Uploading over the tunnel and making the copies with `sharp` on the PC is slower
  than the site's usual small files. The studio shows each page's progress, and a page is never released until its
  copies exist.
- **The gutter guess works on clean, single-colour gutters.** Pages with art bleeding across the gutters, or with no
  gutters, get rough boxes or none, and Luke draws those by hand.
- **The site is down while the PC is off, and so is the comic.** HOSTING's sleeping page covers that.
- **Lore pages are editable by everyone**, so someone could deface a character page. The DOCS history keeps every
  version; CHARACTER marks and panel tags stay Luke's.
