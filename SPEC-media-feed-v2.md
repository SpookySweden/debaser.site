# SPEC: MEDIA's default feed, version 2: a real ranking (FEEDALGO, 2026-11-17)

Status: **Luke said yes, 2026-11-17: "All A"** (relayed by the coordinator). Decisions 1A to 5A below, plus the five
fixes from the diagnosis. No database change; if one turns out to be needed, the build stops and asks.

## What Luke asked for
"currently getting some dumb videos like all the rainbow coloured videos here that i dont think have a reason to be
there, we need to create a significantly better algorithm taking into account all the factors we have access to and
that ive previously mentioned to serve relevant content to the user".

What he has said before (SPEC-recommender.md, SPEC-discover.md, SPEC-vanity.md, SPEC-media-feed.md): picks from
"anything available on the site based on the users interaction history", "the people you interact with most", "small
profile pictures of the people who are the reason it's there", "an informed combination of all available sources",
about 7 familiar to 3 new, steady through a day, NOT FOR ME, no numbers.

## Why his screen looked like that (phase 1; full notes: `feedalgo-diagnosis.md` in the notes folder)
All 12 rows came from the plain saved stream. Nothing came from his YouTube, the reading, DISCOVER or people's picks.
1. **Drawn too early.** The first screen is drawn after 2.5 seconds, whatever has arrived by then. The reading took 10.5
   seconds on a cold cache today. So his history wasn't used: a book he played last night and a Blender livestream he
   skipped were both on screen.
2. **Only the newest 50 saved items** are ever reordered for the first screen. So it is always the last fortnight's
   LibriVox, Hacker Public Radio, Linux Experiment and Blender.
3. **One creator hogs it.** The Linux Experiment makes up 29 of the 234 saved items. A small liking for it (from an
   earlier open in his browser, or his YouTube likes) puts all four of its newest videos at the top. Liking a creator
   is worth up to 20 points; showing the same creator again costs only 2.
4. **His plays teach nothing.** Most are science YouTube videos saved with no topic words, and their titles are never
   read.
5. **His YouTube subscriptions are old gaming channels** he doesn't play here, and they never appear in the stream.

## What Luke will see
**/media, nothing searched, signed in.** PICKED FOR YOU becomes one ranked list, still drawn 12 at a time, built from
everything the site knows about what he likes:
- **Things like what he plays here first.** A Quanta article or an arXiv paper about quantum physics, because he played
  Veritasium and the Organic Chemistry Tutor. A LibriVox history audiobook, because he played Mediaeval France. A
  Blender film, because he watched the Blender Open Movies making-of.
- **His people.** Something a close person recommended, queued in a stream room he was in, or put in a public letter
  (at most 2 a screen), with their small avatar.
- **New, near what he likes**: 3 a screen, from DISCOVER's catalogue or a source he hasn't tried.
- **Two reading rows a screen**, as now: papers, news, long reads, tech. They are chosen by his words, not by turn alone.
- **Variety.** At most one item per creator a screen, and at most 4 from one site. No Linux Experiment wall.
- **Gone:** anything he played, finished or skipped in the last 30 days, NOT FOR ME items, and creators he asked to see
  less of. Things shown on 3 different days and never opened rest for a week (as now).
