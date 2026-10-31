'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { stopFollowing } from '../lib/audio/follow';
import { threadDomId } from '../lib/forum/anchors';
import { useCatalogue } from '../lib/media/catalogue';
import type { MediaItem } from '../lib/media/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR, TITLE_BAR_BUTTON } from '../lib/ui/controls';
import { useCompactViewport } from '../lib/ui/use-compact-viewport';
import { useNow } from '../lib/ui/use-now';
import { createEmbed, fetchEmbedTitle, isEmbedKind } from '../lib/watch/embeds';
import { LINK_TITLE_MAX, linkTitle, liveJump, recognizeLink } from '../lib/watch/links';
import type { EmbedPlayable, Playable } from '../lib/watch/playable';
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
import type { WatchLink, WatchMember, WatchMessage, WatchQueueEntry, WatchRoomRead } from '../lib/watch/types';
import { steadyInterval } from '../lib/watch/steady-timer';
import { attachStream, checkLink, playsDirectly, type StreamHandle } from '../lib/watch/stream-player';
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
/** How long a host's player waits on a link that will not play before the room moves on. */
const DEAD_LINK_SKIP_MS = 5000;

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
  const link = entry?.link ?? null;
  /** What the stage plays: the link's own address, or the catalogue file's. */
  const src = link?.url ?? item?.src;
  const entryTitle = link?.title ?? item?.title;
  const entryId = entry?.id ?? null;
  /** A streaming link's player (hls.js / dash.js) while one is on; the stage's `src` is then its business. */
  const streamRef = useRef<StreamHandle | null>(null);
  /** The entry whose stream turned out to be live: no seek bar, LIVE for the time, everyone at the live edge. */
  const [liveEntry, setLiveEntry] = useState<string | null>(null);
  const stageLive = liveEntry !== null && liveEntry === entryId;
  const stageLiveNow = useEffectEvent(() => stageLive);
  /** Puts a live stream's player back at the live edge when it has fallen well behind (after a pause). */
  const toLiveEdge = useEffectEvent((video: Playable) => {
    if (!stageLive) return;
    const edge = 'liveEdge' in video ? (video as EmbedPlayable).liveEdge() : (streamRef.current?.liveEdge() ?? null);
    const jump = liveJump(edge, video.currentTime);
    if (jump !== undefined) video.currentTime = jump;
  });
  const waiting = upcoming(read.queue);

  /** The stage's player: a `<video>`, or an embedded site's player wrapped to act as one (lib/watch/playable.ts). */
  const videoRef = useRef<Playable>(null);
  /** The element itself, as state: the host's listeners and the follower's clock re-attach to a new one. */
  const [videoElement, setVideoElement] = useState<Playable | null>(null);
  const attachVideo = useCallback((element: Playable | null) => {
    videoRef.current = element;
    setVideoElement(element);
  }, []);
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
    const played = () => {
      toLiveEdge(video);
      say();
    };
    video.addEventListener('play', played);
    video.addEventListener('pause', say);
    video.addEventListener('seeked', say);
    video.addEventListener('ended', ended);
    // On a worker's clock, so a paused host in a background tab keeps the beat (lib/watch/steady-timer.ts).
    const stopBeat = steadyInterval(say, WATCH_HEARTBEAT_MS);

    // Taking the transport over mid-file: carry on from where this player is, and say so at once. A follower
    // waits at the end of a file for the host to move on, so a hand-over at that moment finds this player
    // already ended - its `ended` came before it was host and will not come again: move on now.
    if (roomPlaying() && video.ended) fileEnded();
    else if (roomPlaying() && video.paused) void video.play().catch(() => setNeedsPress(true));
    say();

    return () => {
      video.removeEventListener('play', played);
      video.removeEventListener('pause', say);
      video.removeEventListener('seeked', say);
      video.removeEventListener('ended', ended);
      stopBeat();
    };
  }, [amHost, live, src, videoElement]);

  /* --- following ------------------------------------------------------------------------------- */

  useEffect(() => {
    if (amHost || !live) return;

    const tick = () => {
      const video = videoRef.current;
      if (video === null || video.readyState < 1) return;
      // A live stream has no shared position: everybody plays and pauses with the host, at the live edge.
      if (stageLiveNow()) {
        toLiveEdge(video);
        if (video.playbackRate !== 1) video.playbackRate = 1;
        if (roomPlaying() && video.paused) void video.play().then(() => setNeedsPress(false), () => setNeedsPress(true));
        else if (!roomPlaying() && !video.paused) video.pause();
        return;
      }
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
  }, [amHost, live, src, videoElement]);

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
  const title = entryTitle ?? '';
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
  }, [volume, muted, src, videoElement]);

  // A link that will not play in this browser (an address tied to somebody else's session, one that
  // expired in the queue): it says so on the stage, and chat goes on. A host's room moves on after a
  // moment, so one dead link does not stop the stream for everybody.
  const [deadEntry, setDeadEntry] = useState<string | null>(null);
  const linkDead = link !== null && deadEntry !== null && deadEntry === entryId;
  const skipDead = useEffectEvent(() => {
    if (upcoming(read.queue).length === 0) return;
    setNotice(`SKIPPED: ${(link?.title ?? '').toUpperCase()} WOULDN'T PLAY`);
    moveOn(true);
  });
  useEffect(() => {
    if (!linkDead || !amHost || !live) return;
    const timer = window.setTimeout(() => skipDead(), DEAD_LINK_SKIP_MS);
    return () => window.clearTimeout(timer);
  }, [linkDead, amHost, live]);

  // A streaming link is fed into the same element by its library; the sync above reads and seeks it as
  // it would a file.
  const linkUrl = link?.url;
  const linkKind = link?.kind;
  const startsPlaying = useEffectEvent(() => amHost && live);
  useEffect(() => {
    if (!(videoElement instanceof HTMLVideoElement) || linkUrl === undefined || linkKind === undefined) return;
    // Right after a play changes, this can still be the element that was just taken away.
    if (videoRef.current !== videoElement) return;
    const streamed = { url: linkUrl, kind: linkKind, title: '' };
    if (playsDirectly(streamed)) return;
    const handle = attachStream(videoElement, streamed, {
      onLive: (isLive) => setLiveEntry(isLive ? entryId : null),
      onFatal: () => setDeadEntry(entryId),
    }, startsPlaying());
    streamRef.current = handle;
    return () => {
      handle.detach();
      if (streamRef.current === handle) streamRef.current = null;
    };
  }, [videoElement, linkUrl, linkKind, entryId]);

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
        {src === undefined ? (
          <div className="flex aspect-video w-full items-center justify-center text-label font-bold text-ink-bar">
            {catalogue.loading ? 'READING THE CATALOGUE...' : 'THIS FILE IS NOT IN THE CATALOGUE.'}
          </div>
        ) : link !== null && isEmbedKind(link.kind) ? (
          <EmbedStage
            key={`embed-${entryId}`}
            link={link}
            autoPlay={amHost && live}
            onPlayer={attachVideo}
            onGone={(gone) => {
              if (videoRef.current === gone) attachVideo(null);
            }}
            onTime={onTime}
            onPlaying={(player) => {
              setNeedsPress(false);
              setLiveEntry(player.isLive ? entryId : null);
            }}
            onError={() => setDeadEntry(entryId)}
            onBlocked={() => setNeedsPress(true)}
            role={amHost ? 'host' : 'viewer'}
          />
        ) : (
          <video
            // Files share one element (the next play may be the same file, nothing to reload); each stream
            // gets its own, so a library tidying up after itself never touches the next play's element.
            key={playsDirectly(link) ? 'direct' : `stream-${entryId}`}
            ref={attachVideo}
            src={playsDirectly(link) ? src : undefined}
            preload="auto"
            playsInline
            autoPlay={amHost && live}
            onTimeUpdate={onTime}
            onLoadedMetadata={onTime}
            onPlay={onTime}
            onPause={onTime}
            // Playing again (the next file after one that would not start) clears the JOIN PLAYBACK key.
            onPlaying={() => setNeedsPress(false)}
            onError={() => {
              if (link !== null) setDeadEntry(entryId);
            }}
            className="aspect-video w-full object-contain"
            data-watch-video={amHost ? 'host' : 'viewer'}
          >
            <track kind="captions" />
          </video>
        )}
        {linkDead ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
              THIS LINK WON&apos;T PLAY HERE
            </p>
          </div>
        ) : null}
        {needsPress && live && !linkDead ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <button type="button" onClick={joinPlayback} className={PLATE_MAIN}>
              [ ▶ JOIN PLAYBACK ]
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink">
        <span className="min-w-0 truncate text-sm font-bold">{entryTitle ?? '...'}</span>
        <span className="font-bold">{queueBadge(read)}</span>
        {stageLive ? (
          <span className="bg-acid px-1 font-bold text-ink-plate" data-watch-clock={clock.seconds.toFixed(1)}>
            LIVE
          </span>
        ) : (
          <span data-watch-clock={clock.seconds.toFixed(1)}>
            {formatMediaTime(clock.seconds)} / {Number.isFinite(clock.duration) ? formatMediaTime(clock.duration) : '--:--'}
          </span>
        )}
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
          {/* A live stream has no seek bar; its space is kept so the keys beside it stay put. */}
          {stageLive ? (
            <span className="min-w-24 flex-1" />
          ) : (
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
          )}
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
    <QueuePanel
      read={read}
      itemsById={itemsById}
      amHost={amHost && live}
      canAdd={user !== null && live}
      userId={user?.id ?? null}
      compact={compact}
      nowLive={stageLive}
      onFault={setFault}
    />
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

      {/* One tree at every width, so the video element is never rebuilt when the layout changes (a phone
          turned, a window resized): the host's listeners are on that element, and a rebuilt one played on
          without them - no loop, no pause written. Only the side column changes. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <div className="min-w-0 flex-1">{stage}</div>
        <div className="flex flex-col gap-2 sm:w-80 sm:shrink-0">
          {queue}
          {chat}
        </div>
      </div>
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
  compact,
  nowLive,
  onFault,
}: {
  read: WatchRoomRead;
  itemsById: Map<string, MediaItem>;
  amHost: boolean;
  canAdd: boolean;
  userId: string | null;
  /** On a phone the list folds under its title line; the add key stays on that line, outside the fold. */
  compact: boolean;
  /** What is on is a live stream: it never ends, so nothing loops. */
  nowLive: boolean;
  onFault: (message: string) => void;
}) {
  const repository = getWatchRepository();
  const catalogue = useCatalogue();
  const [picking, setPicking] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  // The video just added reads QUEUED for a moment, so the picker can stay open for the next one.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  useEffect(() => {
    if (justAdded === null) return;
    const timer = window.setTimeout(() => setJustAdded(null), 2000);
    return () => window.clearTimeout(timer);
  }, [justAdded]);
  const played = playOrder(read.queue);
  const waiting = upcoming(read.queue);
  const videos = catalogue.items.filter((item) => item.kind === 'video');
  const titleOf = (entry: WatchQueueEntry) =>
    entry.link !== null ? entry.link.title : entry.mediaItemId ? (itemsById.get(entry.mediaItemId)?.title ?? 'A FILE NOT HELD') : 'A FILE NO LONGER HELD';
  const fail = (fallback: string) => (failure: unknown) => onFault(failure instanceof Error ? failure.message : fallback);

  async function add(mediaItemId: string) {
    if (userId === null) return;
    try {
      const entry = await repository.addToQueue({ roomId: read.room.id, mediaItemId, addedBy: userId, position: nextQueuePosition(read.queue) });
      applyLocalChange(read.room.id, { kind: 'entry', entry });
      setJustAdded(mediaItemId);
    } catch (failure) {
      fail('THE FILE COULD NOT BE ADDED.')(failure);
    }
  }

  /* A pasted link (SPEC-watch-links.md): recognised as it is typed, its title filled in for editing, and
     loaded once in this browser when [ + ADD ] is pressed, so a link that won't play is refused here. */
  const [linkText, setLinkText] = useState('');
  const [linkName, setLinkName] = useState('');
  const [nameTyped, setNameTyped] = useState(false);
  const [linkState, setLinkState] = useState<{ kind: 'idle' } | { kind: 'checking' } | { kind: 'queued' } | { kind: 'refused'; reason: string }>({ kind: 'idle' });
  const verdict = linkText.trim().length === 0 ? null : recognizeLink(linkText);
  useEffect(() => {
    if (linkState.kind !== 'queued') return;
    const timer = window.setTimeout(() => setLinkState({ kind: 'idle' }), 2000);
    return () => window.clearTimeout(timer);
  }, [linkState]);

  // A YouTube or Vimeo video's real title, from its site, unless the adder has typed their own.
  const embedded = verdict?.ok && isEmbedKind(verdict.link.kind) ? verdict.link : null;
  const embeddedUrl = embedded?.url ?? null;
  const embeddedKind = embedded?.kind;
  useEffect(() => {
    if (embeddedUrl === null || embeddedKind === undefined || nameTyped) return;
    let stale = false;
    void fetchEmbedTitle({ url: embeddedUrl, kind: embeddedKind, title: '' }).then((found) => {
      if (!stale && found !== null) setLinkName(found);
    });
    return () => {
      stale = true;
    };
  }, [embeddedUrl, embeddedKind, nameTyped]);

  function typeLink(next: string) {
    setLinkText(next);
    if (linkState.kind === 'refused' || linkState.kind === 'queued') setLinkState({ kind: 'idle' });
    // An emptied box starts over; a title the adder typed is kept while they fix the link.
    if (next.trim().length === 0) setNameTyped(false);
    else if (nameTyped) return;
    const recognised = next.trim().length === 0 ? null : recognizeLink(next);
    setLinkName(recognised?.ok ? recognised.link.title : '');
  }

  async function addLink() {
    if (userId === null || verdict === null || linkState.kind === 'checking') return;
    if (!verdict.ok) {
      setLinkState({ kind: 'refused', reason: verdict.reason });
      return;
    }
    setLinkState({ kind: 'checking' });
    const reason = await checkLink(verdict.link);
    if (reason !== null) {
      setLinkState({ kind: 'refused', reason });
      return;
    }
    // [ + ADD ] pressed before the site's title came back: ask once more rather than keep the placeholder.
    const named = !nameTyped && isEmbedKind(verdict.link.kind) && linkName === verdict.link.title ? ((await fetchEmbedTitle(verdict.link)) ?? linkName) : linkName;
    const link: WatchLink = { ...verdict.link, title: linkTitle(named, verdict.link.title) };
    try {
      const entry = await repository.addToQueue({ roomId: read.room.id, link, addedBy: userId, position: nextQueuePosition(read.queue) });
      applyLocalChange(read.room.id, { kind: 'entry', entry });
      setLinkText('');
      setLinkName('');
      setNameTyped(false);
      setLinkState({ kind: 'queued' });
    } catch (failure) {
      setLinkState({ kind: 'refused', reason: failure instanceof Error ? failure.message : 'THE LINK COULD NOT BE ADDED.' });
    }
  }

  const showList = !compact || unfolded;
  // Labelled and ruled off, so its rows never read as the queue's own.
  const picker = picking ? (
    <div className="rule-pixel pb-1">
      <p className="text-label text-ink-quiet">ADD A VIDEO</p>
      {/* noValidate: the room says what is wrong with a link, not the browser's own bubble. */}
      <form
        noValidate
        className="flex flex-col gap-1 pb-1"
        onSubmit={(event) => {
          event.preventDefault();
          void addLink();
        }}
      >
        <div className="flex items-center gap-1">
          <label htmlFor="watch-link" className="sr-only">
            Video link
          </label>
          <input
            id="watch-link"
            type="url"
            inputMode="url"
            value={linkText}
            onChange={(event) => typeLink(event.target.value)}
            placeholder="PASTE A VIDEO LINK"
            autoComplete="off"
            spellCheck={false}
            className={`${FIELD_TIGHT} min-w-0 flex-1`}
          />
          <button type="submit" className={PLATE} disabled={verdict === null || linkState.kind === 'checking'}>
            [ + ADD ]
          </button>
        </div>
        {/* Kept on screen with nothing in it, so the box above never moves. */}
        <label htmlFor="watch-link-title" className="sr-only">
          Title
        </label>
        <input
          id="watch-link-title"
          value={linkName}
          maxLength={LINK_TITLE_MAX}
          disabled={verdict === null || !verdict.ok}
          onChange={(event) => {
            setLinkName(event.target.value);
            setNameTyped(true);
          }}
          placeholder="TITLE"
          autoComplete="off"
          className={`${FIELD_TIGHT} min-w-0`}
        />
        <p className="text-label font-bold text-ink" role="status" data-watch-link-state={linkState.kind}>
          {linkState.kind === 'checking' ? (
            'CHECKING THE LINK...'
          ) : linkState.kind === 'queued' ? (
            'QUEUED'
          ) : linkState.kind === 'refused' ? (
            <span className="bg-bubble-pale px-1 text-ink-bar">{linkState.reason}</span>
          ) : (
            ' '
          )}
        </p>
      </form>
      {videos.length === 0 ? (
        <p className="text-label text-ink">NO VIDEOS YET.</p>
      ) : (
        <ul className="max-h-48 overflow-y-auto" aria-label="Videos to add">
          {videos.map((video) => (
            <li key={video.id} className="rule-pixel flex items-center gap-1 py-0.5 text-label text-ink">
              <span className="min-w-0 flex-1 wrap-anywhere">{video.title}</span>
              {video.length.length === 0 ? null : <span className="shrink-0">{video.length}</span>}
              {/* Its box is kept when empty, so the key beside it never moves. */}
              <span className="w-14 shrink-0 text-right font-bold" role="status">
                {justAdded === video.id ? 'QUEUED' : ''}
              </span>
              <button type="button" className={PLATE} onClick={() => void add(video.id)}>
                [ ADD ]
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-1">
      <div className={TITLE_BAR}>
        {compact ? (
          <button type="button" className="cursor-pointer max-sm:min-h-tap" aria-expanded={unfolded} onClick={() => setUnfolded((value) => !value)}>
            QUEUE ({played.length + waiting.length}) {unfolded ? '▴' : '▾'}
          </button>
        ) : (
          <span>QUEUE</span>
        )}
        {canAdd ? (
          <button
            type="button"
            className={picking ? `${TITLE_BAR_BUTTON} key-fill key-on [--key-fill:var(--color-ink)] text-paper` : TITLE_BAR_BUTTON}
            aria-pressed={picking}
            onClick={() => setPicking((value) => !value)}
          >
            {picking ? '[ DONE ]' : '[ + ADD VIDEO ]'}
          </button>
        ) : null}
    </div>
      {picker}
      {showList ? (
        <>
          <ol className="text-label text-ink" aria-label="Queue">
            {played.map((entry) => {
              const now = entry.id === read.room.currentEntryId;
              return (
                <li key={entry.id} className={`rule-pixel flex items-center gap-1 py-0.5 ${now ? 'font-bold' : 'text-ink-quiet'}`}>
                  <span className="w-14 shrink-0">{now ? '▶ NOW' : 'PLAYED'}</span>
                  <span className="min-w-0 flex-1 wrap-anywhere">{titleOf(entry)}</span>
                </li>
              );
            })}
            {waiting.map((entry, index) => (
              <li key={entry.id} className="rule-pixel flex items-center gap-1 py-0.5">
                <span className="w-14 shrink-0">{index + 1}.</span>
                <span className="min-w-0 flex-1 wrap-anywhere">{titleOf(entry)}</span>
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
          {waiting.length === 0 && played.length > 0 && !nowLive ? <p className="text-label text-ink-quiet">LAST FILE LOOPS.</p> : null}
        </>
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
  videoRef: React.RefObject<Playable | null>;
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

/**
 * A video from YouTube, Vimeo or Twitch on the stage (SPEC-watch-links.md steps 3-4): the site's own embed
 * player in the stage's box, handed to the room as its player (`onPlayer`), so the sync drives it like
 * the `<video>`.
 */
function EmbedStage({
  link,
  autoPlay,
  onPlayer,
  onGone,
  onTime,
  onPlaying,
  onError,
  onBlocked,
  role,
}: {
  link: WatchLink;
  autoPlay: boolean;
  onPlayer: (player: Playable) => void;
  onGone: (player: Playable) => void;
  onTime: () => void;
  onPlaying: (player: EmbedPlayable) => void;
  onError: () => void;
  /** The browser would not start it without a press. */
  onBlocked: () => void;
  role: 'host' | 'viewer';
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Read when the player is made, not a reason to make it again.
  const startsPlaying = useEffectEvent(() => autoPlay);
  const time = useEffectEvent(() => onTime());
  const playing = useEffectEvent((player: EmbedPlayable) => onPlaying(player));
  const failed = useEffectEvent(() => onError());
  const blocked = useEffectEvent(() => onBlocked());
  const give = useEffectEvent((player: EmbedPlayable) => onPlayer(player));
  const take = useEffectEvent((player: EmbedPlayable) => onGone(player));
  const { url, kind } = link;

  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const player = createEmbed({ url, kind, title: '' }, box, startsPlaying());
    if (player === null) {
      failed();
      return;
    }
    const onTick = () => time();
    const onPlay = () => playing(player);
    const onFail = () => failed();
    const onBlock = () => blocked();
    player.addEventListener('blocked', onBlock);
    for (const type of ['timeupdate', 'loadedmetadata', 'play', 'pause']) player.addEventListener(type, onTick);
    player.addEventListener('playing', onPlay);
    player.addEventListener('error', onFail);
    give(player);
    return () => {
      take(player);
      player.destroy();
      box.replaceChildren();
    };
  }, [url, kind]);

  return <div ref={boxRef} className="aspect-video w-full" data-watch-video={role} data-watch-embed={kind} />;
}
