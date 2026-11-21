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
  - The first set (`CORE_MOTION_IDS`) is in every strip ever baked. Motions added since (2026-11-14, for the companion:
    `docs/companion.md`) go in `MOTION_FALLBACK`, each beside the older motion that plays in its place on a strip baked
    before it. A seated motion needs its own GOBLIN and ROBOT version: they have no legs to fold.
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
  `readSheet` whenever it is read back. A sheet missing newer motions is still a sheet: each plays as its older stand-in
  and the sheet is marked `stale`, for `rebake.ts` to bake again in its owner's browser.
- `app/lib/character/walker.ts`: the walker's logic, kept pure.
  - `findLanes` finds the empty strips from measured boxes.
  - `stepWalker`, `nextActivity` and `react` decide what it does next.
- `app/components/CharacterSprite.tsx`: plays one frame of a strip, in whole pixels, mirrored when facing left. Shared with
  the companion.
- Data: `profile-character-repository.ts`, with a mock version (this browser, the strip as a data address) and a Supabase
  version: the `profile_characters` table plus the `profile-characters` picture folder
  (`20261113022903_profile_characters.sql`).

## Taken out of the ROOM (Luke, 2026-11-16)
- Anybody looking at a profile can press-and-drag a character out of its ROOM (`RoomWalker`'s `takeOut`): it leaves for a
  layer over the page (`LooseCharacter.tsx`), is carried and thrown with the companion's own rules, and walks and climbs
  back in by itself (`app/lib/companion/loose.ts`). `docs/companion.md` has the details.

## Talking (SPEC-character-speech.md, Luke 2026-11-14)
- **In a profile's ROOM** (`ProfileRoom.tsx`) up to three of the newest commenters' shown characters come to visit, and
  every so often one character stops, faces the reader and says something in a bubble over its head
  (`SpeechBubble.tsx`): a letter at a time, two lines a page, in the speech face (`font-speech`, Pixelify Sans, Luke's
  pick). One speaker at a time; the first 2 to 4 seconds after the room is on screen, then 6 to 16 seconds apart
  (`SPEECH_PACE`). Pressing a bubble goes to what was said.
- **A character only says what its own person wrote**, out of what the page already holds: `app/lib/speech/script.ts`
  (pure) decides it: their comments on this profile, and their replies to the owner anywhere on the board (a reply under
  the owner's post, a reply to the owner's reply, an `@name`); the owner's character says the owner's remarks and replies
  to the people in the room. Nothing is fetched for it but each guest's shown character, and nothing is stored.
- **`RoomWalker` can be given something to say** (`speech`): it stands still in its idle frame while the bubble is up. A
  one-off under way (a wave, a hop, a catch) is finished first.
- **Reduced motion:** nothing speaks by itself. A press on a character shows its next line whole; a second press puts it away.
- Checked by `Temp/check-character-speech.cjs` (the rules) and `scripts/drive-character-speech.cjs` (a real browser on
  a local dev server with mock data: it seeds its own accounts, comments and characters and touches no database).
- **The voice:** the ROOM's title bar carries `[ ♪ ]` (`SpeechAudioKey.tsx`; a symbol only, Luke 2026-11-16: the note struck through while off, the key filled while on) while anybody has something to say.
  Switched on (remembered in that browser, one choice for the whole site), each letter of a bubble makes one short blip
  made in the browser (`app/lib/speech/blip.ts`): no recordings. A character's voice is worked out, never chosen
  (`app/lib/speech/voice.ts`): taller is deeper, and the account gives it a quirk. No sound machinery exists before a
  press: the key's own, or, with ON remembered, the reader's first press anywhere. It follows the music bar's VOL at
  about half the music's level. Tuning by number: `voiceFor`, `blipGain`, `SPEECH_PACE`.
- **In a stream room** each person's companion says what that person types in the room's chat: `docs/companion.md`,
  "Talking".

## Friends (Luke, 2026-11-21)
- "make it so that moldavius figtree and swedens characters like eachother and hang out with eachother in a jovial manner".
  `app/lib/character/friends.ts` holds the pairs (`FRIEND_PAIRS`, seeded with sweden and moldavius figtree; add a pair
  there for more) and the pure rules.
- **In a ROOM** (the owner, a guest, your visiting companion) a friend's walker heads for the spot halfway between the two
  (`meetingSpot`, so two friends walking to each other never cross), turns a walk away from its friend round, stays to
  hang out once together, faces its friend there, and now and then waves, hops or cheers (`befriend`, after
  `stepWalker` each tick). The walkers share where each stands through a map `ProfileRoom` hands them (`spots`).
- **They swap cheerful noises** in their own blip voices: each friend gets three of `FRIEND_NOISES` in its bag of lines,
  and a noise is answered by the other friend a moment later (`friendAnswer`; an answer is not answered again). Noises
  and text faces only, never words: a character still never says a sentence its person did not write.
- Reduced motion: nothing moves or speaks by itself, as before. Checked by `Temp/check-character-friends.cjs` and
  `scripts/drive-character-friends.cjs` (local mock server; sweden's profile with moldavius figtree and a stranger
  visiting).

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
