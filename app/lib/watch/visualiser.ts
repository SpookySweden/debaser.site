'use client';

import { useSyncExternalStore } from 'react';

/**
 * The stream room's visualiser (Luke, 2026-11-11, from the research he pasted): Butterchurn, Milkdrop in the browser, over
 * the room's screen. This file holds what isn't drawing: whether each viewer has it on in each room (their own choice,
 * never synced, like the canvas key), the calm presets it starts with, and the flashing-lights warning, asked once.
 */

const on = new Map<string, boolean>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVisualiserOn(roomId: string): boolean {
  return useSyncExternalStore(subscribe, () => on.get(roomId) === true, () => false);
}

export function setVisualiserOn(roomId: string, value: boolean): void {
  on.set(roomId, value);
  for (const listener of listeners) listener();
}

/**
 * The calm set it starts with: slower, softer looks from Butterchurn's own pack, picked by Claude by name and to be trimmed
 * by Luke on sight. ALL adds the rest of the pack, some of which flash hard. A name the pack doesn't have is skipped.
 */
export const CALM_PRESETS: readonly string[] = [
  'Flexi - alien fish pond',
  'martin - castle in the air',
  'martin - frosty caves 2',
  'martin - glass corridor',
  'Zylot - Star Ornament',
  'Aderrasi - Songflower (Moss Posy)',
  'Geiss - Reaction Diffusion 2',
  'cope + martin - mother-of-pearl',
  'martin - stormy sea (2010 update)',
  'Flexi + Martin - astral projection',
  'martin - reflections on black tiles',
  'Geiss - Cauldron - painterly 2 (saturation remix)',
  "TonyMilkdrop - Magellan's Nebula [Flexi - you enter first + multiverse]",
  'Flexi - infused with the spiral',
];

/** How long one look stays before the next blends in, and how long the blend takes. */
export const CYCLE_SECONDS = 20;
export const BLEND_SECONDS = 2.7;

/** The presets to cycle through: the calm ones the pack has, or every one. */
export function presetNames(all: readonly string[], wild: boolean): string[] {
  if (wild) return [...all];
  const calm = CALM_PRESETS.filter((name) => all.includes(name));
  return calm.length > 0 ? calm : [...all];
}

/** The next, previous or a random preset's place in the list, never the same one twice running for random. */
export function stepPreset(at: number, length: number, how: 'next' | 'previous' | 'random', random: () => number = Math.random): number {
  if (length <= 1) return 0;
  if (how === 'next') return (at + 1) % length;
  if (how === 'previous') return (at - 1 + length) % length;
  const pick = Math.floor(random() * (length - 1));
  return pick >= at ? pick + 1 : pick;
}

const WARNED = 'debaser-visualiser-warned';

/** Whether this browser has accepted the flashing-lights warning (kept in this browser only). */
export function warningAccepted(): boolean {
  try {
    return window.localStorage.getItem(WARNED) === 'yes';
  } catch {
    return false;
  }
}

export function acceptWarning(): void {
  try {
    window.localStorage.setItem(WARNED, 'yes');
  } catch {
    // Storage refused: the warning simply asks again next time.
  }
}
