# SPEC: series in the stream room (2026-11-02)

Interview done with Luke on 2026-11-02; build in a fresh session from this file. It needs a database change,
which waits for Luke's typed OK after a plain-English description (core.md).

## What Luke asked for
1. Some Internet Archive items are a whole series (Paranoia Agent) but show as one piece of media. Make it
   clear that it is a series.
2. Added to the queue, a series is one title that folds open to its episodes, **starting folded**.
3. In the queue window's search, a series' title folds open too, so single episodes can be picked.
4. A pasted link to a series opens a pop-up like qBittorrent's "which files" window: tick the episodes.
5. Bug: playing Paranoia Agent, the next two episodes autoplayed, but **SKIP did nothing**; only running
   the video to its end rolled it over. Fix that.

## Why it happens today (found 2026-11-02)
An Archive video is queued as one `embed` row: the Archive's own player in a sandboxed frame
(`OfficialEmbedStage` in WatchRoom.tsx, `archive.org/embed/{id}`). For a multi-file item that player keeps
its own episode list and moves through it by itself. The room sees one row, so SKIP (which moves to the
next *room* row) has nothing to skip to, and the frame is not in step between viewers ("NOT IN STEP").

## Decisions (Luke, 2026-11-02)
| Question | Answer |
|---|---|
| How an episode plays | In the **room's own player**, in step for everybody: each Internet Archive episode's video file streams straight from archive.org (the way the music bar plays Archive audio). SKIP, seek and pause work. Nothing is downloaded, copied or re-hosted. This extends CLAUDE.md's WEB playback rule (video was the platform's own embed only): update that line when building. |
| What counts as a series | An Internet Archive item holding 2+ video files, **and YouTube playlists**. YouTube episodes play through the room's existing YouTube player (already in step). PeerTube and others: out of scope. |
| A series in the queue | **One folded block**, starting folded, taking one place: it plays its episodes back to back; reordering moves the whole block; opened, a crown can take out single episodes. The strip and NOW name `SERIES :: EPISODE`. |
| Picking episodes | **All ticked** to start, with a TICK ALL / NONE key, so ADD alone adds the whole series. |
| Added without a crown | **One folded series** on their own list; a crown drags or `[ ← ]`s the whole block in, and may open it first to drop episodes. |
| /web | Mark a series on /web rows too: `SERIES :: n EPISODES`. The ticks live only in the queue window. |
| Most episodes per add | **No cap.** See the risks below. |

## How it should look and feel
- **Search (queue window):** a series result shows `SERIES :: n EPISODES` beside its platform. Its title is a
  fold (`[+]` / `[-]`, starting folded) opening to one row per episode with a tick, all ticked, plus
  `[ TICK ALL ]` / `[ TICK NONE ]`. `[ + ADD ]` adds the ticked episodes to your own list; with a crown the
  crown-plus key adds them straight into the queue (the two-key rule from SPEC-stream-queue.md). Nothing
  ticked: both keys go quiet.
- **Pasted link** (an archive.org `details` page, or a YouTube playlist address): the queue window opens a
  pop-up over itself, titled with the series, listing every episode with a tick (all ticked), the two
  ADD keys and `[ CANCEL ]`. One episode only (an item with one video) skips the pop-up and adds as today.
- **The queue:** a series block is one row in its state's colour (red / green / blue titles, one line):
  `[+] PARANOIA AGENT (13)`. Opened, its episodes list under it, each one line, in its own state's colour
  (played red, on green, to come blue). A crown sees `[ × ]` on episodes still to come. ↑ / ↓ / drag move
  the whole block. When the last episode is taken out, the block goes.
- **Playing:** SKIP moves to the next episode, then past the block to what follows. A host's player at the
  end of an episode starts the next one, as it does for any row. The board's record lists each episode
  that played.

## Reading the episode lists (server-side, `safe-fetch`, never from the browser)
- **Internet Archive:** the public metadata API, `archive.org/metadata/{id}` (the same source
  `app/lib/web/audio-files.ts` reads for audio, in the day-long fetch cache). Video files only, one copy
  per episode (best playable format first: h.264 / MPEG4, then 512Kb MPEG4; never the original upload if
  a derivative exists), in the Archive's own order, titled from the file's `title` or its name. Each
  episode's address is its https file on archive.org; a play goes straight from archive.org to the viewer.
- **YouTube playlists:** the Data API's playlistItems (the key the WEB YouTube search already uses), with
  the InnerTube fallback the search has (core.md: forever project). Each episode is a `youtube` link.
- Both feed one shape (series title, episodes: title, address, kind, length when known) and one checkable
  pure module, like the WEB adapters.

## Data (needs Luke's typed OK; describe in plain English first)
A block must know which rows belong to it and in what order. The likely shape: `watch_queue` gains the
series a row belongs to (a key and the series title) and its episode number, written to be re-run, with the
same RLS and guard rules (only a crown moves a block; only the host marks plays). Both repositories keep the
rules. Existing rows (single Archive embeds already queued) stay as they are.

## Risks to settle while building
- **No cap**: the room reads at most 500 queue rows (`readRoom`), and inserts are one request per row. A
  2,000-file Archive item would break the room's read. The build must either store a series without one row
  per unplayed episode, or page the read and batch the inserts. It must also keep the tick list usable
  (scrolling, TICK ALL), and the metadata reads small (fields filtered, cached). Say which way was chosen.
- Some Archive items' files can't play in a browser (old codecs): the existing "link won't play" path skips
  them after a moment. Check how often that happens on real series before relying on it.
- A pasted `details` link recognised as an Archive item is new: today `recognizeLink` refuses it.

## Proof
- Checks (proven to fail first): the Archive file list to episodes (fixtures: a series, a single video, mixed
  formats, an audio item), YouTube playlist pages, block positions after drops and reorders, SKIP's next row.
- The rules probe (Temp/probe-watch-crowns.sql pattern) for any new policy or guard rule.
- Drives on the mock: search folds and ticks, the link pop-up, a block folding in the queue, SKIP inside a
  block. Live: a real Archive series in a room (needs `.env.test` back for a signed-in drive; otherwise say so).
