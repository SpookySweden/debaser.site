# SPEC: HISTORY (what you played, how it reached you, and when; 2026-11-17)

Status: **written, waiting for Luke's OK.** Nothing is built and the database has not been touched. Building follows
his OK. The new table and the fill-in of older plays are a database change: before anything is applied, the building
session runs `npm run db:backup`, shows the dry run (`npm run db:push:dry`), describes it in plain English again, and
waits for his typed OK in chat.

## Luke's words
> "i want a new "history" tab which has a similar ui to the queue, make it neat and quirky creative and consistent, put
> it on the side bar with the other buttons such as go live and read book etc, the history shows all relevant
> information, what piece of media it was, how you listened to it ie if you added it yourself, what stream it was in
> or if someone else added it. and when you listened to it, with the ability to see the rest of the playlist/listening
> / watching session or letter or comment or whatever its from by clicking."

His interview answers (2026-11-17): **1B 2A 3A 4B 5A 6A 7A 8A**, **9**: "incoproste the general point of radio to be
accessable within the history tab. so that you can also jump back in to the song or playlist etc", **10B**.

| # | Question | Answer |
|---|---|---|
| 1 | What counts as a play | **B. It started playing for you** (see "What counts" for the exact rule) |
| 2 | Which sources | **A. Everything that plays:** the music bar, rooms, MEDIA videos, and books opened in READ |
| 3 | Who sees it | **A. Only you** |
| 4 | How long, and control | **B. Kept forever**, with ERASE (plus PAUSE and an [ X ] on each row, carried over from the A option) |
| 5 | Signed-out visitors | **A. A history kept in their own browser** |
| 6 | Pressing a row | **A. It folds open under the row:** the whole session, your play marked, and an [ OPEN ] key |
| 7 | Grouping | **A. Day headings**, with plays in a row in the same room folded into one session line |
| 8 | Quirky | **A. A logbook:** log lines, a text-character mark for each way a thing reached you, log-stamp day headings |
| 9 | RADI-OH | **HISTORY can also do what RADI-OH does:** each line jumps back in where you left off, and a session or letter plays again from any point |
| 10 | Older plays | **B. Filled in** from what the site already kept, marked HOW: NOT RECORDED |

## What the site keeps today (mapped 2026-11-17), and why HISTORY needs a new table
- **FOR YOU's private history** (`user_history`, SPEC-recommender.md): one line per *thing* (song, MEDIA item, book,
  room, letter, board thread, lore page). Owner only, 90 days, at most 3,000 lines, PAUSE and ERASE on PRIVACY. It
  keeps only the *last* time you touched each thing, and nothing about how it reached you.
- **The music bar's listen log** (`music_listens`, SPEC-vanity.md): every song played for about 30 seconds, with the
  time. Owner only, kept forever. It keeps only the file's address: no title, no room, nobody who added it.
  Today: 610 plays from 4 people. Every one of them can be given its title from the site's own file lists
  (`media_items`, `music_tracks`, `profile_song_versions`), checked by a read-only query.
- **Room queues** (`watch_queue`): what each room played, who added it, when it was added and when it played. They
  don't say who was in the room listening. Rows written while a room was private can be read only by its members,
  and membership (`watch_members`) stays after you leave, unless you were removed.
