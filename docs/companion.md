# The companion

Read this before touching the companion. The specs it was built from are `SPEC-companion.md` (Luke, 2026-11-13) and its
"Widened" section (2026-11-14). It wears a baked character strip: `docs/profile-characters.md` covers the motions and the
bake.

## The pieces
- `app/components/Companion.tsx`: the layer over every page (in `app/layout.tsx`), your own figure and other people's in a
  room. One loop, ten frames a second, written straight to the figure's style through refs, so nothing re-renders.
- `app/lib/companion/brain.ts`: what it decides, kept pure (the clock, pointer, music and dice are handed in). Also the
  fall after it is let go (`fallStep`).
- `app/lib/companion/throw.ts`: being thrown, kept pure: the speed a let-go reads off the pointer, each frame of the
  flight (gravity, drag, the edges of the screen, the floor), and how each frame is drawn (squash, stretch, the wind-up's
  pull back, where the smear's copies sit).
- `app/lib/companion/wire.ts`: what a companion tells a stream or music room, riding on the room's own presence. Also
  which one-off motion each reaction plays (`reactionMotion`) and which loop a mood and pose draw (`loopMotion`).
- `app/lib/companion/events.ts`: `pokeCompanion(kind)`, the one way the rest of the site tells it something happened.
- `app/lib/companion/floor.ts`: where it stands and what it steps around (`data-companion-avoid`, the floating video, and
  any open window reaching into its strip). `floorFrom` is the pure part.
- `app/lib/companion/ledge.ts` (and `use-ledge-headroom.ts`): the room a stream room's window leaves above itself, so
  companions can stand on its top edge.
- `app/lib/companion/scene.ts` and `use-companion-scene.ts`: what you are doing that it joins in with, and the one-line
  hooks the reader, the arcade and the stream room call.
- `app/lib/companion/visit.ts`: climbing into a profile's ROOM and back.
- `app/lib/companion/loose.ts` and `app/components/LooseCharacter.tsx`: a profile ROOM's character taken out of its
  window by whoever is looking, carried, thrown, and walking and climbing back in (`RoomWalker` in `ProfileCharacter.tsx`
  starts it).
- `app/components/NoteTrail.tsx`: the text that drifts up from it: music notes for a dance, `z`s for a sleep.
- `app/lib/character/rebake.ts`: bakes an old strip again, once, in its owner's browser.

## How it moves
- **A mood, a pose, an act.** The mood is one of six (`stand walk sit sleep dance chase`) and decides where it goes. The
  pose is a loop played in place of the mood's own (`run` for a chase, `curl` for a long sleep, which dance). An act is a
  one-off played through once (a hop, a stretch, a cheer, a landing); anything longer than a hop is done standing still.
- **Being picked up** is a phase beside the room visit's (`held`, then `fall`): the brain is not asked while it is in the
  reader's hand. Two ways in (Luke's list, 2026-11-14): press and drag, or two presses close together (`DOUBLE_MS`),
  after which it follows the pointer with nothing held down until the next press, Escape or the window losing focus
  puts it down. On a phone press-and-drag is the natural way; a double tap also lifts it and the next touch puts it
  down there. Either way it starts and wriggles once (`lifted`, with a `!`) before it hangs (`dangle`). It is clamped to the screen and above its own floor, and lands on the nearest stretch it can stand on.
  Under reduced motion nothing is carried.
