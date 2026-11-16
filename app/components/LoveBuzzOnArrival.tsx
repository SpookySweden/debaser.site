'use client';

import { useEffect, useRef } from 'react';
import { followState } from '../lib/audio/follow';
import {
  RESTORE_KEY,
  arrivalStep,
  arrivalVolume,
  findLoveBuzz,
  onBarPlaying,
  readArrival,
  volumeStep,
  writeArrival,
  type Busy,
} from '../lib/audio/love-buzz';
import { floatingState } from '../lib/ui/floating-player';
import { watchWindowState } from '../lib/watch/watch-window';
import { useMusicPlayer, type MusicPlayerValue } from './MusicPlayerProvider';

/**
 * LOVE BUZZ on arrival: the first page of a visit loads it into the bar, looping, and it waits there: only the reader's
 * own PLAY starts it, quietly (the rules: `app/lib/audio/love-buzz.ts`). Draws
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

  // Nothing plays on site start (list 4): only the reader's own PLAY starts it. The moment the bar plays, the visit
  // settles: LOVE BUZZ made quiet (the reader's own volume waits and comes back with the next song), or another song let go.
  const { playing } = player;
  useEffect(() => {
    const storage = session();
    const step = onBarPlaying(readArrival(storage), loveBuzzOn, playing);
    if (step === null) return;
    writeArrival(storage, step);
    if (step !== 'started') return;
    const now = latest.current;
    const quiet = arrivalVolume(now.volume);
    if (quiet < now.volume) {
      setWaitingVolume(now.volume);
      now.setVolume(quiet);
    }
  }, [loveBuzzOn, playing]);

  return null;
}
