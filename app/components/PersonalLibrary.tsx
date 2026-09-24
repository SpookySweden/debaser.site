'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  playlistIds,
  resolveLikes,
  resolvePlaylistItems,
  validatePlaylistName,
  type Playlist,
} from '../lib/audio/library';
import { forumTrackFromArchive } from '../lib/audio/forum-tracks';
import { getMusicRepository } from '../lib/audio/repository';
import { formatClock } from '../lib/audio/format';
import type { AudioTrack } from '../lib/audio/tracks';
import { FIELD, PANEL, PLATE, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import Link from 'next/link';
import NewPostForm from './NewPostForm';
import { useMusicPlayer } from './MusicPlayerProvider';
import LibraryRow from './LibraryRow';
import ListRow from './ListRow';
import { useMusicLibrary } from './MusicLibraryProvider';

/**
 * The reader's own music: what they liked, and the lists they made.
 *
 * This is the second screen of the music window (`./MusicWindow.tsx`), and it is a *browser* of the
 * same shelf rather than a second shelf: every row here is an `AudioTrack` the archive also holds,
 * because a like is a pointer (`lib/audio/library.ts`). That is why the same file can be on this
 * screen and in the archive at once without being two files.
 *
 * The screen's own shape is two panels: the lists first, then the rows of whichever list is open -
 * a file browser with a folder column, deliberately.
 *
 * Three things it is careful never to do, and each was a bug found in review rather than a preference:
 *
 *   1. **it does not claim the reader has nothing when the read failed.** `answered: false` draws a
 *      fault with a retry, not an empty list. "You have liked nothing" and "the database did not answer"
 *      are different sentences, and the second is a bug the reader cannot report because they cannot
 *      see it;
 *   2. **it does not lose rows silently.** A like whose track the shelf does not hold is counted, and
 *      the count is said out loud, because a short shelf read and a deleted file look identical from
 *      here while meaning very different things;
 *   3. **it does not read the session as signed-out while the session is still arriving.** The guard is
 *      `status !== 'anonymous'`, the long way round - the same one `./GuestPrompt.tsx` uses, and for
 *      the same reason: `user` is null while the read is in flight, so the short test would tell a
 *      signed-in reader their own library is empty.
 */
export default function PersonalLibrary() {
  const { user, status } = useAuth();
  const player = useMusicPlayer();
  const repository = useMemo(() => getMusicRepository(), []);
  const library = useMusicLibrary();
  const userId = user?.id ?? null;

  /**
   * The shelf, which is the archive's rather than the reader's - so it is read here rather than shared.
   * The likes and lists come from `./MusicLibraryProvider.tsx`, which reads them once for both screens.
   */
  const [shelf, setShelf] = useState<AudioTrack[]>([]);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** The list being viewed: null is LIKED, which is the screen's own default. */
  const [openList, setOpenList] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [naming, setNaming] = useState(false);

  /** The track the composer is open for. */
  const [posting, setPosting] = useState<AudioTrack | null>(null);

  /**
   * Reads the shelf.
   *
   * Only the shelf: the two personal reads live in the provider, which is what lets the archive's rows
   * wear the same hearts without reading them again. Guarded by `alive` because a reader can switch
   * screens while the read is in flight - the same guard `AuthProvider` uses for its own session read.
   *
   * The personal reads report whether they answered; the shelf's does not and cannot, because
   * `listTracks` deliberately swallows its own failures so the archive still works. So a short shelf is
   * detected where it can be - by counting the likes that could not be resolved - and reported there.
   */
  const [shelfToken, setShelfToken] = useState(0);

  useEffect(() => {
    let alive = true;

    void (async () => {
      const tracks = await repository.listTracks();
      if (!alive) return;

      setShelf(tracks);
      setReady(true);
    })();

    return () => {
      alive = false;
    };
  }, [repository, shelfToken]);

  /** Asks for the shelf again, after a write that may have changed it. */
  const refresh = useCallback(() => setShelfToken((token) => token + 1), []);

  /** The liked tracks, against the shelf that is actually loaded - and how many could not be drawn. */
  const liked = useMemo(() => resolveLikes(library.likes, shelf), [library.likes, shelf]);

  const current = useMemo(
    () => library.playlists.find((list) => list.id === openList) ?? null,
    [library.playlists, openList],
  );

  /** The rows the screen is showing: the liked set, or the list that is open. */
  const shown = useMemo(
    () => (current === null ? liked : resolvePlaylistItems(current, shelf)),
    [current, liked, shelf],
  );

  const rows = shown.rows;

  // Built once for the whole list rather than re-scanned by every row. `isInPlaylist` is linear, so
  // asking it per row is quadratic in the length of the list; the liked set is already shared.
  const inOpenList = useMemo(() => playlistIds(current), [current]);

  async function toggleLike(track: AudioTrack) {
    setBusy(track.id);
    setNotice(null);

    try {
      const { liked: nowLiked } = await library.toggleLike(track.id);
      setNotice(nowLiked ? `${track.title} LIKED.` : `${track.title} TAKEN BACK OUT OF LIKED.`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'THE LIBRARY DID NOT ANSWER.');
    } finally {
      setBusy(null);
    }
  }

  async function addToList(track: AudioTrack, list: Playlist) {
    setBusy(track.id);
    setNotice(null);

    try {
      await library.togglePlaylistTrack(list.id, track.id);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'THE LIBRARY DID NOT ANSWER.');
    } finally {
      setBusy(null);
    }
  }

  async function makeList() {
    const problem = validatePlaylistName(newName);
    if (problem !== undefined) {
      setNotice(problem);
      return;
    }

    try {
      const made = await library.savePlaylist(newName);
      setNewName('');
      setNaming(false);
      setOpenList(made.id);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'THE LIBRARY DID NOT ANSWER.');
    }
  }

  async function dropList(list: Playlist) {
    try {
      await library.removePlaylist(list.id);
      if (openList === list.id) setOpenList(null);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'THE LIBRARY DID NOT ANSWER.');
    }
  }

  /**
   * The session has not settled yet.
   *
   * This test is deliberately *before* the guest test and is the only thing that keeps the two apart: a
   * guest and a signed-in reader are both `userId === null` for the first moment, so drawing the guest
   * panel without waiting would tell a signed-in reader - mid-page-load - that they have no library.
   * Showing "reading" instead costs a frame and lies about nothing.
   */
  if (status === 'loading') {
    return <p className="p-3 text-[10px] font-bold text-ink">READING YOUR LIBRARY...</p>;
  }

  /**
   * A settled guest. They get the archive and an offer, and no empty LIKED list - there is no library to
   * be empty, it does not exist yet.
   *
   * The offer is a `Link` to `/account` rather than a sentence that stops at "this takes an account", the
   * same shape `./GuestPrompt.tsx` uses: being told you cannot, and not being told how, is how a fault
   * becomes a dead end.
   */
  if (userId === null) {
    return (
      <section className={`${PANEL} p-3`}>
        <p className="text-[10px] font-bold text-ink">
          YOUR MUSIC IS WHERE THE TRACKS YOU LIKED AND THE LISTS YOU MADE LIVE. IT IS KEPT AGAINST YOUR ACCOUNT.
        </p>

        <p className="mt-2 text-[10px] text-ink">
          THE ARCHIVE IS OPEN TO EVERYBODY, AND EVERY ROW IN IT CAN BE PLAYED WITHOUT ONE - THIS SCREEN IS THE
          HALF THAT IS YOURS.
        </p>

        <Link
          href="/account"
          className="mt-2 inline-block cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-ink px-2 py-[3px] text-[10px] font-bold text-paper hover:bg-ena hover:text-sun"
        >
          [ CREATE ACCOUNT OR LOG IN ]
        </Link>
      </section>
    );
  }

  /**
   * The read failed. This is drawn *instead of* the lists, not above an empty one, because an empty list
   * is a claim and this is the absence of one.
   */
  if (!library.answered) {
    return (
      <section className={`${PANEL} p-3`} role="alert">
        <div className={TITLE_BAR}>
          <span>YOUR MUSIC</span>
          <span>[ FAULT ]</span>
        </div>

        <p className="mt-2 text-[10px] font-bold text-ink">
          THE LIBRARY DID NOT ANSWER, SO NOTHING HERE IS YOURS TO READ YET. YOUR LIKES AND LISTS ARE NOT LOST -
          THIS SCREEN SIMPLY COULD NOT ASK FOR THEM.
        </p>

        <button type="button" onClick={refresh} className={`${PLATE} mt-2`}>
          [ TRY AGAIN ]
        </button>
      </section>
    );
  }

  return (
    <section>
      {notice === null ? null : (
        <p className="mb-2 border border-ink bg-sun-pale px-2 py-1 text-[10px] font-bold text-ink" role="status">
          {notice}
        </p>
      )}

      {/* A short list is explained rather than silently drawn. It is shown to everybody who is looking at
          a list with holes in it, signed in or not, because it is about the rows rather than the account.
          The two readings - a deleted file and a shelf read that fell short - are named together, because
          from here they are genuinely indistinguishable and guessing at one would be inventing. */}
      {shown.missing === 0 ? null : (
        <p className="mb-2 border border-ink bg-sun-pale px-2 py-1 text-[10px] font-bold text-ink" role="status">
          {shown.missing} TRACK{shown.missing === 1 ? '' : 'S'} IN THIS LIST {shown.missing === 1 ? 'IS' : 'ARE'} NOT
          ON THE SHELF RIGHT NOW - {shown.missing === 1 ? 'IT HAS' : 'THEY HAVE'} EITHER BEEN TAKEN DOWN OR THE
          ARCHIVE DID NOT ANSWER IN FULL. YOUR LIST STILL HOLDS {shown.missing === 1 ? 'IT' : 'THEM'}.
        </p>
      )}

      {/* The lists, with LIKED as the first entry: the one list everybody has, and the screen's default. */}
      <div className={PANEL}>
        <div className={TITLE_BAR}>
          <span>LISTS</span>
          <span>[ {library.playlists.length + 1} ]</span>
        </div>

        <ul className="divide-y divide-dotted divide-ink">
          <li>
            <ListRow
              label="LIKED"
              note={`${liked.rows.length}`}
              selected={openList === null}
              onSelect={() => setOpenList(null)}
              symbol="♥"
            />
          </li>

          {library.playlists.map((list) => (
            <li key={list.id}>
              <ListRow
                label={list.name}
                note={`${list.items.length}`}
                selected={openList === list.id}
                onSelect={() => setOpenList(list.id)}
                symbol="♪"
                onDrop={() => void dropList(list)}
              />
            </li>
          ))}
        </ul>

        {/* Making a list: one field and one plate, the way every other "new thing" on this site is. */}
        <div className="border-t border-ink p-2">
          {naming ? (
            <div className="flex flex-wrap items-center gap-1">
              <input
                id="new-playlist-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="e.g. LATE NIGHT"
                maxLength={40}
                aria-label="New playlist name"
                className={`${FIELD} min-w-0 flex-1`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void makeList();
                  if (event.key === 'Escape') setNaming(false);
                }}
              />
              <button type="button" onClick={() => void makeList()} className={PLATE}>
                [ MAKE IT ]
              </button>
              <button type="button" onClick={() => setNaming(false)} className={PLATE}>
                [ CANCEL ]
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNaming(true);
                setNotice(null);
              }}
              className={PLATE}
            >
              [ + NEW PLAYLIST ]
            </button>
          )}
        </div>
      </div>

      {/* The rows. Which list they are in is the title bar's job, so the header says it in words. */}
      <div className={`${PANEL} mt-2`}>
        <div className={TITLE_BAR}>
          <span>{current === null ? 'LIKED' : current.name}</span>
          <span>[ {rows.length} ]</span>
        </div>

        {!ready ? (
          <p className="p-3 text-[10px] font-bold text-ink">READING THE LIBRARY...</p>
        ) : rows.length === 0 ? (
          <p className="p-3 text-[10px] font-bold text-ink">
            {current === null
              ? 'NOTHING LIKED YET. EVERY ROW IN THE ARCHIVE WEARS A HEART - PRESS ONE AND IT LANDS HERE.'
              : 'THIS LIST IS EMPTY. THE BUTTONS UNDER A ROW PUT A TRACK INTO IT.'}
          </p>
        ) : (
          <ul>
            {rows.map((track, index) => (
              <LibraryRow
                key={track.id}
                track={track}
                index={index}
                lists={library.playlists}
                liked={library.likedIds.has(track.id)}
                inOpenList={inOpenList.has(track.id)}
                busy={busy === track.id}
                playing={player.track?.src === track.src && player.playing}
                current={player.track?.src === track.src}
                duration={
                  player.track?.src === track.src && Number.isFinite(player.duration)
                    ? formatClock(player.duration)
                    : track.length
                }
                onPlay={() => (player.track?.src === track.src ? player.toggle() : player.play(track))}
                onLike={() => void toggleLike(track)}
                onAddToList={(list) => void addToList(track, list)}
                onComment={() => setPosting(track)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* The board's own composer, opened with the track already filed. This is the *same* seam the
          archive's `[ INJECT TO POST ]` uses - `initialTrack` on `./NewPostForm.tsx` - so a post about a
          song reads the same whichever screen it was started from. */}
      {posting === null ? null : (
        <NewPostForm initialTrack={forumTrackFromArchive(posting)} onClose={() => setPosting(null)} />
      )}
    </section>
  );
}
