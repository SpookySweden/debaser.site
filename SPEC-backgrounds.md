# SPEC: MORE BACKGROUNDS, AND AN EXPERIMENTAL SETTINGS WINDOW (Luke, 2026-11-15/16)

Luke, after the AQUARIUM settings window went live (`SPEC-aquarium-settings.md`): "make it so that the fish can get bigger and
put more experimental effort into the sliders and the ui doing more research into google experiments website with their fluid
and physics projects that have the physics and simulation features, put this same effort into adding a few more of these kind
of themes for the background, add 2 more for now."

## Luke's answers (2026-11-16)
- **Backgrounds:** he ticked all four offered: FLUID, SAND, STARFIELD, MYSTIFY. He asked for two "for now", so they come in that
  order: SAND and FLUID first (the two physics ones), then STARFIELD and MYSTIFY (the two Windows 98 screensavers, small).
- **Art rule:** code-drawn abstract simulations are fine: "i like the idea but allow yourself liberty for the sake of quality
  and style". Recorded in `.claude/rules/core.md`, Asset Rules.
- **Fish size:** up to 12x. Done ahead of this SPEC (`FISH_ROOM` in `app/lib/aquarium/sim.ts`: the sea holds fewer fish the
  bigger they are; GIANT MODE is 16x, two fish).
- **No test row on live:** he will try account saving himself.

## What Luke sees
1. **PREFERENCES > BACKGROUND** lists AQUARIUM, SAND, FLUID, STARFIELD, MYSTIFY and TILE, each with `[ SETTINGS ]` beside it
   (TILE has none). AQUARIUM stays the default.
2. **The key on the sea** (wide screens) is named for whichever background is on and opens its window.
3. **Each background has its own settings window**, built like the AQUARIUM one (floats, no dimming, `[ 50% ]`, tabs, RESET,
   PARTY, looks along the foot), saved to the account in the same row (`user_aquarium.settings`, under a key per background;
   no database change: the row is capped at 4 KB and all five fit in about half of it).
4. **The windows get stranger controls** than plain sliders (below), the AQUARIUM's included.

## The new controls (all backgrounds)
Researched from Tweakpane, lil-gui, dat.GUI and the Google Experiments panels (sources at the end). Each is plain HTML and pointer
events in the site's look, works from the keyboard, and has its value written out.
- **XY PAD:** two knobs on one square, dragged with one finger. AQUARIUM: CURRENT x GRAVITY. SAND: WIND x GRAVITY. FLUID: WIND
  (both ways). STARFIELD: where the stars come from. Arrow keys move it; a double-click centres it.
- **BOUNCE:** a key on every pad. Let go with a flick and the puck keeps going, bouncing off the pad's walls, so the two knobs
  change by themselves until you catch it. The physics is in the control.
- **BAND:** one strip with two handles for a from-to pair. AQUARIUM's HIGHEST and LOWEST become one DEPTH band.
- **SWAY (`~`):** a key beside every slider. On, the value sways slowly between two marks you can drag, by itself. The saved
  setting is the pair of marks and the switch, not the moving value.
- **DIE:** a key beside every knob: that one knob somewhere at random.
- **LOCK:** a key beside every knob: PARTY and the looks leave it alone.
- **MORPH:** a slider at the foot between any two looks: every knob slides from one look's value to the other's (switches flip
  at the middle).
- **GHOST POINTER:** `[ RECORD ]` takes ten seconds of your pointer and loops it, so the fish (or the ink, or the sand) keep
  being chased while your hand is elsewhere. `[ STOP ]` ends it. Never saved.
- **METER:** a small live strip under a few knobs showing what the sea is really doing (fish in view, grains, ink left,
  frames a second), drawn as 1-pixel columns.
Sway, bounce, morph and the ghost pointer stop under reduced motion.

## SAND
A falling-sand toy behind the site (after SandSpiel and the Noita write-up): a grid of grains, each a few pixels, stepped bottom
to top. Canvas 2D, an `ImageData` the size of the grid, scaled up with `image-rendering: pixelated`.
- **Grains:** SAND, WATER, STONE, PLANT, FIRE, SMOKE, OIL, and EMPTY to rub out. Sand piles and slides; water levels; fire
  climbs plant and oil and leaves smoke; water puts fire out; oil floats on water; plant grows slowly where water touches it.
