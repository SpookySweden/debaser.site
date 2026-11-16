# SPEC: room chat on the DISCUSS page (Luke, 2026-11-16)

Luke's words: "when making comments while watching something in the stream room, which is now a default wether streaming
or not, the comments made in the stream chat are attributed in forum thread form and under the corresponding piece of
medias discuss page as comments made and are timestamped and attributed accordingly with the default privacy settings for
this to allow it to be seen."

Asked and answered the same day ("all a's but change the privacy promise and deafulats to accomodate this").

## What a reader sees
- The DISCUSS pen on a MEDIA result, a KINO or friend's-server title, or one of the site's own files opens that thing's
  comment window as today. Chat lines said in any room **while that thing was on the room's screen** show there among the
  comments, in time order: the name, the date and time it was sent, and a small `IN ROOM · 02:14` tag (where in the video it
  was said). A guest's line shows their guest name, marked GUEST.
- The thing's own forum thread (the one DISCUSS files, one per thing by anchor) is on the board. When nobody has commented
  yet, the first chat line files it, and the board credits it to the site as it does every anchored thread.
- The lines are **shown**, not copied: they are read from where the chat is saved. A chat line deleted in the room is gone
  from DISCUSS too. They can't be replied to one by one; the thread takes ordinary comments.
- Lines said while nothing was on stay in the room only. A GO LIVE stream keeps its own `STREAM ::` record on the board.
- Past chat shows too.

## Privacy (the promise changed)
- **Every room shows by default, private and password rooms included.** This replaces the line in
  SPEC-privacy-decisions.md that a private room's chat never leaves the room. A private room's queue, canvas and record
  stay its members'; only chat said over a playing thing reaches that thing's DISCUSS page.
- A room switch, `CHAT ON DISCUSSION`, in the room's settings (the host's cog), **on** by default. Off, that room's lines
  stop showing, past ones included.
- A person's switch in PREFERENCES, `MY ROOM CHAT ON DISCUSSION PAGES`, **on** by default. Off, their lines stop showing,
  past ones included.
- Signed-out visitors see the lines as they see the board's names (ANON rules for names apply).

## Database (each change needs Luke's typed OK first, through a migration)
- `watch_rooms.chat_on_discuss` (on by default) and a person's `room_chat_on_discuss` (on by default).
- A mark on a queue item saying which MEDIA or KINO result it came from, so DISCUSS finds it reliably; older items are
  matched by their address.
- One narrow reading function that returns only the lines allowed above for one thing (name, words, time sent, time in
  the video, guest or not), so nothing else of a private room opens up.

## Proof
Local mock dev server: chat in a mock room over a MEDIA result, open its DISCUSS, see the lines in time order with the tag;
turn each switch off and see them go; a line said with nothing on stays out. Supabase side: the function read as a visitor
on the live database once, after the migration, kept short.
