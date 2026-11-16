# SPEC: MEDIA's default feed (Luke's second list, 2026-11-16)

Status: **Luke said yes, 2026-11-16 ("Yes, build it", relayed by the list-2 coordinator): Phase B, building.**
Group FEED. His decisions, the same day: **1 = A** (reading read live from the feeds, kept 30 minutes on the server,
no database), **2 = A** (Hacker News and Lobsters links go to the story's own site in a new tab, the one-off exception
as written), **3 = A** (papers open on arXiv or Europe PMC in a new tab). No database change is approved or needed.

## What Luke asked for
"make the default feed you are presented in media an informed combination of all available sources of reccomendations
and linked algorithms such as my youtube and associative auto reccomednations and tags and the users interaction
history. with mixed in nuanced stuff such as research papers, news videos / articles and anything emergent and
informative for the brain."

He ticked all four new kinds (interview, 2026-11-16):
- research papers
- news
- long reads and explainers
- tech and maker links

## What is there today (read from the code, 2026-11-16)
- **The default view.** /media with nothing searched, ALL SOURCES and BEST MATCH shows PICKED FOR YOU. That is the saved
  stream (`web_items`), reordered one page at a time for the reader (`recommend.ts`).
- **The stream is small.** It has 7 sources: 2 Openverse, 2 PeerTube, 1 Internet Archive, 1 YouTube and 1 podcast. They
  hold about 224 items (counted read-only today). When a filter leaves nothing, the page searches live with a word
  it picks (`pickSeed`).
- **What steers that order:**
  - the reader's opens in this browser (`taste-store.ts`)
  - their private history (FOR YOU engine, `app/lib/recommender/engine.ts`: opened, played, read, finished,
    NOT FOR ME, MORE LIKE THIS, LESS FROM THIS CHANNEL)
  - their linked YouTube (`use-your-youtube.ts`: channels, topics, likes, imported history)
- **Recommenders that already exist but show elsewhere, not mixed into the default view:**
  - **YOUR YOUTUBE shelf:** new uploads from your channels, your likes, and YouTube's own "watch next" for your videos.
    That last one is the associative part, read through InnerTube. It is the only way channels you don't subscribe
    to arrive.
  - **RECOMMENDED:** what people here recommend publicly, then what fits you.
  - **DISCOVER:** odder finds from the tagged catalogue (1.69 million items, words from the tagging that stopped on
    2026-11-06) that fit your DISCOVER settings and presets.
- **No reading sources at all.** The stream has no papers, news, long reads or tech links.

## What Luke will see

### Signed in: /media, nothing searched
PICKED FOR YOU becomes one mixed list, drawn in blocks of 12. Each block follows the same pattern of places:

| Place | Comes from |
|---|---|
| 1, 2, 5, 9, 11 | **FOR YOU:** the saved stream ordered by your taste and history, as today |
| 3, 8 | **YOUR YOUTUBE:** the shelf's videos, the "watch next" ones from channels you don't follow included |
| 4, 10 | **READING:** one paper, news story, long read or tech link (rules below) |
| 6, 12 | **NEW TO YOU:** the DISCOVER catalogue's finds that fit your words and presets but aren't things you already know |
| 7 | **PEOPLE'S PICKS:** something recommended publicly here, or sent to you in a recommendation |

So in every 12 rows: 5 familiar, 2 from your YouTube, 2 new, 1 from people, 2 reading. Reading flavours the list
without taking it over.

- **Rows look as they do now**, with the source's name on each one.
  - Reading rows show their kind where the platform name usually goes: PAPER, NEWS, LONG READ or TECH.
  - The outlet's name goes where a creator goes: BBC NEWS, QUANTA MAGAZINE, HACKER NEWS.
  - No why-lines on MEDIA, the same as SPEC-recommender.md decided. No numbers, ever.
- **The list holds still.**
  - It is the same all day and different tomorrow (the daily jitter already in `recommend.ts`).
  - LOAD MORE adds the next block below, and nothing already on screen moves.
- **Empty places are filled in a fixed order.** If a place's source has nothing (YouTube not linked, nobody has
  recommended anything), the place goes to FOR YOU, then NEW TO YOU, then PEOPLE'S PICKS.
  - Reading never takes more than its 2 places in 12, even when everything else is empty.
  - When FOR YOU runs dry, the page does what it does today: a live search with a word it picks.
