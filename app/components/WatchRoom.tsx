'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { stopFollowing } from '../lib/audio/follow';
import { threadDomId } from '../lib/forum/anchors';
import { useCatalogue } from '../lib/media/catalogue';
import type { MediaItem } from '../lib/media/types';
import { ASCII_EMOTICONS } from '../lib/comms/ascii-emoticons';
import { FIELD_TIGHT, KEY_FOCUS, PLATE, PLATE_MAIN, PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED, PLATE_PRESSED, TITLE_BAR, TITLE_BAR_BUTTON } from '../lib/ui/controls';
import { useNow } from '../lib/ui/use-now';
import { chatImageUrl, type ImageResult, type ImageSearchKind } from '../lib/watch/chat-images';
import { createEmbed, isEmbedKind } from '../lib/watch/embeds';
import { liveJump } from '../lib/watch/links';
import { hasQualityControl, hasSubtitleControl, type EmbedPlayable, type Playable, type QualityControl } from '../lib/watch/playable';
import { getWatchRepository } from '../lib/watch/repository';
import { streamBarState, subscribeToStreamBar } from '../lib/watch/stream-bar';
import {
  MESSAGE_MAX_LENGTH,
  TAKE_OVER_RETRY_MS,
  WATCH_HEARTBEAT_MS,
  accountsPresent,
  currentEntry,
  formatMediaTime,
  handoverTo,
  nextPlayIndex,
  nextToPlay,
  roomIsLive,
  shouldTakeOver,
  upcoming,
  viewerStep,
  withSeries,
} from '../lib/watch/rules';
import type { WatchLink, WatchMember, WatchMessage, WatchRoomRead } from '../lib/watch/types';
import { steadyInterval } from '../lib/watch/steady-timer';
import { attachStream, playsDirectly, type StreamHandle } from '../lib/watch/stream-player';
import { applyLocalChange } from '../lib/watch/use-watch-room';
import { officialEmbedUrl, WEB_EMBED_SANDBOX } from '../lib/web/official-embed';
import { withEnglishSubtitles } from '../lib/web/row-addresses';
import { webSessionHeaders } from '../lib/web/web-session';
import { detectLanguage } from '../lib/web/language';
import { burnedInSubtitles } from '../lib/web/subtitles';
import { archiveFileOf, useArchiveSubtitles } from '../lib/web/subtitles-client';
import { archiveSubtitles, streamSubtitles, type VideoSubtitles } from '../lib/watch/subtitle-tracks';
import { useAuth } from './AuthProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import ArtMark from './ArtMark';
import ProfileAvatarLink from './ProfileAvatarLink';
import LanguageFlag from './LanguageFlag';
import MarqueeText from './MarqueeText';
import ProfileName from './ProfileName';
import { QualityKey, SpeakerKey, SubsKey } from './StreamBarKeys';
import StreamCrawl from './StreamCrawl';
import StreamQueueWindow from './StreamQueueWindow';

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
/** How often the chat says what plays next, and how many of those lines it keeps. */
const UP_NEXT_EVERY_MS = 60_000;
const UP_NEXT_KEPT = 20;
/** A face beside each chat line, in pixels. */
const CHAT_AVATAR = 28;
/** The send key's hand-drawn arrow (`mark-send` in app/lib/ui/art/slots.ts), shown at 16px. */
const SEND_MARK_SRC = '/assets/icons/send.png';
const SEND_MARK_SIZE = 16;

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
  // An episode is named `SERIES :: EPISODE` (SPEC-stream-series.md).
  const entryTitle = entry === undefined ? undefined : link !== null ? withSeries(entry, link.title) : item?.title;
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

  /** The host moves on: the next file in the queue (inside a series, its next episode), or the same one again from the top. */
  function moveOn(skip: boolean) {
    const next = nextToPlay(read.queue);
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
    setNotice(`SKIPPED: ${(entryTitle ?? '').toUpperCase()} WOULDN'T PLAY`);
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
  /** A streaming link's library, as the QUALITY key's player once it has said what the stream carries. */
  const [streamQuality, setStreamQuality] = useState<{ entryId: string | null; control: QualityControl } | null>(null);
  useEffect(() => {
    if (!(videoElement instanceof HTMLVideoElement) || linkUrl === undefined || linkKind === undefined) return;
    // Right after a play changes, this can still be the element that was just taken away.
    if (videoRef.current !== videoElement) return;
    const streamed = { url: linkUrl, kind: linkKind, title: '' };
    if (playsDirectly(streamed)) return;
    const handle: StreamHandle = attachStream(videoElement, streamed, {
      onLive: (isLive) => setLiveEntry(isLive ? entryId : null),
      onFatal: () => setDeadEntry(entryId),
      onQualities: () => setStreamQuality({ entryId, control: handle }),
    }, startsPlaying());
    streamRef.current = handle;
    return () => {
      handle.detach();
      if (streamRef.current === handle) streamRef.current = null;
    };
  }, [videoElement, linkUrl, linkKind, entryId]);
  /** What QUALITY asks: an embedded site's player (YouTube, Twitch, Vimeo), else this play's streaming library. */
  const qualitySource = hasQualityControl(videoElement) ? videoElement : streamQuality !== null && streamQuality.entryId === entryId ? streamQuality.control : null;

  // SUBS (SPEC-subtitles.md): an embedded site's own captions (YouTube, Vimeo), a stream's subtitle tracks, or an
  // Archive video's subtitle files, fetched through our route only when this viewer switches one on.
  const archiveFile = link !== null && link.kind === 'file' ? archiveFileOf(link.url) : null;
  const archiveList = useArchiveSubtitles(archiveFile?.id ?? null);
  const archiveFiles = archiveFile !== null && archiveList ? (archiveList.videos[archiveFile.path] ?? null) : null;
  const [videoSubtitles, setVideoSubtitles] = useState<{ entryId: string | null; control: VideoSubtitles } | null>(null);
  useEffect(() => {
    if (!(videoElement instanceof HTMLVideoElement) || videoRef.current !== videoElement || linkKind === undefined) return;
    const control =
      linkKind === 'hls' || linkKind === 'dash'
        ? streamSubtitles(videoElement)
        : archiveFile !== null && archiveFiles !== null && archiveFiles.length > 0
          ? archiveSubtitles(videoElement, archiveFile.id, archiveFiles)
          : null;
    if (control === null) return;
    // Handed to the bar once this effect is done, as the streaming library's QUALITY player is from its callback.
    let current = true;
    void Promise.resolve().then(() => {
      if (current) setVideoSubtitles({ entryId, control });
    });
    return () => {
      current = false;
      control.detach();
      setVideoSubtitles((now) => (now?.control === control ? null : now));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoElement, linkKind, entryId, archiveFiles]);
  const subtitleSource = hasSubtitleControl(videoElement) ? videoElement : videoSubtitles !== null && videoSubtitles.entryId === entryId ? videoSubtitles.control : null;
  const subtitleTitle = link?.title ?? item?.title ?? '';

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

  // The bar sits under the picture and always shows: nothing covers the video (Luke, 2026-11-02). The
  // picture and the bar go fullscreen together, so the bar stays along the foot of the screen there too.
  const stageRef = useRef<HTMLDivElement>(null);

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

  const [queueOpen, setQueueOpen] = useState(false);

  /* --- the layout ------------------------------------------------------------------------------ */

  const ended = !live;
  /** A WEB platform's own player carries its own transport; the bar then holds only the host's keys. */
  const hasTransport = src !== undefined && !officialOn;
  const hostKeys = amHost && live;
  const duration = Number.isFinite(clock.duration) ? clock.duration : 0;
  const progress = duration > 0 ? Math.min(100, (clock.seconds / duration) * 100) : 0;

  // The music bar's box for the stream (lib/watch/stream-bar.ts): while the bar shows the stream, the keys live
  // there (Luke, 2026-11-03) and the picture has the room to itself. In fullscreen the bar is out of sight, and
  // while the bar shows the music it is not offered, so the keys come back under the picture.
  const barTarget = useSyncExternalStore(subscribeToStreamBar, () => streamBarState().target, () => null);
  const keysOnMusicBar = barTarget !== null && !fullscreen;

  // The keys, each drawn in whichever of the two bars is showing them.
  const playKey =
    hasTransport && hostKeys ? (
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
    ) : null;
  // A live stream has no position to show; the space is kept so the keys beside it stay put.
  const seekLine = stageLive ? (
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
  );
  const timeMark = stageLive ? (
    <span className="shrink-0 bg-acid px-1 font-bold text-ink-plate" data-watch-clock={clock.seconds.toFixed(1)}>
      LIVE
    </span>
  ) : (
    <span className="shrink-0 tabular-nums" data-watch-clock={clock.seconds.toFixed(1)}>
      {formatMediaTime(clock.seconds)} / {duration > 0 ? formatMediaTime(duration) : '--:--'}
    </span>
  );
  const skipKey = hostKeys ? (
    <button
      type="button"
      className={`${PLATE_ON_BLACK} shrink-0`}
      disabled={waiting.length === 0}
      aria-label="Skip to the next video"
      title={waiting.length === 0 ? 'Nothing queued' : 'Skip'}
      onClick={() => moveOn(true)}
    >
      [ ▶▶ ]
    </button>
  ) : null;
  const pictureKeys = hasTransport ? (
    <>
      <SpeakerKey muted={muted} volume={volume} onMuted={setMuted} onVolume={setVolume} />
      <QualityKey source={qualitySource} />
      <SubsKey
        key={entryId ?? 'none'}
        source={subtitleSource}
        play={entryId}
        seriesId={entry?.series?.id ?? null}
        textAudio={archiveList?.language ?? detectLanguage(subtitleTitle)}
        burnedIn={burnedInSubtitles(subtitleTitle)}
      />
      {canPip ? (
        <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label="Picture in picture" onClick={togglePip}>
          [ PIP ]
        </button>
      ) : null}
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
        {fullscreen ? '[ EXIT ]' : '[ FULL ]'}
      </button>
    </>
  ) : null;
  const endKey = hostKeys ? (
    // Ending it for everybody takes a second press, like starting it did.
    <button
      type="button"
      className={`${confirmEnd ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} shrink-0`}
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
  ) : null;

  // Under the picture, left to right: play/pause (host), where it is and the time, skip (host), the sound, QUALITY,
  // PIP, FULL, END STREAM (host). The chat column's strip names the video.
  const playerBar = !keysOnMusicBar && (hasTransport || hostKeys) ? (
    // `relative`: on a phone the SUBS list opens as a sheet across the bar, just above it.
    <div className="relative flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 bg-ink-plate px-2 py-1 text-label text-sun max-sm:gap-x-1" data-watch-bar="shown">
      {playKey}
      {/* Where it is, and the time: a row of its own on a phone, so the keys fit on the one under it. With no
          transport (a WEB platform's own player) the space only pushes the host's keys to the right. */}
      {!hasTransport ? (
        <span className="flex-1" />
      ) : (
        <span className="flex min-w-12 flex-1 items-center gap-2 max-sm:order-first max-sm:basis-full">
          {seekLine}
          {timeMark}
        </span>
      )}
      {skipKey}
      {pictureKeys}
      {endKey}
    </div>
  ) : null;

  /** On a desktop the picture takes the column's height; on a phone (and in fullscreen there) its own shape. */
  const pictureFit = fullscreen ? 'h-full w-full' : 'aspect-video w-full sm:aspect-auto sm:h-full';

  const stage = (
    <div className="flex min-w-0 flex-col gap-1 sm:min-h-0 sm:flex-1">
      {/* The picture with its bar under it: the two go fullscreen together. */}
      <div ref={stageRef} className="flex flex-col bg-ink-plate sm:min-h-0 sm:flex-1">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
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
          // Only the key takes the press. Over an embedded site's player it sits at the foot, so the site's own
          // play key in the middle stays in view and in reach: a phone may only start YouTube from there.
          <div
            className={`pointer-events-none absolute inset-0 z-20 flex justify-center ${
              link !== null && isEmbedKind(link.kind) ? 'items-end pb-3' : 'items-center'
            }`}
          >
            <button type="button" onClick={joinPlayback} className={`${PLATE_MAIN} pointer-events-auto`}>
              [ ▶ JOIN PLAYBACK ]
            </button>
          </div>
        ) : null}
      </div>
      {playerBar}
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
    nextEntry === undefined
      ? null
      : nextEntry.link !== null
        ? withSeries(nextEntry, nextEntry.link.title)
        : nextEntry.mediaItemId
          ? (itemsById.get(nextEntry.mediaItemId)?.title ?? null)
          : null;

  // On the music bar while it shows the stream, laid out as the music is: the black screen (what this is, the
  // title, what is next, where it is), then the keys in a black recess, as the music bar has its D-pad.
  const barCaption = notice ?? fault ?? `NEXT :: ${nextTitle ?? 'NOTHING QUEUED'}`;
  const musicBarPart =
    keysOnMusicBar && barTarget !== null
      ? createPortal(
          <>
            <span className="min-w-0 flex-1 frame bg-hardware px-2 py-1 text-label" data-stream-bar-screen>
              <span className="flex min-w-0 items-center gap-2 font-bold text-ink-bar">
                <span className={`shrink-0 px-1 ${live ? 'bg-acid text-ink-plate' : 'bg-bubble-pale text-ink-bar'}`}>{live ? 'LIVE' : 'ENDED'}</span>
                <span className="truncate">STREAM :: {amHost ? 'YOU ARE HOSTING' : `HOSTED BY ${hostName.toUpperCase()}`}</span>
              </span>
              <MarqueeText className="block text-key font-bold text-acid" text={entryTitle ?? '...'} />
              <MarqueeText className="block leading-readout-tight text-ink-bar" durationSeconds={22} text={barCaption} />
              {hasTransport ? (
                <span className="mt-1 flex min-w-0 items-center gap-2 text-ink-bar">
                  {seekLine}
                  {timeMark}
                </span>
              ) : null}
            </span>
            {/* `relative`: QUALITY and SUBS open their lists over their keys, above the bar. */}
            <span className="relative flex shrink-0 flex-wrap items-center gap-1 frame bg-hardware px-1 py-0.5 text-label text-sun" data-watch-bar="music">
              {playKey}
              {skipKey}
              {pictureKeys}
              <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-haspopup="dialog" onClick={() => setQueueOpen(true)} data-stream-bar-queue>
                [ QUEUE ]
              </button>
              {endKey}
            </span>
          </>,
          barTarget,
        )
      : null;

  // Top to bottom (Luke, 2026-11-02): the QUEUE line, which opens the queue as its own window; the strip of
  // who is watching with what is on and what is next, newswire-style, the width of the chat; then the chat.
  const side = (
    <div className="flex flex-col gap-1 sm:min-h-0 sm:w-80 sm:shrink-0 lg:w-96">
      {/* One key for the queue window, where everything is added and seen (Luke, 2026-11-02). */}
      <div className={TITLE_BAR}>
        <button type="button" className={`${TITLE_BAR_BUTTON} max-sm:min-h-tap`} aria-haspopup="dialog" onClick={() => setQueueOpen(true)} data-watch-queue-key>
          [ QUEUE ]
        </button>
      </div>
      <StreamCrawl accounts={accounts} hostId={hostId} currentTitle={entryTitle ?? '...'} nextTitle={nextTitle} />
      <ChatPanel read={read} item={item} videoRef={videoRef} live={live} nextTitle={live ? nextTitle : null} />
      {queueOpen ? (
        <StreamQueueWindow
          read={read}
          itemsById={itemsById}
          live={live}
          userId={user?.id ?? null}
          members={members}
          nowLive={stageLive}
          onClose={() => setQueueOpen(false)}
        />
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-2 sm:h-full sm:min-h-0">
      {musicBarPart}
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

/* --- the chat ------------------------------------------------------------------------------------ */

function ChatPanel({
  read,
  item,
  videoRef,
  live,
  nextTitle,
}: {
  read: WatchRoomRead;
  item: MediaItem | undefined;
  videoRef: React.RefObject<Playable | null>;
  live: boolean;
  /** What plays next, announced in this chat once a minute; null says nothing. */
  nextTitle: string | null;
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

  // The newest line stays in view as lines arrive.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [count]);

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
    <div className="flex flex-col gap-1 sm:min-h-0 sm:flex-1">
      <ol ref={listRef} className="max-h-72 min-h-24 overflow-y-auto text-prose text-ink sm:max-h-none sm:min-h-0 sm:flex-1" aria-label="Chat" aria-live="polite">
        {count === 0 ? <li className="text-label text-ink-quiet">NOTHING SAID YET.</li> : null}
        {lines.map((line) =>
          line.message !== null ? (
            <ChatLine key={line.message.id} message={line.message} />
          ) : (
            <li key={line.note.id} className="rule-pixel py-1 text-label font-bold text-ink-quiet" data-watch-up-next>
              UP NEXT :: {line.note.title}
              <LanguageFlag tag={detectLanguage(line.note.title)} className="ml-1.5" />
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
            {/* The shelf key and send sit at the end of the box, inside its edge (Luke, 2026-11-02): GIF opens
                the shelf, emotes included as its first tab, and the arrow sends - Enter still does too. */}
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
                  className={shelf !== null ? PLATE_PRESSED : PLATE}
                  aria-pressed={shelf !== null}
                  aria-label="Emotes, GIFs and images"
                  onClick={() => setShelf((open) => (open !== null ? null : 'gif'))}
                >
                  GIF
                </button>
                <button type="submit" disabled={busy || draft.trim().length === 0} className={PLATE} aria-label="Send" title="Send" data-watch-send>
                  <ArtMark src={SEND_MARK_SRC} size={SEND_MARK_SIZE} fallback={<span className="text-title leading-none">➤</span>} />
                </button>
              </span>
            </span>
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

/**
 * One line of the room's chat, laid out like a chat: the person's picture, their name in its colour, when, what.
 * No delete key (Luke, 2026-11-02): what is said in a stream stays said.
 */
function ChatLine({ message }: { message: WatchMessage }) {
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
        </span>
        <MessageBody body={message.body} />
      </span>
    </li>
  );
}

/** One line of chat: where in the video it was said, who said it, what. The record and the archive draw it the same. */
export function TimedMessage({ message }: { message: WatchMessage }) {
  return (
    <li className="flex items-baseline gap-2 py-0.5" data-watch-message={message.id}>
      <span className="shrink-0 text-label font-bold text-ink-quiet">{formatMediaTime(message.mediaSeconds)}</span>
      <span className="min-w-0 flex-1 wrap-anywhere">
        <span className="text-label font-bold">
          <ProfileName author={{ id: message.authorId, displayName: message.authorLabel }} />
        </span>{' '}
        <MessageBody body={message.body} />
      </span>
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
  const checked = officialEmbedUrl(link.url);
  // A PeerTube player is asked to start with English subtitles on foreign audio (SPEC-subtitles.md): its own
  // menu is the way to change them, since the room cannot drive this player. Added after the check, never stored.
  const url = checked !== null && new URL(checked).pathname.startsWith('/videos/embed/') ? withEnglishSubtitles(checked, 'peertube', detectLanguage(link.title)) : checked;

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
