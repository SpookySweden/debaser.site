'use client';

import { useEffect, useState } from 'react';
import { officialEmbedUrl } from '../web/official-embed';
import { isSafeIdentifier } from '../web/urls';
import { webReaderHeaders } from '../web/web-session';
import { readSeriesAnswer, seriesQuery, type SeriesTarget } from './series';
import type { WatchLink } from './types';

/**
 * An Internet Archive video in a room plays in the room's own player, not the Archive's (Luke, 2026-11-16: "im noticing on
 * internet archive the player ui is not using our own, fix that and also make sure that when fullscreening we keep our
 * backround, same method as used on youtube").
 *
 * A MEDIA row files an Archive video as the Archive's embed (`https://archive.org/embed/<item>`). In a room that address
 * is read through our own series route (`/api/web/series?ia=`, the same listing a series' episodes come from, checked by
 * `readSeriesAnswer`, SPEC-stream-series.md), and the item's first playable video file
 * (`https://archive.org/download/<item>/<file>`) is what the room's `<video>` plays: the room's keys, its sync, SUBS, and in
 * fullscreen the chosen background round it with the bars trimmed, as for any file the room plays. Everybody in the room
 * reads the same listing (the server keeps it a day, in one order), so everybody plays the same file. An item with more
 * than one video plays its first, as the Archive's player starts on. What is stored is unchanged.
 *
 * An item with no file a browser plays keeps the Archive's own player. A read that failed (too many asks, the Archive slow
 * or down, no network) shows the Archive's player meanwhile and is asked again after a while, so a viewer is not left on a
 * different player from the host. Memory only, per page load.
 */

/** How long a read may take before the Archive's player shows meanwhile. */
const READ_MS = 8000;
/** After a read that failed, how long before it is asked again. */
const AGAIN_MS = 15000;

/** The item an Archive embed address names, or null for anything else. */
export function archiveEmbedItem(link: WatchLink | null): string | null {
  if (link === null || link.kind !== 'embed' || officialEmbedUrl(link.url) === null) return null;
  const url = new URL(link.url);
  if (url.hostname !== 'archive.org') return null;
  const parts = url.pathname.split('/');
  return parts.length === 3 && parts[1] === 'embed' && isSafeIdentifier(parts[2]) ? parts[2] : null;
}

/** By item: its first video file as a room link, or null while the Archive's own player is what plays. */
const files = new Map<string, WatchLink | null>();
/** Items whose answer is final: a file, or "nothing here plays". */
const settled = new Set<string>();
const asking = new Set<string>();
const listeners = new Set<() => void>();
const tell = () => {
  for (const listener of listeners) listener();
};

async function ask(item: string): Promise<void> {
  if (asking.has(item) || settled.has(item)) return;
  asking.add(item);
  const target: SeriesTarget = { source: 'internet_archive', id: item };
  try {
    const response = await fetch(`/api/web/series?${seriesQuery(target)}`, { headers: await webReaderHeaders(), signal: AbortSignal.timeout(READ_MS) });
    if (response.status === 404) {
      files.set(item, null);
      settled.add(item);
    } else if (response.ok) {
      const read = readSeriesAnswer(target, await response.json().catch(() => null));
      const first = read?.episodes.find((episode) => episode.kind === 'file');
      files.set(item, first === undefined ? null : { url: first.url, kind: 'file', title: first.title });
      settled.add(item);
    } else throw new Error('not now');
  } catch {
    // Not an answer: the Archive's player meanwhile, and asked again in a while.
    files.set(item, null);
    // Only while a room still shows it; otherwise the next room to show it asks.
    setTimeout(() => {
      if (listeners.size > 0) void ask(item);
    }, AGAIN_MS);
  } finally {
    asking.delete(item);
    tell();
  }
}

/**
 * The link the room's stage plays for a stored link: an Archive embed's video file once read, otherwise the stored link.
 * `waiting` while an Archive embed is first being read, so the stage shows neither player for that moment.
 */
export function useArchiveRoomFile(stored: WatchLink | null): { link: WatchLink | null; waiting: boolean } {
  const item = archiveEmbedItem(stored);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (item === null) return;
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    void ask(item);
    return () => {
      listeners.delete(listener);
    };
  }, [item]);
  if (item === null) return { link: stored, waiting: false };
  if (!files.has(item)) return { link: stored, waiting: true };
  const file = files.get(item) ?? null;
  // The episode's own title is a file name: the row's title stays what the room shows.
  return { link: file === null ? stored : { ...file, title: stored?.title ?? file.title }, waiting: false };
}
