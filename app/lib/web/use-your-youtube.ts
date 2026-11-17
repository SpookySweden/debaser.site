'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { getAuthRepository } from '../auth/auth-repository';
import { subscribeHistory } from '../recommender/history';
import { subscribeSummary } from '../recommender/watch-summary';
import { youTubeTaste } from '../recommender/youtube-picks';
import { channelNames, type Taste } from './recommend';
import type { FeedSignals } from './feed-profile';
import type { WebItem } from './types';
import { forgetYouTube, readMineOnce, rememberLinker, reweighMine, YOUTUBE_LINK_ON, type YouTubeFound } from './youtube-link';

/**
 * YOUR YOUTUBE for the MEDIA page, in one place (Luke, 2026-11-14): the shelf in order, what it teaches the page's own
 * lists, and the LINK / REFRESH / UNLINK keys' work. The page reads it once; after that a press of the feedback key or
 * an imported history only re-weighs what was read (nothing more is asked of Google or YouTube), so the shelf reshapes
 * at once.
 *
 * What it teaches the page's lists is taken once a visit (the first read), so the rows of a list being looked at never
 * move when the shelf reshapes. Google is asked once a page load, however often MEDIA is come back to (`readMineOnce`).
 *
 * Off, and empty, until `NEXT_PUBLIC_GOOGLE_VIDEOS_LINK` is on (youtube-link.ts).
 */
export type YourYouTube = {
  /** The shelf, in order: videos from channels the person still watches, about 3 in 10 new, one surprise in ten. */
  items: readonly WebItem[];
  /** Adds what their YouTube says to a taste: channels by where they stand, topics, playlist names, an import's words. */
  teach: (taste: Taste) => Taste;
  /** The same read as the profile of MEDIA's default feed takes it (feed-profile.ts): null until the first read. */
  signals: FeedSignals['youtube'];
  /** The names of the channels that stand, for moving their rows up a search's page. Read from a ref, so asking never restarts. */
  standing: RefObject<ReadonlySet<string>>;
  /** Nothing to show, or Google's permission has run out: LINK YOUTUBE is offered. */
  needsLink: boolean;
  problem: string | null;
  link: () => Promise<void>;
  unlink: () => void;
};

const NO_NAMES: ReadonlySet<string> = new Set();

export function useYourYouTube(): YourYouTube {
  const [found, setFound] = useState<YouTubeFound | null>(null);
  /** The read the page's lists are taught by: the first one of the visit, held still. */
  const [taught, setTaught] = useState<YouTubeFound | null>(null);
  const [needsLink, setNeedsLink] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const standing = useRef<ReadonlySet<string>>(NO_NAMES);

  const take = useCallback((next: YouTubeFound | null) => {
    setFound(next);
    setTaught((before) => (next === null ? null : (before ?? next)));
    standing.current = next === null ? NO_NAMES : channelNames(next.channels);
  }, []);

  useEffect(() => {
    if (!YOUTUBE_LINK_ON) return;
    let live = true;
    // The history or the import changed: the same read, weighed again.
    const again = () => {
      void reweighMine().then((next) => live && next !== null && take(next));
    };
    void readMineOnce().then((answer) => {
      if (!live) return;
      take(answer);
      setNeedsLink(answer.needsLink);
      if (answer.wrongAccount) setProblem('THAT GOOGLE ACCOUNT BELONGS TO ANOTHER ACCOUNT HERE, AND YOU ARE NOW SIGNED IN AS IT.');
      // Come back to in the same page load, the read is the one from before: it is weighed with the history as it is now.
      again();
    });
    const stops = [subscribeHistory(again), subscribeSummary(again)];
    return () => {
      live = false;
      stops.forEach((stop) => stop());
    };
  }, [take]);

  const link = useCallback(async () => {
    setProblem(null);
    await rememberLinker();
    const result = await getAuthRepository().linkYouTube?.();
    if (result !== undefined && !result.ok) setProblem(result.error);
  }, []);

  const unlink = useCallback(() => {
    forgetYouTube();
    take(null);
    setNeedsLink(true);
  }, [take]);

  const teach = useCallback(
    (taste: Taste) => (taught === null ? taste : youTubeTaste(taste, { standings: taught.standings, topics: taught.topics, playlists: taught.playlists, summary: taught.summary })),
    [taught],
  );
  const items = useMemo(() => found?.items ?? [], [found]);
  const signals = useMemo(
    (): FeedSignals['youtube'] =>
      taught === null
        ? null
        : { channels: taught.standings.map(({ name, outside }) => ({ name, outside })), topics: taught.topics, playlists: taught.playlists, imported: taught.summary?.words ?? [] },
    [taught],
  );
  return { items, teach, signals, standing, needsLink, problem, link, unlink };
}
