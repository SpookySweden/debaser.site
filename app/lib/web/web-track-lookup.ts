'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { AudioTrack } from '../audio/tracks';
import {
  parseWebAudioSrc,
  parseWebTrackId,
  readWebAudioAnswer,
  webAudioListPath,
  webTracks,
  type BarAudioPlatform,
} from './web-audio';

/**
 * Web tracks put back together from what other features store (step B of WEB audio in the bar).
 *
 * A broadcast, a BARR and RADI-OH keep a track's `src`; a like and a playlist keep its id. For the archive
 * those are looked up on the shelf. A web track is on nobody's shelf, so it is looked up here instead: both
 * keys name their item (`web-audio.ts`), and the item's files come from our own list route, the same answer
 * PLAY on /web uses. Each item is asked about once per visit and the answer kept in memory; a failed ask is
 * tried again after a minute, so one platform hiccup is not a song gone for good.
 *
 * Only our own route is fetched from the browser: the platforms are read by the server (`audio-files.ts`).
 */

type ItemKey = string;
const RETRY_AFTER_MS = 60_000;

const answers = new Map<ItemKey, AudioTrack[]>();
const asking = new Map<ItemKey, Promise<AudioTrack[] | null>>();
const failedAt = new Map<ItemKey, number>();
const listeners = new Set<() => void>();
let version = 0;

const keyOf = (platform: BarAudioPlatform, externalId: string): ItemKey => `${platform}:${externalId}`;

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** An item's tracks, asking our route when they are not known yet. Null when it has no playable file. */
export function loadWebItem(platform: BarAudioPlatform, externalId: string): Promise<AudioTrack[] | null> {
  const key = keyOf(platform, externalId);
  const known = answers.get(key);
  if (known) return Promise.resolve(known);
  const pending = asking.get(key);
  if (pending) return pending;

  const ask = (async () => {
    try {
      const response = await fetch(webAudioListPath(platform, externalId));
      const answer = response.ok ? readWebAudioAnswer(await response.json()) : null;
      if (answer) {
        const tracks = webTracks(platform, externalId, answer);
        answers.set(key, tracks);
        failedAt.delete(key);
        return tracks;
      }
    } catch {
      // Network trouble reads the same as no answer: tried again after RETRY_AFTER_MS.
    }
    failedAt.set(key, Date.now());
    return null;
  })().finally(() => {
    asking.delete(key);
    changed();
  });

  asking.set(key, ask);
  return ask;
}

function lookUp(parsed: { platform: BarAudioPlatform; externalId: string; index: number } | null): AudioTrack | null | undefined {
  if (!parsed) return null;
  const key = keyOf(parsed.platform, parsed.externalId);
  const known = answers.get(key);
  if (known) return known[parsed.index] ?? null;
  const failed = failedAt.get(key);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return null;
  void loadWebItem(parsed.platform, parsed.externalId);
  return undefined;
}

/**
 * The web track behind a `src` or an id, right now: the track, `undefined` while it is being asked for
 * (the ask starts here), or `null` when it is not a web track or has no playable file.
 */
export function webTrackNow(srcOrId: string): AudioTrack | null | undefined {
  return lookUp(parseWebAudioSrc(srcOrId) ?? parseWebTrackId(srcOrId));
}

/** How many of these ids are web tracks still being asked for (not yet known, not yet failed). */
export function webLookupsPending(ids: readonly string[]): number {
  return ids.filter((id) => parseWebTrackId(id) !== null && webTrackNow(id) === undefined).length;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => version;

/** `webTrackNow` for a component: draws again once the answer arrives. */
export function useWebTrack(srcOrId: string | null | undefined): AudioTrack | undefined {
  const seen = useSyncExternalStore(subscribe, snapshot, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `seen` is the store's version: a new answer.
  return useMemo(() => (srcOrId ? (webTrackNow(srcOrId) ?? undefined) : undefined), [srcOrId, seen]);
}

/** Every web track among these ids that can be put back together, in the order given (likes, lists). */
export function useWebTracks(ids: readonly string[]): AudioTrack[] {
  const seen = useSyncExternalStore(subscribe, snapshot, () => 0);
  const key = ids.join('\n');
  return useMemo(
    () => ids.flatMap((id) => (parseWebTrackId(id) ? (webTrackNow(id) ?? []) : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `ids`; `seen` is a new answer.
    [key, seen],
  );
}
