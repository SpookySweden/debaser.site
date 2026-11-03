# WEB search everywhere (SPEC, 2026-10-31)

(WEB is called ARCHIVE and lives at /archive since 2026-11-03; /web redirects there. See SPEC-web.md.)

Builds on SPEC-web.md (the /web stream, Phases 1-5, all live). Every rule there still holds: metadata
only, no engagement numbers, never download or re-host media, official APIs/feeds/oEmbed only, no HTML
scraping, all remote fetches through `app/lib/web/safe-fetch.ts` on the server, third-party text as plain
text, embeds click-to-load and sandboxed on allow-listed hosts.

## What Luke will see
- /web gets a scope switch next to SEARCH: `[ STREAM ]` (today's search of the saved stream, the default)
  and `[ EVERYWHERE ]`.
- EVERYWHERE searches live, at the moment of asking, across: the whole Internet Archive, all of YouTube,
  all of PeerTube (Sepia Search), Wikimedia Commons, and Openverse. One list, newest first, the source label
  on every row, the same row layout and keys as the stream (OPEN, PLAY, DISCUSS, WATCH).
- A source that fails or is slow shows one plain line ("YOUTUBE: NOT SET UP", "OPENVERSE: NO ANSWER")
  and the others still show. No source can hold up the page for more than ~20s.
- Paste-a-link: pasting a YouTube, Vimeo, Internet Archive, PeerTube or Wikimedia Commons address into the
  search box (either scope) shows that one item, playable, with no key needed (oEmbed or the platform's
  item API, built from the validated id; never fetch the pasted URL itself).
- LOAD MORE works per search (each provider's own paging, merged).

## Saving (Luke chose "save opened items")
- An EVERYWHERE result someone PLAYs, DISCUSSes or WATCHes is saved into the stream, so it can carry a
  forum thread long-term.
- The browser never sends item data to be saved. It records only a request: (platform, external_id),
  in a new `web_requests` table (signed-in users only, RLS: insert own rows, read none; a per-user rate
  cap; unique (platform, external_id) pending).
- The hourly ingest (which already holds the Vault lock) resolves pending requests through each adapter's
  new `fetchOne(externalId)` from the platform's own API, saves them through `web_ingest_save`, and marks
  the request done. DISCUSS/WATCH work immediately anyway (anchors and links are built from the validated
  id); the row simply appears in the stream within the hour.
- This needs one migration (`web_requests` + a lock-checked function to read and mark requests). It waits
  for Luke's typed OK with a plain-English description, as always.

## Providers (a framework, so more can be added)
`app/lib/web/search/`: `SearchProvider { platform; allowedHosts; search(query, page, deps) -> WebItem[] }`,
server-only, run from one route `GET /api/web/search?q=&cursor=` that fans out in parallel with a per-
provider timeout, merges newest first, and returns plain-words errors per provider. Results are cached
with Next's fetch cache (revalidate ~1 day) so repeated searches cost no quota. Query length capped;
rate-limited per IP.
- **Internet Archive:** advancedsearch.php over the whole archive (keyless; live-checked: 1,024 hits for a
  film title). Skip access-restricted items, as the adapter does.
- **YouTube:** YouTube Data API v3 `search.list` (type=video), server-only key `YOUTUBE_API_KEY` (never
  NEXT_PUBLIC). ~100 searches/day on the free quota, so cache hard and show "YOUTUBE: DAILY LIMIT
  REACHED" plainly when it runs out. Without the key, YouTube says "NOT SET UP" and the rest works.
  Play: the existing youtube-nocookie embed.
- **PeerTube:** Sepia Search API (`sepiasearch.org/api/v1/search/videos`, keyless; live-checked). Embeds
  play from the hosting instance, so the iframe host allow-list becomes: instances in the public
  instances index (fetched server-side, cached), never a host taken from a search result alone.
- **Wikimedia Commons:** the MediaWiki API (keyless; live-checked). Play through Commons' own embed
  player page, not the raw file.
- **Openverse:** its search API (slow this week; it uses the 20s wait and shares the 200-a-day limit with
  the stream's Openverse sources).
- `.claude/skills/add-web-adapter` gains a section on adding a search provider.

## Luke's own step: the YouTube key (Claude never handles keys)
1. console.cloud.google.com -> create a project (any name).
2. APIs & Services -> Library -> "YouTube Data API v3" -> Enable.
3. APIs & Services -> Credentials -> Create credentials -> API key. Edit it: API restrictions -> restrict
   to YouTube Data API v3.
4. Vercel -> debaser-site -> Settings -> Environment Variables -> `YOUTUBE_API_KEY` (Production) -> Save,
   then redeploy the latest deployment.

## Proof the build is done
- `npm run verify` passes; a `scripts/check-web-search-*.cjs` per provider against recorded fixtures
  (string/array fields, invalid ids skipped, HTML stripped, only allow-listed hosts, no engagement fields,
  the key never reaches client code or a response), each shown failing on broken code.
- Live: each provider's search, thumbnail and embed checked for 3 items (status codes, frame headers).
- Screenshots of an EVERYWHERE search and a pasted link at 1440 and 390 wide; capture + audit.
- A fresh-context security review of the route (SSRF, key leakage, iframe hosts, rate limit).
- Committed and pushed to main, confirmed live; the migration only after Luke's OK.

## Changes after launch (2026-10-31, Luke's decisions)
- **One live box.** Luke: "why the separation of stream and everywhere, all needs to turn live results and we
  need the results to show much faster". The STREAM / EVERYWHERE switch is gone: one search asks the saved
  stream and every live source at once, one request each, and each one's rows show the moment they arrive.
  Once the reader scrolls or presses anything, later rows wait behind `[ N MORE RESULTS ]` instead of moving
  the list. Openverse's live wait is 8s (the hourly ingest keeps 20s).
- **Source and type filters.** Luke: "add a search filter that allows you to sort by all of the current
  aggregates and another that lets you sort by file, similar to the search function in the forum. combine the
  searches". This reverses SPEC-web.md's "not filtered by source". SOURCE (ALL, SAVED, each platform, from
  the registries) and TYPE (ALL, VIDEO, AUDIO, IMAGE, TEXT), as keys or typed in the box (`in:youtube`,
  `type:audio`); the address carries them (`?q=&in=&type=`). A source that cannot match is never asked:
  YouTube is asked only when the filters allow YouTube and video, which saves its daily quota.
  A type is also sent to the sources that can ask for one kind (the Archive's mediatype, Commons' filetype),
  so `type:audio` finds audio instead of dropping a page of videos.
- **YouTube through InnerTube (2026-11-01).** Luke: "do it the unofficial way. we are operating in an open
  source model and scraping like that is perfectly in line with the ethos", and in core.md: unofficial methods
  are fine, say the risk once, build a fallback. YouTube is now asked through InnerTube, the JSON API YouTube's
  own site calls (`POST www.youtube.com/youtubei/v1/search`, WEB client, videos only): no key, no quota. Order:
  InnerTube, then the Data API (spending its daily budget only then), then "YOUTUBE: NO ANSWER" (so without a
  key and with InnerTube down, YouTube says NO ANSWER, not NOT SET UP). LOAD MORE goes back to whichever
  answered. Still metadata only (views, lengths, badges and every link in the answer are never read; addresses
  are built from the validated id; the nocookie player is unchanged), 6s wait, the day-long fetch cache, the
  route's per-address limit; no Invidious or Piped. Dates are approximate ("3 years ago" counted back from when
  it was read). Risk: undocumented, so YouTube can change or block it; the fallback then takes over. Unlike
  the Data API it has no "embeddable only" or safe-search switch, so a few results may refuse to play in the
  embed. An answer with videos none of which can be read, or with neither videos nor YouTube's own "No results"
  notice, counts as a failure and falls back. Known and accepted: a bad answer can sit in the day-long cache,
  so that search keeps using the fallback (capped by its daily budget) until the cache expires.
  Held by `scripts/check-web-search-youtube-innertube.cjs`.

## KINO, VIBE, years, did-you-mean and related topics (2026-11-02, Luke's request)
Luke: "remove the 'server 1 server 2' search parameters. include a tmdb search parameter but call it kino ... allow things
to also be searched for by tag description and kind of vibe ... searching dalek would list a bunch of videos about daleks
but then if you scroll long enough you also get related videos about doctor who ... allow for spelling mistakes similar
to google ... allow the inclusion of the year ... without any appended parameter".
- **No server SOURCE choices.** Media servers are no longer `in:` values or keys (SPEC-media-servers.md decision 3 reversed).
- **KINO** (`in:kino`, alias `in:tmdb`; search/providers/kino.ts, kino.ts): TMDB alone, films and shows, never asked in
  an ALL search. A KINO row is details only: poster, year, overview, runtime, genres, every season with its episode
  count, a link out to TMDB, "NO SERVER HAS THIS". No player: a title a media server holds shows as that server's
  playable row instead (same id; live-merge.ts swaps it in place). Needs `TMDB_READ_TOKEN`, else "KINO: NOT SET UP".
  No rating, vote or popularity is read or kept.
- **Seasons for friends' shows.** A show a server lists as a whole (no season/episode) is offered every season and
  episode TMDB lists (media-titles.ts `withTmdbEpisodes`, specials left out). A list that names episodes keeps exactly
  those. The "play anything by TMDB number" path (`listPath: '*'`) is unchanged on purpose: it was being used for
  vidsrc/2embed embeds, which stream without a licence (Claude declined to extend it; Luke is looking into the patcher).
- **VIBE** (`vibe:on`, a key, `?vibe=on`; search-intent.ts): the saved stream matches ANY of the words; the Internet
  Archive matches any word in subject tags, description or title; KINO turns words into TMDB genres, a decade ("80s",
  "1980s", "eighties") and TMDB keywords, and asks TMDB's discover lists. YouTube, PeerTube, Commons and Openverse get
  the words as typed (their own search is already loose).
- **A year in the words** ("alien 1979", search-intent.ts `splitYear`): read as the year of making by KINO (titles made
  that year first, then titles with the number in them) and the Internet Archive (`year:` beside the title words); a
  plain word everywhere else, where a date is only an upload date. Never alone ("1917") and never past next year
  ("Blade Runner 2049"). The page says so in one quiet line.
- **Did you mean** (related.ts, `/api/web/related`): Wikipedia's own spelling suggestion, keyless; a DID YOU MEAN key
  puts the words in the box (filters kept) and searches.
- **Related topics:** Wikidata (keyless open data), at most two, worked out from the corrected words (or the typed ones
  when those lead nowhere). Candidates: Wikipedia's top three pages for the words (same request as the suggestion; they
  know the famous meaning: Batman the hero, Dracula the novel) plus Wikidata's own search, as typed and in the singular
  ("daleks"). Ranked: exact name, Wikipedia rank, story-world descriptions before surnames, bands, places and
  disambiguation pages; an entry must sound story-world or be Wikipedia's top page ("cosy" never reaches a hormone).
  The first that links anywhere gives one of each: series, franchise, work, universe, source, prequel, sequel,
  spin-off, derivative, author, creator, part of (a novel: author first, no "next book"). Reference pages (lists,
  registries, bibliographies) are never topics. Checked live 2026-11-02 on ~35 words (dalek/daleks/dalak -> DOCTOR WHO,
  batman -> DETECTIVE COMICS, alien -> ALIENS, doctor who -> TORCHWOOD, frankenstein -> MARY SHELLEY); some plain words
  rightly get none, a few get odd ones (klingons -> VECTORS), always under a heading saying why. KINO adds TMDB's
  exact keyword ("TAGGED: DALEK"). Each is its own section below the results ("RELATED: DOCTOR WHO"), loaded when the
  reader scrolls to it, with its own MORE key; rows already listed above are not repeated. The search's own LOAD MORE
  is now "MORE FOR "DALEK"".
- Held by `scripts/check-web-kino.cjs` and `scripts/check-web-related.cjs` (each shown failing on broken code), and the
  updated filters, media and live-merge checks.
