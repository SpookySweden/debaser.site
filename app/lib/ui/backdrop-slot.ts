/**
 * Which background is behind the site window, as a store outside React - the cursor's arrangement (`./cursor-slot.ts`), and for
 * the same reason: changing it must not re-render the board. The choice is the `data-backdrop` attribute on `<html>`, which
 * globals.css reads, and the aquarium itself is drawn once in `layout.tsx` (`../../components/Aquarium.tsx`) while it is the one on.
 *
 * The simulated backgrounds (SPEC-backgrounds.md: `sand`, `fluid`, `starfield`, `mystify`) are drawn by `../../components/backdrops/`.
 * `aquarium` is the Windows 98 Underwater screensaver's sea (Luke, 2026-11-15: "the animated windows 98 fish background ... as the
 * new default"); `tile` is the desktop tile every theme colours, which was the only background before it.
 */
import { createWindowSlot } from './window-slot';

export type BackdropId = 'aquarium' | 'sand' | 'fluid' | 'starfield' | 'mystify' | 'tile';

export type Backdrop = {
  id: BackdropId;
  label: string;
  /** The row's hover tip. */
  note: string;
};

export const BACKDROPS: readonly Backdrop[] = [
  { id: 'aquarium', label: 'AQUARIUM', note: 'THE WINDOWS 98 UNDERWATER SEA: FISH SWIM BEHIND THE WINDOW' },
  { id: 'sand', label: 'SAND', note: 'FALLING SAND: IT HEAPS ON THE WINDOW, AND YOU POUR MORE WITH THE POINTER' },
  { id: 'fluid', label: 'FLUID', note: 'INK IN WATER: STIR IT WITH YOUR POINTER' },
  { id: 'starfield', label: 'STARFIELD', note: 'THE WINDOWS 98 FLIGHT THROUGH THE STARS' },
  { id: 'mystify', label: 'MYSTIFY', note: 'THE WINDOWS 98 BOUNCING SHAPES AND THEIR TRAILS' },
  { id: 'tile', label: 'TILE', note: "THE DOTTED DESKTOP, IN THE THEME'S OWN COLOURS" },
];

/** What a browser with no choice stored gets. */
export const DEFAULT_BACKDROP: BackdropId = 'aquarium';

const STORAGE_KEY = 'debaser.site.backdrop.v1';

export type BackdropState = { id: BackdropId };

/** A stored id that is no longer offered falls back to the default rather than throwing. */
function backdropId(stored: string | null): BackdropId {
  return BACKDROPS.find((backdrop) => backdrop.id === stored)?.id ?? DEFAULT_BACKDROP;
}

function readStored(): BackdropId {
  try {
    return backdropId(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // No storage (private mode, blocked cookies): the default stands.
    return DEFAULT_BACKDROP;
  }
}

// Read straight away in a browser, so a reader who chose TILE never has the sea drawn for a frame before the store catches up.
const slot = createWindowSlot<BackdropState>({ id: typeof window === 'undefined' ? DEFAULT_BACKDROP : readStored() });

/** The background as it is now, for `useSyncExternalStore`. */
export const backdropState = slot.state;

/** Draws from the background: the listener fires when it changes. */
export const subscribeToBackdrop = slot.subscribe;

/** Puts the stored background on the document and applies every later write, as `initCursor` does. */
export function initBackdrop(root: HTMLElement = document.documentElement): () => void {
  const apply = () => {
    root.dataset.backdrop = slot.state().id;
  };

  apply();
  const unsubscribe = slot.subscribe(apply);
  slot.set({ id: readStored() });

  return unsubscribe;
}

/** Switches the background and remembers it. */
export function setBackdrop(id: BackdropId): void {
  if (slot.state().id === id) return;

  slot.set({ id });

  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // The background still applies for this session; it just will not be remembered.
  }
}

/**
 * The stored background, as JavaScript for `<head>`, so the first paint already has it (no tile flashing up before the sea).
 * Unlike the cursor's, it always writes the attribute: the default is a background of its own, not the stylesheet's fallback.
 */
export function backdropBootScript(): string {
  return [
    '(function(){var b=',
    JSON.stringify(DEFAULT_BACKDROP),
    ';try{',
    `var c=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});`,
    `if(${JSON.stringify(BACKDROPS.map((backdrop) => backdrop.id))}.indexOf(c)>=0)b=c;`,
    '}catch(e){}',
    'document.documentElement.setAttribute("data-backdrop",b);',
    '})();',
  ].join('');
}
