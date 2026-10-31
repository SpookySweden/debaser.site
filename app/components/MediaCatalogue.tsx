'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';
import { folderLabel, type FolderPath } from '../lib/audio/archive-tree';
import { MUSIC_HREF } from '../lib/audio/music-window';
import { audioTagKey } from '../lib/audio/tags';
import type { AudioTrack } from '../lib/audio/tracks';
import { useArchiveFolders } from '../lib/audio/use-archive-folders';
import { useStreamFolds } from '../lib/watch/use-stream-folds';
import type { StreamFold } from '../lib/watch/types';
import { watchHref } from '../lib/watch/watch-window';
import { KIND_LABELS, useCatalogue } from '../lib/media/catalogue';
import { type Category, SECTIONS, categorise, categoryWords, folderCategoryId, groupMatches, tagCounts } from '../lib/media/categories';
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

type Sort = 'newest' | 'title' | 'used';

const SORT_LABELS: Record<Sort, string> = { newest: 'NEWEST', title: 'TITLE', used: 'MOST USED' };

/** The glyph a row without a picture leads with. */
const KIND_MARKS: Record<MediaKind, string> = { image: '▦', audio: '♪', video: '▶' };

/** The section the address asks for (`/media?kind=audio`), or null for the front page. */
function kindRequested(value: string | null): MediaKind | null {
  return value === 'image' || value === 'audio' || value === 'video' ? value : null;
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

/** Each person whose profile songs are on the shelf, A to Z, with their songs in the order they used them. */
function profilePeople(entries: CatalogueEntry[]): { key: string; title: string; entries: CatalogueEntry[] }[] {
  const byOwner = new Map<string, { name: string; songs: { version: number; entry: CatalogueEntry }[] }>();
  for (const entry of entries) {
    const profile = profileShelf(entry);
    if (profile === null) continue;
    const shelf = byOwner.get(profile.owner) ?? { name: profile.name, songs: [] };
    shelf.songs.push({ version: profile.version, entry });
    byOwner.set(profile.owner, shelf);
  }

  return [...byOwner.entries()]
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([owner, shelf]) => ({
      key: `profile:${owner}`,
      title: shelf.name,
      entries: shelf.songs.sort((a, b) => a.version - b.version).map((song) => song.entry),
    }));
}

const fileCount = (count: number) => `${count} FILE${count === 1 ? '' : 'S'}`;

/**
 * The media catalogue (SPEC-media-catalogue.md): every file the site holds, searchable, each row opening
 * onto the file itself and the places it is used.
 *
 * It opens on categories, not files (Luke, 2026-10-31: "everything needs to be collapsed and organised").
 * The front page is the categories as keys under PICTURES / MUSIC / VIDEO, then every tag in use;
 * nothing is listed until one is pressed. The categories are worked out from each file
 * (`lib/media/categories.ts`), so nobody has to file anything for this.
 *
 * Where the reader is lives in the address, so the back key works and a link lands in the right place:
 * `?cat=<id>` is one category, `?kind=audio` one section with its categories folded (the music window's
 * ARCHIVE link still lands on the music), `?tag=lo-fi` every file wearing the tag. A search covers
 * everything and lists its matches under their categories, wherever the reader is standing.
 */
