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
