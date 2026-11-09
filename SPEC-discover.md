# DISCOVER and RECOMMENDED (Luke, 2026-11-05)

## What Luke asked for
"Add the ability for users to recommend a piece of media, recommended search filter, uses tag algorithm to figure what you
might like and also user interaction, shows users pfp and status next to each recommendation, same order filters, rename
'tag' page to discover, add discover search filter which uses preferences set in the tag page, as to how your algorithm is
applied, even save presets in the algorithm, with an expandable menu of tag presets. Keep it blank until we have a large
pool of assigned tags and associations done by batch jobs with the api key, get that api working overtime."

## Luke's answers
- **Overtime:** sweep open catalogues (Internet Archive, Openverse, PeerTube) through their public APIs, about 5,000 items a
  run, within the $60 stop, and "find a way around the database limit" (below).
- **Blank until:** 10,000 tagged items. Until then both filters say how far along the pool is.
- **RECOMMENDED lists:** people's picks first, each with that person's picture and status, then the algorithm's own picks
  with no person beside them.
- **Recommending:** one press of `[ RECOMMEND ]` on any row, pressed again to take it back, with no written note.
- **Taste:** what you open stays in your browser, as now. Your own recommendations count towards it.

## 1. The rename
TAGS and Tag Station read DISCOVER at `/discover`, and `/tag-station` redirects there for good (`next.config.ts`). As with
WEB and CYTUBE, the code may keep its name. Reader-visible words change everywhere.

## 2. Recommending
- `[ RECOMMEND ]` on every MEDIA row, for signed-in people, as MEDIA is. It says plainly when it's on. (MEDIA is open to
  visitors since 2026-11-09: they see RECOMMENDED with ANON in place of each name, and no RECOMMEND key.)
- One recommendation per person per item. Only you can add or remove yours, through Row Level Security.
- Follow the privacy plan: new accounts are private by default, and `SPEC-privacy-decisions.md` applies. A person's picture
  and status show to signed-in people only, and their lamp only if it's on. Say on the PRIVACY tab that a recommendation
  shows your name next to the item.
- Recommendations are people on this site choosing something. CLAUDE.md's rule against storing or showing platforms' likes,
  views and ratings still holds: no recommendation counts shown beside an item.
- A row someone recommended must still be playable later, so keep what the row needs, metadata only.

## 3. The two filters on MEDIA
- **RECOMMENDED:** people's picks, then the algorithm's. Ordered by tag fit plus what you open and recommend, and the usual
  SORT keys (BEST MATCH, DATE, POPULAR) work on it.
- **DISCOVER:** the algorithm alone, applied the way your DISCOVER page settings say.
- Each is blank, with a line showing progress towards 10,000 tagged items, until the pool reaches that. Never a fake list.
- Order only: words and scores are not shown on MEDIA, as now. The exception stays the DISCOVER page.

## 4. Settings and presets on the DISCOVER page
- The page's filters, such as strict, obscure and how far out, become "how my algorithm is applied", and the DISCOVER filter
  reads them.
- Save them as named presets, in an expandable `[ PRESETS ]` menu, with one active. Save, pick, rename, delete, each two
  presses to delete.
- Saved to the account, so they follow a person between devices. They're preferences, not viewing history: Row Level
  Security, owner only.

## 5. Overtime: filling the pool
- **Sources:** public APIs through `safe-fetch`, never HTML, gently, at each API's own stated limits. Metadata only: never
  counts, never the media. No YouTube: its quota is what MEDIA's searches rely on.
- **Job size:** about 5,000 items a run. Vercel functions have a time limit, so work out what actually fits and say so.
- **Spending:** the same $60 stop, in code, shared with tagging and the word pass. The red notice shows when it stops. Tell
  Luke the real cost per thousand after the first sweep.

### Around the database limit
Don't let the pool grow without a plan. What to store is the design to get right:
- Check the project's real database size and limit first, and report them.
- **Keep what the algorithm needs, not the items.** Associations between words can be kept as compact counts per word pair,
  with most swept items dropped once counted. Only keep full rows for a bounded set that can actually be offered to people.
