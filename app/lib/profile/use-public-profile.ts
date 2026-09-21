'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { emptyProfile } from './mock-profile-repository';
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

/**
 * Reads one profile and keeps it in sync.
 *
 * The shell profile is used until the stored row arrives, so a visitor opening
 * a profile nobody has filled in sees the empty state rather than a spinner,
 * and the owner's customiser can write to it straight away.
 */
export function usePublicProfile(userId: string | null): UsePublicProfileResult {
  const repository = useMemo(() => getProfileRepository(), []);
  const [stored, setStored] = useState<PublicProfile | null>(null);
  const [ready, setReady] = useState(userId === null);
  const [fallbackName, setFallbackName] = useState('Anonymous');

  const refresh = useCallback(async () => {
    if (userId === null) return;

    const next = await repository.getProfile(userId);
    setStored(next);
  }, [repository, userId]);

  useEffect(() => {
    if (userId === null) return;

    let cancelled = false;

    void repository
      .getProfile(userId)
      .then((next) => {
        if (cancelled) return;
        setStored(next);
        if (next !== null) setFallbackName(next.displayName);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    const unsubscribe = repository.subscribe((profile) => {
      if (!cancelled && profile.userId === userId) {
        setStored(profile);
        setFallbackName(profile.displayName);
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repository, userId]);

  const profile = stored ?? emptyProfile(userId ?? 'anonymous', fallbackName);

  return { profile, ready, source: repository.source, repository, refresh };
}
