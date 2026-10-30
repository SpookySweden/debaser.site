PLACEHOLDERS FOR NOW
====================
The nine PNGs here are placeholders rather than drawings: each is a 32x32 canvas with a plain block at
the hotspot in the corner, in its set's colour with a one-pixel edge in the opposite colour so it shows
on any background - `arrow` 10x10, `pointer` 12x12, `text` 6x14 - over transparency. They are
deliberately not artwork: nothing here is generated, and a stand-in illustration is the one thing this
archive does not do (CLAUDE.md).

`npm run art` reads this folder against `app/lib/ui/art/slots.ts` and prints each of the nine as a
stand-in every run, so a placeholder is never mistaken for a finished drawing.

Replace each one with the hand-drawn PNG described below and nothing else has to change - no code,
no path, no size in the CSS.

RETRO CURSORS
=============

Three pointers, in three colour sets. The reader picks one in PREFERENCES > CURSOR:

  CONTRAST  (the default) the WHITE set on the dark theme, the BLACK set on the light one
  WHITE     the WHITE set on every theme
  BLACK     the BLACK set on every theme
  PINK      the PINK set (Brilliant Pink) on every theme
  SYSTEM    the computer's own pointer - no files

So there are nine files to draw, three per set:

assets/cursors/arrow-white.png     pointer-white.png     text-white.png
assets/cursors/arrow-black.png     pointer-black.png     text-black.png
assets/cursors/arrow-pink.png      pointer-pink.png      text-pink.png

arrow is the resting pointer, pointer is over anything clickable, text is over a field. Give each a
one-pixel edge in the opposite colour (black round the white and pink ones, white round the black)
so it still shows when it crosses something its own colour.

They are hand-drawn files like everything else and are never drawn in CSS: the `Cursors` block in
`app/globals.css` names these paths, and until a file is there the browser falls back to the
ordinary cursor - so the site reads normally whether they have been drawn or not.

What to draw
------------
- 32x32 PNG with transparency. That is the size every browser takes and the size they are drawn
  at; anything larger is refused by some browsers outright.
- The cursor is never scaled, so draw it at its own size: one drawn pixel per screen pixel, with
  hard edges. A drawn pixel per two screen pixels also reads well on a modern high-density screen.
- The hotspot is the top-left corner (the `0 0` in globals.css), so put the point of the arrow
  there, and the top of the I-beam.

Changing the names or the hotspots
----------------------------------
Both live in the `Cursors` block of app/globals.css, one line per kind in each set. Each list ends in the
ordinary cursor (`auto`, `pointer`, `text`), which is what makes a missing file harmless.

Where they apply
----------------
The arrow is the page default; the pointer is on links, buttons, labels and the switches; the text
pointer is on the fields. Anything that says `cursor-pointer`, `cursor-wait` or `cursor-move` in a
component wins over all three, because a control's own opinion about its cursor is a deliberate
statement rather than a default.
