'use client';

import { useCallback, useEffect, useState } from 'react';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import {
  catchUpRate,
  distanceSeconds,
  queueState,
  queueStateLabel,
  queueTrackBadge,
  type BroadcastQueue,
  type QueueState,
} from '../lib/audio/broadcast';
import { getMusicRepository } from '../lib/audio/repository';
import { announceQueueChanged } from '../lib/audio/queue-window';
import { useAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import QueueProfilePopout from './QueueProfilePopout';

/**
 * QUEUES: the people broadcasting what they are listening to, and the switch that puts you among them.
 *
 * A server browser, in the shape the brief asked for: a list of accounts, what each is playing, how far
 * in they are, and a lamp that says whether you are level with them. Following one takes the player over
 * - which is the point of the tab, and the reason RADI-OH exists to keep what it displaced.
 *
 * **The lamp is honest about what it measures.** `LIVE` means *your position is within a few seconds of
 * where the host's should be*, not that audio is arriving from them - nothing arrives from them. It is
 * worked out from the host's stored position plus the age of their last write, so it holds even when the
 * two machines disagree about the clock (`broadcast.ts` explains the pair). `SILENT` is a queue whose row
 * has not moved in long enough that nobody is playing it any more.
 *
 * The clock ticks locally rather than polling: a `setInterval` re-reads `Date.now()` so the lamps age on
 * their own, and the repository's realtime subscription is what says a queue *moved*. Polling for that
 * would be a second source of truth for the same question.
 */
export default function QueueBrowser() {
  const { user, status } = useAuth();
  const player = useMusicPlayer();
  const repository = getMusicRepository();

  const [queues, setQueues] = useState<BroadcastQueue[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<BroadcastQueue | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /** Ages the lamps once a second, so LIVE can become DELAY without anybody reloading. */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const read = useCallback(() => {
    let cancelled = false;

    void repository
      .listQueues()
      .then((found) => {
        if (!cancelled) setQueues(found);
      })
      .catch((error: unknown) => {
        if (cancelled) return;

        // An unreadable list is said out loud rather than drawn as an empty one: "nobody is
        // broadcasting" and "the database did not answer" are different sentences, and only the
        // second one is something a reader can act on.
        setQueues([]);
        setNotice(error instanceof Error ? error.message : 'THE QUEUE LIST COULD NOT BE READ.');
      });

    return () => {
      cancelled = true;
    };
  }, [repository]);

  useEffect(() => read(), [read]);

  // Realtime, so somebody going public or changing track appears without a reload. The unsubscribe is
  // returned rather than stored, because the repository hands one back per subscription.
  useEffect(() => repository.subscribeToQueues(read), [read, repository]);

  const signedIn = status === 'signed-in' && user !== null;

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      <div className={TITLE_BAR_INACTIVE}>
        <span>QUEUES // WHO IS LISTENING</span>
        <span>[ {queues === null ? 'READING...' : queues.length} ]</span>
      </div>

      <BroadcastSwitch
        signedIn={signedIn}
        userId={user?.id ?? null}
        onChanged={read}
        track={player.track?.src ?? null}
        index={player.index}
        total={player.queue.length}
        position={player.elapsed}
      />

      {notice === null ? null : (
        <p className="border-b border-ink bg-bubble-pale px-2 py-1 text-[10px] font-bold text-paper">{notice}</p>
      )}

      {queues === null ? (
        <p className="p-3 text-[10px] font-bold text-ink">READING THE QUEUE LIST...</p>
      ) : queues.length === 0 ? (
        <p className="p-3 text-[11px] font-bold text-ink">
          NOBODY IS BROADCASTING RIGHT NOW.{' '}
          {signedIn
            ? 'GO PUBLIC ABOVE AND YOUR QUEUE APPEARS HERE FOR EVERYBODY.'
            : 'SIGN IN TO BROADCAST YOUR OWN.'}
        </p>
      ) : (
        <ul className="divide-y divide-ink">
          {queues.map((queue) => (
            <QueueRow
              key={queue.userId}
              queue={queue}
              now={now}
              playerSeconds={player.elapsed}
              mine={queue.userId === user?.id}
              onOpen={() => setOpen(queue)}
            />
          ))}
        </ul>
      )}

      {open === null ? null : <QueueProfilePopout queue={open} now={now} onClose={() => setOpen(null)} />}
    </section>
  );
}

/**
 * The switch: whether this account's queue is on the list.
 *
 * A `button` with `aria-pressed` rather than a checkbox, for the reason the theme rows in
 * `PreferencesWindow` are: the whole plate is the control on this site, and a 13px native checkbox
 * beside a label would be the only input on the page that does not take the site's press.
 *
 * Going public writes the *current* track and position, so the row is never a queue with nothing in it -
 * and a reader signed out is told what an account would add rather than shown a switch that refuses.
 * Whether it reads as on comes from the same store the rows do, so the switch and the row it produces
 * cannot disagree.
 */
function BroadcastSwitch({
  signedIn,
  userId,
  onChanged,
  track,
  index,
  total,
  position,
}: {
  signedIn: boolean;
  /** The signed-in account, or null. Passed in rather than read here, so this stays a plain component. */
  userId: string | null;
  onChanged: () => void;
  track: string | null;
  index: number;
  total: number;
  position: number;
}) {
  const repository = getMusicRepository();
  const [busy, setBusy] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (userId === null) return;

    let cancelled = false;

    void repository
      .readOwnQueue(userId)
      .then((own) => {
        if (!cancelled) setIsPublic(own?.isPublic ?? false);
      })
      .catch(() => {
        // An unreadable own-queue is not worth a banner: the switch reads as off, and pressing it
        // reports whatever goes wrong next.
        if (!cancelled) setIsPublic(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repository, userId]);

  if (!signedIn) {
    return (
      <p className="border-b border-ink px-2 py-1 text-[10px] text-ink-plate">
        SIGN IN TO BROADCAST WHAT YOU ARE LISTENING TO. SIGNED OUT, YOU CAN STILL FOLLOW SOMEBODY.
      </p>
    );
  }

  const press = () => {
    // Narrowed here rather than trusted: `signedIn` and `userId` are two facts and only one of them is
    // the id. A switch that wrote a null owner would be a queue filed under nobody.
    if (userId === null) return;

    if (track === null) {
      setMessage('PUT SOMETHING ON FIRST - A QUEUE WITH NOTHING IN IT IS NOT WORTH BROADCASTING.');
      return;
    }

    setBusy(true);
    setMessage(null);

    const next = !isPublic;

    void repository
      .publishQueue({ userId, trackId: track, trackIndex: index, trackTotal: total, positionSeconds: position, isPublic: next })
      .then(() => {
        setIsPublic(next);
        setMessage(next ? 'YOU ARE ON THE LIST.' : 'YOU ARE OFF THE LIST.');

        // Both listeners: `onChanged` re-reads the window's own list, and the event wakes the heartbeat,
        // which is drawn by the shell and cannot see this component at all.
        onChanged();
        announceQueueChanged();
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'THAT DID NOT SAVE.');
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="border-b border-ink px-2 py-1">
      <p className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-ink">
        <button
          type="button"
          onClick={press}
          disabled={busy}
          aria-pressed={isPublic}
          title={isPublic ? 'Take your queue off the list' : 'Put your queue on the list'}
          className={`cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 px-2 py-[2px] text-[10px] font-bold disabled:cursor-not-allowed ${
            isPublic
              ? 'border-t-black border-l-black border-r-white border-b-white bg-acid text-ink'
              : 'border-t-white border-l-white border-black bg-sun text-ink-plate hover:bg-ice'
          }`}
        >
          {isPublic ? '[ PUBLIC ]' : '[ GO PUBLIC ]'}
        </button>

        <span className={isPublic ? 'text-ink' : 'text-ink-plate'}>
          {isPublic ? 'ANYBODY CAN FOLLOW WHAT YOU ARE PLAYING.' : 'YOUR QUEUE IS YOURS ALONE.'}
        </span>
      </p>

      {message === null ? null : <p className="mt-1 text-[10px] font-bold text-ink">{message}</p>}
    </div>
  );
}

/**
 * One account's queue, as a row.
 *
 * The lamp is the part worth reading: `LIVE` and `DELAY` are worked out from the host's pair *and* this
 * listener's own position, so the same row reads differently for two people - which is correct, because
 * the question it answers is "am I level with them", not "are they playing".
 */
function QueueRow({
  queue,
  now,
  playerSeconds,
  mine,
  onOpen,
}: {
  queue: BroadcastQueue;
  now: number;
  playerSeconds: number;
  mine: boolean;
  onOpen: () => void;
}) {
  const written = Date.parse(queue.updatedAt);
  const ageSeconds = Number.isNaN(written) ? 0 : Math.max(0, (now - written) / 1000);
  const distance = distanceSeconds(queue, playerSeconds, now);
  const state: QueueState = queueState(distance, ageSeconds);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left text-[10px] font-bold text-ink hover:bg-ice"
      >
        <span aria-hidden="true" className="shrink-0 text-[13px] leading-none">
          ♪
        </span>

        <span className="min-w-0 flex-1 truncate">
          {mine ? 'YOU' : `${queue.userId.slice(0, 8)}...`}
          <span className="ml-2 font-normal text-ink-plate">{queueTrackBadge(queue)}</span>
        </span>

        <CatchUpMeter distance={distance} state={state} />

        <span className={`shrink-0 ${state === 'live' ? 'text-acid' : 'text-sun'}`}>{queueStateLabel(state)}</span>
      </button>
    </li>
  );
}

/** How far off level a listener is, in its own words. Small, because it rides inside a row. */
function CatchUpMeter({ distance, state }: { distance: number; state: QueueState }) {
  if (state === 'silent') return <span className="shrink-0 text-ink-plate">NOT PLAYING</span>;

  const behind = distance > 0;
  const rate = catchUpRate(distance);

  return (
    <span className="shrink-0 text-ink-plate">
      {behind ? `${Math.round(distance)}S BEHIND` : `${Math.round(-distance)}S AHEAD`}
      {rate > 1 ? ` :: ${rate.toFixed(1)}x` : ''}
    </span>
  );
}
