'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { stopFollowing } from '../lib/audio/follow';
import { threadDomId } from '../lib/forum/anchors';
import { useCatalogue } from '../lib/media/catalogue';
import type { MediaItem } from '../lib/media/types';
import { ASCII_EMOTICONS } from '../lib/comms/ascii-emoticons';
import { FIELD_TIGHT, KEY_FOCUS, PLATE, PLATE_MAIN, PLATE_ON_BLACK, PLATE_PRESSED, TITLE_BAR, TITLE_BAR_BUTTON } from '../lib/ui/controls';
import { useNow } from '../lib/ui/use-now';
import { chatImageUrl, type ImageResult, type ImageSearchKind } from '../lib/watch/chat-images';
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
import { officialEmbedUrl, WEB_EMBED_SANDBOX } from '../lib/web/official-embed';
import { webSessionHeaders } from '../lib/web/web-session';
import { useAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import ProfileAvatarLink from './ProfileAvatarLink';
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
/** How long the player bar stays up after the pointer or a finger last moved over the picture. */
const BAR_LINGER_MS = 2500;
/** How often the chat says what plays next, and how many of those lines it keeps. */
const UP_NEXT_EVERY_MS = 60_000;
const UP_NEXT_KEPT = 20;
/** A face beside each chat line and each name under WATCHING, in pixels. */
const CHAT_AVATAR = 28;

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

  // A WEB platform's own player (`embed`) gives the room no transport to read, so the host's heartbeat is
  // said here instead: the room stays live (not closed as quiet) and on this play until the host moves on.
  const officialOn = link !== null && link.kind === 'embed';
  const officialBeat = useEffectEvent(() => {
    void repository
      .writePlayback(roomId, { currentEntryId: room.currentEntryId, positionSeconds: 0, isPlaying: true })
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT BE UPDATED.'));
  });
  useEffect(() => {
    if (!officialOn || !amHost || !live) return;
    officialBeat();
    return steadyInterval(() => officialBeat(), WATCH_HEARTBEAT_MS);
  }, [officialOn, amHost, live, entryId]);

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

  /* --- the player bar -------------------------------------------------------------------------- */

  // The bar over the foot of the picture shows under the pointer, while keyboard focus is inside it, for a
  // moment after a tap or a move, and all the time while the picture is paused.
  const stageRef = useRef<HTMLDivElement>(null);
  const [poked, setPoked] = useState(false);
  const pokeTimer = useRef<number | undefined>(undefined);
  function poke() {
    setPoked(true);
    window.clearTimeout(pokeTimer.current);
    pokeTimer.current = window.setTimeout(() => setPoked(false), BAR_LINGER_MS);
  }
  useEffect(() => () => window.clearTimeout(pokeTimer.current), []);

  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  function toggleFullscreen() {
    const box = stageRef.current;
    if (box === null) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (typeof box.requestFullscreen === 'function') {
      void box.requestFullscreen().catch(() => undefined);
      return;
    }
    // An iPhone fullscreens only a <video>, in its own player.
    const video = videoRef.current as (Playable & { webkitEnterFullscreen?: () => void }) | null;
    video?.webkitEnterFullscreen?.();
  }

  // Picture-in-picture is a <video>'s alone: an embedded site's player cannot be lifted out from here.
  const canPip = videoElement instanceof HTMLVideoElement && typeof document !== 'undefined' && document.pictureInPictureEnabled;
  function togglePip() {
    if (!(videoElement instanceof HTMLVideoElement)) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else void videoElement.requestPictureInPicture().catch(() => undefined);
  }

  const [showViewers, setShowViewers] = useState(false);

  /* --- the layout ------------------------------------------------------------------------------ */

  const ended = !live;
  /** A WEB platform's own player carries its own controls; the bar would only cover them. */
  const hasBar = src !== undefined && !officialOn;
  const barShown = poked || clock.paused;
  const duration = Number.isFinite(clock.duration) ? clock.duration : 0;
  const progress = duration > 0 ? Math.min(100, (clock.seconds / duration) * 100) : 0;

  const playerBar = hasBar ? (
    <div
      className={`absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 bg-ink-plate max-sm:gap-x-1 px-2 py-1 text-label text-sun transition-opacity motion-reduce:transition-none ${
        barShown
          ? 'opacity-100'
          : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100'
      }`}
      data-watch-bar={barShown ? 'shown' : 'hidden'}
    >
      {amHost && live ? (
        <button
          type="button"
          className={`${PLATE_ON_BLACK} shrink-0`}
          aria-label={clock.paused ? 'Play' : 'Pause'}
          onClick={() => {
            const video = videoRef.current;
            if (video === null) return;
            if (video.paused) void video.play().catch(() => setNeedsPress(true));
            else video.pause();
          }}
        >
          {clock.paused ? '[ ▶ ]' : '[ ❚❚ ]'}
        </button>
      ) : null}
      {/* Where it is, and the time: a row of its own on a phone, so the keys fit on the one under it. */}
      <span className="flex min-w-12 flex-1 items-center gap-2 max-sm:order-first max-sm:basis-full">
      {/* A live stream has no position to show; the space is kept so the keys beside it stay put. */}
      {stageLive ? (
        <span className="min-w-12 flex-1" />
      ) : amHost && live ? (
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={duration}
          step={0.1}
          value={Math.min(clock.seconds, duration)}
          onChange={(event) => {
            const video = videoRef.current;
            if (video !== null) video.currentTime = Number(event.target.value);
          }}
          className="min-w-12 flex-1 accent-sun"
        />
      ) : (
        // Only the host moves the room's position, so everybody else sees where it is without a handle.
        <span className="h-1 min-w-12 flex-1 bg-chrome-dark" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <span className="block h-full bg-sun" style={{ width: `${progress}%` }} />
        </span>
      )}
      {stageLive ? (
        <span className="shrink-0 bg-acid px-1 font-bold text-ink-plate" data-watch-clock={clock.seconds.toFixed(1)}>
          LIVE
        </span>
      ) : (
        <span className="shrink-0 tabular-nums" data-watch-clock={clock.seconds.toFixed(1)}>
          {formatMediaTime(clock.seconds)} / {duration > 0 ? formatMediaTime(duration) : '--:--'}
        </span>
      )}
      </span>
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((value) => !value)}>
        {muted ? '[ UNMUTE ]' : '[ MUTE ]'}
      </button>
      {/* A phone has its own volume keys. */}
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(event) => setVolume(Number(event.target.value))}
        className="w-20 shrink-0 accent-sun max-sm:hidden"
      />
      {canPip ? (
        <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label="Picture in picture" onClick={togglePip}>
          [ PIP ]
        </button>
      ) : null}
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
        {fullscreen ? '[ EXIT ]' : '[ FULL ]'}
      </button>
    </div>
  ) : null;

  /** On a desktop the picture takes the column's height; on a phone (and in fullscreen there) its own shape. */
  const pictureFit = fullscreen ? 'h-full w-full' : 'aspect-video w-full sm:aspect-auto sm:h-full';

  const stage = (
    <div className="flex min-w-0 flex-col gap-1 sm:min-h-0 sm:flex-1">
      <div
        ref={stageRef}
        className="group relative flex items-center justify-center bg-ink-plate sm:min-h-0 sm:flex-1"
        onPointerMove={poke}
        onPointerDown={poke}
      >
        {src === undefined ? (
          <div className={`flex items-center justify-center text-label font-bold text-ink-bar ${pictureFit}`}>
            {catalogue.loading ? 'READING THE CATALOGUE...' : 'THIS FILE IS NOT IN THE CATALOGUE.'}
          </div>
        ) : link !== null && link.kind === 'embed' ? (
          <OfficialEmbedStage key={`official-${entryId}`} link={link} fit={pictureFit} />
        ) : link !== null && isEmbedKind(link.kind) ? (
          <EmbedStage
            key={`embed-${entryId}`}
            link={link}
            fit={pictureFit}
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
            className={`object-contain ${pictureFit}`}
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
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <button type="button" onClick={joinPlayback} className={PLATE_MAIN}>
              [ ▶ JOIN PLAYBACK ]
            </button>
          </div>
        ) : null}
        {/* A tap inside an embedded site's player never reaches this page, so on a phone the bar could not be
            called up over one: a clear strip along the foot catches the tap instead. */}
        {hasBar && link !== null && isEmbedKind(link.kind) && !barShown ? (
          <div className="absolute inset-x-0 bottom-0 z-10 h-10 sm:hidden" aria-hidden="true" onPointerDown={poke} />
        ) : null}
        {playerBar}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink">
        <span className="min-w-24 flex-1 truncate text-sm font-bold">{entryTitle ?? '...'}</span>
        <span className="font-bold">{queueBadge(read)}</span>
        {amHost ? <span className="font-bold">YOU ARE HOSTING</span> : null}
        {amHost && live ? (
          <span className="ml-auto flex flex-wrap items-center gap-2">
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
          </span>
        ) : null}
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
    </div>
  );

  const nextEntry = waiting[0];
  const nextTitle =
    nextEntry === undefined ? null : nextEntry.link !== null ? nextEntry.link.title : nextEntry.mediaItemId ? (itemsById.get(nextEntry.mediaItemId)?.title ?? null) : null;

  const side = (
    <div className="flex flex-col gap-1 sm:min-h-0 sm:w-80 sm:shrink-0 lg:w-96">
      <div className={TITLE_BAR}>
        <span className="min-w-0 truncate" title={entryTitle}>
          ▶ {entryTitle ?? '...'}
        </span>
        <button
          type="button"
          className={showViewers ? `${TITLE_BAR_BUTTON} key-fill key-on [--key-fill:var(--color-ink)] text-paper` : TITLE_BAR_BUTTON}
          aria-pressed={showViewers}
          onClick={() => setShowViewers((value) => !value)}
          data-watch-members={accounts.length}
        >
          WATCHING {accounts.length + guests}
        </button>
      </div>
      <QueuePanel read={read} itemsById={itemsById} amHost={amHost && live} canAdd={user !== null && live} userId={user?.id ?? null} nowLive={stageLive} onFault={setFault} />
      {showViewers ? <ViewerList accounts={accounts} guests={guests} hostId={hostId} /> : null}
      {/* Hidden, not removed, while the list is up: a half-typed line and the UP NEXT lines survive a look at who is in. */}
      <ChatPanel read={read} item={item} videoRef={videoRef} live={live} nextTitle={live ? nextTitle : null} shown={!showViewers} />
    </div>
  );

  return (
    <div className="flex flex-col gap-2 sm:h-full sm:min-h-0">
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
      <div className="flex flex-col gap-2 sm:min-h-0 sm:flex-1 sm:flex-row sm:gap-3">
        {stage}
        {side}
      </div>
    </div>
  );
}

