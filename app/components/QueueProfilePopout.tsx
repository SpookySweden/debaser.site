'use client';

import { useEffect, useState } from 'react';
import { PLATE, TITLE_BAR } from '../lib/ui/controls';
import {
  catchUpRate,
  distanceSeconds,
  livePositionSeconds,
  queueState,
  queueStateLabel,
  queueTrackBadge,
  resolveQueueTrack,
  unresolvedTrackTitle,
  type BroadcastQueue,
} from '../lib/audio/broadcast';
import { formatClock } from '../lib/audio/format';
import { QUEUES_LIST_HREF } from '../lib/audio/queue-window';
import { saveLoop } from '../lib/audio/loops';
import { useMusicPlayer } from './MusicPlayerProvider';

/**
 * Somebody's queue, opened: what they are playing, and the two ways to join them.
 *
 * Condensed on purpose. The brief asks for a small card rather than a profile page, and that is also
 * what the site wants: this is a *decision* - listen along or do not - and a card holding a picture, a
 * bio and a wall of tags would be a profile that happens to have a play button. What is here is the
 * track, where they are in it, how far off you are, and the keys.
 *
 * **`CATCH UP` and `SKIP AHEAD` are the same mechanism at two speeds**, which is the whole reason there
 * are two keys rather than one. Both play the host's track from where the host *is*:
 *
 *   - `SKIP AHEAD` seeks straight there. Instant, and a jump - you miss whatever was between.
 *   - `CATCH UP` plays it from here at speed, easing back to normal as it closes (`catchUpRate`). You
 *     hear the part you missed, compressed.
 *
 * Either way the shared player is taken over, and whatever was playing is saved into RADI-OH first - the
 * contract `app/lib/audio/loops.ts` describes. It is done *here*, at the moment of takeover, because
 * this is the only place that knows the takeover is happening.
 */
export default function QueueProfilePopout({
  queue,
  now,
  onClose,
}: {
  queue: BroadcastQueue;
  now: number;
  onClose: () => void;
}) {
  const player = useMusicPlayer();
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Eases the speed back to normal once the gap is closed, and puts it back when this card goes away.
   *
   * The reset on unmount is the important half and it is not tidiness: the audio element is shared with
   * the whole site, so a card that closed while still at 1.6x would leave every later track - a profile's
   * song, the shelf's own playback - running fast, with nothing on screen to explain why. `playbackRate`
   * is player state, so the component that changed it is the one that has to hand it back.
   */
  useEffect(() => {
    if (!joined) return;

    const timer = window.setInterval(() => {
      const live = livePositionSeconds(queue, Date.now());
      const rate = catchUpRate(live - player.elapsed);

      player.setPlaybackRate(rate);
    }, 1000);

    return () => {
      window.clearInterval(timer);
      player.setPlaybackRate(1);
    };
  }, [joined, player, queue]);

  const written = Date.parse(queue.updatedAt);
  const ageSeconds = Number.isNaN(written) ? 0 : Math.max(0, (now - written) / 1000);
  const distance = distanceSeconds(queue, player.elapsed, now);
  const state = queueState(distance, ageSeconds);

  const track = resolveQueueTrack(queue, player.queue);
  const title = track?.title ?? unresolvedTrackTitle(queue);
  const rate = catchUpRate(distance);

  /**
   * Take the player over, keeping what was displaced.
   *
   * The order matters and is the whole of the contract: **save first, then displace.** A save after the
   * play would record the *host's* track as the loop, which is the opposite of the point - the reader
   * would have lost the thing they were listening to and gained a loop back to where they just went.
   *
   * `rate` is how fast to play while catching up; `1` is the skip-ahead case, where there is nothing to
   * make up. It is set *after* the play, because `play` swaps the source and a browser resets
   * `playbackRate` to 1 when a new file loads - so a rate set first would be thrown away.
   */
  const takeOver = (rate: number) => {
    const playing = player.track;

    if (playing !== undefined && playing.src !== queue.trackId) {
      saveLoop({
        label: playing.title,
        trackId: playing.src,
        positionSeconds: player.elapsed,
        kind: 'taken-over',
        origin: 'own',
        displacedBy: queue.userId.slice(0, 8),
      });
    }

    if (track !== undefined) {
      player.play(track, {
        origin: 'queue',
        href: QUEUES_LIST_HREF,
        where: 'THE QUEUES LIST',
      });
    }

    player.setPlaybackRate(rate);
    setJoined(true);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-ink/40 p-4"
      onPointerDown={(event) => {
        // A press on the backdrop closes; one that started inside the card does not, which is why the
        // card stops the event rather than this testing where the pointer landed.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="A queue somebody is broadcasting"
        onPointerDown={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale"
      >
        <div className={TITLE_BAR}>
          <span className="truncate">THEIR QUEUE</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close - or press anywhere off this card"
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-none border border-black bg-bubble-pale text-[11px] font-bold leading-none text-paper hover:bg-bubble focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble"
          >
            ×
          </button>
        </div>

        <QueueCardBody
          queue={queue}
          title={title}
          state={state}
          rate={rate}
          distance={distance}
          joined={joined}
          onTakeOver={() => takeOver(rate)}
          onSkip={() => {
            takeOver(1);
            player.seek(livePositionSeconds(queue, Date.now()));
          }}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

/** The card's own body: the readout, how far off you are, and the keys. */
function QueueCardBody({
  queue,
  title,
  state,
  rate,
  distance,
  joined,
  onTakeOver,
  onSkip,
  onClose,
}: {
  queue: BroadcastQueue;
  title: string;
  state: ReturnType<typeof queueState>;
  rate: number;
  distance: number;
  joined: boolean;
  onTakeOver: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-2 p-3">
      <p className="text-[11px] font-bold text-ink">
        {queue.userId.slice(0, 8)}...
        <span className="ml-2 font-normal text-ink-plate">{queueTrackBadge(queue)}</span>
      </p>

      <div className="rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-ink px-2 py-1">
        <p className="truncate text-[12px] font-bold text-acid">{title}</p>
        <p className="truncate text-[9px] text-ena-deep">
          {formatClock(Math.max(0, queue.positionSeconds))} IN ::{' '}
          <span className={state === 'live' ? 'text-acid' : 'text-sun'}>{queueStateLabel(state)}</span>
          {rate > 1 ? ` :: CATCHING UP AT ${rate.toFixed(1)}x` : ''}
        </p>
      </div>

      <p className="text-[10px] text-ink-plate">
        {state === 'silent'
          ? 'THEY HAVE NOT MOVED THIS IN A WHILE, SO NOTHING IS PLAYING.'
          : distance > 0
            ? `${Math.round(distance)} SECONDS BEHIND THEM.`
            : `${Math.round(-distance)} SECONDS AHEAD OF THEM.`}
      </p>

      <p className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={onTakeOver} className={PLATE}>
          [ CATCH UP ]
        </button>
        <button type="button" onClick={onSkip} className={PLATE}>
          [ SKIP AHEAD ]
        </button>
        <button type="button" onClick={onClose} className={PLATE}>
          [ LEAVE IT ]
        </button>
      </p>

      <p className="text-[9px] text-ink-plate">
        {joined
          ? 'FOLLOWING. WHAT YOU WERE PLAYING IS IN RADI-OH.'
          : 'FOLLOWING TAKES THE PLAYER OVER. WHAT YOU HAVE NOW IS KEPT IN RADI-OH.'}
      </p>
    </div>
  );
}
