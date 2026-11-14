'use client';

import Link from 'next/link';
import { type RefObject, useState } from 'react';
import { forumTrackFromArchive } from '../lib/audio/forum-tracks';
import type { AudioTrack } from '../lib/audio/tracks';
import { keepableSong } from '../lib/audio/up-next';
import { folderCategoryId } from '../lib/media/categories';
import { PLATE, PLATE_LARGE, PLATE_LINK, PLATE_PRESSED } from '../lib/ui/controls';
import { songOwner } from '../lib/audio/song-notes';
import AboveAnchor from './AboveAnchor';
import { useAuth } from './AuthProvider';
import AddToLetterKey from './AddToLetterKey';
import AddToPlaylistKey, { BLANK_LINE, songAsPlaylistThing } from './AddToPlaylistKey';
import type { LetterThing } from '../lib/letters/types';
import { parseWebTrackId } from '../lib/web/web-audio';
import { SongCardEditor } from './SongCoverCard';
import { useMusicLibrary } from './MusicLibraryProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import NewPostForm from './NewPostForm';

/**
 * The song settings panel (SPEC-vanity.md): one `[ ⋯ ]` key on a song row, and the short menu it opens.
 *
 * **One option to a line** (Luke, 2026-11-14: "THE LIST OF OPTIONS at the end of the player needs to be a vertical
 * list. add to needs to go like 'add to: (playlist) (letter)'"): the adding line first, then LIKE, PLAY NEXT,
 * ADD TO QUEUE, ATTACH TO POST, COPY LINK, GO TO FOLDER, COVER CARD and BARR, each a row as wide as the list.
 * The same list wherever the menu opens (the player bar, a shelf row, a posted track).
 *
 * Every per-song action lives here, so the rows only keep their play key. The row owns whether it is
 * open (`SongMenuKey` + `SongMenuPanel`), because the row decides where the panel goes: under the row
 * in a list, above the key on the player bar (`placement="above"`).
 *
 * A song is matched to the shelf by its file, so an MP3 met in a post is the archive's own song when the
 * archive holds it - its likes and lists are that song's. A file the shelf does not hold (a link posted
 * from elsewhere) can still be queued, copied and posted, but not liked or listed: a list holds shelf
 * songs, and one it could not draw would only come back as UNAVAILABLE.
 */
/**
 * A barred song's title, wherever it is listed, for the reader who barred it: White words on the
 * `barred` strip (Rose), plus a word for a screen reader, since colour alone says nothing to one.
 */
export function BarredTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-barred px-1 text-ink-bar">
      {children}
      <span className="sr-only"> (barred)</span>
    </span>
  );
}

export function SongMenuKey({
  open,
  onToggle,
  title,
  plate = PLATE,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  /** The key's shape while shut: the player bar's keys are a little taller (`PLATE_HARDWARE`). */
  plate?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-haspopup="menu"
      title={`Song options :: ${title}`}
      aria-label={`Song options for ${title}`}
      className={open ? `${PLATE_PRESSED} cursor-pointer` : plate}
    >
      [ ⋯ ]
    </button>
  );
}

/** A row of the list: a key with the line to itself, as wide as the list, so the whole line is the target. */
const ROW = `${PLATE_LARGE} block w-full text-left`;
/** The same row switched on (BARR): the filled pill, in the row's own box (its 2px outline is the rest of the padding). */
const ROW_ON =
  'key key-fill key-on [--key-fill:var(--color-ink)] block w-full cursor-pointer px-1 py-1 text-left text-key text-paper max-sm:min-h-tap max-sm:py-2 max-sm:text-base';
/** A line of the list that is not one key (the adding line, a note): the rows' own inset. */
const LINE = 'px-1.5 py-0.5';

type SongMenuPanelProps = {
  track: AudioTrack;
  onClose: () => void;
  /**
   * `below`: drawn in the row's flow, under it. `above`: a small window over `anchor` on the top layer
   * (the player bar, which sits under the docked windows; see `./AboveAnchor.tsx`).
   */
  placement?: 'below' | 'above';
  /** What an `above` panel sits over. */
  anchor?: RefObject<HTMLElement | null>;
  /**
   * Which edge of the anchor an `above` panel lines up with: the wide player bar's keys sit at its right
   * end, the phone card is itself at the screen's left edge.
   */
  side?: 'left' | 'right';
  /** True when the row is an archive song already (archive and MY MUSIC rows), so no lookup is needed. */
  fromShelf?: boolean;
};

/**
 * A song as a letter's item (Luke, 2026-11-11: add the playing song to a letter from this menu). A MEDIA track (an Archive
 * recording, a podcast episode, an audiobook chapter) goes in as its MEDIA row, so its card opens it there; a site song as
 * its file in the catalogue.
 */
function songThing(song: AudioTrack): LetterThing {
  const web = parseWebTrackId(song.id);
  const title = song.title.slice(0, 200);
  return web ? { kind: 'web', ref: `${web.platform}:${web.externalId}`, title } : { kind: 'file', ref: song.id.slice(0, 500), title };
}