- **Thrown** (Luke, 2026-11-14: "retain momentum and splat against the edge of the screen and obey the principles of
  animation such as squash and stretch and wind up and smearing"). A third phase after `held`: `thrown`. Let go while the
  pointer is moving (`releaseVelocity`: its moves over the last tenth of a second; at rest, or slower than `THROW_MIN`,
  it is only put down and drops as before), it keeps that speed. In order:
  - *wind-up*: two frames held where it was let go, pulled back against the throw and pressed short along it;
  - *in the air*: gravity and a little drag, drawn out along its path (`stretchFor`), playing `flung`, and when it is fast
    two fainter copies of the frame it is showing trail back to where it was a frame ago (the smear);
  - *an edge of the screen* (left, right, top): at `SPLAT_SPEED` or more into it, a splat: flat against it, playing
    `splat`, stuck for six to twelve frames (slipping down a side), pressed once more, then it peels off and drops.
    Slower, it bounces off with half its speed and one frame of squash;
  - *the floor*: it bounces (two fifths of its speed back), squashed on the frame it lands, until it is too slow to; in
    low and fast it skids; down on something it steps around (the folded player) it hops off to where it can stand;
  - *down*: the landing's squash, a spring back and a smaller dip (`settleFrames`) over its `land`; after a splat it is
    `dizzy` instead (it reels with stars going round its head, shakes it off) and then hops.
  A squash keeps as much of it as there was: pressed to half its length it spreads by the square root of two (`acrossFor`).
  Everything is its own baked frame scaled, nudged or copied with a plain 2D transform on hard pixels: nothing is drawn,
  nothing is blurred, nothing eases. It is the figure's picture, not the empty margin of its box, that meets the glass:
  the margin is read off its `splat` cell the first time it is picked up (`measureInsets`). It can be caught out of the
  air or peeled off the glass by pressing and dragging it. A put-down after a double press throws too if the pointer is
  on the move. Escape, the window going and reduced motion never throw. A room is told nothing while it flies: one
  message when it is down, saying where (and `dizzy`, which older tabs draw as a hop).
- **Shoved by windows** (Luke, 2026-11-16: "If a window pops up on him or moves across him, it pushes him in silly, fun
  ways, like a physics experiment"). `app/lib/companion/shove.ts`, pure. Each frame the loop measures every docked or pop-up
  window and the floating video (`measureWindows` in `floor.ts`; never the room window it stands on) against last frame's
  boxes. A window that has just appeared over it **pops** it out sideways, away from the window's middle, and up; one dragged
  into it **pushes** it the way the window went, at one and a half times the window's speed, up too (a hard drag splats it
  on the screen's edge); one brought down onto its head **squashes** it flat on its floor (a `stuck` against `floor`) and it
  squirts out sideways, dizzy. Each is a throw (`shoveThrow`) with no wind-up, so the flight, smear, splats and bounces are
  the throw's own. In the air a window bats it again (a squash up there swats it down), but the same window waits
  `SHOVE_COOLDOWN` frames. The first look at the page only learns where the windows are. Not in the hand, not climbing to
  a room, not under reduced motion. The knobs are the constants at the top of `shove.ts`.
- **Stepped, but smooth in the hand and the air** (Luke, 2026-11-16: "better framerate and visual tracking when picking
  up, dragging and throwing"). The loop, its walking, its climbing and which cell of its strip it shows stay ten a second
  in whole pixels. In the hand it is placed on every move of the pointer (`followHand`), so it never lags a frame behind.
  Thrown or falling, it is drawn every display frame on the straight line from this frame's place to the next frame's, the
  next worked out a frame early by the same rules (`glide`, `glideAt` in `throw.ts`): exact at every frame, never past a
  wall or the floor. That glide is the one `requestAnimationFrame`, and it runs only while it is in the air. A frame's own
  place is written on the figure (`data-x`, `data-feet`) for the drives.
- **Dragged, it leans** (`dragLook`): its own frame sheared so its feet trail the drag, drawn out along it (the flight's
  stretch), and dragged fast, two fainter copies of the frame trail back along the pointer's path. Luke on smears,
  2026-11-16: "be leniant with the rules where necessary for the sake of creativity and fun": code may stretch, shear and
  ghost his hand-built character's baked frames along its travel; never a new character or shape from nothing.
- **Climbing in, never floating** (Luke's list, 2026-11-16). On its first frame on a page it climbs up over the edge of its
  floor from behind it (the music bar, or the foot of the window). A floor that rises under it (a stream room's window
  opening over the strip, the bar unfolding) is climbed up to from just behind its edge, and one that drops away (that
  window folded or closed) is fallen from. Let go below its floor (carried down the front of a stream room's window it
  stands on), it climbs back up instead of being pulled up in one frame. Somebody else's companion in a room does the
  same. Under reduced motion it is simply there.
- **Joining in.** A scene (`type`, `game`, `read`, `watch`) settles it where it stands in a pose. Typing, a game and a book
  come before the music; a video after it. It hears typing itself (a key into a text box, never which key, never a
  password box). The rest of the site tells it in one line each: `useCompanionScene`, `useCompanionMatch`,
  `pokeCompanion`, `.then(cheerCompanion)`.
- **In a stream room** the window fills the screen down to the music bar, so the strip is behind it. Luke's pick
  (2026-11-14): "Stand on the window's top edge". While that window is over the strip, its top edge is the floor
  (`floor.ts`, `ledgeCovers`): companions walk, sit and dance along it, above the title bar, between the window's
  corners, and are back on the strip when it is folded away or closed. A window that fills the screen has no room above
  it, so it is drawn lower by the tallest companion's height (`DockWindow`'s `headroom`, from `ledge.ts`), only while a
  companion is drawn and only while the window is over the strip (not on a phone's tall screen, where it is not).
  The layer stays under every window: they stand above the window, not in front of it. A place along the floor travels
  as a share of the floor's own width, so a window's edge and a strip agree. Up there, watching is a plain sit.
- A companion missing from one sync of a room's presence is kept on screen a moment (`withLingering`): a tab re-saying
  itself can drop out of a sync and be back in the next.
- **Marks** are text over its head for a moment (`reactionMark`): `!` a reply, a message or somebody online, `VS` a game
  invite, a heart a recommendation, `...` speaking in a room's chat. `...` also shows while it types along.
- **Hellos.** It waves at a companion new to its room (once each, at most every few seconds) and theirs waves at it. In a
  profile's ROOM it waves as it steps in and the room's own character waves back (`walker.ts` `greet`).
- **Friends** (Luke, 2026-11-21; `app/lib/character/friends.ts`, and `docs/profile-characters.md`, "Friends"). With a
  friend's companion in the room, your companion's wander mostly heads for the spot beside it (the brain's `friend`
  input), stays to hang out once there, faces it, and every 5 to 12 seconds cheers at it with a `♪` over its head (the
  `friend` reaction: sent, so everyone in the room sees it; older tabs play a hop). Each friend's own browser does this
  for its own companion, so two friends both online drift together. The pointer, the music and joining in still win.
- **Chat.** A line of stream chat hops the companion of whoever said it. Every browser has the line already, so each
  works it out for itself from `companionSpoke` (one line in `use-watch-room.ts`); nothing is sent.
- It climbs to and from a profile's ROOM on its `climb` frames, and walks along the strip to get under it.
- **A ROOM's characters can be taken out** (Luke, 2026-11-16: "anyone can grab one out of its window; let go, it walks and
  climbs back in by itself"). Whoever is looking at a profile, signed in or not, can press the owner's or a visiting
  commenter's character and drag it out of the ROOM: it hangs from the pointer with the companion's lean, is thrown with
  the companion's own throw, and once down on the site's floor walks to under the ROOM and climbs back in, waving as it
  steps in. Pressed on the way it is picked up again; a press without a drag is still a hello. With the ROOM out of sight
  it waits on the floor and pops back in after six seconds. Not your own companion visiting (pick it up off its strip),
  not under reduced motion. Nothing is sent or saved: it is that reader's screen only.
- **A catch.** `companionCatches(userId)` (`events.ts`) makes that person's character play `catch` once wherever it is
  drawn on this screen: their companion on the strip (yours, or theirs in a room you share) and their character in a
  profile's ROOM. Nothing is sent: whoever calls it still delivers the thing. Figures carry their owner's id
  (`data-companion-of` on the strip, `data-character-of` in a ROOM) so a drop can find whose character it landed on;
  use the element's box, not `elementFromPoint` (a companion over a key lets presses through).

## Talking (SPEC-character-speech.md, Luke 2026-11-14)
- **In a stream room a companion says its owner's chat lines**, as they are sent, in a speech bubble that moves with it
  (`CompanionSpeech` in `Companion.tsx`, drawing `SpeechBubble.tsx`): a letter at a time, in the speech face, with a
  blip a letter when the reader has the audio key on. A newer line takes the older one's place.
- **Nothing is sent for it.** The words ride on `companionSpoke(userId, saidAt, words)` (`events.ts`), called from the
  chat line every browser in the room already has (`app/lib/watch/use-watch-room.ts`). A line older than 15 seconds
  when it arrives is nobody speaking.
- **Over its head, or beside it.** On the strip the bubble sits over the companion's head. Along the top of the screen
  (on a room window's top edge) there is no room up there, so the bubble sits beside it, with no name row and one line
  at a time: it is then no taller than the companion, and the window under it cuts nothing off.
- The bubble is a plain box hidden from a screen reader, and presses go through it: the chat is where the line is read.
- The audio key for a room is `SpeechAudioKey` beside the chat (placed by the stream room's own code). One choice for
  the whole site, remembered in the browser.
- Proof: `scripts/drive-character-speech.cjs --room` on a local dev server with mock data (one person in a mock room).

## Rules
- Code never draws it, a prop or an effect. Text characters (`! z ♪`) are fine. A prop that would be art is an art slot.
- **Old strips must keep working.** A new motion goes in `MOTION_FALLBACK` (`motion.ts`) beside the older one that stands
  in for it, never in the first set. `readSheet` fills the gap and marks the sheet `stale`; the owner's browser bakes it
  again on a computer a few seconds after a page opens (Luke's OK, 2026-11-14). Nobody bakes anybody else's.
- **Old tabs must keep drawing it.** The room wire's moods stay the first six. Anything new rides in a field older code
  ignores (`p`, the pose) or reads as nothing (an unknown reaction kind is a plain hop).
- Never per-frame network traffic: it re-says its presence only when its mood, target, pose or reaction count changes.
- Clicks pass through the layer everywhere but the figure itself, and through the figure too while it stands over a key
  (`yieldToKeys`: the reader's page keys and seek bar run right along its strip).
- **A room is not told what you do elsewhere.** `read` and `type` are drawn on your own screen only (`COMPANION_POSES` is
  what a room hears), and a page turned or a look round at a new theme is never counted as a reaction
  (`reactionIsLocal`).
- A pointer is chased only while it moves: resting, or gone into a frame (a book's page, a video) whose moves are not
  heard outside it, it is let be after `CHASE_FRESH_MS`.

## How it is checked
- `Temp/check-companion.cjs`: the brain, the fall, the throw (its speed, its arc, the line between a splat and a bounce,
  the bounces, the squash that keeps its volume, the smear), the wire and the wiring, in Node.
- `scripts/drive-companion-throw.cjs`: the throw in a real browser against a LOCAL dev server on mock accounts and mock
  data (it refuses any other address). It bakes GUY with the workbench's own bake, takes over the page's clock, and reads
  every frame of an arc, three splats, a soft bounce, a put-down and a catch against the rules run in Node from the same
  let-go; close-ups go to `Temp/browse/throw/`. Leaves nothing. The same trick (mock storage seeded, `page.clock`) is the
  cheapest way to drive anything else the companion does without the live database.
- `scripts/drive-companion-grab.cjs`: Luke's second list in a real browser against a LOCAL mock dev server (supabase
  blocked, the plain figure and a stand-in strip, no bake): climbing in on arrival, under the pointer on every move with
  its lean (measures the gap to the pointer and how often it moves), drawn every display frame when thrown (measures frame
  times), a profile ROOM's character dragged out signed out, thrown, climbing back in and waving, the voice key's symbol,
  reduced motion, phone width. `--measure-only` prints the numbers without judging (for a before-and-after).
- `scripts/drive-companion-shove.cjs`: shoved by windows in a real browser against a LOCAL mock dev server (the plain
  figure, no bake): PREFERENCES dragged hard across it throws it (and splats it on the edge), PREFERENCES opened on top of
  it pops it away from the window's middle, and under reduced motion nothing moves. Leaves nothing.
- `scripts/drive-companion.cjs`: the first spec's proof in real browsers as TEST ACCOUNT A and B (it leaves a room and a
  message to clear; `--dance-only` leaves nothing).
- `scripts/drive-companion-life.cjs`: the re-bake, picking up and dropping (the start at being lifted, the double press,
  Escape and a press to put it down), the pokes, the run, the dances, the sleep (`--long` waits five minutes for the
  curl). Leaves nothing to clear.
- `scripts/drive-companion-scenes.cjs`: typing along, the arcade (watching, and a slump at a game lost on purpose), a
  video, a book (reading, the page turn, presses reaching the reader's keys under it). Leaves A's place in the book.
- `scripts/drive-companion-room.cjs`: A and B in a stream room with its window open: both in view on the window's top
  edge, over no key, the title bar's keys pressable, sitting while the video plays, back on the strip when the window is
  folded, a wave at the newcomer and a hop with `...` when one speaks; phone width too. `--before` only looks. It leaves
  an ended room to clear (a delete: ask Luke).
- `scripts/drive-profile-room.cjs`: the climb into a profile's ROOM on its climbing frames, the wave on stepping in, and
  the room's own character waving back.
- The local dev server has mock stream rooms unless it is started with production's `NEXT_PUBLIC_*_DATA_SOURCE` switches
  in its environment; two browsers cannot share a mock room.
- A headless browser reports no mouse until the first mouse move, and the site would take it for a phone: a drive moves the
  mouse first. The re-bake needs WebGL: `--use-angle=swiftshader`.
