'use client';

import { useSyncExternalStore } from 'react';
import { noteSettingChanged, subscribeToAccountSettings } from '../settings/settings-bus';

/*
 * `[ EXPLAIN ]`, the switch for the explanation box (Luke, 2026-11-27, "A: a switch, off"): in PREFERENCES, off by default for
 * everyone, and it follows the account like the site's other settings (`explain` in `../settings/settings-bus.ts`), so turning it on
 * once turns it on for both of his computers. Signed out, the browser keeps its own. One key in this browser's storage, `1` on and
 * `0` off; missing or anything else is off.
 */
export const EXPLAIN_KEY = 'debaser.site.explain.v1';

export function explainOnFrom(stored: string | null): boolean {
  return stored === '1';
}

const listeners = new Set<() => void>();
/** The choice for this visit only, when this browser's storage can't be written (a private window that refuses it). */
let held: string | null = null;

/** Read from storage every time, so a choice made in another tab, or the account's choice written in after sign-in, is what shows. */
function storedChoice(): string | null {
  try {
    return window.localStorage.getItem(EXPLAIN_KEY) ?? held;
  } catch {
    return held;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const stop = subscribeToAccountSettings(listener);
  const fromTab = (event: StorageEvent) => {
    if (event.key === EXPLAIN_KEY) listener();
  };
  window.addEventListener('storage', fromTab);
  return () => {
    listeners.delete(listener);
    stop();
    window.removeEventListener('storage', fromTab);
  };
}

/** Whether the explanation box is on in this browser. Off on the server, which has no storage. */
export function useExplainMode(): boolean {
  return explainOnFrom(useSyncExternalStore(subscribe, storedChoice, () => null));
}

export function setExplainMode(on: boolean): void {
  const text = on ? '1' : '0';
  try {
    window.localStorage.setItem(EXPLAIN_KEY, text);
    held = null;
  } catch {
    held = text;
  }
  noteSettingChanged('explain');
  for (const listener of listeners) listener();
}
