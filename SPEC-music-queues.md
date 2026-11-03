# SPEC: music broadcasts become rooms that share the stream's queue (2026-11-03)

(Interview with Luke, 2026-11-03. The drawing canvas he asked for in the same interview is its own spec,
SPEC-stream-art.md, built after this one. Read SPEC-stream-queue.md first: this builds on its queue,
additions and crowns, which are live.)

## What Luke asked for
"Rework the music QUEUES tab and integrate it into the same queue function used in streaming to some degree."
In the interview that became: **a music broadcast is a stream room whose queue plays audio.**

## The model (Luke confirmed, 2026-11-03)
- **GO PUBLIC opens a room for your music**, built on the stream room's machinery: the watcher list, the
  chat (with its emoticon / GIPHY / Commons shelf), crowns, people's additions, the stream bar.
- **Following somebody = joining their room.** Following stays light: the bottom bar plays their music as
  the music bar does now; the **TV key** swaps it to the stream view the usual way, where the room's screen,
  chat and queue are.
- **One mixed queue.** Any room's queue (a music broadcast or a video stream) takes songs and videos. A video
  plays in the picture; a song plays in the music bar while the screen shows the **cover card** (below) or the
  canvas (SPEC-stream-art.md). A "music broadcast" is just a room that started from your up-next.
- **The queue window is the stream's** (`StreamQueueWindow`): played / playing / queued colours, one-line
  titles, people's additions on the right, crowns, drag to place, `[ + ADD ]` and the crowned add-to-queue key.
  Its search finds the site's own songs, archive audio (what the music bar already streams from platforms),
  and videos.
- **Adding follows the stream's rule exactly**: without a crown you add to your own list; the host or anyone
  crowned pulls it into the queue. Crowns behave as in SPEC-stream-queue.md.
- **The QUEUES tab** lists every live room: people's music rooms and video streams alike. Each row gets a **`[ QUEUE ]` key** that opens that room's queue window, so
  you can look before you follow. RADI-OH is unchanged.

## Your up-next while you broadcast
- GO PUBLIC **copies your up-next into the room's queue**, and your player plays that. Your own ADD TO QUEUE /
  PLAY NEXT keys (in posts, the archive, profiles) write into it, by the crown rule (crown on: straight in;
  crown off: your own additions list).
- **Store and start blank**: a key in the queue window saves the current shared queue as **one of your saved
  song lists** (named with the date) and starts an empty one. A stored list can be loaded back as the shared
  queue later. Saved lists learn to hold video links too, so a stored queue comes back whole.
- Switching public off: the room's queue stays as your up-next in your player.
- **Nothing is cleared when you stop.** The room's queue, people's additions and crowns are kept and are there
  again at your next GO PUBLIC.

## Off-queue plays
- If the host plays something straight from a post or profile, or PLAY FOR YOU hands the player a song, it
  **slots into the queue at the current spot as playing**, so the queue never lies. PLAY FOR YOU's picks are
  added to the end as they come, like the host adding them. Followers' bars follow, as the stream bar does.

## The cover card (the screen while a song plays)
- When the playing thing is audio, each viewer's screen shows **the canvas** (SPEC-stream-art.md) or the
  **cover card**; a toggle on the screen switches between them, each viewer picking for themselves (like SUBS).
  The canvas is the default while audio plays.
- The cover card: the song's cover (album or book cover) and a short description, in **a look of its own** -
  still retro, but a greyish background with coloured text. New tokens for it (docs/theming.md); design.md
  gets a line about it.
- Where the cover and words come from:
  - Archive audio (WEB): the platform's own thumbnail (hotlinked) and plain-text description, as the archive
    shows them.
  - The site's own MP3s: a picture and description **the uploader added**. If there is none, the
    **uploader's profile picture**. The uploader gets a small pop-up to add or change a picture and a
    description for their song (the pop-up is offered on the card when the uploader is the one viewing it,
    and from the song's settings panel). The picture is an image upload, stored like other site images.
  - A hand-filed song (in `assets/audio/`, no uploader): an art slot placeholder until Luke files a picture.

## Edge cases (defaults - Luke can overrule)
- Following somebody while you are broadcasting: you leave your own room's playback (it stays kept, not
  cleared) the way joining a stream works today.
- A follower's touching their own player (playing something else) leaves the room, as following does now.
- A broadcast room with nobody in it still exists while the host is public; when the host goes silent for
  30 minutes it drops off the list as rows do now, but its queue is kept.
- Live streams end with END STREAM as now; a music room is ended by switching public off and is never
  "ended" in the record sense (its queue is kept).

## Out of scope
- The drawing canvas, GIF / message dragging, STREAM ART in the archive: SPEC-stream-art.md.
- Changing RADI-OH, VANITY, PLAY FOR YOU itself, or the /archive page.
- Recording or re-hosting anything: songs stay the site's own files or the platform's own stream; videos stay
  the platforms' embeds (the CLAUDE.md archive rules hold).

## Data (needs Luke's typed OK before anything is run)
In plain English - the building session writes the exact migration and asks first:
- A room gets a **kind of origin** (a stream, or somebody's music) so a music room can be kept across GO PUBLIC
  sessions instead of ended.
- A queue row can be **a song** as well as a video (its file address and title, the way the music bar names a
  song).
- The old broadcast table (one row per person: track, position, playing) is replaced by the room, or kept as the
  room's "where the host is" if that is simpler; the building session decides and says which.
- The cover card's picture and description per site song (a table of uploader-written notes, readable by
  everyone, editable only by the song's uploader; the picture in a storage bucket under the uploader's folder).
- Every new table gets Row Level Security; the mock repositories keep the same rules by hand.

## Settled after the first draft (Luke, 2026-11-03)
1. The QUEUES tab lists **every live room**: music rooms and video streams, each with `[ QUEUE ]`.
2. **Saved lists learn to hold video links**, so a stored queue comes back whole (a data change, in the OK above).

Luke confirmed this spec and SPEC-stream-art.md on 2026-11-03.

## Suggested build order (commit and verify each)
1. Rooms take songs: a queue row can be a song; the stream bar / music bar plays a song row through the music
   player; the queue window's search adds site songs and archive audio.
2. GO PUBLIC opens (or reopens) your kept music room from your up-next; following joins it; the QUEUES tab
   rows open rooms and get `[ QUEUE ]`; the old broadcast follow retires.
3. Off-queue plays and PLAY FOR YOU write into the queue; store-and-start-blank to a saved list.
4. The cover card and its look; uploader picture/description pop-up.

## Proof
- Pure rules checked (crown rule on songs, store-and-start-blank, off-queue slotting), each proven to fail first.
- Drive on dev-mock with two people: host goes public, follower joins, adds a song, host pulls it in, both bars
  play it; TV key swaps to the stream view; cover card shows; desktop and phone widths.
- Policy probe against the live database with TEST ACCOUNT A and B once `.env.test` is back; otherwise the mock,
  and say so.
