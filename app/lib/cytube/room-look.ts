'use client';

import { useSyncExternalStore } from 'react';
import type { LookId } from './looks';

/**
 * The look of the room this tab has open, for the parts of the room drawn outside it: the stream bar's strip
 * (MusicPlayer's `StreamStrip`). The room says it (`setOpenRoomLook`) and forgets it as it closes; null is
 * the site's own theme.
 */
let current: LookId | null = null;
const listeners = new Set<() => void>();

export function setOpenRoomLook(look: LookId | null): void {
  if (current === look) return;
  current = look;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOpenRoomLook(): LookId | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
