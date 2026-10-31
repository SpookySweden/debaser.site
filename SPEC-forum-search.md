# Forum: HOT sort and Discord-style search

Interview with Luke, 2026-10-31. Everything else on the board stays as it is (tag chips, source filter,
music/gallery views, pins panel). This replaces the current `NEWEST FIRST / MOST REPLIES / BY TAG` sort and
the plain `SEARCH:` box in `[ SORT / SEARCH ]` (app/components/ForumBoard.tsx).

## Part 1: sorting

### What Luke sees
- Sort choices: `HOT` (the default), `NEW`, `TOP`, `MOST REPLIES`, `TITLE A-Z`. The existing `BY TAG`
  (rank by how many chosen tags a post has) stays while tag chips are picked.
- When `TOP` is picked, a time frame row appears: `PAST HOUR / TODAY / THIS WEEK / THIS MONTH / THIS YEAR /
  ALL TIME` (Reddit's list). Default `THIS WEEK`. No time frame on any other sort (Reddit's hot has none).
- Pinned posts stay above everything whatever the sort, like Reddit's stickied posts (current
  `sortThreadsPinnedFirst` behaviour). Search results ignore pins.
- The choice is remembered in this browser AND written into the address (e.g. `/forum?sort=top&t=week`), so a
  shared link opens with the same sort. Address wins over the remembered choice. A visitor with neither gets HOT.

### How each sort ranks
- `HOT`: replies + age, no upvotes (the forum has none; Luke chose not to add them now). Reddit's shape:
  a score from activity, plus a bonus for being new, so a post with lots of recent replies rises and then
  fades as it ages. Final formula (as built, `hotScore` in app/lib/forum/board-sort.ts):
  `log10(max(1, otherReplies + 2*distinctRepliers)) + createdAtSeconds / 45000`, where `otherReplies` is
  every reply not written by the person the post is credited to (`postCredit`), `distinctRepliers` is how
  many different people wrote those, and the 45000s (12.5h) constant is Reddit's. "Recent" works through
  the post's own age, as on Reddit, so no reply is timed separately. Replies by the post's own author don't
  count, so nobody can bump their own post by talking to themselves. Ties: newest first.
- `NEW`: newest post first (today's NEWEST FIRST).
- `TOP`: most different people who replied inside the time frame (one long back-and-forth between two
  people doesn't win). Like Reddit, TOP only lists posts *created* inside the time frame. As with HOT, the
  post's own author is not counted among the people. Ties: more replies, then newest.
- `MOST REPLIES`: raw reply count, all time (today's behaviour).
- `TITLE A-Z`: by the title as shown (`displayTitle`), case-insensitive, numbers before letters.

## Part 2: search

Copies Discord's search *behaviour*, drawn in the DEBASER_OS look (tokens, fonts, Win95 chrome) - not
Discord's colours or icons.

### The box
- Typing gives an autofill list under the box, like Discord. Empty box: a `SEARCH OPTIONS` list of every filter
  with a one-line example (`from: user`, `has: mp3, image, video or link` ...) followed by `RECENT SEARCHES`.
- Picking a filter writes it into the box (`from:`) and the list switches to that filter's suggestions,
  narrowed as you type.
- A finished filter turns into a pill inside the box (`FROM: shade ×`). Backspace at a pill removes it whole;
  clicking `×` removes it. Free words stay as plain text.
- Keyboard: Up/Down move through suggestions, Enter or Tab picks, Enter on a finished search runs it, Esc
  closes the list (a second Esc clears the box), like Discord.
- Recent searches: the last 5 run, kept in this browser only, each with a remove `×`; a `CLEAR` link.
- Several filters combine as AND. The same filter twice (`from:a from:b`) means either (OR), as in Discord.

### Filters
| Filter | Matches | Suggestions |
|---|---|---|
| `from:` | posts/replies written by that account (the credit the post shows, `postCredit`) | account names that appear on the board, plus the directory |
| `mentions:` | posts/replies whose words @ that account (`mentionTokens`) | same list |
| `has:` | `mp3` (a track filed), `image` (artwork attached), `video` (stream records and video links in the words), `link` (any http link in the words) | the four words |
| `before:` / `after:` / `during:` | posted before / after / on that day | a small month calendar, like Discord; also typed `2026-10-31` |
| `in:` | where it's filed: `board`, `asset`, `text-box`, `profile`, `track`, `streams` | the list, with display names |
| `tag:` | post or reply wears that tag (same matching as the tag chips) | tags from the tag vocabulary with counts |
| `pinned:` | `true` / `false` | the two words |

Free words match the title, body, filed-under label, tags and account names, as today. Note for the builder:
posts can't carry video files today, so `has:video` really only finds stream records and pasted video links -
say so in its suggestion line.

### Results
- Running a search opens a results panel (desktop: a column beside the board; phone: covers the board with a
  `[ ◂ BACK ]`), like Discord's. Header: `N RESULTS` and a sort `NEWEST / OLDEST / MOST RELEVANT`
  (Discord's three; default NEWEST).
- One row per matching post AND per matching reply - a hit in reply 40 is its own row. Row: author, date,
  the thread title (for a reply: `IN <thread title>`), a short excerpt with the matched words highlighted, and
  `♪` / picture marks when it has a track or artwork.
- Clicking a row opens that thread scrolled to that post or reply, which flashes briefly. The panel stays
  open so you can try the next result. Closing the panel (or clearing the box) returns the board to normal.
- Nothing found: `NO RESULTS` and a hint to remove a filter.
- Results are not paged until there are more than 25; then `[ MORE ]` at the bottom.

## Out of scope
- Upvotes or any new stored data. Both parts work on what the board already loads, so no database change or
  migration. (The whole board, 23 threads today, is read into the browser; if it ever grows to thousands this
  should move to a database search - a later job.)
- Searching comms, lore pages, the music library or /media. Forum only.
- `has:file`, `has:embed`, `has:sticker` and other Discord filters with no forum equivalent.

## How done is proven
- Pure tests (Temp/check-*.cjs) for every sort and every filter, including: an author's own replies don't
  raise HOT; TOP ignores posts older than the frame; two `from:` filters OR, two different filters AND; a hit
  in a reply makes its own result row. Each check shown failing before its code exists.
- Both repositories: nothing here reads storage, so mock and Supabase need no change; the builder confirms
  that and says so.
- Screenshots at desktop and phone width of: the sort menu with TOP's time frame, the empty-box options list,
  a pill, the calendar, and a results panel; a real drive of the keyboard (Up/Down/Enter/Esc/Backspace).
- `npm run verify`, `npm run checks`, capture + audit, pushed, `npm run read` shows `HOT` on the live /forum.

## Suggested build order (one commit each)
1. Sorts + time frame + remembered/linked choice.
2. Search parser and matching (filters, results as data), with checks; no new UI yet.
3. The box: autofill, pills, keyboard, recent searches, calendar.
4. The results panel and jump-to-reply.