- **DATE and POPULAR order, and any search:** unchanged. Reading rows show there only when you pick them in WHERE FROM,
  which gets a new group: READING: PAPERS, NEWS, LONG READS, TECH.

### Signed out (a visitor)
The same list, minus YOUR YOUTUBE (its places go to FOR YOU).
- FOR YOU uses only what this browser has opened. Visitors get that already today.
- PEOPLE'S PICKS shows without names (ANON), as RECOMMENDED does now.
- Nothing is recorded about a visitor anywhere.

## The mixing rule

### Reading's turn
The 2 reading places in each block go to the 4 kinds in turn.
- Every kind starts with one share.
- Your history adds up to two more shares. A kind gets one more for every 3 things of that kind you opened or
  finished in the last 30 days.
- Each place goes to the kind furthest behind its share. A paper reader sees papers about every other reading place.
  Someone who never opens news still gets a news story about every eighth reading place.
- A visitor gets the four kinds in an even turn.

### Choosing within a kind
These rules apply in this order:
1. Rows whose words match your taste come first. A row's words are its own categories: arXiv's subject, Europe PMC's
   keywords, an article's tags in its feed. Claude's tagging is off and isn't needed for this.
2. Then the newer row.
3. Then the day's jitter.
4. One outlet never appears twice in a row within its kind.
5. No outlet appears more than twice in 48 rows.
6. Hacker News keeps its own front-page order. That is the order only: no points or comment counts are read, kept or
   shown.

### What drops out
- **The same thing twice:** shown once, from the first place that picked it. The same title on two platforms is
  shown once too (`dedupe.ts`).
- **What you already opened or finished** in the last 30 days stays out of this list. It is in your history.
- **NOT FOR ME:** the row is gone at once, and its outlet and words count against it, as on every row today.
- **Shown and passed over:** a row shown in the first block on 3 different days without being opened rests for a
  week. This list lives in this browser only: ids, at most 500, kept 14 days.
