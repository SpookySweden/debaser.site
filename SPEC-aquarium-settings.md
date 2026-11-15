# SPEC: AQUARIUM SETTINGS (Luke, 2026-11-15)

The AQUARIUM background (live since `a14ee1f`; `app/components/Aquarium.tsx`, `app/lib/ui/backdrop-slot.ts`, `assets/aquarium/`)
gets a settings pop-up with sliders and switches "similar to things in the Google Experiments kind of projects where you can change
everything about the background in a fun way, like fish size and so much more". Luke asked for both well-known and genuinely
creative knobs, from research. This file is the brief for the session that builds it.

## Luke's answers (interview, 2026-11-15)
- **Pop-up:** floats, nothing covering or dimming the screen, so every change shows live in the sea behind it. A key on the window
  makes the window itself 50% see-through (and back).
- **Knobs:** all four kinds: FISH, SEA AND CORAL, PLAY WITH THE MOUSE, SILLY. Researched (sources at the end).
- **Saved to the account.** Signed out, it's kept in the browser.
- **Where it opens:** a `[ SETTINGS ]` key on the AQUARIUM row in PREFERENCES > BACKGROUND, and a small key on the sea itself.

## What Luke sees
1. PREFERENCES > BACKGROUND: the AQUARIUM row gets a `[ SETTINGS ]` key beside it (pressing it also switches to AQUARIUM if TILE
   was on). A small `[ ≈ ]`-style key sits in a corner of the visible sea (bottom left, above the coral, clear of the music bar and
   the companion); it opens the same window. It is the one part of the sea that takes a click. Hidden while TILE is on, while the
   site window fills the screen (no sea to see), and on phones.
