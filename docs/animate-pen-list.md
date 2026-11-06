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

## Phase 3: the Smart Figure (the one to judge)
Make a layer and give it the FIGURE tag (the TAG list in the layer panel). INK (`I`) lands on its lines, FLAT (`F`) and the bucket (`G`) on the colour under them.
1. Ink a shape with a small gap, under 8 pixels. A thin cyan line should show where the gap is closed. Does it close the gaps you'd expect, and leave the ones you left on purpose?
2. FLAT colour: start inside the shape and scribble over the line. It should stop at the line, with no white halo against it, and the colour should show under the line while you draw.
3. Press `Q` (a red SMART OFF badge sits by the pen) and scribble past the line: it goes where the pen goes. `Q` again. Or hold `Q` for just one stroke.
4. Colour something, then redraw part of its line. The smart colour should move to the new line, and the raw colour should stay exactly where it was.
5. Raw strokes: select some with the lasso and press MAKE SMART. They should snap inside the lines.
6. Bucket: hover over areas. Is the tinted preview quick? Press to fill.
7. FILL BRUSH: drag across several areas in one go. FILL ERASER does the same in reverse.
8. On a detailed drawing, does painting ever stutter just after inking a line? Reading the lines happens in the background, and the 8 pixel gap is set per tag.

## Phase 4: tags
1. `CTRL + 1` to `9` make a new layer with that tag (`SHIFT + T` lists them). Chrome may keep some of those for switching tabs: tell me if it does on your machine, and move them with SETTINGS, KEYS.
2. Do the mix you'd really use: a ROUGH sketch (dims blue, leaves renders), a FIGURE, a SHADE over it (multiplies, stays on the figure), a BACKGROUND (on every frame).
3. Make a tag of your own in `[ TAGS ]`: start from a copy of FIGURE, change the gap, turn one behaviour off. Do its switches do what they say?
4. Save your tags to a file with `[ SAVE TAGS ]`, make a new project, load them.
