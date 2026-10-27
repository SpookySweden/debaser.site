'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { folderLabel, type FolderPath } from '../lib/audio/archive-tree';
import { MUSIC_HREF } from '../lib/audio/music-window';
import { audioTagKey } from '../lib/audio/tags';
import type { AudioTrack } from '../lib/audio/tracks';
import { useArchiveFolders } from '../lib/audio/use-archive-folders';
import { useStreamFolds } from '../lib/watch/use-stream-folds';
import type { StreamFold } from '../lib/watch/types';
import { watchHref } from '../lib/watch/watch-window';
import { KIND_LABELS, MEDIA_KINDS, useCatalogue } from '../lib/media/catalogue';
import { getMediaRepository } from '../lib/media/repository';
import { STORAGE_CEILING_BYTES, formatBytes } from '../lib/media/rules';
import type { CatalogueEntry, MediaItem, MediaKind } from '../lib/media/types';
import { FIELD_TIGHT, PLATE, PLATE_LINK, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import AudioTagChooser from './AudioTagChooser';
import AudioTagPill from './AudioTagPill';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import MediaUploadWindow from './MediaUploadWindow';
import { useMusicLibrary } from './MusicLibraryProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import NewArchiveFileWindow from './NewArchiveFileWindow';
import NewArchiveFolderWindow from './NewArchiveFolderWindow';
import ProfileLink from './ProfileLink';
import SheetImage from './SheetImage';
import StreamChatFolds from './StreamChatFolds';
import TimeStamp from './TimeStamp';

type Tab = 'all' | MediaKind;
type Sort = 'newest' | 'title' | 'used';

const SORT_LABELS: Record<Sort, string> = { newest: 'NEWEST', title: 'TITLE', used: 'MOST USED' };

/** The glyph a row without a picture leads with. */
const KIND_MARKS: Record<MediaKind, string> = { image: '▦', audio: '♪', video: '▶' };

function tabRequested(value: string | null): Tab {
  return value === 'image' || value === 'audio' || value === 'video' ? value : 'all';
}

/** The tag keys the address asks for: `/media?kind=audio&tag=lo-fi`, or `&tag=lo-fi,ambient`. */
function parseTagKeys(wanted: string | null): string[] {
  if (wanted === null || wanted.length === 0) return [];

  return wanted
    .split(',')
    .map((raw) => audioTagKey(raw))
    .filter((key) => key.length > 0);
}

/** A folder as its shelf is titled: the path's own words, `HEXHAM / GRIDLOCK`, without the root's name. */
function shelfName(path: string): string {
  return path.split('/').filter((part) => part.length > 0).join(' / ');
}

/**
 * The profile a track is the song of, if any (Luke, 2026-10-25: tracks uploaded to a profile were all
 * listed as UNFILED). The owner's name is the one the use was recorded with (`SWEDEN'S PROFILE TRACK`),
 * and the version is the profile's own (`<user id>:v2`), which orders the shelf. A track somebody also
 * filed into a folder shows on both shelves (Luke, same day).
 */
function profileShelf({ item, uses }: CatalogueEntry): { owner: string; name: string; version: number } | null {
  if (item.kind !== 'audio') return null;

  const songs = uses
    .filter((use) => use.useKind === 'profile_song')
    .sort((a, b) => a.usedAt.localeCompare(b.usedAt));
  if (songs.length === 0) return null;

  const [owner, versionPart] = songs[0].useId.split(':v');
  const name = songs[0].label.replace(/'S PROFILE TRACK$/i, '').trim();
  return { owner, name: name.length === 0 ? 'SOMEONE' : name.toUpperCase(), version: Number(versionPart) || 0 };
}

/** Whether a profile song was on the site before or besides the profile: filed in a folder, or used elsewhere. */
function hasSource({ item, uses }: CatalogueEntry): boolean {
  return (item.folderPath ?? '').length > 0 || uses.some((use) => use.useKind !== 'profile_song');
}

/** A catalogued track as the player's own kind: the shelf's row when it has one, else from the record. */
function trackFor(item: MediaItem, queue: AudioTrack[]): AudioTrack {
  const onShelf = queue.find((track) => track.src === item.src);
  if (onShelf !== undefined) return onShelf;

  return {
    id: item.path.length === 0 ? item.src : item.path,
    title: item.title,
    credit: item.credit,
    kind: 'FROM THE CATALOGUE',
    src: item.src,
    length: item.length.length === 0 ? '--:--' : item.length,
    tags: item.tags,
    folderPath: item.folderPath ?? null,
    shelf: item.bucket.length === 0 ? 'archive' : 'bucket',
  };
}

/**
 * The media catalogue (SPEC-media-catalogue.md): every file the site holds, by kind, searchable,
 * each row opening onto the file itself and the places it is used.
 *
 * The AUDIO tab is the music archive, in the same shape as the other tabs (Luke, 2026-10-24: the old
 * music window's browser had been dropped onto the page whole, with its own controls, pink folder
 * bands and a different row). The rows are the catalogue's, grouped under a title line per folder
 * with the unfiled files last, and each carries the shelf's two keys - the heart and PLAY (the
 * INJECT key went 2026-10-25, Luke: a track is picked in the composer instead). A signed-in reader files a new track or folder here with the windows the shelf had.
 *
 * The tab lives in the address (`/media?kind=audio`), so the music window's ARCHIVE link, a track's
 * key and a copied address all land on the right shelf; a tag pressed on a track adds `&tag=...`.
 */
export default function MediaCatalogue() {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const forum = useForum();
  const catalogue = useCatalogue();
  const player = useMusicPlayer();
  const library = useMusicLibrary();
  const folders = useArchiveFolders();

  const tab = tabRequested(search.get('kind'));
  const tagKeys = useMemo(() => parseTagKeys(search.get('tag')), [search]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [openId, setOpenId] = useState<string | null>(null);
  /** The PROFILE MUSIC folder (`profile-music`) and the people in it (`profile:<user id>`) that are open. */
  const [openShelves, setOpenShelves] = useState<ReadonlySet<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState<{ kind: 'file' | 'folder'; parent: FolderPath | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const show = useCallback(
    (next: Tab) => {
      router.replace(next === 'all' ? pathname : `${pathname}?kind=${next}`, { scroll: false });
    },
    [pathname, router],
  );

  const filtering = query.trim().length > 0 || tagKeys.length > 0;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const needleKey = audioTagKey(query);

    const matching = catalogue.entries.filter(({ item }) => {
      if (tab !== 'all' && item.kind !== tab) return false;
      if (tagKeys.length > 0 && !item.tags.some((tag) => tagKeys.includes(audioTagKey(tag)))) return false;
      if (needle.length === 0) return true;

      return (
        item.title.toLowerCase().includes(needle) ||
        item.credit.toLowerCase().includes(needle) ||
        item.uploadedByLabel.toLowerCase().includes(needle) ||
        (item.folderPath ?? '').toLowerCase().includes(needle) ||
        item.tags.some((tag) => audioTagKey(tag) === needleKey || tag.toLowerCase().includes(needle))
      );
    });

    return [...matching].sort((a, b) => {
      if (sort === 'title') return a.item.title.localeCompare(b.item.title);
      if (sort === 'used') return b.uses.length - a.uses.length || b.item.createdAt.localeCompare(a.item.createdAt);
      return b.item.createdAt.localeCompare(a.item.createdAt);
    });
  }, [catalogue.entries, tab, query, tagKeys, sort]);

  /** Every stream that played a video, for the STREAM CHAT folds under each (SPEC-watch-together.md). */
  const videoIds = useMemo(() => catalogue.entries.filter(({ item }) => item.kind === 'video').map(({ item }) => item.id), [catalogue.entries]);
  const streamFolds = useStreamFolds(videoIds);

  const counts = useMemo(() => {
    const byKind: Record<Tab, number> = { all: catalogue.entries.length, image: 0, audio: 0, video: 0 };
    for (const { item } of catalogue.entries) byKind[item.kind] += 1;
    return byKind;
  }, [catalogue.entries]);

  /**
   * The AUDIO tab's shelves: one group per folder, A to Z, with the folders somebody made but has not
   * filed anything into yet, then one shelf per profile for the tracks that are somebody's profile song
   * (drawn inside the one PROFILE MUSIC folder, numbered 1, 2, 3 in the order the profile used them; one
   * also filed in a folder shows there too), and the rest of the unfiled files last. A search or a tag flattens the list, as it does on every other
   * tab, because a match is what the reader asked for and its folder is a detail.
   */
  const groups = useMemo(() => {
    if (tab !== 'audio' || filtering) return null;

    const byFolder = new Map<string, CatalogueEntry[]>();
    const byProfile = new Map<string, { name: string; songs: { version: number; entry: CatalogueEntry }[] }>();
    for (const folder of folders.folders) byFolder.set(folder.path, []);
    for (const entry of shown) {
      const profile = profileShelf(entry);
      if (profile !== null) {
        const shelf = byProfile.get(profile.owner) ?? { name: profile.name, songs: [] };
        shelf.songs.push({ version: profile.version, entry });
        byProfile.set(profile.owner, shelf);
        if ((entry.item.folderPath ?? '').length === 0) continue;
      }
      const key = entry.item.folderPath ?? '';
      byFolder.set(key, [...(byFolder.get(key) ?? []), entry]);
    }

    const unfiled = byFolder.get('') ?? [];
    byFolder.delete('');

    // A folder that only holds other folders is a path, not a shelf: `HEXHAM` with everything under
    // `HEXHAM / GRIDLOCK` would be a line saying EMPTY over the shelf that is not. A folder somebody
    // made and has put nothing in at all still shows, so they can find it and file into it.
    const paths = [...byFolder.keys()];
    const named = [...byFolder.entries()]
      .filter(([path, entries]) => entries.length > 0 || !paths.some((other) => other.startsWith(`${path}/`)))
      .sort(([a], [b]) => a.localeCompare(b));
    const profiles = [...byProfile.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name));

    return [
      ...named.map(([path, entries]) => ({ key: path, title: shelfName(path), path: path as string | null, entries, numbered: false })),
      ...profiles.map(([owner, shelf]) => ({
        key: `profile:${owner}`,
        title: shelf.name,
        path: null,
        entries: shelf.songs.sort((a, b) => a.version - b.version).map((song) => song.entry),
        numbered: true,
      })),
      { key: '', title: 'UNFILED', path: null, entries: unfiled, numbered: false },
    ];
  }, [tab, filtering, shown, folders.folders]);

  const share = Math.min(1, catalogue.bytesUsed / STORAGE_CEILING_BYTES);

  /** Hearts or un-hearts a track, saying why when it cannot. */
  async function toggleLike(track: AudioTrack) {
    try {
      const { liked } = await library.toggleLike(track.id);
      setNotice(liked ? `LIKED :: ${track.title}` : `UNLIKED :: ${track.title}`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'THAT COULD NOT BE LIKED.');
    }
  }

  /** Opens a folder that is shut, or shuts it. */
  const toggleShelf = (key: string) =>
    setOpenShelves((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /** A folder's shelf: its title line, then its files, or EMPTY. */
  const shelfFor = (group: NonNullable<typeof groups>[number]) => (
    <section key={group.key} aria-label={group.key.length === 0 ? 'Unfiled tracks' : group.title} className="mt-3">
      {/* The folder, as a title line: the name between two rules, the count and the key at
          the right end, the way every section inside a window is titled. */}
      <div className={TITLE_BAR}>
        <span>{group.title}</span>
        <span className="text-label text-ink">
          {group.entries.length} FILE{group.entries.length === 1 ? '' : 'S'}
          {user === null || group.path === null ? null : (
            <button
              type="button"
              onClick={() => setCreating({ kind: 'file', parent: group.path })}
              className={`${PLATE} ml-2`}
            >
              [ + FILE ]
            </button>
          )}
        </span>
      </div>
      {group.entries.length === 0 ? (
        <p className="text-label text-ink-quiet">EMPTY.</p>
      ) : (
        <ul aria-label="Files">{group.entries.map((entry) => rowFor(entry, { key: group.key, source: false }))}</ul>
      )}
    </section>
  );

  /**
   * The people whose profile songs are on the shelf, as one folder that opens onto a line per person,
   * A to Z, each of which opens onto their songs, numbered (Luke, 2026-10-25). Both start shut.
   */
  const profileFolder = (people: NonNullable<typeof groups>) => {
    if (people.length === 0) return null;
    const open = openShelves.has('profile-music');

    return (
      <section key="profile-music" aria-label="Profile music" className="mt-3">
        <div className={TITLE_BAR}>
          <button type="button" onClick={() => toggleShelf('profile-music')} aria-expanded={open} className="cursor-pointer hover:underline">
            {open ? '[-]' : '[+]'} PROFILE MUSIC
          </button>
          <span className="text-label text-ink">
            {people.length} {people.length === 1 ? 'PERSON' : 'PEOPLE'}
          </span>
        </div>
        {open
          ? people.map((person) => {
              const personOpen = openShelves.has(person.key);
              return (
                <section key={person.key} aria-label={`Profile music: ${person.title}`} className="mt-1 pl-4">
                  <div className={TITLE_BAR}>
                    <button
                      type="button"
                      onClick={() => toggleShelf(person.key)}
                      aria-expanded={personOpen}
                      className="cursor-pointer hover:underline"
                    >
                      {personOpen ? '[-]' : '[+]'} {person.title}
                    </button>
                    <span className="text-label text-ink">
                      {person.entries.length} FILE{person.entries.length === 1 ? '' : 'S'}
                    </span>
                  </div>
                  {personOpen ? (
                    <ul aria-label="Files">
                      {person.entries.map((entry, index) => rowFor(entry, { key: person.key, number: index + 1, source: hasSource(entry) }))}
                    </ul>
                  ) : null}
                </section>
              );
            })
          : null}
      </section>
    );
  };

  const rowFor = (entry: CatalogueEntry, shelf?: { key: string; number?: number; source: boolean }) => {
    const rowId = `${shelf?.key ?? ''}|${entry.item.id}`;
    const track = entry.item.kind === 'audio' ? trackFor(entry.item, player.queue) : undefined;

    return (
      <CatalogueRow
        key={entry.item.id}
        entry={entry}
        number={shelf?.number}
        source={shelf?.source ?? false}
        open={openId === rowId}
        onToggle={() => setOpenId((current) => (current === rowId ? null : rowId))}
        viewerId={user?.id ?? null}
        onChanged={(message) => {
          setNotice(message);
          catalogue.reload();
        }}
        track={track}
        liked={track === undefined ? false : library.likedIds.has(track.id)}
        onLike={library.canWrite ? (candidate) => void toggleLike(candidate) : undefined}
        onPlay={(candidate) => player.play(candidate, { origin: 'shelf', href: MUSIC_HREF, where: 'THE MEDIA PAGE' })}
        folds={entry.item.kind === 'video' ? streamFolds[entry.item.id] : undefined}
      />
    );
  };

  return (
    <section aria-label="Media catalogue">
      {/* The tabs, and the one main key: filing. A guest sees why there is none. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Kinds of file">
          {(['all', ...MEDIA_KINDS] as Tab[]).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              onClick={() => show(option)}
              className={tab === option ? PLATE_PRESSED : PLATE}
            >
              [ {option === 'all' ? 'ALL' : KIND_LABELS[option]} {counts[option]} ]
            </button>
          ))}
        </div>

        {user === null ? (
          <span className="text-label font-bold text-ink-quiet">
            <Link href="/account" className={PLATE_LINK}>
              [ LOG IN ]
            </Link>{' '}
            TO FILE
          </span>
        ) : tab === 'audio' ? (
          /* The shelf's own two ways of adding something, in the place the other tabs keep UPLOAD. */
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setCreating({ kind: 'folder', parent: null })} className={PLATE}>
              [ + NEW FOLDER ]
            </button>
            <button type="button" onClick={() => setCreating({ kind: 'file', parent: null })} className={PLATE_MAIN}>
              + NEW FILE
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setUploading(true)} className={PLATE_MAIN}>
            + UPLOAD
          </button>
        )}
      </div>

      {/* How full the catalogue is: the free tier's ceiling is the one number that decides whether
          video can keep being filed (SPEC-media-catalogue.md, risks). Sheets ship with the site and
          count nothing. */}
      <p
        className="mt-1 text-label font-bold text-ink-quiet"
        title="Past 80%, video is refused."
      >
        CATALOGUE: {formatBytes(catalogue.bytesUsed)} OF {formatBytes(STORAGE_CEILING_BYTES)} ({Math.round(share * 100)}%)
      </p>

      {notice === null ? null : (
        <p className="mt-1 w-fit text-label font-bold text-ink" role="status">
          OK: {notice}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor="media-search" className="sr-only">
          Search the catalogue
        </label>
        <input
          id="media-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Title, credit, tag..."
          className={`${FIELD_TIGHT} min-w-0 flex-1`}
        />
        <label htmlFor="media-sort" className="text-label font-bold text-ink">
          SORT:
        </label>
        <select id="media-sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)} className={FIELD_TIGHT}>
          {(Object.keys(SORT_LABELS) as Sort[]).map((option) => (
            <option key={option} value={option}>
              {SORT_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      {/* A tag pressed on a track filters the list, and says so where the filter can be dropped. */}
      {tagKeys.length === 0 ? null : (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-label font-bold text-ink">
          <span>TAGGED {tagKeys.map((key) => key.toUpperCase()).join(', ')}:</span>
          <span>
            {shown.length} FILE{shown.length === 1 ? '' : 'S'}
          </span>
          <Link href={`${pathname}?kind=${tab === 'all' ? 'audio' : tab}`} className={PLATE}>
            [ CLEAR ]
          </Link>
        </p>
      )}

      {!catalogue.answered ? (
        <p className="mt-3 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          CATALOGUE OFFLINE - SHOWING BUILT-IN FILES ONLY.
        </p>
      ) : null}

      {catalogue.loading ? (
        <p className="mt-3 text-label font-bold text-ink">READING THE CATALOGUE...</p>
      ) : groups !== null ? (
        groups.every((group) => group.entries.length === 0) ? (
          <p className="mt-3 text-label font-bold text-ink">
            NOTHING FILED HERE YET.
          </p>
        ) : (
          <>
            {groups.filter((group) => !group.numbered && group.key.length > 0).map(shelfFor)}
            {profileFolder(groups.filter((group) => group.numbered))}
            {groups.filter((group) => group.key.length === 0).map(shelfFor)}
          </>
        )
      ) : shown.length === 0 ? (
        <p className="mt-3 text-label font-bold text-ink">{filtering ? 'NO FILE MATCHES.' : 'NOTHING FILED HERE YET.'}</p>
      ) : (
        <ul className="mt-2" aria-label="Files">
          {shown.map((entry) => rowFor(entry))}
        </ul>
      )}

      {uploading ? (
        <MediaUploadWindow
          uploader={user === null ? null : { id: user.id, displayName: user.displayName }}
          items={catalogue.items}
          bytesUsed={catalogue.bytesUsed}
          onClose={() => setUploading(false)}
          onFiled={(item, note) => {
            setUploading(false);
            setNotice(note);
            setOpenId(`|${item.id}`);
            catalogue.reload();
            if (tab !== 'all' && tab !== item.kind) show(item.kind);
          }}
          onAudioWanted={() => {
            setUploading(false);
            show('audio');
            if (user !== null) setCreating({ kind: 'file', parent: null });
          }}
        />
      ) : null}

      {creating !== null && creating.kind === 'file' ? (
        <NewArchiveFileWindow
          parent={creating.parent}
          folders={folders.folders.map((folder) => ({ path: folder.path }))}
          author={forum.author}
          createFolder={folders.create}
          onClose={() => setCreating(null)}
          onCreated={(track) => {
            setCreating(null);
            player.refresh();
            folders.refresh();
            catalogue.reload();
            setNotice(`FILED :: ${track.title}`);
            // Open it: filing a file and then having to find it would be a poor sort of shelf.
            player.play(track, { origin: 'shelf', href: MUSIC_HREF, where: 'THE MEDIA PAGE' });
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
            folders.refresh();
            setNotice(`FOLDER MADE :: ${folderLabel(folder.path)}`);
          }}
        />
      ) : null}
    </section>
  );
}

/** One file: the row, and under it when opened, the file itself and the places it is used. */
function CatalogueRow({
  entry,
  number,
  source,
  open,
  onToggle,
  viewerId,
  onChanged,
  track,
  liked,
  onLike,
  onPlay,
  folds,
}: {
  entry: CatalogueEntry;
  /** Its place on a numbered shelf (a profile's songs: 1, 2, 3); undefined on every other shelf. */
  number?: number;
  /** A profile song that was on the site already: its row ends in a key to where it came from. */
  source: boolean;
  open: boolean;
  onToggle: () => void;
  viewerId: string | null;
  onChanged: (message: string) => void;
  /** The player's own record of an audio row; undefined for a picture or a video. */
  track?: AudioTrack;
  liked: boolean;
  /** Hearts the track; undefined for a guest, who is offered the heart's state but not the press. */
  onLike?: (track: AudioTrack) => void;
  onPlay: (track: AudioTrack) => void;
  /** A video's streams, for its STREAM CHAT folds; undefined for anything never streamed. */
  folds?: StreamFold[];
}) {
  const { item, uses } = entry;
  const [editing, setEditing] = useState(false);
  const canEdit = viewerId !== null && item.uploadedBy === viewerId && item.source !== 'sheet';

  return (
    <li className="rule-pixel py-2">
      {/* `flex-wrap` for the phone: a track's keys drop to their own line under the words there,
          rather than squeezing the title to a word a line beside them. */}
      <div className="flex flex-wrap items-start gap-2">
        {/* The picture itself, small; a glyph for sound and video, which have no face. */}
        {item.kind === 'image' ? (
          <button type="button" onClick={onToggle} className="shrink-0 cursor-pointer" title={open ? 'Close' : 'Open'}>
            <span className="block w-12 rounded-none border border-ink bg-paper">
              <SheetImage src={item.src} alt={item.title} width={item.width ?? 48} height={item.height ?? 48} sizes="48px" compact />
            </span>
          </button>
        ) : (
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center border border-ink bg-paper text-key font-bold text-ink" aria-hidden="true">
            {KIND_MARKS[item.kind]}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <button type="button" onClick={onToggle} className="min-w-0 cursor-pointer text-left text-sm font-bold text-ink hover:underline">
              {open ? '[-]' : '[+]'} {number === undefined ? null : <span className="mr-1">{number}</span>} {item.title}
            </button>
            <span className="text-label font-bold text-ink-quiet">{KIND_LABELS[item.kind]}</span>
            {item.length.length === 0 ? null : <span className="text-label text-ink">{item.length}</span>}
            {item.bytes === 0 ? null : <span className="text-label text-ink">{formatBytes(item.bytes)}</span>}
            <span className="text-label font-bold text-ink">
              {uses.length === 0 ? 'NOT USED YET' : `IN ${uses.length} PLACE${uses.length === 1 ? '' : 'S'}`}
            </span>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink">
            {item.credit.length === 0 ? null : <span>CREDIT: {item.credit}</span>}
            <span>
              FILED BY{' '}
              <ProfileLink author={{ id: item.uploadedBy, displayName: item.uploadedByLabel }} className="font-bold" />{' '}
              <TimeStamp at={item.createdAt} />
            </span>
            {item.tags.map((tag) => (
              <AudioTagPill key={tag} tag={tag} compact />
            ))}
          </div>
        </div>

        {/* A video's key: stream it to the site (SPEC-watch-together.md). It opens the room window
            before anything is live; GO LIVE in there is the second press. Accounts only. */}
        {item.kind === 'video' && viewerId !== null ? (
          <span className="flex shrink-0 items-center justify-end gap-1 max-sm:w-full max-sm:justify-start max-sm:pl-14">
            <Link href={watchHref({ kind: 'prelive', mediaItemId: item.id })} className={PLATE_LINK}>
              [ ▶ STREAM ]
            </Link>
          </span>
        ) : null}

        {/* A track's two keys, the shelf's own: the heart, and play through the site's one player.
            Writing about a track starts in the composer, which picks it there. */}
        {track === undefined ? null : (
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-1 max-sm:w-full max-sm:justify-start max-sm:pl-14">
            <button
              type="button"
              onClick={onLike === undefined ? undefined : () => onLike(track)}
              disabled={onLike === undefined}
              aria-pressed={liked}
              className={PLATE}
              title={onLike === undefined ? 'Log in to like' : liked ? `Unlike ${track.title}` : `Like ${track.title}`}
            >
              {liked ? '♥' : '♡'}
            </button>
            <button type="button" onClick={() => onPlay(track)} className={PLATE}>
              [ ▶ PLAY ]
            </button>
            {source ? (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className={open ? PLATE_PRESSED : PLATE}
              >
                [ SOURCE ]
              </button>
            ) : null}
          </span>
        )}
      </div>

      {item.kind === 'video' ? <StreamChatFolds folds={folds} /> : null}

      {open ? (
        <div className="mt-2 pl-14 max-sm:pl-0">
          {item.kind === 'image' ? (
            <div className="max-w-md rounded-none border border-ink bg-paper">
              <SheetImage src={item.src} alt={item.title} width={item.width ?? 352} height={item.height ?? 352} sizes="(max-width: 640px) 90vw, 448px" />
            </div>
          ) : null}

          {item.kind === 'video' ? (
            /* A plain player: what was uploaded is what plays (SPEC-media-catalogue.md, out of scope:
               transcoding). */
            <video controls preload="metadata" src={item.src} className="w-full max-w-md rounded-none border border-ink bg-ink-plate">
              <track kind="captions" />
            </video>
          ) : null}

          <p className="mt-1 text-label text-ink-quiet wrap-anywhere">
            {item.width !== undefined && item.height !== undefined ? `${item.width}x${item.height} :: ` : ''}
            {item.folderPath ? `${shelfName(item.folderPath)} :: ` : ''}
            {item.mime.length === 0 ? '' : `${item.mime} :: `}
            <a href={item.src} className="underline decoration-dotted hover:bg-ice" target="_blank" rel="noreferrer">
              OPEN
            </a>
          </p>

          {source ? (
            <>
              <p className={`${TITLE_BAR} mt-2`}>SOURCE</p>
              <p className="text-label text-ink">
                {item.folderPath ? (
                  <>
                    FILED IN <span className="font-bold">{shelfName(item.folderPath)}</span> BY{' '}
                  </>
                ) : (
                  'FILED BY '
                )}
                <ProfileLink author={{ id: item.uploadedBy, displayName: item.uploadedByLabel }} className="font-bold" />{' '}
                <TimeStamp at={item.createdAt} />
              </p>
            </>
          ) : null}

          <p className={`${TITLE_BAR} mt-2`}>WHERE IT IS USED</p>
          {uses.length === 0 ? (
            <p className="text-label font-bold text-ink">
              NOWHERE YET.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {uses.map((use) => (
                <li key={use.id} className="text-label">
                  <Link href={use.href} className="font-bold underline decoration-dotted hover:bg-ice">
                    {use.label}
                  </Link>{' '}
                  <span className="text-ink-quiet">
                    {use.useKind.replace('_', ' ').toUpperCase()} :: <TimeStamp at={use.usedAt} />
                  </span>
                </li>
              ))}
            </ul>
          )}

          {canEdit ? (
            editing ? (
              <EditItemForm item={item} onClose={() => setEditing(false)} onSaved={(message) => { setEditing(false); onChanged(message); }} />
            ) : (
              <button type="button" onClick={() => setEditing(true)} className={`${PLATE} mt-2`}>
                [ EDIT ]
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Title, credit and tags: the three things an uploader may change after filing. */
function EditItemForm({ item, onClose, onSaved }: { item: MediaItem; onClose: () => void; onSaved: (message: string) => void }) {
  const [title, setTitle] = useState(item.title);
  const [credit, setCredit] = useState(item.credit);
  const [tags, setTags] = useState<string[]>(item.tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (title.trim().length === 0) {
      setError('THE FILE NEEDS A TITLE.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await getMediaRepository().updateItem(item.id, { title, credit, tags });
      onSaved('SAVED');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THE CHANGE WAS REFUSED.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={`edit-title-${item.id}`} className="block text-label font-bold text-ink">
        TITLE
      </label>
      <input id={`edit-title-${item.id}`} value={title} onChange={(event) => setTitle(event.target.value)} className={`${FIELD_TIGHT} mt-1 w-full`} />
      <label htmlFor={`edit-credit-${item.id}`} className="mt-2 block text-label font-bold text-ink">
        CREDITED TO
      </label>
      <input id={`edit-credit-${item.id}`} value={credit} onChange={(event) => setCredit(event.target.value)} className={`${FIELD_TIGHT} mt-1 w-full`} />
      <AudioTagChooser id={`edit-tags-${item.id}`} value={tags} onChange={setTags} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className={PLATE_MAIN}>
          {busy ? '[ SAVING... ]' : '[ SAVE ]'}
        </button>
        <button type="button" onClick={onClose} className={PLATE}>
          [ CANCEL ]
        </button>
        {error === null ? null : <span className="bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</span>}
      </div>
    </form>
  );
}