- Other options if that isn't enough: compressed files in Supabase Storage or Vercel, or running the sweep from Luke's PC and
  publishing compact results. Compare costs, pick one, say why.
- **Not on the table:** repeated free accounts at one provider, which risk the site being shut off. If paid space is the
  honest answer, tell Luke the price and let him choose.

## Data rules from the sources' own terms (checked 2026-11-05)
- **TMDB: Luke's decision (2026-11-06), "remove the rukes about tmdb because i didnt ask for them".** The rule that nothing from
  TMDB goes to Claude, and its check, are gone. It's his call and his TMDB account. The risk, told to him once: TMDB's API terms
  still exclude AI use, so TMDB could revoke the key, which would break KINO. KINO titles and TMDB details may be tagged and
  recommended through the server's `TMDB_READ_TOKEN`. Not built yet: Wikidata already supplies the same films, and nothing needs it to reach $60.
- **Internet Archive:** a descriptive User-Agent with no personal address, delays between requests, honour 429 and
  `Retry-After`, prefer batch calls, cache. No stated number, so start gently.
- **Openverse:** its documents give no numbers for rates or paging depth, so measure and back off. Authenticate only if Luke
  sets up a key himself.
- **MusicBrainz:** core data is CC0. Its tags and genres are CC BY-NC-SA, so keep those out unless Luke OKs that licence.

## Film and show data without TMDB (Luke, 2026-11-05)
"Find a way to use the same data TMDB would have through any means, not illegal", and "only change the way tmdb stuff is
used for tagging, leave the current kino search as is". KINO search stays exactly as it is, showing TMDB's details and
posters to readers, with its logo and notice. For tags, links and recommendations, use these instead:
- **Wikidata (CC0, no attribution needed):** films and shows, cast, directors, writers, composers, genres, dates, runtimes,
  and series. Use it first. It also holds TMDB's film and show numbers (properties P4947 and P4983), so a KINO row can be
  matched to its Wikidata entry and tagged from Wikidata's facts, without any TMDB text. That brings KINO titles into DISCOVER.
  Rules: a real User-Agent with a project address, never a personal one; 60 seconds of query time a minute; stop on 429; use
  the dumps rather than the query service if a sweep needs the bulk.
- **TVmaze (CC BY-SA, may be used for any purpose with credit and share-alike):** shows' summaries, cast, crew and genres, at
  no more than 20 calls every 10 seconds. Credit it with a link wherever its words appear. Images may be hotlinked.
- **Wikipedia (CC BY-SA 4.0):** a film's plot text, to give Claude something to read. Don't show it or store it unless it's
  credited; keep only the words Claude picks. Tell Luke that share-alike may reach those words, which is a question for a
  lawyer rather than something the code can settle.
- **Not usable, by their own terms:** IMDb's datasets (personal and non-commercial), MovieLens and its Tag Genome (research,
  no public redistribution), OMDb (personal use, no derivatives). Scraping TMDB or IMDb pages is out too: CLAUDE.md forbids
  parsing HTML, and it would dodge terms that are the reason for this section.
- **What this can't replace:** posters for most films. Free ones on Wikimedia Commons are few, so DISCOVER shows a film's
  picture only where a source allows it; KINO's own rows keep TMDB's.

## What was built for the sweep (2026-11-05; Luke's OKs in the main chat)
- **Size:** 20 MB used of a free plan's 500 MB. `web_pool_items` keeps the newest 100,000 rows with no description (about 40 MB), and
  `web_word_stats` a word's count and top 100 partners (about 25 MB, 50,000 words at most). The job sends nothing past 300 MB.
- **A run:** `/api/web/sweep`, every three hours at minute 11, `app/lib/web/sweep.ts`: up to 4,000 from Internet Archive's named
  collections (450,308 items in them on the day), 1,000 from PeerTube, 60 from Openverse, 500 films and shows from Wikidata, 250 shows from
  TVmaze. Reading stops at 25 seconds, and it sends what it has.
