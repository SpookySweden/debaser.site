---
name: add-web-adapter
description: The recipe for adding a new platform (Openverse, PeerTube, a podcast RSS feed, YouTube channel RSS...) to WEB, the media stream on the MEDIA page (/media, called WEB at /web and ARCHIVE at /archive until 2026-11-04; WEB in the code). Use when asked to add a source or platform to WEB or to the archive.
---

# Add a WEB adapter

Read `SPEC-web.md` and the MEDIA section of `CLAUDE.md` first (the page readers call MEDIA is WEB in the code). The Internet Archive adapter
(`app/lib/web/adapters/internet-archive.ts`) is the worked example: copy its shape. Pick the closest
of the others for anything unusual:
- `peertube.ts`: the host varies, so it comes from a hand-picked list in code (`PEERTUBE_INSTANCES`).
- `openverse.ts`: no player at all (`embedPath: NEVER`), a shared anonymous rate limit.
- `podcast.ts`: any host at all, so a source may only name a feed listed in `PODCAST_FEEDS`; RSS.
- `youtube.ts`: Atom; addresses split over several hosts (`pageHosts` / `thumbHosts` / `embedHosts`).
Feeds are parsed with `adapters/xml.ts` (strict, bounded, no DTDs); do not add an XML dependency.

## Rules no adapter may bend
- Official public APIs, RSS/Atom, oEmbed or open-data endpoints only. No HTML scraping, no
  yt-dlp-style extraction, no paid or keyed service unless Luke says so.
- Metadata only: the `WebItem` fields. Never request, store or pass on likes, views, downloads,
  ratings, follower counts or comments. Do not put engagement fields in the request's field list.
- Never download, copy or re-host media. Thumbnails are hotlinked; playback is the platform's own
  embed, unmodified, or an outbound link.
