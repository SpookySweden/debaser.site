'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { forYou } from '../lib/audio/for-you';
import { collectFiledTracks } from '../lib/audio/forum-tracks';
import { getMusicRepository } from '../lib/audio/repository';
import { uploaderIdFromSrc } from '../lib/audio/track-context';
import type { AudioTrack } from '../lib/audio/tracks';
import { vanitySongs, type VanitySong } from '../lib/audio/vanity';
import { exploreWords, keyOf, pickLane, strongestWords, tasteFromHistory, type Candidate, type LanePick } from '../lib/recommender/engine';
import { notForMe, readHistory, subscribeHistory } from '../lib/recommender/history';
import type { HistoryKind, HistoryRow } from '../lib/recommender/types';
import { findTag, sourceLabel, type StationIndex } from '../lib/tag-station/query';
import type { StationItem } from '../lib/tag-station/types';
import { searchEverywhere } from '../lib/web/everywhere-client';
import { rowAddresses, type ExtraHosts } from '../lib/web/row-addresses';
import { readTaste } from '../lib/web/taste-store';
import type { WebItem } from '../lib/web/types';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import HistoryPanel from './HistoryPanel';
import { useMusicLibrary } from './MusicLibraryProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import { STATION_KEY, STATION_KEY_ON, Thumb } from './TagStationParts';

/**
 * FOR YOU (SPEC-recommender.md, Luke 2026-11-13): lanes of picks at the top of DISCOVER, from the person's private history
 * and what is shared openly, one engine for every lane (`lib/recommender/engine.ts`). Every pick says why in plain words;
 * NOT FOR ME hides it and shows less like it. No scores or counts are drawn. Step 1: MEDIA, SONGS and BOOKS.
 */

const FIRST = 4;
const MOST = 18;
/** How many words BOOKS asks Open Library about. */
const BOOK_QUERIES = 3;

type Hidden = ReadonlySet<string>;

/** Rows for one lane, its picks drawn by the caller. A lane with nothing honest to offer draws nothing at all. */
function Lane<T>({ id, title, picks, loading, render }: { id: string; title: string; picks: LanePick<T>[]; loading: boolean; render: (pick: LanePick<T>) => ReactNode }) {
  const [shown, setShown] = useState(FIRST);
  if (!loading && picks.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1" data-for-you-lane={id}>
      <h3 id={id} className="title-line text-ink text-title">
        {title}
      </h3>
      {loading && picks.length === 0 ? (
        <p role="status" className="text-label text-ink-quiet">
          READING...
        </p>
      ) : (
        <ul className="flex flex-col">{picks.slice(0, shown).map(render)}</ul>
      )}
      {picks.length > shown && shown < MOST ? (
        <button type="button" onClick={() => setShown((now) => now + FIRST)} className={`${STATION_KEY} w-fit`}>
          [ MORE ]
        </button>
      ) : null}
    </section>
  );
}

/** The why-line and NOT FOR ME, under every pick. */
function PickFoot({ why, onHide, title }: { why: string; onHide: () => void; title: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      <p className="min-w-0 break-words px-1 text-label text-ink-quiet" data-why>
        {why}
      </p>
      <button type="button" onClick={onHide} aria-label={`Not for me: hide ${title}`} className={STATION_KEY}>
        [ NOT FOR ME ]
      </button>
    </div>
  );
}

/** The site's own songs, as VANITY lists them, and who close to the reader played what (`music_for_you`). */
function useSongs(userId: string | null) {
  const forum = useForum();
  const library = useMusicLibrary();
  const [data, setData] = useState<{ tracks: AudioTrack[]; counts: ReadonlyMap<string, number>; rows: Awaited<ReturnType<ReturnType<typeof getMusicRepository>['forYou']>>; mine: ReadonlyMap<string, number> } | null>(null);
  useEffect(() => {
    let live = true;
    const repository = getMusicRepository();
    void (async () => {
      try {
        const [tracks, counts] = await Promise.all([repository.listTracks(), repository.playCounts()]);
        const [rows, mine] = userId === null ? [[], new Map<string, number>()] : await Promise.all([repository.forYou(userId), repository.myPlays(userId)]);
        if (live) setData({ tracks, counts, rows, mine });
      } catch {
        if (live) setData({ tracks: [], counts: new Map(), rows: [], mine: new Map() });
      }
    })();
    return () => {
      live = false;
    };
  }, [userId]);
  const filed = useMemo(() => collectFiledTracks(forum.threads).map(({ track, poster }) => ({ track, poster })), [forum.threads]);
  return useMemo(() => {
    if (data === null) return null;
    const songs = vanitySongs(data.tracks, filed, data.counts, uploaderIdFromSrc);
    const picks = forYou({ songs, rows: data.rows, mine: data.mine, barred: library.barredSrcs, selfId: userId });
    return { songs: songs.filter((song) => !library.barredSrcs.has(song.track.src)), picks };
  }, [data, filed, library.barredSrcs, userId]);
}

