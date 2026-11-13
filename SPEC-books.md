# SPEC: books, audiobooks and the e-reader (Luke, 2026-11-10)

Part 3 of 3, built after SPEC-letters.md and SPEC-recommendations.md, so books plug into both.

## What Luke asked for
- **A better source for audiobooks**, included on MEDIA.
- **Books**, which Luke named as Anna's Archive (see "Not built" below).
- An **e-reader**.
- **Goodreads-style highlights and comments with timestamps**, which link to **forum posts** under a **thread for the
  user**, and then roll up to **the book as a whole**, which shows a **list of the users** who've highlighted it, as a
  title.

## Not built: Anna's Archive
Anna's Archive copies books without the authors' or publishers' permission. The site won't search it, link to it or
read from it. Luke chose the free legal set below instead (2026-11-10).

## Luke's answers (2026-11-10)
| Question | Answer |
|---|---|
| Book sources | **Project Gutenberg** (through the Gutendex JSON API), **Standard Ebooks** (its OPDS feed) and **Open Library** (its search API: catalogue, covers, and its own read or borrow links where it has them). Public APIs and feeds only, never HTML pages (CLAUDE.md). |
| Audiobooks | **LibriVox's own catalogue** (its public JSON API: title, author, readers, sections). Chapters play through the site's music bar straight from archive.org, where LibriVox keeps the files, the way MEDIA's audio already plays (`app/lib/web/web-audio.ts`). Nothing is stored or re-hosted. |
| E-reader | **The site's own reader**, for free books (Gutenberg and Standard Ebooks): the book's text passes through our server to the reader **and is never kept** (not on disk, in the database or in the fetch cache), the same rule as subtitles (CLAUDE.md). **This is Luke's OK for a new exception (2026-11-10): book text, free books only, never stored.** **Widened 2026-11-13 ("any book can be read in the ereader"):** every Open Library work opens in the reader. When a work has a Project Gutenberg copy or a free Archive scan, the reader shows the book's text or pictures as before. When it has only a lending-library scan, the reader embeds the Archive's own viewer (`archive.org/embed/<id>`), which carries the Archive's borrow flow; nothing passes through our server. When it has no copy at all, the reader shows the book's title, cover and a link to Open Library, inside the reader's own page: the browser never leaves `/read` on its own. |
| Highlights' visibility | **Public by default, with a lock on each highlight** to keep it to yourself. |

## How it should feel
- MEDIA gets **BOOKS** and **AUDIOBOOKS**, searched and shown like its other sources (plain-text descriptions, hotlinked
  covers, no ratings or download counts, as CLAUDE.md says for every source).
- READ opens a reader window: one column of text in the site's reading font, with page turning and keyboard arrows.
  It remembers where you were (your place is saved, the text isn't). It's readable at phone width.
- Select text, then **HIGHLIGHT**. You can add a comment. Each highlight records **when** you made it and **where** in
  the book it is.
- Each person has **one forum thread per book** ("[name] reading [book]"). Each public highlight and its comment is a post
  in it, timestamped, and the post links back to that spot in the book.
- **The book's page:** its title, then the list of people who have public highlights in it (pictures and names), each
  opening their thread. Visitors see the book page with ANON for names, as elsewhere.
- Highlights can be added to letters (SPEC-letters.md) and recommended (SPEC-recommendations.md).

## Firm lines and how they apply
- **Book text** passes through `/api/...` from Gutenberg or Standard Ebooks only, through `safe-fetch.ts`, and is never
  stored. Book text is rendered as plain text, never as the source's HTML. A highlight saves the few words selected
  (a quotation, capped to a short length) and its place, not pages of the book.
- **Audiobooks:** play from archive.org, never downloaded or copied.
- **Database (Luke's OK first):** `book_highlights` (person, book ref, place, quoted words, comment, lock, time, forum
  post), and reading places (person, book ref, place). Row Level Security: only the owner edits or deletes, and others
  read only unlocked highlights. Mock and Supabase repositories both.
- Adding a source: `.claude/skills/add-web-adapter`.

## Out of scope
- Paid or DRM books, and uploading your own books.
- Shared reading (several people on one page at once).

## Proof (for the build session)
- `npm run checks:web`, plus new checks: the reader's route serves only the two allowed hosts and stores nothing; a
  locked highlight can't be read by another test account or a visitor; a public highlight makes its forum post and
  lists the person on the book's page.
- Screenshots at desktop and phone width: BOOKS and AUDIOBOOKS on MEDIA, the reader with a highlight, a forum thread
  of highlights, and a book's page with its readers.
- The house loop in core.md through to `npm run read`.