- **The page is part of it:** the site window is solid. Grains land on its top edge, pile up, and pour down the sides. Docked
  windows too (switchable). This is the thing the other toys can't do.
- **Pouring:** hold the pointer down on the bare sea to pour the chosen grain; RAIN pours from the top by itself so the
  background is alive untouched; DRAIN opens the floor so it never fills.
- **Knobs:** GRAIN (which), BRUSH size, POUR rate, GRAIN SIZE (2-8 px), GRAVITY x WIND (pad), RAIN (what, how much, where),
  DRAIN, WINDOWS ARE SOLID, WATER RUNS (how runny), FIRE SPREADS, FIRE LASTS, PLANT GROWS, EVAPORATE, COLOURS (the site's dyes /
  desert / neon / mono), SPECKLE (how much each grain differs), TIME; keys: `[ SHAKE ]` (jumbles it), `[ CLEAR ]`,
  `[ FLOOD ]`, `[ BURN ]`. Looks: DUNES, RAINSTORM, FOREST FIRE, HOURGLASS.

## FLUID
Ink in water, stirred by the pointer (after Jos Stam's stable fluids and Pavel Dobryakov's WebGL Fluid Simulation, the best
known of the Chrome Experiments). Solved on the processor on a small grid (about 128 x 72 cells, a knob), not WebGL: it is
chunky on purpose, it needs no graphics card, it can't lose its context, and its maths can be run in a check. Drawn to a small
canvas, coloured through a palette in steps with an ordered dither, scaled up pixelated.
- **Stirring:** moving the pointer anywhere drags the water and trails ink; a click on the bare sea is a big splat; AUTO SPLATS
  keep it alive untouched.
