# SPEC: a little TV in the player bar, and the character who watches it (Luke, 2026-11-28)

Rules to read first: `.claude/rules/art.md` (whole), `frontend.md`, `media.md`, `docs/design.md`, `docs/theming.md`,
`docs/companion.md`, `SPEC-companion.md`.

## Goal, in Luke's words
2026-11-28: "another feature request too, when video is playing from media or any video that is playing in the room, it
will appear in a small voxel tv at a 2.5d angle showing the screen with accurate perspective, small enough to fit inside of
the player bar at the bottom of the site,  the character will also crawl down and sit to watch the tv which does in fact
display a small just about legible version of the video. this is all done to the right of the live audio visualiser which
sits on the left inside the black sapce of the player bar."

## Decisions (all 2026-11-28; relayed word for word by the coordinator, who asked him)
- **The TV: code builds it.** Luke, to "TV in the player bar: the little TV is artwork, so code can't draw it (your art
  rule). Who makes it?": "use voxels same as with the backrounds". Then, to "TV in the player bar: you answered "use voxels
  same as with the backrounds". Do you mean code may build the little TV itself out of plain voxel blocks, as a new
  exception to your art rule (the way code is allowed to draw the backgrounds)?": "Yes, code builds it" (the option read:
  a plain TV out of blocks in code in the site's own inks, seen at the 2.5D angle; he draws or builds nothing; written into
  the art rules as an exception for this TV only; the risk named: the first object, not a background, that code may
  depict). He did not choose "Code now, mine later".
  - **The rule line is not in `.claude/rules/art.md` yet** (see "The art rule line" below). No code that builds the TV is
    written until it is.
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

## The TV, block by block (plain and small; nothing else is added)
| Block | What it is |
|---|---|
| 1 case | the box of the set |
| 1 screen | the flat face on the front of the case where the picture goes |
| 2 aerials | thin square rods on top, leaning apart |
| 2 feet | small blocks under the case |
| 1 knob | a small block beside the screen |

Flat faces in the house inks (tokens only), a different ink for the front, side and top so the angle reads. No outline art,
no texture, no face, no logo, no words. It stands at a fixed three-quarter angle and does not turn or move.

## The art rule line (proposed, to be added to `.claude/rules/art.md` under "A simulated background isn't artwork")
> - The player bar's TV (Luke, 2026-11-28: "use voxels same as with the backrounds", and to "Do you mean code may build the
>   little TV itself out of plain voxel blocks, as a new exception to your art rule (the way code is allowed to draw the
>   backgrounds)?": "Yes, code builds it"): code may build this one TV from plain blocks (case, screen, aerials, feet and a
>   knob at most) in the house inks from the tokens. Only the player bar's TV; nothing else is made that way; never a
>   character, never an icon.

The character is not touched by this: still only the owner's own hand-built character, its joints turned.

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
- **The TV** is its own small module (`app/components/PlayerTv.tsx`): the blocks above as flat page boxes placed in 3D by
  CSS (`perspective`, `preserve-3d`), so the browser does the perspective itself. No 3D library, no picture file. Kept in
  one place so it could be swapped later; no swapping machinery.
- **The picture** is a small canvas lying on the screen face (so it is slanted exactly as the face is), fed from the one
  `<video>` already playing (no second download or decode), at no more than 12 frames a second. The element comes from
  `app/lib/ui/floating-player.ts` and `app/lib/audio/room-screen-sound.ts`.
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
1. The rules (which source shows what, which still) with their check.
2. The TV: blocks and picture, once the art rule line is in.
3. The crawl and the seat.
4. The lines in the bar and the room's strip, **only after ROOM-DEVICE-SYNC has pushed** (those files are its until then).
5. Two or three local screenshots of the TV in the bar to Luke, **before the push**: his eye decides whether it looks right.

## Proof (each check seen failing first)
- `Temp/check-player-tv.cjs`: each kind of video gets the right screen; the stills change at the right times; the TV has
  the blocks above and no others, in token inks.
- A check that every motion that existed before bakes the same frames as before.
- A real-browser drive on a local mock server with a known test clip: screenshot pixels inside the screen change and match
  the clip, and are slanted as designed; stills for a YouTube entry; no TV with no video; the character reaches the seat and
  leaves it; the bar's keys still work; no sideways scroll at 390.
- Cost while playing, measured once.
- Local screenshots to Luke through the coordinator, then the house loop (verify, checks:changed, capture + audit,
  verify:clean, push, deploy-status, read). Whether it LOOKS right is his to judge.

## Out of scope
- LUKE'S SERVER's bridge (`G:\MEDIA-HOST`): not touched.
- Capturing the tab to get a framed player's picture.
- Showing the TV to other people in a room; screen shares and SCREENS devices; phones.