/** BOOKS: Open Library's free books for the reader's authors and strongest words. */
function useBooks(queries: readonly string[]) {
  const [books, setBooks] = useState<{ query: string; item: WebItem }[] | null>(null);
  const key = queries.join('|');
  useEffect(() => {
    let live = true;
    if (key === '') {
      // Nothing to ask about: the lane is left out.
      queueMicrotask(() => live && setBooks([]));
      return;
    }
    void Promise.all(
      key.split('|').map((query) =>
        searchEverywhere(query, null, 'books')
          .then((page) => page.items.map((item) => ({ query, item: item as WebItem })))
          .catch(() => [] as { query: string; item: WebItem }[]),
      ),
    ).then((found) => live && setBooks(found.flat()));
    return () => {
      live = false;
    };
  }, [key]);
  return books;
}

export default function ForYou({ index, extraHosts, onPick }: { index: StationIndex; extraHosts: ExtraHosts; onPick: (id: string) => void }) {
  const { user } = useAuth();
  const player = useMusicPlayer();
  const userId = user?.id ?? null;
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [now] = useState(() => Date.now());
  const [browserTaste] = useState(readTaste);
  const [hidden, setHidden] = useState<Hidden>(() => new Set());
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(() => {
    void readHistory(1000).then(setRows);
  }, []);
  useEffect(() => {
    if (userId === null) return;
    load();
    return subscribeHistory(load);
  }, [userId, load]);

  const history = useMemo(() => rows ?? [], [rows]);
  const taste = useMemo(() => tasteFromHistory(history, now, browserTaste), [history, now, browserTaste]);
  const explore = useMemo(
    () => exploreWords(taste, (word) => findTag(index, word)?.partners.filter((partner) => partner.close).map((partner) => partner.name) ?? []),
    [taste, index],
  );
  const context = useMemo(() => ({ taste, rows: history, explore, now, size: MOST }), [taste, history, explore, now]);

  const hide = (kind: HistoryKind, ref: string, title: string, maker: string, words: readonly string[]) => {
    setHidden((current) => new Set([...current, keyOf(kind, ref)]));
    void notForMe({ kind, ref, title, maker, words: [...words] });
  };
  const visible = <T,>(picks: LanePick<T>[]) => picks.filter((pick) => !hidden.has(pick.key));

  /* MEDIA: the map's own items that have an address (a search result nobody saved has none). */
  const media = useMemo(() => {
    const candidates: Candidate<StationItem>[] = index.graph.items
      .filter((item) => !item.seenOnly)
      .map((item) => ({ key: keyOf('media', item.id), words: item.words.map((word) => word.word), maker: item.creator, item }));
    return pickLane(candidates, context);
  }, [index, context]);

  /* SONGS: the site's own music; people close to the reader count as an openly shared reason (VANITY's FOR YOU). */
  const songData = useSongs(userId);
  const songs = useMemo(() => {
    if (songData === null) return [];
    const shared = new Map(songData.picks.songs.map((pick) => [pick.songs[0]?.track.src, pick.why.replace(/PLAYED BY \d+ PEOPLE/, 'PLAYED BY PEOPLE')]));
    const candidates: Candidate<VanitySong<AudioTrack>>[] = songData.songs.map((song) => {
      const why = shared.get(song.track.src);
      return {
        key: keyOf('song', song.track.src),
        words: song.track.kind ? [song.track.kind] : [],
        maker: song.artist,
        item: song,
        ...(why && !/\d/.test(why) ? { shared: { why, weight: 1 } } : {}),
      };
    });
    return pickLane(candidates, context);
  }, [songData, context]);

  /* BOOKS: authors the reader has read, then their strongest words. */
  const bookQueries = useMemo(() => {
    const authors = history.filter((row) => row.kind === 'book' && row.maker !== '' && row.action !== 'not_for_me').map((row) => row.maker);
    return [...new Set([...authors, ...strongestWords(taste, BOOK_QUERIES)])].slice(0, BOOK_QUERIES);
  }, [history, taste]);
  const bookFinds = useBooks(userId === null ? [] : bookQueries);
  const books = useMemo(() => {
    const candidates: Candidate<WebItem>[] = (bookFinds ?? []).map(({ query, item }) => ({
      key: keyOf('book', item.id),
      words: [...(item.tags ?? []), query.toLowerCase()],
      maker: item.creator,
      item,
    }));
    return pickLane(candidates, context);
  }, [bookFinds, context]);

  if (user === null) {
    return (
      <p className="text-key text-ink" data-for-you>
        <Link href="/account" className={STATION_KEY}>
          [ LOG IN ]
        </Link>{' '}
        TO GET PICKS
      </p>
    );
  }

  const loading = rows === null;
  return (
    <section aria-labelledby="for-you-title" className="flex min-w-0 flex-col gap-3" data-for-you>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="for-you-title" className="title-line min-w-0 flex-1 text-accent-ink text-title font-bold">
          FOR YOU
        </h2>
        <button type="button" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen} aria-controls="for-you-history" className={historyOpen ? STATION_KEY_ON : STATION_KEY}>
          {historyOpen ? 'HISTORY' : '[ HISTORY ]'}
        </button>
      </div>
      <div id="for-you-history" hidden={!historyOpen}>
        {historyOpen ? <HistoryPanel /> : null}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 basis-72 flex-col">
          <Lane
            id="for-you-media"
            title="MEDIA"
            loading={loading}
            picks={visible(media)}
            render={(pick) => {
              const item = pick.item;
              const { thumb } = rowAddresses(item as WebItem, extraHosts);
              const words = item.words.map((word) => word.word);
              return (
                <li key={pick.key} className="rule-pixel flex items-start gap-2 py-2">
                  <Thumb src={thumb} />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => onPick(item.id)} aria-label={`Go to ${item.title}`} className={`${STATION_KEY} block w-full break-words text-left`}>
                      {item.title}
                    </button>
                    <p className="break-words px-1 text-label text-ink">
                      {sourceLabel(item.platform)} · {item.kind.toUpperCase()}
                      {item.creator ? ` · ${item.creator}` : ''}
                    </p>
                    <PickFoot why={pick.why} title={item.title} onHide={() => hide('media', item.id, item.title, item.creator ?? '', words)} />
                  </div>
                </li>
              );
            }}
          />
        </div>
        <div className="flex min-w-0 flex-1 basis-72 flex-col">
          <Lane
            id="for-you-songs"
            title="SONGS"
            loading={loading || songData === null}
            picks={visible(songs)}
            render={(pick) => {
              const { track, artist } = pick.item;
              return (
                <li key={pick.key} className="rule-pixel flex flex-col gap-1 py-2">
                  <button
                    type="button"
                    onClick={() => player.play(track, { href: '/discover', where: 'FOR YOU' })}
                    aria-label={`Play ${track.title}`}
                    className={`${STATION_KEY} block w-full break-words text-left`}
                  >
                    {`▶ ${track.title}`}
                  </button>
                  <p className="break-words px-1 text-label text-ink">{artist}</p>
                  <PickFoot why={pick.why} title={track.title} onHide={() => hide('song', track.src, track.title, artist, track.kind ? [track.kind] : [])} />
                </li>
              );
            }}
          />
          <Lane
            id="for-you-books"
            title="BOOKS"
            loading={loading || bookFinds === null}
            picks={visible(books)}
            render={(pick) => {
              const item = pick.item;
              return (
                <li key={pick.key} className="rule-pixel flex items-start gap-2 py-2">
                  <Thumb src={item.thumbnailUrl ?? null} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/media/book/${item.id}`} className={`${STATION_KEY} block w-full break-words text-left`}>
                      {item.title}
                    </Link>
                    {item.creator ? <p className="break-words px-1 text-label text-ink">{item.creator}</p> : null}
                    <PickFoot why={pick.why} title={item.title} onHide={() => hide('book', item.id, item.title, item.creator ?? '', item.tags ?? [])} />
                  </div>
                </li>
              );
            }}
          />
        </div>
      </div>
    </section>
  );
}
