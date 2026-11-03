'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getMusicRepository } from './repository';
import type { SongNote } from './song-notes';

/**
 * A site song's cover card notes, read once per tab and shared by every card showing that song; a save puts the
 * new notes in at once, so the card the uploader is looking at changes as they press SAVE.
 */

const notes = new Map<string, SongNote | null>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** After a save: every card showing the song draws the new notes. */
export function rememberSongNote(note: SongNote): void {
  notes.set(note.trackId, note);
  changed();
}

/** The notes for a song (null for none), `undefined` while they are read. */
export function useSongNote(trackId: string | null): SongNote | null | undefined {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => 0,
  );
  const [, setRead] = useState(0);
  useEffect(() => {
    if (trackId === null || asked.has(trackId)) return;
    asked.add(trackId);
    void getMusicRepository()
      .readSongNote(trackId)
      .then((note) => {
        if (!notes.has(trackId)) notes.set(trackId, note);
        setRead((count) => count + 1);
        changed();
      });
  }, [trackId]);
  return trackId === null ? null : notes.get(trackId);
}
