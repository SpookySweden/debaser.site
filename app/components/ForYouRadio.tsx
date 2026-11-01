'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { followState, subscribeToFollow } from '../lib/audio/follow';
import { radioRound } from '../lib/audio/for-you';
import { RADIO_MEMORY, noteHanded, radioState, stopRadio, subscribeToRadio } from '../lib/audio/radio';
import { useMusicLibrary } from './MusicLibraryProvider';
import { useMusicPlayer } from './MusicPlayerProvider';

/** Top up when fewer than this many songs wait in up-next. */
const LOW_WATER = 2;

/**
 * Keeps PLAY FOR YOU going (`lib/audio/radio.ts` says what it is). Renders nothing.
 *
 * While the radio runs: when up-next runs low it adds a round drawn from the pool (barred songs and the
 * last few played left out), and when the player moves to a song the radio did not hand it, or a follow
 * starts, the radio stops. Only a *change* of song is read, so the render between the key's press and
 * the player catching up does not stop it.
 */
export default function ForYouRadio() {
  const radio = useSyncExternalStore(subscribeToRadio, radioState, radioState);
  const following = useSyncExternalStore(subscribeToFollow, followState, followState).hostId !== null;
  const player = useMusicPlayer();
  const { barredSrcs } = useMusicLibrary();
  const src = player.track?.src;
  const lastSrc = useRef(src);

  // Listening along is somebody else's queue: the radio steps aside (even when the host plays a song the
  // radio once handed over, which the song test below would let through).
  useEffect(() => {
    if (following) stopRadio();
  }, [following]);

  useEffect(() => {
    if (lastSrc.current === src) return;
    lastSrc.current = src;
    if (radio.on && src !== undefined && !radio.handed.includes(src)) stopRadio();
  }, [radio, src]);

  const { enqueue, upNext } = player;
  const { on, pool } = radio;
  useEffect(() => {
    if (!on || upNext.length >= LOW_WATER) return;

    // Never a barred song, and never one already waiting - which also ends the top-up when a tiny pool
    // has nothing new left, rather than adding the same song round after round. What was handed is read
    // from the store, not a dependency: noting a round must not run this again before its songs land.
    const waiting = new Set(upNext.map((track) => track.src));
    const fresh = pool.filter((pick) => !barredSrcs.has(pick.key) && !waiting.has(pick.key));
    const round = radioRound(fresh, new Set(radioState().handed.slice(-RADIO_MEMORY)), Math.random);
    if (round.length === 0) return;

    for (const pick of round) enqueue(pick.track, 'end');
    noteHanded(round.map((pick) => pick.key));
  }, [on, pool, upNext, barredSrcs, enqueue]);

  return null;
}
