'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  LOOSE_FILES,
  SOURCE_LABEL,
  buildArchiveRows,
  buildArchiveTree,
  fileLabel,
  filterArchiveRows,
  isFiltering,
  sortByDisplayName,
  type ArchiveRow,
} from '../lib/audio/archive-tree';
import { formatClock } from '../lib/audio/format';
import { audioTagKey, buildAudioTagVocabulary, normaliseAudioTags } from '../lib/audio/tags';
import type { AudioTrack } from '../lib/audio/tracks';
import { pluralise } from '../lib/forum/format';
import { PANEL, PLATE, TITLE_BAR } from '../lib/ui/controls';
import AudioTagPill from './AudioTagPill';
import { useForum } from './ForumProvider';
import { useMusicPlayer } from './MusicPlayerProvider';

/**
 * The archive directory.
 *
 * A file listing: a search bar, a tag filter that stays folded away until it is asked for,
 * and the shelf as a tree - artist, then release, then the files on it - with anything that
 * has no release behind it (an upload, or an MP3 somebody attached to a post) under LOOSE
 * FILES. Searching or choosing a tag turns the tree into a flat run of what matched,
 * ordered by the name it is filed under; clearing either puts the tree back.
 *
 * Playing never leaves the page: a row hands its file to the player at the bottom of the
 * window (see ./MusicPlayerProvider.tsx), which keeps going while the reader carries on
 * down the list.
 */

/** The row grid shared by the column header and every file row, so the columns line up. */
const ROW_GRID =
  'grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[2rem_minmax(0,1fr)_4rem_minmax(0,14rem)_6.5rem]';

/** The tag keys the address asks for: `/music?tag=lo-fi`, or `?tag=lo-fi,ambient`. */
function parseTagKeys(wanted: string | null): string[] {
  if (wanted === null || wanted.length === 0) return [];

  return wanted
    .split(',')
    .map((raw) => audioTagKey(raw))
    .filter((key) => key.length > 0);
}

/** The address a tag choice is written to, so a filtered listing can be linked to. */
function tagHref(keys: string[]): string {
  return keys.length === 0 ? '/music' : `/music?tag=${keys.join(',')}`;
}

/**
 * One file.
 *
 * The name is the archive's own - `[TRACK TITLE] - [ALBUM NAME] - [ARTIST NAME]` - printed
 * whole, because that is how the file is filed and how it reads anywhere else on the site.
 */
