# SPEC: WEB search sorting

Luke's brief, 2026-11-02: "ways to sort the results ... 'popularity' 'date' etc and a reversable option next
to this that lets you turn date into oldest - newest". Then: "i want real popularity and i also want real
oldest - newest ... without any compromises". Answers to the interview are below. Build in a fresh session.

## What the reader sees
- A **SORT:** row under SOURCE / TYPE / VIBE, the same keys: **BEST MATCH**, **POPULAR**, **DATE**.
- A **flip key** beside it (↓ / ↑). Only DATE flips (newest-first or oldest-first). On BEST MATCH and
  POPULAR it is shown greyed and disabled with an accessible name saying why. No site gives a real
  "least popular" order (YouTube has none), and a reversed best match isn't useful.
- Default: DATE ↓ (newest first), as today. The address carries it: `?sort=popular`, `?sort=date&dir=asc`.
  Typed in the box the forum's way too (`sort:popular`, `sort:oldest`), like `in:` and `type:` (web-filters.ts).
- A site that can't give the chosen order is **not asked**, and one plain line says so
  ("COMMONS: NO POPULARITY ORDER"), in the same place as the existing problem lines. Never a wrong order.

## Rule change (Luke, 2026-11-02)
Add to the WEB rules in CLAUDE.md and SPEC-web.md: a platform's own popularity order may be **asked for**, and
TMDB's rating may be **used to order** KINO titles. Counts and ratings are still never shown, never saved, and
never sent to the browser: they stay on the server and decide order only.

## Per site (each one tested live, 2026-11-02, except where marked)
| Site | POPULAR | DATE newest / oldest |
|---|---|---|
| Internet Archive | `sort[]=downloads desc` ✔ | `sort[]=publicdate desc` / `asc` ✔ (items are dated by publicdate) |
| PeerTube (Sepia Search) | `sort=-views` ✔ | `sort=-publishedAt` / `publishedAt` ✔ |
| YouTube (InnerTube) | `params=CAMSAhAB` (sort by views, videos only) ✔ | **No date sort exists any more** (YouTube's "upload date" param now returns relevance order: tested). Use date windows (below) ✔ |
| Wikimedia Commons | hidden (Luke) | `gsrsort=create_timestamp_desc` / `_asc` ✔. Date each file by its **first** upload (imageinfo `iilimit` > 1, oldest entry), so the shown date matches the order |
| Openverse | hidden (Luke) | `sort_by=indexed_on&sort_dir=asc/desc` **not yet verified** (the API timed out on 2026-11-02). Verify first. If it doesn't exist, Openverse is not asked for DATE and says so |
| KINO (TMDB) | by **rating** (Luke): TMDB search can't sort, so read all result pages server-side and order by `vote_average`, titles under 50 votes after the rest (a 10/10 from one vote is noise) | same: all pages, ordered by `release_date` / `first_air_date` |
| Saved stream (database) | hidden (no counts are kept) | `published_at` desc / asc, in **both** repositories (mock and Supabase) |
| Media servers | ordered with KINO by their TMDB rating where the title has a TMDB match; otherwise hidden | `published_at` desc / asc |

KINO reads at most 25 pages (500 titles) per search. If a search has more, one line says "SORTED THE FIRST 500
MATCHES". That is the only cap. TMDB answers in well under a second per page, pages read in parallel, cached a day.

## YouTube by date (the hard one)
YouTube's search accepts `after:YYYY-MM-DD before:YYYY-MM-DD` in the words (tested: a 2006 window returned only
"20 years ago" videos). Within a window the order is relevance, so a window is only used once it is **small enough
to read completely**:
1. Ask every year from 2005 to now at once (about 22 free InnerTube requests, first page only) to see which years
   have results.
2. From the newest (or oldest) year with results, split into months, then days, until a window ends within
   2 pages. Read it whole, order it, show it. The search cursor remembers where the next window starts.
3. Exact time within a day: if `YOUTUBE_API_KEY` is set on Vercel, one `videos.list` call per 50 videos
   (1 quota unit, tiny) gives the exact upload time. Without the key, recent videos order by "N hours ago" and
   older same-day videos by id. That's exact to the day.
4. Risk, said once: these operators are undocumented. If YouTube stops honouring them (a window returns
   videos outside it), YouTube is not asked for DATE and its line says "YOUTUBE: CAN'T SORT BY DATE".

## Mixing sites
- **DATE**: one true order across every site. The merge **holds back** any result that a site's *next* page could
  still beat, and fetches that site's next page by itself. So nothing shown is ever later overtaken, and LOAD MORE
  continues in order. Today's "newest first" only re-sorts each site's relevance page, so this is a real change.
- **POPULAR** and **BEST MATCH**: take turns (Luke). One from each site in its own order, round-robin,
  so no site's numbers are ever compared with another's. KINO and media servers join the turns when asked.
- Live arrivals: the existing rules in live-merge.ts still hold (nothing moves under the reader once they scroll;
  the "N MORE RESULTS" key), applied in the chosen order instead of always newest first.

## Out of scope
TITLE / LENGTH sorts, sorting the plain stream (no search words), and showing any count or rating.

## Proof
- `scripts/check-web-sort.cjs` (tracked, in `checks:web`): each provider's URL for each order, the take-turns
  merge, the date hold-back merge (a later page with an older item must not jump ahead of shown ones), the
  YouTube window splitter on a fake fetch, KINO's vote floor, and that no count or rating reaches the route's
  answer. Prove it fails against the unsorted code first.
- Update check-web-live-merge and check-web-filters on purpose for the new `sort:` word and ordering.
- `npm run verify`, capture + audit, push, deploy-status, `npm run read -- --url /web`. Then screenshots at desktop
  and phone width of a real search ("night of the living dead") in DATE ↓, DATE ↑ and POPULAR, signed in as
  TEST ACCOUNT A.
- No database changes.

## Build notes (2026-11-02, found while building; the code follows these)
- **Openverse**: the parameters are `unstable__sort_by=indexed_on` and `unstable__sort_dir=asc|desc` (from the API's
  own published description, api.openverse.org/v1/schema/; the API itself still timed out with 504s all day, so no
  sorted answer was seen). "unstable" is Openverse's word: an answer that comes back out of date order shows
  "OPENVERSE: CAN'T SORT BY DATE" instead.
- **YouTube windows**: `after:D before:D+1` is exactly day D in Pacific time (checked against real upload times).
  `after:D before:D` is ignored and answers everything, so it is never sent. YouTube slips a few of the last days'
  videos (and, in thin answers, a few unrelated older ones) into any window: those are dropped, and only an answer
  of 8+ older videos mostly outside its window counts as "not honoured". Past its first pages a window matches very
  loosely (LitRPG audiobooks for "night of the living dead"), so a dated YouTube video must have every searched word
  in its title, channel or description (the saved stream's rule). A sparse window is cut into 8 rather than every
  day; one answer stops after about 9s and LOAD MORE carries on from the next day. A day is read up to 8 pages.
- **KINO by date**: a title with no release date has no place in a date order, so DATE leaves it out (it would
  show as "today" at the top). BEST MATCH and POPULAR still list it.
- **N MORE RESULTS**: still puts the held rows at the top, in the chosen order among themselves.
- **Live arrivals by date**: rows shown before a slower site answered go back to waiting if that site's next page
  could beat them, but only until the reader scrolls or presses anything.
- **Related sections** under the results keep each site's best match, newest first, as before the SORT row.