- Build every URL with `buildUrl` from fixed path parts plus identifiers that pass `isSafeIdentifier`
  (`^[A-Za-z0-9][A-Za-z0-9._-]*$`). Never fetch, link, frame or show an image from a URL found in
  remote data. A licence URL from the data is kept only when it passes `isAllowedUrl` against `linkHosts`.
  Two narrow exceptions, both re-validated: a piece of a path matched by a strict regex and rebuilt on a
  fixed host (PeerTube's thumbnail file name), and a link kept only on one listed host with one listed
  path shape and no query (a podcast episode page). Anything else from the data is ignored. The media
  servers (SPEC-media-servers.md, `media-titles.ts`) use the same exception: a picture address from a
  server's list file is kept only when it is https on that same server's own listed host (no query, no
  `..`); play addresses are never taken from a list, only built from the server's patterns in code.
- An `externalId` must start with a letter or digit: `paging.ts` refuses any other cursor id. Hash an
  id that is not safe (podcast guids) or skip the item (YouTube ids starting with `-` or `_`).
- A host that is not fixed (instances, feeds) comes from a list in `hosts.ts` that Luke edits in code,
  never from a source row, free text or the remote data. Fetch only from the source's own host.
- All text goes through `sanitiseText` (300 for titles, 200 for creators, 1000 for descriptions).
- Fetch only through `safeFetchJson` / `safeFetchText` (`app/lib/web/safe-fetch.ts`) with the
  adapter's own `allowedHosts`. One request per `fetchItems`, no retries.

## Files to touch, in order
1. `app/lib/web/types.ts`: add the platform to `WebPlatform` and its visible name to `PLATFORM_LABELS`
   (capitals, e.g. `OPENVERSE`). The name shows next to every item's link, since sources are never grouped.
2. `app/lib/web/hosts.ts`: add `PLATFORM_HOSTS.<platform>` with `hosts` (exact hostnames the adapter
   fetches from and that item `url` / `thumbnailUrl` / `embedUrl` may use) and `linkHosts` (link-only,
   e.g. licence pages), plus `pagePath` / `thumbPath` / `embedPath` regexes for the exact path shapes
   the adapter builds. No wildcards. The page draws only what `rowAddresses` (host + path, no query)
   lets through, so a too-loose regex here is a hole; add hostile cases for it to the check. No player:
   `embedPath: NEVER`. When pages, pictures and the player live on different hosts, add
   `pageHosts` / `thumbHosts` / `embedHosts` so each address is held to its own host.
3. `app/lib/web/adapters/<platform>.ts`: export pure, testable pieces (`validQuery`/`validRef`,
   `searchUrl`, `toWebItem(doc, fetchedAt)`, `parse...(body, fetchedAt)`) plus the adapter object
   `{ platform, allowedHosts, linkHosts, fetchItems(source, deps) }`. Use `deps.fetch` and `deps.now`
   so checks run offline. Fields that may be a string or an array: read with a `first`/`joined` helper.
   Skip (return null for) items with a bad id, no usable date, or that are restricted or private.
   Map the platform's media type to `audio | video | image | text | other`. Set `embedUrl` only for
   kinds whose official player works framed. `id` is `${platform}:${externalId}`.
4. `app/lib/web/adapters/index.ts`: add it to `WEB_ADAPTERS` (typecheck fails until you do).
5. `app/lib/web/mock-web-repository.ts`: two items borrowing real ids from the fixture, titles starting
   `MOCK ITEM nn`, so `/media` shows the label and the player. The new check holds its platform's mocks.
6. If the embed needs other `sandbox` tokens than `allow-scripts allow-same-origin`, `allow=`
   permissions, or a referrer, change `WebStream.tsx` per platform, record the live evidence in a
   comment, and change `check-web-types.cjs` with it. Never add `allow-top-navigation`, `allow-popups`
   or `allow-forms`. Only YouTube gets a referrer (`strict-origin`, origin only): without one its player
   shows "Error 153". No player is ever sent the page path.

## Verify live, once, with a throwaway script
In `Temp/` (deleted afterwards): compile the adapter with `npx tsc ... --outDir Temp/out-<name>`,
run it against a real source, and record: the API status, that every requested field is accepted,
the HTTP status of the thumbnail, embed and page URLs for 3 items, and `X-Frame-Options` /
`Content-Security-Policy: frame-ancestors` on the embed (either one blocking framing = no `embedUrl`).
Save 5 real documents to `scripts/fixtures/web/<platform>-<what>.json` (or `.xml`), unmodified except
that engagement fields the platform sends anyway (PeerTube's views/likes, YouTube's `media:community`)
are cut out: the repository does not store them either. Put fake ones in the check's hostile docs.

Then play the embed for real: `/media` on the mock dev server (`dev-mock` in `.claude/launch.json`),
press PLAY and play inside the player. The in-app browser pane cannot play YouTube video, and Chrome is
not installed here: drive Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`) with
`playwright-core`, click inside the iframe, and read `video.currentTime` from its frame. A moving
`currentTime` with the sandbox on is the evidence.

## The check
`scripts/check-web-<platform>.cjs`, modelled on `scripts/check-web-internet-archive.cjs`: header comment
with its `npx tsc` compile line into its own `Temp/out-web-<platform>` (a shared folder lets one
check run another's stale build), then assert against the fixture and hostile
docs that string/array fields both work, restricted and invalid ids are skipped, HTML is stripped,
every URL is on the allow-list, no engagement keys come out, the request asks for none, and the
fake fetch sees one request. `npm run checks:web` picks it up by its `check-web-` name and
`npm run verify` runs it. Prove it: break the adapter (drop the id check), watch it fail, restore.
`scripts/check-web-types.cjs` already guards `types.ts` and keeps fetching out of browser code.

## Done
`npm run verify` passes, the check was seen failing, the live findings are in the commit message,
and `/media` still renders (screenshots at 1440 and 390). Commit on the WEB branch; do not push.

## A search provider (search everywhere, SPEC-web-search.md)
EVERYWHERE asks providers live; it is separate from the stream's adapters. Copy
`app/lib/web/search/providers/internet-archive.ts` (or `wikimedia-commons.ts` for a platform with no
stream adapter). A provider is `{ platform, allowedHosts, timeoutMs, search(words, page, deps),
fetchOne(externalId, deps) }` (`app/lib/web/search/types.ts`); everything in `app/lib/web/search/` is
server-only.
- `words` are letters and digits only (`searchText`); never pass anything else of what was typed.
- `page` comes back from a cursor the browser holds: re-validate it (integer in range, or a token matching a
  strict pattern) and fall back to the first page. Return `next: null` at the platform's end and at a cap.
- Failures throw; `run.ts` turns them into fixed phrases. For a reason only the platform knows (a quota, a
  missing key) throw `SearchProblemError` with one of its phrases. Never put a platform's message, a URL or
  a key into anything returned or thrown.
- A key: server-only, read by the route from `process.env` and handed in `deps.env`; never NEXT_PUBLIC. Copy
  `youtube.ts` and its check, including the run of the real route with a fake key.
- Hosts that are not fixed come from a list read and checked on the server (PeerTube: `peertube-index.ts`),
  never from a result alone; rows from them pass `rowAddresses` only with those hosts (`ExtraHosts`).
- `fetchOne` is how the hourly ingest saves an item someone opened: one request, by id, null when gone.
- Orders (SPEC-web-sort.md): list in `orders` only what the platform really gives (`popular`, `newest`, `oldest`),
  read `deps.order`, and date items by the field the platform orders by. DATE needs both directions; without a
  popularity order, also add the platform to `NO_POPULAR` in `app/lib/web/web-sort.ts` (check-web-sort holds both).
- A new platform: add it to `WebPlatform` (as `SearchOnlyPlatform` if no stream source reads it),
  `PLATFORM_HOSTS`, `WATCH_KIND_BY_PLATFORM`, then `SEARCH_PROVIDERS` in `app/lib/web/search/index.ts`.
  If a pasted link should find it, add its address forms to `search/link.ts`.
- Verify live (search, thumbnail, page and player status codes for 3 items, frame headers), save a trimmed
  fixture as `scripts/fixtures/web/search-<platform>.json`, write `scripts/check-web-search-<platform>.cjs`
  with `scripts/web-search-check-kit.cjs`, and watch it fail on broken code.
