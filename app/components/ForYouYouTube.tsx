'use client';

import { useEffect, useMemo, useState } from 'react';
import { keyOf, pickLane, type Candidate } from '../lib/recommender/engine';
import type { HistoryKind, HistoryRow } from '../lib/recommender/types';
import { findTag, type StationIndex } from '../lib/tag-station/query';
import type { Taste } from '../lib/web/recommend';
import { rowAddresses, type ExtraHosts } from '../lib/web/row-addresses';
import type { WebItem } from '../lib/web/types';
import { readMineOnce, YOUTUBE_LINK_ON, type YouTubeMine } from '../lib/web/youtube-link';
import { Lane, PickFoot } from './ForYouParts';
import { STATION_KEY, Thumb } from './TagStationParts';

/**
 * YOUR YOUTUBE on DISCOVER (SPEC-recommender.md step 3, Luke 2026-11-13: "incorporate the feed of whats shown into the
 * tagging station"): a FROM YOUR YOUTUBE lane of the reader's channels' new videos and likes, and their channels' topics
 * as starting words on the map. Read from the person's own browser (youtube-link.ts); never sent to the tagger, never
 * stored by the site beyond what YOUR YOUTUBE already keeps. Off, and drawing nothing, until Luke's Google steps are done
 * (`NEXT_PUBLIC_GOOGLE_VIDEOS_LINK`, docs/youtube-link-setup.md).
 */

type Context = { taste: Taste; rows: readonly HistoryRow[]; explore: ReadonlyMap<string, string>; now: number; size: number };
type Hide = (kind: HistoryKind, ref: string, title: string, maker: string, words: readonly string[]) => void;

/** The reader's YouTube, once per page; null until read, and always null while the switch is off. */
export function useYouTubeMine(): YouTubeMine | null {
  const [mine, setMine] = useState<YouTubeMine | null>(null);
  useEffect(() => {
    if (!YOUTUBE_LINK_ON) return;
    let live = true;
    void readMineOnce().then((answer) => live && setMine(answer));
    return () => {
      live = false;
    };
  }, []);
  return mine;
}

/** FROM YOUR YOUTUBE: the reader's channels' newest videos and likes, ordered by the same engine. */
export function YouTubeLane({ context, hidden, onHide, extraHosts }: { context: Context; hidden: ReadonlySet<string>; onHide: Hide; extraHosts: ExtraHosts }) {
  const mine = useYouTubeMine();
  const picks = useMemo(() => {
    const candidates: Candidate<WebItem>[] = (mine?.items ?? []).map((item) => ({
      key: keyOf('media', item.id),
      words: item.tags ?? [],
      maker: item.creator,
      item,
      shared: { why: 'FROM YOUR YOUTUBE', weight: 1 },
    }));
    return pickLane(candidates, context).filter((pick) => !hidden.has(pick.key));
  }, [mine, context, hidden]);
  if (!YOUTUBE_LINK_ON) return null;
  return (
    <Lane
      id="for-you-youtube"
      title="FROM YOUR YOUTUBE"
      loading={mine === null}
      picks={picks}
      render={(pick) => {
        const item = pick.item;
        const { thumb, link } = rowAddresses(item, extraHosts);
        return (
          <li key={pick.key} className="rule-pixel flex items-start gap-2 py-2">
            <Thumb src={thumb} />
            <div className="min-w-0 flex-1">
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open "${item.title}" on YouTube (new tab)`} className={`${STATION_KEY} block w-full break-words text-left`}>
                  {`${item.title} ↗`}
                </a>
              ) : (
                <p className="break-words px-1 text-label text-ink">{item.title}</p>
              )}
              {item.creator ? <p className="break-words px-1 text-label text-ink">{item.creator}</p> : null}
              <PickFoot why={pick.why} title={item.title} onHide={() => onHide('media', item.id, item.title, item.creator ?? '', item.tags ?? [])} />
            </div>
          </li>
        );
      }}
    />
  );
}

/** FROM YOUR YOUTUBE: FILM, JAZZ: the reader's channels' topics that are on the map, each going to that word. */
export function YouTubeTopicChips({ index, onWord }: { index: StationIndex; onWord: (word: string) => void }) {
  const mine = useYouTubeMine();
  const words = useMemo(
    () =>
      (mine?.topics ?? [])
        .map((topic) => findTag(index, topic.toLowerCase())?.name ?? null)
        .filter((name): name is string => name !== null)
        .filter((name, at, all) => all.indexOf(name) === at)
        .slice(0, 8),
    [mine, index],
  );
  if (!YOUTUBE_LINK_ON || words.length === 0) return null;
  return (
    <div role="group" aria-label="Starting words from your YouTube" className="flex flex-wrap items-center gap-1" data-youtube-topics>
      <span className="text-label text-ink-quiet">FROM YOUR YOUTUBE:</span>
      {words.map((word) => (
        <button key={word} type="button" onClick={() => onWord(word)} aria-label={`Go to ${word}`} className={STATION_KEY}>
          {`[ ${word.toUpperCase()} ]`}
        </button>
      ))}
    </div>
  );
}
