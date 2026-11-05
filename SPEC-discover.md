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
- `[ RECOMMEND ]` on every MEDIA row, for signed-in people, as MEDIA is. It says plainly when it's on.
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
- **Not on the table:** extra free accounts or anything else that dodges a provider's limits or terms. If paid space is the
  honest answer, tell Luke the price and let him choose.

## Data rules from the sources' own terms (checked 2026-11-05)
- **Nothing from TMDB goes to Claude.** TMDB's API terms exclude use with machine-learning or AI applications, and exclude
  derivatives. So KINO titles and media-server details never enter tagging, the word pass, the sweep or the pool, and they
  aren't used as the basis of recommendations. As of today none has: `web_items` holds no `kino` or server rows. Add a check
  that fails if a platform carrying TMDB text can reach a batch.
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
- **Money:** $50 for the sweep, and the $60 stop overall. About 3.5 cents per 1,000 items, measured on the last real batch.
- **Wikipedia and TVmaze words:** they go to Claude and aren't stored or shown; the page's `[ ? ]` credits all three with links.
  CC BY-SA's share-alike may reach the words Claude picks, which is a question for a lawyer rather than something the code can settle.

## Where this stands (end of 2026-11-05, Luke's limit running out)
**Live on main:** the rename to DISCOVER at `/discover`, and the sweep (`/api/web/sweep`, cron `web-sweep` at minute 11 every three hours, tables in). Paid jobs that will run
overnight, all inside the stops: tagging at minute 41, the word pass, the sweep. At most about $1.40 a day for the sweep; it stops at $50, everything at $60.

**Not live, finished but unproved:** branch `feature/discover-recommending` holds `[ RECOMMEND ]`, MEDIA's RECOMMENDED and DISCOVER filters, presets, and DISCOVER's videos through
the floating player. Its migration `supabase/migrations/20261105153646_web_recommendations.sql` is **not applied**. Luke OK'd those tables. Still owed, in order: read that branch's code review
(a fresh review is cheap), run verify and the whole `npm run checks`, rebase on main, apply the migration, push, confirm live. `check-tag-station-picks` covers it.

**To check first tomorrow:**
1. First real costs: `web_tag_spend`, and the cron's answers in `net._http_response`. The 15:41 batch (257 items) is collected at 18:41 UTC, the first sweep (18:11) at 21:11.
   Tell Luke the real cost per thousand.
2. The word pass: at 15:41 its first call, `web_word_pending`, got a 500 from PostgREST with nothing in the database's logs, and the answer was `words: { failed: 'Error' }`, so it hasn't run. The function
   answers a wrong lock correctly. It tries again each run; `web_word_facts` having rows means it recovered. The branch above adds which call failed and its code to that answer.
3. Whether the sweep reads and sends as expected: its answer's `read` per source, `web_sweep_state`, and how long a run takes against Vercel's 60 seconds.

**Known and left:**
- DISCOVER's page draws a video in the page rather than through the floating player until the branch above lands (frontend.md's rule).
- `check-privacy-defaults` fails on a checkout with CRLF line endings, because it compares whole lines. It isn't caused by this work.
- `check-visitor-limits` needs the database settings in `.env.local`, and passes with them.
- Wikidata has no ordering in its paged list, so a run can skip or repeat a film; repeats are filtered, skips are lost. Wikipedia's words reach Claude under CC BY-SA, a question for a lawyer.

## Rules for building
- Every database change goes to the main session first in plain English, for Luke's OK. Only the job can write pool tables.
- Mock and Supabase stores both, with checks that fail before the fix. Whole `npm run checks`, code review, live proof.
- Never read out or log the key, or an error's message or stack in code that loads it.