export function SongMenuPanel({ track, onClose, placement = 'below', anchor, side = 'right', fromShelf = false }: SongMenuPanelProps) {
  const library = useMusicLibrary();
  const player = useMusicPlayer();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  // COVER CARD (SPEC-music-queues.md): the uploader's picture and words for their own song, shown in a room.
  const { user } = useAuth();
  const [carding, setCarding] = useState(false);

  // The shelf's own record of this file when it has one, or a WEB track itself (see the note above).
  const shelved = fromShelf ? track : keepableSong(player.queue, player.shelfSize, track);
  const song = shelved ?? track;
  const onShelf = shelved !== undefined;
  const liked = library.likedIds.has(song.id);
  const barred = library.barredSrcs.has(song.src);
  const top = (song.folderPath ?? '').split('/')[0];

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'THE LIBRARY DID NOT ANSWER.');
    } finally {
      setBusy(false);
    }
  }

  const copyLink = () =>
    run(async () => {
      await navigator.clipboard.writeText(new URL(song.src, window.location.origin).href);
      return 'LINK COPIED.';
    });

  const above = placement === 'above' && anchor !== undefined;
  const shell = above ? 'frame bg-sun-pale p-1' : 'mt-1 max-w-md border-t border-dotted border-ink pt-1';

  const menu = (
      <div
        role="menu"
        aria-label={`Options for ${song.title}`}
        className={`${shell} flex flex-col text-label text-ink`}
        data-song-menu
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        {/* The adding line (Luke, 2026-11-14): `ADD TO: [ PLAYLIST ] [ LETTER ]`. Each key opens its own short window,
            so nothing in this list moves when one is pressed. A letter and a playlist are both saved to an account. */}
        {!library.canWrite ? (
          <p className={LINE}>
            <Link href="/account" className={PLATE_LINK}>
              [ LOG IN ]
            </Link>{' '}
            TO LIKE AND KEEP LISTS
          </p>
        ) : (
          <div role="group" aria-label="Add to" className={`${LINE} flex flex-wrap items-center gap-x-1`} data-song-add-to>
            <span className="text-key">ADD TO:</span>
            <AddToPlaylistKey thing={songAsPlaylistThing(song)} disabled={!onShelf} reason="Not in the archive" className={PLATE_LARGE} />
            {/* A MEDIA track goes in as its MEDIA row, a site song as its file (Luke, 2026-11-11). */}
            <AddToLetterKey thing={songThing(song)} className={PLATE_LARGE} />
          </div>
        )}
        {library.canWrite && !onShelf ? <p className={`${LINE} text-ink-quiet`}>NOT IN THE ARCHIVE :: NO LIKES OR LISTS</p> : null}

        {library.canWrite && onShelf ? (
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={liked}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await library.toggleLike(song.id);
                return result.liked ? 'LIKED.' : 'UNLIKED.';
              })
            }
            className={ROW}
          >
            {liked ? '[ ♥ UNLIKE ]' : '[ ♡ LIKE ]'}
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            player.enqueue(song, 'next');
            setNotice('PLAYS NEXT.');
          }}
          className={ROW}
        >
          [ PLAY NEXT ]
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            player.enqueue(song, 'end');
            setNotice('ADDED TO THE QUEUE.');
          }}
          className={ROW}
        >
          [ ADD TO QUEUE ]
        </button>
        <button type="button" role="menuitem" onClick={() => setPosting(true)} className={ROW}>
          [ ATTACH TO POST ]
        </button>
        <button type="button" role="menuitem" onClick={() => void copyLink()} className={ROW}>
          [ COPY LINK ]
        </button>
        {top.length === 0 ? null : (
          <Link href={`/files?cat=${encodeURIComponent(folderCategoryId(top))}`} role="menuitem" className={`${ROW} truncate`} title={song.folderPath ?? top}>
            [ GO TO {top} ]
          </Link>
        )}
        {user !== null && songOwner(song.id) === user.id ? (
          <button type="button" role="menuitem" onClick={() => setCarding(true)} className={ROW} title="The picture and words a room shows while this song plays">
            [ COVER CARD ]
          </button>
        ) : null}
        {/* BARR: a personal mark, by file, so it holds wherever the song turns up. Nobody else sees it. Last, as the one that takes away. */}
        {library.canWrite ? (
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={barred}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await library.toggleBarr(song.src);
                return result.barred ? 'BARRED. ONLY YOU SEE THIS.' : 'UNBARRED.';
              })
            }
            className={barred ? ROW_ON : ROW}
          >
            {barred ? '[ UNBARR ]' : '[ BARR ]'}
          </button>
        ) : null}

        {/* Over the player the list grows upward from its foot, so the answer's line keeps its height while empty:
            an answer must not lift the key that was just pressed out from under the pointer. */}
        {above || notice !== null ? (
          <p role="status" className={`${LINE} font-bold`}>
            {notice ?? BLANK_LINE}
          </p>
        ) : null}
      </div>
  );

  return (
    <>
      {above ? (
        <AboveAnchor anchor={anchor} side={side} className="w-[min(22rem,calc(100vw-1rem))]">
          {menu}
        </AboveAnchor>
      ) : (
        menu
      )}

      {carding && user !== null ? <SongCardEditor track={song} ownerId={user.id} onClose={() => setCarding(false)} /> : null}
      {/* The board's composer with this song already filed: the same seam the old COMMENT key used. */}
      {posting ? (
        <NewPostForm
          initialTrack={forumTrackFromArchive(song)}
          onClose={() => {
            setPosting(false);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