- **Money:** the $60 stop overall, which the sweep may use all of (Luke, 2026-11-06). About 3.3 cents per 1,000 items, measured.
- **Wikipedia and TVmaze words:** they go to Claude and aren't stored or shown; the page's `[ ? ]` credits all three with links.
  CC BY-SA's share-alike may reach the words Claude picks, which is a question for a lawyer rather than something the code can settle.

## Tagging is off (Luke, 2026-11-06: "Stay off")
`web-sweep` and `web-tag` are switched off and stay off until Luke says otherwise; `web-ingest` still runs. New items don't get tagged and the word pass doesn't run. The database stopped answering from about
10:15 UTC and recovered about 11:05, 25 minutes after the jobs stopped. Tagging's hours of heavy writing are the likely cause, not proven: the deciding figure is Disk IO on the Supabase dashboard.

**Where it stopped:** $59.25 spent, 1,688,595 items, 301,161 words, about 3.5 cents per 1,000. Files 72.8 MB (911 files, about 83 KB each). The January 6 collection (`TrumpDCInsurrectionJan062021`) is skipped in code (Luke: "Skip it"); what's already tagged stays.

**The database's indexes (Luke's OK, "Yes, make all three", all applied):** the file index `web_pool_shards_words_idx` is gone, the common-words index covers only words on 20 or more items (`web_word_stats_common20_idx`, 0.8 MB from 17), and the word number index is gone, after checking that no function, view, foreign key or code looks a word up by its number. Database 194 MB to about 152 MB. The map's top-words read stayed at about 0.6 s. No `vacuum full`: at 152 MB of 500 it isn't needed, and it's heavy disk work. If the jobs return, `web_word_vocabulary` and `web_word_waiting` read words on 3 or more items without an index: time them first.

**Left as they are, for if the jobs ever return:**
- **Batch 6797:** 2,405 items, about $0.08, part saved. Left unsaved on purpose: not worth a code change. Claude keeps the answers for a limited time, so it may well be lost, which is fine.
- **A stop rule:** the worst case set aside is about 3 times the real cost, so batches shrank toward the $59.40 line: 52,668 items from 08:49 to 10:09, about 3% of the total, with four earlier 1-item batches. Stop once the room is too small to be worth a batch.
- **`web_word_vocabulary` fix:** the word pass's read timed out at 3 seconds, 4 of 4 times in the 09:00 hour and again at 10:11.
- **The 300,000 word cap:** passed at 301,161, so brand-new words wouldn't be counted.

## Reaching readers (Luke, 2026-11-06: "Solve all of the tagging questions")
**What it was:** a list held 2,136 rows at most against 1.69 million items, a word stopped at 4 files, and of the first 100 rows on MEDIA's DISCOVER 53 had no player and at most 7 were from the catalogue. DISCOVER and RECOMMENDED looked the same to a reader with no history.

