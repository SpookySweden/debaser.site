# ANIMATE (SPEC-animator.md)

Luke's frame-by-frame animator, at `/animate`, one key on the site's band. Built from his Claude Doc "Web Frame-by-Frame
Animator — Living Plan" (https://claude.ai/artifact/2X5jdGao81wnUeU4SB7wQK); that doc holds the research and the checklists,
this file holds what was decided for the build.

## Decisions (2026-11-05, the plan's recommendations, taken on Luke's instruction to build autonomously)
1. **Strokes:** raster drawings that also keep every stroke as data (points, pressure, brush, smarts).
2. **Start fresh,** borrowing ideas. Any MIT code reused gets credit in `docs/animate-credits.md`.
3. **Project default:** 1920x1080 at 24 fps. Both can be changed per project.
4. **Smarts:** 8 px gap, Q is the master toggle (tap flips, hold is one stroke).
5. **Name and licence:** ANIMATE; the licence stays with the site's. It is Luke's to change.
6. **Local only for version 1.** Nothing goes to the database or any server: people's drawings stay in their browser
   (Origin Private File System for pictures, IndexedDB for project data) and in project files they save themselves.

## Where it departs from the plan
- **A page in this Next.js site, not a separate Vite app.** Phase 0's "Vite project, deployed as a static site" became a page
  at `/animate` with one nav entry. It deploys with the site.
- **Offline:** once the page is open it needs no network to draw, save or export. Opening it cold with no connection needs an
  installable web app (service worker), which the site does not have; left out of version 1 and said here so it isn't assumed.
- **q-floodfill is not used.** The plan lists it for the basic fill, but the Phase 3 region map already answers "what would this
  fill cover", and a raw fill on a plain layer is a short scanline in the background worker. One fewer package.
- **Code draws no icons:** every tool is a word in a bracket key, so the plan's "tag icon" is a short text mark, and no art slots
  are needed. Tag and paint colours are people's data (`app/lib/animate/colours.ts`, skipped by the token guard like a name's
  swatch); the UI's own colours come from the tokens.
- **Licence of the plan's Mediabunny (MPL-2.0)** is compatible with using it as an untouched package; credited.

## Where things live
- `app/animate/page.tsx`: the page; `AnimateBoot.tsx` beside it tells the workers where they live. `app/components/animate/`: its panels.
- `app/lib/animate/`: pure logic (`project.ts`, `zip.ts`, `regions-core.ts`...), covered by `Temp/check-animate-*.cjs`, and the
  browser engine (`engine.ts`, `planes.ts`, `storage.ts`) and workers (`*.worker.ts`).
- `scripts/drive-animate.cjs`: drives the real page in a browser with synthetic pen events.
- `docs/animate-pen-list.md`: what only a real pen can prove, for Luke to try on the Kamvas 22.
- `docs/animate-credits.md`: every library and its licence.

## Model in one paragraph
A project has layers and folders (a flat list, top first, children right after their folder). A layer has cels: a start frame, an
exposure length, a drawing. A drawing has two planes, Line and Colour (plain layers use only Line), and each plane has a list of
operations (strokes, fills, moves) as data, plus a picture that is what those operations left. Undo restores both. Tags are
named bundles of behaviours; a stroke records which were on when it was drawn.

## Out of scope for version 1 (from the plan)
Bone rigging, tweening, AI-generated colour or in-betweens, cloud accounts, symmetry, perspective guides, rulers.
