'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import type { AudioTrack } from '../lib/audio/tracks';
import { audioTagKey } from '../lib/audio/tags';
import { KIND_LABELS, MEDIA_KINDS, useCatalogue } from '../lib/media/catalogue';
import { getMediaRepository } from '../lib/media/repository';
import { STORAGE_CEILING_BYTES, formatBytes } from '../lib/media/rules';
import type { CatalogueEntry, MediaItem, MediaKind } from '../lib/media/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import AudioTagChooser from './AudioTagChooser';
import AudioTagPill from './AudioTagPill';
import { useAuth } from './AuthProvider';
import MediaUploadWindow from './MediaUploadWindow';
import MusicDirectory from './MusicDirectory';
import { useMusicPlayer } from './MusicPlayerProvider';
import ProfileLink from './ProfileLink';
import SheetImage from './SheetImage';
import TimeStamp from './TimeStamp';

type Tab = 'all' | MediaKind;
type Sort = 'newest' | 'title' | 'used';

const SORT_LABELS: Record<Sort, string> = { newest: 'NEWEST', title: 'TITLE', used: 'MOST USED' };

/** The glyph a row without a picture leads with. */
const KIND_MARKS: Record<MediaKind, string> = { image: '▦', audio: '♪', video: '▶' };

function tabRequested(value: string | null): Tab {
  return value === 'image' || value === 'audio' || value === 'video' ? value : 'all';
}

/**
 * The media catalogue (SPEC-media-catalogue.md): every file the site holds, by kind, searchable,
 * each row opening onto the file itself and the places it is used.
 *
 * The AUDIO tab *is* the music archive - the same folder tree, rows and `[ INJECT ]` keys the music
 * window's ARCHIVE screen drew until 2026-10-24 (decision 2: the page took it over; `./MusicDirectory`
 * is drawn here now and the window keeps MY MUSIC). The other tabs read the catalogue's own records,
 * which the archive's uploads are recorded into as well, so a track is found on either.
 *
 * The tab lives in the address (`/media?kind=audio`), so the music window's ARCHIVE link, a track's
 * key and a copied address all land on the right shelf.
 */
export default function MediaCatalogue() {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const catalogue = useCatalogue();

  const tab = tabRequested(search.get('kind'));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const show = useCallback(
    (next: Tab) => {
      router.replace(next === 'all' ? pathname : `${pathname}?kind=${next}`, { scroll: false });
    },
    [pathname, router],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const needleKey = audioTagKey(query);

    const matching = catalogue.entries.filter(({ item }) => {
      if (tab !== 'all' && item.kind !== tab) return false;
      if (needle.length === 0) return true;

      return (
        item.title.toLowerCase().includes(needle) ||
        item.credit.toLowerCase().includes(needle) ||
        item.uploadedByLabel.toLowerCase().includes(needle) ||
        item.tags.some((tag) => audioTagKey(tag) === needleKey || tag.toLowerCase().includes(needle))
      );
    });

    return [...matching].sort((a, b) => {
      if (sort === 'title') return a.item.title.localeCompare(b.item.title);
      if (sort === 'used') return b.uses.length - a.uses.length || b.item.createdAt.localeCompare(a.item.createdAt);
      return b.item.createdAt.localeCompare(a.item.createdAt);
    });
  }, [catalogue.entries, tab, query, sort]);

  // Each count is what its tab lists: the AUDIO tab is the shelf (./MusicDirectory), so it counts
  // the shelf; ALL, IMAGES and VIDEO count the catalogue's own rows. The two agree once the
  // migration has recorded the shelf in the catalogue.
  const { queue } = useMusicPlayer();
  const counts = useMemo(() => {
    const byKind: Record<Tab, number> = { all: catalogue.entries.length, image: 0, audio: queue.length, video: 0 };
    for (const { item } of catalogue.entries) {
      if (item.kind !== 'audio') byKind[item.kind] += 1;
    }
    return byKind;
  }, [catalogue.entries, queue]);

  const share = Math.min(1, catalogue.bytesUsed / STORAGE_CEILING_BYTES);

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
          <span className="text-label font-bold text-ink-quiet" title="Filing a file takes an account">
            SIGN IN TO FILE A PICTURE OR A VIDEO
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
        title="Uploaded files against the storage the site has. Past 80% video is refused first."
      >
        CATALOGUE: {formatBytes(catalogue.bytesUsed)} OF {formatBytes(STORAGE_CEILING_BYTES)} ({Math.round(share * 100)}%)
      </p>

      {notice === null ? null : (
        <p className="mt-1 w-fit text-label font-bold text-ink" role="status">
          OK: {notice}
        </p>
      )}

      {tab === 'audio' ? (
        <div className="mt-3">
          <MusicDirectory />
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor="media-search" className="sr-only">
              Search the catalogue
            </label>
            <input
              id="media-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, credit, uploader or tag..."
              className={`${FIELD_TIGHT} min-w-0 flex-1`}
            />
            <label htmlFor="media-sort" className="text-label font-bold text-ink">
              SORT:
            </label>
            <select
              id="media-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className={FIELD_TIGHT}
            >
              {(Object.keys(SORT_LABELS) as Sort[]).map((option) => (
                <option key={option} value={option}>
                  {SORT_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          {!catalogue.answered ? (
            <p className="mt-3 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
              THE CATALOGUE COULD NOT BE READ. WHAT IS LISTED IS ONLY WHAT SHIPS WITH THE SITE.
            </p>
          ) : null}

          {catalogue.loading ? (
            <p className="mt-3 text-label font-bold text-ink">READING THE CATALOGUE...</p>
          ) : shown.length === 0 ? (
            <p className="mt-3 text-label font-bold text-ink">
              {query.trim().length === 0 ? 'NOTHING FILED HERE YET.' : 'NO FILE MATCHES.'}
            </p>
          ) : (
            <ul className="mt-2" aria-label="Files">
              {shown.map((entry) => (
                <CatalogueRow
                  key={entry.item.id}
                  entry={entry}
                  open={openId === entry.item.id}
                  onToggle={() => setOpenId((current) => (current === entry.item.id ? null : entry.item.id))}
                  viewerId={user?.id ?? null}
                  onChanged={(message) => {
                    setNotice(message);
                    catalogue.reload();
                  }}
                />
              ))}
            </ul>
          )}
        </>
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
            setOpenId(item.id);
            catalogue.reload();
            if (tab !== 'all' && tab !== item.kind) show(item.kind);
          }}
          onAudioWanted={() => {
            setUploading(false);
            show('audio');
          }}
        />
      ) : null}
    </section>
  );
}

