The chrome a window is built from: frames, bars, and the rules between them.

  window-frame.png           64x64, drawn at 64x64 (x2), shown 32x32
  window-frame-inset.png     64x64, drawn at 64x64 (x2), shown 32x32
  title-bar.png              48x48, drawn at 48x48 (x2), shown 24x24
  title-bar-inactive.png     48x48, drawn at 48x48 (x2), shown 24x24
  status-bar.png             44x44, drawn at 44x44 (x2), shown 22x22

All five are 9-sliced: the four corners are drawn once and the edges and middle
stretch to fit any window, so nothing in the middle of the file may be unique -
a window is usually far wider than the drawing. The margin insets, in *drawn*
pixels, are in `app/lib/ui/art/slots.ts` next to each slot, and `npm run art`
fails if a margin reaches or passes the edge of the drawing (an inset bigger than
half the file leaves no middle to stretch).

A title bar is two files rather than one drawn twice: the inactive bar is the
same bar on a window nobody is working in, and it has to read quieter than the
active one. Draw them as a pair or not at all.

None of these files is required. Until one is drawn, the window chrome is the two
Tailwind borders `BEVEL_OUT` and `BEVEL_IN` write in `app/lib/ui/controls.ts`,
which is the look the site ships today.

The sizes, and the one rule that keeps a drawing crisp
------------------------------------------------------
    natural = shown x k        (k a whole number)

`npm run art` reads the registry in `app/lib/ui/art/slots.ts` and fails on a file
that is not exactly `shown x k`, because a drawing shown at a fractional ratio
resamples and every line in it goes soft.
