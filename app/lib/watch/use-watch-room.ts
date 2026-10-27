'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getWatchRepository, type RoomChange } from './repository';
import { STALE_CLOSE_SECONDS, calibrateWatchClock, roomAgeSeconds } from './rules';
import type { WatchRoomRead } from './types';

/**
 * One room as every screen reads it: the window, the board's record and its LIVE marker share one read
 * and one feed per room, counted, so opening the record of the stream you are watching opens nothing new.
 *
 * Changes are applied from the feed's own rows (`RoomChange`); only a `refresh` reads again. A room
 * that has ended is not followed at all: it was read once, and nothing about it changes any more.
 */

export type WatchRoomState = {
  /** Undefined until the first read lands; null for a room that does not exist. */
  read: WatchRoomRead | null | undefined;
  error: string | null;
};

type Entry = {
  state: WatchRoomState;
  listeners: Set<() => void>;
  followers: number;
  unsubscribe: (() => void) | null;
  reading: boolean;
};

const rooms = new Map<string, Entry>();
const IDLE: WatchRoomState = { read: undefined, error: null };

function entryFor(roomId: string): Entry {
  let entry = rooms.get(roomId);
  if (entry === undefined) {
    entry = { state: IDLE, listeners: new Set(), followers: 0, unsubscribe: null, reading: false };
    rooms.set(roomId, entry);
  }
  return entry;
}

function publish(entry: Entry, state: WatchRoomState): void {
  entry.state = state;
  for (const listener of entry.listeners) listener();
}

function read(roomId: string): void {
  const entry = entryFor(roomId);
  if (entry.reading) return;
  entry.reading = true;

  void getWatchRepository()
    .readRoom(roomId)
    .then((fresh) => {
      publish(entry, { read: fresh, error: null });
      // A room everybody left without ending (every tab closed at once) is closed by whoever reads it
      // once it has been quiet long enough; the database decides (`watch_close_stale`).
      if (fresh !== null && fresh.room.endedAt === null && roomAgeSeconds(fresh.room, Date.now()) > STALE_CLOSE_SECONDS) {
        void getWatchRepository()
          .closeStale(roomId)
          .then((closed) => {
            if (closed) read(roomId);
          })
          .catch(() => undefined);
      }
    })
    .catch((error: unknown) => publish(entry, { ...entry.state, error: error instanceof Error ? error.message : 'THE STREAM COULD NOT BE READ.' }))
    .finally(() => {
      entry.reading = false;
    });
}

function apply(roomId: string, change: RoomChange): void {
  const entry = entryFor(roomId);
  const current = entry.state.read;
  if (change.kind === 'refresh' || current === undefined || current === null) {
    read(roomId);
    return;
  }

  let next: WatchRoomRead = current;
  switch (change.kind) {
    case 'room':
      calibrateWatchClock(change.room.updatedAt, Date.now());
      next = { ...current, room: change.room };
      break;
    case 'entry':
      next = { ...current, queue: [...current.queue.filter((item) => item.id !== change.entry.id), change.entry] };
      break;
    case 'message':
      if (current.messages.some((message) => message.id === change.message.id)) return;
      next = { ...current, messages: [...current.messages, change.message].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
      break;
    case 'removed':
      next =
        change.table === 'queue'
          ? { ...current, queue: current.queue.filter((item) => item.id !== change.id) }
          : { ...current, messages: current.messages.filter((message) => message.id !== change.id) };
      if (next.queue.length === current.queue.length && next.messages.length === current.messages.length) return;
      break;
  }
  publish(entry, { read: next, error: null });
}

function follow(roomId: string): () => void {
  const entry = entryFor(roomId);
  entry.followers += 1;
  if (entry.unsubscribe === null) entry.unsubscribe = getWatchRepository().subscribeRoom(roomId, (change) => apply(roomId, change));

  return () => {
    entry.followers -= 1;
    if (entry.followers === 0 && entry.unsubscribe !== null) {
      entry.unsubscribe();
      entry.unsubscribe = null;
    }
  };
}

/** Puts a write this tab just made into the shared copy at once, before its echo arrives. */
export function applyLocalChange(roomId: string, change: RoomChange): void {
  apply(roomId, change);
}

export function useWatchRoom(roomId: string | null, { follow: wanted = true }: { follow?: boolean } = {}): WatchRoomState {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (roomId === null) return () => undefined;
      const entry = entryFor(roomId);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [roomId],
  );
  const snapshot = useCallback(() => (roomId === null ? IDLE : entryFor(roomId).state), [roomId]);
  // The server reads the same cache, which only a client ever fills; the checks prime it to draw a room.
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (roomId !== null && entryFor(roomId).state.read === undefined) read(roomId);
  }, [roomId]);

  // Follow a room that has not ended, once the first read has said so; an ended one stays as read. A board
  // of old streams therefore opens no feeds, and a room that ends while watched lets its feed go.
  const shouldFollow = roomId !== null && wanted && state.read !== undefined && state.read !== null && state.read.room.endedAt === null;

  useEffect(() => {
    if (!shouldFollow || roomId === null) return;
    return follow(roomId);
  }, [roomId, shouldFollow]);

  return state;
}

/** Hands the cache a room this tab has just opened, so the window draws it without a read. */
export function primeRoom(read: WatchRoomRead): void {
  publish(entryFor(read.room.id), { read, error: null });
}
