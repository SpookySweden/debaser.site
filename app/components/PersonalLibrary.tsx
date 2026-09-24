'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  isInPlaylist,
  isLiked,
  resolveLikes,
  resolvePlaylistItems,
  validatePlaylistName,
  type LikedTrack,
  type Playlist,
} from '../lib/audio/library';
import { forumTrackFromArchive } from '../lib/audio/forum-tracks';
import { getMusicRepository } from '../lib/audio/repository';
import { formatClock } from '../lib/audio/format';
import type { AudioTrack } from '../lib/audio/tracks';
import { FIELD, PANEL, PLATE, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import NewPostForm from './NewPostForm';
import { useMusicPlayer } from './MusicPlayerProvider';
import LibraryRow from './LibraryRow';
import ListRow from './ListRow';

/**
 * The reader's own music: what they liked, and the lists they made.
 *
 * This is the second screen of the music window (`./MusicWindow.tsx`), and it is a *browser* of the
 * same shelf rather than a second shelf: every row here is an `AudioTrack` the archive also holds,
 * because a like is a pointer (`lib/audio/library.ts`). That is why the same file can be on this
 * screen and in the archive at once without being two files.
 *
 * The screen's own shape is two panels: the lists on the left (with LIKED as the first entry, because
 * it is the one list everybody has), and the rows of whichever list is open. Which is a file browser
 * with a folder column, deliberately - this replaces the archive as the *default* screen of the window
 * while keeping the archive's own browser one tab away.
 */
export default function PersonalLibrary() {
  const { user, status } = useAuth();
  const player = useMusicPlayer();
  const repository = useMemo(() => getMusicRepository(), []);
  const userId = user?.id ?? null;

  const [shelf, setShelf] = useState<AudioTrack[]>([]);
  const [likes, setLikes] = useState<LikedTrack[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
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
   * Reads the shelf, the likes and the lists together.
   *
   * All three, every time, because they are drawn as one screen: a like that arrived without the shelf
   * would be an id with no title, and a list without the likes would draw its rows twice over.
   * `Promise.all` rather than three effects, so the screen has one loading state rather than a
   * flickering three.
   *
   * Guarded by `alive` because the read is three network calls deep and a reader can switch screens
   * while they are in flight - the same guard `AuthProvider` uses for its own session read, and for the
   * same reason: writing state after unmount is how a window that has been closed throws.
   */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;

    void (async () => {
      const [tracks, nextLikes, nextPlaylists] = await Promise.all([
        repository.listTracks(),
        userId === null ? Promise.resolve([] as LikedTrack[]) : repository.listLikes(userId),
        userId === null ? Promise.resolve([] as Playlist[]) : repository.listPlaylists(userId),
      ]);

      if (!alive) return;

      setShelf(tracks);
      setLikes(nextLikes);
      setPlaylists(nextPlaylists);
      setReady(true);
    })();

    return () => {
      alive = false;
    };
  }, [reloadToken, repository, userId]);

  /** Asks for the same read again, after a write that changed something. */
  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  /** The liked tracks, against the shelf that is actually loaded. */
  const liked = useMemo(() => resolveLikes(likes, shelf), [likes, shelf]);

  const current = useMemo(() => playlists.find((list) => list.id === openList) ?? null, [openList, playlists]);

  /** The rows the screen is showing: the liked set, or the list that is open. */
  const rows = useMemo(
    () => (current === null ? liked : resolvePlaylistItems(current, shelf)),
    [current, liked, shelf],
  );

  async function toggleLike(track: AudioTrack) {
    if (userId === null) {
      setNotice('LIKING A TRACK TAKES AN ACCOUNT - READING THE ARCHIVE DOES NOT.');
      return;
    }

    setBusy(track.id);
    setNotice(null);

    try {
      const { liked: nowLiked } = await repository.toggleLike(userId, track.id);
      setNotice(nowLiked ? `${track.title} LIKED.` : `${track.title} TAKEN BACK OUT OF LIKED.`);
      refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'THE LIBRARY DID NOT ANSWER.');
    } finally {
      setBusy(null);
    }
  }

  async function addToList(track: AudioTrack, list: Playlist) {
    if (userId === null) {
      setNotice('A PLAYLIST TAKES AN ACCOUNT.');
      return;
    }

    setBusy(track.id);
    setNotice(null);

    try {
      await repository.togglePlaylistTrack({ ownerId: userId, playlistId: list.id, trackId: track.id });
      refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'THE LIBRARY DID NOT ANSWER.');
    } finally {
      setBusy(null);
    }
  }

  async function makeList() {
    if (userId === null) {
      setNotice('A PLAYLIST TAKES AN ACCOUNT.');
      return;
    }

    const problem = validatePlaylistName(newName);
    if (problem !== undefined) {
      setNotice(problem);
      return;
    }

    try {
      const made = await repository.savePlaylist({ ownerId: userId, name: newName });
      setNewName('');
      setNaming(false);
      setOpenList(made.id);
      refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'THE LIBRARY DID NOT ANSWER.');
    }
  }

  async function dropList(list: Playlist) {
    if (userId === null) return;

    try {
      await repository.removePlaylist(userId, list.id);
      if (openList === list.id) setOpenList(null);
      refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'THE LIBRARY DID NOT ANSWER.');
    }
  }

  if (status === 'loading') {
    return <p className="p-3 text-[10px] font-bold text-ink">READING YOUR LIBRARY...</p>;
  }

  return (
    <section>
      {notice === null ? null : (
        <p className="mb-2 border border-ink bg-sun-pale px-2 py-1 text-[10px] font-bold text-ink" role="status">
          {notice}
        </p>
      )}

      {/* A guest can read all of this - the shelf is public - but nothing here can be written without an
          account, so the screen says which half needs one rather than failing at the write. */}
      {userId === null ? (
        <p className="mb-2 border border-ink bg-sun-pale px-2 py-1 text-[10px] font-bold text-ink">
          READING TAKES NO ACCOUNT. LIKING A TRACK AND KEEPING LISTS DOES.
        </p>
      ) : null}

      {/* The lists, with LIKED as the first entry: the one list everybody has, and the screen's default. */}
      <div className={PANEL}>
        <div className={TITLE_BAR}>
          <span>LISTS</span>
          <span>[ {playlists.length + 1} ]</span>
        </div>

        <ul className="divide-y divide-dotted divide-ink">
          <li>
            <ListRow
              label="LIKED"
              note={`${liked.length}`}
              selected={openList === null}
              onSelect={() => setOpenList(null)}
              symbol="♥"
            />
          </li>

          {playlists.map((list) => (
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
                lists={playlists}
                liked={isLiked(likes, track.id)}
                inOpenList={current === null ? false : isInPlaylist(current, track.id)}
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
