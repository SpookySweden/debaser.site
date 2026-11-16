'use client';

import { useSyncExternalStore } from 'react';
import { backdropState, subscribeToBackdrop, type BackdropState } from '../../lib/ui/backdrop-slot';
import Aquarium from '../Aquarium';
import { fluidEngine } from '../../lib/backdrops/fluid/sim';
import { mystifyEngine } from '../../lib/backdrops/mystify/sim';
import { sandEngine } from '../../lib/backdrops/sand/sim';
import { starfieldEngine } from '../../lib/backdrops/starfield/sim';
import CanvasBackdrop from './CanvasBackdrop';

/**
 * The simulated backgrounds (SPEC-backgrounds.md), each drawn only while it is the one chosen in PREFERENCES > BACKGROUND. One
 * place for the shell to mount them all: a new background adds its engine here (and its knobs to the registry, and its row to
 * `BACKDROPS`). The AQUARIUM is not one of these: it moves pictures, not a grid, and has its own component.
 */
/**
 * The chosen background drawn inside a box rather than behind the page: the surround of a fullscreen picture
 * (SPEC-rooms-your-room.md, part 3), where nothing of the page itself shows. It fills the box it is in, which must be
 * positioned; that box marks the picture `data-backdrop-solid` (sand rests on it, ink goes round it) and itself
 * `data-backdrop-press` if a press on the surround should pour or splat. Live, like the page's own copy, which rests meanwhile.
 */
export function StageBackdrop() {
  const chosen = useSyncExternalStore<BackdropState | null>(subscribeToBackdrop, backdropState, () => null);
  if (chosen === null) return null;
  // TILE is a pattern, not a simulation: the same class the desk wears.
  if (chosen.id === 'tile') return <div aria-hidden="true" className="backdrop-stage-tile desktop-tile" data-backdrop-scene="tile" />;
  return (
    <>
      <Aquarium stage />
      <CanvasBackdrop engine={sandEngine} stage />
      <CanvasBackdrop engine={fluidEngine} stage />
      <CanvasBackdrop engine={starfieldEngine} stage />
      <CanvasBackdrop engine={mystifyEngine} stage />
    </>
  );
}

export default function Backdrops() {
  return (
    <>
      <CanvasBackdrop engine={sandEngine} />
      <CanvasBackdrop engine={fluidEngine} />
      <CanvasBackdrop engine={starfieldEngine} />
      <CanvasBackdrop engine={mystifyEngine} />
    </>
  );
}
