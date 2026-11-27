'use client';

import { useEffect, useMemo, useState } from 'react';
import { keyOf, type LanePick } from '../lib/recommender/engine';
import { findTag, type StationIndex } from '../lib/tag-station/query';
import { rowAddresses, type ExtraHosts } from '../lib/web/row-addresses';
import type { WebItem } from '../lib/web/types';
import { notForMe, subscribeHistory } from '../lib/recommender/history';
import { readMineOnce, reweighMine, YOUTUBE_LINK_ON, type YouTubeMine } from '../lib/web/youtube-link';
import { Lane, MOST, PickFoot } from './ForYouParts';
import { STATION_KEY, Thumb } from './TagStationParts';
import { explain, NOTE } from '../lib/ui/explain';

/**
 * YOUR YOUTUBE on DISCOVER (SPEC-recommender.md step 3, Luke 2026-11-13: "incorporate the feed of whats shown into the
 * tagging station"): a FROM YOUR YOUTUBE lane of the reader's channels' new videos and likes, and their channels' topics
 * as starting words on the map. Read from the person's own browser (youtube-link.ts); never sent to the tagger, never
 * stored by the site beyond what YOUR YOUTUBE already keeps. Off, and drawing nothing, until Luke's Google steps are done
 * (`NEXT_PUBLIC_GOOGLE_VIDEOS_LINK`, docs/youtube-link-setup.md).
 */

/** The reader's YouTube, once per page; null until read, and always null while the switch is off. */
export function useYouTubeMine(): YouTubeMine | null {
  const [mine, setMine] = useState<YouTubeMine | null>(null);
  useEffect(() => {
    if (!YOUTUBE_LINK_ON) return;
    let live = true;
    void readMineOnce().then((answer) => live && setMine(answer));
    // A press of the feedback key reshapes the shelf at once: the same read, weighed again. (A video finished or skipped
    // counts from the next visit, so a row never leaves from under the video playing in it.)
    const stop = subscribeHistory(() => {
      void reweighMine().then((found) => live && found !== null && setMine((before) => (before === null ? before : { ...before, ...found })));
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  return mine;
}

/**
 * FROM YOUR YOUTUBE: new videos from the channels the reader still watches (subscribed or not), about 3 in 10 from
 * channels new to them, each saying why (Luke, 2026-11-14; `recommender/youtube-picks.ts` orders it, the same list as
 * MEDIA's YOUR YOUTUBE). A subscription they no longer watch is not here.
 */
/**
 * NOT FOR ME here hides the video at once (`onHide`, which also covers a paused history) and is kept like any other
 * NOT FOR ME (Luke, 2026-11-14: on a surprise from a quiet subscription it "quiets it further"; code review the same day).
 * Only that one video's title and channel are written, as when it is played; the YouTube list itself never is.
 */
export function YouTubeLane({ hidden, onHide, extraHosts }: { hidden: ReadonlySet<string>; onHide: (key: string) => void; extraHosts: ExtraHosts }) {
  const mine = useYouTubeMine();
  const picks = useMemo(
    () =>
      (mine?.picks ?? [])
        .map((pick): LanePick<WebItem> => ({ key: keyOf('media', pick.item.id), item: pick.item, why: pick.why, fresh: pick.fresh }))
        .filter((pick) => !hidden.has(pick.key))
        .slice(0, MOST),
    [mine, hidden],
  );
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
            <Thumb src={thumb} kind="video" />
            <div className="min-w-0 flex-1">
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open "${item.title}" on YouTube (new tab)`} {...explain('Opens this video on YouTube.', 'A new video from a channel you follow there, or one you liked.', NOTE.leaves)} className={`${STATION_KEY} block w-full break-words text-left`}>
                  {`${item.title} ↗`}
                </a>
              ) : (
                <p className="break-words px-1 text-label text-ink">{item.title}</p>
              )}
              {item.creator ? <p className="break-words px-1 text-label text-ink">{item.creator}</p> : null}
              <PickFoot why={pick.why} item={{ kind: 'media', ref: item.id, title: item.title, maker: item.creator ?? '', words: item.tags ?? [] }} onHide={() => {
                  onHide(pick.key);
                  void notForMe({ kind: 'media', ref: item.id, title: item.title, maker: item.creator ?? '', words: item.tags ?? [] });
                }}
              />
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
        <button key={word} type="button" onClick={() => onWord(word)} aria-label={`Go to ${word}`} className={STATION_KEY} {...explain(`Goes to ${word} on the map.`, 'A topic of the channels you follow on YouTube, as a place to start.')}>
          {`[ ${word.toUpperCase()} ]`}
        </button>
      ))}
    </div>
  );
}
