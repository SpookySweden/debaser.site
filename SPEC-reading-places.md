# SPEC: keeping your place in every book (Luke, 2026-11-13)

Build this in a fresh session, after reading CLAUDE.md, `.claude/rules/core.md`, `SPEC-reader.md`, `SPEC-books.md` and
`SPEC-book-editions.md`.

## What exists already (checked 2026-11-13)
- The reader (`app/components/reader/ReaderPage.tsx`, about lines 520-531) saves your place as an EPUB CFI, a standard
  address of a spot in an e-book. It saves 1.5 s after each page turn: always to the browser
  (`debaser-reader-place:<ref>`), and to `book_places.cfi` too when signed in (`savePlace`, `app/lib/books/`).
- A book opens at a `?h=` / `?at=` link first, then the account's place, then the browser's. So signed-in readers already
  continue on any device.
- **Saves a place:** Gutenberg EPUBs, Internet Archive EPUBs, IPFS books.
- **Unconfirmed:** Internet Archive PDFs read in slices. The code doesn't exclude them, but nobody has checked that a PDF
  page gives a valid CFI. Prove it either way first.
- **Never saves a place:**
  - books shown in the Archive's own viewer (`archive.org/embed/<id>`), which stop before the reader engine loads;
  - a reader's own PDF or EPUB, which always opens at the start.
- `book_places` (`supabase/migrations/20261110222807_books.sql`, `cfi` added in `20261111001444_book_reader.sql`) holds
  person, book_ref, place (unused, 0), cfi, updated_at. There's no title, no "how far", and no "finished". Only the owner
  reads or writes it.
- Nothing lists the books you're partway through.

## Decisions (Luke, 2026-11-13)
1. **CONTINUE READING on /read.** The reader's own front page (`app/read/page.tsx`) opens, when signed in, on the books
   you're partway through, newest first. Each row shows:
   - the cover;
   - the title;
   - how far you are (`42%`);
   - when you last read it.

   READ opens the book. Signed out, the list is built from that browser's saved places. It shows only on /read, not on
   the profile or in MEDIA.
2. **Ask before jumping back.** Opening a book you've started shows one line before the page: `CONTINUE FROM 42%` (the
   main key) or `[ START OVER ]`. A `?h=` or `?at=` link skips the question and goes where the link points. This replaces
   today's silent jump.
3. **Your own files keep their place on every device.** A PDF or EPUB opened from your computer is known by a fingerprint
   of its bytes (a SHA-256 hash, worked out in the browser). Its place, title and how far you are save to the account
   under the ref `own:<hash>`, so the same file opened on the laptop asks to continue. **The file itself never uploads.**
   Only the fingerprint, the title from inside the file, the place and the percent are stored. In the CONTINUE READING
   list, an own-file row says `YOUR FILE`, and READ asks you to choose the file again, since the site doesn't have it.
4. **FINISHED shelf.** Reaching the last page marks a book FINISHED, with the date. /read gets a second list, READ, newest
   first, under CONTINUE READING. A finished book can be opened again, which puts it back in CONTINUE READING. There's a
   `[ NOT FINISHED ]` key for mistakes.
5. **Pages left and % read.** The reader's foot shows how far through the book you are (`42%`), and time left in the
   chapter (`7 MIN LEFT IN CHAPTER`, from your own reading speed in this book, once there's enough to judge). PDFs show
   `PAGE 12 OF 300`.
6. **Archive viewer books get our own page viewer.** A scanned Archive book with no EPUB or readable PDF shows its page
   pictures in the site's reader, straight from archive.org, so the page is known and saved like any other. The pictures
   are linked, never copied: the same rule as thumbnails. Before building, confirm live which free Archive service lists a
   book's page pictures (the IIIF manifest at `iiif.archive.org`, or BookReader's own JSON). It must be a public API, never
   HTML scraping. The Archive's own viewer stays as the fallback when that fails, and lending-library copies stay on
   archive.org (SPEC-reader.md).

## Database changes (need Luke's typed OK when the build reaches them)
Explain them in plain English first, and write the migration so it can be re-run:
- `book_places`: add `title` (up to 300 characters), `progress` (0-100), `finished_at` (when it was finished, or empty).
- A place for a PDF or page-picture book: a page number. Either loosen the `cfi` shape rule to allow `page:<n>`, or add a
  `page` column. Pick whichever is smaller, and say which.
- `own:<64 hex>` refs already pass the `book_ref` shape rule. Check it.
- No new table. RLS stays owner-only.

## Out of scope
- Showing what you read on your profile (the review suggests a NOW line, with a switch: a separate piece of work).
- Reviews, ratings and "marked as read" without reading on the site (SPEC-book-editions.md keeps these for later).
- Live syncing between two devices that are open at once. The place is read when a book opens, as today.

## How it's proven
- A check that saves a place for each kind on the account: Gutenberg, Archive EPUB, Archive PDF, page pictures, IPFS,
  own file. Each must reopen at that place and appear in CONTINUE READING with the right percent.
- A drive signed in as TEST ACCOUNT A, in two browsers (desktop and laptop stand-ins): read to 40%, open in the other
  browser, see `CONTINUE FROM 40%`. Do the same with an own file, and confirm no request carries the file's bytes.
- Finishing a short Gutenberg book moves it to READ.
- Screenshots of /read at desktop and phone width, in the dark theme.
