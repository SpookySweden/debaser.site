'use client';

import { useEffect, useState } from 'react';
import type { HistoryRow } from '../recommender/types';
import { loadLiveNow } from './everywhere-client';
import { readPlays } from '../history/plays';
import { liveAsk, orderLives, playedChannel } from './live-lane';
import type { Taste } from './recommend';
import type { WebItem } from './types';

/**
 * The LIVE places of MEDIA's default feed (SPEC-live-streams.md): the lives `/api/web/live` finds for what live-lane.ts asks
 * (history and HISTORY's room plays, linked YouTube and makers, the taste's words), in the reader's order. Steady all day. A signed-out visitor with no
 * history gets the most-watched lives (Twitch's own order, never shown). Nothing here is saved: a live is read live.
 * Null until they have answered (empty on any failure); `on` false asks for nothing; asked once a visit.
 */
export function useLiveLane(on: boolean, taste: Taste | null, history: readonly HistoryRow[] | null, youtubeMakers: readonly string[], now: number): WebItem[] | null {
  const [lives, setLives] = useState<WebItem[] | null>(null);
  const ready = on && taste !== null && history !== null;
  useEffect(() => {
    if (!ready || lives !== null || taste === null || history === null) return;
    let live = true;
    void (async () => {
      // The channels watched in a room (HISTORY), newest first; none when HISTORY can't be read.
      const plays = await readPlays(300).catch(() => []);
      const played = [...new Set(plays.flatMap((play) => (play.kind === 'video' ? (playedChannel(play.ref) ?? []) : [])))];
      const items = await loadLiveNow(liveAsk(taste, history, youtubeMakers, played));
      if (live) setLives(orderLives(items, taste, history, now, played));
    })();
    return () => {
      live = false;
    };
    // Asked once a visit, with what was known when the feed first drew; a later answer never reshuffles it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return lives;
}
