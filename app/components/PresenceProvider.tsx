'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  PRESENCE_AWAY_HIDDEN_MS,
  PRESENCE_AWAY_IDLE_MS,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_TICK_MS,
  presenceStatus,
  type LivePresence,
  type LiveState,
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

/** How long the lamps wait for the live room before falling back to the stored record. */
const LIVE_WAIT_MS = 3000;
/** How often an open tab checks whether it has gone untouched long enough to be away. */
const IDLE_CHECK_MS = 15 * 1000;
/** Anything a person does at the keyboard or the screen: each one counts as being in use. */
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/**
 * Presence for the whole site: who is around, and the heartbeat that keeps the
 * signed-in account's own record fresh.
 *
 * Mounted in `app/layout.tsx` under the auth provider, so it knows who is signed
 * in. Every tab listens to the live room (`subscribeLive`), which is what the
 * lamps are judged on. While somebody is signed in, this provider also:
 *
 *   - tells the room whether this tab is in use: active, or away once it has sat
 *     in the background for PRESENCE_AWAY_HIDDEN_MS or gone untouched for
 *     PRESENCE_AWAY_IDLE_MS, and active again on the first touch or look back;
 *   - writes "seen" as soon as they sign in, every minute after that, and every
 *     time the tab comes back to the front, which dates "LAST ONLINE ...";
 *   - writes "gone" and leaves the room when they sign out (closing the tab
 *     leaves the room by itself; the "gone" write is a best effort).
 *
 * Until the room has answered (or for LIVE_WAIT_MS, if it never does) no lamp is
 * drawn, so a stale stored record does not flash green first.
 */
export default function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // The id, not the object: auth hands over a fresh `user` on every token refresh and tab focus, and
  // re-running the heartbeat for each would leave the room and rejoin it (a red flash for everyone).
  const accountId = user?.id ?? null;
  const repository = useMemo(() => getProfileRepository(), []);
  const [records, setRecords] = useState<Record<string, PresenceRecord>>({});
  const [ready, setReady] = useState(false);
  // The clock the statuses are judged against: ticking means an open tab notices
  // when its own "online" window runs out, without needing another write.
  const [now, setNow] = useState(() => Date.now());
  const [live, setLive] = useState<LivePresence | null>(null);
  const [liveWaitOver, setLiveWaitOver] = useState(false);

  useEffect(() => repository.subscribeLive(setLive), [repository]);

  useEffect(() => {
    const timer = window.setTimeout(() => setLiveWaitOver(true), LIVE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);

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
    if (accountId === null) return;

    const beat = () => {
      void repository.markSeen(accountId).catch(() => undefined);
    };

    // What this tab last told the room, and when somebody last touched it.
    let state: LiveState | null = null;
    let lastInput = Date.now();
    let hiddenTimer: number | undefined;
    const say = (next: LiveState) => {
      if (next === state) return;
      state = next;
      repository.trackLive(accountId, next);
    };
    const visible = () => document.visibilityState === 'visible';

    beat();
    say(visible() ? 'active' : 'away');

    const timer = window.setInterval(beat, PRESENCE_HEARTBEAT_MS);
    const idleTimer = window.setInterval(() => {
      if (visible() && Date.now() - lastInput >= PRESENCE_AWAY_IDLE_MS) say('away');
    }, IDLE_CHECK_MS);
    const onInput = () => {
      lastInput = Date.now();
      if (visible()) say('active');
    };
    const onVisibility = () => {
      window.clearTimeout(hiddenTimer);
      if (visible()) {
        lastInput = Date.now();
        say('active');
        beat();
      } else {
        hiddenTimer = window.setTimeout(() => say('away'), PRESENCE_AWAY_HIDDEN_MS);
      }
    };
    const goodbye = () => {
      void repository.markOffline(accountId).catch(() => undefined);
    };
    // Back from the back/forward cache: the socket was dropped meanwhile, so say it all again.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      state = null;
      lastInput = Date.now();
      say(visible() ? 'active' : 'away');
      beat();
    };

    const inputOptions = { capture: true, passive: true } as const;
    for (const event of INPUT_EVENTS) window.addEventListener(event, onInput, inputOptions);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', goodbye);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      window.clearInterval(timer);
      window.clearInterval(idleTimer);
      window.clearTimeout(hiddenTimer);
      for (const event of INPUT_EVENTS) window.removeEventListener(event, onInput, inputOptions);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', goodbye);
      window.removeEventListener('pageshow', onPageShow);
      // Signing out, or closing the tab: leave the room and say goodbye either way.
      repository.untrackLive();
      goodbye();
    };
  }, [repository, accountId]);

  const value = useMemo<PresenceContextValue>(
    () => ({
      ready: ready && (live !== null || liveWaitOver),
      recordFor: (userId) => records[userId],
      statusFor: (userId) => presenceStatus(records[userId], now, live, userId),
    }),
    [ready, records, now, live, liveWaitOver],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

/**
 * Every account's lamp state at once.
 *
 * The users page needs the whole board of them - to sort by who is around and to
 * count them - so it takes the context value itself rather than one hook per name.
 * The value is re-derived when a record lands and when the clock ticks, so a page
 * reading it re-renders exactly when a lamp would change colour.
 */
export function usePresenceDirectory(): PresenceContextValue {
  const value = useContext(PresenceContext);
  if (value === null) throw new Error('usePresenceDirectory must be used inside <PresenceProvider>.');

  return value;
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
