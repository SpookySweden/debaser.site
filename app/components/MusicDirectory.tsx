'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatClock } from '../lib/audio/format';
import { collectFiledTracks } from '../lib/audio/forum-tracks';
import { audioTagKey, buildAudioTagVocabulary, filterTracksByTags, normaliseAudioTags } from '../lib/audio/tags';
import type { AudioTrack } from '../lib/audio/tracks';
import type { ForumThread } from '../lib/forum/types';
import { PANEL, PLATE, TITLE_BAR } from '../lib/ui/controls';
import AudioTagPill from './AudioTagPill';
import { useForum } from './ForumProvider';
import { useMusicPlayer } from './MusicPlayerProvider';

/**
 * The archive's file directory.
 *
 * Everything the player can reach, in one list: the tracks filed by hand in the
 * project, whatever is in the `mp3` bucket, and every MP3 somebody attached to a
 * post or a reply. One row per file - a track posted in a thread and sitting in
 * the bucket is one file, listed once, with the poster kept because that is the
 * part a listing wants to print.
 *
 * The shape is the one a 90s netlabel shipped: a monospaced directory, columns
 * for the file, its running time, its tags and the way to play it, counted at the
 * top and filtered by tag. Playing never leaves the page - the row hands the track
 * to the player at the bottom of the window, which keeps going while the reader
 * carries on down the list (see ./MusicPlayerProvider.tsx).
 */

/** Where a row's file came from, as the FILE column prints it. */
type DirectorySource = 'ARCHIVE' | 'SHELF' | 'BOARD';

type DirectoryRow = {
  track: AudioTrack;
  /** Who put it there: the poster of the post it came with, or the track's credit. */
  poster: string;
  /** How the file sounds, spelled once here so the filter and the pills agree. */
  tags: string[];
  source: DirectorySource;
  /** The post it was filed with, when it came from the board. */
  href?: string;
  threadTitle?: string;
};

/** The grid every row and the header share, so the columns line up at both widths. */
const ROW_GRID =
  'grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[2rem_minmax(0,1fr)_5rem_minmax(0,15rem)_7rem]';

