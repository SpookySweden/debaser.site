@AGENTS.md

The house rules live in `.claude/rules/core.md` (loaded automatically).

## MEDIA (the /media page, WEB in the code; SPEC-web.md)
- Luke renamed WEB to ARCHIVE on 2026-11-03, then ARCHIVE to MEDIA on 2026-11-04: readers see MEDIA, the page is /media,
  and /web and /archive redirect there (next.config.ts). The code keeps the WEB name: `app/lib/web/`, `/api/web/*`, the `web`
  nav key and forum anchor kind, the `web_*` tables, `npm run checks:web`, the add-web-adapter skill.
- Proof: `npm run verify` (lint, tokens, typecheck, build) must pass, and `npm run checks:changed` (it picks the WEB checks when WEB code changes).
- Changes go through the house loop in core.md (verify, checks:changed, commit, push to main, `npm run read`).
- Metadata only: title, creator, plain-text description, thumbnail, date, kind, licence, duration.
  Never store or show likes, views, downloads, ratings, follower counts or comments.
  Sorting a search (SPEC-web-sort.md, Luke 2026-11-02): a platform's own popularity order may be asked for, and TMDB's
  rating may order KINO titles. Counts and ratings stay on the server and decide order only: never shown, saved or
  sent to the browser.
- Index and link or embed. Never download, copy, transcode or re-host media; thumbnails are hotlinked,
  playback is the platform's own embed (asked to autoplay on our PLAY), an outbound link, or, for audio,
  the site's music bar streaming the platform's own file straight from the platform via a redirect
  (`app/lib/web/web-audio.ts`, Luke's OK 2026-10-31), or, in a stream room, an Internet Archive series'
  episodes as their https video files played straight from archive.org in the room's own player, in step
  (`app/lib/web/series-files.ts`, Luke's OK in SPEC-stream-series.md, 2026-11-02).
- Subtitles (SPEC-subtitles.md, Luke's OK 2026-11-03): an Internet Archive item's `.vtt`/`.srt` subtitle text passes
  through our server (`/api/web/subtitles`) to a viewer's player when they switch it on (archive.org sends no CORS
  header): only files the item lists, SRT converted to VTT, never stored (not on disk, in the database or in the
  fetch cache). Subtitle text only, never video or audio. Each viewer picks their own; nothing is synced.
- Books (SPEC-reader.md, Luke's OK 2026-11-11, widening SPEC-books.md's for plain text): a Project Gutenberg book's EPUB
  edition, pictures included, passes through our server (`/api/web/book/epub`) to the reader at `/read/<ref>` as it
  streams: free Gutenberg books only, from www.gutenberg.org only, never kept (asked `no-store`, answered `private, no-store`;
  not on disk, in the database, in the fetch cache or on Vercel's edge). The engine is a pinned copy of foliate-js in
  `vendor/foliate-js/`; it is handed the Blob, never an address, and no script from a book runs. Only a highlight's short
  quote (300 characters) is ever stored. Luke widened it the same day ("options 2 for epubs and 1 for eveyrthing else"):
  an Internet Archive book's own EPUB (listed, not private, never its `_lcp` lending copy, never an access-restricted item)
  passes through the same way, never kept; an Archive book with no EPUB shows the Archive's own viewer
  (`archive.org/embed/<id>`) on the /read page. BOOKS shows only Open Library works with a Gutenberg copy.
  Widened again ("try to find a way to have every book, its okay to grab them directly, preferably inside our reader"):
  an Archive book with no EPUB but a PDF reads in our reader a slice at a time (`Range` requests through the same route,
  answered 206, never kept, the slice only of the PDF the item's metadata lists), fetched from the item's own file
  servers; the Archive's viewer is for a book with neither. A reader's own PDF or EPUB opens at `/read` in their
  browser and is never uploaded. Lending-library books stay out: they are copy-protected.
- Public APIs, RSS/Atom, oEmbed and open-data endpoints; unofficial JSON APIs a platform's own site uses
  (YouTube's InnerTube) are fine too, with an official fallback where one exists (core.md, "forever project").
  Never parse HTML pages.
- Remote fetches from the server go through `app/lib/web/safe-fetch.ts`. Browser code may fetch outside sites
  directly too (Luke lifted the server-only rule, 2026-11-11), but never imports the server's fetching code, which
  sits beside the keys (`scripts/check-web-types.cjs` holds that). Third-party text is
  rendered as plain text, never as HTML. Adding a platform: `.claude/skills/add-web-adapter`.
- /media is open to everyone since 2026-11-09 (Luke: "Everything"; it was signed-in only before): signed out, the stream,
  search, KINO, friends' servers, DISCOVER and RECOMMENDED all show, the WEB routes answer, and visitors may read those
  tables (`20261109003047_media_open_to_visitors.sql`). RECOMMENDED shows visitors no names (ANON). What saves to an
  account still needs one (RECOMMEND, stream rooms, YOUR YOUTUBE, DISCOVER presets); `Temp/check-media-visitors.cjs`
  asks live that those still refuse a visitor.
- DEBASER.SITE: the catalogue of the site's own files, FILES at /files, is one of this page's servers. It was MEDIA at
  /media until 2026-11-04 (its `key` in the nav and `app/lib/media/` keep that name), and its old `/media?kind=`, `?cat=`
  and `?tag=` addresses redirect to /files. A search with SOURCE ALL lists the site's own files it finds first, playing as the catalogue does
  (`app/lib/web/site-server.ts`, `WebSiteFiles.tsx`); read in the browser, never saved into the WEB stream.
- A KINO row and a server's row have a WATCH key listing every way to watch: friends' servers by TMDB number, free copies, and free services from TMDB, credited to JustWatch while they show
  (SPEC-kino-sources.md). A copy is marked PUBLIC DOMAIN only when Wikidata says so (Luke, 2026-11-06).
- Luke's own and his friends' media servers are allowed sources, with no list file (any title by its TMDB number, at once) or read from each server's list file
  (`app/lib/web/media-servers.ts`; friends' side: `docs/media-server-setup.md`). Each video plays from the
  server's own player; the site never stores, copies or transcodes video, and holds only images and audio as
  media itself. TMDB details (server-side, `TMDB_READ_TOKEN`) never include ratings, votes or popularity.
