'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { stopFollowing } from '../lib/audio/follow';
import { threadDomId } from '../lib/forum/anchors';
import { useCatalogue } from '../lib/media/catalogue';
import type { MediaItem } from '../lib/media/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import { useCompactViewport } from '../lib/ui/use-compact-viewport';
import { useNow } from '../lib/ui/use-now';
import { getWatchRepository } from '../lib/watch/repository';
import {
  MESSAGE_MAX_LENGTH,
  TAKE_OVER_RETRY_MS,
  WATCH_HEARTBEAT_MS,
  accountsPresent,
  currentEntry,
  formatMediaTime,
  guestsPresent,
  handoverTo,
  moveInQueue,
  nextPlayIndex,
  nextQueuePosition,
  playOrder,
  queueBadge,
  roomIsLive,
  shouldTakeOver,
  upcoming,
  viewerStep,
} from '../lib/watch/rules';
import type { WatchMember, WatchMessage, WatchQueueEntry, WatchRoomRead } from '../lib/watch/types';
import { steadyInterval } from '../lib/watch/steady-timer';
import { applyLocalChange } from '../lib/watch/use-watch-room';
import { useAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import ProfileName from './ProfileName';

/** One per tab: two tabs of one account are two members of a room. */
function newTabKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tab-${Math.random().toString(36).slice(2)}`;
}

/** How often a follower checks itself against the host. */
const FOLLOW_TICK_MS = 500;
/** How long `<NAME> IS HOSTING NOW` stays up. */
const HANDOVER_NOTICE_MS = 15000;

type WatchRoomProps = {
  read: WatchRoomRead;
  /** The window's close key was pressed: a host is asked first, anybody else just leaves. */
  closing: boolean;
  onStay: () => void;
  onLeft: () => void;
};

/**
 * One stream room (SPEC-watch-together.md): the video large on the left with the transport under it,
 * the queue and the chat on the right; on a phone the video, then the chat, the queue folded.
 *
 * **The host** runs the one transport: every play, pause, seek and skip is written to the room at once,
 * and a heartbeat every few seconds keeps the pointer fresh (and tells the room the host is still there).
 * At the end of a file the next one in the queue starts; with nothing queued the last file loops.
 *
 * **Everybody else** follows: twice a second the player is compared with where the host should be now
 * and jumps (off by more than two seconds) or nudges its speed (a little off). A browser that refuses to
 * start the sound gets one key, `[ ▶ JOIN PLAYBACK ]`, rather than playing on silently out of step.
 */
export default function WatchRoom({ read, closing, onStay, onLeft }: WatchRoomProps) {
  const { user } = useAuth();
  const catalogue = useCatalogue();
  const player = useMusicPlayer();
  const compact = useCompactViewport();
  const repository = getWatchRepository();
  const { room } = read;
  const roomId = room.id;

  const now = useNow(5000);

  const live = roomIsLive(room, now);
  const amHost = user !== null && room.hostId === user.id;
  const itemsById = useMemo(() => new Map(catalogue.items.map((item) => [item.id, item])), [catalogue.items]);
  const entry = currentEntry(read);
  const item = entry?.mediaItemId ? itemsById.get(entry.mediaItemId) : undefined;
  const waiting = upcoming(read.queue);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [clock, setClock] = useState({ seconds: 0, duration: Number.NaN, paused: true });
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [needsPress, setNeedsPress] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  /* --- who is here ----------------------------------------------------------------------------- */

  const [myKey] = useState(newTabKey);
  const [members, setMembers] = useState<WatchMember[]>([]);
  /** False until the room's presence has answered once: before that, "the host is missing" means nothing. */
  const [membersHeard, setMembersHeard] = useState(false);

  useEffect(() => {
    if (room.endedAt !== null) return;
    const membership = repository.joinRoom(
      roomId,
      { key: myKey, userId: user?.id ?? null, name: user?.displayName ?? '' },
      (next) => {
        setMembers(next);
        if (next.length > 1 || next.some((member) => member.key !== myKey)) setMembersHeard(true);
      },
    );
    // A room alone hears only itself; after a moment that is an answer too.
    const heard = window.setTimeout(() => setMembersHeard(true), 3000);

    return () => {
      window.clearTimeout(heard);
      membership.leave();
    };
  }, [repository, roomId, room.endedAt, user?.id, user?.displayName, myKey]);

  const accounts = accountsPresent(members);
  const guests = guestsPresent(members);

  /* --- the music stops (decision 7) ------------------------------------------------------------ */

  const steer = player.steer;
  const playing = player.playing;
  const stoppedMusic = useRef(false);
  useEffect(() => {
    if (stoppedMusic.current) return;
    stoppedMusic.current = true;
    stopFollowing('');
    if (playing) steer(false);
  }, [playing, steer]);

  /* --- hosting --------------------------------------------------------------------------------- */

  /**
   * The play this host's player is on. Ahead of the room for a moment when moving on: the restart's own
   * `play` write must name the new play, not put the room back on the one that just ended.
   */
  const hostEntry = useRef<string | null>(null);

  const publish = useEffectEvent(() => {
    const video = videoRef.current;
    if (video === null || !amHost || !live) return;

    void repository
      .writePlayback(roomId, {
        currentEntryId: hostEntry.current ?? room.currentEntryId,
        positionSeconds: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        isPlaying: !video.paused && !video.ended,
      })
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT BE UPDATED.'));
  });

  /** The host moves on: the next file in the queue, or the same one again from the top. */
  function moveOn(skip: boolean) {
    const next = upcoming(read.queue)[0];
    const video = videoRef.current;

    if (next === undefined) {
      if (skip || video === null) return;
      video.currentTime = 0;
      void video.play().catch(() => setNeedsPress(true));
      return;
    }

    // From the top, at once: the next play may be the same file (nothing for the element to reload),
    // and a different file is loaded by its new `src` and started by `autoPlay`.
    hostEntry.current = next.id;
    if (video !== null) {
      video.currentTime = 0;
      void video.play().catch(() => setNeedsPress(true));
    }

    void repository
      .startEntry(roomId, next.id, nextPlayIndex(read.queue))
      .then(() => applyLocalChange(roomId, { kind: 'refresh' }))
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THE NEXT FILE COULD NOT START.'));
  }
  const fileEnded = useEffectEvent(() => moveOn(false));
  /** Whether the room says the host is playing, read by the effects without depending on every write. */
  const roomPlaying = useEffectEvent(() => room.isPlaying);
  const roomNow = useEffectEvent(() => room);

  const currentId = useEffectEvent(() => room.currentEntryId);
  // A tab that hands the transport on forgets where it was: if it hosts again, the room says.
  useEffect(() => {
    if (!amHost) hostEntry.current = null;
  }, [amHost]);

  useEffect(() => {
    if (!amHost || !live) return;
    const video = videoRef.current;
    if (video === null) return;
    // Hosting starts (or resumes after a new file loads) on the play the room names, unless this host
    // has already moved on past it.
    if (hostEntry.current === null) hostEntry.current = currentId();

    const say = () => publish();
    const ended = () => fileEnded();
    video.addEventListener('play', say);
    video.addEventListener('pause', say);
    video.addEventListener('seeked', say);
    video.addEventListener('ended', ended);
    // On a worker's clock, so a paused host in a background tab keeps the beat (lib/watch/steady-timer.ts).
    const stopBeat = steadyInterval(say, WATCH_HEARTBEAT_MS);

    // Taking the transport over mid-file: carry on from where this player is, and say so at once.
    if (roomPlaying() && video.paused && !video.ended) void video.play().catch(() => setNeedsPress(true));
    say();

    return () => {
      video.removeEventListener('play', say);
      video.removeEventListener('pause', say);
      video.removeEventListener('seeked', say);
      video.removeEventListener('ended', ended);
      stopBeat();
    };
  }, [amHost, live, item?.src]);

  /* --- following ------------------------------------------------------------------------------- */

  useEffect(() => {
    if (amHost || !live) return;

    const tick = () => {
      const video = videoRef.current;
      if (video === null || video.readyState < 1) return;
      const step = viewerStep(
        roomNow(),
        { seconds: video.currentTime, duration: video.duration, playing: !video.paused, ended: video.ended },
        Date.now(),
      );

      if (step.at !== undefined) video.currentTime = step.at;
      if (Math.abs(video.playbackRate - step.rate) > 0.01) video.playbackRate = step.rate;
      if (step.playing && video.paused) {
        void video.play().then(
          () => setNeedsPress(false),
          () => setNeedsPress(true),
        );
      } else if (!step.playing && !video.paused) {
        video.pause();
      }
    };

    tick();
    const timer = window.setInterval(tick, FOLLOW_TICK_MS);
    const video = videoRef.current;
    return () => {
      window.clearInterval(timer);
      if (video !== null) video.playbackRate = 1;
    };
  }, [amHost, live, item?.src]);

  // A room that ended stops the picture where it is.
  useEffect(() => {
    if (!live) videoRef.current?.pause();
  }, [live]);

  /* --- a host who vanished --------------------------------------------------------------------- */

  const hostId = room.hostId;
  useEffect(() => {
    if (user === null || amHost || !live || !membersHeard) return;
    if (!shouldTakeOver(members, hostId, myKey)) return;

    const attempt = () =>
      void repository.takeOver(roomId, hostId, user.id).then((won) => {
        if (won) applyLocalChange(roomId, { kind: 'refresh' });
      });
    attempt();
    const timer = window.setInterval(attempt, TAKE_OVER_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [repository, roomId, hostId, user, amHost, live, members, membersHeard, myKey]);

  // `<NAME> IS HOSTING NOW` on every change of host after the first one this tab saw (decision 6).
  const seenHost = useRef(hostId);
  const nameOf = useEffectEvent((userId: string) => members.find((member) => member.userId === userId)?.name);
  useEffect(() => {
    if (seenHost.current === hostId) return;
    seenHost.current = hostId;
    const name = nameOf(hostId) ?? 'A NEW HOST';
    setNotice(`${name.toUpperCase()} IS HOSTING NOW`);
    const timer = window.setTimeout(() => setNotice(null), HANDOVER_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [hostId]);

  /* --- the [ TV ] key's line ------------------------------------------------------------------- */

  const hostMember = accounts.find((member) => member.userId === hostId);
  const hostName = hostMember?.name ?? room.originalHostLabel;
  const title = item?.title ?? '';
  useEffect(() => {
    if (user === null || !live) {
      repository.setWatching(null);
      return;
    }
    repository.setWatching({ userId: user.id, roomId, hostName, title, hosting: amHost });
  }, [repository, user, live, roomId, hostName, title, amHost]);
  useEffect(() => () => repository.setWatching(null), [repository]);

  /* --- leaving --------------------------------------------------------------------------------- */

  const heir = user === null ? null : handoverTo(members, user.id);
  const myOtherTab = user !== null && members.some((member) => member.userId === user.id && member.key !== myKey);
  const [leaving, setLeaving] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  async function leave(choice: 'handover' | 'end') {
    setLeaving(true);
    try {
      if (choice === 'end') await repository.endRoom(roomId);
      else if (heir !== null && heir.userId !== null) await repository.handOver(roomId, heir.userId);
    } catch {
      // Leaving is not stopped by a failed write: the room hands itself over once this tab is gone.
    }
    onLeft();
  }

  // Anybody but a host with something to decide simply goes.
  useEffect(() => {
    if (closing && !(amHost && live && !myOtherTab)) onLeft();
  }, [closing, amHost, live, myOtherTab, onLeft]);

  // A host whose tab closes with others in the room hands over on the way out; if the write is lost
  // the others take over by themselves once the host has been quiet a few seconds.
  const goodbye = useEffectEvent(() => {
    const heirId = heir?.userId ?? null;
    if (amHost && live && !myOtherTab && heirId !== null) void repository.handOver(roomId, heirId).catch(() => undefined);
  });
  useEffect(() => {
    const onHide = () => goodbye();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  /* --- the picture ----------------------------------------------------------------------------- */

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted, item?.src]);

  function onTime() {
    const video = videoRef.current;
    if (video === null) return;
    setClock({ seconds: video.currentTime, duration: video.duration, paused: video.paused });
  }

  function joinPlayback() {
    const video = videoRef.current;
    if (video === null) return;
    void video.play().then(
      () => setNeedsPress(false),
      () => setNeedsPress(true),
    );
  }

  /* --- the layout ------------------------------------------------------------------------------ */

  const ended = !live;

  const stage = (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="relative bg-ink-plate">
        {item === undefined ? (
          <div className="flex aspect-video w-full items-center justify-center text-label font-bold text-ink-bar">
            {catalogue.loading ? 'READING THE CATALOGUE...' : 'THIS FILE IS NOT IN THE CATALOGUE.'}
          </div>
        ) : (
          <video
            ref={videoRef}
            src={item.src}
            preload="auto"
            playsInline
            autoPlay={amHost && live}
            onTimeUpdate={onTime}
            onLoadedMetadata={onTime}
            onPlay={onTime}
            onPause={onTime}
            className="aspect-video w-full object-contain"
            data-watch-video={amHost ? 'host' : 'viewer'}
          >
            <track kind="captions" />
          </video>
        )}
        {needsPress && live ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <button type="button" onClick={joinPlayback} className={PLATE_MAIN}>
              [ ▶ JOIN PLAYBACK ]
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink">
        <span className="min-w-0 truncate text-sm font-bold">{item?.title ?? '...'}</span>
        <span className="font-bold">{queueBadge(read)}</span>
        <span>
          {formatMediaTime(clock.seconds)} / {Number.isFinite(clock.duration) ? formatMediaTime(clock.duration) : '--:--'}
        </span>
      </div>

      {amHost && live ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={PLATE}
            onClick={() => {
              const video = videoRef.current;
              if (video === null) return;
              if (video.paused) void video.play().catch(() => setNeedsPress(true));
              else video.pause();
            }}
          >
            {clock.paused ? '[ ▶ PLAY ]' : '[ ❚❚ PAUSE ]'}
          </button>
          <input
            type="range"
            aria-label="Seek"
            min={0}
            max={Number.isFinite(clock.duration) ? clock.duration : 0}
            step={0.1}
            value={Math.min(clock.seconds, Number.isFinite(clock.duration) ? clock.duration : 0)}
            onChange={(event) => {
              const video = videoRef.current;
              if (video !== null) video.currentTime = Number(event.target.value);
            }}
            className="min-w-24 flex-1 accent-accent"
          />
          <button type="button" className={PLATE} disabled={waiting.length === 0} onClick={() => moveOn(true)} title={waiting.length === 0 ? 'Nothing queued' : undefined}>
            [ SKIP ▶▶ ]
          </button>
          {/* Ending it for everybody takes a second press, like starting it did. */}
          <button
            type="button"
            className={confirmEnd ? PLATE_PRESSED : PLATE}
            onClick={() => {
              if (!confirmEnd) {
                setConfirmEnd(true);
                return;
              }
              void repository
                .endRoom(roomId)
                .then(() => applyLocalChange(roomId, { kind: 'refresh' }))
                .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT BE ENDED.'));
            }}
            onBlur={() => setConfirmEnd(false)}
          >
            {confirmEnd ? '[ END FOR EVERYBODY ]' : '[ END STREAM ]'}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-label text-ink">
        <button type="button" className={muted ? PLATE_PRESSED : PLATE} aria-pressed={muted} onClick={() => setMuted((value) => !value)}>
          [ MUTE ]
        </button>
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          className="w-28 accent-accent"
        />
        {amHost ? <span className="font-bold">YOU ARE HOSTING</span> : null}
      </div>

      {notice === null ? null : <p className="w-fit bg-acid px-1 text-label font-bold text-ink-plate" role="status">{notice}</p>}
      {fault === null ? null : (
        <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          {fault}
        </p>
      )}
      {room.forumThreadId === null && live ? (
        <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">NOT ON THE BOARD</p>
      ) : null}

      <p className="text-label text-ink" data-watch-members={accounts.length}>
        <span className="font-bold">WATCHING ({accounts.length + guests})</span>{' '}
        {accounts.map((member, index) => (
          <span key={member.key}>
            {index === 0 ? '' : ', '}
            {member.userId === null ? member.name : <ProfileName author={{ id: member.userId, displayName: member.name }} />}
            {member.userId === hostId ? ' (HOST)' : ''}
          </span>
        ))}
        {guests > 0 ? `${accounts.length > 0 ? ' + ' : ''}${guests} GUEST${guests === 1 ? '' : 'S'}` : ''}
      </p>
    </div>
  );

  const queue = (
    <QueuePanel read={read} itemsById={itemsById} amHost={amHost && live} canAdd={user !== null && live} userId={user?.id ?? null} onFault={setFault} />
  );
  const chat = <ChatPanel read={read} item={item} videoRef={videoRef} live={live} />;

  return (
    <div className="flex flex-col gap-2">
      {ended ? (
        <p className="text-label font-bold text-ink" role="status">
          {room.endedAt === null ? 'THIS STREAM WENT QUIET.' : 'STREAM ENDED.'}{' '}
          {room.forumThreadId === null ? null : (
            <Link href={`/forum#${threadDomId(room.forumThreadId)}`} className="key px-1 py-1 text-label">
              [ READ THE RECORD ]
            </Link>
          )}
        </p>
      ) : null}

      {closing && amHost && live && !myOtherTab ? (
        <div className="flex flex-wrap items-center gap-2" role="alertdialog" aria-label="Leave the stream">
          <span className="text-label font-bold text-ink">{heir !== null ? `LEAVE? ${heir.name.toUpperCase()} WILL HOST.` : 'NOBODY ELSE IS HERE. END THE STREAM?'}</span>
          {heir !== null ? (
            <button type="button" disabled={leaving} className={PLATE} onClick={() => void leave('handover')}>
              [ LEAVE ]
            </button>
          ) : null}
          <button type="button" disabled={leaving} className={PLATE} onClick={() => void leave('end')}>
            [ END STREAM ]
          </button>
          <button type="button" disabled={leaving} className={PLATE} onClick={onStay}>
            [ STAY ]
          </button>
        </div>
      ) : null}

      {compact ? (
        <div className="flex flex-col gap-2">
          {stage}
          {chat}
          <details>
            <summary className={`${TITLE_BAR} cursor-pointer list-none`}>QUEUE ({playOrder(read.queue).length + waiting.length})</summary>
            {queue}
          </details>
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="min-w-0 flex-1">{stage}</div>
          <div className="flex w-80 shrink-0 flex-col gap-2">
            <p className={TITLE_BAR}>QUEUE</p>
            {queue}
            {chat}
          </div>
        </div>
      )}
    </div>
  );
}