function FileRow({ row, index }: { row: ArchiveRow; index: number }) {
  const player = useMusicPlayer();
  const current = player.track?.src === row.track.src;
  const playing = current && player.playing;
  const tags = normaliseAudioTags(row.tags);
  /** The player's own reading of the file wins once it has been played. */
  const length = current && Number.isFinite(player.duration) ? formatClock(player.duration) : row.track.length;

  function press(track: AudioTrack) {
    if (current) {
      player.toggle();
      return;
    }

    player.play(track);
  }

  return (
    <li
      className={`border-b border-dotted border-gray-400 px-2 py-1 ${current ? 'bg-[#ffffcc]' : 'bg-white'}`}
    >
      <div className={ROW_GRID}>
        <span className="text-[10px] text-gray-700">{String(index + 1).padStart(2, '0')}.</span>

        <span className="min-w-0">
          <span className="block truncate text-[11px] font-bold text-black" title={row.track.title}>
            {row.track.title}
          </span>
          <span className="block truncate text-[9px] text-gray-700">
            {fileLabel(row.track.src)} :: {SOURCE_LABEL[row.source]}
            {row.source === 'BOARD' ? ` :: POSTED BY ${row.poster}` : ''}
            <span className="sm:hidden"> :: {length}</span>
          </span>
          {row.href === undefined ? null : (
            <Link
              href={row.href}
              title={row.threadTitle}
              className="block truncate text-[9px] font-bold text-[#000080] underline hover:bg-[#ffffcc]"
            >
              OPEN THE POST
            </Link>
          )}
        </span>

        <span className="hidden text-right text-[10px] font-bold text-black sm:block">{length}</span>

        <span className="hidden flex-wrap items-center gap-1 sm:flex">
          {tags.length === 0 ? null : tags.map((tag) => <AudioTagPill key={tag} tag={tag} compact />)}
        </span>

        <button
          type="button"
          onClick={() => press(row.track)}
          className={`${PLATE} justify-self-end`}
          title={playing ? `Pause ${row.track.title}` : `Play ${row.track.title}`}
        >
          {playing ? '[ ❚❚ ]' : '[ ▶ PLAY ]'}
        </button>
      </div>

      {/* A phone has no room for the tag column, so the tags take their own line. */}
      {tags.length === 0 ? null : (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-8 sm:hidden">
          {tags.map((tag) => (
            <AudioTagPill key={tag} tag={tag} compact />
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * A folder: an artist, or one of their releases.
 *
 * Folded until it is opened, and drawn the way a file manager draws one - the marker, the
 * name, and how many files are inside - so the listing opens as a shelf outline rather than
 * as sixty rows at once.
 */
function Folder({
  id,
  label,
  count,
  open,
  onToggle,
  nested = false,
  children,
}: {
  id: string;
  label: string;
  /** How many files are inside, already written out. */
  count: string;
  open: boolean;
  onToggle: (id: string, open: boolean) => void;
  /** True for a release inside an artist, which is indented one step. */
  nested?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="border-b border-dotted border-gray-400">
      <details open={open} onToggle={(event) => onToggle(id, event.currentTarget.open)}>
        <summary
          className={`flex cursor-pointer select-none items-center gap-2 py-1 text-[10px] font-bold text-black hover:bg-[#ffffcc] ${
            nested ? 'pl-6 pr-2' : 'bg-[#e8e8e8] px-2'
          }`}
        >
          <span className="w-4 shrink-0 text-gray-700">{open ? '[-]' : '[+]'}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="shrink-0 text-gray-700">{count}</span>
        </summary>

        {children}
      </details>
    </li>
  );
}

/**
 * The whole shelf, listed.
 *
 * The search box is the one control that is always in reach, and the tag filter lives behind
 * `[ FILTER ]` (or behind the search box being used) so the directory opens on the shelf
 * outline alone. Nothing here holds a track of its own: every play action hands the file to
 * the site's player.
 */
export default function MusicDirectory() {
  const player = useMusicPlayer();
  const forum = useForum();
  const router = useRouter();
  const search = useSearchParams();

  /** The tag choice lives in the address, so a filtered listing can be linked to. */
  const tagKeys = useMemo(() => parseTagKeys(search.get('tag')), [search]);
  const [query, setQuery] = useState('');
  const [matchAll, setMatchAll] = useState(false);
  /** Folded away by default; opened by the toggle, by the search box, or by a tag in the address. */
  const [tagsOpen, setTagsOpen] = useState(() => tagKeys.length > 0);
  /** Which folders are open, by id: the tree is folded until it is asked for. */
  const [openNodes, setOpenNodes] = useState<string[]>([]);

  const rows = useMemo(() => buildArchiveRows(player.queue, forum.threads), [player.queue, forum.threads]);
  const vocabulary = useMemo(() => buildAudioTagVocabulary(rows), [rows]);
  const tree = useMemo(() => buildArchiveTree(rows), [rows]);
  const matches = useMemo(
    () => filterArchiveRows(rows, { query, tagKeys, matchAll }),
    [rows, query, tagKeys, matchAll],
  );
  const flat = useMemo(() => sortByDisplayName(matches), [matches]);
  const filtering = isFiltering({ query, tagKeys, matchAll });

  function toggleTag(key: string) {
    const next = tagKeys.includes(key) ? tagKeys.filter((item) => item !== key) : [...tagKeys, key];
    router.replace(tagHref(next), { scroll: false });
  }

  function clearAll() {
    setQuery('');
    router.replace('/music', { scroll: false });
  }

  function toggleFolder(id: string, open: boolean) {
    setOpenNodes((current) =>
      open ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id),
    );
  }

  const isOpen = (id: string) => openNodes.includes(id);

  return (
    <section className={PANEL}>
      <div className={TITLE_BAR}>
        <span>DEBASER NETLABEL :: FILE DIRECTORY</span>
        <span>
          [ {rows.length} {pluralise(rows.length, 'FILE')} ]
        </span>
      </div>

      <div className="p-2">
        {/* FIND: the one control that is always in reach. */}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="music-search" className="text-[10px] font-bold text-black">
            FIND:
          </label>
          <input
            id="music-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setTagsOpen(true)}
            placeholder="TRACK, RELEASE, ARTIST OR TAG"
            className="min-w-40 flex-1 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 font-mono text-xs text-black outline-none max-sm:p-2"
          />

          <button type="button" onClick={() => setTagsOpen(!tagsOpen)} aria-expanded={tagsOpen} className={PLATE}>
            {tagsOpen ? '[ FILTER ▴ ]' : '[ FILTER ▾ ]'}
          </button>

          <button type="button" onClick={clearAll} disabled={!filtering} className={PLATE}>
            [ CLEAR ]
          </button>

          <button type="button" onClick={player.refresh} className={PLATE}>
            [ REFRESH ]
          </button>
        </div>

        {/* The tag filter, folded until it is asked for. */}
        <div
          className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ${
            tagsOpen ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]'
          }`}
        >
          <div className="min-h-0">
            <fieldset className="mt-2 rounded-none border border-gray-600 p-2">
              <legend className="px-1 text-[10px] font-bold text-black">TAGS</legend>

              <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold text-black">
                <button
                  type="button"
                  onClick={() => router.replace('/music', { scroll: false })}
                  aria-pressed={tagKeys.length === 0}
                  className={tagKeys.length === 0 ? `${PLATE} outline-2 outline-black` : PLATE}
                >
                  [ ALL ]
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

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold text-black">
                <span>MATCH:</span>

                <button
                  type="button"
                  onClick={() => setMatchAll(false)}
                  aria-pressed={!matchAll}
                  className={!matchAll ? `${PLATE} outline-2 outline-black` : PLATE}
                >
                  [ ANY TAG ]
                </button>

                <button
                  type="button"
                  onClick={() => setMatchAll(true)}
                  aria-pressed={matchAll}
                  className={matchAll ? `${PLATE} outline-2 outline-black` : PLATE}
                >
                  [ ALL TAGS ]
                </button>
              </div>
            </fieldset>
          </div>
        </div>

        {/* How much is listed: the count only speaks up about filtering when something is filtered. */}
        <p className="mt-2 text-[10px] font-bold text-black">
          {filtering
            ? `${flat.length} OF ${rows.length} FILES`
            : `${tree.artists.length} ${pluralise(tree.artists.length, 'ARTIST')} :: ${rows.length} ${pluralise(rows.length, 'FILE')}`}
        </p>

        <div className="mt-1 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white">
          {/* The directory's own column labels, and nothing else. */}
          <div
            className={`${ROW_GRID} hidden border-b border-gray-500 bg-[#e8e8e8] px-2 py-1 text-[9px] font-bold text-gray-700 sm:grid`}
          >
            <span>#</span>
            <span>NAME</span>
            <span className="text-right">LENGTH</span>
            <span>TAGS</span>
            <span className="text-right">PLAY</span>
          </div>

          {rows.length === 0 ? (
            <p className="p-2 text-[10px] font-bold text-black">NO FILES.</p>
          ) : filtering ? (
            flat.length === 0 ? (
              <p className="p-2 text-[10px] font-bold text-black">NO MATCHES.</p>
            ) : (
              <ul>
                {flat.map((row, index) => (
                  <FileRow key={row.track.src} row={row} index={index} />
                ))}
              </ul>
            )
          ) : (
            <ul>
              {tree.artists.map((artist) => (
                <Folder
                  key={artist.name}
                  id={`artist:${artist.name}`}
                  label={`${artist.name} (${artist.albums.length} ${pluralise(artist.albums.length, 'RELEASE')})`}
                  count={`${artist.trackCount} ${pluralise(artist.trackCount, 'FILE')}`}
                  open={isOpen(`artist:${artist.name}`)}
                  onToggle={toggleFolder}
                >
                  <ul>
                    {artist.albums.map((release) => {
                      const id = `album:${artist.name}:${release.name}:${release.year}`;

                      return (
                        <Folder
                          key={id}
                          id={id}
                          label={`${release.name} (${release.year})`}
                          count={`${release.rows.length} ${pluralise(release.rows.length, 'FILE')}`}
                          open={isOpen(id)}
                          onToggle={toggleFolder}
                          nested
                        >
                          <ul>
                            {release.rows.map((row, index) => (
                              <FileRow key={row.track.src} row={row} index={index} />
                            ))}
                          </ul>
                        </Folder>
                      );
                    })}
                  </ul>
                </Folder>
              ))}

              {tree.loose.length === 0 ? null : (
                <Folder
                  id="loose"
                  label={LOOSE_FILES}
                  count={`${tree.loose.length} ${pluralise(tree.loose.length, 'FILE')}`}
                  open={isOpen('loose')}
                  onToggle={toggleFolder}
                >
                  <ul>
                    {tree.loose.map((row, index) => (
                      <FileRow key={row.track.src} row={row} index={index} />
                    ))}
                  </ul>
                </Folder>
              )}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
