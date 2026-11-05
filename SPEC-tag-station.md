# TAG STATION (Luke, 2026-11-05)

Renamed DISCOVER at `/discover` the same day (SPEC-discover.md); `/tag-station` redirects there for good. The code keeps the name:
`app/lib/tag-station/`, `app/components/TagStation*`, `/api/tag-station/*`, the `tagstation` nav key and the checks.

A map of the words on MEDIA's saved items, in the spirit of a map of genres you can wander: pick something, see the words
around it, walk outward. The research and the plan are Luke's doc "Tag Station - research & build plan".

## What Luke asked for
- A page at `/tag-station`, signed-in only like MEDIA, with one header key.
- Any media in: pick a word, pick a saved item, or paste a link.
- A map drawn as real text (browser zoom, keyboard and screen readers all work), with a list view that does everything
  the map does, because Luke has very poor eyesight.
- Filters written as a recipe: must have, any of, exclude, how strict, how obscure, how far out. Every search is a link.

## The scoped exception
SPEC-media-picks.md says Claude's words "only ever order a list. They are never shown." On 2026-11-05 Luke asked for Tag
Station to show them. That exception is this page only: MEDIA stays exactly as it was, and nothing on MEDIA shows a word.
A word is marked with where it came from: `C` Claude's, `P` the platform's own, `L` from a pasted link's outside source.

## The data, and what there is of it
- The page only reads: `web_items`, `web_item_tags` (Claude's 3 to 8 lower-case words per item), each item's own `tags`
  (`WebItem.tags`), and the tagged results in `web_seen_items` (below). Mock and Supabase repositories, the usual switch
  (`NEXT_PUBLIC_WEB_DATA_SOURCE`).
- On 2026-11-05: 161 items, all tagged, 979 words in all, 498 different words. No saved row has platform tags yet, so the
  `P` source is empty in practice until the ingest keeps some. Most words sit on one item, so the map starts thin. It gets
  better by itself as the three-hourly job tags more.
- `web_item_tags` is readable by signed-in people only, so the server reads it with the reader's own session token and
  the route refuses anyone without one. The built map is kept in the server's memory for an hour, because the words only
  change every three hours.
- Metadata only (CLAUDE.md): the counts on this page are how many of **the items we've saved or shown** carry a word. No platform's
  likes, views or ratings are read, kept or shown.

## How the map is worked out (`app/lib/tag-station/`)
- **One spelling:** "hip hop", "hip-hop" and "hiphop" are one word. Words are matched with their spaces and hyphens
  squeezed out, plus a short hand-written alias table; the commonest spelling is the one shown.
- **Closeness:** NPMI, a score from -1 to 1 for how much more often two words meet than chance. A pair only counts as
  close once it shares at least 3 items (`MIN_SHARED`); until then the page says how many items a pair shares rather than
  claiming closeness it can't back. Each word keeps its 30 closest partners.
- **Era** is spotted from the word itself ("1920s", "19th century"). Other types come from the word pass, below. There are no
  confidence scores: the tagger does not record them.
- **Layout:** UMAP (`umap-js`, MIT) with a fixed seed over each word's row of NPMI scores, so the same data always draws
  the same map. The same code runs in the route and in `npm run tags:build`, which runs it on the mock for checks.
  The doc says umap-js is Apache-2.0; the package itself says MIT, which is at least as free.

## The page
Three panels side by side, stacked when narrow.
- **Input (left):** the chosen word or item, a click-to-load player from MEDIA's own checked addresses, then its words as
  chips: press a word to go there, `[ + ]` to add it to the recipe.
- **Map or list (centre):** one switch, same data. The map centres on the choice, lights its words and draws dotted lines
  to its closest words. Zoomed out it shows fewer labels, biggest first, never smaller text. Text size S, M, L, XL is
  remembered per browser. No animation: the map snaps.
- **Neighbourhood (right):** related words with a reason, closest items, same mix different flavour, edge picks (the rarest
  close matches), and facts about the word (items, first and latest seen, partners).
- **Keyboard:** Tab into the map; arrows go to the nearest word that way; Enter picks; A adds to the recipe; plus and
  minus zoom; Escape goes back to the search box. Picking reads out the word and its three closest words; result counts
  are read out as they change.
- **Search box:** one box for words, item names and links, with typo-forgiving suggestions.

## Filters, all in the address
`/tag-station?tag=&item=&link=&must=&any=&not=&strict=&niche=&near=&src=&era=&facet=&kind=&site=&from=&to=&sort=&view=`
- `must`, `any`, `not` (each may repeat); `strict` all, most or any of the must-haves; `niche` mainstream to obscure;
  `near` near, wider, far; `src` Claude's words, the platform's or both; `era`; `facet` (word type, once the word pass has
  answered); `kind` and `site` (type and source);
  `from` and `to` (years); `sort` closest, rarest, newest, most words.
- An empty or tiny result says which filter to loosen and how many more it would find.

## Paste a link
- The server never fetches the pasted address. As on MEDIA (`app/lib/web/search/link.ts`), it reads the platform and id out
  of it and asks that platform's own API, through `safe-fetch`.
- MusicBrainz (one request a second, descriptive agent) gives outside words where it knows the address. The Internet
  Archive's own subjects come with the item.
- Outside words are matched to our words through the alias rules. A match places the link on the map; anything else is
  listed as SUGGESTED and is not added anywhere.
- **Nothing is saved** and the link does not go to the batch tagger. A link already saved on the site is treated as that
  saved item.

## Batch work (Luke, 2026-11-05: "as much batch api processes as possible")
Tag Station itself makes **no Claude calls of any kind**, live or batched: it only reads the words the existing batch already
saved. A pasted link gets outside words and title matches at once, and never waits on Claude. Anything further below runs
through the deployed server and cron like `app/lib/web/tagging.ts`, because the key is only in Vercel (Production), so nothing
can be spent until this branch is on `main`, and each needs a database change, so each waits for Luke's OK.

Prices: Haiku 5.5 in a batch is $0.05 in and $0.25 out per million tokens. The costs are estimates from the last real batch
(161 items: 83,553 in, 5,461 out, about half a cent).
1. **The word pass (Luke: "lets build it next", 2026-11-05).** `app/lib/web/word-pass.ts`, run by `/api/web/tag` after the tagging.
   Claude reads the list of different words, not the items, and says for each: its type (genre, mood, place, era, form, subject),
   which other word it means exactly the same as, and whether it's too vague to mean anything ("video"). Helps most because 368 of
   the 494 words sit on one item, and joining true duplicates gives pairs enough shared items to count as close. Each word is
   asked once, up to three tries. First run about a cent or less; capped at 1,000 new words a run, so at most about 11 cents a day
   even if words arrived at that rate, which they won't. One new table, `web_word_facts`. It counts towards the $60 stop.
   **Nothing is rewritten:** `web_item_tags` isn't touched and MEDIA reads the same words. The answers are applied only when the map is
   built (`app/lib/tag-station/word-facts.ts`), so a bad merge is one row to change. Joined spellings still find their word. A
   group is capped at 6 words, so a run of bad joins can't swallow the map. Letters on the chips: G genre, M mood, W place, E era, F
   form, S subject.
2. **Confidence per word (later).** Asks again for each item's words with a score. Rough cost about a cent per 161 items, capped
   by the existing 200 items a run. Helps the strictness setting a little; less than (1), and it changes MEDIA's tagging job.
3. **Pasted links through the batch (later).** A link is shown at once with what's known, and Claude's words arrive within three
   hours. Means saving pasted links, which this build promises not to do, so it's Luke's call.

## Tagging everything anyone sees in MEDIA (Luke, 2026-11-05; his OK: "Yes, tables and live")
Luke's decision: every saved item plus every search result that appears for anyone, tagged in the next batch, up to $60 in all
without asking again. Not a sweep of whole catalogues. Live only once this branch is on `main`.

**How a result gets in, safely.** MEDIA's "save opened items" already solves this (`web_request_add`): the browser may only name
a platform and an id, never send text. The search route names what it just returned, using the reader's own session. The
three-hourly job then reads each item's title, creator and description from the platform's own API, so no one can feed text
into a paid batch. No new secret or key is needed from Luke.

**The change (three new tables; nothing existing is altered):**
- `web_seen_items`: one row per result seen. Platform, id, type, title, creator, Claude's words, batch bookkeeping, dates. Signed-in
  people can read the words and names. No search words and no record of who saw it. The description is sent to Claude and not kept.
  It is not `web_items`, so nothing joins the MEDIA stream.
- `web_seen_caps`: how many results each person's searches named today, and nothing about which. Unreadable through the API.
- `web_tag_spend`: tokens and dollars per batch. Unreadable through the API except the total, through the job's lock.

**The limits, enforced in code:** a person's searches name at most 500 results a day and the whole site 5,000 (a database lock
stops calls made together slipping past either). Items already
tagged are never sent again. The batch size goes from 200 to 1,000 a run, because 200 could fall behind. Before sending, the job
adds what's been spent to the worst case of the next batch (cut to 300 output tokens an item), and sends nothing if that passes
$60. It then stops and the run's answer says so.