- **RADI-OH** (QUEUE's third tab, `app/lib/audio/loops.ts`): your last 30 songs, where each came from, and where you
  were in it. Kept in that one browser only.
- **Imported YouTube history** (`user_watch_summary`): only a summary of channels. The videos were never kept, so they
  can't appear in HISTORY.
- **Letters and comments**: opening someone's letter is noted in FOR YOU's history. A song or video played *from* a
  letter, a profile comment (`profile_comments.song_version_id`) or a board post isn't recorded anywhere.

So none of these says, line by line, *what played, when, how it reached you, and from where*. HISTORY needs its own
log: one line per play.

## What counts as a play (answer 1B)
- A play is noted **the moment something starts playing for you**: you pressed it, your queue moved on to it, or the
  room you are in started it. A quick skip still counts. That's the point of 1B: HISTORY is what passed through your
  ears and eyes, not what you liked.
- **Pressed again straight away:** the same thing, reached the same way, started again within 60 seconds (a pause and
  play, a seek, a reload) stays one line. Anything else is a new line.
- **A video** counts when its player starts. **A book** counts when it opens at `/read` (your own PDF or EPUB from
  this computer stays out, as it does from FOR YOU's history today). **A song looping on repeat** stays one line until
  something else plays.
- **Where you left off:** when a play stops (something else starts, you close the page, or a book is put down), its
  line is updated once with where you got to (seconds into the song or video; books already keep their own place).
  That's what [ ▶ ] uses to put you back. It's one write per play, never a ticking one.

## How it reached you: the "how" line
Each line answers *how* in plain words, taken from what the site already knows at the moment something starts. The
music bar already records where each press came from (`heardFrom` origin, href, where, context in
`MusicPlayerProvider.tsx`), and rooms know who added each queue row.

| How | Mark | The line says | Opens |
|---|---|---|---|
| You played it yourself (MEDIA, FILES, YOUR MUSIC, DISCOVER, FOR YOU, VANITY) | `♪` song, `▦` video | `YOU PLAYED IT · FROM MEDIA` | where you pressed it |
| Your own queue (your room, before or after GO LIVE) | `↻` | `YOUR QUEUE · ADDED BY YOU` | your room's session |
| Someone else's room | `●` | `IN MIA'S ROOM · ADDED BY JO` (or `ADDED BY YOU`) | that room's session |
| Your room, added by someone who joined | `●` | `IN YOUR ROOM · ADDED BY JO` | that session |
| Someone's letter | `✉` | `FROM A LETTER BY MIA` | the letter |
| A profile comment | `✎` | `FROM A COMMENT BY JO` | the comment on the profile |
| A board post's media plate | `▤` | `FROM A POST BY JO` | the post in its thread |
| Someone's profile song | `☻` | `ON MIA'S PROFILE` | the profile |
| Someone's playlist (the QUEUES list) | `↻` | `FROM MIA'S PLAYLIST` | the list |
| A book in READ | `📖` | `READ IN THE READER` | the book at your place |
| Filled in from before HISTORY | `?` | `HOW: NOT RECORDED` | the thing itself, where it can |

Marks are text characters only, from `app/lib/ui/icons.ts` where one exists (no drawn icons, per the asset rules).
A name is shown as it was when the play happened (kept on the line), so a later name change or a deleted account
still reads sensibly. A deleted account reads `SOMEONE`.

## The window (answers 6, 7, 8, 9)
A docked window like QUEUE (`DockWindow`, drawn once in `layout.tsx`), titled **HISTORY**, with status `YOUR LOG`.
It opens from its own shelf key, **`[ ◷ HISTORY ]`, right under QUEUE** in the side panel (`DesktopSidebar.tsx`,
`SIDE_HISTORY` beside `SIDE_QUEUES` in `SiteNav.tsx`, its address `?history=1` like `?queues=1`). Desktop first.
At phone width it must only not break (no sideways scroll at 390).

**What you see, top to bottom:**
1. **The top strip:** `[ PAUSE ]` / `[ RESUME ]` (one pause for HISTORY and FOR YOU, the same switch PRIVACY already
   has), a filter row `ALL · MUSIC · VIDEO · BOOKS · ROOMS · LETTERS` (plain toggle plates), and `[ ERASE ]`, which
   takes two presses like PRIVACY's.
2. **The log**, newest first, under **log-stamp day headings**: `LOG 17.11 · TODAY`, `LOG 16.11 · YESTERDAY`,
   `LOG 14.11 · FRI`. Older years show the year: `LOG 03.10.25`.
3. **A line** reads like a ship's log entry, on one line where it fits:
   `14:02  ●  NIGHT DRIVE — KAVINSKY   IN MIA'S ROOM · ADDED BY JO   [ ▶ ] [ X ]`
   The time sits in a fixed-width column (the site's mono face), then the "how" mark, then the title and maker (the
   thumbnail at the size the QUEUE rows use, where the thing has one), then the how line, then the keys.
   `[ ▶ ]` jumps back in where you left off (RADI-OH's point, answer 9): a song plays from that second on the bar, a
   video opens in your room at that second where its platform allows a start time (YouTube does), otherwise from the
   start, and a book opens at your place in READ. `[ X ]` removes that one line, at once, no asking.
4. **A session line:** plays in a row from the same room, with less than 30 minutes between them, fold into one line:
   `14:02–15:40  ●  IN MIA'S ROOM · 9 PLAYED` (the only number in the window: how many of *your own* lines it holds,
   never a count from anyone else). Pressing it shows the plays inside.
5. **Pressing any line folds it open underneath** (answer 6A, `aria-expanded` on the line, the one "this is open"
   look the CHROME group owns). Inside, depending on where it came from:
   - **A room:** the room's queue in the order it played, from that session's first play to its last, who added each,
     **your line marked** `► YOU WERE HERE`. Keys: `[ ▶ PLAY FROM HERE ]` (that session's plays from the one you
     pressed onward go into your own queue, UP NEXT, and start: RADI-OH's "jump back in to the playlist"), and
     `[ ● JOIN ROOM ]` while the room is still going or `[ OPEN ]` for its record once it has ended. If the room's
     queue can't be read any more (a private room you were removed from, or a room that's gone), the fold shows only
     your own lines from that stretch, under `ONLY WHAT YOU HEARD IS KEPT`.
   - **A letter:** the letter's items as its window lists them, the one you played marked; `[ ▶ PLAY FROM HERE ]`
     and `[ OPEN LETTER ]`. A deleted letter: `THIS LETTER IS GONE`.
   - **A comment or a post:** the comment's or post's text as plain text (two lines, cut with `...`), who wrote it
     and when; `[ OPEN ]` goes to it.
   - **Played yourself:** where you pressed it and the thing's own facts (kind, date, licence, length: metadata
     only); `[ OPEN ]` goes to where it came from.
6. **The foot:** `[ SHOW OLDER ]` adds 50 more lines (no endless scroll, and nothing moves on its own).

**Feel** (docs/design.md): flat, instant, no easing. Every key is a bracket plate from `app/lib/ui/controls.ts`.
Tokens only, text 4.5:1 or better in every theme, nothing under 13px, motion stops under reduced motion (the only
motion is the playing line's `♪` blinking in step, like RADI-OH's singing face).

**RADI-OH stays where it is** in the QUEUE window, untouched (the smallest change). HISTORY now does what it does
too, so it can go later on Luke's word.

## Who sees it, how long, and control (answers 3, 4, 5)
- **Only you.** Nobody else can read your lines, signed in or not: not the house account, not a room's host, not a
  stream room's guests. Nothing from HISTORY appears on profiles, and the "listening shown" switch on PRIVACY doesn't
  touch it.
- **Kept forever** (4B), unlike FOR YOU's 90 days. Said once: the free database is 500 MB and holds 159 MB today. A
  very busy listener (200 plays a day) adds about 25 MB a year. That's fine for years with today's handful of people.
  If the site grows a lot, a cap may be needed later, and that would be Luke's call.
- **Control:** `[ X ]` on each line; `[ ERASE ]` in the window removes every HISTORY line; PRIVACY's
  `ERASE MY HISTORY` removes both HISTORY and FOR YOU's history (it says so); `[ PAUSE ]` stops both from noting
  anything until RESUME. While paused, the window's top line says `PAUSED: NOTHING IS BEING WRITTEN DOWN`.
  Deleting the account deletes the log.
- **Signed-out visitors (5A):** the same window, kept in **that browser only** (its own storage, up to 500 lines,
  oldest going first), headed `KEPT IN THIS BROWSER ONLY. [ LOG IN ] TO KEEP IT ON YOUR ACCOUNT.` like the visitor's
  queue. Signing in doesn't move a visitor's lines onto the account (out of scope; could come later).
- **A stream room's guest** (the temporary guest accounts) is a visitor here: the database refuses guests, as every
  account table does, so their HISTORY stays in the browser.

## Older plays (answer 10B)
Filled in once, as part of the same migration (a database write, so it waits for the typed OK with the rest):
- **Every row of the listen log** (`music_listens`, 610 today) becomes a song line at its own time, titled and
  credited from the site's file lists (all 610 were matched by a read-only check). `HOW: NOT RECORDED`.
- **Every FOR YOU line for a MEDIA item or a book** that was played, read, finished or skipped (51 lines of kinds
  media, book and song today, songs left out where the listen log already has them) becomes one line **at its last
  time** (FOR YOU never kept the earlier ones). `HOW: NOT RECORDED`.
- Guest accounts are left out. Nothing in either source table is changed or removed.

## Data model (the migration draft; nothing applied)
One new table, `user_plays`, one row per play. Owner only, by Row Level Security.

```sql
-- HISTORY (SPEC-history.md; Luke's interview 2026-11-17). DRAFT: not applied, waiting for Luke's typed OK.
create table if not exists public.user_plays (
  id bigint generated always as identity primary key,
  person uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('song', 'video', 'book')),
  ref text not null check (char_length(ref) between 1 and 2048),        -- the file's address, the MEDIA item id, the book ref
  title text not null default '' check (char_length(title) <= 200),
  maker text not null default '' check (char_length(maker) <= 100),
  picture text check (picture is null or char_length(picture) <= 2048), -- a hotlinked thumbnail, as the site shows it
  how text not null check (how in ('yourself', 'own_queue', 'room', 'letter', 'comment', 'post', 'profile', 'playlist', 'reader', 'not_recorded')),
  where_label text not null default '' check (char_length(where_label) <= 100), -- 'MEDIA', 'MIA''S ROOM', ...
  where_href text check (where_href is null or char_length(where_href) <= 300),
  added_by uuid references auth.users (id) on delete set null,
  added_by_name text not null default '' check (char_length(added_by_name) <= 100),
  room_id uuid references public.watch_rooms (id) on delete set null,
  queue_entry_id uuid references public.watch_queue (id) on delete set null,
  letter_id uuid references public.letters (id) on delete set null,
  source_ref text check (source_ref is null or char_length(source_ref) <= 300), -- a comment's or post's id
  played_at timestamptz not null default now(),
  stopped_at timestamptz,
  left_at_seconds integer check (left_at_seconds is null or left_at_seconds >= 0),
  length_seconds integer check (length_seconds is null or length_seconds >= 0)
);
create index if not exists user_plays_recent on public.user_plays (person, played_at desc);
create index if not exists user_plays_room on public.user_plays (person, room_id, played_at) where room_id is not null;
```

Rules (policies dropped and recreated by name, so it can be re-run):
- **Read, delete:** only `person = auth.uid()`. A restrictive rule shuts guests out (`not public.is_guest()`).
- **Add:** only as yourself, not a guest, not paused (`public.history_paused()`, the same switch as FOR YOU), and
  stamped now (`played_at` within a minute, like `music_listens`).
- **Change:** only your own line, only `stopped_at`, `left_at_seconds` and `length_seconds` (a trigger keeps every
  other column as it was).
- **Visitors (anon):** no grant at all. Grants: `select, insert, update, delete` to `authenticated` only.
- **The 60-second rule** (same thing, same way, within 60 seconds is one line) lives in the browser and in the
  database function `play_note(...)` that writes a line (security invoker, so the rules above still decide).
- **No cap and no clean-up job** (answer 4B).
- **Fill-in (10B):** inserts as described above, run once, as the migration's owner; re-runnable (it skips lines
  already filled in).

## Code (for the build, after the OK)
- `app/lib/history/`: `types.ts`, `repository.ts` (the interface), `mock-plays.ts` (the browser copy, also the
  visitor's copy), `supabase-plays.ts`, `sessions.ts` (folding lines into sessions and day headings, pure and
  checkable). Both repositories, picked by a new `NEXT_PUBLIC_HISTORY_DATA_SOURCE` switch (added to `.env.example`).
- **Where a play is noted:** the music bar (`MusicPlayerProvider.tsx`, where the listen log and RADI-OH already
  write, passing the origin it already has plus the room or letter or comment it came from), the room's screen
  (`WatchRoom.tsx`, when an item starts, with the queue row's `added_by`), MEDIA's video player (`WebStream.tsx`, where
  FOR YOU's note is made), and the reader (`ReaderPage.tsx`). Letters, comments and posts pass their own id as the
  origin when they start a play.
- **The window:** `HistoryWindow.tsx` and `app/lib/history/history-window.ts` (open/close state, the same shape as
  `queue-window.ts`), drawn once in `layout.tsx`; CSS beside the QUEUE window's block in `app/globals.css`.
- PRIVACY's `HistoryPanel.tsx`: the ERASE wording says it removes both, and the erase also clears `user_plays`.

## How it will be proved
Locally, on a dev server with mock data sources (no live drives except the one named below):
1. `npm run verify` and `npm run checks:changed`.
2. **New checks** in `Temp/check-history.cjs`, each watched failing first: lines fold into sessions and day headings
   correctly (30-minute gap, 60-second rule); the how line reads right for each way in the table; `[ X ]` removes
   one line and `[ ERASE ]` all of them; PAUSE writes nothing; a visitor's lines stay in the browser; nothing in the
   window shows a count from anyone else, a like, a view or a rating; the shelf key opens and closes the window.
3. **A local drive** (mock data): play a song from MEDIA, a song in your queue, a video, a song from a letter, open a
   book, then open HISTORY and check every line's how, time and fold, `[ ▶ ]` resuming at the right second, and
   `[ ▶ PLAY FROM HERE ]` filling UP NEXT. Screenshots kept in `Temp/browse` for the session's own checking, dark
   theme then bright, desktop width, plus one look at 390 wide for no sideways scroll. `npm run capture` +
   `npm run audit`.
4. **One short live check** (it can't be proved locally), through `heavy-step.cjs --live`: the database refuses
   another account reading or writing your lines, refuses a visitor and a guest, refuses a line while paused, and
   refuses changing a line's title. Kept short, test accounts A and B only, and the lines it writes listed for
   Luke as leftovers to delete with his OK.
5. Live: `npm run deploy-status`, then `npm run read` confirms `[ ◷ HISTORY ]` is on the deployed site.

## As built (2026-11-17), where it differs from the above
- **Where plays are noted:** one keeper (`PlayHistoryKeeper.tsx`) watches *the room you are hearing* (the live room the
  bar follows, else the room window that is open, else your own room). Since the perpetual room every song and video is
  a row in one of those, so one place covers the bar, rooms and MEDIA. A book is noted by the reader. The same room row
  seen again within 6 hours (a reload mid-song) stays one play, besides the 60-second rule.
- **"Played yourself" vs "your queue":** a row in your own room that you added within 10 seconds of it starting reads
  YOU PLAYED IT (with where you pressed it, from the bar's own record); one added earlier reads YOUR QUEUE.
- **Letters:** the fold lists the letter's things with yours marked and `[ OPEN LETTER ]`; there is no
  `[ ▶ PLAY FROM HERE ]` for a letter (its things are links of many kinds, not a queue). Rooms have it.
- **Comments and posts:** the fold shows where it came from and `[ OPEN ]`, not the comment's or post's text. A song
  played from a profile's comment window is that profile's song, so it reads `ON MIA'S PROFILE`; `FROM A COMMENT`
  stays in the table for later.
- **The playing line** wears a still `♪ NOW`, not a blinking mark (no motion to stop).
- **Marks:** the site's own glyphs (`app/lib/ui/icons.ts`): `♪` `▦` the book `●` `↻` `✉` `✎` `▤` `☻` `?`; the key is
  `[ ◷ HISTORY ]` (`ICON_HISTORY`).
- **A video line** can be played again when its address is still a link the site knows; an old filled-in MEDIA line
  (an id, not an address) has no `[ ▶ ]`.

## Out of scope
- Showing anyone else's history, or HISTORY on profiles.
- Moving a visitor's browser history onto their account at sign-in.
- Imported YouTube history lines (the videos were never kept).
- Board threads, lore pages and profiles merely *opened* (those stay in FOR YOU's history; HISTORY is what played or
  was read).
- Removing RADI-OH (waits for Luke's word).
