# SPEC: every edition of every book (Luke, 2026-11-11)

Build this in a fresh session, after reading CLAUDE.md, `.claude/rules/core.md`, `SPEC-books.md` and `SPEC-reader.md`.

## What Luke asked for
"Each copy of every book appears." He owns several copies of the same book that differ (footnotes, interviews,
introductions), and wants each edition listed as its own real, searchable entry, whether or not the site can open it.
Later he plans "marked as read", reviews and ratings. **This spec is only the framework that lists and presents the
books and editions.** Nobody has to read anything on the site.

## Decisions (Luke, 2026-11-11)
- **Source: Open Library**, the free catalogue of every edition (`openlibrary.org`, JSON, keyless), not IPFS. IPFS
  stores files and has no catalogue; the only IPFS book catalogues are pirate libraries (LibGen, Anna's Archive), and
  those are never sources (SPEC-books.md). Checked live: Dracula (`OL85892W`) has 1,920 editions, each with publisher, year,
  pages and ISBN. Many older or better-made ones also have contributors (introductions, notes), an edition name, a cover,
  notes, a contents list, or an Internet Archive scan (`ocaid`).
- **Search shows one row per book (an Open Library work), with its editions inside**, not one row per edition (Dracula's
  1,920 would flood search). Luke accepted this recommendation ("sounds perfect").
- **Every book is searchable**, not only the ones the reader opens. This replaces today's rule that BOOKS lists only works
  with a Project Gutenberg copy or a library scan (`GUTENBERG_ONLY` in `app/lib/web/search/providers/books.ts`). Those
  copies still come first.
- **Each edition shows every legal way to read it that a source covers:**
  - its own Archive scan, opened in the site's reader when it is free (`internet_archive:<ocaid>`, as today);
  - `[ BORROW ON ARCHIVE.ORG ↗ ]` when that scan is a lending-library copy (read on archive.org with the reader's own
    account; the site never opens it);
  - the work's Project Gutenberg copy, in the reader;
  - an IPFS copy named in `app/lib/books/ipfs-catalogue.ts`, in the reader.
  - With none, the edition says `NO FREE COPY` and links to its Open Library page (libraries and shops are listed there).
- **No database changes in this work.** Editions are read live from Open Library when a book's page opens. "Marked as
  read", reviews and ratings come later, each with Luke's OK for its tables.
- **Ratings (later):** CLAUDE.md says MEDIA never shows ratings. That rule is about other platforms' counts. The site's own
  readers rating books is a new decision for Luke when that feature is built. Open Library's own ratings and counts are
  never asked for or shown.

## What readers see
1. **BOOKS search:** a row per book with its cover, title, authors and first year, and a note of how many editions there
   are (`1,920 EDITIONS`). READ shows when any edition or copy opens in the reader. `[ EDITIONS ]` goes to the book's page.
   Typing an ISBN finds that exact edition's book and opens its page at that edition.
2. **The book's page** (`/media/book/books:OL85892W`, `app/components/BookPage.tsx`) gets an **EDITIONS** list below the
   book, paged (about 50 at a time, `[ MORE ]`). Each edition is one row:
   - its cover (when it has one), title as printed, and edition name (`Norton Critical Edition`);
   - its publisher, year, page count, format (paperback, hardcover, ebook, audio) and ISBN;
   - who else is in it (`Introduction by …`, `Notes by …`) from `contributions` and `by_statement`, and its notes and
     contents list when Open Library has them, folded away behind `[ DETAILS ▾ ]`;
   - its READ, BORROW or NO FREE COPY.
   Filters across the top: `ALL / CAN BE READ HERE / HAS DETAILS` (contributors, notes or contents), and the order: newest,
   oldest, or the editions with the most details first (the default, so bare print-on-demand reprints sink).
3. **Each edition has its own address**, `/media/book/edition:OL7247530M` (an Open Library edition key ends in `M`). It
   opens the book's page at that edition, highlighted. This is what "marked as read" and reviews will attach to later.

## How (for the building session)
- **Open Library API** (through `safe-fetch.ts`, on `openlibrary.org` and `covers.openlibrary.org` only):
  - a work's editions: `/works/{OL…W}/editions.json?limit=50&offset=n` (`size` is the total);
  - one edition: `/books/{OL…M}.json`;
  - an ISBN: `/isbn/{isbn}.json` (answers with a redirect to `/books/{OL…M}.json`; allow that hop on the same host only);
  - search: `search.json` as BOOKS asks today, without `id_project_gutenberg:*`, asking `edition_count` too.
  Only these fields are read: title, subtitle, edition_name, publishers, publish_date, number_of_pages, pagination,
  physical_format, isbn_10, isbn_13, covers, contributions, by_statement, notes, table_of_contents, ocaid, works, languages.
  Text is sanitised to plain text (`sanitiseText`), and `notes` may be a string or `{ value }`.
  Be gentle: one request per page shown, cached briefly (the fetch cache is fine for metadata; never for book files).
- **Is a scan free or lent?** Ask the Archive's metadata for the `ocaid` the same way the reader's route already does
  (`app/lib/web/books.ts`: an access-restricted or `_lcp` item is a lending copy). Ask only for the editions on screen.
- **The routes and refs:** a new `edition:OL…M` ref, accepted by `BookPage`'s `REF`, `BOOK_REF` in `books.ts`,
  `/api/web/book/info`, and `app/lib/letters/things.ts` (so an edition can be sent in a letter later). The edition list is
  its own route (for example `/api/web/book/editions?ref=books:OL…W&offset=n`), open to visitors like MEDIA.
- **Mock and Supabase:** nothing new is stored, so there's no repository change. Say so in the commit.
- **Proof:**
  - a check with saved Open Library answers (`scripts/fixtures/web/`): editions parsed, plain text, rows sorted with the
    detailed editions first, the READ / BORROW / NO FREE COPY choice per edition, ISBN lookup, hostile values refused;
  - prove the check fails on broken code;
  - a real-browser drive of a book's page at desktop and phone width (Dracula, and a book with one edition);
  - the house loop: verify, checks:changed, capture + audit, push, deploy-status, read live.

## Out of scope
"Marked as read", reviews, ratings, a person's own shelf, adding books Open Library doesn't have, and any IPFS catalogue.