2. The window: titled `AQUARIUM`, draggable, closable, no dimming layer, drawn once in `layout.tsx` like the other windows, its
   state in a slot (`app/lib/ui/window-slot.ts`, frontend.md: windows don't re-render the page). A `[ 50% ]` key in its title line
   turns the whole window half see-through; pressed again, solid. Read `DockWindow.tsx` and `PopoutWindow.tsx` first and reuse
   whichever gives a floating window without a scrim (a scrim-less variant is fine); remembered position is a nice-to-have.
3. Inside: four tabs or folds, FISH / SEA / PLAY / SILLY, then a row of keys along the foot: `[ RESET ]` (back to the Windows 98
   look shipped today), `[ PARTY ]` (every knob random, within sane limits), and presets: `[ 98 ]` (the default), `[ CALM ]`,
   `[ SCHOOL ]`, `[ CHAOS ]`. Every change shows in the sea at once. Each slider shows its value beside its name.
4. Settings follow the account: change them on the desktop, they're there on the laptop. A visitor's live in their browser.

## The knobs
Key: **W** well-known, **C** creative. Ranges are starting points; tune them by eye.

**FISH**
- FISH SIZE: slider 1x-4x, whole steps only (pixel rule, below). W
- FISH COUNT: slider 0-40, total; spread over the species that are on. W
- SPECIES: four switches, BUTTERFLY / TRIGGER / RAY / STRIPE. W
- SPEED: slider 0.25x-4x. W
- DEPTH BAND: two sliders, the highest and lowest the fish swim. C
- FLAP RATE: slider 3-30 frames a second, tails and fins. C
- MIXED SIZES: switch, each fish picks its own size within FISH SIZE. C
- SCHOOLING: slider 0-100: 0 every fish alone (today), up to tight shoals that turn together (one slider driving
  cohesion, alignment and separation). W
- SCHOOL SIZE: slider 2-12, the most fish in one shoal. C
- WANDER: slider, how often a fish changes its mind and turns, from never (straight crossings, today) to restless. C
- FOLLOW THE LEADER: switch, every fish lines up behind the first in a long parade. C

**SEA AND CORAL**
- WATER TINT: hue slider plus strength slider (0 = today's black). W
- LIGHT: slider 20-100%, the whole sea darker or brighter. W
- MURK: slider, a soft blur and haze over the far water. C
- DAY AND NIGHT: switch, the light slowly cycles over a few minutes; at night the fish slow and sink a little. C
- BUBBLES: slider 0-8 per stream. W
- BUBBLE SPEED: slider. W
- CORAL: two switches, LEFT / RIGHT. W
- CORAL SIZE: slider 1x-3x, whole steps. C
- CURRENT: slider -100 to +100, the water pushes everything left or right; fish swimming against it labour. C
- TIDE: switch, the whole scene rises and falls a few pixels, slowly. C

**PLAY WITH THE MOUSE**
- POINTER: one of IGNORE / SCARE / FOLLOW. Fish dart away from the pointer, or drift after it. C
- SCARE RADIUS: slider, how close the pointer gets before they bolt. C
- FEED ON CLICK: switch. A click on the visible sea drops a pellet that sinks; the nearest hungry fish race for it and it
  vanishes when one reaches it. W
- PELLET LIFE: slider 5-60 s, how long an uneaten pellet lasts before it settles and goes. C
- GREED: slider, how far a fish will come for food. C
- BUBBLES ON CLICK: switch, a click on the sea lets out a burst of bubbles where you clicked. C
- WAKE: switch, a trail of small bubbles follows the pointer across the sea. C

**SILLY**
- UPSIDE DOWN: switch, the whole sea flips (coral on top). C
- MIRROR: switch, flipped left to right. C
- RAINBOW: switch, every fish slowly cycles its colours, each a different phase. C
- DISCO: switch, the water tint cycles to a beat. C
- GIANT MODE: key, for 20 seconds the fish are 8x. C
- GRAVITY: slider, fish sink (+) or float up (-) unless they keep swimming; a stopped fish falls. C
- TIME: slider 0.1x-3x, everything slower or faster, bubbles included. C
- TINY TANK: switch, the whole aquarium shrinks into a small bowl-sized box in the corner of the sea. C

## How it works (for the builder)
- **Fish move by a simulation now, not CSS crossings.** SCHOOLING, WANDER, POINTER, FEED, CURRENT and GRAVITY all need it: one
  `requestAnimationFrame` loop for every fish, positions kept in refs (never React state), written straight to each sprite's
  `transform`; the sprite strips keep their CSS frame animation. Steering as in Reynolds' boids and Nature of Code's seek / flee /
  arrive; O(n²) is fine at 40 fish. Delta time capped so a tab switch doesn't teleport them. Positions still step in whole frames
  at about 15 a second, as today (docs/design.md, Feel), unless a knob says otherwise. With the default settings it must look like
  today: lone fish crossing at their recorded speeds, turning around off-screen.
- **Pixel rule:** every picture is shown at a whole-number zoom with `image-rendering: pixelated`, so size sliders step in
  whole numbers.
- **Art rule:** moving, flipping, scaling, tinting (CSS filters, `hue-rotate`, overlays) and blurring the existing pictures is fine.
  Nothing new is drawn by code. A pellet needs a picture: cut one from the recording or the bubble files, as the others were
  (`assets/aquarium/README.txt`), and note it there. Tints and overlays are colour fields, not drawings.
- **Clicks on the sea:** the sea sits under the page and takes no clicks. Feeding and bubbles-on-click listen for a press whose
  target is the desk itself (`[data-site-window="desk"]`, the bare area around the window), so nothing on the page changes
  behaviour. The pointer for SCARE / FOLLOW / WAKE is read from the whole window.
- **Calm by default:** reduced motion means no simulation and no fish or bubbles, as today; tint, light and coral settings still
  apply. The loop stops while the tab is hidden and while TILE is on. Cap the total moving sprites (about 60).
- **Settings shape:** one small versioned JSON object (`{ v: 1, ... }`), parsed and clamped on every read so a bad or old value falls
  back to its default (as `backdropId()` does). The BACKGROUND choice (AQUARIUM / TILE) moves into the same object so it follows
  the account too; keep reading the old `debaser.site.backdrop.v1` key once so nobody's choice resets.
- **Saving:** the browser's copy draws at once (the boot script keeps writing `data-backdrop` before first paint). Signed in, the
  account's copy is read on sign-in and wins; changes save to the account a moment after the last slider move (debounced, not on
  every pixel of a drag). Copy the MODULOS arrangement exactly: `app/lib/ui/modules-slot.ts` (mock store under mock auth,
  Supabase store otherwise, browser copy for visitors).
- **Database (needs Luke's typed OK in chat before `db:push`):** a new table `user_aquarium`, written like
  `supabase/migrations/20261106115110_user_modules.sql`: `person uuid primary key references auth.users on delete cascade`,
  `settings jsonb not null default '{}'`, a shape check (an object under about 4 KB), Row Level Security with owner-only read,
  insert and update, nobody else (signed in or not) able to read it, grants revoked before given, re-runnable. No existing table,
  rule or row is touched. Through `npm run db:new`, `db:push:dry`, then `db:push`.
- **Tokens:** every colour and size in the window comes from the token files (`npm run tokens`). Sliders: native
  `<input type="range">` (keyboard and screen readers for free) styled to the site, each with a visible name and value.

## Out of scope
New drawn art (the pellet picture is cut, not drawn), sound, sharing your aquarium with other people, other backgrounds, a phone
layout (desktop first; it must not break at phone width).

## Proof
- `Temp/check-aquarium.cjs` grows (or a sibling): the settings parse and clamp (junk, old versions, missing keys), RESET equals the
  shipped look, PARTY stays in range, the preset list, the old backdrop key carried over, the migration's policies are owner-only.
  Prove each new check fails first.
- A local browser drive on the mock server (pattern: `Temp/browse/drive-aquarium.cjs` and `dev-mock-aquarium.cjs`): open the window
  from both keys, move sliders and see the sea change (fish count, size, tint), the 50% key, feeding by clicking the bare desk,
  SCARE moving fish away, reduced motion, settings surviving a reload, a mock sign-in carrying them.
- The live database only for what can't be proved locally (that another account can't read your row), one short check.
- The house loop: verify, checks:changed, capture + audit, commit, push, deploy-status, `npm run read`. While League is being
  played on the desktop, start the priority watcher first (`Documents\game-first\game-first.ps1`, HANDOFF.md) and run heavy steps
  at low priority.

## As built (2026-11-15)
Where the build differs from the plan above, and why:
- **The sea key is top-left, and only on screens 1536 pixels wide or more.** The site window is 1280 wide at the most, so from that
  width up there is always bare sea to its left; narrower, the window's corner is where the key would be. PREFERENCES keeps its key.
- **The BACKGROUND choice stays under its own browser key** (the boot script reads it before first paint) and rides only in the
  account's copy.
- **Account saving is behind `NEXT_PUBLIC_AQUARIUM_DATA_SOURCE=supabase`**, off until the `user_aquarium` table exists (Luke's OK
  pending; the migration is drafted in the sessions' notes folder, `user_aquarium-migration-draft.sql`, and is not in the repo so
  nobody's `db:push` can carry it). Until then a signed-in person's settings are kept in their browser, like a visitor's.
- **41 knobs**: the list above, with SPECIES as four switches, CORAL as two, and WATER TINT as two sliders.
- **GIANT MODE** shows eight fish at the most (forty at 8x is more picture than a screen holds); **TINY TANK** is a 400x300 box
  in the bottom-left corner with everything at 1x.
- **The window does not reopen by itself** on the next visit: it is opened on purpose, from one of its two keys.
- **A current stronger than a fish** carries it across tail-first rather than turning it back at the edge.
- **A second person signing in on the same browser**, with nothing saved, starts on the default sea, not the last person's.
- The undo arrows close the AQUARIUM window when it was opened from PREFERENCES (`dock` in a window's state, `undo-trail.ts`).
- Code: `app/lib/aquarium/` (`settings.ts` the knobs, `sim.ts` the simulation, `settings-slot.ts` the store),
  `app/components/Aquarium.tsx`, `app/components/AquariumSettingsWindow.tsx`. Proof: `Temp/check-aquarium.cjs`, and the local
  drive `Temp/browse/drive-aquarium.cjs` (on `Temp/browse/dev-mock-aquarium.cjs`; both stay untracked, as that folder is).

## Sources (research, 2026-11-15)
Google WebGL Aquarium (fish count, views): https://experiments.withgoogle.com/webgl-aquarium ; boids with sliders:
https://eater.net/boids ; Reynolds: https://www.red3d.com/cwr/boids/ ; boids pseudocode (wind, scatter, perching):
https://vergenet.net/~conrad/boids/pseudocode.html ; steering (seek, flee, arrive): https://natureofcode.com/autonomous-agents/ ;
fish boids with mouse avoidance: https://github.com/tunneln/foids ; SereneScreen (per-species counts, bubble column):
https://www.serenescreen.com/v2/faq.html ; hue-rotate caveats:
https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/hue-rotate
