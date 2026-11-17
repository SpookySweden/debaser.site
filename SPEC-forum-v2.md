# SPEC: Forum v2, the board's keys working together (2026-11-17)

Luke: "feed gallery and streams buttons in the forum dont seem to interact well, i need you to conduct some experiments
and use all the context you can get to conduct some interviews with me regarding the best possible imrpovements to the
forum". Interviewed in the FORUMUX session, three rounds. Built in small steps, each its own commit, live and verified.

## What the experiments found (local mock board, every combination pressed; full list: FORUMUX `forumux-findings.md`)
- FEED / GALLERY / [ STREAMS ] look like one row of three tabs, but two are a view and one is a filter, so two keys are
  often lit at once (GALLERY + STREAMS). GALLERY + STREAMS shows "NO PICTURES MATCH." almost always; a tag + STREAMS shows
  "NO THREADS MATCH." with no reason (stream records carry no tags).
- STREAMS is also an option in SORT's FILTER SOURCE: two handles on one setting. Turning STREAMS off forgets the source
  picked before it. SOURCE > BOARD THREADS showed 18 posts where ALL showed 14 (it brought back the hidden records).
- Only the sort reaches the address. View, STREAMS and tags are lost on reload, Back leaves the forum, and the top bar's
  undo arrows don't step through them (MEDIA's view and filters do, `data-undo-picks`).
- Fixed already, live in 7f6a5fa: a gallery tile's [ OPEN ] landed on the wrong feed page; a post filed from GALLERY
  vanished.

## Luke's answers
1A. One row of three tabs, exactly one lit: [ FEED ] [ GALLERY ] [ STREAMS ]. STREAMS is a view of its own: the list of
    stream records. FILTER SOURCE no longer offers STREAMS.
2A. The board remembers the view, the tags (and the match mode) in this browser, like the sort, and writes them into the
    address. Back and the top bar's undo arrow step through view and tag changes.
3A. A closed stream record's row says what happened on its one line: who hosted, how many videos, how long (e.g.
    `HOSTED BY BRAVO · 3 VIDEOS · 40 MIN`), with [ ▶ WATCH ] while it is live.
4A. FILTER SOURCE > BOARD THREADS hides unanswered stream records too, as ALL does.
5B. The moving reply line beside a closed post keeps moving, but is never cut off at the board's right edge.
6A. GALLERY tiles smaller: 4 across where the board is wide enough, and the gallery's own page size of 12.
7C. The post's own [ REPLY ] stays at the bottom of an open post: "best at the bottom so you read the thing/thread and
    then get the chance to reply". Each reply keeps its own [ REPLY ].
8A. NEWSWIRE: pinned posts first, then the newest posts and replies; a [ ❚❚ ] key stops and starts the crawl; a reply's
    row opens that reply (`#comment-<id>`), not just its post (the gap in HANDOFF.md).
9B. A count of what's new on the FEED tab: `[ FEED · 3 NEW ]`. No divider line in the list.
10A. (typed "10z", read as A; say if not.) The tag panel becomes [ FILTER ▾ ]: tags, match mode, and FILTER SOURCE.
    [ SORT ▾ ] holds only the sort and its time frame.
11A. An empty board says which filters emptied it, with a key to clear them: `NOTHING TAGGED LORE IN GALLERY.`
    `[ CLEAR TAGS ]`, `NO PICTURES FROM PROFILE COMMENTS.` `[ ALL SOURCES ]`.
12A. On STREAMS, picked tags are set aside, not cleared: their chips show greyed with `TAGS DON'T APPLY TO STREAMS`, and
    they apply again on FEED or GALLERY.
13. Tidy-ups: posts and tiles with no tags say nothing (no `NO TAGS`); the composer's big Rose `NONE` square becomes a
    quiet `NO PICTURE` box in the field inks; the composer's `theme:` `warn:` `user:` labels in capitals.
14A. Out of this SPEC: the MADE THIS posts, YOUR DESK, one search box for the whole site. Luke: "make sure we continue to
    follow up with the entire rest of the vision" (see "Next interviews" at the end).
15. Nothing else he dislikes.

## Defaults taken while writing (tell Luke if any change)
- Address: `/forum?view=gallery`, `?view=streams`, `&tags=lore,art`, `&match=all`; FEED and ANY are the default and not
  written. A link's address wins over this browser's memory (as the sort does). Remembered under one key,
  `debaser.forum.board.v1`. FILTER SOURCE, the page and the per-page size stay unremembered (a reader comes back to
  page 1 of their view).
- History: a view or tag change pushes one history step (`window.history.pushState`, Next's own state handed back, as
  `writeSortToAddress` does with `replaceState`); Back and Forward re-read the address. The tabs and the tag chips are
  marked `data-undo-picks="VIEW"` / `"TAGS"` so the undo arrows step through them. Read
  `node_modules/next/dist/docs/` on the router and `pushState` before building (this Next has breaking changes).
