# SPEC: a little TV in the player bar, and the character who watches it (Luke, 2026-11-28)

Rules to read first: `.claude/rules/art.md` (whole), `frontend.md`, `media.md`, `docs/design.md`, `docs/theming.md`,
`docs/companion.md`, `SPEC-companion.md`.

## Goal, in Luke's words
2026-11-28: "another feature request too, when video is playing from media or any video that is playing in the room, it
will appear in a small voxel tv at a 2.5d angle showing the screen with accurate perspective, small enough to fit inside of
the player bar at the bottom of the site,  the character will also crawl down and sit to watch the tv which does in fact
display a small just about legible version of the video. this is all done to the right of the live audio visualiser which
sits on the left inside the black sapce of the player bar."

## Decisions
- **The TV's artwork: NOT SETTLED.** Luke, 2026-11-28, to "TV in the player bar: the little TV is artwork, so code can't
  draw it (your art rule). Who makes it?": "use voxels same as with the backrounds". The coordinator is asking him what he
  means. Until it is settled the TV is an art slot with its placeholder, and code draws nothing.
- **YouTube: stills.** Luke, 2026-11-28, to "... What should the little TV do while a YouTube video plays?": "Stills
  (Recommended)": the TV shows YouTube's own three still pictures from that video, changing as it plays, and the character
  sits and watches. Vimeo and Twitch have no stills: dark screen, the character still watches.
- **LUKE'S SERVER films: dark screen.** Luke, 2026-11-28, to "... May a session add a few lines to the small bridge program
  on SERVER (outside the site's code) so it sends tiny pictures to the TV?": "Not now": nothing on SERVER changes; server
  films get the TV and the character with a dark screen.
- **The character: half size.** Luke, 2026-11-28, to "... How should it sit to watch?": "Half size (Recommended)": it
  climbs down over the front of the bar, shrinks to one block per pixel, and sits inside the black beside the TV. The bar's
  words and keys stay clear.

## What Luke sees
1. A video starts (from MEDIA, your room, or a stream room's screen). A small TV appears at the right end of the player
   bar's black space, seen at an angle, with the picture slanted onto its screen. The visualiser stays on the left.
2. His character walks along the top of the bar to above the TV, crawls down over the black, sits beside the TV facing it,
   and watches.
3. The video stops, ends or is closed: the TV goes and the character climbs back up.
4. With no video, the bar looks as it does today.

## What the screen shows
| The video | The TV's screen |
|---|---|
| The site's own files and uploads, a room's own files, Internet Archive files, streams the site's player plays | The moving picture |
| YouTube | Its three still pictures, by how far through the video is |
| Vimeo, Twitch, PeerTube, Internet Archive's embedded viewer, KinoSources/TagStation frames, LUKE'S SERVER | Dark |
| A song (the cover card), a screen share, a SCREENS device | No TV |

Why: a page cannot read the picture inside another site's frame. YouTube's own terms say its player is at least 200 x 200
and not covered (developers.google.com/youtube/terms/required-minimum-functionality, searched 2026-11-28), so the player is
never moved into the TV.

## Defaults (Luke can change any of these)
- The video keeps playing in its normal player; the TV is an extra view, with no sound and no press of its own.
- Paused: the picture freezes and the character stays seated.
- Own screen only: nothing is sent to a room, and nobody else sees it.
- Reduced motion (or MOTION OFF): a still picture, and the character is simply there, seated; no crawl.
- A hidden tab: no drawing.
- Watching the TV comes before dancing and typing along; a `!` or hop for a message still happens, seated.
- Picked up or thrown, it leaves its seat; it goes back after landing if the video is still on.
- Between two videos of a queue the TV stays for a moment rather than blinking out.
- No TV when the bar is hidden or folded, or at phone width. No companion (switched off, signed out): the TV alone.
- No on/off switch (none was asked for).

## How it is built
- **The TV's art** is a slot (`app/lib/ui/art/slots.ts`, shown by `SpriteSlot`): `assets/sprites/player-tv.png`. While the
  file is missing the slot is the site's dithered field. The screen's four corners are four numbers beside it
  (`app/lib/player-tv/`), so his TV drops in by swapping the file and the corners.
- **The picture** is a small canvas fed from the one `<video>` already playing (no second download or decode), at no more
  than 12 frames a second, pinned onto the four corners with a CSS `matrix3d` four-point transform (true perspective). The
  element comes from `app/lib/ui/floating-player.ts` and `app/lib/audio/room-screen-sound.ts`.
- **Stills** use `youtubeStills` (`app/lib/watch/bar-watch.ts`) and the player's own clock.
- **Where:** in the normal bar (`MusicPlayer.tsx`) and a room's strip (`WatchRoom.tsx`), inside `[data-bar-led]`, right of
  the words and left of any key already there; its own opaque box, so the visualiser stops at its edge.
- **The character** (`app/lib/companion/`): a new place to sit; drawn above the bar and at one block per pixel from the
  start of the way down to the end of the way up; its path stays over the black and never over a key.
- **The crawl** is one new motion, `crawl`, in `app/lib/character/motion.ts` with its `MOTION_FALLBACK` entry (an old strip
  plays `climb` until its owner's browser bakes again): only turns of the joints of the owner's own built character
  (art.md, "Code-made motion isn't artwork"). No shapes added, no existing motion changed.
- New files: `app/components/PlayerTv.tsx`, `app/lib/player-tv/`.
- No database change.

## Order
1. The rules (which source shows what, which still, the corner transform) with their check.
2. The TV with its placeholder slot.
3. The crawl and the seat.
4. The lines in the bar and the room's strip, **only after ROOM-DEVICE-SYNC has pushed** (those files are its until then).
5. Luke's TV, when the art question is settled.

## Proof (each check seen failing first)
- `Temp/check-player-tv.cjs`: the transform puts the picture's corners on the TV's corners; each kind of video gets the
  right screen; the stills change at the right times.
- A check that every motion that existed before bakes the same frames as before.
- A real-browser drive on a local mock server with a known test clip: screenshot pixels inside the screen change and match
  the clip, and are slanted as designed; stills for a YouTube entry; no TV with no video; the character reaches the seat and
  leaves it; the bar's keys still work; no sideways scroll at 390.
- Cost while playing, measured once.
- The house loop (verify, checks:changed, capture + audit, verify:clean, push, deploy-status, read), then local
  screenshots to Luke through the coordinator. Whether it LOOKS right is his to judge.

## Out of scope
- LUKE'S SERVER's bridge (`G:\MEDIA-HOST`): not touched.
- Capturing the tab to get a framed player's picture.
- Showing the TV to other people in a room; screen shares and SCREENS devices; phones.
