# SPEC: YOUR ROOM LIKE THE LIVE ROOM, A ROOM WINDOW THAT LIFTS, AND BACKGROUNDS IN FULLSCREEN (Luke, 2026-11-16)

Luke, in his words: "in the pre room version of the room i need it so the ui is congruent with the streaming version. need to be
able to lift the viewport from player bar more easily, when fullscreening a video that has black bars i want the black bars
replaced by the backround of the website that is selected."

A plan, from his answers and a read of the code. Not built. Where the code is: an exploration's notes are summarised under each
part; file and line numbers are as of commit `492ad29`.

## Luke's answers (2026-11-16)
1. **"Pre room" is YOUR ROOM**, the JUST YOU window before GO LIVE (`app/components/OwnRoomWindow.tsx`).
2. **Lifting:** "instead of the small folding viewport, that should just be pip, but dont do pip by default have the room open by
   default, the thing i was intiially refering to was lifting the whole room window off of the player bar at the bottom, it seems
   to stick to it".
3. **Black bars, all of them:** "do all of them even if it involves some weird workaround like drawing the bars ontop of the video
   or maybe preferably fullscreening these videos with bars in such a way that they arent fullscreen really but just take up the
   space required."
4. **The background in fullscreen is live** (fish swimming, sand falling).

## Part 1: YOUR ROOM looks and works like the live room
Today YOUR ROOM is a stack: the screen, a block of text with GO LIVE in it, the queue underneath, and no keys of its own (the
video is the site's one floating player, with YouTube's or Vimeo's own controls). The live room (`WatchRoom.tsx`) is a picture
with a bar of keys under it (PLAY, seek, next, sound, QUALITY, SUBS, PIP, FULL), and a side column (`[ QUEUE ]`, the cog, the
crawl, chat).
- YOUR ROOM gets the same frame: the picture with the same bar of keys under it, and the same side column, with `[ QUEUE ]` and
  the cog in the same places. Where the live room has chat, YOUR ROOM has JUST YOU HERE and `[ GO LIVE ]`.
- A key that can't do anything alone (END, the crawl) is not drawn; nothing is shown disabled.
- Pressing GO LIVE turns the same window into the live room without anything moving: same picture, same bar, chat arrives.
- **How:** the smallest honest way is to give YOUR ROOM the live room's own picture-and-bar (`WatchRoom`'s stage) fed by a room of
  one, in place of the shared floating player. That touches the rule that a video plays in one player (SPEC-floating-player.md):
  what is playing in YOUR ROOM moves into the room's player when the window opens and back out when it shuts. The alternative
  (keep the floating player and draw look-alike keys that drive it) is less work but two sets of keys to keep the same. To be
  decided when building, with the first preferred.

## Part 2: the room window, the bar, and PIP
- **The room window lifts off the bar.** It sticks today because the window is drawn "no lower than the music bar"
  (`aboveBottomBar`, `DockWindow.tsx`): its foot is pinned to the bar and dragging it up only makes it taller until its full
  saved height fits, so it feels glued. Change: the window moves as one piece. Its height is what it is drawn at when the drag
  starts; it can be dragged anywhere above the bar and stays where it is put. It still can't go under the bar.
- **The room is open by default**, as a window, when you enter or make one.
- **Folding is PIP.** The small folded tile above the bar (the up-arrow box for a live room, `[ ▲ ROOM ]` for yours) goes. The
  `[ _ ]` key on the room window puts the picture out as the floating picture (what `[ PIP ]` does now) and tucks the window
  away; the floating picture has the way back to the window. Never by itself: PIP happens only when you press for it.
- The floating picture drags by the picture, not only by its thin title line, and its corner grips get bigger.

## Part 3: fullscreen shows the site's background, not black bars
What can be done for each kind of video:
- **The site's own player** (files, HLS, a stream room's `<video>`): the picture is fitted inside a box the site owns, so the bars
  are the box's background. Easy.
- **YouTube / Vimeo / Twitch frames:** the bars are of two kinds. Round the frame (the screen isn't the frame's shape): the
  site's, easy. Inside the frame (a 4:3 video in a 16:9 frame): theirs, and can't be recoloured.
- **Luke's answer covers the second kind by making the frame the video's own shape**: instead of real fullscreen for these, the
  picture "fills the screen" as the site's own full-window view, and the frame is sized to the video's true width and height, so
  the other site has no bars to draw. The true shape comes from what the site already knows about the item (YouTube and Vimeo
  give a width and height with a video's details); when it isn't known the frame stays 16:9. Bars burnt into the video's own
  pixels stay: nothing outside the video can remove them.
- **So FULL becomes two things under one key:** the picture and its bar fill the whole screen (real fullscreen of a box the site
  owns, never of the bare frame), and inside it the frame is the video's shape with the chosen background all round it.
- **The background in there is live.** Only what is inside the fullscreen box shows, so the box holds a second, small copy of the
  chosen background (AQUARIUM, SAND and the rest, or TILE's pattern), running only while fullscreen is on, and the page's own copy
  rests meanwhile (it can't be seen). The backgrounds were built to run from one component each, so this is a second mount, not a
  second design.
- Double-press to fullscreen keeps working; ESC leaves as now.

## Out of scope
Changing what a room is or how it syncs; chat in YOUR ROOM; phone layouts (desktop first; nothing may break at phone width);
removing bars that are part of a video's own picture.

## Risks
- Part 1 moves YOUR ROOM off the shared floating player; the one-player rule and the drives that hold it
  (`scripts/drive-own-room.cjs`, `scripts/drive-floating-player.cjs`) change on purpose.
- Part 3 changes which element goes fullscreen (a box, not the frame): `drive-floating-player.cjs` asserts the frame today.
- A video's true shape isn't always known before it plays; the frame may be 16:9 for a moment, then settle.
- Real accounts and real YouTube can only be proved on the live site (short, one at a time, per core.md).

## Proof
Checks that render the room windows keep passing or are updated on purpose (`Temp/check-watch.cjs`,
`Temp/check-floating-player.cjs`, `check-room-settings`, `check-window-layout`); local drives on the mock server for YOUR ROOM's
layout, GO LIVE in place, the window dragged off the bar and staying, `[ _ ]` to PIP and back, FULL with each background and the
frame at 16:9, 4:3 and 21:9; then the house loop.