- **Stale reading.** Each kind stops showing after its shelf life, though a search still finds it:
  - news after 48 hours
  - tech after 3 days
  - papers after 30 days
  - long reads after a year (they don't date)
  - Wikipedia's "In the news" while it is on today's or yesterday's list
- **Another LANGUAGE:** every reading source is in English, so another LANGUAGE hides them, as it hides the site's
  own files today.

## Where each source is read

### Reading sources: the server, live, cached, no database (recommended; decision 1)
- **The route.** A new route, `/api/web/brief`, reads the feeds below and answers with the rows still inside their
  shelf life. That is metadata only, at most about 300 rows.
  - It takes no input: no person, no words. So Vercel's cache can give everyone the same answer, and each feed is
    read about once every 30 minutes, however many people visit.
  - A feed that fails keeps its last good answer for up to 6 hours, then goes quiet. The others carry on.
- **The rules every adapter follows.** Every fetch goes through `safe-fetch.ts`, and every address is built from fixed
  parts and checked against `hosts.ts`. All text is plain (`sanitiseText`), metadata only, and nothing from an
  outlet is drawn as HTML.
- **The adapters (all new).** These sit beside the stream's adapters (`app/lib/web/brief/`) and follow the add-web-adapter
  recipe: fixtures, hostile documents, a check watched failing.
  - arXiv, Europe PMC and Wikipedia's "In the news" each get one adapter.
  - One RSS-and-Atom adapter reads every listed article feed. Each feed in that list has its own host and link shape,
    the way `PODCAST_FEEDS` works today.
  - The YouTube channel feeds and the Internet Archive search are parsed by the existing adapters, with their sources
    listed in code instead of in `web_sources`.

### The rest is mixed in the browser
- The mixing is one pure file, `app/lib/web/feed-mix.ts`, held by a check like `recommend.ts`.
- Everything it weighs is already in the reader's browser: their taste, their history rows, their YouTube shelf and
  the people's picks. Nothing new is sent anywhere to mix the list.
- **The first block** draws once the saved stream and the reading route have answered, or after 2.5 seconds with
  whatever has arrived.
- **The DISCOVER catalogue** is the slow source: about 330 KB and about 2 seconds, the same request MEDIA's DISCOVER
  makes. It is asked after the first block is drawn and fills NEW TO YOU places from the second block on. In the
  first block those two places use FOR YOU's least familiar rows.

## The sources

### Already on the site, now mixed in

| Source | What it gives the feed | Who |
|---|---|---|
| Saved stream + `recommend.ts` | FOR YOU rows | everyone |
| Private history (`engine.ts`) | steers every source: words, makers, which reading kinds; hides what you opened; NOT FOR ME | signed in |
| Taste in this browser (`taste-store.ts`) | steers FOR YOU and reading's word match | everyone |
| YOUR YOUTUBE (`use-your-youtube.ts`, `youtube-next.ts`) | the shelf's videos for its places; channels and topics steer FOR YOU, as today | signed in, linked |
| DISCOVER catalogue (`tag-station/picks.ts`, presets) | NEW TO YOU rows, by your words and presets | everyone; presets signed in |
| Public recommendations (`recommendations`) | PEOPLE'S PICKS rows | everyone (ANON to visitors) |

### New reading sources
Every endpoint below answered 200 when tried on 2026-11-16, with no key needed.

| Kind | Source | Exact endpoint | Kept |
|---|---|---|---|
| PAPER | arXiv | `https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CY+OR+cat:q-bio.NC+OR+cat:astro-ph.EP+OR+cat:physics.pop-ph+OR+cat:econ.GN&sortBy=submittedDate&sortOrder=descending&max_results=60` (Atom, one request) | title, authors (first 3, then ET AL.), abstract (1000 characters), subject as words, date, abs page link |
| PAPER | Europe PMC: PubMed, plus bioRxiv and medRxiv preprints | `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=SRC:PPR%20AND%20HAS_ABSTRACT:y&sort=P_PDATE_D%20desc&format=json&pageSize=40&resultType=core` (Phase B: OPEN_ACCESS:y dropped, Europe PMC sets it on preprints weeks late) | title, authors, journal or server, abstract (a preprint's always: its server posts it openly; anything else open-access only), keywords as words, date, Europe PMC page link |
| NEWS | Wikipedia "In the news" | `https://en.wikipedia.org/api/rest_v1/feed/featured/YYYY/MM/DD` (the `news` part; the `mostread` part has view counts and is never read) | the story's sentence as title, its first linked article's page and summary |
| NEWS | BBC News World | `https://feeds.bbci.co.uk/news/world/rss.xml` | headline, the feed's own summary, date, link; a picture where a strict path rule on its picture host passes |
| NEWS | NPR News | `https://feeds.npr.org/1001/rss.xml` | same |
| NEWS | DW (English) | `https://rss.dw.com/rdf/rss-en-all` | same |
| NEWS | Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | same |
| NEWS | PBS NewsHour | `https://www.pbs.org/newshour/feeds/rss/headlines` | same |
| NEWS | The Guardian World | `https://www.theguardian.com/world/rss` | same (no pictures: their addresses carry a signature) |
| NEWS (video) | DW News, PBS NewsHour, Al Jazeera English on YouTube | `https://www.youtube.com/feeds/videos.xml?channel_id=<id>` (ids looked up in Phase B) | as every YouTube row; PLAY opens the room window (ROOMMODEL's change) |
| LONG READ | Quanta Magazine | `https://www.quantamagazine.org/feed/` | headline, summary, author, date, link |
| LONG READ | Aeon | `https://aeon.co/feed.rss` | same |
| LONG READ | Nautilus | `https://nautil.us/feed` (no trailing slash: `/feed/` redirects, and safe-fetch follows no redirects) | same |
| LONG READ | Our World in Data | `https://ourworldindata.org/atom.xml` | same |
| LONG READ | Wikipedia's article of the day | the same featured-feed request (`tfa` part) | title, summary, page link |
| LONG READ (video) | Internet Archive lectures and documentaries | the existing Internet Archive search, one fixed query chosen in Phase B | as every Archive row; PLAY as today |
| TECH | Hacker News | `https://news.ycombinator.com/rss` (front page, its order) | title, the linked article's address, date. The comments link is dropped. |
| TECH | Lobsters | `https://lobste.rs/rss` | title, link, tags as words, date |
| TECH | Hackaday | `https://hackaday.com/blog/feed/` | headline, summary, author, date, link |
| TECH | Make: | `https://makezine.com/feed/` | same |

About 21 requests every 30 minutes in all.
- Pictures are hotlinked as today, and only where a strict per-feed path rule is written. Otherwise the row is drawn
  without a picture.
- Wire services: AP and Reuters have no public feeds. Reuters closed its RSS in 2020, and AP has no official one. So
  the news comes from public broadcasters and The Guardian.

### Terms, said once
- **arXiv:** the metadata is free to reuse (CC0). The API asks for at most one request every 3 seconds, which the single
  combined request keeps well inside. Rows credit ARXIV.
- **Europe PMC:** free, no key, fair use. Abstracts are shown only for open-access items.
- **Wikipedia:** the text is CC BY-SA. Rows credit WIKIPEDIA, and safe-fetch already sends the descriptive User-Agent
  Wikimedia asks for.
- **News and magazine feeds:** each outlet offers its RSS for reading with a link back. We show the headline and the
  outlet's own summary with its name, and link to the article; never the article's text. Some say "personal,
  non-commercial". The site isn't commercial, and showing headlines is what feed readers do. If an outlet ever asks,
  it comes off the list in one line.
- **Hacker News / Lobsters:** the official RSS. No points, no comment counts.

## How a reading row behaves
- **A paper:**
  - title, authors, server (ARXIV / BIORXIV / MEDRXIV / journal), date
  - the abstract's opening as the description
  - `[ ARXIV ↗ ]` (or `[ EUROPE PMC ↗ ]`) opens the paper's page there in a new tab, where its PDF is one click away.
    Reading it inside /read is decision 3.
- **News, long reads, tech:**
  - headline, outlet, date, the feed's summary
  - `[ BBC NEWS ↗ ]` (the outlet's name) opens the article in a new tab.
  - The article itself can't come into the site: that would mean reading its web page (scraping), which needs Luke's
    OK site by site.
  - A Hacker News or Lobsters link goes wherever the story is (decision 2), and the row names that site (GITHUB.COM).
- **News videos and lectures** are ordinary YouTube or Archive rows. PLAY opens the room window, which is ROOMMODEL's
  change on this list; FEED doesn't touch PLAY.
- **The keys every row has:**
  - NOT FOR ME and MORE LIKE THIS work on every reading row and feed the private history.
  - DISCUSS works if the forum's anchor accepts these rows. To be checked in Phase B; if it needs a database change,
    that becomes a draft for Luke's OK and DISCUSS is left off reading rows until then.
  - RECOMMEND is left off: `web_recommendations` only takes 6 named platforms, and changing that is a database change
    nobody asked for.

## Privacy
- **Nothing new is recorded about anyone.**
  - The reading route takes no input, so outlets only ever see our server.
  - A reader's browser contacts an outlet only when they press a link, or for a hotlinked picture, as with every
    thumbnail today.
- **Mixing happens in the reader's browser** with what is already there. Nothing about the mix is sent anywhere.
- **Opening a reading row** goes into the private history like any MEDIA row (kind `media`): kept 90 days, owner only,
  and PAUSE and ERASE work as today. That is how papers come to teach the feed.
- **The "passed over" list** is ids only, in that browser, for 14 days.
- **Visitors:** nothing is recorded.

## Files and tables
- **New files:**
  - `app/lib/web/brief/`: feeds list; adapters for arXiv, Europe PMC, Wikipedia news, and the RSS articles
  - `app/api/web/brief/route.ts`
  - `app/lib/web/feed-mix.ts`
  - `app/lib/web/use-brief.ts`
  - fixtures in `scripts/fixtures/web/`
  - checks
- **Changed files:**
  - `app/lib/web/types.ts`: platforms `arxiv`, `europe_pmc`, `wikipedia`, `news`, `reads`, `tech`, with their labels
  - `app/lib/web/hosts.ts`: hosts and path shapes per feed
  - `app/lib/web/web-filters.ts`: the READING keys
  - `app/lib/web/mock-web-repository.ts`: mock reading rows, so the mock site shows the whole mix
  - `app/components/WebStream.tsx`: the default view draws the mix; WHERE FROM gets READING
  - one line in CLAUDE.md's MEDIA section naming the reading feeds
- **Mock and Supabase paths:**
  - The reading route is the same for both: it reads no database.
  - The mock site gets the reading rows from fixtures, so a local drive needs no internet.
  - PEOPLE'S PICKS and history use their existing mock and Supabase stores.
- **Tables: none** with decision 1A. The two unknowns are DISCUSS's anchor and the history's `ref` shape. Either
  would come back as a written draft and a plain-English note for Luke's typed OK, never run on a guess.

## Proof
- **New checks:**
  - `scripts/check-web-arxiv.cjs`, `check-web-europe-pmc.cjs`, `check-web-wikipedia-news.cjs`, `check-web-brief-feeds.cjs`.
    Each runs against real saved documents and hostile ones:
    - HTML stripped
    - every address on its allow-list
    - no counts anywhere (Hacker News points, Wikipedia's most read)
    - one request per feed
    - a failing feed doesn't stop the others
  - `Temp/check-media-feed-mix.cjs`:
    - the 12-place pattern
    - reading never over 2 in 12 even with every other source empty
    - the fill order
    - kinds turned by history
    - no YouTube for visitors
    - repeats, opened, NOT FOR ME and stale rows dropped
    - the same list all day
    - LOAD MORE never moves a shown row
  - Each check is watched failing on broken code first.
- **Local:** the mock dev server, signed out and mock-signed-in. A drive reads the first 24 rows' labels to see the
  pattern, presses LOAD MORE and confirms the first 12 haven't moved. Screenshots at 1440 for my own checking only.
- **House loop:** `npm run checks:web`, one `npm run verify:clean` on the merged commit, push, `npm run deploy-status`.
- **Live:** `npm run read -- --url https://debaser-site.vercel.app/api/web/brief` showing reading rows from each kind.
  No live drive is needed.

## Risks and fallbacks
- **A feed changes shape or vanishes.** It goes quiet after 6 hours on its last answer, and its kind's other outlets
  fill in. The check's saved documents show what changed.
- **arXiv or Europe PMC down for a day:** papers skip their turn.
- **An outlet objects:** it comes off the list in one line.
- **The news is heavy reading** (wars, disasters) on a comic's site. NOT FOR ME pushes an outlet down for that reader.
  Luke may want fewer news outlets; the list is one place in code.
- **Too much or too little reading:** the pattern is one table in `feed-mix.ts`. "More papers" or "reading 3 in 12" is
  a one-line change.
- **The stream itself is thin** (7 sources). That isn't this task: adding more stream sources is database rows and a
  follow-up for Luke.
- **InnerTube** ("watch next") can break; YOUR YOUTUBE already falls back to a title search.

## Decisions for Luke (my pick first)
1. **Where the reading comes from.**
   - **A (recommended):** read live from the feeds, kept 30 minutes on the server, no database at all. It ships without
     a database OK, and the free database stays out of it. The cost: a reading row can't be saved into the stream, so
     a search later won't find yesterday's news.
   - **B:** stored in the database like the stream. That needs two database OKs: about 26 source rows, plus an
     automatic clean-up, because news alone would add hundreds of rows a day toward the 500 MB limit. It also checks
     each source only about every 3 hours.
2. **Hacker News and Lobsters links.**
   - **A (recommended):** straight to the story's own site, in a new tab, with that site's name on the row. Never
     framed, never fetched, no picture. It is a one-off exception to "links only to listed sites", because those two
     link to anywhere on the web.
   - **B:** link only to the story's page on Hacker News or Lobsters.
3. **Papers.**
   - **A (recommended for now):** open on arXiv or Europe PMC in a new tab.
   - **B:** read the PDF inside /read like an Archive book. That is a reader change, better as its own follow-up after
     this ships.

## Out of scope
- New stream sources (database rows), RECOMMEND on reading rows, and why-lines on MEDIA.
- Reading articles inside the site (scraping), and a news sound bar.
- Changing PLAY (ROOMMODEL), and phone-specific layout (desktop first).
