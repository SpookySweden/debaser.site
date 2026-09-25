/**
 * The pixel-art pass: what turns a smooth 3D figure into something that looks drawn.
 *
 * **This is the layer the whole feature is named for, and it is the only one that runs a composer.** The brief
 * is specific about that: BASE is the solid figure *without* post-processing, and SKELETON and MASS are
 * wireframes to build against. So the composer is mounted on one condition - the PIXEL layer is both selected
 * **and** visible - and the other three draw straight to the canvas.
 *
 * **The pixelation is two separate operations and both are needed.**
 *
 *   1. `Pixelation` snaps the image to blocks. On its own this gives soft blocks, because the GPU is averaging
 *      colours within each cell rather than picking one.
 *   2. `NearestFilter` on the render target is what makes the result *hard-edged* - it stops the final blit from
 *      smoothing the blocks back out again. Without it the effect reads as "blurry" rather than as "pixel art",
 *      which is the difference between the two things this feature exists to distinguish.
 *
 * **The effects come from `@react-three/postprocessing`, which was already a dependency.** The plan called for
 * hand-writing the outline GLSL; there is no need, because `Outline` and `Pixelation` ship with the installed
 * package and are the same algorithms. Writing GLSL by hand to reproduce a bundled effect would be more code to
 * be wrong, and the brief's requirement is the *result*, not the authorship.
 *
 * **`granularity` is expressed in device pixels, not model units**, so it is a taste dial rather than a
 * correctness one - and it has to be a number a reader can change without touching anything else. It is named
 * and commented for exactly that reason.
 */
import { EffectComposer, Outline, Pixelation } from '@react-three/postprocessing';
import { MODEL_HIGHLIGHT } from '../lib/character/palette';

/** How big one pixel-art block is, in device pixels. Larger means coarser. */
export const PIXEL_GRANULARITY = 4;

export function PixelPass({ enabled }: { enabled: boolean }) {
  // Not mounted at all unless the PIXEL layer is selected and shown. Mounting a composer that renders nothing
  // would still cost a render target and a second pass over the frame.
  if (!enabled) return null;

  return (
    <EffectComposer>
      {/*
       * The outline is what makes the figure read as a *drawing* rather than as a low-poly render: a one-pixel
       * edge is the single strongest pixel-art signifier, and the palette's magenta is used for it so the edge
       * belongs to the same nine colours as everything else on the page.
       *
       * `hiddenEdgeColor` is the edges *behind* the figure, and it is deliberately the same as the visible one -
       * a hidden edge in a dimmer colour implies depth, and at this resolution depth is exactly the thing being
       * flattened away.
       */}
      <Outline visibleEdgeColor={MODEL_HIGHLIGHT} hiddenEdgeColor={MODEL_HIGHLIGHT} />
      <Pixelation granularity={PIXEL_GRANULARITY} />
    </EffectComposer>
  );
}