**What it does now:**
- **[ MORE ] digs (`/api/tag-station/more`, `poolFiles`).** On the DISCOVER filter, RECOMMENDED and the DISCOVER page, a press reads the next files when the list is about to run out, and says how far it's got (READ 8 OF 327 FILES). Each reader has an order of files from their visit's seed; the files holding the asked word come from `web_pool_shards` and each is read once. The first step, which happens by itself, reads 4 files at most; a press reads up to 6, stopping at 30 rows. A file that has gone is passed over; any other failure leaves the place where it was, so the same press tries again. The database function `web_pool_shards_for` is no longer used and is left in place.
- **MEDIA search lists tagged rows (`WebCatalogueFinds.tsx`).** Its own request, so the outside sites are neither waited on nor slowed. The rows sit below the results, with one fixed-height line above them (TAGGED CATALOGUE: 26+ BELOW. [ GO ]), so they arrive without moving anything. A search is read as the longest words it can be; every word must be on the row; what isn't a word has to be in the title. Only with SOURCE ALL, INTERNET ARCHIVE, PEERTUBE or OPENVERSE, and no `from:`. A row an outside site has already found isn't repeated, unless it's already on the screen.
- **The DISCOVER filter leads with the catalogue (`picks.ts`):** what the reader has shown they like, then old and obscure finds, with a maker's further items costing more each. With no taste it browses whatever a few files hold. RECOMMENDED keeps people's picks and the recent feed first. Under any SORT, DISCOVER leads with the catalogue and RECOMMENDED with the feed.
- **Junk titles and no-player rows sink (`title-quality.ts`).** A number alone, a machine's id, a camera's file name, "untitled": about 1.7% of 27,000 real titles sampled. They go last in every list under every SORT and aren't deleted: a word still reaches them. Rows with no player come just before them.
- **Any word can be chosen on the DISCOVER page.** The map shows 2,000 words; the search box and the filter's ADD A WORD box offer any other as LOOK IN THE CATALOGUE, and the page looks it up before saying NO SUCH WORD. In the filter it can be MUST or ANY, not NOT: a list's rows only carry the map's words and the ones asked for, so an exclusion would quietly let through everything that has it. Measured live: legal case, added as a must-have, first rows 1.3 s after the press and all 183 by pressing on; beekeeping 3.9 s; ottoman era 1.3 s; maritime law and zzqqxv say NO SUCH WORD.
- **A word's count says how much of it is found (`wordItemsLine`).** Everywhere the page said ON 19194 ITEMS (a word's facts, the list of words, the most used words) it now says ON 19194 ITEMS · 105 FOUND SO FAR, then ALL FOUND, or 181 FOUND, ALL FILES READ if the files run out short. FOUND is what this page holds for the word, whatever the filters leave. It isn't a promise that every item can be reached: all of a word has only been proven for rare ones (175 of 175, 183 of 183). The search box's offers (WORD · 19194 ITEMS) and the map's spoken labels keep the plain count.
- **What's on the screen stays put.** A press pins the rows it brings into view, and what arrives comes after them (`keepShownFirst`).

**Measured live, signed in, jobs off.** Before is one ask of the old route; the reader's page showed fewer (Luke's main session measured jazz 19, film noir 10, ottoman era 5).
| Word | On items | Files holding it | Before, one ask | After, by the route |
|---|---|---|---|---|
| jazz | 19,192 | 748 | 56 | 535 in 10 steps (30 files), and more to read |
| film noir | 2,902 | 327 | 31 | 305 in 10 steps (56 files), and more to read |
| ottoman era | 175 | 109 | 5, none showing the word | all 175, in 19 steps |
| legal case | 183 | 87 | 4, none showing the word; NO SUCH WORD on the page | all 183, in 15 steps |

- **Speed:** a step takes about 1 to 1.3 s (median), slowest 3.8 s. MEDIA's DISCOVER opens in about 3.5 s and RECOMMENDED in about 1.9 s; they now wait for the first step instead of drawing and then reordering, so they open a little later than the map alone (1 to 2.5 s). In MEDIA search the first outside result came at 0.4 to 1 s and the tagged answer at 1.1 to 4.3 s. The first result moved 0 times in the last 5 searches measured. It moved 24 pixels in 2 of an earlier 3, cause not found, possibly a line that was there before this work.
- **Load, per reader, at about 83 KB a file:** opening DISCOVER or RECOMMENDED 4 files, 330 KB, and about 12 presses before more are needed. A MEDIA search at most 4 files, 330 KB. A press on a rare word 6 files, 500 KB; a whole rare word such as ottoman era 109 files, 9 MB. The server keeps the last 40 files and each word's file list for 10 minutes. Database: one read of the word table and one or two of the file list per word, about 0.15 s. The free plan's 5 GB of downloads a month is about 15,000 searches or list openings, if nothing were held. The account's actual use isn't visible from here: Luke's dashboard has it.

