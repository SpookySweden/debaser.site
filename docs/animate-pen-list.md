# ANIMATE: try this with the pen

What only Luke's hand on the Kamvas 22 can prove. Everything else is checked by `scripts/drive-animate.cjs` with made-up pen events,
which can test the numbers but not the feel.

If the pen gives no pressure at all: in the Huion driver, tick "Windows Ink". Chrome and Edge read pressure through it.

## Phase 0: the line
1. Draw with INK (`I`). Does a heavy press go thick and a light one thin, without a jump?
2. Draw a fast scribble. Does the line keep up, or does it lag behind the nib?
3. If the line flickers or shows gaps while drawing, tell me: the low-latency drawing mode is a browser hint and some graphics
   drivers dislike it. It can be turned off.
4. STEADY: drag it up on INK and draw a slow curve. Smoother, and not annoyingly late?
5. The pen's eraser end, if it has one: does flipping it erase?
6. The pen's barrel button: does it drag the view, and drop a stroke if pressed mid-line?
7. Rest your hand on the screen while drawing, if touch is on. Nothing should draw from the palm.

## Phase 1: animating
1. Draw a bouncing ball over 6 to 8 frames. Keys: `.` and `,` step, `D` starts a new drawing, `O` turns the onion on, `Enter` plays.
2. Does the onion show enough of the last drawing to trace, without being in the way? Tints and opacities are behind `SHIFT + O`.
3. Drag a drawing's end on the timeline with the pen. Is the grab handle wide enough to hit? (Hold Shift to push what follows.)
4. Does 24 fps playback look even? It should start at once; a very long shot says READYING first.

## Phase 2: organising
1. Turn the interface up with `[ UI + ]`, up to 300%. Press `\` for full screen, and the backtick key to hide every panel and draw with only the sheet.
2. Drag a layer's name with the pen to reorder it, and drop it on a folder. Is it easy to hit? Are the V, L and S keys on a row big enough?
3. SETTINGS, PEN: try the SOFT and FIRM curves, or drag the two handles. Is there a curve that suits your hand? It's kept once set.
4. Box-select (`SHIFT + W`) or lasso (`W`), then drag inside to move, a corner to scale, the top handle to turn. Are the handles big enough to hit? Move a drawing, then undo.