- `· n NEW`: posts on the main board drawn unread by the board's own read marks (`app/lib/forum/read-state.ts`) and
  active in the last 7 days, never counting the reader's own. Shown only once the reader has read something (a first
  visit with no marks shows no count, rather than "every post is new"); `9+` past nine. Counts are of posts, not of
  engagement, so this is not a like or view count.
- Gallery page sizes: 12 by default, choices 8 / 12 / 24 / 48; the feed keeps its own (fits the screen, choices 5-50).
  Switching view goes to page 1.
- NEWSWIRE: pinned, then the newest 12 posts and replies from the main board (no unanswered stream records); paused
  under `prefers-reduced-motion` with the key showing `[ ▶ ]`; the pause is remembered in this browser.
- Stream record row: one batched read of the page's records (plays counted, first and last moment, live or not), never a
  room feed per row: the room's own feed is still only followed while it is live (`StreamMarker`). Ended streams'
  numbers can be kept for the visit. Both repositories (mock and Supabase). It is a read, no database change; if the
  numbers can't be had without one, stop and ask.

## The plan, in steps (each: one commit, `npm run verify`, `checks:changed`, live, `npm run read`)
1. **Tabs, address, memory, history (1A, 2A, 12A).** `BoardView` gains `streams`; the [ STREAMS ] key becomes the third
   tab; `SourceFilter` loses `stream` (FILTER SOURCE no longer lists it; a search's `in:streams` and a `#thread-` link to
   an unanswered record switch to the STREAMS tab instead). Tags set aside on STREAMS. Address, memory, pushState,
   Back/Forward, undo marks. `jumpToPost` and filing a post choose the tab that holds the post.
2. **FILTER ▾ and SORT ▾ (10A, 4A).** FILTER SOURCE moves into the tag panel (renamed `[ FILTER ▾ ]`, the key shows
   how many filters are on: `[ FILTER · 2 ▾ ]`); SORT keeps the sort. BOARD THREADS hides unanswered records
   (`Temp/check-watch.cjs` line 162 updated on purpose: it was written before 4A).
3. **Empty states (11A).** The empty line names what emptied it and offers the key that clears it.
4. **GALLERY (6A).** Tiles 4 across where the board is wide (a container query on the board's own width, not the
   screen's), the gallery's own page size.
5. **Stream rows (3A).** The one-line summary and [ ▶ WATCH ] while live, from one batched read per page.
6. **Reply line and NEWSWIRE (5B, 8A).** The crawl beside a closed post is never clipped at the right; the wire carries
   pinned then newest, with [ ❚❚ ]; reply rows open the reply.
7. **NEW count (9B).** `[ FEED · n NEW ]`.
8. **Tidy-ups (13).**

## How done is proven
- A drive on a local mock server (`scripts/drive-forum-v2.cjs`, built from FORUMUX's `Temp/browse/drive-forumux.cjs`):
  every press order of the three tabs leaves exactly one lit; reload and a copied address bring the view and tags back;
  Back steps through them; undo arrows do too; tags set aside on STREAMS come back; empty lines name their filters;
  GALLERY 4 across at 1440 with 12 tiles; BOARD THREADS = ALL's count plus nothing hidden; stream rows show their
  summary; the crawl's right end is inside the board; NEWSWIRE carries a reply row that opens the reply; the NEW count
  goes down when a post is opened. Each step's assertions seen failing on the old code first.
- `Temp/check-forum-v2.cjs` for the pure parts (address read/write, NEW count, wire rows, BOARD THREADS).
- `npm run verify`, `npm run checks:changed` (and a full `npm run checks` once, it is a SPEC), `npm run capture` +
  `npm run audit` for the visual steps, screenshots at 1440 in a dark and a bright theme read by the builder, one look at
  390 wide for no sideways scroll. Live: `npm run deploy-status`, `npm run read` only. No live drive should be needed.

## Out of scope
- No database change expected (step 5 is a read; stop and ask if it turns out otherwise).
- No phone-specific layout (desktop first). No change to text size (Luke's 2C).
- The MADE THIS posts, YOUR DESK, site-wide search (14A: their own interviews).

## Next interviews (Luke: "continue to follow up with the entire rest of the vision")
From `docs/site-review-2026-11.md`, in the order the review ranked them, each its own interview and SPEC:
1. MADE THIS posts on the board, with a `[ MADE ▾ ]` filter (review top-ten 3).
2. YOUR DESK, a home page that's yours (top-ten 6).
3. One search box for the whole site, and TALKED ABOUT IN lines (links section).
4. The board's filters following the account across devices (personalisation, "Remembered filters").
