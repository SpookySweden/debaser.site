'use client';

import { useEffect, useRef } from 'react';
import { followState } from '../lib/audio/follow';
import {
  START_DELAY_MS,
  arrivalStep,
  arrivalVolume,
  findLoveBuzz,
  readArrival,
  startOnPress,
  writeArrival,
  type Busy,
} from '../lib/audio/love-buzz';
import { floatingState } from '../lib/ui/floating-player';
import { watchWindowState } from '../lib/watch/watch-window';
import { useMusicPlayer, type MusicPlayerValue } from './MusicPlayerProvider';

/**
 * LOVE BUZZ on arrival: the first page of a visit loads it into the bar, looping and quiet, and the reader's first click
 * or key press starts it, unless something else is playing by then (the rules: `app/lib/audio/love-buzz.ts`). Draws
 * nothing. Mounted once, beside the bar (./MusicPlayer.tsx).
 */

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function busyNow(player: MusicPlayerValue): Busy {
  return {
    playing: player.playing,
    screen: floatingState().entry !== null,
    room: player.room !== null || watchWindowState().open,
    following: followState().hostId !== null,
  };
}

export default function LoveBuzzOnArrival() {
  const player = useMusicPlayer();
  const latest = useRef(player);
  useEffect(() => {
    latest.current = player;
  }, [player]);

  const { loading, queue, track, assign, setVolume, volume } = player;
  const found = findLoveBuzz(queue);

  // Arrival: once the shelf has been read, once a visit.
  useEffect(() => {
    const storage = session();
    const step = arrivalStep(readArrival(storage), !loading, found !== undefined, busyNow(latest.current));
    if (step === 'wait' || step === 'none') return;
    if (step === 'skip' || found === undefined) {
      writeArrival(storage, 'skipped');
      return;
    }
    // Its own repeat (the track's, not the shelf's switch, which is the reader's and is kept as it was).
    assign(found, { loop: true });
    setVolume(arrivalVolume(volume));
    writeArrival(storage, 'loaded');
    // `volume` is read once, at this moment: the reader moving the slider later is theirs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, found, assign, setVolume]);

  // The first click or key press, anywhere: a moment later, LOVE BUZZ starts if nothing else did.
  const armed = readArrival(typeof window === 'undefined' ? null : session()) === 'loaded' && track !== undefined && track.src === found?.src;
  useEffect(() => {
    if (!armed) return;
    const press = () => {
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('keydown', press, true);
      // Not cleared if the press itself changes the bar (a song pressed): the decision still runs, sees it, and lets go.
      window.setTimeout(() => {
        const now = latest.current;
        const storage = session();
        const holds = now.track !== undefined && now.track.src === findLoveBuzz(now.queue)?.src && now.barrAsk === null;
        if (startOnPress(readArrival(storage), holds, busyNow(now))) {
          writeArrival(storage, 'started');
          now.toggle();
        } else {
          writeArrival(storage, 'skipped');
        }
      }, START_DELAY_MS);
    };
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('keydown', press, true);
    return () => {
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('keydown', press, true);
    };
  }, [armed]);

  return null;
}
