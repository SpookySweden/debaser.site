'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { CONCEPT_SHEETS } from '../concepts/sheets';
import { getMediaRepository } from './repository';
import type { CatalogueEntry, MediaItem, MediaKind, MediaUse } from './types';

/**
 * The catalogue as a screen reads it: every item with its uses, read once for the whole site.
 *
 * One module-level store rather than a read per component, because the composer draws the picture
 * picker in every open reply box on the board - a read per box would be a dozen identical requests
 * for one list. The first subscriber triggers the read; everyone else is handed the same snapshot,
 * and a write anywhere (an upload, a use recorded) refreshes it for all of them.
 *
 * Concept sheets are items too (decision 7, SPEC-media-catalogue.md). Until the migration has given
 * them rows of their own they are read off the manifest here, with an id the migration will replace
 * (`sheet:<id>`), no fingerprint and no uses - so the page lists them from the first day and a
 * picker can offer them, and nothing is written for them twice.
 */

type Snapshot = {
  filed: MediaItem[];
  uses: MediaUse[];
  answered: boolean;
  loading: boolean;
};

const EMPTY: Snapshot = { filed: [], uses: [], answered: true, loading: true };

let snapshot: Snapshot = EMPTY;
let reading: Promise<void> | null = null;
let subscribed = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function read(): Promise<void> {
  if (reading !== null) return reading;

  const repository = getMediaRepository();
  reading = Promise.all([repository.listItems(), repository.listUses()])
    .then(([items, uses]) => {
      snapshot = { filed: items.items, uses, answered: items.answered, loading: false };
    })
    .catch(() => {
      snapshot = { ...snapshot, answered: false, loading: false };
    })
    .finally(() => {
      reading = null;
      emit();
    });

  return reading;
}

/**
 * Reads the catalogue again, after something outside this module changed it.
 *
 * A read already in flight may have started before the change, so it is waited for and *then* a
 * fresh one is started: an upload that handed back an id must be able to find it on return.
 */
export function refreshCatalogue(): Promise<void> {
  return (reading ?? Promise.resolve()).then(() => read());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (!subscribed) {
    subscribed = true;
    getMediaRepository().subscribe(() => void read());
  }

  return () => {
    listeners.delete(listener);
  };
}

function current(): Snapshot {
  return snapshot;
}

function server(): Snapshot {
  return EMPTY;
}

/** The manifest's sheets as items; a sheet the migration has already filed is left to its row. */
export function sheetItems(filed: MediaItem[]): MediaItem[] {
  const filedSrcs = new Set(filed.map((item) => item.src));

  return CONCEPT_SHEETS.filter((sheet) => !filedSrcs.has(sheet.src)).map((sheet) => ({
    id: `sheet:${sheet.id}`,
    kind: 'image' as const,
    bucket: '',
    path: sheet.src,
    src: sheet.src,
    sha256: '',
    bytes: 0,
    mime: 'image/png',
    width: sheet.width,
    height: sheet.height,
    length: '',
    title: sheet.title,
    credit: 'debaser.site',
    tags: ['CONCEPT SHEET'],
    folderPath: null,
    source: 'sheet' as const,
    uploadedBy: null,
    uploadedByLabel: 'debaser.site',
    createdAt: '2026-09-21T00:00:00.000Z',
  }));
}

export type CatalogueRead = {
  entries: CatalogueEntry[];
  items: MediaItem[];
  /** False when the store could not be read: the screen draws a fault, not an empty shelf. */
  answered: boolean;
  /** True until the first read settles. */
  loading: boolean;
  /** Bytes the uploads take, for the storage line. Sheets ship with the site and count nothing. */
  bytesUsed: number;
  reload: () => void;
};

export function useCatalogue(): CatalogueRead {
  const state = useSyncExternalStore(subscribe, current, server);

  useEffect(() => {
    if (state.loading) void read();
  }, [state.loading]);

  const reload = useCallback(() => void read(), []);

  return useMemo(() => {
    const items = [...state.filed, ...sheetItems(state.filed)];
    const usesById = new Map<string, MediaUse[]>();
    for (const use of state.uses) {
      const list = usesById.get(use.mediaId) ?? [];
      list.push(use);
      usesById.set(use.mediaId, list);
    }

    return {
      entries: items.map((item) => ({ item, uses: usesById.get(item.id) ?? [] })),
      items,
      answered: state.answered,
      loading: state.loading,
      bytesUsed: state.filed.reduce((sum, item) => sum + item.bytes, 0),
      reload,
    };
  }, [state, reload]);
}

/** The kinds, in the order the page's tabs draw them. */
export const MEDIA_KINDS: MediaKind[] = ['image', 'audio', 'video'];

export const KIND_LABELS: Record<MediaKind, string> = {
  image: 'IMAGES',
  audio: 'AUDIO',
  video: 'VIDEO',
};
