PLACEHOLDERS FOR NOW
====================
The three PNGs here are placeholders rather than drawings: a black block at the hotspot in the
corner, over transparency, one size per kind - `arrow` 4x4, `pointer` 6x6, `text` 8x8 - so the
plumbing can be seen working (the pointer is where it should be, and each rule reaches the file it
names) without pretending to be the finished thing. They are deliberately not artwork: nothing here
is generated, and a stand-in illustration is the one thing this archive does not do (AGENTS.md).

Replace each one with the hand-drawn PNG described below and nothing else has to change - no code,
no path, no size in the CSS.

RETRO CURSORS
=============

The three pointers this site wears. They are hand-drawn files like everything else and are never
drawn in CSS: the `Cursors` block in `app/globals.css` names these paths, and until a file is
there the browser falls back to the ordinary cursor beside the name - so the site reads normally
whether they have been drawn or not, and a cursor that lands needs no further code.

assets/cursors/arrow.png      the resting pointer, over the desktop
assets/cursors/pointer.png    the link and button pointer, over anything clickable
assets/cursors/text.png       the text pointer, over a field

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
Both live in the `Cursors` block of app/globals.css, one line per kind. Each list ends in the
ordinary cursor (`auto`, `pointer`, `text`), which is what makes a missing file harmless.

Where they apply
----------------
The arrow is the page default; the pointer is on links, buttons, labels and the switches; the text
pointer is on the fields. Anything that says `cursor-pointer`, `cursor-wait` or `cursor-move` in a
component wins over all three, because a control's own opinion about its cursor is a deliberate
statement rather than a default.
