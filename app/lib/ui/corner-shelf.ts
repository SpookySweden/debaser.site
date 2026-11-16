/**
 * Where the corner keys above the player go (CornerShelf.tsx): `[ ▲ ROOM ]`, the folded stream's `ROOM :: LIVE` and
 * `[ ▲ WINDOW ]`. The shelf hands its slot here once it is drawn; a key draws itself into it through a portal, so they stand
 * side by side (or in a column over the folded player) instead of each on the same spot. Null until the shelf is drawn.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setCornerSlot(next: HTMLElement | null): void {
  if (slot === next) return;
  slot = next;
  for (const listener of listeners) listener();
}

export function cornerSlot(): HTMLElement | null {
  return slot;
}

export const noCornerSlot = (): HTMLElement | null => null;

export function subscribeToCornerSlot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
