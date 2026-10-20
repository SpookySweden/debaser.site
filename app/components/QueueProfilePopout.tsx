'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { PLATE, TITLE_BAR } from '../lib/ui/controls';
import {
  hostPositionSeconds,
  hostState,
  hostStateLabel,
  queueTrackBadge,
  resolveQueueTrack,
  unresolvedTrackTitle,
  type BroadcastQueue,
  type HostState,
} from '../lib/audio/broadcast';
import { formatClock } from '../lib/audio/format';
import {
  CATCH_UP_LEAD_SECONDS,
  followState,
  startFollowing,
  stopFollowing,
  subscribeToFollow,
} from '../lib/audio/follow';
import { QUEUES_LIST_HREF } from '../lib/audio/queue-window';
import { saveLoop } from '../lib/audio/loops';
import { queueContext } from '../lib/audio/track-context';
import { useQueueName } from '../lib/audio/use-queue-name';
import { useMusicPlayer } from './MusicPlayerProvider';

/**
 * Somebody's queue, opened: what they are playing, and the two ways to join them.
 *
 * Condensed on purpose. The brief asks for a small card rather than a profile page, and that is also
 * what the site wants: this is a *decision* - listen along or do not - and a card holding a picture, a
 * bio and a wall of tags would be a profile that happens to have a play button.
 *
 * **`CATCH UP` and `SKIP AHEAD` both start a follow**, and differ only in where you land:
 *
 *   - `SKIP AHEAD` puts you exactly where they are. Instant, and a jump.
 *   - `CATCH UP` starts you `CATCH_UP_LEAD_SECONDS` back and plays fast until you are level, so you hear
 *     the last stretch of what they played, compressed.
 *
 * From then on `QueueFollower` keeps you with them - their next track, their pauses - until you press
 * something yourself or UNFOLLOW (`follow.ts`). The speed is the follower's to set and hand back, not
 * this card's: it used to live here, and closing the card dropped a catch-up back to 1x halfway.
 *
 * Either way the shared player is taken over, and whatever was playing is saved into RADI-OH first - the
 * contract `app/lib/audio/loops.ts` describes. It is done *here*, at the moment of takeover, because
 * this is the only place that knows the takeover is happening.
 */
