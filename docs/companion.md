# The companion

Read this before touching the companion. The specs it was built from are `SPEC-companion.md` (Luke, 2026-11-13) and its
"Widened" section (2026-11-14). It wears a baked character strip: `docs/profile-characters.md` covers the motions and the
bake.

## The pieces
- `app/components/Companion.tsx`: the layer over every page (in `app/layout.tsx`), your own figure and other people's in a
  room. One loop, ten frames a second, written straight to the figure's style through refs, so nothing re-renders.
- `app/lib/companion/brain.ts`: what it decides, kept pure (the clock, pointer, music and dice are handed in). Also the
  fall after it is let go (`fallStep`).
- `app/lib/companion/wire.ts`: what a companion tells a stream or music room, riding on the room's own presence. Also
  which one-off motion each reaction plays (`reactionMotion`) and which loop a mood and pose draw (`loopMotion`).
- `app/lib/companion/events.ts`: `pokeCompanion(kind)`, the one way the rest of the site tells it something happened.
- `app/lib/companion/floor.ts`: where its strip is and what it steps around (`data-companion-avoid`).
- `app/lib/companion/visit.ts`: climbing into a profile's ROOM and back.
- `app/components/NoteTrail.tsx`: the text that drifts up from it: music notes for a dance, `z`s for a sleep.
- `app/lib/character/rebake.ts`: bakes an old strip again, once, in its owner's browser.

## How it moves
- **A mood, a pose, an act.** The mood is one of six (`stand walk sit sleep dance chase`) and decides where it goes. The
  pose is a loop played in place of the mood's own (`run` for a chase, `curl` for a long sleep, which dance). An act is a
  one-off played through once (a hop, a stretch, a cheer, a landing); anything longer than a hop is done standing still.
- **Being picked up** is a phase beside the room visit's (`held`, then `fall`): the brain is not asked while it is in the
  reader's hand. It is clamped to the screen and above its own floor, and lands on the nearest stretch it can stand on.
  Under reduced motion nothing is carried.
- **Stepped, always.** Ten frames a second in whole pixels, a carry and a fall included. No `requestAnimationFrame`.

## Rules
- Code never draws it, a prop or an effect. Text characters (`! z ♪`) are fine. A prop that would be art is an art slot.
- **Old strips must keep working.** A new motion goes in `MOTION_FALLBACK` (`motion.ts`) beside the older one that stands
  in for it, never in the first set. `readSheet` fills the gap and marks the sheet `stale`; the owner's browser bakes it
  again on a computer a few seconds after a page opens (Luke's OK, 2026-11-14). Nobody bakes anybody else's.
- **Old tabs must keep drawing it.** The room wire's moods stay the first six. Anything new rides in a field older code
  ignores (`p`, the pose) or reads as nothing (an unknown reaction kind is a plain hop).
- Never per-frame network traffic: it re-says its presence only when its mood, target, pose or reaction count changes.
- Clicks pass through the layer everywhere but the figure itself.

## How it is checked
- `Temp/check-companion.cjs`: the brain, the fall, the wire and the wiring, in Node.
- `scripts/drive-companion.cjs`: the first spec's proof in real browsers as TEST ACCOUNT A and B (it leaves a room and a
  message to clear; `--dance-only` leaves nothing).
- `scripts/drive-companion-life.cjs`: the re-bake, picking up and dropping, the pokes, the run, the dances, the sleep
  (`--long` waits five minutes for the curl). Leaves nothing to clear.
- A headless browser reports no mouse until the first mouse move, and the site would take it for a phone: a drive moves the
  mouse first. The re-bake needs WebGL: `--use-angle=swiftshader`.
