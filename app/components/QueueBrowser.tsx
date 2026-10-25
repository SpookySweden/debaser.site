'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { PLATE_LINK } from '../lib/ui/controls';
import {
  calibrateClock,
  hostPositionSeconds,
  hostState,
  hostStateLabel,
  queueTrackBadge,
  visibleQueues,
  type BroadcastQueue,
} from '../lib/audio/broadcast';
import { formatClock } from '../lib/audio/format';
import { followState, subscribeToFollow } from '../lib/audio/follow';
import { getMusicRepository } from '../lib/audio/repository';
import { announceQueueChanged } from '../lib/audio/queue-window';
import { useQueueName } from '../lib/audio/use-queue-name';
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
 * **The lamp is about the host, and only the followed row talks about you.** `LIVE`, `PAUSED` and
 * `SILENT` are read from the host's own row (`hostState`). How far behind you are is shown on the one
 * row you are following and nowhere else - the old lamp measured every row against whatever this player
 * happened to be on, so a reader who had followed nobody was told they were an hour behind and
 * "catching up" at 4x. Rows untouched for half an hour are not listed (`visibleQueues`).
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
  /** Whose card is open, by account - so the card reads the *current* row, not the one that was pressed. */
  const [openId, setOpenId] = useState<string | null>(null);
  const follow = useSyncExternalStore(subscribeToFollow, followState, followState);
  const [now, setNow] = useState(() => Date.now());

  /** Ages the lamps once a second, so LIVE can become DELAY without anybody reloading. */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const read = useCallback((options?: { fresh?: boolean }) => {
    let cancelled = false;

    void repository
      .listQueues()
      .then((found) => {
        if (cancelled) return;
        // Answering a realtime change: the newest row was written a moment ago (`calibrateClock`).
        if (options?.fresh === true) calibrateClock(found, Date.now());
        setQueues(found);
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
  useEffect(
    () =>
      repository.subscribeToQueues(() => {
        read({ fresh: true });
      }),
    [read, repository],
  );

  const signedIn = status === 'signed-in' && user !== null;
  const shown = queues === null ? null : visibleQueues(queues, now);
  const open = openId === null ? undefined : queues?.find((queue) => queue.userId === openId);

  // No title line: the QUEUES tab pressed right above already names this screen (SPEC-efficiency.md).
  return (
    <section>
      <BroadcastSwitch
        signedIn={signedIn}
        userId={user?.id ?? null}
        onChanged={() => read()}
        track={player.track?.src ?? null}
        index={player.index}
        total={player.queue.length}
        position={player.elapsed}
        playing={player.playing}
      />

      {notice === null ? null : (
        <p className="border-b border-ink bg-bubble-pale px-2 py-1 text-label font-bold text-ink-bar">{notice}</p>
      )}

      {shown === null ? (
        <p className="p-3 text-label font-bold text-ink">READING THE QUEUE LIST...</p>
      ) : shown.length === 0 ? (
        // A guest's way to broadcast is the `[ LOG IN ]` line above, so the empty state does not say it twice.
        <p className="p-3 text-key font-bold text-ink">
          NOBODY IS BROADCASTING.
        </p>
      ) : (
        <ul className="divide-y divide-ink">
          {shown.map((queue) => (
            <QueueRow
              key={queue.userId}
              queue={queue}
              now={now}
              mine={queue.userId === user?.id}
              following={follow.hostId === queue.userId}
              catchingUp={follow.hostId === queue.userId && follow.catchingUp}
              behind={hostPositionSeconds(queue, now) - player.elapsed}
              onOpen={() => setOpenId(queue.userId)}
            />
          ))}
        </ul>
      )}

      {open === undefined ? null : (
        <QueueProfilePopout queue={open} now={now} mine={open.userId === user?.id} onClose={() => setOpenId(null)} />
      )}
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
 * and a reader signed out gets one `[ LOG IN ] TO ...` line rather than a switch that refuses.
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
  playing,
}: {
  signedIn: boolean;
  /** The signed-in account, or null. Passed in rather than read here, so this stays a plain component. */
  userId: string | null;
  onChanged: () => void;
  track: string | null;
  index: number;
  total: number;
  position: number;
  playing: boolean;
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
      <p className="border-b border-ink px-2 py-1 text-label text-ink">
        <Link href="/account" className={PLATE_LINK}>
          [ LOG IN ]
        </Link>{' '}
        TO BROADCAST
      </p>
    );
  }

  const press = () => {
    // Narrowed here rather than trusted: `signedIn` and `userId` are two facts and only one of them is
    // the id. A switch that wrote a null owner would be a queue filed under nobody.
    if (userId === null) return;

    if (track === null) {
      setMessage('PLAY SOMETHING FIRST.');
      return;
    }

    setBusy(true);
    setMessage(null);

    const next = !isPublic;

    void repository
      .publishQueue({
        userId,
        trackId: track,
        trackIndex: index,
        trackTotal: total,
        positionSeconds: position,
        isPublic: next,
        isPlaying: playing,
      })
      .then(() => {
        setIsPublic(next);

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

  // The switch's own face says which way it is; the sentence that restated it beside it is gone
  // (SPEC-efficiency.md), and its tip says what a press does.
  return (
    <div className="border-b border-ink px-2 py-1">
      <p className="flex flex-wrap items-center gap-2 text-label font-bold text-ink">
        <button
          type="button"
          onClick={press}
          disabled={busy}
          aria-pressed={isPublic}
          className={`cursor-pointer px-2 py-0.5 text-label disabled:cursor-not-allowed max-sm:min-h-tap max-sm:px-3 ${
            isPublic
              ? 'key key-fill [--key-fill:var(--color-acid)] text-ink-plate'
              : 'key'
          }`}
        >
          {isPublic ? '[ PUBLIC ]' : '[ GO PUBLIC ]'}
        </button>
      </p>

      {message === null ? null : <p className="mt-1 text-label font-bold text-ink">{message}</p>}
    </div>
  );
}

/**
 * One account's queue, as a row: who, what track, where they are in it, and whether they are playing.
 *
 * The followed row is the one that also speaks about *you* - `FOLLOWING`, and how far behind while a
 * catch-up runs. Every other row is the same for every reader, because it only describes the host.
 */
function QueueRow({
  queue,
  now,
  mine,
  following,
  catchingUp,
  behind,
  onOpen,
}: {
  queue: BroadcastQueue;
  now: number;
  mine: boolean;
  following: boolean;
  catchingUp: boolean;
  /** Seconds this player is behind the host. Read only on the followed row. */
  behind: number;
  onOpen: () => void;
}) {
  const name = useQueueName(queue.userId);
  const state = hostState(queue, now);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left text-label font-bold text-ink hover:bg-ice max-sm:min-h-tap ${
          following ? 'bg-ice' : ''
        }`}
      >
        <span aria-hidden="true" className={`w-4 shrink-0 text-center text-label leading-none ${state === 'live' ? 'text-accent-ink' : 'text-ink-quiet'}`}>
          {following ? '▶' : '♪'}
        </span>

        <span className="min-w-0 flex-1 truncate">
          {mine ? 'YOU' : name}
          <span className="ml-2 font-normal text-ink-quiet">TRACK {queueTrackBadge(queue)}</span>
        </span>

        {following ? (
          <span className="shrink-0 text-ink">
            {catchingUp ? `CATCHING UP :: ${Math.round(Math.max(0, behind))}S BEHIND` : 'FOLLOWING'}
          </span>
        ) : null}

        <span className="w-10 shrink-0 text-right font-normal text-ink-quiet">
          {formatClock(hostPositionSeconds(queue, now))}
        </span>

        <span
          className={`w-14 shrink-0 text-center ${
            state === 'live' ? 'bg-hardware text-acid' : 'bg-chrome-dark text-ink'
          }`}
        >
          {hostStateLabel(state)}
        </span>
      </button>
    </li>
  );
}
