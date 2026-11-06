# Floating player and site arrows (Luke, 2026-11-05)

## What Luke asked for
"Allow to stream any piece of media with no fuss directly from where you are watching it. Do the same with picture in
picture. Give the site back and forward arrow buttons that save your place on the page and progress in whatever video, but
when clicking on something new in the site that would normally take you away from the video, now just have it continue in
pip seamlessly."

## Luke's answers
- **Floats when:** you go to another page, press `[ PIP ]`, or scroll past the video.
- **Arrows:** `[ ◄ ] [ ► ]` left of the page tabs.
- **In a room already:** a new video goes to the back of the queue.
- **`[ WATCH IN ROOM ]`:** one press on a video opens the room settings menu, which includes a privacy choice from the
  privacy plan. **Held until private streams are real**, by his choice: see the last section.

## Part 1, build now: the floating player
- **One video at a time, never reloaded.** A cross-origin iframe restarts if it moves in the page, so every video lives in
  one layer in `app/layout.tsx`. A row keeps a reserved box, and the layer sits exactly over it while it's on screen. The
  box keeps its size, so nothing on the page moves. This covers every video: MEDIA's platform embeds (`WebStream.tsx`),
  media servers (`WebMediaRow.tsx`) and the site's own files (`MediaCatalogue.tsx`, `WebSiteFiles.tsx`).
- **Floating:** the layer moves to a corner of the site when the box goes away or scrolls out of view, or on `[ PIP ]`. It
  drags and resizes like the site's windows, and stays clear of the music bar and the start bar. Coming back to the page
  puts it back in its box.
- **Keys on the float:** back to where it came from, close, and for our own files the browser's real pop-out.
- **A second PLAY** replaces the video playing.
- **Limit to say plainly:** the float is inside the site's tab. Only `<video>` files can use the browser's own pop-out that
  stays above other apps. Most outside players, such as YouTube, can't.
- **Rooms:** `[ PIP ]` exists in a room only for `<video>`. Give embedded room pictures the same float if it can be done
  without reloading or losing sync. If not, say why and leave rooms as they are.
- **Rules that stay:** nothing from a platform loads until the reader presses PLAY. Playback stays the platform's own
  embed. Moving things stop under `prefers-reduced-motion`. Text stays readable in every theme.

## Part 2, build now: the arrows
- `[ ◄ ] [ ► ]` left of PROJECTS in the nav, going back and forward through the site's history. Each goes quiet when it
  has nowhere to go. Named for screen readers, and tappable on a phone.
- **Your place on the page:** scroll position saved per history entry, and restored once the content has loaded, since
  MEDIA's rows arrive late. The site's own scrolling panes count, not only the window. Filters and searches stay in the
  address, as they are now.
- **Progress in a video:** a video still playing simply carries on. After it's closed, its place is kept for the visit and
  it resumes from there. Only players that report their time can do this: the site's own files and the players in
  `app/lib/watch/*-player.ts`. Others, such as an Internet Archive embed or a media server's own player, can't. Say so
  rather than pretend, and don't store any of this on the server.

## As built (2026-11-05)
- **Rooms float too:** `[ PIP ]` on an embedded room picture folds the room, and the picture's box goes `position: fixed`
  where it stands, so the player never moves in the page and the sync never notices. A room's `<video>` keeps the browser's
  own pop-out. A room's picture floats bottom-left, MEDIA's bottom-right, so they don't start on top of each other.
- **Resuming** works for the site's own files, YouTube and Vimeo. YouTube's and Vimeo's time comes from messages to their
  frame (`app/lib/web/embed-time.ts`), not their scripts, so nothing of theirs runs in our page. Internet Archive, PeerTube and
  media servers can't say, so they start again from the top. Places last for the visit, in memory, and go on a full reload.
- **The wheel over a video or the float** still scrolls the page: the layer is outside every pane, so the player sits in a
  small scrolling room of its own and hands what lands there to the page's pane (`passScrollToPane`). That room must never move
  by itself, or the page gets scrolled: its anchoring is off and it re-centres at each switch between box and float.
- **A book's reader** (kind `text`) and anything else not video or audio keeps its frame in its row and doesn't float.
- **FILES:** opening a fold no longer loads the player; it has its own `[ ▶ PLAY ]`, so reading a file's details never replaces
  the video playing. A catalogue search isn't in the address, so a video started from one floats until the search is typed again.

- **Fullscreen by double press (Luke, 2026-11-05).** Nothing is put over a player, so its own controls keep working. Our own
  files and PeerTube do it themselves, both ways. YouTube's embed only pauses and plays on a double press, so its messages are
  read: paused and straight back to playing within `DOUBLE_PRESS_MS` is the double press, and our page fullscreens the frame.
  Internet Archive goes in by itself but stays until Esc or its own key. A media server's player is up to that player. In a room,
  YouTube's clear cover and our own `<video>` hand a double press to the existing FULL. Every row and the float have a
  `[ FULL ]` key, and a double press on the float's title line does the same.

## Part 3, held: `[ WATCH IN ROOM ]`
Luke chose to build privacy first, so don't add this key until the privacy plan's private stream phases (2 and 3) are live.
Today's `[ WATCH ]` key on a video reads `[ ADD TO ROOM ]` since 2026-11-05 (Luke; `WebWatchKey`), and does what it did. Where
this part says `[ WATCH ]`, it means that key.
- It replaces today's `[ WATCH ]` and `[ ▶ STREAM ]` go-live route on every video, from wherever it's being watched.
- One press opens the room settings menu (`RoomSettingsWindow.tsx`): name, topic, who can add, and WHO CAN JOIN from the
  plan, with PRIVATE already picked. A second press starts the room, so a stray press never posts a thread.
- The room starts with that video, from where the viewer had got to when the player can tell.
- Already hosting or holding a crown: the video goes to the back of that room's queue, or onto your own list without a crown.
