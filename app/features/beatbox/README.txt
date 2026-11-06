THE BEAT BOX
============

A copy of the package built in its own folder, debaser-beatbox, where its tests live (about 230 of them,
run with vitest). The site has no vitest, so the tests are not copied here. See its CLAUDE.md and docs/PLAN.md.

This copy is the live one, and its screen has moved on (SPEC-beatbox-ui.md, 2026-11-06): the grid fills the window, one
slim bar sits on top, the bars run down a column on the left, and every setting is in the menu. The folder's copy still
has the old screen. Its tests for visibleColumnCount, visibleRowCount and rowsThatFit are of functions this copy has
replaced with fitGrid, which Temp/check-beatbox-fit.cjs holds.
The acceptance tests are Temp/check-beatbox-ui.cjs, in a real browser, by hand: --url <address>.

- engine/    around BeepBox's synth. The only place here that imports `beepbox`, pinned to 4.2.0. It reaches into
             private parts of that synth for the count-in and timing, so re-check those on any upgrade.
- recorder/  the loop recorder, as plain functions.
- input/     computer keys, pads and Web MIDI, as one stream of notes.
- ui/        the screen. `<BeatBox>` in ui/BeatBox.tsx is the entry.
- theme/     tokens.css reads the site's dyes, beatbox.css is the look, tailwind.css names both for Tailwind.

The page itself is app/beatbox/page.tsx, with app/components/BeatBoxLoader.tsx and BeatBoxRoom.tsx.
Saved songs are in app/lib/beatbox/. A song is BeepBox's own format, so beepbox.co opens it too.
