'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { PLATE_ON_BLACK } from '../lib/ui/controls';
import { floatingClock, orderFloating, subscribeToFloatingClock, togglePlayerFullscreen } from '../lib/ui/floating-player';
import { formatMediaTime } from '../lib/watch/rules';
import { SpeakerKey } from './StreamBarKeys';

const noClock = () => null;

/**
 * The site's own keys along the foot of the floating player's fullscreen box, for another site's player that takes orders
 * (YouTube, Vimeo): play, where it is, sound, and the way out (SPEC-rooms-your-room.md, part 4). They are there because a
 * frame trimmed of its bars is trimmed of its own controls too, which sit along the same edges; a live room's fullscreen
 * has always had the room's bar for the same reason. They drive the player by the same orders as the keys under your
 * room's screen (`OwnRoomWindow.tsx`), and show what the player says back, never what was last asked of it.
 *
 * Its own component, so the clock (a few ticks a second) redraws these keys and not the player's layer.
 */
export default function FloatingStageBar({ play }: { play: number }) {
  const clock = useSyncExternalStore(subscribeToFloatingClock, floatingClock, noClock);
  // A player that has said nothing yet is not known to be playing: the key reads PLAY, and a press asks it to play.
  const paused = clock?.paused ?? true;
  const seconds = clock?.seconds ?? 0;
  const length = clock?.duration ?? Number.NaN;
  const duration = Number.isFinite(length) && length > 0 ? length : 0;

  /** What this bar last asked of the sound, kept against the PLAY it was asked of: a new video starts as its player has it. */
  const [soundAsked, setSoundAsked] = useState<{ play: number; volume: number; muted: boolean } | null>(null);
  const asked = soundAsked !== null && soundAsked.play === play ? soundAsked : null;
  const volume = asked?.volume ?? clock?.volume ?? 1;
  const muted = asked?.muted ?? clock?.muted ?? false;
  const askedVolume = asked?.volume;
  const askedMuted = asked?.muted;
  useEffect(() => {
    if (askedVolume !== undefined && askedMuted !== undefined) orderFloating({ volume: askedVolume, muted: askedMuted });
  }, [askedVolume, askedMuted]);

  return (
    <div
      // The room bar's look, written out: `ROOM_BAR` itself is `relative`, and this one is laid over the foot of the box
      // (in the box's row it pushed the picture off to one side: found in the drive).
      className="absolute inset-x-0 bottom-0 z-30 flex h-8 items-center gap-x-2 bg-ink-plate px-2 py-1 text-label text-sun"
      // A press or a double press on the bar is the bar's: never the surround's "leave fullscreen", never a splat on the background.
      onDoubleClick={(event) => event.stopPropagation()}
      data-floating-stage-bar=""
      data-backdrop-solid=""
    >
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label={paused ? 'Play' : 'Pause'} onClick={() => orderFloating(paused ? 'play' : 'pause')} data-stage-play={paused ? 'paused' : 'playing'}>
        {paused ? '[ ▶ ]' : '[ ❚❚ ]'}
      </button>
      {duration > 0 ? (
        <input type="range" aria-label="Seek" min={0} max={duration} step={0.1} value={Math.min(seconds, duration)} onChange={(event) => orderFloating({ seek: Number(event.target.value) })} className="min-w-12 flex-1 accent-sun" />
      ) : (
        // A player that has not said how long it is has no line to drag yet; the space is kept so the keys beside it stay put.
        <span className="min-w-12 flex-1" />
      )}
      <span className="shrink-0 tabular-nums" data-watch-clock={seconds.toFixed(1)}>
        {formatMediaTime(seconds)} / {duration > 0 ? formatMediaTime(duration) : '--:--'}
      </span>
      <SpeakerKey
        muted={muted}
        volume={volume}
        onMuted={(next) => setSoundAsked((was) => ({ play, volume: was !== null && was.play === play ? was.volume : volume, muted: next }))}
        onVolume={(next) => setSoundAsked((was) => ({ play, volume: next, muted: was !== null && was.play === play ? was.muted : muted }))}
      />
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label="Leave fullscreen" onClick={togglePlayerFullscreen}>
        [ EXIT ]
      </button>
    </div>
  );
}
