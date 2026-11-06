# Beat box usability overhaul (Luke, 2026-11-06)

"The UI needs a serious overhaul for usability. This needs to be treated as an important task to be done correctly."

## What's wrong today
The page at `/beatbox` opens on a long list of keys and settings: FOLLOW, FOCUS VIEW, AUDIO MODE, HIGH CONTRAST and the loop
recorder's words. The note grid, the thing you make music with, is out of sight below the fold. Keys wrap across several rows
at no clear priority and spell out shortcuts, like `[ PLAY (SPACE) ]`. See `Temp/browse/beatbox-desktop.png` or the live page.

## Luke's answers
- **First screen:** the grid fills the screen. Notes in the middle, with one slim bar on top: PLAY, RECORD, UNDO and speed.
  Settings such as audio mode and high contrast move into a menu. Everything you need without scrolling.
- **Around it:** full window with a way back. The side panel folds away so the grid gets all the room, the site's tabs and music
  bar stay reachable, and one key brings the panel back. Leaving the page restores the panel as it was.
- **Size:** big keys, short words. PLAY, RECORD, UNDO, with shortcuts in the `[ ? ]` help and on hover. Big notes, with S to XL
  still there. He has very poor eyesight, so this is a requirement, not a preference.
- **Sign-off:** 2 or 3 working layouts first, as screenshots, for him to pick. Build only after he picks.

## How it's judged
These are the acceptance test, on a real browser at 1280x900 and at 1920x1080:
1. On opening, the grid and the main keys are all visible, with no scrolling, and nothing wraps.
2. Make a 4-bar beat with a drum channel and a tune using only the keyboard, with no scrolling and no reading of help. Count the
   key presses before and after, and report both.
3. The same using only the mouse.
4. Record three loop passes and undo the last one, without leaving the screen.
5. A new person can tell what to press first: one obvious main key, and an empty grid that says what to do.
6. At the XL size, and at 400% browser zoom, nothing is cut off or needs sideways scrolling, except where the grid is meant to scroll.
7. Everything that worked still works: all existing tests pass, keyboard reach, screen-reader announcements, MIDI, opening a
   link, exporting, saving, and sharing to the forum. No feature is lost; settings only move.

## Rules
- The site's look: `docs/design.md`, `docs/theming.md`, tokens only, keys written like `[ PLAY ]`.
- No AI art, and no drawn icons: text keys and art slots.
- BeepBox is the engine and an inspiration for how a grid works, not a look to copy. Credits stay in `CREDITS.md`.
- Don't change how the sound engine works. This is about the interface.
- Motion stops under `prefers-reduced-motion`. Contrast 4.5:1 in every theme.
- Text sizes and focus rings must be at least as strong as on the DISCOVER page.

## Not in scope
The NVDA run and listening tests stay on Luke's list. Phone layout beyond "doesn't break": phones get the zoomed-out desktop.
