'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { clampVolume, nextIndex, previousIndex, startIndexFor } from '../lib/audio/format';
import { getMusicRepository } from '../lib/audio/repository';
import type { AudioTrack } from '../lib/audio/tracks';
import { LOCAL_TRACKS, buildQueue } from '../lib/audio/tracks';

/**
 * The site's one audio element, and the queue it plays.
 *
 * Mounted in `app/layout.tsx`, above every page, so the music is never a page's
 * business: walking from the board to a profile to the music shelf does not interrupt
 * the track, because the element is not part of any of those pages - the same reason
 * the comms store and the presence store live up there. The bar that drives it is a
 * separate component (`./MusicPlayer.tsx`); this file is the state and the audio.
 *
 * Where the queue comes from is `getMusicRepository()`: the `mp3` bucket when Supabase
 * is configured (listed, so a track dropped in by hand is on the shelf at once), the
 * archive's own hand-filed manifest always. The bucket's tracks come first and the
 * player opens on one of them, which is what makes the file somebody just uploaded -
 * or dropped into the bucket - the thing that plays, looping, until they say
 * otherwise.
 *
 * Browsers refuse to start audio without a gesture, so this loads the first track and
 * waits: the bar says `[ PLAY ]` rather than pretending to be playing.
 */

export type MusicPlayerValue = {
  /** What is on the shelf, bucket first, with the archive's own tracks after it. */
  queue: AudioTrack[];
  track: AudioTrack | undefined;
  index: number;
  /** True while audio is running. */
  playing: boolean;
  /** False until the shelf has been read. */
  loading: boolean;
  /** The store's or the file's own words when something went wrong. */
  error: string | null;
  elapsed: number;
  duration: number;
  volume: number;
  /** True repeats one track; false walks on to the next when it ends. */
  loop: boolean;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  /** Plays a track, queueing it if the shelf does not hold it (a profile's song). */
  play: (track: AudioTrack) => void;
  /**
   * Hands over one track and leaves it there: the account page's own song, queued, set to
   * repeat, and - with `autoplay` - started at the first opportunity the browser allows.
   */
  assign: (track: AudioTrack, options?: { loop?: boolean; autoplay?: boolean }) => void;
  playAt: (index: number) => void;
  setVolume: (value: number) => void;
  setLoop: (value: boolean) => void;
  seek: (seconds: number) => void;
  /** Reads the shelf again, after an upload or a track dropped into the bucket. */
  refresh: () => void;
};

const MusicPlayerContext = createContext<MusicPlayerValue | null>(null);

/** Where the listener's own settings live, so the bar sounds the same next visit. */
const SETTINGS_KEY = 'debaser.audio.player.v1';

type StoredSettings = {
  volume: number;
  loop: boolean;
  /** The track that was on the display, so coming back lands on the same one. */
  src: string | null;
};

function loadSettings(): StoredSettings {
  const fallback: StoredSettings = { volume: 0.8, loop: true, src: null };

  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return fallback;

    const parsed = JSON.parse(raw) as Partial<StoredSettings>;

    return {
      volume: clampVolume(typeof parsed.volume === 'number' ? parsed.volume : fallback.volume),
      loop: typeof parsed.loop === 'boolean' ? parsed.loop : fallback.loop,
      src: typeof parsed.src === 'string' ? parsed.src : null,
    };
  } catch {
    return fallback;
  }
}

function persistSettings(settings: StoredSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: the settings hold for this visit only.
  }
}

