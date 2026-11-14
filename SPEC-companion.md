# SPEC: a companion character along the bottom of the site (Luke, 2026-11-13)

Build this in a fresh session **after `SPEC-profile-characters.md` is live**: it reuses that spec's code-made motions,
its baked picture strips and its SHOWN character. Read CLAUDE.md, `.claude/rules/core.md`, `docs/design.md` and that spec
first.

## What Luke asked for
Like the desktop pets (a cat, a duck, Miku) that hang around the bottom of the screen, but your own character from the
creator.

## The limit Luke accepted
A web page can't put a pet on his real computer desktop. **It lives along the bottom of the site's window, on every
page.** A true desktop pet would be a separate installed program, and isn't part of this spec.

## What exists already (checked 2026-11-13)
- No pet or wandering figure. The nearest things:
  - `CatCursor.tsx`: Luke's cats follow the pointer, moved in whole-frame steps.
  - The taskbar's still `sprite-walk` slot (`assets/sprites/walk-cycle.gif`, 24px; `app/lib/ui/art/slots.ts`).
- The bottom of the window, which it walks along:
  - the music bar (`MusicPlayer`, `fixed bottom-0`, full width, z-50 when docked);
  - its folded tile (`bottom-2 left-2`, about 19rem);
  - the floating video player (`z-float`);
  - `SiteWindow`'s taskbar strip (hidden on phones);
  - the `--bottom-bar` space.

## Decisions (Luke, 2026-11-13)
1. **Bottom of the site.** The companion walks along the top edge of the music bar, or of the window's bottom edge when
   the bar is hidden. It never covers the bar's keys or blocks a click: clicks pass through everywhere except on the
   character itself. It steps around the folded player tile and the floating player rather than over them.
2. **Same character as the profile, with a switch.** It defaults to your profile's SHOWN character. A COMPANION row in
   Preferences turns it on or off and lets you pick any other of your characters. It's off on phones unless you turn it
   on there. Signed out, there's no companion.
3. **What it does:**
   - Walks, sits and sleeps: wanders, sits down, and falls asleep after a while with nothing happening. It wakes when you
     come back.
   - Dances while the music bar is playing.
   - Chases the mouse: follows the pointer when it comes near the bottom, then wanders off.
   - Reacts to the site with a short hop, or a `!` above its head (text, not art), when you get a reply, a message, or
     someone goes live. These events come from what the site already hears (notifications, comms, presence); no new
     listening.
4. **Others in your room see it.** In a stream room or music room, everyone's companions share the bottom strip of that
   room, each wearing its owner's name on hover. Outside rooms, only you see yours.
   - This uses realtime messages. Send only what changes (a new walk target, a mood, a reaction), never every frame.
     Each browser plays the motion itself from the shared baked strips. Use the room's existing presence or broadcast
     channel, not a new one.
   - A room with many people caps the number of visible companions (say 8), and drops the rest quietly.
5. **Motion rules:** stepped frames as in the profile spec. Under reduced motion or MOTION OFF it sits still in one frame.
   A companion and the cat cursor can both be on; they don't interact.

## Widened (Luke, 2026-11-14)
"Look into more ways that the companion can interactive with the site and find more animations for it for all of its use
cases or create more and make it an overall more fleshed out unique and creative and fun feature." Luke OK'd three steps,
each live on its own ("Yes, all three"), and the quiet re-bake ("Yes, quietly"). How it is built: `docs/companion.md`.
1. **A life of its own.** Pick it up with the pointer and it dangles, then drops back and lands. A press without a drag
   gets a hop, a wave or a spin in turn. Asleep, `z`s drift up; after five minutes alone it curls right up, and stretches
   and waves when you come back. Bored, it stretches, spins or runs back and forth. It runs after the pointer. Five
   dances, a new one with each track. In the small hours of your clock it nods off sooner.
2. **It takes part.** Reads along at `/read` (a book art slot beside it), watches the arcade and cheers or slumps, cheers a
   post, types along, sits and watches a video; in a stream room everyone's companions sit as an audience.
3. **Social touches.** Waves in a profile's ROOM and at a newcomer in a stream room, hops when its owner speaks in stream
   chat, a different text mark per kind of notification, a real climbing motion.
- New motions are code turning the joints of the owner's own built character (Asset Rules): nothing is drawn.
- A strip baked before a motion existed plays an older one in its place, and its owner's browser bakes it again once,
  quietly, on a computer: the same save SHOW does, to their own row and picture only.
- Small text marks are allowed now (`z`, `...`, a heart, `VS`). Still no talking.

## Database changes (need Luke's typed OK)
- The COMPANION switch and choice follow the account: one small row of settings. It could share a table with the review's
  "settings follow you" idea if that's built first.
- No new table for rooms: positions travel only over realtime and are never stored.

## Out of scope
- A separate desktop app (possible later as its own project).
- Talking, speech bubbles beyond `!`, pets interacting with each other.
- A companion for signed-out visitors.

## How it's proven
- A drive signed in as TEST ACCOUNT A on several pages: the companion stays on the bottom strip, never overlaps the music
  bar's keys (boxes checked over 60 s), and every music bar key still clicks.
- It dances while music plays, sleeps after idle, and hops on a notification sent by TEST ACCOUNT B.
- A and B in one stream room each see the other's companion. The realtime messages in one minute are counted and written
  in the commit.
- Screenshots at desktop and phone width (phone with it switched on).
