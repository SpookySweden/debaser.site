# Characters on profiles

Read this before touching the motions, the bake or the profile walker. The spec it was built from is
`SPEC-profile-characters.md` (Luke, 2026-11-13). `SPEC-companion.md` builds on it.

## What it does
- **[ CHAR ] tab, ON YOUR PROFILE row** (`ProfileCharacterPicker.tsx`): pick one saved character (or NONE) and a mood:
  CALM, BUSY or PARTY. Picking a character bakes it. The owner's browser draws every motion once and saves the result as one
  PNG strip plus a small sheet. Changing the mood saves only the mood, because the pictures don't change with it.
- **Re-saving the shown one:** if the bench was LOADed from the character on show and then SAVEd, the new save takes its
  place on the profile and is baked again (`show-on-profile.ts`, `noteLoadedCharacter`).
- **On the profile** (`ProfileCharacter.tsx`): the character walks in the page's empty space, idles, dances while the
  track on show plays, and waves, hops or turns when clicked (in that order, one per click). CALM idles most, BUSY walks
  most, PARTY dances most (`MOOD_WEIGHTS` in `walker.ts`).

## The pieces
- `app/lib/character/motion.ts`: the motions, as keyframes of joint turns in degrees, per preset. BASE's set is shared;
  GOBLIN, ROBOT and GUY replace the ones they move differently.
  - BASE, GOBLIN and ROBOT have three joints, with the legs fixed to the hips as one piece, so they waddle (Luke OK'd
    this). GUY's arms swing and wave.
  - Frames are stepped, so a keyframe is a frame, and `hold` repeats one.
  - `posedFigure` turns joints from the root outwards. A joint the motion doesn't name follows its parent.
  - `posedPlacements` then works out sag on the posed figure, and lifts any frame that would put a part below the floor
    the figure stands on as built.
- `app/lib/character/bake.ts`: draws each unique keyframe with the workbench's own passes (`createPasses`, `flatMaterial`,
  `NORMAL_PASS` and the light-pass shader, from `CharacterPixelRender.tsx`), at one block per pixel.
  - A block is `TALLEST_PRESET / FIGURE_ROWS` units, the workbench's own figure size.
  - One cell box covers every frame, centred on the root, so the feet stay on one row and a mirrored frame turns about the
    same line.
  - Walking frames face three-quarters right (`SIDE_YAW`). The page mirrors them for left.
- `app/lib/character/sheet.ts`: the sheet's shape (cell size, columns, fps, floor row, ticks per motion), checked by
  `readSheet` whenever it is read back.
- `app/lib/character/walker.ts`: the walker's logic, kept pure.
  - `findLanes` finds the empty strips from measured boxes.
  - `stepWalker`, `nextActivity` and `react` decide what it does next.
- `app/components/CharacterSprite.tsx`: plays one frame of a strip, in whole pixels, mirrored when facing left. Shared with
  the companion.
- Data: `profile-character-repository.ts`, with a mock version (this browser, the strip as a data address) and a Supabase
  version: the `profile_characters` table plus the `profile-characters` picture folder
  (`20261113022903_profile_characters.sql`).

## Rules that came from the spec
- **Motion isn't artwork** (core.md, Asset Rules). Code only turns the joints of shapes someone built by hand. It never
  adds a shape or changes a shape's size, colour or kind. `check-profile-character` holds that for every frame.
- **Visitors get pictures, never figures.**
  - `user_characters` stays readable by its owner only, because it also holds the owner's email address. A "read the
    SHOWN row" rule would have handed that out.
  - `profile_characters` is readable by everyone and holds no name, address or figure.
- **It walks only where nothing is.**
  - `measureObstacles` collects the box of every run of text, picture, key and field on the page.
  - `findLanes` keeps the character's whole box, from the top of its cell down to its feet, inside empty space with 4px to
    spare.
  - It is measured again on resize and whenever the page's content changes.
  - With no room at 3x or 2x, it isn't shown, on a phone or anywhere else.
- **Reduced motion:** it stands still in its idle frame and nothing ticks.

## Gotchas
- **Turns are worked out in the motion module's own frames, not through `jointFrames`' swing.** A bone's frame in
  `skeleton.ts` is the swing to its first child, which can't twist about the bone. A head turn, or a hips twist in a dance,
  would vanish. `posedFigure` composes turns itself and hands sag a plain unpinned figure.
- **Sag needs a posed figure.** `sagOf` reads levels from what touches what, never from pins. So the posed figure's
  shapes are unpinned at their posed world places, and its joints are moved to their posed points.
- **Without the floor rule, a hips rock sinks one side** (a ROBOT dance went 0.08 units through the floor). With it, the
  other side lifts.
- **The proof hook is dev-only.** `window.__characterBakeProof`, from `CharacterViewport.tsx`, is skipped in a production
  build. The pixel proof therefore runs against `npm run dev`; the live drive does everything else.

## How it is checked
- `Temp/check-profile-character.cjs`, in Node, holds:
  - every preset has every motion, naming only its own joints;
  - shapes are kept as built in every frame;
  - the rest frame is the bench's, sag included;
  - turns, lift and facing move the right things;
  - shapes on added nodes follow their parent;
  - sag is worked out again in every frame, and the floor holds;
  - GUY's wave raises the right arm;
  - lanes never let a box cross anything;
  - the walker's music, clicks and moods behave;
  - a sheet read back is checked.
- `scripts/drive-profile-character.cjs --base <url>` runs in a real browser:
  - the bake against the workbench FRONT view, block for block (dev only); it writes `Temp/browse/profile-character-proof.png`;
  - A shows a character;
  - B watches it for 30 s with no overlaps, sees it walk, and gets a wave on a click and a dance while the track plays;
  - reduced motion;
  - a phone;
  - the database rules, checked as B.
