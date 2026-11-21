'use client';

import { useSyncExternalStore } from 'react';
import { noteSettingChanged, subscribeToAccountSettings } from '../settings/settings-bus';

/*
 * `[ KEYS IN THE PICTURE ]` (ROOMBARS, Luke 2026-11-21: "in the settings cog at the bottom of the player bar, add a toggle for
 * the full screen, pause play, skip etc to be a bar at the bottom of the viewport as well as the player bar. Off by default but
 * on for moldavius figtree by default as she requested it"). On, a room's picture carries a bar of its playback keys along its
 * foot as well as the player bar under it (`pictureBar` in WatchRoom.tsx).
 *
 * One key in this browser's storage, `1` on and `0` off, that follows the account like the site's other settings
 * (`keysInPicture` in `../settings/settings-bus.ts`); signed out, the browser keeps its own. Missing, the default is off, except
 * for the accounts named below, which start on. That is a default in code, never a write to anybody's settings row: the first
 * press of the toggle stores a choice, and a stored choice always wins.
 */
export const KEYS_IN_PICTURE_KEY = 'debaser.room.keys-in-picture.v1';

/** Accounts whose default is on (Luke, 2026-11-21): moldavius figtree, who asked for the keys in the picture. */
export const KEYS_IN_PICTURE_BY_DEFAULT: ReadonlySet<string> = new Set(['a887588b-1dd2-4be3-9c9f-9897ec492c31']);

/** The stored text read as the switch for this person: `1` on, `0` off; missing or junk is the person's default. */
export function keysInPictureFrom(stored: string | null, person: string | null): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return person !== null && KEYS_IN_PICTURE_BY_DEFAULT.has(person);
}

const listeners = new Set<() => void>();
/** The choice for this visit only, when this browser's storage can't be written (a private window that refuses it). */
let held: string | null = null;

/**
 * The stored text, read from storage every time (never cached), so a choice made in another tab, or the account's choice
 * written in after sign-in, is what shows.
 */
function storedChoice(): string | null {
  try {
    return window.localStorage.getItem(KEYS_IN_PICTURE_KEY) ?? held;
  } catch {
    return held;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // The account's choice written into this browser after sign-in, and a choice made in another tab: read the key again.
  const stop = subscribeToAccountSettings(listener);
  const fromTab = (event: StorageEvent) => {
    if (event.key === KEYS_IN_PICTURE_KEY) listener();
  };
  window.addEventListener('storage', fromTab);
  return () => {
    listeners.delete(listener);
    stop();
    window.removeEventListener('storage', fromTab);
  };
}

/** Whether this person's room picture carries the keys. `person`: the signed-in account's id, null for a visitor. */
export function useKeysInPicture(person: string | null): boolean {
  // The server has no storage: nothing stored, so the person's default.
  const stored = useSyncExternalStore(subscribe, storedChoice, () => null);
  return keysInPictureFrom(stored, person);
}

export function setKeysInPicture(on: boolean): void {
  const text = on ? '1' : '0';
  try {
    window.localStorage.setItem(KEYS_IN_PICTURE_KEY, text);
    held = null;
  } catch {
    held = text;
  }
  noteSettingChanged('keysInPicture');
  for (const listener of listeners) listener();
}
