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

## What was built (Luke picked 2026-11-06: layout A, with B's block of word tiles as the pop-up)
Told before he picked: the corner keys sit over the top of the sheet at 1280x900, and a tool change takes 2 presses with a pen or mouse.

On screen: `[ MENU ]`, `[ TOOLS ]` and one small line (tool, colour, size, SAVED HERE) top left; `[ LAYERS ]` top right; `[ PLAY ]`,
where we are and `[ FRAMES ]` on the timeline, with one row for the layer in hand. The side panel's fold is the beat box's own
(`app/lib/ui/side-panel-page.ts`, `SiteWindow fill`).

### Every key, sorted
**Kept on screen:** PLAY, the layer's name on the timeline. **New:** MENU, TOOLS, LAYERS, FRAMES (`SHIFT + F`).

**Moved to the tool pop-up** (right button, the pen's barrel button, `X`): PENCIL, INK, FLAT COLOUR (now FLAT), ERASER, BUCKET, FILL BRUSH,
FILL ERASER, LASSO, BOX SELECT (now BOX), SHIFT + TRACE (now TRACE), PICK COLOUR, HAND, UNDO, REDO, SMART ON/OFF, + LAYER (also in the layers, now
NEW LAYER here), ONION, the palette's swatches, the SIZE, OPACITY and STEADY sliders (now `[ - ]` and `[ + ]`, 10% a press, so there's no slider
to aim at; SIZE by a quarter; OPACITY still goes to the old slider's 5%). It also gets LAYERS, FULL SCREEN and MENU, so a pen with no keyboard to hand can reach them in full screen.

**Moved to `[ MENU ]`, with its key beside it:** PROJECTS, OPEN, SAVE FILE (its `*` stays, on the row), PICTURE, EXPORT, FIT, UI - and UI + with the
reading, the zoom reading, FULL, SETTINGS, `[ ? ]` (the menu is now the list of keys, with the gesture notes at its top), the project's name.

**Moved to the timeline's menu, `[ FRAMES ]`:** LOOP, PING-PONG, ONCE, IN, OUT, the range's clear (only when there's a range), FPS (now SPEED, by steps),
NEW, COPY, DEL, MARK, 1S, 2S, 3S, CARRY COLOUR, the onion's `[ ... ]` (now ONION SETUP), LIGHT TABLE, SOUND, the frame width's `[-]` and `[+]`.
**New there:** ROWS SHOWN, because the timeline shows one row at first; ADD FRAME and CUT FRAME, which had only keys.

**Moved to a COLOURS panel** (the pop-up or the menu): the colour field, keep and drop a colour (`[ + ]` and `[ - ]`, now `[ KEEP IT ]` and `[ DROP IT ]`), palette SAVE and LOAD.

**Only show when they apply:** BEFORE, AFTER, MOVE, TURN, SCALE, SNAP BACK (with TRACE in hand), MAKE SMART (with something selected), READYING
(while getting a long shot ready). All at the foot of the sheet or on the timeline.

**Removed:** HIDE PANELS: full screen does its job; its backtick key is now full screen, and `\` moved to the site's side panel, as on the beat box.
The sheet alone with no timeline went with it, which SPEC's "canvas and timeline" asked for. The KEYS panel: the menu lists every key.

**Changed:** the right button and the pen's barrel button open the tools. They dragged the view; Space, the middle button and HAND still do. Mid-line they
still drop the stroke. LEFT-HANDED in SETTINGS used to put the tools on the right; it now opens them to the left of the pen.
