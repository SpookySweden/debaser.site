# SPEC: the DEBASER reader (Luke, 2026-11-11)

Replaces the reader window built from SPEC-books.md (`app/components/BookReader.tsx`, plain text in a window) with a
proper e-reader of the site's own, built on open-source parts. Built in a fresh session from this spec.

## What Luke asked for
"I want books opened in a proprietary e reader, use what is open source that you can and make it a very nice and usable
ereader." Proprietary here means the site's own reader, looking like DEBASER, not a stock viewer.

## Luke's answers (2026-11-11)
| Question | Answer |
|---|---|
| Where it opens | **A full page of its own**, `/read/<ref>` (e.g. `/read/books:OL85892W-pg345`), filling the screen. It has a **focus mode** that hides everything but the book, and Back returns to where you came from. READ on MEDIA rows and book pages, and highlights' links, go here. `?at=` / a saved place opens at the right spot. |
| Features | All four: **look settings** (text size, line spacing, margins, the site's fonts, light, dark and sepia paper); **chapters and progress** (contents list, progress bar with %, time left in the chapter); **two-page spread** on wide screens and one page on phones, with swipe and tap to turn and the arrow keys; **search in the book and bookmarks**, beside highlights. |
| Highlights | **A few colours** (4 or 5 from the site's palette, chosen when highlighting). Comments, the 🔒 lock, the post in "[NAME] READING [BOOK]", GO TO, + LETTER and the book page's readers all work as now. |
| The book file | **Project Gutenberg's EPUB edition, pictures included**, instead of plain text. **Luke's OK widens the exception (2026-11-11):** the EPUB file passes through our server to the reader and is **never kept** (not on disk, in the database, in the fetch cache or on Vercel's edge: asked `no-store`, answered `private, no-store`). Free Gutenberg books only, as before. The plain-text route can go once nothing uses it. |

## The engine
- **foliate-js** (github.com/johnfactotum/foliate-js; the engine of the Foliate app; MIT licence, check it before
  vendoring): EPUB parsing, paginated and two-column layout, CFI positions, search, overlays for highlights, a table of
  contents. Vendor its files into the repo, with its licence file, as a pinned copy. No CDN at run time.
- If foliate-js proves unworkable in this Next.js, **epub.js** (BSD) is the fallback. Report which was used, and why.
- The EPUB arrives as a Blob from our route: the engine must never be given a gutenberg.org address to fetch itself.
  Book content renders inside the engine's sandboxed frames. No script from a book ever runs (Gutenberg EPUBs carry
  none; turn scripting off in the engine regardless).

## How it should feel
- The DEBASER look: the site's tokens, fonts and keys around the page, never raw colours (`npm run tokens`). Paper themes
  (light, dark, sepia) are reading colours chosen for long reading, added as tokens through `docs/theming.md`, readable
  at 4.5:1.
- Top bar: back, the book's title, contents, search, bookmarks, highlights, look settings, focus mode. Bottom: the
  progress bar (draggable to jump), %, chapter name, and time left in the chapter.
- Selecting words shows a small highlight bar (the colours, COMMENT, 🔒) next to the selection, laid out so nothing on
  the page moves.
- Phones: one page, swipe or tap the outer thirds to turn; settings in a bottom sheet. Desktop: two pages when wide.
- Look settings are saved per person (signed in) or per browser, and remembered for every book.

## Firm lines and how they apply
- **Database (Luke's OK needed before the build session writes it):** highlights get a `cfi` position and a `colour`
  (from a fixed list), alongside the old paragraph fields (the 0 to few existing rows keep working or are converted;
  count first); a `book_bookmarks` table (person, book, cfi, label, time), owner-only like `book_places`; reading places
  keep a `cfi`. Row Level Security as in `20261110222807_books.sql`. Mock and Supabase stores both.
- Quotes saved with highlights stay short (300 characters), as now. Nothing from the book is ever stored but those.
- `CLAUDE.md`'s MEDIA section gets the widened exception, worded like the subtitles one.

## Out of scope
- Books other than Project Gutenberg's (Open Library borrowing stays on Open Library).
- Text-to-speech, dictionaries, translation.
- Sharing a reading position live with others.

## Proof (for the build session)
- Checks: the EPUB route serves only Gutenberg's file for a book with a Gutenberg number, `no-store` both ways, and
  stores nothing; highlights' and bookmarks' privacy asked live with TEST ACCOUNT A and B and a visitor; the pure parts
  (settings, positions) offline.
- Screenshots on the live site, desktop and phone width: a two-page spread, the contents list, the settings in each
  paper theme, a coloured highlight with its bar, search results, and focus mode.
- The house loop in core.md through `npm run read`.
