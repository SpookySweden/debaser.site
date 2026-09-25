/**
 * Turning a pointer drag into a joint's next position.
 *
 * **This is arithmetic, so it lives here and not in a pointer handler.** A drag is the one place in this
 * feature where two coordinate spaces meet - the screen, where the pointer moves in pixels, and the model,
 * where a joint sits in units - and getting it wrong is the kind of bug that cannot be seen failing in a
 * screenshot. Keeping the maths in a pure function with no DOM and no Three.js means it can be driven in Node
 * and held to account, which `Temp/check-character.cjs` does. The handler's job is reduced to reading two
 * pointer positions and calling this.
 *
 * **The viewport decides which axes are free, and that is the whole design.** A joint has three degrees of
 * freedom but a flat pane shows two of them, and the third is invisible - so dragging in the FRONT pane moves
 * x and y and leaves z exactly where it was, while the SIDE pane moves z and y. That is not a limitation to be
 * worked around by guessing: it is the reason both panes exist at once, because a movement the front pane
 * cannot express is one the side pane shows directly. The mapping lives in `AXES_FOR_VIEW` rather than in a
 * branch inside the handler, so the handler stays a single line and the rule is readable.
 */
import type { Vec3 } from './skeleton';

/** Which orthographic pane a drag happened in. The two the brief asks for, and no third. */
export type ViewportKind = 'front' | 'side';

/**
 * The two model axes a pane's pointer can move, in the order (horizontal, vertical).
 *
 * FRONT looks down -z, so the pane's horizontal is x and its vertical is y. SIDE looks down -x, so the
 * pane's horizontal is z and its vertical is y. Both share y, which is what makes them two views of one
 * object rather than two objects: an arm raised in the front pane is raised in the side pane too.
 */
export const AXES_FOR_VIEW: Record<ViewportKind, { horizontal: keyof Vec3; vertical: keyof Vec3 }> = {
  front: { horizontal: 'x', vertical: 'y' },
  side: { horizontal: 'z', vertical: 'y' },
};

/**
 * How many model units one pixel of drag is worth.
 *
 * **This is the number the camera is built from, not a preference to tune alongside it.** `CharacterScene` sets
 * its orthographic `zoom` to `1 / UNITS_PER_PIXEL`, because Three divides the frustum by `zoom`: the visible
 * world width is `paneWidthPx / zoom`, so a pixel is `1 / zoom` units and the two constants are the same fact.
 * Having them as 120 and 200 - which they were - means a dragged joint moves 1.67 times further than the
 * pointer, which reads as "the drag is a bit off" rather than as a bug, and is why the camera check exists.
 *
 * Changing this changes how much of the figure fits in the pane, since the pane size is fixed in rem. At 1/150
 * a 26rem pane - 416px at a 16px root - shows 2.77 units, against a rig measured at 2.29 tall: about a quarter
 * of a unit of margin above and below, which is enough that the hands and feet are inside the frame with the
 * default pose. `Temp/check-character-camera.cjs` measures the rig and fails if the two stop agreeing.
 */
export const UNITS_PER_PIXEL = 1 / 150;

/**
 * The offset a drag has produced, in the joint's own parent space.
 *
 * `dy` is negated: screen coordinates grow downward and model y grows up, so dragging a joint *up* has to
 * increase its y. Forgetting that flip is the single most common way a drag ends up inverted, and having it
 * here - with a check asserting it - is cheaper than noticing it by eye on a figure nobody can screenshot.
 *
 * An untouched axis is exactly `0` rather than "left alone", because the caller adds this to the joint's
 * current position: adding zero is what leaves the other axis where it was, and it means the function needs no
 * knowledge of the joint at all.
 */
export function dragOffset(view: ViewportKind, dxPixels: number, dyPixels: number): Vec3 {
  const axes = AXES_FOR_VIEW[view];
  const offset: Vec3 = { x: 0, y: 0, z: 0 };
  if (!Number.isFinite(dxPixels) || !Number.isFinite(dyPixels)) return offset;

  offset[axes.horizontal] = dxPixels * UNITS_PER_PIXEL;
  // `+ 0` rather than a bare negation: negating a zero produces `-0`, and while `-0 === 0` is true and it
  // renders identically, a signed zero in stored data is a value that compares oddly, serialises as `-0`, and
  // trips `assert.equal`. Adding zero normalises it away, and it is the only reason this is not just `-dy`.
  offset[axes.vertical] = -dyPixels * UNITS_PER_PIXEL + 0;

  return offset;
}

/**
 * The scale a drag in the MASS layer has produced.
 *
 * A relative multiplier rather than an absolute size, because the joint already carries a scale and a drag
 * should adjust it rather than replace it: the same drag on a big limb and a small one should change both by
 * the same proportion, which is what "rescaling" means. Exponential in the drag distance so that dragging up
 * and then down by the same amount returns to where it started - a linear mapping would make a large scale
 * easy to leave and a small one hard to reach.
 *
 * Clamped at `MIN_SCALE`: a joint scaled to zero is a joint whose mass cannot be picked up again, because the
 * geometry has no extent to hit.
 */
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;

export function scaleForDrag(currentScale: number, dyPixels: number): number {
  if (!Number.isFinite(dyPixels) || !Number.isFinite(currentScale) || currentScale <= 0) return currentScale;

  // Dragging up (negative dy) grows: 200 pixels up is about 2.7x, and the clamp catches the rest.
  const next = currentScale * Math.exp(-dyPixels / 200);

  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
}

/**
 * Where the light ends up after a drag, in radians.
 *
 * Deliberately the same shape as `dragOffset` - a horizontal drag turns the light around the figure, a
 * vertical one raises or lowers it - because the LIGHT layer is a drag like any other and should feel like
 * one. `elevation` is clamped short of the poles: a light directly overhead or underneath flattens every
 * facet to the same shade, which is the one thing this layer exists to avoid.
 */
export const MAX_ELEVATION = Math.PI / 2 - 0.05;

export function lightForDrag(
  current: { azimuth: number; elevation: number },
  dxPixels: number,
  dyPixels: number,
): { azimuth: number; elevation: number } {
  if (!Number.isFinite(dxPixels) || !Number.isFinite(dyPixels)) return { ...current };

  return {
    azimuth: current.azimuth + dxPixels * (Math.PI / 200),
    elevation: Math.min(MAX_ELEVATION, Math.max(-MAX_ELEVATION, current.elevation - dyPixels * (Math.PI / 200))),
  };
}
