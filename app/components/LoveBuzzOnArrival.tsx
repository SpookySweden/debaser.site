'use client';

import { useEffect, useRef } from 'react';
import { followState } from '../lib/audio/follow';
import {
  RESTORE_KEY,
  START_DELAY_MS,
  arrivalStep,
  arrivalVolume,
  findLoveBuzz,
  readArrival,
  startOnPress,
  volumeStep,
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

/**
 * Whether the press just made counts as the reader touching the page, so sound may start. Read inside the press's own
 * listener: the browser has already decided by then. A browser that cannot say (an old Safari) is taken at its word.
 */
function pressCounts(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation === undefined || activation.hasBeenActive;
}

function busyNow(player: MusicPlayerValue): Busy {
  return {
    playing: player.playing,
    screen: floatingState().entry !== null,
    room: player.room !== null || watchWindowState().open,
    following: followState().hostId !== null,
    // A page handed the bar its own song with where it came from (a profile's song, waiting for a press): theirs.
    // (`heardFrom` is only ever about the song on the bar now.)
    handedOver: player.track !== undefined && player.heardFrom !== null,
  };
}

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readWaitingVolume(): number | null {
  try {
    const raw = local()?.getItem(RESTORE_KEY) ?? null;
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

function setWaitingVolume(value: number | null): void {
  try {
    if (value === null) local()?.removeItem(RESTORE_KEY);
    else local()?.setItem(RESTORE_KEY, String(value));
  } catch {
    // Storage blocked: the volume comes back only by the reader's hand.
  }
}

export default function LoveBuzzOnArrival() {
  const player = useMusicPlayer();
  const latest = useRef(player);
  useEffect(() => {
    latest.current = player;
  }, [player]);

  const { loading, queue, track, assign, setVolume, volume } = player;
  // (The volume it plays at is set at the press, below, never on arrival: a reader who never touches the page keeps theirs.)
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
    // Its own repeat (the track's, not the shelf's switch, which is the reader's and is kept as it was). Filed as the
    // shelf's when it is heard, not as somebody's profile song.
    assign(found, { loop: true, origin: { origin: 'shelf', where: 'ARRIVING ON THE SITE' } });
    writeArrival(storage, 'loaded');
  }, [loading, found, assign]);

  // The reader's own volume, given back once LOVE BUZZ is no longer the song this visit started (or on a new visit after
  // a tab closed mid-song), unless they moved the slider themself.
  const loveBuzzOn = track !== undefined && track.src === found?.src;
  useEffect(() => {
    const started = readArrival(session()) === 'started';
    const step = volumeStep(readWaitingVolume(), loveBuzzOn && started, volume);
    if (step === 'restore') setVolume(readWaitingVolume() ?? volume);
    if (step === 'restore' || step === 'drop') setWaitingVolume(null);
  }, [loveBuzzOn, volume, setVolume]);

  // The first click or key press, anywhere: a moment later, LOVE BUZZ starts if nothing else did.
  const armed = readArrival(typeof window === 'undefined' ? null : session()) === 'loaded' && track !== undefined && track.src === found?.src;
  useEffect(() => {
    if (!armed) return;
    const press = () => {
      // A press the browser does not count as the reader touching the page (Shift, Ctrl and the other modifier keys on
      // their own) would be refused sound: it is not spent on that, and the next real press is waited for.
      if (!pressCounts()) return;
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('keydown', press, true);
      // Not cleared if the press itself changes the bar (a song pressed): the decision still runs, sees it, and lets go.
      window.setTimeout(() => {
        const now = latest.current;
        const storage = session();
        const holds = now.track !== undefined && now.track.src === findLoveBuzz(now.queue)?.src && now.barrAsk === null;
        // LOVE BUZZ was handed over by this very component: that is not somebody else's song holding the bar.
        if (startOnPress(readArrival(storage), holds, { ...busyNow(now), handedOver: false })) {
          writeArrival(storage, 'started');
          // Quietly: the reader's own volume waits and comes back with the next song.
          const quiet = arrivalVolume(now.volume);
          if (quiet < now.volume) {
            setWaitingVolume(now.volume);
            now.setVolume(quiet);
          }
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
