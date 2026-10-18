# Character workbench: the live pixel render

Read this before touching the workbench's views (`app/components/CharacterScene.tsx`,
`app/components/CharacterPixelRender.tsx`, `app/lib/character/pixel-render.ts`). The spec it was built from is
`SPEC-pixel-render.md`.

## What it does
The Dead Cells way (Thomas Vasseur, Gamasutra 2018): the figure is drawn tiny with anti-aliasing off, and the
pixel look comes from that size alone. There is no pixelation filter and no outline.

Every frame, in each view:
1. **Colour pass**: the shapes' flat dye colours go into a tiny target. The tallest preset is at most 30 blocks high.
2. **Normal pass**: the same figure goes into a second tiny target, with each pixel recording which way its surface faces.
3. **Light pass**: a full-screen shader multiplies the colour by one of three hard bands (lit 1.0, mid 0.78, shadow
   0.55), picked from `dot(normal, light)`. It then scales up so each low-res pixel is an exact square of screen pixels.

Then, at full resolution: the figure's depth (unseen, so the picked-shape wire hides behind it), then the overlays.
The grid is drawn before the light pass, so it shows round the figure, not through it.

The scene is three groups: `under` (grid), `figure` (shapes) and `over` (wire, transform box, skeleton). Each pass
shows only its own group, and all three are visible again before the frame ends. Picking happens between frames,
so it always hits the real shapes, never the pixels.

## Switches
- **PIXELATE** off: the same passes at full size into multisampled targets, so the edges are smooth.
- **NORMAL LIGHT** off: flat colours.
- **NORMAL MAP**: shows the normal pass itself. It wins over NORMAL LIGHT, which rests (disabled) meanwhile.
- **LIGHT** off (on the ☀ pad): every pixel is in the shadow band.
- **The d-pad**: 45° turns and 30° raises, clamped at ±60°. Steps snap onto that grid. The default light sits on
  the grid (front-left, 30° up).

All the numbers live in `pixel-render.ts`, and the shader is built from them rather than copies of them.

## Gotchas (each one cost a debugging session)
- **three.js orthographic cameras divide the width by `zoom` but not the centre.** A widened low-res frustum
  written in pixels points units away from the figure, and both passes come out empty with no error. Hence
  `lowResFrustum`, which works in model units with zoom 1.
- **`packed` is a reserved word in WebGL's shader language.** A shader that uses it fails to compile and the figure
  silently disappears.
- **Colours are worked in the dye values themselves, not in linear light.** The colour pass writes the hex as it
  is, and the light pass writes its product straight out. A lit pixel is exactly the swatch dye; never route the
  colours through three's colour management.
- **The scene owns the frame.** `useFrame(..., 1)` stops R3F's own render, and nothing else may call
  `gl.render` on that canvas.
- **`TALLEST_PRESET` is measured, not guessed** (2.38 units, NOODLE). `check-character-pixel` fails if a preset
  outgrows it, or if it is stale-high (which would make the pixels needlessly big).

## How it is checked
- `Temp/check-character-pixel.cjs`: the size for every preset, view and screen; the light steps; the defaults; the
  bands; and that each low-res pixel lands on its block, using real three.js cameras.
- `Temp/check-character-frame.cjs`: runs a real frame against a recording renderer and holds the pass order, what
  each pass sees, and the clean-up.
- `Temp/char-drive.cjs [url] [--mobile]`: measures the pixels in Chrome:
  - colour counts and edges on the block grid for each switch
  - the lit side moving with the d-pad
  - ESC and Tab closing only the pad
- `npm run stages`: colours per pane for each layer state.
- `Temp/pixel-shots.cjs [url] [--mobile]`: one screenshot per state.
