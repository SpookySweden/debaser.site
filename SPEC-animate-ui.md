# Animator interface overhaul (Luke, 2026-11-06)

"The animator UI needs a lot of work. Make this another significant task, remove unnecessary buttons and decrease clutter in the UI."

## What's wrong today
At `/animate` the canvas is the smallest thing on screen, at 26% zoom. About 50 keys surround it: two rows above, 11 tools and a size
on the left, a layers panel on the right, two more rows above the timeline, then the site's own side panel and bars.

## Luke's answers
- **On screen all the time:** the canvas and the timeline, nothing else. Tools come from a pop-up by the pen, or from keys.
- **Layers:** a slim fold-out on the right, opened with one key. Closed, it gives its room to the canvas.
- **Around it:** the site's side panel, window title and START strip fold away on this page; tabs and music bar stay reachable. Plus a
  fullscreen mode where the canvas takes the whole screen, with one key to come back.
- **Sign-off:** 2 or 3 working layouts as screenshots, for him to pick. Build only after he picks.

## What this means
- **Remove what isn't needed.** Go through every key and sort it: keep in reach, move to a menu, only show when it applies, or
  remove. A key that repeats another, or that a pen artist would use once a year, doesn't stay on screen. List what you removed.
  No drawing feature is lost, though: anything moved stays reachable through the pop-up, the menu or the keyboard.
- **The tool pop-up** has to work with a pen on a Kamvas 22 and be readable with very poor eyesight: big words, opens at the pen, one
  press to pick, closes itself. Also opens from a key and a visible small key, so a new person can find it.
- **The timeline stays**, as thin as it can be while still readable, with PLAY on it. The frame keys it had move into its menu.
- **One visible way in:** a canvas-only screen must still tell a new person what to do. One small `[ MENU ]`, and a first-time hint
  that goes away for good once used. Current tool, colour and size show near the pen or in one small line, not as keys.
- **Autosave and `SAVED HERE`** stay as a quiet word. No save prompts.

## How it's judged
On a real browser at 1280x900 and 1920x1080, with made-up pen events:
1. On opening, the canvas takes at least 70% of the window's height and is fitted to the space, not 26%.
2. Count keys on screen before and after: about 50 now, and no more than 8 after, not counting the timeline's frames.
3. Draw a 6-frame bouncing ball, with a tool change, a new layer and an onion skin, without opening a panel you must then close to see
   the canvas. Count presses before and after.
4. Fullscreen: nothing on screen but canvas and timeline, one key back, and the work is safe.
5. Everything from phases 0 to 5 still works, and `scripts/drive-animate.cjs` passes, updated on purpose where keys moved.
6. All text at his sizes is readable: at least as strong as the DISCOVER page. Interface scale in SETTINGS still works. Nothing is cut
   off at 400% zoom.

## Rules
Site look and tokens (`docs/design.md`, `docs/theming.md`), keys written like `[ MENU ]`, no drawn icons or AI art: text keys and slots.
Folding the side panel is local to this page, in the same way as the beat box overhaul (`SPEC-beatbox-ui.md`), so check how that session did it and share the code rather than build it twice.
Motion stops under `prefers-reduced-motion`. Drawing speed comes first: nothing here may add lag to a stroke.
