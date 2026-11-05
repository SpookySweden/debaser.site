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

## Rules for building
- Every database change goes to the main session first in plain English, for Luke's OK. Only the job can write pool tables.
- Mock and Supabase stores both, with checks that fail before the fix. Whole `npm run checks`, code review, live proof.
- Never read out or log the key, or an error's message or stack in code that loads it.