/** The last path segment of a URL or archive path: what the file is actually called. */
function fileName(src: string): string {
  const path = src.split('?')[0].split('#')[0];
  const last = path.split('/').pop() ?? path;

  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

const SOURCE_LABEL: Record<DirectorySource, string> = {
  ARCHIVE: 'ARCHIVE',
  SHELF: 'SHELF',
  BOARD: 'BOARD',
};

/**
 * The rows: the player's queue order first, so the directory and the bar never
 * disagree about what the shelf holds, with anything posted to a thread and not
 * on the shelf appended after it - a linked MP3 is playable without ever being
 * copied onto the site.
 */
function buildRows(queue: AudioTrack[], threads: ForumThread[]): DirectoryRow[] {
  const filed = collectFiledTracks(threads);
  const bySrc = new Map(filed.map((entry) => [entry.track.src, entry]));
  const rows: DirectoryRow[] = [];
  const seen = new Set<string>();

  const asBoardRow = (src: string): DirectoryRow | undefined => {
    const entry = bySrc.get(src);
    if (entry === undefined) return undefined;

    return {
      track: entry.track,
      poster: entry.poster,
      tags: normaliseAudioTags(entry.track.tags),
      source: 'BOARD',
      href: entry.href,
      threadTitle: entry.threadTitle,
    };
  };

  for (const track of queue) {
    seen.add(track.src);

    rows.push(
      asBoardRow(track.src) ?? {
        track,
        poster: track.credit.length === 0 ? 'DEBASER.SITE' : track.credit,
        tags: normaliseAudioTags(track.tags),
        source: track.shelf === 'bucket' ? 'SHELF' : 'ARCHIVE',
      },
    );
  }

  for (const entry of filed) {
    if (seen.has(entry.track.src)) continue;
    seen.add(entry.track.src);

    rows.push({
      track: entry.track,
      poster: entry.poster,
      tags: normaliseAudioTags(entry.track.tags),
      source: 'BOARD',
      href: entry.href,
      threadTitle: entry.threadTitle,
    });
  }

  return rows;
}

/**
 * The tag keys the address asks for: `/music?tag=lo-fi`, or `?tag=lo-fi,ambient`
 * for more than one. The address is the filter's only home, so a filtered list can
 * be linked to, reloaded and walked back through - a tag badge pressed inside a
 * thread arrives here as one of these.
 */
function parseTagKeys(wanted: string | null): string[] {
  if (wanted === null || wanted.length === 0) return [];

  return wanted
    .split(',')
    .map((raw) => audioTagKey(raw))
    .filter((key) => key.length > 0);
}

/** The address a filter is written to: the directory itself, or the directory + that tag. */
function tagHref(keys: string[]): string {
  return keys.length === 0 ? '/music' : `/music?tag=${keys.join(',')}`;
}

/**
 * The directory itself.
 *
 * Reads the player's queue and the board, filters by tag, and hands a row's file
 * to the player when it is pressed - never to an audio element of its own, so the
 * music carries on across the page and every other page.
 */
export default function MusicDirectory() {
  const player = useMusicPlayer();
  const forum = useForum();
  const router = useRouter();
  const search = useSearchParams();

  /** The filter lives in the address, so it is read from there rather than kept twice. */
  const tagKeys = useMemo(() => parseTagKeys(search.get('tag')), [search]);
  const [matchAll, setMatchAll] = useState(false);

  const rows = useMemo(() => buildRows(player.queue, forum.threads), [player.queue, forum.threads]);
  const vocabulary = useMemo(() => buildAudioTagVocabulary(rows), [rows]);
  const shown = useMemo(
    () => filterTracksByTags(rows, tagKeys, matchAll ? 'all' : 'any'),
    [rows, tagKeys, matchAll],
  );

  function applyTags(next: string[]) {
    router.replace(tagHref(next), { scroll: false });
  }

  function toggleTag(key: string) {
    applyTags(tagKeys.includes(key) ? tagKeys.filter((item) => item !== key) : [...tagKeys, key]);
  }

  /** The directory's one action: hand the file to the player at the bottom. */
  function press(track: AudioTrack) {
    if (player.track?.src === track.src) {
      player.toggle();
      return;
    }

    player.play(track);
  }

  return (
    <section className={PANEL}>
      <div className={TITLE_BAR}>
        <span>DEBASER NETLABEL :: FILE DIRECTORY</span>
        <span>[ {player.loading ? 'READING...' : `${rows.length} FILE${rows.length === 1 ? '' : 'S'}`} ]</span>
      </div>

      <div className="p-2">
        <fieldset className="rounded-none border border-gray-600 p-2">
          <legend className="px-1 text-[10px] font-bold text-black">AUDIO TAG FILTER</legend>

          <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold text-black">
            <button
              type="button"
              onClick={() => applyTags([])}
              aria-pressed={tagKeys.length === 0}
              title="Show every file"
              className={tagKeys.length === 0 ? `${PLATE} outline-2 outline-black` : PLATE}
            >
              [ ALL FILES ]
            </button>

            {vocabulary.map((option) => (
              <AudioTagPill
                key={option.key}
                tag={option.label}
                compact
                count={option.count}
                active={tagKeys.includes(option.key)}
                onToggle={toggleTag}
              />
            ))}
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-black">
            <span>
              SHOWING {shown.length} OF {rows.length} FILES
              {tagKeys.length === 0 ? '' : ` :: ${matchAll ? 'EVERY TAG MUST MATCH' : 'ANY TAG MATCHES'}`}
            </span>

            <span className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMatchAll(!matchAll)}
                aria-pressed={matchAll}
                title={matchAll ? 'A file must wear every tag chosen' : 'A file may wear any tag chosen'}
                className={PLATE}
              >
                {matchAll ? '[ MATCH: ALL TAGS ]' : '[ MATCH: ANY TAG ]'}
              </button>

              <button type="button" onClick={() => applyTags([])} disabled={tagKeys.length === 0} className={PLATE}>
                [ CLEAR FILTER ]
              </button>
            </span>
          </div>
        </fieldset>

        <div className="mt-2 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white">
          <div
            className={`${ROW_GRID} hidden border-b border-gray-500 bg-[#e8e8e8] px-2 py-1 text-[9px] font-bold text-gray-700 sm:grid`}
          >
            <span>#</span>
            <span>FILENAME / TITLE</span>
            <span className="text-right">LENGTH</span>
            <span>TAGS</span>
            <span className="text-right">PLAY</span>
          </div>

          {shown.length === 0 ? (
            <p className="p-2 text-[10px] font-bold text-black">
              {rows.length === 0
                ? 'NOTHING FILED YET - FILE A TRACK BELOW, OR ATTACH ONE TO A POST ON THE BOARD.'
                : 'NO FILE WEARS THAT TAG.'}
            </p>
          ) : (
            <ul>
              {shown.map((row, position) => {
                const current = player.track?.src === row.track.src;
                const playing = current && player.playing;
                const tags = row.tags;
                /** The player's own reading of the file wins once it has been played. */
                const length =
                  current && Number.isFinite(player.duration) ? formatClock(player.duration) : row.track.length;

                return (
                  <li
                    key={row.track.src}
                    className={`border-b border-dotted border-gray-400 px-2 py-1 ${
                      current ? 'bg-[#ffffcc]' : 'bg-white'
                    }`}
                  >
                    <div className={ROW_GRID}>
                      <span className="text-[10px] text-gray-700">{String(position + 1).padStart(2, '0')}.</span>

                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-bold text-black" title={row.track.title}>
                          {row.track.title}
                        </span>
                        <span className="block truncate text-[9px] text-gray-700">
                          {fileName(row.track.src)} :: {row.poster} :: {SOURCE_LABEL[row.source]}
                          <span className="sm:hidden"> :: {length}</span>
                        </span>
                        {row.href === undefined ? null : (
                          <Link
                            href={row.href}
                            title={row.threadTitle}
                            className="block truncate text-[9px] font-bold text-[#000080] underline hover:bg-[#ffffcc]"
                          >
                            filed with a post on the board
                          </Link>
                        )}
                      </span>

                      <span className="hidden text-right text-[10px] font-bold text-black sm:block">{length}</span>

                      <span className="hidden flex-wrap items-center gap-1 sm:flex">
                        {tags.length === 0 ? (
                          <span className="text-[9px] text-gray-700">UNTAGGED</span>
                        ) : (
                          tags.map((tag) => <AudioTagPill key={tag} tag={tag} compact />)
                        )}
                      </span>

                      <button
                        type="button"
                        onClick={() => press(row.track)}
                        className={`${PLATE} justify-self-end`}
                        title={playing ? `Pause ${row.track.title}` : `Play ${row.track.title}`}
                      >
                        {playing ? '[ ❚❚ PAUSE ]' : current ? '[ ▶ RESUME ]' : '[ ▶ PLAY ]'}
                      </button>
                    </div>

                    {/* A phone has no room for the tag column, so the tags take their own line. */}
                    <div className="mt-1 flex flex-wrap items-center gap-1 pl-8 sm:hidden">
                      {tags.length === 0 ? (
                        <span className="text-[9px] text-gray-700">UNTAGGED</span>
                      ) : (
                        tags.map((tag) => <AudioTagPill key={tag} tag={tag} compact />)
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-black">
          <span>PRESS PLAY AND THE TRACK KEEPS GOING WHILE YOU READ.</span>

          <button type="button" onClick={player.refresh} className={PLATE} title="Read the shelf again">
            [ RELOAD THE SHELF ]
          </button>
        </div>

      </div>
    </section>
  );
}
