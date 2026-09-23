'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { emptyProfile } from './mock-profile-repository';
import { profileRecord, readProfile, rememberProfile, subscribeToProfile } from './profile-cache';
import type { CachedProfile } from './profile-cache';
import { getProfileRepository } from './repository';
import type { ProfileDataSource, PublicProfile } from './types';

export type UsePublicProfileResult = {
  /** Never null once ready: an untouched profile renders as an empty shell. */
  profile: PublicProfile;
  ready: boolean;
  source: ProfileDataSource;
  repository: ReturnType<typeof getProfileRepository>;
  /** Re-reads the stored row (used after the owner saves in the customiser). */
  refresh: () => Promise<void>;
};

/** Nobody to read: nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

/** What a reader that has been asked for nothing sees: the same object every time, by design. */
const EMPTY_RECORD: CachedProfile = { profile: null, status: 'unread' };

/**
 * Reads one profile and keeps it in sync.
 *
 * The row comes from the tab's profile cache (`./profile-cache`), so a component that mounts
 * later - after a navigation, or as the tenth avatar on one page - draws the picture on its
 * **first** render instead of an empty shell that fills in a moment afterwards. The first
 * reader of an account is the one that goes and gets it; every other reader waits on that same
 * request rather than making its own.
 *
 * A profile nobody has read yet draws as the empty shell rather than a spinner, so a visitor
 * opening a profile nobody has filled in sees the empty state, and the owner's customiser can
 * write to it straight away.
 */
export function usePublicProfile(userId: string | null): UsePublicProfileResult {
  const repository = useMemo(() => getProfileRepository(), []);

  const subscribe = useCallback(
    (listener: () => void) => (userId === null ? subscribeToNothing() : subscribeToProfile(userId, listener)),
    [userId],
  );

  const cached = useSyncExternalStore(
    subscribe,
    useCallback(
      () => (userId === null ? EMPTY_RECORD : profileRecord(userId)),
      [userId],
    ),
    // The server has read nothing, so it draws the shell and the client fills it in - which is
    // what useSyncExternalStore is for: no hydration complaint, no flicker afterwards.
    () => EMPTY_RECORD,
  );

  useEffect(() => {
    if (userId === null) return;

    // The first reader fetches; the cache answers everyone else.
    void readProfile(repository, userId);

    // A write anywhere - the customiser here, the same account in another tab, another device
    // - arrives as a whole row, so what is remembered is what the store now holds.
    return repository.subscribe((next) => {
      if (next.userId === userId) rememberProfile(next);
    });
  }, [repository, userId]);

  const refresh = useCallback(async () => {
    if (userId === null) return;

    await readProfile(repository, userId, { force: true });
  }, [repository, userId]);

  const profile = cached.profile ?? emptyProfile(userId ?? 'anonymous', 'Anonymous');

  return { profile, ready: userId === null || cached.status !== 'unread', source: repository.source, repository, refresh };
}
