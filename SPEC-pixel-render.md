# SPEC: Dead Cells-style live pixel render + friendlier workbench

Interviewed 2026-10-14. Build in a fresh session. Read CLAUDE.md, `docs/design.md`, and this file first.
The workbench is `app/components/CharacterViewport.tsx` (panels), `CharacterScene.tsx` (the two 3D views),
`CharacterPixelPass.tsx` (today's FINAL look), store in `app/lib/character/store.ts`.

## Research: how Dead Cells does it (primary source)
Thomas Vasseur, "Art Design Deep Dive: Using a 3D pipeline for 2D animation in Dead Cells", Gamasutra 2018
(read via web.archive.org, snapshot 2019-03-28, news/313026). In short:
- Simple 3D models with a skeleton (3DS Max). The character is only ~50px tall in game, so models are rough.
- A small in-house tool renders the mesh at that very small size with **anti-aliasing off**: that alone gives
  the pixel look. No pixelation filter afterwards.
- Every frame is exported as **a colour PNG plus a normal map**.
- In game a **basic toon (cel) shader** lights the sprite from the normal map, so the flat pixel art reacts to
  the level's dynamic lights. Cel shading, low resolution, no anti-aliasing.
- Flickering pixels between frames are accepted, not hand-cleaned.
Not documented anywhere I could find: exact number of light bands, normal-map space, outline use.
Secondary: Dan Moran's recreation (github.com/Broxxar/PixelArtPipeline) renders colour and normals to separate
low-res targets the same way.

## What to build
### The render, live in both views (replaces today's SHAPES / FINAL switch and the Pixelation+Outline composer)
Every frame, per view:
1. **Colour pass**: the figure's flat, unlit shape colours rendered into a tiny render target, nearest-neighbour,
   no anti-aliasing. Size: the figure is **at most ~30 pixels tall** (owner: chunkier than Dead Cells' 50).
   Pick the target size from the view's height so the tallest preset is ~30 low-res pixels.
2. **Normal pass**: the same figure, same tiny target, each pixel storing its surface direction (view-space
   normal encoded as colour).
3. **Light pass (cel/toon shader)**: a full-screen shader reads both: colour x light band, where the light
   amount is `dot(normal, lightDir)` snapped into hard bands (3 bands: lit / mid / shadow, plus ambient so
   shadow is never black). This is always cel-banded; there is no smooth option.
4. Scale up to the view with hard pixel edges (nearest filter). No outline (Dead Cells has none; the current
   Outline effect goes).
Colours stay the dye palette. The light keeps its existing azimuth/elevation in the store.

### Layer switches (on/off buttons, in a small LAYERS group)
- **PIXELATE**: off = render at full resolution (smooth) with the same lighting.
- **NORMAL LIGHT**: off = flat colours, no shading at all.
- **NORMAL MAP**: shows the normal pass itself (the rainbow image) instead of the lit colour, so you can see
  what the light reads. Exclusive view, not combined with the others.
- **LIGHT**: on/off for the light source itself (off = ambient only, figure evenly lit). Lives on the light
  pop-out (below), not in LAYERS.
Defaults on arrival: PIXELATE on, NORMAL LIGHT on, NORMAL MAP off, LIGHT on.

### Editing on top of the pixel render
The grid, transform box, handles and skeleton stay drawn crisp (full resolution) over the pixel image, so a
reader edits while seeing the final look. Picking shapes still hits the real 3D shapes, not the pixels.

### Light d-pad
- One small **☀** button in the corner of the views (one, shared by both views, not one per view).
- Tap it: a compact d-pad pops out beside it (absolutely positioned, nothing moves):
  left / right turn the light round the figure in **45° steps**; up / down raise and lower it in **30° steps**
  (clamped short of straight up/down); the centre button resets to the default light; plus a LIGHT ON/OFF switch.
- Tap away, press ☀ again or ESC to hide it (ESC must not close the customiser; the NEW FIGURE picker already
  shows how). Remove the two light sliders from the figure panel.
- Optional nice touch: a small sun marker drawn at the view's edge showing where the light comes from.

### Friendlier UI pass (owner: too much text, too crowded, hard to find things)
- **Less text**: drop the long hint sentences from the options bar and panels; tool hints move to tooltips
  (title) and a one-line status at most. Short labels everywhere.
- **Less crowded**: show only what the current tool needs. Collapse the properties into small sections
  (SHAPE / COLOUR / PIN / NUMBERS) with NUMBERS folded by default. The figure panel shrinks to NEW FIGURE +
  skeleton switch once the light sliders go.
- **Easier to find**: group the strip into three clear blocks with gaps: EDIT tools (select, add, move, turn,
  size, delete), POSE, and HISTORY (undo, redo, new). LAYERS and ☀ sit together at the top-right of the views.
- Keep all existing behaviour and checks' rules (two-press NEW, one drag = one undo step, reveals don't shift
  layout, theme colours, 10px minimum text, phone layout works).

## Out of scope
Outline, cel-band on/off, smooth-light option, multiple lights, animation/flicker handling, saving layer
settings per figure, any artwork.

## Proof (state it up front in the build session)
- Node checks: render-target size gives a <=30px-tall figure for every preset in both views; the d-pad steps
  are 45°/30° and clamp; layer defaults; the composer is gone and the new passes exist.
- Browser (Temp/char-drive.cjs, extended): each layer switch changes the pixels (count colours in a view
  before/after: PIXELATE on should give far fewer distinct colours; NORMAL MAP should show the rainbow; LIGHT
  off should flatten shading), d-pad moves the lit side, ESC closes only the pop-out.
- Screenshots desktop + phone on the live site, one per layer state, sent to the owner.
- Fresh-context review of the diff against this spec.
