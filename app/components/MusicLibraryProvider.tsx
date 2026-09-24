'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LikedTrack, Playlist } from '../lib/audio/library';
import { getMusicRepository } from '../lib/audio/repository';
import { useAuth } from './AuthProvider';

/**
 * The reader's own music, read once for the whole site.
 *
 * This exists because two screens need the same two facts. `./PersonalLibrary.tsx` draws them, and
 * `./MusicDirectory.tsx` needs them so a row in the *archive* can wear a heart and be liked without the
 * reader switching screens. That second need is what settled the shape: the archive's rows live under a
 * recursive folder tree of memoised components, so handing likes down as props would mean threading them
 * through every `FolderBranch` - and, worse, a new identity for the array on every read would defeat the
 * `memo` on every row in the tree.
 *
 * So this is a provider, like the five that already hang off `./layout.tsx`, and it holds:
 *
 *   - the `Set` of liked ids, built once here rather than scanned per row (`isLiked` is linear, so asking
 *     it per row is quadratic in the length of the list);
 *   - the playlists, so a row can offer them;
 *   - `answered`, so a screen can tell "you have liked nothing" from "the database did not answer" -
 *     two sentences that draw the same empty panel and mean very different things;
 *   - and `toggleLike`, which writes and then re-reads, so the heart cannot drift out of step.
 *
 * A guest is not read for at all: `userId` is null, everything is empty, and a write throws with the
 * sentence a caller can show. That keeps "who may write this" in one place rather than in each caller.
 */
type MusicLibraryValue = {
  /** Whether this reader's likes and lists could be read. False draws a fault, not an empty list. */
  answered: boolean;
  /** True until the first read settles, so a screen can say it is reading rather than that it is empty. */
  loading: boolean;
  likedIds: Set<string>;
  /** The stored likes themselves, for a screen that needs the timestamps as well as the membership. */
  likes: LikedTrack[];
  playlists: Playlist[];
  /** A signed-in reader; false for a guest, who has no library to write to. */
  canWrite: boolean;
  /** Hearts or un-hearts. Throws with a sentence fit to show if it could not be written. */
  toggleLike: (trackId: string) => Promise<{ liked: boolean }>;
  /** Puts a track into a list, or takes it out if it is already there. */
  togglePlaylistTrack: (playlistId: string, trackId: string) => Promise<void>;
  /** Makes a list, or edits the one with the same derived id. */
  savePlaylist: (name: string) => Promise<Playlist>;
  /** Takes a list away. */
  removePlaylist: (playlistId: string) => Promise<void>;
  /** Reads everything again, after something outside this provider changed the shelf. */
  reload: () => void;
};

const NO_ACCOUNT = 'LIKING A TRACK AND KEEPING LISTS TAKES AN ACCOUNT.';

const EMPTY: MusicLibraryValue = {
  answered: true,
  loading: true,
  likedIds: new Set(),
  likes: [],
  playlists: [],
  canWrite: false,
  toggleLike: async () => {
    throw new Error(NO_ACCOUNT);
  },
  togglePlaylistTrack: async () => {
    throw new Error(NO_ACCOUNT);
  },
  savePlaylist: async () => {
    throw new Error(NO_ACCOUNT);
  },
  removePlaylist: async () => {
    throw new Error(NO_ACCOUNT);
  },
  reload: () => {},
};

const MusicLibraryContext = createContext<MusicLibraryValue>(EMPTY);

export function useMusicLibrary(): MusicLibraryValue {
  return useContext(MusicLibraryContext);
}

export default function MusicLibraryProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const repository = useMemo(() => getMusicRepository(), []);
  const userId = user?.id ?? null;

  const [likes, setLikes] = useState<LikedTrack[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [answered, setAnswered] = useState(true);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // Nothing to read until the session has settled. This is a guard rather than a render gate: a guest
    // genuinely has no library, and reading for one would be a round trip thrown away the moment they
    // sign in. `./GuestPrompt.tsx` makes the same distinction.
    if (status === 'loading') return;

    let alive = true;

    void (async () => {
      const [readLikes, readPlaylists] = await Promise.all([
        userId === null
          ? Promise.resolve({ items: [] as LikedTrack[], answered: true })
          : repository.listLikes(userId),
        userId === null
          ? Promise.resolve({ items: [] as Playlist[], answered: true })
          : repository.listPlaylists(userId),
      ]);

      if (!alive) return;

      setLikes(readLikes.items);
      setPlaylists(readPlaylists.items);
      setAnswered(readLikes.answered && readPlaylists.answered);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [reloadToken, repository, status, userId]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  /**
   * Every write follows the same shape: refuse if there is nobody to write as, write, then read again.
   *
   * Re-reading rather than patching the local list is deliberate. The write may have been adjusted by the
   * database - a unique key, a policy, a trigger - and the only honest way to draw the result is to ask
   * what it now holds. It is one round trip on a press, which is the right price for a heart that is
   * never wrong.
   */
  const toggleLike = useCallback(
    async (trackId: string) => {
      if (userId === null) throw new Error(NO_ACCOUNT);

      const result = await repository.toggleLike(userId, trackId);
      reload();

      return result;
    },
    [reload, repository, userId],
  );

  const togglePlaylistTrack = useCallback(
    async (playlistId: string, trackId: string) => {
      if (userId === null) throw new Error(NO_ACCOUNT);

      await repository.togglePlaylistTrack({ ownerId: userId, playlistId, trackId });
      reload();
    },
    [reload, repository, userId],
  );

  const savePlaylist = useCallback(
    async (name: string) => {
      if (userId === null) throw new Error(NO_ACCOUNT);

      const made = await repository.savePlaylist({ ownerId: userId, name });
      reload();

      return made;
    },
    [reload, repository, userId],
  );

  const removePlaylist = useCallback(
    async (playlistId: string) => {
      if (userId === null) throw new Error(NO_ACCOUNT);

      await repository.removePlaylist(userId, playlistId);
      reload();
    },
    [reload, repository, userId],
  );

  /**
   * The `Set` of liked ids, built once per read rather than per row.
   *
   * This is the memo that keeps the archive's `memo`ed rows memoised: the identity of this set changes
   * only when the likes do, so folding a folder or typing in the search box does not hand every row a
   * new answer and redraw the whole tree.
   */
  const likedIds = useMemo(() => new Set(likes.map((like) => like.trackId)), [likes]);

  const value = useMemo<MusicLibraryValue>(
    () => ({
      answered,
      loading,
      likedIds,
      likes,
      playlists,
      canWrite: userId !== null,
      toggleLike,
      togglePlaylistTrack,
      savePlaylist,
      removePlaylist,
      reload,
    }),
    [
      answered,
      likedIds,
      likes,
      loading,
      playlists,
      removePlaylist,
      reload,
      savePlaylist,
      toggleLike,
      togglePlaylistTrack,
      userId,
    ],
  );

  return <MusicLibraryContext.Provider value={value}>{children}</MusicLibraryContext.Provider>;
}
