'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { scatter, placeCard } from './placement';
import { getLettersRepository } from './repository';
import type { Letter, LetterItem, LetterPatch, LetterThing } from './types';

/**
 * The letters a page has read, shared by every component that shows them (the profile's list, the letter window, the
 * ADD TO LETTER picker), so a change in one shows in the others at once. Read from the repository on first use.
 */

type Entry<T> = { value: T | null; error: string | null; loading: boolean };

const lists = new Map<string, Entry<Letter[]>>();
const letters = new Map<string, Entry<Letter>>();
const itemLists = new Map<string, Entry<LetterItem[]>>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

const EMPTY: Entry<never> = { value: null, error: null, loading: true };

function load<T>(cache: Map<string, Entry<T>>, key: string, read: () => Promise<T>, force = false): void {
  const held = cache.get(key);
  if (held && !force) return;
  cache.set(key, { value: held?.value ?? null, error: null, loading: true });
  changed();
  read().then(
    (value) => {
      cache.set(key, { value, error: null, loading: false });
      changed();
    },
    (error: unknown) => {
      cache.set(key, { value: held?.value ?? null, error: error instanceof Error ? error.message : 'That could not be read.', loading: false });
      changed();
    },
  );
}

/** The letters of `owner` this reader may see (all of them for the owner, the public ones for anyone else). */
export function useLettersOf(owner: string | null): Entry<Letter[]> {
  useVersion();
  useEffect(() => {
    if (owner) load(lists, owner, () => getLettersRepository().listOf(owner));
  }, [owner]);
  return owner ? (lists.get(owner) ?? EMPTY) : { value: [], error: null, loading: false };
}

/** One letter and what's on it. */
export function useLetter(id: string | null): { letter: Entry<Letter>; items: Entry<LetterItem[]> } {
  useVersion();
  useEffect(() => {
    if (!id) return;
    load(letters, id, async () => {
      const letter = await getLettersRepository().get(id);
      if (!letter) throw new Error('This letter is private, or it has been deleted.');
      return letter;
    });
    load(itemLists, id, () => getLettersRepository().items(id));
  }, [id]);
  if (!id) return { letter: EMPTY, items: EMPTY };
  return { letter: letters.get(id) ?? EMPTY, items: itemLists.get(id) ?? EMPTY };
}

function putLetter(letter: Letter): void {
  letters.set(letter.id, { value: letter, error: null, loading: false });
  const list = lists.get(letter.owner);
  if (list?.value) {
    const at = list.value.findIndex((held) => held.id === letter.id);
    const next = at === -1 ? [...list.value, letter] : list.value.map((held) => (held.id === letter.id ? letter : held));
    lists.set(letter.owner, { ...list, value: next });
  }
  changed();
}

export async function createLetter(owner: string, name: string): Promise<Letter> {
  const letter = await getLettersRepository().create(owner, name);
  itemLists.set(letter.id, { value: [], error: null, loading: false });
  putLetter(letter);
  return letter;
}

export async function updateLetter(id: string, patch: LetterPatch): Promise<Letter> {
  const letter = await getLettersRepository().update(id, patch);
  putLetter(letter);
  return letter;
}

export async function deleteLetter(letter: Letter): Promise<void> {
  await getLettersRepository().remove(letter.id);
  letters.delete(letter.id);
  itemLists.delete(letter.id);
  const list = lists.get(letter.owner);
  if (list?.value) lists.set(letter.owner, { ...list, value: list.value.filter((held) => held.id !== letter.id) });
  changed();
}

/** Adds a thing at a fresh random spot, clear of the cards already there. Says 'already' if it's on the letter. */
export async function addThing(letterId: string, thing: LetterThing): Promise<LetterItem | 'already'> {
  const repository = getLettersRepository();
  const held = itemLists.get(letterId)?.value ?? (await repository.items(letterId));
  if (held.some((item) => item.kind === thing.kind && item.ref === thing.ref)) return 'already';
  const added = await repository.addItem(letterId, thing, placeCard(held));
  if (added !== 'already') {
    itemLists.set(letterId, { value: [...held, added], error: null, loading: false });
    changed();
  }
  return added;
}

/** SHUFFLE: every card to a fresh spot. Shown at once, put back if the save fails. */
export async function shuffleLetter(letterId: string): Promise<void> {
  const held = itemLists.get(letterId)?.value;
  if (!held || held.length === 0) return;
  const places = scatter(held);
  const moved = held.map((item) => ({ ...item, ...places.find((place) => place.id === item.id) }));
  itemLists.set(letterId, { value: moved, error: null, loading: false });
  changed();
  try {
    await getLettersRepository().placeItems(places);
  } catch (error) {
    itemLists.set(letterId, { value: held, error: null, loading: false });
    changed();
    throw error;
  }
}

export async function removeThing(letterId: string, itemId: string): Promise<void> {
  await getLettersRepository().removeItem(itemId);
  const held = itemLists.get(letterId)?.value ?? [];
  itemLists.set(letterId, { value: held.filter((item) => item.id !== itemId), error: null, loading: false });
  changed();
}