**Cost:** about $0.035 per 1,000 items at the last batch's rate (519 in and 34 out per item, batch prices). The site-wide cap of
5,000 a day is about $0.17 a day, so $60 lasts about a year at the very most. Real cost is reported after the first run.

**On the map:** a result nobody saved counts towards the words and shows in the lists, marked with its source, with
`[ FIND IN MEDIA ]` instead of a player, because the table keeps no address for it. The map reads the newest 1,000 of each kind of
row (PostgREST's cap on one answer); past that, the oldest drop off the map.

**Still not covered:** results nobody has seen; KINO's films and shows (TMDB's titles can't be read back by id, so the job would have
nothing to send); DEBASER.SITE's own files (they stay in the browser); linked YouTube lists (they
stay in the browser by design); media-server titles (friends' private lists, not sent to Claude without Luke's say-so); results
a platform won't answer about when asked again; and a little less to go on for YouTube and Vimeo, whose keyless answers often
have no description (the YouTube key isn't used here on purpose: thousands of reads would spend the quota MEDIA's searches need).

## Out of scope for now (each needs Luke's OK)
Database tables for tags, running the tagger on pasted links, YouTube and Discogs keys, Last.fm, number dials and
readable axes, plain-English search, saved searches, listening data, sound-based tagging. Forum posts and lore pages are
not tagged and are not on the map.

## Handoff
What's on the live site: everything above but confidence scores and pasted links through the batch.
- **Proof:** `npm run checks -- --only check-tag-station` runs the five checks; each was proved able to fail by breaking the code.
- **First real batch:** read the `web-tag` cron's answers and `web_tag_spend`. Report the real cost per item to Luke.
- **Watch:** when `web_seen_items` passes 1,000 tagged rows the map only reads the newest 1,000.
- **Not done (each needs Luke's OK):** confidence scores, pasted links through the batch.