export default function MediaCatalogue() {
  const search = useSearchParams();
  const pathname = usePathname();
  const { user } = useAuth();
  const forum = useForum();
  const catalogue = useCatalogue();
  const player = useMusicPlayer();
  const library = useMusicLibrary();
  const folders = useArchiveFolders();

  const kind = kindRequested(search.get('kind'));
  const categoryId = search.get('cat');
  const tagKeys = useMemo(() => parseTagKeys(search.get('tag')), [search]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [openId, setOpenId] = useState<string | null>(null);
  /** The folds that are open: categories (`cat:<id>`), sub-folders (`folder:<path>`), people (`profile:<id>`). */
  const [openShelves, setOpenShelves] = useState<ReadonlySet<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState<{ kind: 'file' | 'folder'; parent: FolderPath | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const searching = query.trim().length > 0;

  const sorted = useMemo(
    () =>
      [...catalogue.entries].sort((a, b) => {
        if (sort === 'title') return a.item.title.localeCompare(b.item.title);
        if (sort === 'used') return b.uses.length - a.uses.length || b.item.createdAt.localeCompare(a.item.createdAt);
        return b.item.createdAt.localeCompare(a.item.createdAt);
      }),
    [catalogue.entries, sort],
  );

  const folderPaths = useMemo(() => folders.folders.map((folder) => folder.path), [folders.folders]);
  const categories = useMemo(() => categorise(sorted, folderPaths), [sorted, folderPaths]);
  const tags = useMemo(() => tagCounts(catalogue.entries, audioTagKey), [catalogue.entries]);

  /** A search or a tag: the matches, grouped under their categories. Null when neither is asked for. */
  const matches = useMemo(() => {
    if (!searching && tagKeys.length === 0) return null;

    const needle = query.trim().toLowerCase();
    const needleKey = audioTagKey(query);
    const found = sorted.filter((entry) => {
      const { item } = entry;
      if (tagKeys.length > 0 && !item.tags.some((tag) => tagKeys.includes(audioTagKey(tag)))) return false;
      if (needle.length === 0) return true;

      return (
        item.title.toLowerCase().includes(needle) ||
        item.credit.toLowerCase().includes(needle) ||
        item.uploadedByLabel.toLowerCase().includes(needle) ||
        (item.folderPath ?? '').toLowerCase().includes(needle) ||
        categoryWords(entry).includes(needle) ||
        item.tags.some((tag) => audioTagKey(tag) === needleKey || tag.toLowerCase().includes(needle))
      );
    });

    return { count: found.length, groups: groupMatches(found, categories) };
  }, [searching, tagKeys, query, sorted, categories]);

  /** Every stream that played a video, for the STREAM CHAT folds under each (SPEC-watch-together.md). */
  const videoIds = useMemo(() => catalogue.entries.filter(({ item }) => item.kind === 'video').map(({ item }) => item.id), [catalogue.entries]);
  const streamFolds = useStreamFolds(videoIds);

  // A music folder's address is its own name, so one not found yet (the folder list still loading, or
  // nothing filed in it) is shown empty rather than NOT FOUND.
  const category: Category | undefined =
    categoryId === null
      ? undefined
      : (categories.find((candidate) => candidate.id === categoryId) ??
        (categoryId.startsWith(folderCategoryId('')) && categoryId.length > folderCategoryId('').length
          ? { id: categoryId, kind: 'audio', label: categoryId.slice(folderCategoryId('').length), entries: [], folderPath: categoryId.slice(folderCategoryId('').length) }
          : undefined));
  /** The music is being looked at: the shelf's own keys (new folder, new file) take UPLOAD's place. */
  const onMusic = kind === 'audio' || category?.kind === 'audio';

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

  /** Opens a fold that is shut, or shuts it. */
  const toggleShelf = (key: string) =>
    setOpenShelves((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

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

  const rows = (entries: CatalogueEntry[], key: string) =>
    entries.length === 0 ? (
      <p className="text-label text-ink-quiet">EMPTY.</p>
    ) : (
      <ul aria-label="Files">{entries.map((entry) => rowFor(entry, { key, source: false }))}</ul>
    );

  /** A fold: a title line whose name opens and shuts what is under it. Starts shut. */
  const fold = (key: string, title: string, count: string, body: () => ReactNode, extra?: ReactNode) => {
    const open = openShelves.has(key);
    return (
      <section key={key} aria-label={title} className="mt-1">
        <div className={TITLE_BAR}>
          <button type="button" onClick={() => toggleShelf(key)} aria-expanded={open} className="cursor-pointer text-left hover:underline max-sm:min-h-tap">
            {open ? '[-]' : '[+]'} {title}
          </button>
          <span className="text-label text-ink">
            {count}
            {extra}
          </span>
        </div>
        {open ? <div className="pl-4 max-sm:pl-2">{body()}</div> : null}
      </section>
    );
  };

  /** `[ + FILE ]` into a music folder, for an account. */
  const fileInto = (path: string) =>
    user === null ? null : (
      <button type="button" onClick={() => setCreating({ kind: 'file', parent: path })} className={`${PLATE} ml-2`}>
        [ + FILE ]
      </button>
    );

  /**
   * What a category holds. A music folder: its own files, then each folder inside it folded. Profile
   * music: a fold per person, their songs numbered in the order the profile used them. Anything else:
   * its files.
   */
  const contents = (shown: Category) => {
    if (shown.id === 'music-profile') {
      return profilePeople(shown.entries).map((person) =>
        fold(person.key, person.title, fileCount(person.entries.length), () => (
          <ul aria-label="Files">
            {person.entries.map((entry, index) => rowFor(entry, { key: person.key, number: index + 1, source: hasSource(entry) }))}
          </ul>
        )),
      );
    }

    if (shown.folderPath !== undefined) {
      const top = shown.folderPath;
      const inner = new Set<string>();
      for (const path of folderPaths) if (path.startsWith(`${top}/`)) inner.add(path);
      for (const { item } of shown.entries) if ((item.folderPath ?? '').startsWith(`${top}/`)) inner.add(item.folderPath ?? '');
      const own = shown.entries.filter(({ item }) => item.folderPath === top);

      return (
        <>
          {own.length > 0 || inner.size === 0 ? rows(own, top) : null}
          {[...inner]
            .sort((a, b) => a.localeCompare(b))
            .map((path) => {
              const held = shown.entries.filter(({ item }) => item.folderPath === path);
              // A folder that only holds other folders is a path, not a shelf: a line saying 0 FILES over
              // the shelf that is not empty. One that holds nothing at all still shows, to file into.
              if (held.length === 0 && [...inner].some((other) => other.startsWith(`${path}/`))) return null;
              return fold(`folder:${path}`, shelfName(path.slice(top.length + 1)), fileCount(held.length), () => rows(held, path), fileInto(path));
            })}
        </>
      );
    }

    return rows(shown.entries, shown.id);
  };

  /** The way back to the front page, and the title of what is open. */
  const header = (title: string, count: string, extra?: ReactNode) => (
    <>
      <Link href={pathname} className={`${PLATE_LINK} mt-3 inline-block`}>
        [ ← ALL CATEGORIES ]
      </Link>
      <div className={`${TITLE_BAR} mt-1`}>
        <h2>{title}</h2>
        <span className="text-label text-ink">
          {count}
          {extra}
        </span>
      </div>
    </>
  );

  /** The front page: the categories as keys under their sections, then the tags. */
  const frontPage = () => (
    <>
      {SECTIONS.map((section) => {
        const inSection = categories.filter((candidate) => candidate.kind === section.kind);
        if (inSection.length === 0) return null;
        const total = catalogue.entries.filter(({ item }) => item.kind === section.kind).length;

        return (
          <section key={section.kind} aria-label={section.label} className="mt-3">
            <div className={TITLE_BAR}>
              <h2>{section.label}</h2>
              <Link href={`${pathname}?kind=${section.kind}`} className={PLATE_LINK}>
                [ ALL {total} ]
              </Link>
            </div>
            <ul className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3" aria-label={`${section.label} categories`}>
              {inSection.map((candidate) => (
                <li key={candidate.id} className="min-w-0">
                  <Link
                    href={`${pathname}?cat=${encodeURIComponent(candidate.id)}`}
                    className={`${PLATE_LINK} block w-full text-left wrap-anywhere`}
                  >
                    [ {candidate.label} ({candidate.entries.length}) ]
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section aria-label="Tags" className="mt-3">
        <div className={TITLE_BAR}>
          <h2>TAGS</h2>
        </div>
        {tags.length === 0 ? (
          <p className="text-label text-ink-quiet">NO TAGS YET.</p>
        ) : (
          <p className="mt-1 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <AudioTagPill key={tag.key} tag={tag.tag} count={tag.count} />
            ))}
          </p>
        )}
      </section>
    </>
  );

  const body = () => {
    if (catalogue.loading) return <p className="mt-3 text-label font-bold text-ink">READING THE CATALOGUE...</p>;

    if (matches !== null) {
      return (
        <>
          {tagKeys.length === 0 ? null : (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-label font-bold text-ink">
              <span>TAGGED {tagKeys.map((key) => key.toUpperCase()).join(', ')}:</span>
              <span>{fileCount(matches.count)}</span>
              <Link href={pathname} className={PLATE}>
                [ CLEAR ]
              </Link>
            </p>
          )}
          {matches.groups.length === 0 ? (
            <p className="mt-3 text-label font-bold text-ink">NO FILE MATCHES.</p>
          ) : (
            matches.groups.map((group) => (
              <section key={group.id} aria-label={group.label} className="mt-3">
                <div className={TITLE_BAR}>
                  <h2>{group.label}</h2>
                  <span className="text-label text-ink">{fileCount(group.entries.length)}</span>
                </div>
                <ul aria-label="Files">{group.entries.map((entry) => rowFor(entry))}</ul>
              </section>
            ))
          )}
        </>
      );
    }

    if (categoryId !== null) {
      if (category === undefined) {
        return (
          <>
            {header('NOT FOUND', '')}
            <p className="text-label font-bold text-ink">NOTHING FILED HERE.</p>
          </>
        );
      }

      return (
        <section aria-label={category.label}>
          {header(category.label, fileCount(category.entries.length), category.folderPath === undefined ? null : fileInto(category.folderPath))}
          {contents(category)}
        </section>
      );
    }

    if (kind !== null) {
      const section = SECTIONS.find((candidate) => candidate.kind === kind);
      const inSection = categories.filter((candidate) => candidate.kind === kind);
      const total = catalogue.entries.filter(({ item }) => item.kind === kind).length;

      return (
        <section aria-label={section?.label}>
          {header(section?.label ?? '', fileCount(total))}
          {inSection.length === 0 ? (
            <p className="text-label font-bold text-ink">NOTHING FILED HERE YET.</p>
          ) : (
            inSection.map((candidate) =>
              fold(
                `cat:${candidate.id}`,
                candidate.label,
                fileCount(candidate.entries.length),
                () => contents(candidate),
                candidate.folderPath === undefined ? null : fileInto(candidate.folderPath),
              ),
            )
          )}
        </section>
      );
    }

    return catalogue.entries.length === 0 && categories.length === 0 ? (
      <p className="mt-3 text-label font-bold text-ink">NOTHING FILED HERE YET.</p>
    ) : (
      frontPage()
    );
  };

  return (
    <section aria-label="Media catalogue">
      {/* The search first: it covers everything, wherever the reader is. Then the one main key: filing.
          A guest sees why there is none. */}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="media-search" className="sr-only">
          Search the catalogue
        </label>
        <input
          id="media-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search everything..."
          className={`${FIELD_TIGHT} min-w-0 flex-1 max-sm:basis-full`}
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

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {/* How full the catalogue is: the free tier's ceiling is the one number that decides whether
            video can keep being filed (SPEC-media-catalogue.md, risks). Sheets ship with the site and
            count nothing. */}
        <p className="text-label font-bold text-ink-quiet" title="Past 80%, video is refused.">
          CATALOGUE: {formatBytes(catalogue.bytesUsed)} OF {formatBytes(STORAGE_CEILING_BYTES)} ({Math.round(share * 100)}%)
        </p>

        {user === null ? (
          <span className="text-label font-bold text-ink-quiet">
            <Link href="/account" className={PLATE_LINK}>
              [ LOG IN ]
            </Link>{' '}
            TO FILE
          </span>
        ) : onMusic ? (
          /* The shelf's own two ways of adding something, in the place the other screens keep UPLOAD. */
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setCreating({ kind: 'folder', parent: null })} className={PLATE}>
              [ + NEW FOLDER ]
            </button>
            <button type="button" onClick={() => setCreating({ kind: 'file', parent: category?.folderPath ?? null })} className={PLATE_MAIN}>
              + NEW FILE
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setUploading(true)} className={PLATE_MAIN}>
            + UPLOAD
          </button>
        )}
      </div>

      {notice === null ? null : (
        <p className="mt-1 w-fit text-label font-bold text-ink" role="status">
          OK: {notice}
        </p>
      )}

      {!catalogue.answered ? (
        <p className="mt-3 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          CATALOGUE OFFLINE - SHOWING BUILT-IN FILES ONLY.
        </p>
      ) : null}

      {body()}

      {uploading ? (
        <MediaUploadWindow
          uploader={user === null ? null : { id: user.id, displayName: user.displayName }}
          items={catalogue.items}
          bytesUsed={catalogue.bytesUsed}
          onClose={() => setUploading(false)}
          onFiled={(item, note) => {
            setUploading(false);
            setNotice(note);
            catalogue.reload();
            // Find it for them: the new file is the newest, so the search for its title lists it first.
            setQuery(item.title);
            setOpenId(`|${item.id}`);
          }}
          onAudioWanted={() => {
            setUploading(false);
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
