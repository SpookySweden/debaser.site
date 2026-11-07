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

## Windows, play keys and changeable keys (Luke, 2026-11-06)
The Menu column became five windows, one key each on the bar: Sounds, Recorder, Playing, Song and Settings.
- They drag by the title or move by the arrow keys, stay wholly under the main keys, and reopen where they were left, on this browser
  only. Several can be open, the page works behind them, and Esc closes the one in front. At 400% zoom they stack above the notes and don't move.
- The bar has Play/Pause, Stop and Loop. Pause keeps the place, Stop goes back to the picked bar. Loop off plays the song once and
  stops. Recording always goes round. Setting which bars loop stays in the bars column (Set loop).
- Space plays and pauses wherever the cursor is, except in a text box, on a slider, in a set of choices and on a pad. Enter presses a key.
- Settings lists every key. Most can be changed, and a taken key offers to swap. Piano letters, arrows, Enter, Tab, numbers and the
  browser's own keys can't be given a job. Changes stay on this browser.
- Sounds picks a kind of instrument per channel, as BeepBox's own types and waves. A new thing the beat box couldn't do before. It's kept
  in the song, its links and files, and undo brings the last one back.

## Cleaner, snappier, a canvas (Luke, 2026-11-06)
"The beep box needs more cleaning up... I need it to literally be more user friendly than beep box."
- Up and down are arrows everywhere. The bar's words are small glyph keys. Each keeps a full target and a spoken name, and says its name and
  key on the status line when pointed at or tabbed to, so a browser's tooltip is never the only way to find out. Settings has Names on keys,
  which shows the words under the glyphs, and the help lists every glyph.
- The notes are a canvas: the whole bar and every note exist, and the view moves over them. The size keys are gone. The whole bar fits across
  whenever a step can stay 26px wide (0.6 of a target), rows stay a target tall; past that it scrolls. The browser's zoom is the way to bigger.
  Big arrows and a rail beside each view, held to keep going. Drag the note names or the beat numbers, drag with the right or middle button
  anywhere, or turn on the Hand to drag anywhere.
- A note lands as the button goes down, not when it comes up. Keep holding: drag to lengthen or change pitch. Press a note and let go to take it
  away, drag it to move it, drag its right-hand end to change its length. All one undo. (BeepBox waits for the button to come up.)
- The loop bar is the bar numbers, purple as BeepBox's is, and drags as BeepBox's does: the nearer end moves, an end past the other swaps with it,
  a press outside carries the whole loop there. Setting it turns Loop on. With Loop off it's only outlined. Purple is SHERBET's Orchid, borrowed:
  the palette's only one, 4.77:1 under white numbers. Black on white in high contrast. On the keyboard its two ends are sliders.
- Sounds lists 68 named sounds from BeepBox's own instrument list by kind, picked for a dusty 90s hip-hop and Samurai Champloo feel, as well as the
  plain waves. MIT, settings for the synth rather than recordings, no sound files: about 34 KB of text. Moving down a list with the arrow keys plays
  each one.

## How many notes on the grid (Luke, 2026-11-07)
"Make the default number of keys or notes much smaller, and allow options for a few different amounts, one of which is specifically for a 49 key
keyboard midi."
- Small numbers under the grid: 13, 25, 37, 49, All (85). Whole octaves and one, so a scale ends on its root. It starts on 13: every note in view with
  nothing to scroll, the smallest that still holds a whole scale. Rows may give up a tenth of their height for all of them to fit. Remembered on this browser.
- 49 is a 49-key MIDI keyboard's own keys at its own default octave: MIDI 36 to 84, C2 to C6 (4 octaves and one; C2 to C7 would be 61 keys), with middle C as
  C4, and the rows stay on those keys whatever key the song's in. A key played lights its row. Other sizes can go up or down an octave; 49 and All stay put.
- A view, nothing else: no size ever changes a note. The grid is never narrower than the channel's own notes. It grows by whole octaves to show them and
  says so with a + after its range, and shrinks back when they go.
- A key played past the edge is heard, and the status line says it's above or below. If it's being recorded it's written, and the grid grows. Past the engine's
  own range (C0 to C7), it's ignored as it always was.

## Recent songs (Luke, 2026-11-07)
"Add the same feature beep box has where you can recover recent songs you were working on under the open save and share function."
- Under Open and share in the Song window: the last 8 songs worked on, newest first, as BeepBox keeps them (`editor/SongRecovery.ts`): each change is kept 3/4 of a second
  after it stops, older versions thin out so there are more close to now, and older songs with less work go first. In this browser only, signed in or out; no database.
- Each row has a pick of its versions by time, a key to hear it without opening it (BeepBox's little player), and Open, which takes two presses. The song on screen goes on
  the list before anything replaces it, so there's always a way back. Opening one carries on as that song: changes add versions to it.

## Not in scope
The NVDA run and listening tests stay on Luke's list. Phone layout beyond "doesn't break": phones get the zoomed-out desktop.
