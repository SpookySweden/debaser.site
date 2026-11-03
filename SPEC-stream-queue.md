# SPEC: stream queue window, people's additions and crowns (2026-11-02)

(WEB is called ARCHIVE and lives at /archive since 2026-11-03; /web redirects there. See SPEC-web.md.)

Stage 4 of Luke's stream-room rework (2026-11-02). Stages 1-3 are live: the bar under the video, YouTube's
strips cut off, QUALITY, the speaker, folding away to the TV box, the watcher strip, and the queue as a pop-up
window with WEB search and pasted links. This part needs a database change, so it is specced here and built
in a fresh session.

## What Luke asked for
1. Once you add something to the stream's queue it is **not added directly** to the queue.
2. The queue window is **split down the middle**: on the left the real queue (played in red, playing in
   green, queued in blue, as now), on the right **the things people have added**.
3. The **host** can drag any addition from the right to the left and drop it wherever they like.
4. For the host, the right is **a list of the people who have added things**; each name folds open to show
   what they added, ready to drag across.
5. The host can give anyone that power by pressing a **crown next to their name** in the queue window:
   **hollow** = no, **filled** = yes.
6. Somebody without a crown just adds to **their own list**, which somebody with a crown pulls into the queue.
7. The host can also **take off their own crown**.
8. Already built (stage 2): the search bar searches WEB the way /web does and takes a pasted link; results
   take the list's place inside the same window.

## Decisions (Luke OK'd these defaults, 2026-11-02)
| Question | Answer |
|---|---|
| Who the host (and anyone crowned) sees on the right | Everyone in the room now **and** anyone who has added something, even after leaving, so anybody present can be crowned. |
| What a crown allows | Pull additions into the queue (drag, or a key for keyboards and phones), reorder the queue, take out what has not played. Play, pause, seek, skip and END STREAM stay the host's alone: the host's player is what everybody follows. |
| The host's own crown | Filled at GO LIVE. Off: the host's own additions go to their list like anybody's and they cannot move things in the queue until they put it back, which they can at any time. Only the host crowns. |
| Where it is built | A fresh session, from this spec. |

## Settled (Luke picked the proposed answer to all six, 2026-11-02)
| Question | Answer |
|---|---|
| Does a person without a crown see the real queue on the left? | Yes, read-only: no dragging, reordering or taking out. |
| Can somebody take back their own addition before it is used? | Yes: `[ × ]` on their own rows until a crowned person pulls it in; after that only a crown takes it out. |
| When the host changes (hand-over or take-over), what happens to crowns? | Crowns stay, and whoever becomes host gets a filled crown at once. The database does it on every host change (a trigger), so a tab closing mid-hand-over cannot miss it. |
| Do somebody's additions stay after they leave the room? | Yes, until each is pulled in or taken back, or the stream ends. |
| Does the chat or the strip say when something is pulled in? | No. The queue window just updates. |
| What does ADD (a search result or a pasted link) do now? | With a crown: straight onto the end of the queue, `QUEUED` as before. Without one: `ADDED`, and the row appears under your name on the right. (This is the crown rule above: a host whose crown is off adds to their list like anybody.) The /web page's ADD TO QUEUE for a host follows the same rule. |

Also decided while building: somebody holding a crown stays in the host's list after leaving, so the host can
still take it off.

## Changed after it went live (Luke, 2026-11-02)
- ADD is now two keys for a crown: `[ + ADD ]` always puts a video on your own list (ADDED); beside it a
  plus with a crown above it (`mark-add-queue`, the font's ♛ over `+` until drawn) puts it straight into the
  queue (QUEUED). Without a crown there is only `[ + ADD ]`. Same for a pasted link. (The /web page's
  add-to-the-room-I-host panel is unchanged: it still follows the host's crown.)
- The room's QUEUE line and `[ + ADD VIDEO ]` are one key, `[ QUEUE ]`.
- No red, green and blue chips in the queue window: the titles themselves are those colours, each a shade
  that reads on its theme's window (Luke chose readable shades over the exact dyes, which fail as words:
  Royal Blue 1.9:1 and Rose 3.8:1 on the dark window, Emerald 2:1 on the bright one).
- Every title in the window is one line, cut with `...`; the whole title is its hover tip.

## Data (needs Luke's typed OK before anything is run)
In plain English:
- Every row in `watch_queue` gets a yes/no mark, **in the queue**. Every existing row reads yes, so past
  streams and their board records do not change. A new addition is written as no (it is somebody's
  addition); pulling it in sets it to yes and gives it a place.
- A new table, `watch_crowns`: one row per room and person who holds a crown (who gave it, when). Anybody
  who can read the room can read it; only that room's current host can add or remove rows, their own
  included. GO LIVE writes the host's own.
- The rules change: anybody signed in may add to their own list in a live room; only somebody with a crown
  may put rows into the queue, reorder it or take out what has not played; only the host still marks what
  played (the existing `watch_queue_plays_by_host` rule, kept by a trigger); you may delete your own
  additions that were never pulled in.
- `watch_crowns` joins the realtime publication. The mock repository keeps the same rules by hand.
- Migration through `npm run db:new -- watch-queue-additions`, `npm run db:push:dry`, `npm run db:push`;
  written to be re-run (`if not exists`, policies dropped and recreated by name).

## How it should look and feel
- The pop-up split down the middle at desktop width; in a narrow window the two halves stack (queue first).
- Right half, without a crown: `YOUR ADDITIONS`, each row with `[ × ]` to take it back.
- Right half, host or crowned: one fold per person - the crown, the name in its colour, `(n)` - opening to
  their additions, each draggable and with a `[ ← ]` key that adds it to the end of the queue.
- The crown: the `mark-crown` / `mark-crown-filled` slots (to be added to app/lib/ui/art/slots.ts), the font's
  chess queens (♕ hollow, ♛ filled) until Luke draws them. Only the host can press one; everybody sees them.
- Dragging: pick up an addition, a line in the queue shows where it will land, drop to place, ESC cancels.
  Pointer events rather than HTML drag and drop, so a finger works too (phones get the desktop zoomed out).

## Proof
- A check of the pure rules (who may do what; positions after a drop), proven to fail first.
- A policy probe against the live database with TEST ACCOUNT A and B (writes, so named outside the
  `check-*` pattern), once `.env.test` is back on this machine; otherwise the mock, and say so.
- Screenshots of the host's, a crowned person's and a plain watcher's window, at desktop and narrow width.