/* --- who is watching ----------------------------------------------------------------------------- */

/** The room's people, in place of the chat while WATCHING is pressed: picture, name in its colour, the host marked. */
function ViewerList({ accounts, guests, hostId }: { accounts: WatchMember[]; guests: number; hostId: string }) {
  return (
    <ul className="max-h-72 min-h-24 overflow-y-auto text-label text-ink sm:max-h-none sm:min-h-0 sm:flex-1" aria-label="Watching">
      {accounts.map((member) => (
        <li key={member.key} className="rule-pixel flex items-center gap-2 py-1">
          {member.userId === null ? (
            <span className="font-bold">{member.name}</span>
          ) : (
            <>
              <ProfileAvatarLink author={{ id: member.userId, displayName: member.name }} size={CHAT_AVATAR} showName={false} variant="plain" />
              <span className="min-w-0 flex-1 truncate font-bold">
                <ProfileName author={{ id: member.userId, displayName: member.name }} />
              </span>
            </>
          )}
          {member.userId === hostId ? <span className="shrink-0 bg-acid px-1 font-bold text-ink-plate">HOST</span> : null}
        </li>
      ))}
      {guests > 0 ? (
        <li className="py-1 font-bold text-ink-quiet">
          {guests} GUEST{guests === 1 ? '' : 'S'}
        </li>
      ) : null}
    </ul>
  );
}

