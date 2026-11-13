# SPEC: characters living on profile pages (Luke, 2026-11-13)

Build this in a fresh session, after reading CLAUDE.md, `.claude/rules/core.md` (Asset Rules), `docs/design.md`,
`docs/character-render.md`, `docs/character-figures.md`, `SPEC-pixel-render.md` and `SPEC-simple-figures.md`. Build this
before `SPEC-companion.md`, which reuses its motions and baking.

## What Luke asked for
The character creator's characters walk around or dance in the empty space of a person's profile page. Their animations
are preset, and are baked the Dead Cells way: animated in 3D, then shown as pixel art.

## What exists already (checked 2026-11-13)
- A character is a `Figure = { skeleton, shapes[] }` (`app/lib/character/figure.ts`): at most 7 shapes on at most 7 nodes.
  Every preset (base, goblin, robot, guy; `rig.ts`) has 5 shapes, rooted at the hips.
- The skeleton can bend joints (`skeleton.ts`: `bendJoint`, `jointFrames`), and the workbench's POSE tool drags nodes.
  **There's no animation, walk, idle or keyframes.**
- The live pixel render (`pixel-render.ts`, `CharacterPixelRender.tsx`) is the Dead Cells method:
  - a colour pass into a tiny target (the tallest preset is at most 30 blocks high);
  - a normal pass;
  - three light bands (1.0 / 0.78 / 0.55), scaled up to whole pixels;
  - dye colours exact, with no palette squeeze.
- There's no frame export from the workbench. ANIMATE's export code (`app/lib/animate/export.ts`) writes GIF and PNG
  sequences and may be reusable for packing frames.
- Characters are stored in `user_characters` (`20261107000000_user_characters.sql`), with figure JSON under 64 KB and up to
  400 per person. **Only the owner can read them.**
- The profile (`app/components/PublicProfileWindow.tsx`) has two columns on desktop: the picture column, 212px, and the
  track panel. Empty space sits under each when there are no comments, and the right column is often mostly empty. The
  status bar has a still 24px `SpriteSlot` for `/assets/sprites/profile.gif`.

## Decisions (Luke, 2026-11-13)
1. **Motion is made by code.** Luke chose code-made motion over hand-keyed poses or a mocap library. **This is Luke's
   ruling that motion isn't artwork.** The shapes are what people build by hand in the workbench; the code only moves
   their joints over time. The code still never draws a character, adds shapes, or makes artwork. No AI-made motion. Add a
   line under core.md's Asset Rules saying this, in the build commit.
   - The motions are made per preset, from each preset's joints: WALK, IDLE, DANCE (two or three dances), WAVE, HOP,
     TURN, SIT, SLEEP (the last two are for the companion). They're written as keyframes of joint turns, in code, so they
     can be tuned by number.
   - Characters built on a preset inherit its motions. Shapes added beyond the preset follow the joint they're pinned to.
     Sag (`sag.ts`) still applies when drawing each frame.
2. **One character per profile.** The owner marks one of their characters SHOWN (in the customiser's `[ CHAR ]` tab). Only
   that one becomes readable by others.
3. **What it does on the profile:**
   - Walks the empty space: strolls back and forth in the empty parts of the page, stops, idles. It walks only where
     nothing is (the gaps under the columns, along the bottom). It never covers text or keys, and never blocks a click on
     the page.
   - Dances while the profile's track plays.
   - Reacts to clicks: click it and it waves, hops or turns to face you.
   - The owner picks a mood: CALM (mostly idle), BUSY (walks a lot) or PARTY (dances often), in the customiser.
4. **Baked once on save.** When the owner saves the SHOWN character (or changes its shapes or mood), the browser renders
   every motion's frames once through the existing pixel render. They're packed into a small picture strip (a sprite
   sheet, PNG) with a little JSON listing the frames, and uploaded to storage with the account. Visitors only see the
   pictures, which is fast and works on phones.
   - Frames are stepped, about 8-12 a second, with no smoothing between frames: the site's no-easing rule.
   - The light-band look and exact dye colours are kept. The left-facing frames are the right-facing ones mirrored.
   - These pictures are made from the owner's own hand-built character. They're media the site holds (images), which the
     media rules allow.
5. **Readability and motion:** under reduced motion, or the MOTION OFF preference if the review's item is built, the
   character stands still in its idle frame. It's hidden at phone width unless the page has real empty space, decided by
   measuring, not guessed.

## Database changes (need Luke's typed OK, with a plain-English description)
- `user_characters`: a way to mark one character SHOWN per person, plus a policy letting anyone read **only** the SHOWN
  one. Its figure JSON is harmless, but only that row is shown.
- A mood column on the profile, or beside the SHOWN mark.
- A storage bucket (or a folder in an existing one) for the baked strips: owner writes, anyone reads, with a size cap per
  person.

## Out of scope
- More than one character on a profile.
- Characters beside forum posts or as profile pictures (in the review; a later piece).
- Hand-keyed motion tools (Luke may want these later for his own dances; the keyframe format should not rule it out).

## How it's proven
- Prove the bake turns the workbench render into frames that match it: compare a baked idle frame against a live render
  of the same pose.
- A browser drive of TEST ACCOUNT A's profile, seen by B: the character walks only in empty space (check its box never
  overlaps text or keys over 30 s), dances when the track plays, waves when clicked.
- Screenshots at desktop and phone width. Reduced motion stops it.
- B can't read A's other characters, checked through the database.
