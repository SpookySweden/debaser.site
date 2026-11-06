'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getWatchRepository } from './repository';
import type { GuestNameAnswer, RoomGuest } from './types';
import { refollowRooms } from './use-watch-room';

/** The guest in this browser, if there is one (SPEC-guests.md). Kept once per tab, as every room screen asks. */

let current: RoomGuest | null = null;
let asked = false;
const listeners = new Set<() => void>();

function publish(next: RoomGuest | null): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRoomGuest(): RoomGuest | null {
  useEffect(() => {
    if (asked) return;
    asked = true;
    void getWatchRepository()
      .readGuest()
      .then((found) => {
        if (found !== null) publish(found);
      })
      .catch(() => undefined);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** Makes the guest when something first needs one, and moves the rooms this tab follows onto its connection. Throws with a sentence fit to show. */
export async function ensureRoomGuest(): Promise<RoomGuest> {
  if (current !== null) return current;
  const found = await getWatchRepository().readGuest().catch(() => null);
  const guest = found ?? (await getWatchRepository().becomeGuest());
  asked = true;
  publish(guest);
  refollowRooms();
  return guest;
}

/** Picks the guest's name, making the guest first if need be. On `named`, `guest` is who is speaking now. */
export async function nameRoomGuest(name: string): Promise<{ answer: GuestNameAnswer; guest: RoomGuest | null }> {
  await ensureRoomGuest();
  const answer = await getWatchRepository().nameGuest(name);
  if (answer !== 'named') return { answer, guest: null };
  const guest = await getWatchRepository().readGuest();
  publish(guest);
  return { answer, guest };
}
