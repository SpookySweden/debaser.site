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

## As built (2026-11-16)
Parts 1 and 2 are as written above, with these differences: YOUR ROOM keeps the site's one floating player, drawn in the live
room's frame with the room's keys driving it (the other site's own controls still show; no QUALITY or SUBS there); `[ ▲ ROOM ]`
stays as the way in, on the corner shelf beside `[ ▲ WINDOW ]`; a window that fills the whole space has to be made shorter
before it can lift.

Part 3:
- FULL and a double press fullscreen a box the site owns: the live room's stage (picture and bar) or its floating picture, and
  the floating player's own box (YOUR ROOM, a MEDIA row, the float). Never the bare frame or video.
- In there the picture is the video's own shape, as large as fits, in the middle, and the chosen background runs live round it
  (a second copy, only while fullscreen; the page's own rests). Sand rests on the picture; a press on the surround pours or
  splats as on the desk. A double press on the surround leaves; so does ESC.
- The shape: the site's own files say it themselves; YouTube and Vimeo are asked through their public oEmbed, from the browser,
  once a video (`app/lib/watch/video-shape.ts`); anything else is 16:9. The room's YouTube player is told the shape and makes
  YouTube's frame that shape, in the window too.
- The site's own files lose the browser's own fullscreen key and double press in Chrome and Edge (`controlsList`), because
  those show the bare video with black bars; `[ FULL ]` and a double press on the picture do the site's instead.
- Another site's own fullscreen key is switched off (Luke, 2026-11-16: "Switch it off"): every outside player's frame is
  given no permission to go fullscreen by itself (the floating player's frames, and a room's Vimeo, Twitch and server players;
  the room's YouTube never had one), and YouTube and Vimeo are asked not to draw the key. `[ FULL ]` and a double press are the
  way, and those show the background. Any other player may still draw a key that does nothing. A browser that cannot
  fullscreen a box (an iPhone) keeps the other site's key: it is the only fullscreen that works there.
- Bars burnt into a video's own pixels stay. A video whose site answers the wrong shape has bars inside its frame, as before.
- Proof: `Temp/check-video-shape.cjs` (13 deliberate breaks, all caught) and `scripts/drive-rooms-your-room.cjs`, run with
  AQUARIUM, STARFIELD, SAND and TILE chosen (`--backdrop`). Not proved: Vimeo and Twitch in a browser, a real 4:3 YouTube
  video (the drive tells the frame 4:3 by answering for YouTube), two accounts, phones.

## Part 4: black bars found by themselves, and `[ BKG ]` (Luke, 2026-11-16; built the same day)
Luke: "i want you to find a way to auto detect the bars for every video", "and to have it be a toggle called bkg which
appears inside of the bar/backround in the top left corner of it similar to the backround settings button".

- **What is found.** Bars a player adds because its frame is not the video's shape, and bars in the video's own pixels. A
  still of the picture shows both the same way, so one detector does both (`app/lib/watch/video-bars.ts`).
- **Where the pictures come from** (`app/lib/watch/bar-watch.ts`), in the browser only:
  - a file the site plays itself (its own files, an Archive episode in a room): read from the picture as it plays, every few
    seconds, where its host lets a page read it (the site's own storage and the Archive's file servers);
  - YouTube: the three stills it publishes of every video (`i.ytimg.com/vi/<id>/mq1.jpg`, `mq2`, `mq3`), which any page may
    read. Long-standing, written down nowhere by YouTube: if they go, nothing is trimmed;
  - Vimeo: the one picture in its oEmbed answer, believed only when it is the video's shape (an uploader may put any
    picture there);
  - nothing for Twitch, an embedded Archive or PeerTube player, or a friend's server: a page may not read their pictures.
- **It errs towards doing nothing.** A picture too dark to judge is not counted. Black along an edge is a bar only where
  picture starts hard against it: a title on a black card, a lit face on a dark stage and a night sky have black edges and
  no line where the picture begins. Enough pictures must show the same hard edge (two of YouTube's three stills; three
  looks at a playing file, each a second of video apart), and none may show anything inside it: subtitles sitting in a bar
  mean trimming it would trim them, and one picture that fills the frame means there is no bar. An edge counts only with
  its opposite; slivers are left; never more than 42% from an edge. A playing file's trim, once found, is held through dark
  scenes and let go for the rest of the play the first time something shows in a bar.
- **What is done with them, in fullscreen only.** The picture is the shape of what is left, and the bars fall outside it,
  where the background shows. A file of ours shows only that part of its picture (its controls whole). Another site's frame
  is made bigger than its box by the bars and cut back to it, which cuts its own controls off with them: so the floating
  player's fullscreen box has the site's own keys along its foot for YouTube and Vimeo (play, seek, sound, EXIT), as a live
  room's always had. In a live room only YouTube's player and the room's own video are trimmed; Vimeo's and Twitch's lay
  themselves out.
- **`[ BKG ]`**, in the top-left corner of whatever is fullscreen, quiet until pointed at. Pressed in (how everybody starts):
  the background, bars trimmed. Out: the video as its player shows it, nothing trimmed, no background, no second bar of
  keys. Kept in this browser (`app/lib/ui/stage-bkg.ts`). It is also the way out when bars were judged wrong.
- **Not every video**, said plainly: see the list above. And a watermark or channel logo sitting in a bar makes that edge
  look like picture, so those bars are left on.
- Proof: `Temp/check-video-bars.cjs` on made-up pictures and a made-up playing file (23 deliberate breaks, all caught; it
  also found that a speck of compression hid a bar, a guard that guarded nothing, and that subtitles after a dark scene
  were trimmed for a while). The review of the first build found that a title card or a subject on black was taken for
  bars: the hard-edge rule above is the answer, and both are in the check. `scripts/drive-rooms-your-room.cjs` makes a letterboxed clip
  and stand-in YouTube stills and holds the trimmed picture's place, `[ BKG ]` and the keys (23 steps). The drive found two faults: the surround could be scrolled to a hung bar (`overflow: clip` now), and the bar of
  keys sat in the picture's row. (Part 2 changed 2026-11-16, Luke's second list: `[ _ ]` folds a room to its key on the corner
  shelf above the player and floats nothing; `[ PIP ]` is the only way the picture floats; the floating picture has no BACK,
  FULL or GO LIVE, and the shelf key is the way back. A window kept above the bar is lifted whole, never shortened, unless it
  is taller than all the room above the bar. Proof: `scripts/drive-roomfix.cjs`.) Not proved: real YouTube stills of a real letterboxed video, Vimeo, the site's real
  storage answering the way a read needs, phones.

## Part 5: your own devices together (Luke, 2026-11-27; built the same day)
Luke, typed: "when two of the same account are watching media in a room, make sure the pause play and volume controls are all synced."
- Play, pause and jumps already followed between one account's devices (earlier the same day: 1A "last one touched" leads, 2A
  "follow live" on the bar, 3A LUKE'S SERVER driven). Checked again on two tabs of one account for a file, YouTube, LUKE'S SERVER
  and the music bar (`scripts/drive-same-account.cjs`, steps 1-11): all followed, nothing to fix. An outside player the room
  cannot drive (PeerTube, the Archive's, LUKE'S SERVER with its remote off) takes no orders, so it cannot follow.
- The room's speaker key (volume line and MUTE) now follows between your own devices in the same room, any room, and never
  anybody else's. It moves files, YouTube, Vimeo, Twitch and LUKE'S SERVER when driven. A change made inside another site's own
  player (YouTube's own slider) is not heard.
- His answers (asked through the coordinator, word for word):
  - "Should the bar's volume also follow between your devices?": "Yes, it follows (Recommended)". The bar's volume follows while
    your bars play your room.
  - "When a second device of yours joins the room, should it take the volume your other device already has?": "Take current
    volume on join" (told the risk: a loud jump on headphones). A device that comes in asks; one that was there first answers.
  - The database rule: "Yes, add it (Recommended)", for exactly two Realtime rules on a channel `account:<own id>` that only that
    account may hear or send on (`supabase/migrations/20261127100000_own_device_line.sql`). Nothing is stored.
- How: `app/lib/watch/own-devices.ts`, `WatchRepository.joinOwnDevices` (mock: a BroadcastChannel between tabs), the room's
  `turnVolume`/`turnMuted` in `WatchRoom.tsx`, the bar's `use-own-bar-volume.ts` in `MusicRoomKeeper.tsx`.
