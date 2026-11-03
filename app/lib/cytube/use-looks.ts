'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getLookRepository } from './look-repository';
import { NO_CHOICE, type LookChoice } from './looks';

/**
 * Each person's look choices, shared by every component that asks (the room, the bar, the queue window, the CYTUBE
 * page): one small store keyed by account, so a change made on the page is in the room at once. Somebody who never
 * saved reads as `NO_CHOICE` (no look, the host's look shown).
 */

const choices = new Map<string, LookChoice>();
const asking = new Set<string>();
const listeners = new Set<() => void>();

function tell() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads one account's choices. `again`: even if read before (a host's look, read fresh as their room opens). */
function ask(userId: string, again = false) {
  if (asking.has(userId) || (choices.has(userId) && !again)) return;
  asking.add(userId);
  void getLookRepository()
    .load(userId)
    .then(
      (choice) => {
        choices.set(userId, choice ?? NO_CHOICE);
        tell();
      },
      () => {
        // Unread: the site's own theme until it is asked again.
      },
    )
    .finally(() => asking.delete(userId));
}

/**
 * One account's choices (NO_CHOICE until read, or for nobody). `fresh`: read again on mount even if this tab has
 * read it before - a room reads its host's look as it opens, so a look changed since shows.
 */
export function useLookChoice(userId: string | null, { fresh = false }: { fresh?: boolean } = {}): LookChoice {
  useEffect(() => {
    if (userId !== null) ask(userId, fresh);
  }, [userId, fresh]);
  const read = useCallback(() => (userId === null ? NO_CHOICE : (choices.get(userId) ?? NO_CHOICE)), [userId]);
  return useSyncExternalStore(subscribe, read, () => NO_CHOICE);
}

/**
 * Saves part of the signed-in person's own choices, merged over what is stored (read first if this tab has not
 * read it yet, so a press before the read lands never overwrites the other half). Drawn at once, put back if the
 * store refuses.
 */
export async function saveLookChoice(userId: string, patch: Partial<LookChoice>): Promise<void> {
  const repository = getLookRepository();
  const known = choices.get(userId);
  const before = known ?? (await repository.load(userId)) ?? NO_CHOICE;
  const next: LookChoice = { ...before, ...patch };
  choices.set(userId, next);
  tell();
  try {
    await repository.save(userId, next);
  } catch (failure) {
    choices.set(userId, before);
    tell();
    throw failure;
  }
}
