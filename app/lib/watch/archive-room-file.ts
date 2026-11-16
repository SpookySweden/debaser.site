'use client';

import { useEffect, useState } from 'react';
import { officialEmbedUrl } from '../web/official-embed';
import { isSafeIdentifier } from '../web/urls';
import { fetchSeries } from './series-client';
import type { WatchLink } from './types';

/**
 * An Internet Archive video in a room plays in the room's own player, not the Archive's (Luke, 2026-11-16: "im noticing on
 * internet archive the player ui is not using our own, fix that and also make sure that when fullscreening we keep our
 * backround, same method as used on youtube").
 *
 * A MEDIA row files an Archive video as the Archive's embed (`https://archive.org/embed/<item>`). In a room that address
 * is read through our own series route (`/api/web/series?ia=`, the same checked listing a series' episodes come from,
 * SPEC-stream-series.md), and the item's first playable video file (`https://archive.org/download/<item>/<file>`) is
 * what the room's `<video>` plays: the room's keys, its sync, SUBS, and in fullscreen the chosen background round it with
 * the bars trimmed, as for any file the room plays. Everybody in the room reads the same listing, so everybody plays the
 * same file. What is stored is unchanged; an item with no file a browser plays (or a listing that could not be read)
 * keeps the Archive's own player. Memory only, once per item a page load.
 */

/** The item an Archive embed address names, or null for anything else. */
export function archiveEmbedItem(link: WatchLink | null): string | null {
  if (link === null || link.kind !== 'embed' || officialEmbedUrl(link.url) === null) return null;
  const url = new URL(link.url);
  if (url.hostname !== 'archive.org') return null;
  const parts = url.pathname.split('/');
  return parts.length === 3 && parts[1] === 'embed' && isSafeIdentifier(parts[2]) ? parts[2] : null;
}

/** By item: its first video file as a room link, or null when the Archive's own player stays. */
const files = new Map<string, WatchLink | null>();
const asking = new Map<string, Promise<void>>();

function ask(item: string): Promise<void> {
  const pending = asking.get(item);
  if (pending !== undefined) return pending;
  const read = fetchSeries({ source: 'internet_archive', id: item })
    .then(
      (series) => {
        const first = series.episodes.find((episode) => episode.kind === 'file');
        files.set(item, first === undefined ? null : { url: first.url, kind: 'file', title: first.title });
      },
      () => {
        files.set(item, null);
      },
    )
    .finally(() => asking.delete(item));
  asking.set(item, read);
  return read;
}

/**
 * The link the room's stage plays for a stored link: an Archive embed's video file once read, otherwise the stored link.
 * `waiting` while an Archive embed is being read, so the stage shows neither player for that moment.
 */
export function useArchiveRoomFile(stored: WatchLink | null): { link: WatchLink | null; waiting: boolean } {
  const item = archiveEmbedItem(stored);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (item === null || files.has(item)) return;
    let live = true;
    void ask(item).then(() => {
      if (live) setTick((tick) => tick + 1);
    });
    return () => {
      live = false;
    };
  }, [item]);
  if (item === null) return { link: stored, waiting: false };
  if (!files.has(item)) return { link: stored, waiting: true };
  const file = files.get(item) ?? null;
  // The episode's own title is a file name: the row's title stays what the room shows.
  return { link: file === null ? stored : { ...file, title: stored?.title ?? file.title }, waiting: false };
}