/* --- the queue ----------------------------------------------------------------------------------- */

function QueuePanel({
  read,
  itemsById,
  amHost,
  canAdd,
  userId,
  onFault,
}: {
  read: WatchRoomRead;
  itemsById: Map<string, MediaItem>;
  amHost: boolean;
  canAdd: boolean;
  userId: string | null;
  onFault: (message: string) => void;
}) {
  const repository = getWatchRepository();
  const catalogue = useCatalogue();
  const [picking, setPicking] = useState(false);
  const played = playOrder(read.queue);
  const waiting = upcoming(read.queue);
  const videos = catalogue.items.filter((item) => item.kind === 'video');
  const titleOf = (entry: WatchQueueEntry) => (entry.mediaItemId ? (itemsById.get(entry.mediaItemId)?.title ?? 'A FILE NOT HELD') : 'A FILE NO LONGER HELD');
  const fail = (fallback: string) => (failure: unknown) => onFault(failure instanceof Error ? failure.message : fallback);

  async function add(mediaItemId: string) {
    if (userId === null) return;
    try {
      const entry = await repository.addToQueue({ roomId: read.room.id, mediaItemId, addedBy: userId, position: nextQueuePosition(read.queue) });
      applyLocalChange(read.room.id, { kind: 'entry', entry });
      setPicking(false);
    } catch (failure) {
      fail('THE FILE COULD NOT BE ADDED.')(failure);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <ol className="text-label text-ink" aria-label="Queue">
        {played.map((entry) => {
          const now = entry.id === read.room.currentEntryId;
          return (
            <li key={entry.id} className={`rule-pixel flex items-center gap-1 py-0.5 ${now ? 'font-bold' : 'text-ink-quiet'}`}>
              <span className="w-12 shrink-0">{now ? '▶ NOW' : 'PLAYED'}</span>
              <span className="min-w-0 flex-1 truncate">{titleOf(entry)}</span>
            </li>
          );
        })}
        {waiting.map((entry, index) => (
          <li key={entry.id} className="rule-pixel flex items-center gap-1 py-0.5">
            <span className="w-12 shrink-0">{index + 1}.</span>
            <span className="min-w-0 flex-1 truncate">{titleOf(entry)}</span>
            {amHost ? (
              <span className="flex shrink-0 items-center">
                <button
                  type="button"
                  className={PLATE}
                  disabled={index === 0}
                  aria-label={`Move ${titleOf(entry)} up`}
                  onClick={() => void repository.reorderQueue(moveInQueue(read.queue, entry.id, -1)).catch(fail('THE QUEUE COULD NOT BE REORDERED.'))}
                >
                  [ ↑ ]
                </button>
                <button
                  type="button"
                  className={PLATE}
                  disabled={index === waiting.length - 1}
                  aria-label={`Move ${titleOf(entry)} down`}
                  onClick={() => void repository.reorderQueue(moveInQueue(read.queue, entry.id, 1)).catch(fail('THE QUEUE COULD NOT BE REORDERED.'))}
                >
                  [ ↓ ]
                </button>
                <button
                  type="button"
                  className={PLATE}
                  aria-label={`Take ${titleOf(entry)} out`}
                  onClick={() =>
                    void repository
                      .removeFromQueue(entry.id)
                      .then(() => applyLocalChange(read.room.id, { kind: 'removed', table: 'queue', id: entry.id }))
                      .catch(fail('THE FILE COULD NOT BE TAKEN OUT.'))
                  }
                >
                  [ × ]
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {waiting.length === 0 && played.length > 0 ? <p className="text-label text-ink-quiet">LAST FILE LOOPS.</p> : null}

      {canAdd ? (
        picking ? (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-label font-bold text-ink">ADD A VIDEO</span>
              <button type="button" className={PLATE} onClick={() => setPicking(false)}>
                [ × ]
              </button>
            </div>
            {videos.length === 0 ? (
              <p className="text-label text-ink">NO VIDEOS YET.</p>
            ) : (
              <ul className="max-h-40 overflow-y-auto">
                {videos.map((video) => (
                  <li key={video.id} className="rule-pixel flex items-center gap-1 py-0.5 text-label text-ink">
                    <span className="min-w-0 flex-1 truncate">{video.title}</span>
                    {video.length.length === 0 ? null : <span className="shrink-0">{video.length}</span>}
                    <button type="button" className={PLATE} onClick={() => void add(video.id)}>
                      [ ADD ]
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <button type="button" className={`${PLATE} w-fit`} onClick={() => setPicking(true)}>
            [ + ADD ]
          </button>
        )
      ) : null}
    </div>
  );
}

/* --- the chat ------------------------------------------------------------------------------------ */

function ChatPanel({
  read,
  item,
  videoRef,
  live,
}: {
  read: WatchRoomRead;
  item: MediaItem | undefined;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  live: boolean;
}) {
  const { user } = useAuth();
  const repository = getWatchRepository();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const count = read.messages.length;

  // The newest line stays in view as lines arrive.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [count]);

  async function send() {
    if (user === null || draft.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const message = await repository.sendMessage({
        roomId: read.room.id,
        queueEntryId: read.room.currentEntryId,
        mediaItemId: item?.id ?? null,
        author: { id: user.id, label: user.displayName },
        body: draft,
        mediaSeconds: videoRef.current?.currentTime ?? 0,
      });
      applyLocalChange(read.room.id, { kind: 'message', message });
      setDraft('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'THE MESSAGE WAS NOT SENT.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-1">
      <p className={TITLE_BAR}>CHAT</p>
      <ol ref={listRef} className="max-h-72 min-h-24 overflow-y-auto text-prose text-ink" aria-label="Chat" aria-live="polite">
        {count === 0 ? <li className="text-label text-ink-quiet">NOTHING SAID YET.</li> : null}
        {read.messages.map((message) => (
          <TimedMessage key={message.id} message={message} mine={user !== null && message.authorId === user.id} roomId={read.room.id} />
        ))}
      </ol>
      {!live ? null : user === null ? (
        <p className="text-label font-bold text-ink">
          <Link href="/account" className="key px-1 py-1 text-label">
            [ LOG IN ]
          </Link>{' '}
          TO TALK
        </p>
      ) : (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor="watch-chat" className="sr-only">
            Message
          </label>
          <input
            id="watch-chat"
            value={draft}
            maxLength={MESSAGE_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Say something..."
            autoComplete="off"
            className={`${FIELD_TIGHT} min-w-0 flex-1`}
          />
          <button type="submit" disabled={busy || draft.trim().length === 0} className={PLATE_MAIN}>
            [ SEND ]
          </button>
        </form>
      )}
      {error === null ? null : (
        <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** One line of chat: where in the video it was said, who said it, what. The room, the record and the archive draw it the same. */
export function TimedMessage({ message, mine = false, roomId }: { message: WatchMessage; mine?: boolean; roomId?: string }) {
  const repository = getWatchRepository();

  return (
    <li className="flex items-baseline gap-2 py-0.5" data-watch-message={message.id}>
      <span className="shrink-0 text-label font-bold text-ink-quiet">{formatMediaTime(message.mediaSeconds)}</span>
      <span className="min-w-0 flex-1 wrap-anywhere">
        <span className="text-label font-bold">
          <ProfileName author={{ id: message.authorId, displayName: message.authorLabel }} />
        </span>{' '}
        {message.body}
      </span>
      {mine && roomId !== undefined ? (
        <button
          type="button"
          className={`${PLATE} shrink-0`}
          aria-label="Delete this message"
          onClick={() =>
            void repository
              .deleteMessage(message.id)
              .then(() => applyLocalChange(roomId, { kind: 'removed', table: 'messages', id: message.id }))
              .catch(() => undefined)
          }
        >
          [ × ]
        </button>
      ) : null}
    </li>
  );
}
