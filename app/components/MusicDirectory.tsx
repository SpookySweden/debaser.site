'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  SOURCE_LABEL,
  buildArchiveRows,
  buildArchiveTree,
  fileLabel,
  filterArchiveRows,
  folderAncestors,
  isFiltering,
  sortArchiveRows,
  type ArchiveFolder,
  type ArchiveRow,
  type FolderPath,
} from '../lib/audio/archive-tree';
import { formatClock } from '../lib/audio/format';
import { forumTrackFromArchive } from '../lib/audio/forum-tracks';
import { TRACK_SORTS, type TrackSort } from '../lib/audio/sorts';
import { audioTagKey, buildAudioTagVocabulary, normaliseAudioTags } from '../lib/audio/tags';
import type { AudioTrack } from '../lib/audio/tracks';
import { useArchiveFolders } from '../lib/audio/use-archive-folders';
import { pluralise } from '../lib/forum/format';
import { PANEL, PLATE, TITLE_BAR } from '../lib/ui/controls';
import AudioTagPill from './AudioTagPill';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import NewArchiveFileWindow from './NewArchiveFileWindow';
import NewArchiveFolderWindow from './NewArchiveFolderWindow';
import NewPostForm from './NewPostForm';

/**
 * The archive, as a file browser.
 *
 * A directory of folders with files in them: the catalogue's own releases, the folders anybody
 * signed in has made, and every file that has been filed into them - including the MP3s people
 * attached to posts on the board. Each row is a file or a folder, a click on play hands the file
 * to the player at the bottom of the window, and the toolbar makes new ones.
 *
 * Where a file is filed is the whole of its name, so the browser is the place the archive's
 * naming convention comes from: filing `GLASS CORRIDOR` into `HEXHAM/GRIDLOCK` lists it as
 * `GLASS CORRIDOR - GRIDLOCK - HEXHAM`.
 */

/** The row grid shared by the column header and every file row, so the columns line up. */
const ROW_GRID =
  'grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[2rem_minmax(0,1fr)_4rem_minmax(0,14rem)_11rem]';

/** A control small enough to sit on a folder row, beside the folder's name. */
const ROW_BUTTON =
  'shrink-0 cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-[#c0c0c0] px-1 py-[1px] text-[9px] font-bold text-black hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-60 max-sm:px-2 max-sm:py-[3px]';

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
 * The name is the archive's own - `[TRACK TITLE] - [ALBUM NAME] - [ARTIST NAME]`, which is
 * where it is filed - printed whole, because that is how it is filed and how it reads anywhere
 * else on the site.
 */
function FileRow({ row, index, onPost }: { row: ArchiveRow; index: number; onPost: (track: AudioTrack) => void }) {
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
    <li className={`border-b border-dotted border-gray-400 px-2 py-1 ${current ? 'bg-[#ffffcc]' : 'bg-white'}`}>
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

        <span className="flex items-center gap-1 justify-self-end">
          <button
            type="button"
            onClick={() => press(row.track)}
            className={PLATE}
            title={playing ? `Pause ${row.track.title}` : `Play ${row.track.title}`}
          >
            {playing ? '[ ❚❚ ]' : '[ ▶ PLAY ]'}
          </button>

          {/* One press starts a post with this file already filed (`./NewPostForm.tsx`): the archive's
              own way onto the board, instead of a round trip through /forum and the composer. */}
          <button
            type="button"
            onClick={() => onPost(row.track)}
            className={`${PLATE} hidden sm:inline-flex`}
            title={`Start a post carrying ${row.track.title}`}
          >
            [ ♪ TO A POST ]
          </button>
        </span>
      </div>

      {/* A phone has no room for the tag column, so the tags take their own line. */}
      {tags.length === 0 ? null : (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-8 sm:hidden">
          {tags.map((tag) => (
            <AudioTagPill key={tag} tag={tag} compact />
          ))}
        </div>
      )}

      {/* ...and no room for two plates in the last column either, so the second drops to its own line
          rather than going missing on a phone: the same trade the tags above make. */}
      <div className="mt-1 pl-8 sm:hidden">
        <button
          type="button"
          onClick={() => onPost(row.track)}
          className={PLATE}
          title={`Start a post carrying ${row.track.title}`}
        >
          [ ♪ TO A POST ]
        </button>
      </div>
    </li>
  );
}