/** One file: the row, and under it when opened, the file itself and the places it is used. */
function CatalogueRow({
  entry,
  open,
  onToggle,
  viewerId,
  onChanged,
}: {
  entry: CatalogueEntry;
  open: boolean;
  onToggle: () => void;
  viewerId: string | null;
  onChanged: (message: string) => void;
}) {
  const { item, uses } = entry;
  const player = useMusicPlayer();
  const [editing, setEditing] = useState(false);
  const canEdit = viewerId !== null && item.uploadedBy === viewerId && item.source !== 'sheet';

  /** A catalogued track as the player's own kind, so the row's play key uses the site's one player. */
  const asTrack = (): AudioTrack => ({
    id: item.src,
    title: item.title,
    credit: item.credit,
    kind: 'FROM THE CATALOGUE',
    src: item.src,
    length: item.length.length === 0 ? '--:--' : item.length,
    tags: item.tags,
    shelf: 'bucket',
  });

  return (
    <li className="rule-pixel py-2">
      <div className="flex items-start gap-2">
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
              {open ? '[-]' : '[+]'} {item.title}
            </button>
            <span className="text-label font-bold text-ink-quiet">{KIND_LABELS[item.kind]}</span>
            {item.length.length === 0 ? null : <span className="text-label text-ink">{item.length}</span>}
            {item.bytes === 0 ? null : <span className="text-label text-ink">{formatBytes(item.bytes)}</span>}
            <span className="text-label font-bold text-ink" title="Where this file appears on the site">
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

        {item.kind === 'audio' ? (
          <button type="button" onClick={() => player.play(asTrack())} className={`${PLATE} shrink-0`} title={`Play ${item.title}`}>
            [ ▶ PLAY ]
          </button>
        ) : null}
      </div>

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
            {item.mime.length === 0 ? '' : `${item.mime} :: `}
            <a href={item.src} className="underline decoration-dotted hover:bg-ice" target="_blank" rel="noreferrer">
              OPEN THE FILE
            </a>
          </p>

          <p className={`${TITLE_BAR} mt-2`}>WHERE IT IS USED</p>
          {uses.length === 0 ? (
            <p className="text-label font-bold text-ink">NOWHERE YET. PICK IT FROM THE CATALOGUE WHEN YOU WRITE A POST.</p>
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
                [ EDIT TITLE, CREDIT, TAGS ]
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