- **A short "why" line under each row** (decision 4), in plain words and never a number:
  `BECAUSE YOU PLAYED COMPTON EFFECT`, `SWEDEN RECOMMENDED THIS` (with sweden's avatar), `QUEUED IN A ROOM YOU WATCHED`,
  `FROM A CHANNEL YOU WATCH`, `NEW: NEAR QUANTUM PHYSICS`, `TODAY'S NEWS`, `PICKED FOR TODAY`.
- **It holds still**, as now. It is the same all day and different tomorrow, LOAD MORE adds below, and nothing on
  screen moves.
- **The first screen waits** for his history and sign-in (both quick; normally well under a second). Slow sources (a
  cold reading route, DISCOVER's 330 KB catalogue, YouTube's answer) join from the next screen if they miss the first.
  Reading is kept in the browser for up to 6 hours, so it is there at once on the next visit.

**Signed out, or a new account with nothing to go on** (decision 5): a balanced sampler. It takes one item from each
source in turn. Items with words and a picture come first, then people's public picks (ANON to visitors), then the 2
reading rows. It becomes personal as soon as this browser opens things (visitors) or the history fills (accounts).
Nothing is recorded about visitors.

**DATE, POPULAR, any search, any filter:** unchanged.

## How it ranks (plain version)
### 1. A picture of the person (the "profile")
It is built in the browser, once a visit, from things the person may already read. Each signal adds weight to words
(topics), makers (creators, channels, authors, artists), kinds (video, audio, text) and particular items. Weights from
things done fade by half every 30 days unless marked "holds".

| Signal | Where it is (who can read it) | Weight |
|---|---|---|
| Finished here (any MEDIA row, book, song) | `user_history` (owner) | 4 |
| Played / read here | `user_history` | 2, +2 when replayed (first and last time over a day apart) |
| Opened | `user_history` | 1 |
| MORE LIKE THIS | `user_history` | 4, holds |
| Put it in a letter he made | `letters` + `letter_items` (owner) | 3 |
| Recommended it to someone | `recommendations` (sender) | 3 |
| Sent to him in a recommendation | `recommendation_to` (him) | the item itself goes near the top until played; its words and maker +1 |
| Queued in a stream room he joined | `watch_queue` (room members) | item +3 until played; maker +1 |
| A book read, finished or highlighted | `book_places`, `book_highlights` (owner) | the title's words and the author 2 (4 finished) |
| A board thread read | `user_history` kind thread; `forum_threads` anchors | thread title words 0.5; the anchored item's maker 1 |
| Songs he plays and likes | `music_listens`, `music_likes` (owner) | the artist as a maker +1, for audio rows |
| His YouTube | YOUR YOUTUBE's standings (likes, playlists, Takeout import, subscriptions he still watches) | channel as now, capped at 3; topics 0.5 each (they are broad: "Entertainment"); imported words 1 |
| His active DISCOVER preset | `discover_presets` (owner) | its words 3 |
| This browser's opens | `debaser.media-taste.v1` | as now, makers capped at 2 |
| His closeness to people | `music_for_you` (VANITY: replies, DM counts, listening along, shared rooms, visits) | decides whose picks count most |

**Against:**

| Signal | Effect |
|---|---|
| NOT FOR ME | the item never again; its words −3, its maker −3 (holds) |
| SHOW LESS FROM THIS CHANNEL | its maker −8 (holds) |
| Skipped (left within seconds) | the item out for 30 days; its maker −1 (fades) |
| BARR on a song | that artist −4 for audio rows |
| Shown on 3 days and never opened | rests a week (as now, this browser only) |
| Forgotten from HISTORY | nothing is learned from it any more |

**Words from titles (new).** A title's own words count as weak topic words: lower case, common words dropped, plurals
folded, 4 letters or more, at most 6 per title, half weight. This works both ways. His history rows ("Blackbody
Radiation and Wien's Law") gain words, and so does every candidate ("I finally saw quantum mechanics..."). That is the
main way his science videos start to teach the feed. Pure and local; nothing is sent anywhere.

### 2. The candidates
Every source the feed already reads, plus the whole saved stream instead of the newest 50:
- **The saved stream:** every enabled row (234 today, up to the newest 1,000), with Claude's words. One read a visit.
- **YOUR YOUTUBE's shelf:** new uploads from channels he still watches, and YouTube's "watch next".
- **Reading:** `/api/web/brief`.
- **DISCOVER's catalogue:** finds by his preset or strongest words.
- **People:** public recommendations, recommendations sent to him, room queues he can see, and public letters by
  people he's close to.

### 3. The score (each candidate)
- **Fit:** how much its words match his (each word counts up to a cap, and long tag lists are evened out so they don't
  win by length), plus its maker (capped at 6, so one channel can never outweigh everything), plus a little for kinds
  he plays.
- **People:** sent to him: a lot. Openly shared by a close person: 2, more for closer people, capped at 4.
- **Freshness, by kind:** news fades within 2 days, tech within 3, uploads by half every 30 days, audiobooks and films
  barely at all.
- **Small extras:** a picture +0.5, words or a description +0.5, a YouTube Short −2.
- **The day's jitter:** up to 1. It breaks ties and makes tomorrow different.

These numbers decide order only. They are never shown, saved or sent anywhere.

### 4. Building each screen of 12
Each place takes the best-scoring candidate that keeps the screen within these limits:
- at most **1 per creator** (2 only for a creator he has finished 2 or more things by), and a creator shown on this
  screen sits out the next one too;
- at most **4 per site**;
- **2 reading rows** when there are any, never side by side;
- **3 new-to-you places** (decision 1): candidates that don't match him yet but sit one step from his strongest words on
  DISCOVER's map, or come from a source he has never opened;
- at most **2 people's picks** (decision 2); something sent to him personally always gets a place on the first screen.

When nothing fits the limits, the site limit is relaxed first. The creator limit is never relaxed within a screen.

## Privacy
- **Nothing new is recorded about anyone.** Every signal is something the person may already read, read the way the
  site reads it today, and the list is put together in their browser.
- **Other people:** only what they shared openly or sent to this person (recommendations, room queues, public letters).
  Their private history is never used. Closeness comes from VANITY's existing database function, which already
  answers only for the person asking.
- **Visitors:** this browser's opens only. Nothing is recorded.
- **No counts or ratings** are shown or sent to the browser.

## Files
- **New:**
  - `app/lib/web/feed-profile.ts`: pure; turns the signals into a profile.
  - `app/lib/web/feed-rank.ts`: pure; the score and the screen builder. It reuses the reading chooser in
    `feed-mix.ts`.
  - `app/lib/web/title-words.ts`: pure.
  - `app/lib/web/use-feed-signals.ts`: the reads, in parallel, after the first paint.
  - fixtures of a person like Luke, a new account, a visitor and a friend.
- **Changed:**
  - `WebStream.tsx`: what the first screen waits for, and the candidate pool.
  - `use-brief.ts`: keeps the last reading answer for up to 6 hours.
  - `feed-mix.ts`: replaced by the ranker; the reading chooser kept.
- **Both repositories:** a `listPool` read of the whole stream, mock and Supabase. Every other read uses the existing
  stores, mock and Supabase alike.
- **Tables: none.**

## Proof (phase 3)
- **A new check, `Temp/check-media-feed-rank.cjs`, on the pure ranker,** each part watched failing on the old code
  first:
  - Luke-like person: nothing played or skipped in the first 12; at most one item per creator; at most 4 per site; a
    science reading row ranked in; his friend's recommendation present with a why-line naming the friend.
  - NOT FOR ME drops the item; SHOW LESS sinks the maker; BARR works; a forgotten row teaches nothing.
  - A visitor gets a balanced sampler.
  - Late sources never move a drawn row; the list is the same all day.
  - No numbers in any why-line, and no count or rating field in anything handed to the page.
- **The old feed check, `Temp/check-media-feed-mix.cjs`,** updated on purpose where its fixed pattern gives way to the
  limits.
- **Before and after**, written into this SPEC: the first 12 rows for the Luke-like fixture under the old and new
  ranking, using a saved copy of today's real stream (public metadata only).
- **A mock drive** on a local dev server: the first 24 rows' sources and why-lines, then LOAD MORE with nothing moving.
- **The house loop:** verify, `checks:changed`, one `verify:clean`, push, `deploy-status`, `npm run read`.

## Risks
- **The stream is thin** (7 sources, 234 items). A better ranking can't invent variety. With the creator limit,
  Luke's first screen leans on reading, his YouTube shelf and DISCOVER. Adding stream sources (database rows) is a
  follow-up.
- **More reads on /media** (letters, room queues, books, closeness). They run in parallel after the page has drawn,
  each with a short time limit, and a missing one just leaves its signal out for that visit. I'll tell the PERF session.
- **Why-lines go against SPEC-recommender.md**, which said no why-lines on MEDIA. That is decision 4.

## Decisions (Luke, 2026-11-17: "All A")
1. **Familiar vs new, per screen of 12.** **A (picked): 9 and 3.** B: 6 and 6. C: 11 and 1.
2. **Friends.** **A (picked): a boost with their avatar, at most 2 a screen.** B: friends lead, up to 4. C: only
   when nothing else fits.
3. **Hogging sources.** **A (picked): every source stays; 1 per creator and 4 per site a screen.** B: as A, plus The
   Linux Experiment switched off in the stream (a database change). C: as A, plus whole sites he never plays demoted.
4. **Why-lines.** **A (picked): one short line under each row in PICKED FOR YOU only.** B: avatars on friends'
   picks only. C: none.
5. **Nothing to go on.** **A (picked): a balanced sampler.** B: newest first. C: what people here played most this
   week (counts kept on the server; a new database function).

## Out of scope
New stream sources, changes to search, DATE or POPULAR, phone layout (desktop first), and anything recorded about
visitors.

## What was built (2026-11-17)
- **Pure, checked:** `app/lib/web/title-words.ts`, `feed-profile.ts` (every signal into one profile), `feed-rank.ts` (the
  score, the screens and their limits, the why-lines). `feed-mix.ts` keeps the reading chooser and the history helpers;
  the old fixed 12-place mix is gone.
- **Reads:** `app/lib/web/use-feed-signals.ts`, which reads the whole saved stream page by page through the same
  `listItems` (mock and Supabase), plus letters, recommendations sent to and by you, the queues of rooms you joined,
  VANITY's closeness, public picks and the active DISCOVER preset. Each read has a 3-second limit.
- **The page:** `WebStream.tsx`. The first screen waits for the stream, the history, sign-in and those signals, with no
  timer. Each row has a why-line with faces. LOAD MORE shows 4 more screens, already ranked.
- **Reading:** `use-brief.ts` keeps the last answer for 6 hours in this browser.
- **Changed from the plan:**
  - Rows carry their screen number, so when the stream runs out early a late source still joins below. The mock
    drive caught this.
  - The why-line also feeds the feedback key's own "why" item.
  - Song likes and BARR are not read. The site's own songs and MEDIA rows don't share makers, so they would add a
    read and change nothing. The history already holds songs played (kind `song`).
- **Lives (merged with LIVE's work the same day, SPEC-live-streams.md: "lives mixed in"):**
  - Place 5 of each screen is the LIVE place: the next live that fits (use-live-lane.ts, in LIVE's order). It is
    never a stand-in for another place, and with no live it takes something like what you play.
  - A live is offered even if its channel was opened lately, and it keeps to one row per creator a screen.
  - Its why-line is BECAUSE YOU ..., FROM A CHANNEL YOU WATCH, or ON NOW.
  - The first screen waits up to 3 seconds for the lives, then draws without them (they come from outside sites).
    The history is never given up on.
- **Rooms on the mock site:** the room-queue signal is read only on Supabase. The mock watch store has no shared
  queue to read, so the mock drive doesn't exercise it.

### Before and after, for a seeded person like Luke
The person in `Temp/check-media-feed-rank.cjs` is invented in the spirit of Luke's own signals, never his private rows:
- played science explainers on YouTube with no topic words, plus LibriVox's Mediaeval France
- skipped one Blender livestream, turned down one Rust video, played The Lightning Conductor
- old gaming subscriptions, and one stray Linux Experiment open in the browser
- a friend sent them Last and First Men

Both lists are run on today's real saved stream.

**Before (the old feed, history read in time):** A Wonder Book of Old Romance, Love and Life (LibriVox), PewDiePie
(YouTube place), Quanta's quantum long read (reading place), Social Life in Cameron..., The Atom and You, Last and First
Men (with no word of who sent it), The Yogscast, Anne of Green Gables, a tech link, The Linux Experiment, Castles of
medieval France. No row says why.
**Before (as on his screen: drawn at 2.5 s with no history):** High Flight, Linux Experiment, HPR, the Blender livestream
he had skipped, Green Eyes, HPR, ARC Raiders, Short Science Fiction, HPR, the Rust video he had turned down, Wanderings,
HPR.

**After (the new feed):**

| # | Row | Why it says |
|---|---|---|
| 1 | Last and First Men | SWEDEN SENT YOU THIS (with sweden's face) |
| 2 | The Chem Tutor: Photoelectric Effect and Quantum Energy | BECAUSE YOU PLAYED COMPTON EFFECT AND QUANTUM WAVELENGTH |
| 3 | Castles of medieval France (DISCOVER) | NEW: NEAR MEDIEVAL ERA |
| 4 | Quanta: A New Twist in Quantum Entanglement | BECAUSE YOU FINISHED BLACKBODY RADIATION AND QUANTUM PHYSICS |
| 5 | Physics Explained: Why quantum tunnelling breaks intuition | BECAUSE YOU PLAYED I FINALLY SAW QUANTUM MECHANICS... |
| 6 | The Linux Experiment (once, no longer four times) | MORE FROM THE LINUX EXPERIMENT |
| 7 | The Atom and You (DISCOVER) | NEW: NEAR QUANTUM |
| 8 | Blender Studio: Wing It! making of | DEMZOU RECOMMENDED THIS (with Demzou's face) |
| 9 | Blender Conference 2026 Recap | BECAUSE YOU PLAYED MAKING OF: THE BLENDER OPEN MOVIES EXHIBITION |
| 10 | a tech link | IN TECH TODAY |
| 11 | PewDiePie | FROM A CHANNEL YOU WATCH |
| 12 | X Minus One: The Map (DISCOVER) | NEW TO YOU |

### Proof
- **`Temp/check-media-feed-rank.cjs`: 200 checks.**
  - Run against the old feed, the seeded person failed it: no why-lines, the row sent personally not credited, and,
    as drawn on his screen, the played, skipped and NOT FOR ME rows were back.
  - Three rules broken on purpose were each caught: the creator limit, sitting out the next screen, and the out-list.
  - So was the late-source fix, broken on purpose.
- **`Temp/check-media-feed-mix.cjs`: 162 checks,** updated on purpose (the fixed pattern is gone).
- **`scripts/drive-media-feed.cjs`,** on a local mock dev server (`Temp/browse/dev-mock-feed.cjs`), 17 steps passed:
  - a visitor's why-lines name nobody
  - reading in places 4 and 10
  - DISCOVER and people's picks join late, at most 2 people's picks a screen
  - the same first screen on reload
  - signed in with a seeded mock history: the played row and the NOT FOR ME row are gone, and why-lines use the
    history's words
  - nothing reached Supabase