type FolderBranchProps = {
  folder: ArchiveFolder;
  /** Folders the reader has opened, by path. */
  openNodes: FolderPath[];
  onToggle: (path: FolderPath, open: boolean) => void;
  /** Asks for a new file or folder inside this one. */
  onCreate: (kind: 'file' | 'folder', parent: FolderPath) => void;
  /** True for a signed-in reader; a guest is offered the rows without the buttons. */
  canCreate: boolean;
  /** Starts a post carrying one of the files inside (see `./FileRow`). */
  onPost: (track: AudioTrack) => void;
};

/**
 * One folder, and everything under it.
 *
 * Folded until it is opened, drawn the way a file manager draws one - the marker, the name, how
 * many files are inside, and what can be made in it - and it nests to whatever depth the archive
 * has, because a folder is only a path.
 */
function FolderBranch({ folder, openNodes, onToggle, onCreate, canCreate, onPost }: FolderBranchProps) {
  const path = folder.path ?? '';
  const open = openNodes.includes(path);
  const empty = folder.folders.length === 0 && folder.files.length === 0;

  return (
    <li className="border-b border-dotted border-gray-400">
      <details open={open} onToggle={(event) => onToggle(path, event.currentTarget.open)}>
        <summary className="flex cursor-pointer select-none items-center gap-2 bg-[#e8e8e8] px-2 py-1 text-[10px] font-bold text-black hover:bg-[#ffffcc]">
          <span className="w-4 shrink-0 text-gray-700">{open ? '[-]' : '[+]'}</span>
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          <span className="shrink-0 text-gray-700">
            {folder.fileCount} {pluralise(folder.fileCount, 'FILE')}
          </span>

          {canCreate ? (
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title={`File a new track in ${folder.name}`}
                onClick={(event) => {
                  // The summary would otherwise fold the folder instead of the button working.
                  event.preventDefault();
                  onCreate('file', path);
                }}
                className={ROW_BUTTON}
              >
                [ + FILE ]
              </button>
              <button
                type="button"
                title={`Make a folder in ${folder.name}`}
                onClick={(event) => {
                  event.preventDefault();
                  onCreate('folder', path);
                }}
                className={ROW_BUTTON}
              >
                [ + FOLDER ]
              </button>
            </span>
          ) : null}
        </summary>

        <ul>
          {folder.folders.map((child) => (
            <FolderBranch
              key={child.path}
              folder={child}
              openNodes={openNodes}
              onToggle={onToggle}
              onCreate={onCreate}
              canCreate={canCreate}
              onPost={onPost}
            />
          ))}

          {folder.files.map((row, index) => (
            <FileRow key={row.track.src} row={row} index={index} onPost={onPost} />
          ))}

          {empty ? <li className="px-2 py-1 pl-6 text-[10px] font-bold text-gray-700">EMPTY.</li> : null}
        </ul>
      </details>
    </li>
  );
}

/**
 * The archive, open on the page.
 *
 * The toolbar is the browser's: what can be made, the box that finds things, the tags that stay
 * folded away until they are asked for, and a reload. Everything a row does goes through the one
 * player at the bottom of the window, and everything that makes a file goes through the same
 * store the shelf has always used.
 */
