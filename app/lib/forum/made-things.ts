'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getProfileCharacterRepository } from '../character/profile-character-repository';
import { getLettersRepository } from '../letters/repository';
import { getMediaRepository } from '../media/repository';
import type { MediaItem } from '../media/types';
import { getCanvasRepository, type StreamArtPiece } from '../watch/canvas-repository';
import { thingsOfDay, type MadeThing } from './made';

/**
 * What a MADE row lists (SPEC-forum-v3.md, M2B and M4A), read live from the things themselves with the reader's own access,
 * never stored in the post: a thing deleted later drops out, and the row grows as its maker makes more.
 *
 * - DRAWINGS: stream-art pieces the person SAVED to the art shelf (`listPieces`, `savedBy`/`savedAt`).
 * - CHARACTERS: the character on their profile, when it was put there that day (`getShown`, `bakedAt`; one per person).
 * - FILES: files they added on /files (`media_items`: uploads that are not sound).
 * - TRACKS: sound files they added (`media_items`, kind `audio`: every shelf upload is recorded there with its uploader).
 * - PUBLIC LETTERS: their letters that are public (`listOf`, filtered by `isPublic`; `updatedAt` stands in for when).
 *
 * The big lists (the art shelf, the catalogue) are read once for every row on the screen and kept a minute, so a board of
 * MADE rows asks the database for each list once, not once a row.
 */

const SHARED_MS = 60_000;

type Shared<T> = { at: number; promise: Promise<T> };
let pieces: Shared<StreamArtPiece[]> | null = null;
let catalogue: Shared<MediaItem[]> | null = null;

function sharedPieces(): Promise<StreamArtPiece[]> {
  if (pieces === null || Date.now() - pieces.at > SHARED_MS) {
    pieces = { at: Date.now(), promise: getCanvasRepository().listPieces({ includeHidden: false }).catch(() => []) };
  }
  return pieces.promise;
}

function sharedCatalogue(): Promise<MediaItem[]> {
  if (catalogue === null || Date.now() - catalogue.at > SHARED_MS) {
    catalogue = { at: Date.now(), promise: getMediaRepository().listItems().then((read) => read.items).catch(() => []) };
  }
  return catalogue.promise;
}

/** Everything one person made, of every kind, from the lists above. Each kind that cannot be read is left out. */
async function readThings(person: string): Promise<MadeThing[]> {
  const [art, items, shown, letters] = await Promise.all([
    sharedPieces(),
    sharedCatalogue(),
    getProfileCharacterRepository().getShown(person).catch(() => null),
    getLettersRepository().listOf(person).catch(() => []),
  ]);
  const things: MadeThing[] = [];
  for (const piece of art) {
    if (piece.canvas.savedBy !== person || piece.canvas.savedAt === null) continue;
    things.push({
      kind: 'drawings',
      id: piece.canvas.id,
      title: piece.canvas.title || 'A DRAWING',
      at: piece.canvas.savedAt,
      href: '/media?art=1',
      ...(piece.latest?.imageUrl ? { picture: piece.latest.imageUrl } : {}),
    });
  }
  for (const item of items) {
    if (item.uploadedBy !== person || item.source !== 'upload') continue;
    if (item.kind === 'audio') {
      things.push({ kind: 'tracks', id: item.id, title: item.title || 'A TRACK', at: item.createdAt, href: '/files?kind=audio', track: item });
    } else {
      things.push({
        kind: 'files',
        id: item.id,
        title: item.title || 'A FILE',
        at: item.createdAt,
        href: `/files?kind=${item.kind}`,
        ...(item.kind === 'image' ? { picture: item.src } : {}),
      });
    }
  }
  if (shown !== null && shown.bakedAt) {
    things.push({ kind: 'characters', id: `${person}:${shown.characterId}`, title: 'A CHARACTER', at: shown.bakedAt, href: `/profile/${encodeURIComponent(person)}` });
  }
  for (const letter of letters) {
    if (!letter.isPublic || letter.owner !== person) continue;
    things.push({ kind: 'letters', id: letter.id, title: letter.name || 'A LETTER', at: letter.updatedAt, href: `/forum?letter=${encodeURIComponent(letter.id)}` });
  }
  return things;
}

/** One person's day, as the rows show it: undefined while reading. */
type DayRead = MadeThing[] | undefined;

const days = new Map<string, DayRead>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
const keyOf = (person: string, day: string) => `${person}|${day}`;

function notify(): void {
  for (const listener of listeners) listener();
}

function ask(person: string, day: string): void {
  const key = keyOf(person, day);
  if (asked.has(key)) return;
  asked.add(key);
  void readThings(person).then((things) => {
    days.set(key, thingsOfDay(things, day));
    notify();
  });
}

/** After the maker made something: their rows read again, so the row grows at once on their own screen. */
export function forgetMadeThings(): void {
  pieces = null;
  catalogue = null;
  asked.clear();
  for (const key of [...days.keys()]) {
    const [person, day] = key.split('|');
    ask(person, day);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The things of one person's day, for a MADE row: undefined while they are read. */
export function useMadeThings(person: string, day: string): DayRead {
  const key = keyOf(person, day);
  const read = useSyncExternalStore(
    subscribe,
    () => days.get(key),
    () => undefined,
  );
  useEffect(() => {
    ask(person, day);
  }, [person, day]);
  return read;
}
