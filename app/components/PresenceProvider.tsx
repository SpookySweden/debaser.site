'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_TICK_MS,
  presenceStatus,
  type PresenceRecord,
  type PresenceStatus,
} from '../lib/profile/presence';
import { getProfileRepository } from '../lib/profile/repository';
import { useAuth } from './AuthProvider';

export type PresenceContextValue = {
  /** False until the first read lands: names draw no lamp before that. */
  ready: boolean;
  recordFor: (userId: string) => PresenceRecord | undefined;
  statusFor: (userId: string) => PresenceStatus;
};

const PresenceContext = createContext<PresenceContextValue | null>(null);

/**
 * Presence for the whole site: who is around, and the heartbeat that keeps the
 * signed-in account's own record fresh.
 *
 * Mounted in `app/layout.tsx` under the auth provider, so it knows who is signed
 * in. While somebody is, this provider:
 *
 *   - writes "seen" as soon as they sign in, every minute after that, and every
 *     time the tab comes back to the front;
 *   - writes "gone" when the tab closes or they sign out;
 *   - re-reads the whole store on every change and re-checks the clock on a timer,
 *     so a dot that goes stale fades from green to yellow to red on its own.
 *
 * The store is the profile repository (`markSeen` / `listPresence` / ...), which
 * is the seam Supabase slots into: same provider, same hook, real cross-visitor
 * presence. Until then the mock store only knows this browser, and only hears
 * about writes made in this tab - so today the green lamp is your own.
 */
export default function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const repository = useMemo(() => getProfileRepository(), []);
  const [records, setRecords] = useState<Record<string, PresenceRecord>>({});
  const [ready, setReady] = useState(false);
  // The clock the statuses are judged against: ticking means an open tab notices
  // when its own "online" window runs out, without needing another write.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    const apply = (snapshot: PresenceRecord[]) => {
      if (cancelled) return;
      setRecords(Object.fromEntries(snapshot.map((record) => [record.userId, record])));
      setReady(true);
    };

    const unsubscribe = repository.subscribePresence(apply);

    void repository
      .listPresence()
      .then(apply)
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repository]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), PRESENCE_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (user === null) return;

    const accountId = user.id;
    const beat = () => {
      void repository.markSeen(accountId).catch(() => undefined);
    };

    beat();

    const timer = window.setInterval(beat, PRESENCE_HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat();
    };
    const goodbye = () => {
      void repository.markOffline(accountId).catch(() => undefined);
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', goodbye);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', goodbye);
      // Signing out, or closing the tab: say goodbye either way.
      goodbye();
    };
  }, [repository, user]);

  const value = useMemo<PresenceContextValue>(
    () => ({
      ready,
      recordFor: (userId) => records[userId],
      statusFor: (userId) => presenceStatus(records[userId], now),
    }),
    [ready, records, now],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export type UsePresenceResult = {
  /** Undefined until the first read lands, and for anybody without an account. */
  status: PresenceStatus | undefined;
  record: PresenceRecord | undefined;
};

/**
 * One account's lamp state.
 *
 * Guests pass `null` and get nothing back: presence is an account thing, and an
 * anonymous post has no account to be online with.
 */
export function usePresence(userId: string | null): UsePresenceResult {
  const value = useContext(PresenceContext);
  if (value === null) throw new Error('usePresence must be used inside <PresenceProvider>.');

  if (userId === null) return { status: undefined, record: undefined };

  return {
    status: value.ready ? value.statusFor(userId) : undefined,
    record: value.recordFor(userId),
  };
}
