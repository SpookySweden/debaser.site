'use client';

import Link from 'next/link';
import { useState } from 'react';
import { forumTrackFromArchive } from '../lib/audio/forum-tracks';
import { validatePlaylistName } from '../lib/audio/library';
import type { AudioTrack } from '../lib/audio/tracks';
import { shelfSong } from '../lib/audio/up-next';
import { folderCategoryId } from '../lib/media/categories';
import { FIELD_TIGHT, PLATE, PLATE_LINK, PLATE_PRESSED } from '../lib/ui/controls';
import { useMusicLibrary } from './MusicLibraryProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import NewPostForm from './NewPostForm';

/**
 * The song settings panel (SPEC-vanity.md): one `[ ⋯ ]` key on a song row, and the short menu it opens.
 *
 * Every per-song action lives here, so the rows only keep their play key: ADD TO PLAYLIST, LIKE,
 * ADD TO QUEUE / PLAY NEXT, COPY LINK / ATTACH TO POST and GO TO FOLDER. The row owns whether it is
 * open (`SongMenuKey` + `SongMenuPanel`), because the row decides where the panel goes: under the row
 * in a list, above the key on the player bar (`placement="above"`).
 *
 * A song is matched to the shelf by its file, so an MP3 met in a post is the archive's own song when the
 * archive holds it - its likes and lists are that song's. A file the shelf does not hold (a link posted
 * from elsewhere) can still be queued, copied and posted, but not liked or listed: a list holds shelf
 * songs, and one it could not draw would only come back as UNAVAILABLE.
 */
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

type SongMenuPanelProps = {
  track: AudioTrack;
  onClose: () => void;
  /** `below`: drawn in the row's flow, under it. `above`: a small window over the key (the player bar). */
  placement?: 'below' | 'above';
  /**
   * Which edge of the positioned box an `above` panel lines up with: the wide player bar's keys sit at
   * its right end, the phone card's on the left of a card that is itself at the screen's left edge.
   */
  side?: 'left' | 'right';
  /** True when the row is an archive song already (archive and MY MUSIC rows), so no lookup is needed. */
  fromShelf?: boolean;
};

export function SongMenuPanel({ track, onClose, placement = 'below', side = 'right', fromShelf = false }: SongMenuPanelProps) {
  const library = useMusicLibrary();
  const player = useMusicPlayer();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [posting, setPosting] = useState(false);

  // The shelf's own record of this file when it has one (see the note above).
  const shelved = fromShelf ? track : shelfSong(player.queue, player.shelfSize, track.src);
  const song = shelved ?? track;
  const onShelf = shelved !== undefined;
  const liked = library.likedIds.has(song.id);
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

  const toggleList = (listId: string, name: string, inList: boolean) =>
    run(async () => {
      await library.togglePlaylistTrack(listId, song.id);
      return inList ? `TAKEN OUT OF ${name}.` : `ADDED TO ${name}.`;
    });

  const makeList = () => {
    const problem = validatePlaylistName(newName);
    if (problem !== undefined) {
      setNotice(problem);
      return;
    }
    void run(async () => {
      const made = await library.savePlaylist(newName);
      if (!made.items.some((item) => item.trackId === song.id)) await library.togglePlaylistTrack(made.id, song.id);
      setNaming(false);
      setNewName('');
      return `ADDED TO ${made.name}.`;
    });
  };

  const copyLink = () =>
    run(async () => {
      await navigator.clipboard.writeText(new URL(song.src, window.location.origin).href);
      return 'LINK COPIED.';
    });

  const shell =
    placement === 'above'
      ? `absolute bottom-full ${side === 'right' ? 'right-0' : 'left-0'} z-menu mb-1 w-[min(22rem,calc(100vw-1rem))] frame bg-sun-pale p-2`
      : 'mt-1 border-t border-dotted border-ink pt-1';

  return (
    <>
      <div
        role="menu"
        aria-label={`Options for ${song.title}`}
        className={`${shell} text-label text-ink`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        {/* ADD TO PLAYLIST: every list, the ones holding this song pressed in. */}
        {!library.canWrite ? (
          <p className="py-0.5">
            <Link href="/account" className={PLATE_LINK}>
              [ LOG IN ]
            </Link>{' '}
            TO LIKE AND KEEP LISTS
          </p>
        ) : !onShelf ? (
          <p className="py-0.5 text-ink-quiet">NOT IN THE ARCHIVE :: NO LIKES OR LISTS</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-bold">ADD TO PLAYLIST:</span>
            {library.playlists.map((list) => {
              const inList = list.items.some((item) => item.trackId === song.id);
              return (
                <button
                  key={list.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={inList}
                  disabled={busy}
                  onClick={() => void toggleList(list.id, list.name, inList)}
                  className={inList ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
                  title={inList ? `Take it out of ${list.name}` : `Add it to ${list.name}`}
                >
                  [ {inList ? '✓ ' : ''}
                  {list.name} ]
                </button>
              );
            })}
            {naming ? (
              <span className="flex flex-wrap items-center gap-1">
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="NEW LIST"
                  maxLength={40}
                  aria-label="New playlist name"
                  autoFocus
                  className={`${FIELD_TIGHT} w-32`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') makeList();
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      setNaming(false);
                    }
                  }}
                />
                <button type="button" onClick={makeList} disabled={busy} className={PLATE}>
                  [ MAKE ]
                </button>
              </span>
            ) : (
              <button type="button" role="menuitem" onClick={() => setNaming(true)} className={PLATE}>
                [ + NEW ]
              </button>
            )}
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-1">
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
              className={PLATE}
            >
              {liked ? '[ ♥ UNLIKE ]' : '[ ♡ LIKE ]'}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              player.enqueue(song, 'end');
              setNotice('ADDED TO THE QUEUE.');
            }}
            className={PLATE}
          >
            [ ADD TO QUEUE ]
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              player.enqueue(song, 'next');
              setNotice('PLAYS NEXT.');
            }}
            className={PLATE}
          >
            [ PLAY NEXT ]
          </button>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1">
          <button type="button" role="menuitem" onClick={() => void copyLink()} className={PLATE}>
            [ COPY LINK ]
          </button>
          <button type="button" role="menuitem" onClick={() => setPosting(true)} className={PLATE}>
            [ ATTACH TO POST ]
          </button>
          {top.length === 0 ? null : (
            <Link
              href={`/media?cat=${encodeURIComponent(folderCategoryId(top))}`}
              role="menuitem"
              className={PLATE_LINK}
              title={song.folderPath ?? top}
            >
              [ GO TO {top} ]
            </Link>
          )}
        </div>

        {notice === null ? null : (
          <p role="status" className="mt-1 font-bold">
            {notice}
          </p>
        )}
      </div>

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
