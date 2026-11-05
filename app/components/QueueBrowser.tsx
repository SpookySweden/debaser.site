'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatClock } from '../lib/audio/format';
import { saveLoop } from '../lib/audio/loops';
import { useCatalogue } from '../lib/media/catalogue';
import { PLATE, PLATE_LINK } from '../lib/ui/controls';
import { useNow } from '../lib/ui/use-now';
import { listedRooms, roomRowState, type RoomRowState } from '../lib/watch/music-rooms';
import { hostPosition, roomIsLive, withSeries } from '../lib/watch/rules';
import type { LiveRoom, WatchQueueEntry } from '../lib/watch/types';
import { enterRoom, useLiveRooms, useMusicRoomSwitch } from '../lib/watch/use-music-room';
import { useQueueName } from '../lib/audio/use-queue-name';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import { useAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import StreamQueueWindow from './StreamQueueWindow';

const STATE_WORDS: Record<RoomRowState, string> = { live: 'LIVE', paused: 'PAUSED', silent: 'SILENT' };

/**
 * QUEUES (SPEC-music-queues.md): every live room, people's music rooms and video streams alike, and the switch
 * that opens yours.
 *
 * GO PUBLIC opens your music room - kept for good, built on the stream room - from what your player has on and
 * your up-next; switching it off leaves the room's songs as your up-next. Pressing a row joins that room: a music
 * room folded, with the bar playing its music (the TV key turns the bar to the room's screen, chat and queue); a
 * video stream as its `[ TV ]` key opens it. `[ QUEUE ]` on a row opens that room's queue window, to look before
 * you join. RADI-OH is unchanged: whatever your player had on is kept there as you join.
 */
export default function QueueBrowser() {
  const { user, status } = useAuth();
  const player = useMusicPlayer();
  const catalogue = useCatalogue();
  const now = useNow(1000);
  const { rooms, error } = useLiveRooms();
  const [peek, setPeek] = useState<string | null>(null);
  const titles = useMemo(() => new Map(catalogue.items.map((item) => [item.id, item.title])), [catalogue.items]);

  const signedIn = status === 'signed-in' && user !== null;
  const shown = rooms === null ? null : listedRooms(rooms, now);
  const titleOf = (entry: WatchQueueEntry | null) =>
    entry === null ? 'NOTHING ON' : entry.link !== null ? withSeries(entry, entry.link.title) : (titles.get(entry.mediaItemId ?? '') ?? 'A FILE');

  /** Joining: what your player had on goes to RADI-OH first, as following always kept it (lib/audio/loops.ts). */
  function join(live: LiveRoom, name: string) {
    const playing = player.track;
    if (playing !== undefined && live.room.hostId !== user?.id && live.current?.link?.url !== playing.src) {
      saveLoop({ label: playing.title, trackId: playing.src, positionSeconds: player.elapsed, kind: 'taken-over', origin: 'own', originContext: player.heardFrom?.context, displacedBy: name });
    }
    enterRoom(live.room.id, live.room.origin);
  }

  // No title line: the QUEUES tab pressed right above already names this screen (SPEC-efficiency.md).
  return (
    <section>
      <PublicSwitch signedIn={signedIn} />

      {error === null ? null : <p className="border-b border-ink bg-bubble-pale px-2 py-1 text-label font-bold text-ink-bar">{error}</p>}

      {shown === null ? (
        <p className="p-3 text-label font-bold text-ink">READING THE ROOMS...</p>
      ) : shown.length === 0 ? (
        // A guest's way to broadcast is the `[ LOG IN ]` line above, so the empty state does not say it twice.
        <p className="p-3 text-key font-bold text-ink">NOBODY IS BROADCASTING.</p>
      ) : (
        <ul className="divide-y divide-ink" data-queues-rooms>
          {shown.map((live) => (
            <RoomRow
              key={live.room.id}
              live={live}
              now={now}
              mine={live.room.hostId === user?.id}
              inRoom={player.room?.roomId === live.room.id}
              title={live.room.name ? `${live.room.name} :: ${titleOf(live.current)}` : titleOf(live.current)}
              onJoin={(name) => join(live, name)}
              onQueue={() => setPeek(live.room.id)}
            />
          ))}
        </ul>
      )}

      {peek === null ? null : <QueuePeek roomId={peek} userId={user?.id ?? null} onClose={() => setPeek(null)} />}
    </section>
  );
}

/**
 * The switch: whether your music room is open. A `button` with `aria-pressed`, the whole plate the control, as
 * the theme rows in `PreferencesWindow` are. Signed out, one `[ LOG IN ] TO BROADCAST` line instead.
 */
function PublicSwitch({ signedIn }: { signedIn: boolean }) {
  const { user } = useAuth();
  const player = useMusicPlayer();
  const room = useMusicRoomSwitch(user, player);

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

  return (
    <div className="border-b border-ink px-2 py-1">
      <p className="flex flex-wrap items-center gap-2 text-label font-bold text-ink">
        <button
          type="button"
          onClick={() => void (room.isPublic ? room.goPrivate() : room.goPublic())}
          disabled={room.busy}
          aria-pressed={room.isPublic}
          title={room.isPublic ? 'Switch your room off: its songs stay as your up-next' : 'Open your music room from what you are playing and your up-next'}
          className={`cursor-pointer px-2 py-0.5 text-label disabled:cursor-not-allowed max-sm:min-h-tap max-sm:px-3 ${
            room.isPublic ? 'key key-fill [--key-fill:var(--color-acid)] text-ink-plate' : 'key'
          }`}
          data-go-public
        >
          {room.isPublic ? '[ PUBLIC ]' : '[ GO PUBLIC ]'}
        </button>
      </p>
      {room.message === null ? null : <p className="mt-1 text-label font-bold text-ink">{room.message}</p>}
    </div>
  );
}

/** One room: whose, what is on, where they are in it, and whether they are playing; `[ QUEUE ]` to look in first. */
function RoomRow({
  live,
  now,
  mine,
  inRoom,
  title,
  onJoin,
  onQueue,
}: {
  live: LiveRoom;
  now: number;
  mine: boolean;
  /** This player is in that room now. */
  inRoom: boolean;
  title: string;
  onJoin: (name: string) => void;
  onQueue: () => void;
}) {
  const name = useQueueName(live.room.hostId);
  const state = roomRowState(live.room, now);
  const music = live.room.origin === 'music';

  return (
    <li className={`flex items-center gap-1 pr-2 ${inRoom ? 'bg-ice' : ''}`} data-room-row={live.room.id}>
      <button
        type="button"
        onClick={() => onJoin(name)}
        aria-label={`${mine ? 'Your room' : `Join ${name}'s ${music ? 'music' : 'stream'}`}: ${title}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1 text-left text-label font-bold text-ink hover:bg-ice max-sm:min-h-tap"
      >
        <span aria-hidden="true" className={`w-6 shrink-0 text-center text-label leading-none ${state === 'live' ? 'text-accent-ink' : 'text-ink-quiet'}`}>
          {inRoom ? '▶' : music ? '♪' : 'TV'}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {mine ? 'YOU' : name}
          <span className="ml-2 font-normal text-ink-quiet">{title}</span>
        </span>
        {inRoom ? <span className="shrink-0 text-ink">{mine ? 'HOSTING' : 'IN THE ROOM'}</span> : null}
        <span className="w-10 shrink-0 text-right font-normal text-ink-quiet">{formatClock(hostPosition(live.room, now))}</span>
        <span className={`w-14 shrink-0 text-center ${state === 'live' ? 'bg-hardware text-acid' : 'bg-chrome-dark text-ink'}`}>{STATE_WORDS[state]}</span>
      </button>
      <button type="button" className={`${PLATE} shrink-0`} aria-haspopup="dialog" aria-label={`${mine ? 'Your' : `${name}'s`} queue`} onClick={onQueue} data-room-queue>
        [ QUEUE ]
      </button>
    </li>
  );
}

/** A room's queue window from the QUEUES list, to look before joining (adding follows the room's rules as usual). */
function QueuePeek({ roomId, userId, onClose }: { roomId: string; userId: string | null; onClose: () => void }) {
  const { read } = useWatchRoom(roomId);
  const catalogue = useCatalogue();
  const now = useNow(5000);
  const itemsById = useMemo(() => new Map(catalogue.items.map((item) => [item.id, item])), [catalogue.items]);
  if (read === undefined || read === null) return null;
  return <StreamQueueWindow read={read} itemsById={itemsById} live={roomIsLive(read.room, now)} userId={userId} members={[]} nowLive={false} onClose={onClose} />;
}
