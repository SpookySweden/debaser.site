'use client';

import { floatingState, placeOf, subscribeToFloating } from '../ui/floating-player';
import { readTimeMessage, timeSourceOf } from '../web/embed-time';
import { SKIP_SECONDS, type HistoryNote } from './types';

/**
 * What happens to a video after PLAY (Luke, 2026-11-14: "a finish counts strongly, a quick skip counts against"). The
 * history already notes PLAYED when a video starts; this watches the site's one floating player from outside and notes
 * FINISHED when the platform's player says it reached the end, or SKIPPED when it is closed or replaced within
 * `SKIP_SECONDS` of starting.
 *
 * Only YouTube's and Vimeo's players say where they are (`web/embed-time.ts`), so only their videos can be finished or
 * skipped; anything else stays PLAYED. Nothing is read from the player but "it ended" and "it has started". Started by
 * the history store the first time a video is played, so a page that plays nothing listens to nothing.
 */

type Write = (note: HistoryNote) => void;

/** What was played this visit, by its history address, so the end of it can be written with its title and maker. */
const played = new Map<string, HistoryNote>();
const MAX_REMEMBERED = 50;
const FRAME_ORIGINS: Readonly<Record<'youtube' | 'vimeo', readonly string[]>> = {
  youtube: ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
  vimeo: ['https://player.vimeo.com'],
};

let started = false;
let write: Write | null = null;
let current: { id: string; play: number; since: number; done: boolean } | null = null;

/** A row's player id is `web:<the item's id>` (WebStream.tsx, TagStation.tsx). */
const refOf = (playId: string): string | null => (playId.startsWith('web:') ? playId.slice(4) : null);

function note(playId: string, action: 'finished' | 'skipped'): void {
  const ref = refOf(playId);
  const before = ref === null ? undefined : played.get(ref);
  if (before === undefined || write === null) return;
  write({ ...before, action });
}

/** What a closed or replaced video says: skipped, if it had started and was let go within `SKIP_SECONDS`. */
export function leftAs(state: { done: boolean; sinceMs: number; startedPlaying: boolean }): 'skipped' | null {
  return !state.done && state.startedPlaying && state.sinceMs < SKIP_SECONDS * 1000 ? 'skipped' : null;
}

function onFloating(): void {
  const entry = floatingState().entry;
  if (entry !== null && current !== null && entry.id === current.id && entry.play === current.play) return;
  if (current !== null) {
    // A player that never said its time never started (blocked, unavailable): that is not the person skipping it.
    const left = leftAs({ done: current.done, sinceMs: Date.now() - current.since, startedPlaying: placeOf(current.id) !== null });
    if (left !== null) note(current.id, left);
  }
  current = entry === null ? null : { id: entry.id, play: entry.play, since: Date.now(), done: false };
}

function onMessage(event: MessageEvent): void {
  const entry = floatingState().entry;
  if (entry === null || current === null || current.done || entry.player.kind !== 'frame' || entry.player.timeFrom === null) return;
  if (!FRAME_ORIGINS[entry.player.timeFrom].includes(event.origin)) return;
  // Only the floating player's own frame: a stream room's player on the same page says nothing here.
  const src = entry.player.src;
  const frame = [...document.querySelectorAll('iframe')].find((one) => one.contentWindow === event.source);
  if (frame === undefined || frame.src !== src) return;
  if (readTimeMessage(entry.player.timeFrom, event.data) !== 'ended') return;
  current.done = true;
  note(entry.id, 'finished');
}

/** Called by the history store when a video is noted PLAYED: remembers it, and starts watching the player once. */
export function watchPlayback(playedNote: HistoryNote, writer: Write): void {
  if (typeof window === 'undefined' || playedNote.kind !== 'media') return;
  const platform = playedNote.ref.split(':')[0];
  if (timeSourceOf(platform as Parameters<typeof timeSourceOf>[0]) === null) return;
  played.delete(playedNote.ref);
  played.set(playedNote.ref, playedNote);
  while (played.size > MAX_REMEMBERED) played.delete(played.keys().next().value as string);
  write = writer;
  if (started) return;
  started = true;
  subscribeToFloating(onFloating);
  window.addEventListener('message', onMessage);
  onFloating();
}
