import { AQUARIUM } from '../aquarium/settings';
import type { BackdropDef } from './knobs';
import { SAND_DEF } from './sand/def';

/**
 * Every background that has settings (SPEC-backgrounds.md), by the id it has in `../ui/backdrop-slot.ts`. TILE has none and is
 * not here. A new background adds its `BackdropDef` to this list, its row to `BACKDROPS`, and its component to `layout.tsx`.
 */
export const BACKDROP_DEFS: readonly BackdropDef[] = [AQUARIUM, SAND_DEF];

export function backdropDef(id: string): BackdropDef | null {
  return BACKDROP_DEFS.find((def) => def.id === id) ?? null;
}
