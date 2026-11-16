import { createWindowSlot } from '../ui/window-slot';
import { onBackdropAction, setActionActive } from '../backdrops/runtime';
import { drawnValues, subscribeToDrawnValues } from '../backdrops/theme';
import {
  backdropSaveFailed,
  backdropValues,
  backdropWindowState,
  closeBackdropWindow,
  flushBackdropSave,
  openBackdropWindow,
  serverBackdropSaveFailed,
  setBackdropAccount,
  setBackdropValues,
  subscribeToBackdropSaveFailed,
  subscribeToBackdropScenes,
  subscribeToBackdropWindow,
  toggleBackdropSeeThrough,
  toggleBackdropWindow,
} from '../backdrops/store';
import type { Values } from '../backdrops/knobs';
import { DEFAULT_SETTINGS, type AquariumSettings } from './settings';

/**
 * The AQUARIUM's settings as the site holds them. The store itself is every background's since SPEC-backgrounds.md
 * (`../backdrops/store.ts`: this browser's copy, the account's row, the debounce); this file is the sea's own view of it, under
 * the names the sea already used, plus GIANT MODE, which only the sea has.
 */

const typed = (values: Values): AquariumSettings => values as unknown as AquariumSettings;

/** The sea's stored settings. */
export const aquariumSettings = (): AquariumSettings => typed(backdropValues('aquarium'));
export const subscribeToAquariumSettings = subscribeToBackdropScenes;
/** What the sea is drawn with where the browser's copy can't be read (the server, a check). */
export const serverAquariumSettings = (): AquariumSettings => DEFAULT_SETTINGS;

/**
 * The sea's settings this instant: the stored ones, with any swaying or bouncing knob where it has got to, and while its
 * `[ THEME ]` is on the site theme's water, light and mood laid over them (`../backdrops/theme.ts`). The sea draws from these.
 */
export const liveAquariumSettings = (): AquariumSettings => typed(drawnValues('aquarium'));
export const subscribeToLiveAquariumSettings = subscribeToDrawnValues;

export function setAquariumSettings(next: AquariumSettings): void {
  setBackdropValues('aquarium', next as unknown as Values);
}

export const aquariumSaveFailed = backdropSaveFailed;
export const subscribeToAquariumSaveFailed = subscribeToBackdropSaveFailed;
export const serverAquariumSaveFailed = serverBackdropSaveFailed;
export const setAquariumAccount = setBackdropAccount;
export const flushAquariumSave = flushBackdropSave;

export type { BackdropWindowState as AquariumWindowState } from '../backdrops/store';
export const aquariumWindowState = backdropWindowState;
export const subscribeToAquariumWindow = subscribeToBackdropWindow;
export const openAquariumWindow = openBackdropWindow;
export const closeAquariumWindow = closeBackdropWindow;
export const toggleAquariumWindow = toggleBackdropWindow;
export const toggleAquariumSeeThrough = toggleBackdropSeeThrough;

/** How long GIANT MODE lasts. */
export const GIANT_MS = 20_000;

const giantSlot = createWindowSlot<boolean>(false);
let giantTimer: ReturnType<typeof setTimeout> | null = null;

export const aquariumGiant = giantSlot.state;
export const subscribeToAquariumGiant = giantSlot.subscribe;
export const serverAquariumGiant = (): boolean => false;

function setGiant(on: boolean): void {
  giantSlot.set(on);
  setActionActive('aquarium', 'giant', on);
}

/** GIANT MODE: on for twenty seconds, or off again at a second press. Never saved. */
export function toggleGiant(): void {
  if (giantTimer !== null) clearTimeout(giantTimer);
  giantTimer = null;
  if (giantSlot.state()) {
    setGiant(false);
    return;
  }
  setGiant(true);
  giantTimer = setTimeout(() => {
    giantTimer = null;
    setGiant(false);
  }, GIANT_MS);
}

// The window's GIANT MODE key reaches the sea through the backgrounds' shared actions.
onBackdropAction('aquarium', (action) => {
  if (action === 'giant') toggleGiant();
});