/* --- the queue ----------------------------------------------------------------------------------- */

function QueuePanel({
  read,
  itemsById,
  amHost,
  canAdd,
  userId,
  nowLive,
  onFault,
}: {
  read: WatchRoomRead;
  itemsById: Map<string, MediaItem>;
  amHost: boolean;
  canAdd: boolean;
  userId: string | null;
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

  // Folded under its title line at every width, to leave the chat its room; the add key stays outside the fold.
  const showList = unfolded;
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
        <button type="button" className="cursor-pointer max-sm:min-h-tap" aria-expanded={unfolded} onClick={() => setUnfolded((value) => !value)}>
          QUEUE ({played.length + waiting.length}) {unfolded ? '▴' : '▾'}
        </button>
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
          <ol className="max-h-60 overflow-y-auto text-label text-ink" aria-label="Queue">
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
  nextTitle,
  shown,
}: {
  read: WatchRoomRead;
  item: MediaItem | undefined;
  videoRef: React.RefObject<Playable | null>;
  live: boolean;
  /** What plays next, announced in this chat once a minute; null says nothing. */
  nextTitle: string | null;
  shown: boolean;
}) {
  const { user } = useAuth();
  const repository = getWatchRepository();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shelf, setShelf] = useState<ShelfTab | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // UP NEXT, once a minute, in this browser only: never sent, never on the board or in the record.
  const [notes, setNotes] = useState<UpNextNote[]>([]);
  const upNext = useEffectEvent(() => nextTitle);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const title = upNext();
      if (title === null) return;
      const at = new Date().toISOString();
      setNotes((kept) => [...kept, { id: `up-next-${at}`, at, title }].slice(-UP_NEXT_KEPT));
    }, UP_NEXT_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  const lines = useMemo(() => {
    const said = read.messages.map((message) => ({ at: message.createdAt, message, note: null }));
    const told = notes.map((note) => ({ at: note.at, message: null, note }));
    return [...said, ...told].sort((a, b) => a.at.localeCompare(b.at));
  }, [read.messages, notes]);
  const count = lines.length;

  // The newest line stays in view as lines arrive, and when the chat comes back from behind the WATCHING list.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [count, shown]);

  async function send(body: string) {
    if (user === null || body.trim().length === 0) return false;
    setBusy(true);
    setError(null);
    try {
      const message = await repository.sendMessage({
        roomId: read.room.id,
        queueEntryId: read.room.currentEntryId,
        mediaItemId: item?.id ?? null,
        author: { id: user.id, label: user.displayName },
        body,
        mediaSeconds: videoRef.current?.currentTime ?? 0,
      });
      applyLocalChange(read.room.id, { kind: 'message', message });
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'THE MESSAGE WAS NOT SENT.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${shown ? 'flex' : 'hidden'} flex-col gap-1 sm:min-h-0 sm:flex-1`}>
      <ol ref={listRef} className="max-h-72 min-h-24 overflow-y-auto text-prose text-ink sm:max-h-none sm:min-h-0 sm:flex-1" aria-label="Chat" aria-live="polite">
        {count === 0 ? <li className="text-label text-ink-quiet">NOTHING SAID YET.</li> : null}
        {lines.map((line) =>
          line.message !== null ? (
            <ChatLine key={line.message.id} message={line.message} mine={user !== null && line.message.authorId === user.id} roomId={read.room.id} />
          ) : (
            <li key={line.note.id} className="rule-pixel py-1 text-label font-bold text-ink-quiet" data-watch-up-next>
              UP NEXT :: {line.note.title}
            </li>
          ),
        )}
      </ol>
      {!live ? null : user === null ? (
        <p className="text-label font-bold text-ink">
          <Link href="/account" className="key px-1 py-1 text-label">
            [ LOG IN ]
          </Link>{' '}
          TO TALK
        </p>
      ) : (
        <div className="relative">
          {shelf === null ? null : (
            <ChatShelf
              tab={shelf}
              onTab={setShelf}
              onEmote={(text) => {
                setDraft((current) => `${current}${current.length === 0 || current.endsWith(' ') ? '' : ' '}${text}`.slice(0, MESSAGE_MAX_LENGTH));
                inputRef.current?.focus();
              }}
              onPicture={(url) => {
                void send(url).then((sent) => {
                  if (sent) setShelf(null);
                });
              }}
              busy={busy}
            />
          )}
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft).then((sent) => {
                if (sent) setDraft('');
              });
            }}
          >
            <label htmlFor="watch-chat" className="sr-only">
              Message
            </label>
            {/* The two shelf keys sit at the end of the box, inside its edge. */}
            <span className="relative flex min-w-0 flex-1 items-stretch">
              <input
                id="watch-chat"
                ref={inputRef}
                value={draft}
                maxLength={MESSAGE_MAX_LENGTH}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Say something..."
                autoComplete="off"
                className={`${FIELD_TIGHT} min-w-0 flex-1 pr-24`}
              />
              <span className="absolute inset-y-0 right-0.5 flex items-center gap-0.5">
                <button
                  type="button"
                  className={shelf === 'emote' ? PLATE_PRESSED : PLATE}
                  aria-pressed={shelf === 'emote'}
                  aria-label="Emoticons"
                  onClick={() => setShelf((open) => (open === 'emote' ? null : 'emote'))}
                >
                  :)
                </button>
                <button
                  type="button"
                  className={shelf !== null && shelf !== 'emote' ? PLATE_PRESSED : PLATE}
                  aria-pressed={shelf !== null && shelf !== 'emote'}
                  aria-label="Search GIFs and images"
                  onClick={() => setShelf((open) => (open !== null && open !== 'emote' ? null : 'gif'))}
                >
                  GIF
                </button>
              </span>
            </span>
            <button type="submit" disabled={busy || draft.trim().length === 0} className={PLATE_MAIN}>
              [ SEND ]
            </button>
          </form>
        </div>
      )}
      {error === null ? null : (
        <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type ShelfTab = 'emote' | ImageSearchKind;
type UpNextNote = { id: string; at: string; title: string };

const SHELF_TABS: { tab: ShelfTab; label: string }[] = [
  { tab: 'emote', label: 'EMOTES' },
  { tab: 'gif', label: 'GIFS' },
  { tab: 'sticker', label: 'STICKERS' },
  { tab: 'image', label: 'IMAGES' },
];

/**
 * The shelf over the chat box: the site's ASCII emoticons, or a search of GIPHY (GIFs, stickers) or Wikimedia Commons
 * (images) through the server (`/api/watch/images`). A picked picture is sent at once as its link, which every
 * chat line that is one picture link draws as the picture (lib/watch/chat-images.ts).
 */
function ChatShelf({
  tab,
  onTab,
  onEmote,
  onPicture,
  busy,
}: {
  tab: ShelfTab;
  onTab: (tab: ShelfTab) => void;
  onEmote: (text: string) => void;
  onPicture: (url: string) => void;
  busy: boolean;
}) {
  const [words, setWords] = useState('');
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'searching' } | { kind: 'found'; results: ImageResult[] } | { kind: 'failed'; reason: string }>({
    kind: 'idle',
  });

  async function search(kind: ImageSearchKind, query: string) {
    if (query.trim().length === 0) return;
    setState({ kind: 'searching' });
    try {
      const headers = await webSessionHeaders();
      if (headers === null) {
        setState({ kind: 'failed', reason: 'LOG IN TO SEARCH.' });
        return;
      }
      const response = await fetch(`/api/watch/images?kind=${kind}&q=${encodeURIComponent(query.trim())}`, { headers });
      const answer = (await response.json().catch(() => null)) as { results?: ImageResult[]; error?: string } | null;
      if (!response.ok || answer === null || !Array.isArray(answer.results)) {
        setState({ kind: 'failed', reason: answer?.error ?? 'THE SEARCH DID NOT ANSWER. TRY AGAIN.' });
        return;
      }
      // Only links the chat would draw are offered, whatever the server said.
      setState({ kind: 'found', results: answer.results.filter((result) => chatImageUrl(result.url) !== null && chatImageUrl(result.thumb) !== null) });
    } catch {
      setState({ kind: 'failed', reason: 'THE SEARCH DID NOT ANSWER. TRY AGAIN.' });
    }
  }

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-1 flex max-h-96 flex-col gap-1 frame bg-sun-pale p-2" role="dialog" aria-label="Emoticons and pictures">
      <div className="flex flex-wrap gap-1">
        {SHELF_TABS.map((entry) => (
          <button
            key={entry.tab}
            type="button"
            className={entry.tab === tab ? PLATE_PRESSED : PLATE}
            aria-pressed={entry.tab === tab}
            onClick={() => {
              onTab(entry.tab);
              if (entry.tab !== 'emote' && words.trim().length > 0) void search(entry.tab, words);
              else setState({ kind: 'idle' });
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {tab === 'emote' ? (
        <div className="min-h-0 overflow-y-auto">
          {ASCII_EMOTICONS.map((group, index) => (
            <div key={group.id} className={index === 0 ? undefined : 'mt-2'}>
              <p className="text-label font-bold text-ink">{group.label}</p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {group.emoticons.map((emoticon) => (
                  <li key={emoticon.text}>
                    <button type="button" onClick={() => onEmote(emoticon.text)} className={`${PLATE} font-mono`} title={emoticon.about}>
                      {emoticon.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <>
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void search(tab, words);
            }}
          >
            <label htmlFor="watch-picture-search" className="sr-only">
              Search
            </label>
            <input
              id="watch-picture-search"
              value={words}
              maxLength={80}
              onChange={(event) => setWords(event.target.value)}
              placeholder={tab === 'image' ? 'SEARCH WIKIMEDIA COMMONS' : 'SEARCH GIPHY'}
              autoComplete="off"
              autoFocus
              className={`${FIELD_TIGHT} min-w-0 flex-1`}
            />
            <button type="submit" className={PLATE} disabled={words.trim().length === 0 || state.kind === 'searching'}>
              [ FIND ]
            </button>
          </form>
          <div className="min-h-0 overflow-y-auto" role="status">
            {state.kind === 'searching' ? (
              <p className="text-label font-bold text-ink">SEARCHING...</p>
            ) : state.kind === 'failed' ? (
              <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{state.reason}</p>
            ) : state.kind === 'found' ? (
              state.results.length === 0 ? (
                <p className="text-label font-bold text-ink">NOTHING FOUND.</p>
              ) : (
                <ul className="grid grid-cols-3 gap-1" aria-label="Pictures">
                  {state.results.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onPicture(result.url)}
                        className={`block aspect-square w-full cursor-pointer overflow-hidden border border-ink bg-paper ${KEY_FOCUS}`}
                        title={result.title}
                        aria-label={`Send ${result.title || 'this picture'}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked from GIPHY or Commons, never proxied or copied */}
                        <img src={result.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
          <p className="text-label text-ink-quiet">{tab === 'image' ? 'FREE IMAGES FROM WIKIMEDIA COMMONS' : 'POWERED BY GIPHY'}</p>
        </>
      )}
    </div>
  );
}

/** What a chat line says: its words, or the one GIPHY / Commons picture it links to, hotlinked from there. */
function MessageBody({ body }: { body: string }) {
  const picture = chatImageUrl(body);
  // A picture the host has taken down reads as its link rather than a blank.
  const [gone, setGone] = useState(false);
  if (picture === null || gone) return <>{body}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- hotlinked from GIPHY or Commons, never proxied or copied
    <img src={picture} alt="A picture" loading="lazy" referrerPolicy="no-referrer" onError={() => setGone(true)} className="mt-0.5 block max-h-40 max-w-full border border-ink" />
  );
}

/** One line of the room's chat, laid out like a chat: the person's picture, their name in its colour, when, what. */
function ChatLine({ message, mine, roomId }: { message: WatchMessage; mine: boolean; roomId: string }) {
  const author = { id: message.authorId, displayName: message.authorLabel };
  return (
    <li className="flex gap-2 py-1" data-watch-message={message.id}>
      <ProfileAvatarLink author={author} size={CHAT_AVATAR} showName={false} variant="plain" className="shrink-0 self-start" />
      <span className="min-w-0 flex-1 wrap-anywhere">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-label font-bold">
            <ProfileName author={author} />
          </span>
          <span className="shrink-0 text-label text-ink-quiet">{formatMediaTime(message.mediaSeconds)}</span>
          {mine ? <DeleteMessage message={message} roomId={roomId} /> : null}
        </span>
        <MessageBody body={message.body} />
      </span>
    </li>
  );
}

function DeleteMessage({ message, roomId }: { message: WatchMessage; roomId: string }) {
  const repository = getWatchRepository();
  return (
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
  );
}

/** One line of chat: where in the video it was said, who said it, what. The room, the record and the archive draw it the same. */
export function TimedMessage({ message, mine = false, roomId }: { message: WatchMessage; mine?: boolean; roomId?: string }) {
  return (
    <li className="flex items-baseline gap-2 py-0.5" data-watch-message={message.id}>
      <span className="shrink-0 text-label font-bold text-ink-quiet">{formatMediaTime(message.mediaSeconds)}</span>
      <span className="min-w-0 flex-1 wrap-anywhere">
        <span className="text-label font-bold">
          <ProfileName author={{ id: message.authorId, displayName: message.authorLabel }} />
        </span>{' '}
        <MessageBody body={message.body} />
      </span>
      {mine && roomId !== undefined ? <DeleteMessage message={message} roomId={roomId} /> : null}
    </li>
  );
}

/**
 * An item queued from /web (SPEC-web.md, Phase 5): the platform's own official player, unmodified, in the
 * same sandbox /web gives it, and only when its address is still that platform's allow-listed embed
 * (`officialEmbedUrl`). The platform's player cannot be driven from here, so the room does not keep it in
 * step: everybody presses play on it themselves, and the host moves the room on with NEXT.
 */
function OfficialEmbedStage({ link, fit }: { link: WatchLink; fit: string }) {
  const url = officialEmbedUrl(link.url);

  if (url === null) {
    return (
      <div className={`flex items-center justify-center text-label font-bold text-ink-bar ${fit}`}>
        THIS LINK WON&apos;T PLAY HERE
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${fit}`}>
      <iframe
        src={url}
        title={`Player: ${link.title}`}
        referrerPolicy="no-referrer"
        sandbox={WEB_EMBED_SANDBOX}
        allow="fullscreen"
        className="min-h-0 w-full flex-1 bg-paper"
        data-watch-embed="embed"
      />
      <p className="bg-paper px-1 text-label font-bold text-ink">NOT IN STEP: EVERYONE PRESSES PLAY ON THIS ONE.</p>
    </div>
  );
}

/**
 * A video from YouTube, Vimeo or Twitch on the stage (SPEC-watch-links.md steps 3-4): the site's own embed
 * player in the stage's box, handed to the room as its player (`onPlayer`), so the sync drives it like
 * the `<video>`.
 */
function EmbedStage({
  link,
  fit,
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
  /** The box's shape, from the room: its own 16:9 on a phone, the stage's height on a desktop. */
  fit: string;
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

  return <div ref={boxRef} className={fit} data-watch-video={role} data-watch-embed={kind} />;
}
