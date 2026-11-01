# SPEC: WEB (/web)

Luke's brief, 2026-10-31. Phase 1 of 5 is the foundation; later phases are listed at the end.

## Goal
A new panel in the site header (`/web`) that shows one chronological stream of media items (audio,
video, image, text) collected automatically from many platforms.

## The feature
- Items are NOT grouped or sorted by source. One stream, newest first. The source name is a visible
  label next to each item's link.
- Metadata only: title, creator/uploader, description (plain text), thumbnail, publish date, kind,
  licence URL if the source gives one, duration if given. NEVER store or show likes, views,
  downloads, ratings, follower counts or comments. The site's own forum owns those.
- We index metadata and link or embed. We never download, copy, transcode or re-host media files.
  Playback is the platform's official embed (unmodified but for `?autoplay=1` once the reader has
  pressed our PLAY), or an outbound link, or (Luke's OK 2026-10-31) for Internet Archive, podcast and
  Openverse audio, the site's own music bar: its `src` is our redirect route, and the listener's browser
  streams the file from the platform (`app/lib/web/web-audio.ts`, `audio-files.ts`). Thumbnails are
  hotlinked. Only official public APIs, RSS/Atom feeds, oEmbed and open-data endpoints. No HTML
  scraping and no yt-dlp-style extraction.
- Free and open-source in spirit. Keyless sources wherever possible. No paid services.
- (Luke, 2026-11-01, SPEC-media-servers.md) /web is for signed-in people only. Luke's own and his friends'
  media servers are allowed sources, read from each server's list file; each video plays from the server's
  own player page. The site still never stores, copies or transcodes video, and holds only images and audio
  as media itself. TMDB details come from TMDB's official API, server-side, without ratings, votes or popularity.

## Phase 1 (foundation; no database changes, no migrations, no pushes)
- Types (`app/lib/web/types.ts`): `WebPlatform` (initially `internet_archive`), `WebItemKind`
  (audio | video | image | text | other), `WebItem`, `WebSource`. No engagement fields.
- Safe fetching (`app/lib/web/safe-fetch.ts`): HTTPS only, per-adapter host allow-list, 10s timeout,
  ~2 MB cap enforced while streaming, no retries, redirects only to allow-listed hosts. URLs are
  built only from validated identifiers (`^[A-Za-z0-9][A-Za-z0-9._-]*$`), never taken from remote
  data. Descriptive User-Agent with an optional contact from an env var (default empty).
- Sanitiser: strip HTML, decode entities, collapse whitespace, cap at 1000 characters. Third-party
  text is always rendered as plain text.
- Adapters (`app/lib/web/adapters/`): `WebAdapter { platform; allowedHosts; fetchItems(source, deps) }`
  with an injectable fetch. `internet-archive.ts`: one GET to `advancedsearch.php` (q = source.ref,
  rows 25, sort publicdate desc, fields identifier, title, creator, description, date, publicdate,
  mediatype, licenseurl, access-restricted-item; never downloads or other engagement fields).
- Repository: `listItems({cursor, limit})`, `listSources()`, opaque keyset pagination
  (publishedAt + id). Mock implementation with ~10 clearly fake items.
- `/web` route plus header nav entry. Row: hotlinked thumbnail (plain `<img>`, lazy, no-referrer,
  fixed box), title, creator, description clamped to 2 lines, KIND tag, visible SOURCE tag next to
  the link, date. No source filter, no grouping. Click-to-load embeds (sandboxed, no-referrer,
  minimum `allow`). Outbound links `rel="noopener noreferrer nofollow"`, https on allow-listed hosts
  only. LOAD MORE. Accessible names; empty, loading and error states.
- Design: Dyacid Dyes palette only, zero smooth transitions, no AI art, no CSS/SVG art, missing
  thumbnails use the placeholder slot convention. The profile-picture container is untouchable.
- Live verification of the URL patterns and embed headers; a 5-item fixture; offline checks wired
  into `npm run verify`; `/web` in capture and audit; independent security review; the
  `add-web-adapter` skill. Commit on `web-aggregator`, do not push.

## Later phases (not built yet; don't design against them)
- Supabase tables `web_sources` / `web_items` with unique (platform, external_id); pg_cron + pg_net
  calling a protected ingest route.
- More adapters: Openverse, PeerTube, podcast RSS, YouTube channel RSS.
- Search; dedupe; forum and watch-room bridges.
- Existing tables to respect: `media_items` is for our own uploads only (its `src` check), so WEB gets
  separate tables. `forum_threads.anchor_kind` has no CHECK constraint (TS union in
  `app/lib/forum/types.ts`). `watch_queue.source_kind` is checked to
  file/hls/dash/youtube/vimeo/dailymotion/twitch.
