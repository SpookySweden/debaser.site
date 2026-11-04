# SPEC: watch together (stream rooms)

Interviewed 2026-10-27. Luke's answers are the decisions below; everything else is the smallest shape
that honours them. Build from this in a fresh session, one step at a time, each step live before the next.

## What it is for

The music listen-in, for video: one account streams a video from the archive in a big window, others
see a `[ TV ]` key beside that account in the account directory, press it, and land in a CyTube-style
room (the video, a shared queue and a chat). What was said is kept: under each video in the archive, and
as one forum thread per stream that reads the whole night back in order.

## Decisions (Luke, 2026-10-27)

1. **Starting.** Next to every video in the archive (`/media`, VIDEO tab, and the ALL list) a
   `[ ▶ STREAM ]` key (signed-in only). It opens the **room window, expanded** (large, over the board,
   like the arcade) with that file playing and the presser as host. Starting a stream = two presses
   (open, then `[ GO LIVE ]`), per the frontend rule.
2. **Controls: host + shared queue.** Only the host plays, pauses, seeks and skips; everyone follows
   (synced, like the music listen-in). Any signed-in watcher can **add** a video from the archive to the
   room's queue; the host can remove or reorder. The queue plays in order; the last file **loops** until
   something is added or the stream ends.
3. **Who joins.** Anyone can open a room and watch, guests included. Only signed-in accounts can type in
   the chat (the board's rule).
4. **The TV key.** A text key `[ TV ]` in the site's bracket style (no artwork), beside the account in the
   account directory (the `/users` page and the side panel's directory), shown for **every account that is
   in a live room** (the host and every signed-in watcher) so you can join a friend, not just the host.
   Pressing it opens that room. Tooltip: `WATCHING <file title> WITH <host>` (or `STREAMING ...` for the
   host). It appears and disappears as fast as the lamps (see "How", it rides the live room).
5. **Ending: when the room empties.** A stream keeps going while any **signed-in** account is in the room,
   even after the host leaves; it ends when the last signed-in account leaves (guests do not keep it alive:
   an abandoned tab must not loop forever). `[ END STREAM ]` is the host's key to end it for everybody.
6. **Handover.** When the host leaves and others remain, control passes automatically to the signed-in
   account that has been in the room longest; the room says `<NAME> IS HOSTING NOW`. The forum thread and
   the file folds still name the **original** host.
7. **Music pauses.** Joining or hosting a room pauses the music player and ends any music follow (the
   follow's existing "you are on your own" rule). Leaving the room does not restart the music.
8. **Under each video in the archive.** A collapsed `STREAM CHAT` section with **one fold per stream**
   that played the file: `<date> :: HOSTED BY <host> :: <n> MESSAGES`. Open a fold and the messages read
   in order, each stamped with **where in the video it was said** (`02:14`), then the author and text.
   A file streamed five times has five folds. Newest stream first.
9. **The forum thread.** Filed **when the stream starts** and growing live. Title `STREAM :: <host> ::
   <date>`; its body is the stream record: every file played, in the order played (a file played twice
   appears twice), each with its own collapsible chat fold (messages with the in-video time, as in 8).
   It shows the date and original host, and a LIVE marker while it runs. It is a **read-only record with
   ordinary replies below** (readers can comment on the thread like any post; the record itself can't be
   edited from the board).
10. **Test video.** A code-made **test signal**, not artwork: a few seconds of colour bars, a frame counter
    and a running clock, recorded in headless Chrome (canvas -> MediaRecorder -> WebM), a few hundred KB,
    uploaded to the catalogue as `TEST SIGNAL // LOOP` by TEST ACCOUNT A, played on loop. No ffmpeg on this
    machine; no download. (Luke chose this over supplying a clip; swap in a real clip later.)

## What exists today (so nothing is built twice)

- **Music listen-in** (the model to copy): `app/lib/audio/broadcast.ts` (a broadcast is a *pointer* -
  file, position, moment - never streamed bytes; `positionSeconds` + `updatedAt` so clocks needn't agree),
  `follow.ts` (follow state in a window slot; ends on any transport key), `heartbeat.ts`
  (`QUEUE_HEARTBEAT_MS` 4s), `QueueFollower.tsx`, table `music_queues`, QUEUES window.
- **Live room / presence** (2026-10-27, 2ad6fa1): one Realtime Presence channel `site-presence`
  (`app/lib/profile/supabase-profile-repository.ts`); each signed-in tab tracks `{ user_id, state }`;
  joins/leaves reach other tabs in ~1s, state changes on Supabase's ~6s relay cycle (see HANDOFF).
- **Video**: `media_items` with `kind = 'video'` (MP4/WebM, 25MB cap, `video` bucket), a plain `<video>` on
  `/media` (`MediaCatalogue.tsx`). Today the catalogue holds 0 videos.
- **Forum**: `forum_threads` / `forum_comments`, anchor kinds `board | asset | text-box | profile | track`,
  and the live constraint `forum_threads_anchor_key`: **one thread per non-board anchor** (HANDOFF gotcha).
  Item threads are titled `COMMENTS ON <item>` (`app/lib/forum/thread-subject.ts`).
- **Windows**: opened from an address, built and read in one place per window (`arcade-window.ts`,
  `music-window.ts`); state in `window-slot.ts`; docked layouts saved in `window_layouts`.
- **Directory**: `UserDirectoryRow.tsx` (both the page and the side-panel versions), `buildUserDirectory`.

## The shape

### Address
`/forum?watch=<roomId>` opens the room window (and `?watch=new&media=<itemId>` the host's pre-live window).
One module `app/lib/watch/watch-window.ts` builds and reads it, like `arcade-window.ts`.

### Records (one migration, Luke's OK before it is pushed - a database change)
- `watch_rooms`: id, original_host_id, host_id (current), forum_thread_id, started_at, ended_at (null while
  live). RLS: anyone reads; a signed-in account inserts a room it hosts; only the current host updates
  playback / host fields (handover is decided by the departing host's tab or, if it vanished, by the
  longest-present watcher's tab - the build must make this safe: an update allowed only to a watcher who is
  in the room, ideally through a small `security definer` function `watch_take_over(room)` that checks the
  host is gone).
- `watch_queue`: room_id, position, media_item_id, added_by, added_at, played_at (null until it plays),
  play_index (the order it actually played: drives the forum record, a replay is a new row).
- `watch_messages`: id, room_id, queue_entry_id (which play of which file), media_item_id, author_id, body,
  media_seconds (where in the video), created_at. Insert: signed-in, own author_id, room live. No edits;
  author may delete their own (as forum comments).
- Playback state lives on `watch_rooms` (current entry, position_seconds, updated_at, is_playing), written by
  the host on change and on a heartbeat, exactly the `music_queues` pattern, so a late joiner reads one row.
- Realtime: postgres_changes on the three tables for the room; Realtime **Presence** on the room's own
  channel `watch:<roomId>` for who is in it (join order = handover order, and "room empty" = no signed-in
  member). The `[ TV ]` key reads the site-wide live room: a tab in a watch room adds `watching: <roomId>`
  to its `site-presence` payload, so the key appears within a second (no polling, no extra table read).

### The room window
Desktop: video large on the left (16:9, letterboxed), under it the transport (host only: play/pause,
seek bar, skip; everyone: the file title, `3 OF 5`, volume, mute); on the right the **queue** (`[ + ADD ]`
opens the catalogue's video picker - `MediaPicker` - for signed-in watchers; host gets `[ × ]` / reorder)
and the **chat** (messages with in-video time, author name with lamp, a field for signed-in, `[ LOG IN ]
TO TALK` for guests), and a `WATCHING (n)` line of names. Phone: video on top, then chat, queue folded.
Title bar: `STREAM :: <host>` + LIVE. Closing the window = leaving the room (the window asks first if you
are the host: `LEAVE? <NAME> WILL HOST`/`END STREAM` choice).

### Sync
Copy the music follower: pointer, position + updatedAt, followers seek when off by > ~2s and catch up
otherwise; the host's pause writes at once. Video is muted-autoplay-safe: a viewer who joins gets a
one-press `[ ▶ JOIN PLAYBACK ]` if the browser blocks sound (autoplay rules), never a silent desync.

### Forum record
On GO LIVE: insert the `forum_threads` row (board anchor, so it doesn't hit the one-per-anchor rule;
`kind`/marker so the board draws it as a stream record), title `STREAM :: <host> :: <date>`, empty body.
The card and the open post draw the record from `watch_rooms` + `watch_queue` (play order) +
`watch_messages`, not from text stored in the body, so it stays live and can't drift. Ordinary replies
use the existing comments. A board filter key `STREAMS` beside TRACK THREADS.

### Under each file
`MediaCatalogue.tsx` video rows get the `STREAM CHAT` section (decision 8), read from `watch_messages`
grouped by `room_id`, joined to `watch_rooms` for date and original host. Collapsed by default; hidden
when the file has never been streamed.

### Both stores
Mock repository (`app/lib/watch/mock-watch-repository.ts`, this browser only, like the other mocks) and
Supabase repository, switched by `NEXT_PUBLIC_WATCH_DATA_SOURCE`, per the core rule.

## Out of scope
- Streaming anything not already in the catalogue (no YouTube links, no screen share, no webcams).
- Private / invite-only rooms; kicking or muting people; chat moderation beyond deleting your own message.
- Uploading from inside the room (upload in the catalogue, then add).
- Voice. Emoji reactions. Chat outside a room.
- Hidden test accounts' `[ TV ]` keys: they are hidden from the directory, so their key never shows there
  (tests read the room directly).

## Risks to say out loud
- **Database change** (three tables, policies, maybe one function): needs Luke's typed OK, through
  migrations (`npm run db:new`, `db:push:dry`, `db:push`).
- **Storage**: videos are the heaviest files (25MB cap, 1GB free tier, uploads refused past 80%). The test
  signal is tiny; real clips will fill it.
- **Bandwidth**: every viewer downloads the file from Supabase storage; a popular stream multiplies egress.
- **Public channels**: like the lamps and the arcade, a determined visitor could inject a fake presence
  entry (a fake `[ TV ]`); writes to the tables are still guarded by RLS.
- **Handover races**: two tabs deciding they are "longest present" at once - the take-over must be one
  guarded write that only one can win.
- **Autoplay**: browsers block sound until a press; the join key covers it.
- Supabase relays presence *state changes* on a ~6s cycle, so the `[ TV ]` key appears on join in ~1s
  but a change of room via state update could lag a few seconds; prefer joining/leaving the channel.

## Build order (each step: verify -> checks -> capture + audit -> commit -> push -> live)
1. Test signal: a scratch script that records the looping WebM in headless Chrome; upload it through the
   catalogue as TEST ACCOUNT A (`TEST SIGNAL // LOOP`). Proof: it plays on `/media` VIDEO, desktop + phone.
2. Migration (after Luke's OK) + both repositories + `watch-window.ts`. Proof: a scratch check against the
   mock store; dry push output shown to Luke first.
3. The room window for a host alone: `[ ▶ STREAM ]`, GO LIVE, transport, queue, loop, END STREAM, the
   forum thread filed at start. Proof: shots desktop + phone.
4. Joining: `[ TV ]` in the directory (via site-presence), sync, chat with in-video times, guests read-only,
   music pauses. Proof: a two-browser drive (A hosts, B joins by the key, both chat, B's player within 2s
   of A's).
5. Handover + ending: A leaves -> B hosts; B leaves -> stream ends, `[ TV ]` gone, thread no longer LIVE.
   Proof: the same drive, timed.
6. The record: the forum post (files in play order, chat folds with times) and the archive's per-stream
   folds. Proof: shots + `npm run read` where server-rendered, a browser read where not.
7. Fresh-context review; HANDOFF.

## Proof
- A two-browser drive (`Temp/watch-drive.cjs [url]`, TEST ACCOUNT A + B, never real accounts): every
  decision above as a numbered step with its timing, run against a production build and then the deployed
  site.
- Screenshots of the room, the directory key, the forum record and the file folds at 1440 and 390, both
  themes.
- Test data cleanup listed first and removed only with Luke's OK (rooms, messages, the forum thread the
  drive filed).