export default function QueueProfilePopout({
  queue,
  now,
  mine,
  onClose,
}: {
  queue: BroadcastQueue;
  now: number;
  /** True when this is the reader's own queue - which they can read, but not follow. */
  mine: boolean;
  onClose: () => void;
}) {
  const player = useMusicPlayer();
  const follow = useSyncExternalStore(subscribeToFollow, followState, followState);
  const name = useQueueName(queue.userId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const state = hostState(queue, now);
  const where = hostPositionSeconds(queue, now);
  const track = resolveQueueTrack(queue, player.queue);
  const title = track?.title ?? unresolvedTrackTitle(queue);
  const following = follow.hostId === queue.userId;

  /**
   * Take the player over, keeping what was displaced, and start following.
   *
   * The order matters and is the whole of the contract: **save first, then displace.** A save after the
   * play would record the *host's* track as the loop, which is the opposite of the point - the reader
   * would have lost the thing they were listening to and gained a loop back to where they just went.
   *
   * The start position goes *with* the play rather than as a seek after it, because the file is not
   * loaded yet when `play` returns (`PlayStart` in the provider explains the bug that was).
   */
  const takeOver = (lead: number) => {
    if (track === undefined) return;

    const playing = player.track;

    if (playing !== undefined && playing.src !== queue.trackId) {
      saveLoop({
        label: playing.title,
        trackId: playing.src,
        positionSeconds: player.elapsed,
        kind: 'taken-over',
        origin: 'own',
        originContext: player.heardFrom?.context,
        displacedBy: name,
      });
    }

    const live = hostPositionSeconds(queue, Date.now());

    player.play(
      track,
      { origin: 'queue', href: QUEUES_LIST_HREF, where: 'THE QUEUES LIST', context: queueContext(name) },
      { at: Math.max(0, live - lead), rate: 1, follow: true },
    );

    startFollowing(queue.userId, name);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-hardware/40 p-4"
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
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-none border border-black bg-bubble-pale text-[11px] font-bold leading-none text-ink-bar hover:bg-bubble focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bubble"
          >
            ×
          </button>
        </div>

        <QueueCardBody
          queue={queue}
          name={name}
          title={title}
          state={state}
          where={where}
          playable={track !== undefined}
          mine={mine}
          following={following}
          catchingUp={following && follow.catchingUp}
          behind={following ? where - player.elapsed : 0}
          onCatchUp={() => takeOver(CATCH_UP_LEAD_SECONDS)}
          onSkip={() => takeOver(0)}
          onUnfollow={() => {
            player.setPlaybackRate(1);
            stopFollowing('YOU UNFOLLOWED');
          }}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

/** The card's own body: the readout, where you stand with them, and the keys. */
function QueueCardBody({
  queue,
  name,
  title,
  state,
  where,
  playable,
  mine,
  following,
  catchingUp,
  behind,
  onCatchUp,
  onSkip,
  onUnfollow,
  onClose,
}: {
  queue: BroadcastQueue;
  name: string;
  title: string;
  state: HostState;
  where: number;
  playable: boolean;
  mine: boolean;
  following: boolean;
  catchingUp: boolean;
  /** Seconds you are behind them - meaningful only while following, and zero otherwise. */
  behind: number;
  onCatchUp: () => void;
  onSkip: () => void;
  onUnfollow: () => void;
  onClose: () => void;
}) {
  const canFollow = !mine && !following && playable && state !== 'silent';

  return (
    <div className="space-y-2 p-3">
      <p className="text-[11px] font-bold text-ink">
        {mine ? 'YOU' : name}
        <span className="ml-2 font-normal text-ink-quiet">TRACK {queueTrackBadge(queue)}</span>
      </p>

      <div className="rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-hardware px-2 py-1">
        <p className="truncate text-[12px] font-bold text-acid">{title}</p>
        <p className="truncate text-[10px] text-ink-bar">
          {formatClock(where)} IN ::{' '}
          <span className={state === 'live' ? 'text-acid' : 'text-sun'}>{hostStateLabel(state)}</span>
        </p>
      </div>

      <p className="text-[10px] text-ink-quiet">
        {mine
          ? 'THIS IS YOUR OWN QUEUE - THIS IS WHAT EVERYBODY ELSE SEES.'
          : following
            ? catchingUp
              ? `FOLLOWING ${name}. ${Math.round(Math.max(0, behind))} SECONDS BEHIND - PLAYING FAST TO CATCH UP.`
              : `FOLLOWING ${name}. YOU ARE LEVEL WITH THEM.`
            : !playable
              ? 'THEY ARE PLAYING A FILE THIS SHELF DOES NOT HOLD, SO IT CANNOT BE FOLLOWED.'
              : state === 'silent'
                ? 'THEY HAVE NOT MOVED THIS IN A WHILE, SO THERE IS NOTHING TO FOLLOW.'
                : state === 'paused'
                  ? 'THEY HAVE PAUSED. FOLLOW AND YOU WILL START WHEN THEY DO.'
                  : 'FOLLOW AND YOUR PLAYER STAYS WITH THEIRS - THEIR NEXT TRACK, THEIR PAUSES - UNTIL YOU PRESS SOMETHING YOURSELF.'}
      </p>

      <p className="flex flex-wrap gap-2 pt-1">
        {following ? (
          <button type="button" onClick={onUnfollow} className={PLATE}>
            [ UNFOLLOW ]
          </button>
        ) : mine ? null : (
          <>
            <button
              type="button"
              onClick={onCatchUp}
              disabled={!canFollow}
              title="Start a little behind them and play fast until you are level"
              className={PLATE}
            >
              [ CATCH UP ]
            </button>
            <button
              type="button"
              onClick={onSkip}
              disabled={!canFollow}
              title="Jump straight to where they are"
              className={PLATE}
            >
              [ SKIP AHEAD ]
            </button>
          </>
        )}
        <button type="button" onClick={onClose} className={PLATE}>
          {following || mine ? '[ CLOSE ]' : '[ LEAVE IT ]'}
        </button>
      </p>

      {following || mine ? null : (
        <p className="text-[10px] text-ink-quiet">
          FOLLOWING TAKES THE PLAYER OVER. WHAT YOU HAVE NOW IS KEPT IN RADI-OH.
        </p>
      )}
    </div>
  );
}
