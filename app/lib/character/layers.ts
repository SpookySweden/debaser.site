/**
 * Which of the three *render* layers is showing, as one decision rather than three booleans.
 *
 * **This is the fix for a model that could not work.** The three were independent visibility flags with a
 * priority order - `pixelVisible ? 'pixel' : baseVisible ? 'base' : massVisible ? 'mass' : null` - and PIXEL was
 * on by default, so it always won: BASE was unreachable, and switching PIXEL's eye off changed the whole render
 * instead of just removing the pixelation. Three eyes over one picture is three ways to be confused about which
 * one is on.
 *
 * They are not three objects. They are **stages of one pipeline**:
 *
 *   MASS   the geometry as edges         - a build view
 *   BASE   the solid figure, unpixelated - what the shape looks like at full resolution
 *   PIXEL  the solid figure, through the composer - what it looks like as pixel art
 *
 * One of the three is showing at a time, which is what a radio group is for. The *skeleton* stays separate,
 * because it genuinely is independent: you look through the wireframe while editing either the mass or the
 * pixels, and that is the whole reason the eye exists.
 */
export type RenderLayerId = 'mass' | 'base' | 'pixel';

export const RENDER_LAYER_IDS: readonly RenderLayerId[] = ['mass', 'base', 'pixel'];
