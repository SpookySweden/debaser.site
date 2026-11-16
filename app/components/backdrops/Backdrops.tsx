'use client';

import { sandEngine } from '../../lib/backdrops/sand/sim';
import CanvasBackdrop from './CanvasBackdrop';

/**
 * The simulated backgrounds (SPEC-backgrounds.md), each drawn only while it is the one chosen in PREFERENCES > BACKGROUND. One
 * place for the shell to mount them all: a new background adds its engine here (and its knobs to the registry, and its row to
 * `BACKDROPS`). The AQUARIUM is not one of these: it moves pictures, not a grid, and has its own component.
 */
export default function Backdrops() {
  return (
    <>
      <CanvasBackdrop engine={sandEngine} />
    </>
  );
}