export default function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** The src the element is already carrying, so it is only reloaded when it changes. */
  const loadedSrc = useRef<string | null>(null);
  /** The track on screen, for the shelf read: see the note beside that effect. */
  const playingSrc = useRef<string | undefined>(undefined);
  /** The track the last visit ended on, so this one opens there. */
  const storedSrc = useRef<string | null>(null);
  /**
   * True while a track was handed over with `autoplay` and the browser has not let it start
   * yet, so the first gesture can be spent on it (see `armAutoplay`).
   */
  const autoplayWanted = useRef(false);
  /** True once that first-gesture listener is in place, so there is only ever one. */
  const autoplayArmed = useRef(false);

  const [queue, setQueue] = useState<AudioTrack[]>(LOCAL_TRACKS);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [volume, setVolumeState] = useState(() => loadSettings().volume);
  const [loop, setLoopState] = useState(() => loadSettings().loop);
  /** Bumped by `refresh()`: the shelf is read again when it changes. */
  const [attempt, setAttempt] = useState(0);

  const track = queue[index];

  // The element itself: one per page load, created outside the render tree so nothing
  // a page does can remount it.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const onTime = () => setElapsed(audio.currentTime);
    const onDuration = () => setDuration(audio.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    // A new file: the readout goes back to zero here rather than in the effect that
    // assigns the source, so nothing writes state while React is rendering.
    const onLoadStart = () => {
      setElapsed(0);
      setDuration(Number.NaN);
      setError(null);
    };
    const onError = () =>
      setError(`THAT FILE COULD NOT BE PLAYED :: ${loadedSrc.current ?? 'no source'} - CHECK IT IS IN THE SHELF.`);

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('loadstart', onLoadStart);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('loadstart', onLoadStart);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.src = '';
      audioRef.current = null;
      loadedSrc.current = null;
    };
  }, []);

  // The shelf: the bucket's tracks first, then the archive's own.
  useEffect(() => {
    let cancelled = false;

    // Resolved once, on the client: the settings are read after hydration so the server
    // and the first render agree.
    if (storedSrc.current === null) storedSrc.current = loadSettings().src;

    getMusicRepository()
      .listTracks()
      .then((bucket) => {
        if (cancelled) return;
        const next = buildQueue(bucket);
        // What is playing is kept playing: the shelf is read again after an upload (and
        // on [ RELOAD SHELF ]), and a reload must not quietly switch the track underneath
        // the listener. Only when the track they were on is gone does the opening rule
        // apply - the bucket's own first, or the archive's theme.
        const wanted = playingSrc.current ?? storedSrc.current ?? undefined;

        setQueue(next);
        setIndex((current) => {
          const found = wanted === undefined ? -1 : next.findIndex((entry) => entry.src === wanted);
          if (found !== -1) return found;

          return current === 0 ? startIndexFor(next) : Math.min(current, next.length - 1);
        });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // The track that is playing, as a ref: the shelf read above needs it to keep the same
  // track playing across a reload, but reading it through the deps would re-read the
  // shelf every time the track changed.
  useEffect(() => {
    playingSrc.current = track?.src;
  }, [track]);

  /**
   * Spends the first gesture on a track that asked to start by itself.
   *
   * A page may not make a sound until the listener has touched it, which is why nothing here
   * plays on its own. A track handed over with `autoplay` - the account page's own song, on a
   * phone whose player is folded away - is the one case where waiting for a button press
   * loses the point of it, so the first touch or keypress anywhere starts it instead. The
   * listeners are one-shot and put in place at most once.
   */
  const armAutoplay = useCallback(() => {
    const audio = audioRef.current;
    if (autoplayArmed.current || audio === null) return;

    autoplayArmed.current = true;

    const start = () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      autoplayArmed.current = false;
      autoplayWanted.current = false;
      // Inside the gesture, so this one is allowed.
      void audio.play().catch(() => setPlaying(false));
      setPlaying(true);
    };

    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }, []);

  // Loading a track, and keeping the element in step with what the bar says.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) return;

    if (track !== undefined && loadedSrc.current !== track.src) {
      loadedSrc.current = track.src;
      audio.src = track.src;
      audio.load();
    }

    if (!playing) {
      audio.pause();
      return;
    }

    audio.play().catch(() => {
      // A track that was handed over to be started by itself is the one case where a
      // refusal is not the end of it: browsers allow sound after the listener has touched
      // the page, so the first touch or keypress is spent starting it (see `armAutoplay`).
      if (autoplayWanted.current) {
        setPlaying(false);
        armAutoplay();
        return;
      }

      // Otherwise: autoplay refused, or the file is not playable. Say so instead of showing
      // a pause button over silence.
      setPlaying(false);
      setError(
        track === undefined
          ? 'THERE IS NOTHING ON THE SHELF TO PLAY.'
          : `THE BROWSER WOULD NOT START "${track.title}" - PRESS PLAY AGAIN, OR CHECK THE FILE.`,
      );
    });
  }, [armAutoplay, playing, track]);

  // Ending: repeat this one, or walk on to the next. Looping is done here rather than
  // with the element's own `loop` attribute, because the switch means "repeat this
  // one" - with it off, the queue keeps going, which is what a shelf of demos wants.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) return;

    const onEnded = () => {
      if (loop) {
        audio.currentTime = 0;
        void audio.play().catch(() => setPlaying(false));
        return;
      }

      // Whatever the browser did with `paused` on the way here, the next track plays.
      setIndex((current) => nextIndex(current, queue.length));
      setPlaying(true);
    };

    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [loop, queue.length]);

  useEffect(() => {
    if (audioRef.current !== null) audioRef.current.volume = volume;
    persistSettings({ volume, loop, src: track?.src ?? null });
  }, [loop, track, volume]);

  /**
   * The system's own controls: media keys, a headset's buttons, and whatever a phone
   * puts on its lock screen.
   *
   * Not every browser has the Media Session API and none of this is required, so it is
   * all behind one check: with it, the site behaves like a music player rather than like
   * a page with a sound in it; without it, the bar is the only transport - which is where
   * this started.
   */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || track === undefined) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.credit.length === 0 ? 'DEBASER.SITE' : track.credit,
      album: track.kind,
    });

    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';

    navigator.mediaSession.setActionHandler('play', () => setPlaying(true));
    navigator.mediaSession.setActionHandler('pause', () => setPlaying(false));
    navigator.mediaSession.setActionHandler('nexttrack', () => setIndex((current) => nextIndex(current, queue.length)));
    navigator.mediaSession.setActionHandler('previoustrack', () =>
      setIndex((current) => previousIndex(current, queue.length)),
    );
  }, [playing, queue.length, track]);


  const toggle = useCallback(() => {
    setError(null);

    if (track === undefined) {
      setError('THERE IS NOTHING ON THE SHELF TO PLAY YET.');
      return;
    }

    setPlaying((current) => !current);
  }, [track]);

  const next = useCallback(() => {
    setError(null);
    setIndex((current) => nextIndex(current, queue.length));
  }, [queue.length]);

  const previous = useCallback(() => {
    setError(null);
    setIndex((current) => previousIndex(current, queue.length));
  }, [queue.length]);

  const playAt = useCallback(
    (target: number) => {
      setError(null);
      setIndex(Math.min(Math.max(target, 0), Math.max(queue.length - 1, 0)));
      setPlaying(true);
    },
    [queue.length],
  );

  /**
   * Plays one particular track.
   *
   * A track the shelf holds is simply selected; one it does not (a profile's own song,
   * handed over by the button beside it) is queued first, so pressing play on a profile
   * plays that song rather than the shelf's next track.
   */
  const play = useCallback(
    (wanted: AudioTrack) => {
      const found = queue.findIndex((entry) => entry.src === wanted.src);

      if (found === -1) {
        const nextQueue = [...queue, wanted];
        setQueue(nextQueue);
        setIndex(nextQueue.length - 1);
      } else {
        setIndex(found);
      }

      setError(null);
      setPlaying(true);
    },
    [queue],
  );

  const setVolume = useCallback((value: number) => setVolumeState(clampVolume(value)), []);
  const setLoop = useCallback((value: boolean) => setLoopState(value), []);

  /**
   * Hands the player one track and leaves it there: the account page's own song, on a phone
   * that has the bar folded away.
   *
   * The track is queued if the shelf does not hold it, `loop` sets the repeat switch, and
   * `autoplay` asks for it to start on its own. A browser will not make a sound before the
   * listener has touched the page, so a refusal is not reported as an error here: it is
   * remembered, and the first touch or keypress anywhere starts it (see `armAutoplay`).
   */
  const assign = useCallback(
    (wanted: AudioTrack, options?: { loop?: boolean; autoplay?: boolean }) => {
      setError(null);

      if (options?.loop !== undefined) setLoopState(options.loop);

      const found = queue.findIndex((entry) => entry.src === wanted.src);

      if (found === -1) {
        const nextQueue = [...queue, wanted];
        setQueue(nextQueue);
        setIndex(nextQueue.length - 1);
      } else {
        setIndex(found);
      }

      if (options?.autoplay === true) {
        autoplayWanted.current = true;
        setPlaying(true);
      }
    },
    [queue],
  );

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (audio === null || !Number.isFinite(seconds)) return;

    audio.currentTime = seconds;
    setElapsed(seconds);
  }, []);

  const refresh = useCallback(() => setAttempt((current) => current + 1), []);

  const value = useMemo<MusicPlayerValue>(
    () => ({
      queue,
      track,
      index,
      playing,
      loading,
      error,
      elapsed,
      duration,
      volume,
      loop,
      toggle,
      next,
      previous,
      play,
      assign,
      playAt,
      setVolume,
      setLoop,
      seek,
      refresh,
    }),
    [
      queue,
      track,
      index,
      playing,
      loading,
      error,
      elapsed,
      duration,
      volume,
      loop,
      toggle,
      next,
      previous,
      play,
      assign,
      playAt,
      setVolume,
      setLoop,
      seek,
      refresh,
    ],
  );

  return <MusicPlayerContext.Provider value={value}>{children}</MusicPlayerContext.Provider>;
}

/** The player, for the bar and for anything that hands it a song. */
export function useMusicPlayer(): MusicPlayerValue {
  const value = useContext(MusicPlayerContext);
  if (value === null) throw new Error('useMusicPlayer must be used inside <MusicPlayerProvider>.');

  return value;
}
