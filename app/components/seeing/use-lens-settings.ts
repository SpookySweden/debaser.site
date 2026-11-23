'use client';

import { useSyncExternalStore } from 'react';
import { BLOCKS, PALETTES, PAPERS, SETTINGS_AT_FIRST, TEXT_SIZES, type LensSettings } from '../../lib/seeing/lenses/lens';

/** The lenses' own settings: READER's paper and size, LOW-FI's palette, CUSTOM's recipe. Kept in this browser. */
const STORAGE_KEY = 'debaser-seeing-lenses-v1';

const listeners = new Set<() => void>();
let held: LensSettings | null = null;

function stored(): LensSettings {
  if (held !== null) return held;
  held = SETTINGS_AT_FIRST;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as { reader?: { paper?: unknown; size?: unknown }; palette?: unknown; recipe?: unknown } | null;
    const recipe = value?.recipe;
    held = {
      reader: {
        paper: PAPERS.find((paper) => paper === value?.reader?.paper) ?? SETTINGS_AT_FIRST.reader.paper,
        size: TEXT_SIZES.find((size) => size === value?.reader?.size) ?? SETTINGS_AT_FIRST.reader.size,
      },
      palette: PALETTES.find((palette) => palette === value?.palette) ?? SETTINGS_AT_FIRST.palette,
      recipe: Array.isArray(recipe) ? BLOCKS.map((block) => block.id).filter((id) => recipe.includes(id)) : SETTINGS_AT_FIRST.recipe,
    };
  } catch {
    // No storage, or nothing readable in it: the starting settings.
  }
  return held;
}

function setSettings(next: LensSettings): void {
  held = next;
  for (const listener of listeners) listener();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // They last as long as the page.
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function useLensSettings(): { settings: LensSettings; setSettings: (next: LensSettings) => void } {
  const settings = useSyncExternalStore(subscribe, stored, () => SETTINGS_AT_FIRST);
  return { settings, setSettings };
}
