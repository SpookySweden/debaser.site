'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { calibrateClock, resolveQueueTrack, type BroadcastQueue } from '../lib/audio/broadcast';
import {
  followState,
  followStep,
  setCatchingUp,
  stopFollowing,
  subscribeToFollow,
} from '../lib/audio/follow';
import { QUEUES_LIST_HREF } from '../lib/audio/queue-window';
import { webTrackNow } from '../lib/web/web-track-lookup';
import { queueContext } from '../lib/audio/track-context';
import { getMusicRepository } from '../lib/audio/repository';
import { useAuth } from './AuthProvider';
import ForYouRadio from './ForYouRadio';
import { useMusicPlayer } from './MusicPlayerProvider';

/**
 * Keeps this player locked to the queue it is following (`follow.ts` says what following means).
 *
 * Drawn once by the shell, beside `BroadcastHeartbeat`, for the same reason: a follow has to keep going
 * whether or not the queue window is open, and a component inside the window would stop steering the
 * moment the reader closed it - which is what happened to the old catch-up, whose speed lived in the
 * card and was handed back to 1x when the card shut.
 *
 * Once a second it reads the host's row and the player's clock, asks `followStep` what to do, and does
 * it. The host's row arrives by realtime; the clock is read out of a ref, because `elapsed` changes
 * several times a second and an effect depending on it would rebuild the timer before it ever fired.
 */
export default function QueueFollower() {
  const follow = useSyncExternalStore(subscribeToFollow, followState, followState);
  const player = useMusicPlayer();
  const repository = getMusicRepository();
  const hostId = follow.hostId;
  const listenerId = useAuth().user?.id ?? null;

  /** The host's row as last read: undefined until the first read lands, null once it is known gone. */
  const [host, setHost] = useState<BroadcastQueue | null | undefined>(undefined);

  useEffect(() => {
    if (hostId === null) return;

    let cancelled = false;

    const read = (fresh: boolean) => {
      void repository
        .listQueues()
        .then((queues) => {
          if (cancelled) return;
          // A read answering a realtime change holds a row written a moment ago - which is what the
          // clock-skew estimate is made from (`calibrateClock`).
          if (fresh) calibrateClock(queues, Date.now());
          setHost(queues.find((queue) => queue.userId === hostId) ?? null);
        })
        .catch(() => {
          // A failed read is not a host who left: the next change or tick tries again, and ending a
          // follow over one dropped request would be the player giving up on a flaky network.
        });
    };

    read(false);

    // Realtime says *when* the row moved; the slow poll is the net under it, because a channel that
    // drops quietly would otherwise leave the follower steering by a row from minutes ago.
    const unsubscribe = repository.subscribeToQueues(() => read(true));
    const poll = window.setInterval(() => read(false), 15000);

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(poll);
      setHost(undefined);
    };
  }, [hostId, repository]);

  // The listen-along log (SPEC-vanity.md step 5, `music_follows_log`): one entry per follow, its end
  // moved to now every minute so a tab that closes mid-follow still leaves the time it spent.
  useEffect(() => {
    if (hostId === null || listenerId === null || hostId === listenerId) return;

    let entry: string | null = null;
    let over = false;

    void repository.startFollowLog(listenerId, hostId).then((id) => {
      entry = id;
      if (over && id !== null) void repository.stampFollowLog(listenerId, id);
    });
    const stamp = window.setInterval(() => {
      if (entry !== null) void repository.stampFollowLog(listenerId, entry);
    }, 60000);

    return () => {
      over = true;
      window.clearInterval(stamp);
      if (entry !== null) void repository.stampFollowLog(listenerId, entry);
    };
  }, [hostId, listenerId, repository]);

  /** What the tick reads: the newest player and row, without being in the timer's dependencies. */
  const latest = useRef({ player, host });

  useEffect(() => {
    latest.current = { player, host };
  }, [player, host]);

  useEffect(() => {
    if (hostId === null) return;

    const tick = () => {
      const { player: now, host: row } = latest.current;
      // Not read yet - or still the *previous* host's row, in the moment after switching who is
      // followed, before the new one's read has landed.
      if (row === undefined || (row !== null && row.userId !== hostId)) return;

      const step = followStep(
        row,
        { src: now.track?.src ?? null, seconds: now.elapsed, duration: now.duration, playing: now.playing },
        Date.now(),
        followState().catchingUp,
      );

      if (step.kind === 'lost') {
        now.setPlaybackRate(1);
        stopFollowing(step.reason);
        return;
      }

      if (step.load && row !== null) {
        // A WEB track the host is playing is on nobody's shelf: it is put back together from its address
        // (web-track-lookup.ts). While that answer is on its way, this tick waits and the next one tries.
        const onShelf = resolveQueueTrack(row, now.queue);
        const web = onShelf === undefined ? webTrackNow(row.trackId) : null;
        if (web === undefined) return;
        const track = onShelf ?? web ?? undefined;

        if (track === undefined) {
          now.setPlaybackRate(1);
          stopFollowing('FILE NOT HERE');
          return;
        }

        now.play(
          track,
          {
            origin: 'queue',
            href: QUEUES_LIST_HREF,
            where: 'THE QUEUES LIST',
            context: queueContext(followState().hostName),
          },
          { at: step.at, rate: 1, follow: true },
        );
        if (!step.playing) now.steer(false);
        setCatchingUp(false);
        return;
      }

      if (step.at !== undefined) now.seek(step.at, { follow: true });
      if (Math.abs(now.playbackRate - step.rate) > 0.05) now.setPlaybackRate(step.rate);
      if (now.playing !== step.playing) now.steer(step.playing);

      setCatchingUp(step.catchingUp);
    };

    tick();

    const timer = window.setInterval(tick, 1000);

    return () => window.clearInterval(timer);
  }, [hostId]);

  // A follow that ends - for whatever reason - hands the speed back. The player is shared with every
  // profile song and the shelf, and a rate left at 2x would run all of them fast with nothing on screen
  // to say why.
  const setRate = player.setPlaybackRate;

  useEffect(() => {
    if (hostId === null) return;

    return () => setRate(1);
  }, [hostId, setRate]);

  // PLAY FOR YOU rides along here: the other always-drawn helper that steers the player.
  return <ForYouRadio />;
}