**Still short of what's tagged:**
- A common word is reachable but slowly: all of jazz would be about 748 files, 62 MB, for one reader pressing a very long time.
- A word off the map can't be excluded, and a NOT in an old link for such a word does nothing.
- The map's 2,000 words are the top 1,000 and whatever its sample carries, so a word on 1 item can be on the map while a word on 7,000 isn't.
- The map is 4 MB before compression for each reader on each visit, from Vercel, not Supabase.

## Where this stood (2026-11-06, the ramp)
**Live on main:** the rename to DISCOVER at `/discover`, `[ RECOMMEND ]`, MEDIA's RECOMMENDED and DISCOVER filters (blank until 10,000 are tagged), presets, and the sweep.

**The ramp (Luke, 2026-11-06: "ramp up the tagigng batches massively"):** `web-sweep` every 2 minutes, one run at a time (`web_sweep_claim`), up to 5 batches out. Before a batch goes
out its worst case is reserved in `web_sweep_batches`, all at once in the database (`web_sweep_reserve`), against $59.40, leaving $0.60 for the tagging job and the word pass; all three read
`web_tag_committed`, so what's in flight can't pass the $60. Measured: 3.3 cents per 1,000 items.

**Sources:** the named collections first, then everything public on the Internet Archive (Luke, 2026-11-06, "Everything public"), 74 million items, skipping adult-flagged, restricted and dark ones. The $60
reaches about 2% of it, and the Archive lists by name, so it takes turns through first letters and what gets tagged is a spread. Copied items and junk can get through: the rows link to the Archive and nothing is
copied here. PeerTube goes back by date past Sepia's 9,000-row limit.

**Past the database limit (Luke, 2026-11-06: "find a way around the database limit"):** compressed files in Supabase Storage, the private bucket `web-pool` (`app/lib/web/pool-files.ts`): about 43 bytes an
Archive item and 84 a PeerTube one, against about 520 for a database row. `web_pool_shards` lists which words are in which file, so a list reads the few files holding its words
(`/api/tag-station/more`). Only a sample of each batch stays as rows. The stops still in code: 300 MB of database, because the plan goes read-only at 500 and the whole site needs it, and 800 MB of the 1 GB of files.

**Bulk public dumps: looked at, and not needed to reach $60.** Wikidata's dump is 157 GB compressed, Wikipedia's 26 GB, Open Library's 17 GB. The APIs already supply far more items than $60 can tag, so a
local job would add days of download and a Claude key on the PC without tagging one item sooner. Worth coming back to if more money is ever spent on this.

**Known and left:**
- `check-privacy-defaults` fails on a checkout with CRLF line endings, because it compares whole lines. It isn't caused by this work.
- `check-visitor-limits` needs the database settings in `.env.local`, and passes with them.
- Wikidata has no ordering in its paged list, so a run can skip or repeat a film; repeats are filtered, skips are lost. Wikipedia's words reach Claude under CC BY-SA, a question for a lawyer.
## What was built for recommending, the filters and presets
- `web_recommendations` holds only a person, a platform and an id; the row itself comes from the saved stream, because `web_recommend_set` also asks for the item
  to be saved through `web_request_add`. So it can take up to an hour for a search result's recommendation to show.
- `[ RECOMMEND ]` isn't on KINO or media-server rows: their text is TMDB's. To plan for: a KINO title matched through Wikidata's TMDB number
  (`web_pool_items.tmdb_ref`) could be recommended from Wikidata's facts.
- RECOMMENDED and DISCOVER are keys above SOURCE on MEDIA, `?list=recommended` and `?list=discover`. POPULAR on them means how common an item's words are on this site.
- Presets: `discover_presets`, the settings being the page's address query, read back through the same checks. The active one is what DISCOVER applies.

## Rules for building
- Every database change goes to the main session first in plain English, for Luke's OK. Only the job can write pool tables.
- Mock and Supabase stores both, with checks that fail before the fix. Whole `npm run checks`, code review, live proof.
- Never read out or log the key, or an error's message or stack in code that loads it.