- **Knobs:** THICKNESS (how soon the water stops), INK LASTS, SWIRL (the one that changes its character), SPLAT SIZE, PUSH,
  WIND (pad), BUOYANCY (ink rises or sinks), GRID (cell size), COLOURS (dyes / fire / sea / mono / rainbow), COLOUR STEPS,
  DITHER, AUTO SPLATS, POINTER (stir / ignore), WALLS (the site window is solid, as in SAND), KALEIDOSCOPE (2, 4 or 8 mirrored
  wedges), TIME; keys: `[ SPLAT ]` (a random burst, as Dobryakov's has), `[ CALM ]` (stills the water), `[ CLEAR ]`.
  Looks: INK, SMOKE, LAVA, OIL SLICK.

## STARFIELD and MYSTIFY
The two Windows 98 screensavers, rebuilt as code (dots and lines; nothing of Microsoft's is copied).
- **STARFIELD:** stars rush out of a point. Knobs: STARS, SPEED, WARP (streak length), SIZE, SPREAD, COLOURS, TWINKLE, SPIN,
  REVERSE, STEER (the pointer moves the point they come from), a pad for the same; a click on the sea is two seconds of
  hyperspace. Looks: 98, WARP, SNOW (slow, falling, sideways drift).
- **MYSTIFY:** shapes whose corners bounce round the screen, trailing echoes. Knobs: SHAPES, CORNERS, TRAILS, SPEED, LINE,
  COLOUR CYCLE, GRAVITY (corners fall and bounce), SPRINGS (corners pull on each other, so shapes wobble), POINTER (pull /
  push / ignore), WINDOWS ARE SOLID (corners bounce off the site window too), TIME. Looks: 98, JELLY, CAGE.

## How it works (for the builder)
- **Shared frame first.** Generalise what the aquarium has, without changing how it looks or saves:
  `app/lib/backdrops/knobs.ts` (the knob kinds, parse / clamp / party / morph, with the new kinds: `pad`, `band`, and `sway`,
  `lock` as per-knob state), `app/lib/backdrops/store.ts` (one store for every background's settings: browser copy per
  background, the one account row, the debounce and guards from `app/lib/aquarium/settings-slot.ts`), a generic
  `BackdropSettingsWindow` that draws any background's knobs, and `app/lib/ui/backdrop-slot.ts` listing all six. The aquarium's
  saved shape stays readable (its knobs are the row's top level today; new backgrounds nest under their own key).
- **Each background** is a pure simulation module (`app/lib/backdrops/<name>/sim.ts`: numbers in, numbers out, no browser, run by
  checks) and a small component that owns a canvas and one `requestAnimationFrame` loop, as `Aquarium.tsx` does. One background
  runs at a time.
- **CSS:** the sea rules keyed on `data-backdrop='aquarium'` become "any background but TILE"
  (`html[data-backdrop]:not([data-backdrop='tile'])`).
- **Obstacles:** the site window's and docked windows' boxes are read with `getBoundingClientRect` a few times a second (never
  per frame) and handed to the simulation as solid rectangles.
- **Calm by default:** the loop stops in a hidden tab, and while the site window fills the screen (nothing to see: this also
  spares the aquarium). Reduced motion: one still frame (a settled pile, a few resting swirls of ink, still stars, still shapes)
  and no loop. Steps are whole frames at 15, 30 or 60 a second (a knob; 30 by default for SAND and FLUID).
- **Flashing:** fire, disco and rainbow are held in code to under three changes a second and small changes of brightness
  (WCAG 2.3.1), whatever the sliders say.
- **Colours** come from the dyes in the token files, read from the page's CSS variables at run time; a canvas pixel is data, but
  no colour value is typed into a component (`npm run tokens`).
- **Art rule:** dots, grains, lines and fields of colour that a simulation produces are not artwork (core.md, 2026-11-16). Nothing
  here depicts a thing; if a background ever wants a picture, that is Luke's drawing or a named exception.

## Order of work (each step goes live by itself)
1. The shared frame, with the aquarium moved onto it and nothing visibly changed; then the new controls, on the aquarium.
2. SAND.
3. FLUID.
4. STARFIELD and MYSTIFY.

## Proof
- A check per background (`Temp/check-backdrop-<name>.cjs`) on its pure simulation: sand grains are neither made nor lost
  without a source or drain, sand rests on a solid box, water levels; the fluid stays finite, ink fades at the rate set, a still
  fluid stays still, a push moves ink the way it was pushed; stars and corners stay in bounds; every knob, look and party in
  range; old saves read back. Each proved to fail first. `Temp/check-aquarium.cjs` keeps passing through step 1.
- A local browser drive per step on the mock server (the pattern is `Temp/browse/drive-aquarium.cjs`), including frame time
  with each background running behind `/forum`.
- The house loop (verify, checks:changed, capture + audit, commit, push, deploy-status, `npm run read`). While League is being
  played on the desktop: the priority watcher on, heavy steps at low priority.

## Out of scope
Sound, sharing a background with other people, drawing pictures, 3D Pipes (reads as drawn objects, and heavy), a phone layout
(desktop first; nothing may break at phone width).

## Sources (research, 2026-11-15)
Pavel Dobryakov, WebGL Fluid Simulation (MIT; its knobs and "random splats"): https://github.com/PavelDoGreat/WebGL-Fluid-Simulation ;
GPU Gems ch. 38, fast fluid dynamics: https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu ;
David Li, Fluid Particles: https://experiments.withgoogle.com/fluid-particles ; SandSpiel: https://experiments.withgoogle.com/sandspiel
and https://github.com/MaxBittker/sandspiel ; falling sand, bottom-up order (Noita):
https://80.lv/articles/noita-a-game-based-on-falling-sand-simulation/ ; Gravitational Particle Sandbox:
https://experiments.withgoogle.com/gravitational-particle-system-sandbox ; Tweakpane (point pad, interval, graph):
https://tweakpane.github.io/docs/ and https://github.com/tweakpane/plugin-essentials ; lil-gui: https://lil-gui.georgealways.com/ ;
starfield write-up: https://kaeruct.github.io/posts/2024/08/31/starfield-visualization-js/ ; flashing limits (WCAG 2.3.1):
https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
The die, lock, sway, bounce, morph and ghost-pointer controls are this project's own ideas, not taken from a source.