export default function MusicDirectory() {
  const player = useMusicPlayer();
  const forum = useForum();
  const { user } = useAuth();
  const folders = useArchiveFolders();
  const router = useRouter();
  const search = useSearchParams();

  /** The tag choice lives in the address, so a filtered listing can be linked to. */
  const tagKeys = useMemo(() => parseTagKeys(search.get('tag')), [search]);
  const [query, setQuery] = useState('');
  const [matchAll, setMatchAll] = useState(false);
  /** The order the search comes back in: the directory's own to begin with. */
  const [sort, setSort] = useState<TrackSort>('name');
  /** Folded away by default; opened by the toggle, by the search box, or by a tag in the address. */
  const [tagsOpen, setTagsOpen] = useState(() => tagKeys.length > 0);
  /** Which folders are open, by path: the directory is folded until it is asked for. */
  const [openNodes, setOpenNodes] = useState<FolderPath[]>([]);
  /** The window on screen: a new file or a new folder, and where it was asked for from. */
  const [creating, setCreating] = useState<{ kind: 'file' | 'folder'; parent: FolderPath | null } | null>(null);
  /** The file a post is being written about, or null: the composer, opened by a row's `[ ♪ TO A POST ]`. */
  const [posting, setPosting] = useState<AudioTrack | null>(null);

  const signedIn = user !== null;

  const rows = useMemo(() => buildArchiveRows(player.queue, forum.threads), [player.queue, forum.threads]);
  const tree = useMemo(() => buildArchiveTree(rows, folders.folders), [rows, folders.folders]);
  const vocabulary = useMemo(() => buildAudioTagVocabulary(rows), [rows]);
  const matches = useMemo(
    () => filterArchiveRows(rows, { query, tagKeys, matchAll }),
    [rows, query, tagKeys, matchAll],
  );
  // The search comes back in the order that was asked for: by name (the directory's own order), by
  // when a file was last posted, by how many posts carry it, or by whoever filed it.
  const flat = useMemo(() => sortArchiveRows(matches, sort), [matches, sort]);
  const filtering = isFiltering({ query, tagKeys, matchAll });

  function toggleTag(key: string) {
    const next = tagKeys.includes(key) ? tagKeys.filter((item) => item !== key) : [...tagKeys, key];
    router.replace(tagHref(next), { scroll: false });
  }

  function clearAll() {
    setQuery('');
    router.replace('/music', { scroll: false });
  }

  function toggleFolder(path: FolderPath, open: boolean) {
    setOpenNodes((current) =>
      open ? (current.includes(path) ? current : [...current, path]) : current.filter((item) => item !== path),
    );
  }

  /** Opens a folder and everything above it, so something just filed can be seen. */
  function reveal(path: FolderPath | null) {
    if (path === null) return;

    setOpenNodes((current) => [...new Set([...current, ...folderAncestors(path)])]);
  }

  /** Reads the shelf and the folders again, after anything was filed. */
  function refreshAll() {
    player.refresh();
    void folders.refresh();
  }

  return (
    <section className={PANEL}>
      <div className={TITLE_BAR}>
        <span>DEBASER NETLABEL :: FILE DIRECTORY</span>
        <span>
          [ {tree.paths.length} {pluralise(tree.paths.length, 'FOLDER')} :: {rows.length}{' '}
          {pluralise(rows.length, 'FILE')} ]
        </span>
      </div>

      <div className="p-2">
        {/* The toolbar: what can be made, and the box that finds it. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCreating({ kind: 'file', parent: null })}
            disabled={!signedIn}
            className={PLATE}
            title={signedIn ? 'File a new track in the archive' : 'Filing a track takes an account'}
          >
            [ NEW FILE ]
          </button>

          <button
            type="button"
            onClick={() => setCreating({ kind: 'folder', parent: null })}
            disabled={!signedIn}
            className={PLATE}
            title={signedIn ? 'Make a new folder at the top of the archive' : 'Making a folder takes an account'}
          >
            [ NEW FOLDER ]
          </button>

          <label htmlFor="music-search" className="text-[10px] font-bold text-black">
            FIND:
          </label>
          <input
            id="music-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setTagsOpen(true)}
            placeholder="TRACK, FOLDER, ARTIST OR TAG"
            className="min-w-40 flex-1 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 font-mono text-xs text-black outline-none max-sm:p-2"
          />

          <button type="button" onClick={() => setTagsOpen(!tagsOpen)} aria-expanded={tagsOpen} className={PLATE}>
            {tagsOpen ? '[ FILTER ▴ ]' : '[ FILTER ▾ ]'}
          </button>

          {/* The order the search comes back in: the same three questions the tag window's music tab
              asks (./TagWindow.tsx), answered off the same two facts the board holds - when a file was
              last posted, and how many posts carry it. */}
          <label htmlFor="music-sort" className="text-[10px] font-bold text-black">
            ORDER:
          </label>
          <select
            id="music-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as TrackSort)}
            className="rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 font-mono text-[10px] text-black outline-none max-sm:p-2"
          >
            {TRACK_SORTS.map((entry) => (
              <option key={entry.value} value={entry.value} title={entry.hint}>
                {entry.label}
              </option>
            ))}
          </select>

          <button type="button" onClick={clearAll} disabled={!filtering} className={PLATE}>
            [ CLEAR ]
          </button>

          <button type="button" onClick={refreshAll} className={PLATE}>
            [ REFRESH ]
          </button>
        </div>

        {signedIn ? null : (
          <p className="mt-1 text-[9px] font-bold text-gray-700">
            SIGNED OUT - SIGN IN ON THE ACCOUNT PAGE TO ADD FILES AND FOLDERS. PLAYING TAKES NOTHING.
          </p>
        )}

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

        {filtering ? (
          <p className="mt-2 text-[10px] font-bold text-black">
            {flat.length} OF {rows.length} FILES
          </p>
        ) : null}

        <div className="mt-1 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white">
          {/* The directory's own column labels, and nothing else. */}
          <div
            className={`${ROW_GRID} hidden border-b border-gray-500 bg-[#e8e8e8] px-2 py-1 text-[9px] font-bold text-gray-700 sm:grid`}
          >
            <span>#</span>
            <span>NAME</span>
            <span className="text-right">LENGTH</span>
            <span>TAGS</span>
            <span className="text-right">PLAY :: POST</span>
          </div>

          {filtering ? (
            flat.length === 0 ? (
              <p className="p-2 text-[10px] font-bold text-black">NO MATCHES.</p>
            ) : (
              <ul>
                {flat.map((row, index) => (
                  <FileRow key={row.track.src} row={row} index={index} onPost={setPosting} />
                ))}
              </ul>
            )
          ) : rows.length === 0 && tree.paths.length === 0 ? (
            <p className="p-2 text-[10px] font-bold text-black">
              NOTHING HERE YET. {signedIn ? '[ NEW FILE ] AND [ NEW FOLDER ] MAKE SOMETHING.' : ''}
            </p>
          ) : (
            <ul>
              {tree.root.folders.map((folder) => (
                <FolderBranch
                  key={folder.path}
                  folder={folder}
                  openNodes={openNodes}
                  onToggle={toggleFolder}
                  onCreate={(kind, parent) => setCreating({ kind, parent })}
                  canCreate={signedIn}
                  onPost={setPosting}
                />
              ))}

              {/* Files at the root: what nobody has filed into a folder yet. */}
              {tree.root.files.map((row, index) => (
                <FileRow key={row.track.src} row={row} index={index} onPost={setPosting} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {creating !== null && creating.kind === 'file' ? (
        <NewArchiveFileWindow
          parent={creating.parent}
          folders={tree.paths.map((path) => ({ path }))}
          author={forum.author}
          createFolder={folders.create}
          onClose={() => setCreating(null)}
          onCreated={(track) => {
            setCreating(null);
            reveal(track.folderPath ?? null);
            refreshAll();
            // Open it: filing a file and then having to find it would be a poor sort of browser.
            player.play(track);
          }}
        />
      ) : null}

      {creating !== null && creating.kind === 'folder' ? (
        <NewArchiveFolderWindow
          parent={creating.parent}
          author={forum.author}
          create={folders.create}
          onClose={() => setCreating(null)}
          onCreated={(folder) => {
            setCreating(null);
            reveal(folder.path);
            refreshAll();
          }}
        />
      ) : null}

      {/* The archive's own way onto the board: the composer, with the file already filed, so a track
          somebody is listening to can be written about without a round trip through /forum. */}
      {posting === null ? null : (
        <NewPostForm
          initialTrack={forumTrackFromArchive(posting)}
          onClose={() => setPosting(null)}
        />
      )}
    </section>
  );
}
