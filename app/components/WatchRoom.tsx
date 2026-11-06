'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
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
import { forgetGuestReturn, guestReturnDraft, keepGuestReturn } from '../lib/watch/guest-return';
import { createEmbed, isEmbedKind } from '../lib/watch/embeds';
import { liveJump } from '../lib/watch/links';
import { hasQualityControl, hasSubtitleControl, type EmbedPlayable, type Playable, type QualityControl } from '../lib/watch/playable';
import { lookClass, lookForRoom } from '../lib/cytube/looks';
import { setOpenRoomLook } from '../lib/cytube/room-look';
import { saveLookChoice, useLookChoice } from '../lib/cytube/use-looks';
import { afterFile, blankPrefill, blankStart, screenIsBlank, type BlankKey } from '../lib/watch/blank-screen';
import { getWatchRepository } from '../lib/watch/repository';
import type { AudioTrack } from '../lib/audio/tracks';
import { frontPosition } from '../lib/watch/music-rooms';
import { isSongLink, songLink, trackForSong } from '../lib/watch/songs';
import { useWebTrack, webTrackNow } from '../lib/web/web-track-lookup';
import { switchMusicRoomOff } from '../lib/watch/use-music-room';

import { roomStartFor } from '../lib/watch/room-start';
import { streamBarState, subscribeToStreamBar } from '../lib/watch/stream-bar';
import {
  MESSAGE_MAX_LENGTH,
  TAKE_OVER_RETRY_MS,
  WATCH_HEARTBEAT_MS,
  accountsPresent,
  currentEntry,
  formatMediaTime,
  handoverTo,
  hasCrown,
  hostPosition,
  mayEditRoom,
  nextQueuePosition,
  nextPlayIndex,
  roomIsLive,
  shouldTakeOver,
  upcoming,
  viewerStep,
  withSeries,
  isGuestLabel,
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
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { useRoomGuest } from '../lib/watch/use-room-guest';
import { useAuth } from './AuthProvider';
import GuestWindow from './GuestWindow';
import { useRoomIdentity } from './use-room-identity';
import { useMusicPlayer } from './MusicPlayerProvider';
import ArtMark from './ArtMark';
import BlankScreen from './BlankScreen';
import { LookToggle } from './CytubeLayout';
import ProfileAvatarLink from './ProfileAvatarLink';
import LanguageFlag from './LanguageFlag';
import MarqueeText from './MarqueeText';
import ProfileName from './ProfileName';
import { QualityKey, SpeakerKey, SubsKey } from './StreamBarKeys';
import StreamCrawl from './StreamCrawl';
import RoomFloatChrome from './RoomFloatChrome';
import RoomSettingsWindow from './RoomSettingsWindow';
import StreamQueueWindow from './StreamQueueWindow';
import CanvasToggle from './CanvasToggle';
import RoomCanvas, { CanvasSaveAsk } from './RoomCanvas';
import { canvasDraggable, useCanvasOpen } from '../lib/watch/canvas-drag';
import { useScreenView } from '../lib/watch/canvas-view';
import { useChatLineDrag } from '../lib/watch/use-chat-line-drag';
import { askToSaveCanvas, closeRoomCanvas, type CanvasContext } from '../lib/watch/use-room-canvas';
import SongCoverCard from './SongCoverCard';

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
  /** The room is folded with its picture floating (SPEC-floating-player.md). */
  pictureFloats: boolean;
  /** Folds the room with its picture floating. */
  onFloatPicture: () => void;
  /** Back to the room, from the floating picture. */
  onBackFromFloat: () => void;
  /** The picture stops floating; the room stays folded and keeps playing. */
  onHidePicture: () => void;
};

/**
 * One stream room (SPEC-watch-together.md): the video large on the left with the transport under it,
 * the queue and the chat on the right; on a phone the video, then the chat, the queue folded.
 *
 * **The host** runs the one transport: every play, pause, seek and skip is written to the room at once,
 * and a heartbeat every few seconds keeps the pointer fresh (and tells the room the host is still there).
 * At the end of a file the next one in the queue starts; with nothing queued the screen goes back to black with
 * its three keys (SPEC-cytube.md), and the next thing a crown queues starts by itself.
 *
 * **Everybody else** follows: twice a second the player is compared with where the host should be now
 * and jumps (off by more than two seconds) or nudges its speed (a little off). A browser that refuses to
 * start the sound gets one key, `[ ▶ JOIN PLAYBACK ]`, rather than playing on silently out of step.
 */
export default function WatchRoom({ read, closing, onStay, onLeft, pictureFloats, onFloatPicture, onBackFromFloat, onHidePicture }: WatchRoomProps) {
  const { user } = useAuth();
  const catalogue = useCatalogue();
  const player = useMusicPlayer();
  const repository = getWatchRepository();
  const { room } = read;
  const roomId = room.id;

  const now = useNow(5000);

  const live = roomIsLive(room, now);
  const amHost = user !== null && room.hostId === user.id;
  /** Somebody's music room (SPEC-music-queues.md): its owner always hosts, it is switched off rather than ended, and it is not on the board. */
  const music = room.origin === 'music';
  const itemsById = useMemo(() => new Map(catalogue.items.map((item) => [item.id, item])), [catalogue.items]);
  const entry = currentEntry(read);
  /** Nothing on: the black screen with its three keys (SPEC-cytube.md). */
  const blank = screenIsBlank(room, read.queue);
  const item = entry?.mediaItemId ? itemsById.get(entry.mediaItemId) : undefined;
  const link = entry?.link ?? null;
  /**
   * A song row (SPEC-music-queues.md): the music bar plays it, from its own address, and the room's sync
   * reads and steers the bar's one audio element as it does the stage's `<video>`.
   */
  const song = isSongLink(link) ? link : null;
  const webSong = useWebTrack(song?.url);
  const songTrack = song === null ? null : trackForSong(song, player.queue, webSong);
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
  const roomGuest = useRoomGuest();
  const guestLabel = roomGuest?.label ?? '';
  /** The window that asks who this is, from pressing the canvas (SPEC-guests.md). */
  const [naming, setNaming] = useState(false);
  const [members, setMembers] = useState<WatchMember[]>([]);
  /** False until the room's presence has answered once: before that, "the host is missing" means nothing. */
  const [membersHeard, setMembersHeard] = useState(false);

  useEffect(() => {
    if (room.endedAt !== null) return;
    const membership = repository.joinRoom(
      roomId,
      // A guest is here by name only: no id on the wire, so nobody can crown them or hand them the room.
      { key: myKey, userId: user?.id ?? null, guestId: user === null ? (roomGuest?.id ?? null) : null, name: user?.displayName ?? guestLabel },
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
  }, [repository, roomId, room.endedAt, user?.id, user?.displayName, roomGuest?.id, guestLabel, myKey]);

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

  /** The queue ran out and the room is being put back to black: the old play's beat must not write it back. */
  const goingBlack = useRef(false);

  const publish = useEffectEvent(() => {
    const video = videoRef.current;
    if (video === null || !amHost || !live || goingBlack.current) return;

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
    const after = afterFile(read.queue);
    const video = videoRef.current;

    // The queue ran out: back to the black screen with its three keys (SPEC-cytube.md), not a loop of the last file.
    if (after.kind === 'black') {
      if (skip) return;
      hostEntry.current = null;
      goingBlack.current = true;
      video?.pause();
      void repository
        .writePlayback(roomId, { currentEntryId: null, positionSeconds: 0, isPlaying: false })
        .then(() => applyLocalChange(roomId, { kind: 'refresh' }))
        .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT BE UPDATED.'));
      return;
    }
    const next = after.entry;
    goingBlack.current = false;

    // From the top, at once: the next play may be the same file (nothing for the element to reload),
    // and a different file is loaded by its new `src` and started by `autoPlay`. The music bar's element
    // still holds the song that ended: the next row puts its own file on (`cue`, below).
    hostEntry.current = next.id;
    if (video !== null && song === null) {
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

  // `[ WATCH IN ROOM ]`: the room's first video carries on from where the viewer had got to (SPEC-floating-player.md, part 3).
  // Before the hosting effect below, so its first word to the room already says that place. A player not ready yet holds on to it.
  useEffect(() => {
    if (!amHost || !live || videoElement === null || entryId === null) return;
    const place = roomStartFor(videoElement, entryId);
    if (place !== null) videoElement.currentTime = place;
  }, [amHost, live, videoElement, entryId]);

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

  /* --- songs: the music bar plays them -------------------------------------------------------------- */

  const { bindRoom, cue, audioElement } = player;
  // While the room is live the bar's keys are the room's (MusicPlayerProvider `bindRoom`): the host's NEXT
  // skips, and a follower who takes the controls leaves the room.
  const skipFromBar = useEffectEvent(() => moveOn(true));
  const leaveFromBar = useEffectEvent(() => onLeft());

  // Off-queue plays (SPEC-music-queues.md): a song the host plays from a post, a profile or PLAY FOR YOU slots into
  // the queue at the current spot as playing, so the queue never lies; a book's later chapters go in right after it.
  /** The play the host just put on from outside the queue: it starts from the top, whatever the room said before. */
  const fromTop = useRef<string | null>(null);
  const playFromOutside = useEffectEvent((tracks: AudioTrack[]) => {
    const [first, ...rest] = tracks;
    if (first === undefined || user === null || !amHost) return;
    const queue = read.queue;
    const crowned = hasCrown(read.crowns, user.id);
    void repository
      .playNow({ roomId, by: user.id, link: songLink(first), position: nextQueuePosition(queue), playIndex: nextPlayIndex(queue) })
      .then(async (entry) => {
        fromTop.current = entry.id;
        hostEntry.current = entry.id;
        applyLocalChange(roomId, { kind: 'entry', entry });
        applyLocalChange(roomId, { kind: 'refresh' });
        if (rest.length === 1) await repository.addToQueue({ roomId, addedBy: user.id, position: frontPosition(queue), inQueue: crowned, link: songLink(rest[0]) });
        else if (rest.length > 1) await repository.addSeriesToQueue({ roomId, addedBy: user.id, position: frontPosition(queue), inQueue: crowned, seriesTitle: first.credit || first.title, links: rest.map(songLink) });
        if (rest.length > 0) applyLocalChange(roomId, { kind: 'refresh' });
      })
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'IT COULD NOT BE PLAYED IN THE ROOM.'));
  });
  // The host's ADD TO QUEUE / PLAY NEXT write into the room, by the crown rule: crowned, straight in; else their list.
  const enqueueFromOutside = useEffectEvent((track: AudioTrack, where: 'end' | 'next') => {
    if (user === null) return;
    void repository
      .addToQueue({
        roomId,
        addedBy: user.id,
        position: where === 'next' ? frontPosition(read.queue) : nextQueuePosition(read.queue),
        inQueue: hasCrown(read.crowns, user.id),
        link: songLink(track),
      })
      .then((entry) => applyLocalChange(roomId, { kind: 'entry', entry }))
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'IT COULD NOT BE ADDED.'));
  });
  // The room's songs still to play are the host's up-next while they host (what PLAY FOR YOU counts and tops up).
  // Kept on the stored queue's identity, not `waiting` (a new list each render): a new list here re-binds the player,
  // which draws this room again.
  const shelf = player.queue;
  const storedQueue = read.queue;
  const waitingSongs = useMemo(
    () => upcoming(storedQueue).flatMap((next) => (isSongLink(next.link) ? [trackForSong(next.link, shelf, webTrackNow(next.link.url))] : [])),
    [storedQueue, shelf],
  );
  useEffect(() => {
    if (!live) return;
    bindRoom({
      roomId,
      hosting: amHost,
      onNext: () => skipFromBar(),
      onLeave: () => leaveFromBar(),
      onPlay: (tracks) => playFromOutside(tracks),
      onEnqueue: (track, where) => enqueueFromOutside(track, where),
      waiting: waitingSongs,
    });
  }, [bindRoom, roomId, amHost, live, waitingSongs]);
  useEffect(() => () => bindRoom(null), [bindRoom]);
  useEffect(() => {
    if (!live) bindRoom(null);
  }, [live, bindRoom]);

  // A song row's file goes on the bar, where the host is in it; a follower's clock then keeps it in step.
  const songSrc = songTrack?.src ?? null;
  const songToCue = useEffectEvent(() => songTrack);
  const songStart = useEffectEvent(() => (entryId === fromTop.current ? 0 : room.currentEntryId === entryId ? hostPosition(room, Date.now()) : 0));
  // The host's bar plays it when the room says so (a room opened paused stays paused); a follower's clock decides theirs.
  const songPlays = useEffectEvent(() => !amHost || room.currentEntryId !== entryId || room.isPlaying);
  // Cued once per song row: `cue` changes whenever the player's own list does (a song it did not hold joins it as it
  // is cued, or the shelf is read again), and following that would put the song on again, from the top for an
  // off-queue play (code review, 2026-11-03).
  const cueSong = useEffectEvent((track: AudioTrack) => cue(track, { at: songStart() }, songPlays()));
  useEffect(() => {
    if (songSrc === null || !live) return;
    const track = songToCue();
    if (track !== null) cueSong(track);
  }, [songSrc, entryId, live]);

  // The room's sync reads the bar's element while a song is on, and the stage's own player otherwise.
  const songOn = songSrc !== null;
  const songTime = useEffectEvent(() => onTime());
  useEffect(() => {
    if (!songOn) return;
    const audio = audioElement();
    if (audio === null) return;
    // Handed to the sync once this effect is done, as the subtitles' player is below.
    let current = true;
    void Promise.resolve().then(() => {
      if (current) attachVideo(audio);
    });
    const tick = () => songTime();
    for (const type of ['timeupdate', 'loadedmetadata', 'play', 'pause']) audio.addEventListener(type, tick);
    return () => {
      current = false;
      for (const type of ['timeupdate', 'loadedmetadata', 'play', 'pause']) audio.removeEventListener(type, tick);
      if (videoRef.current === audio) attachVideo(null);
    };
  }, [songOn, audioElement, attachVideo]);

  // From a song to a video: the bar falls silent, and the picture plays.
  const songWasOn = useRef(false);
  useEffect(() => {
    if (songOn) {
      songWasOn.current = true;
      return;
    }
    if (!songWasOn.current) return;
    songWasOn.current = false;
    steer(false);
  }, [songOn, steer]);

  /* --- a host who vanished --------------------------------------------------------------------- */

  const hostId = room.hostId;
  useEffect(() => {
    // A music room is its owner's: a quiet host is waited for, never taken over.
    if (music || user === null || amHost || !live || !membersHeard) return;
    if (!shouldTakeOver(members, hostId, myKey)) return;

    const attempt = () =>
      void repository.takeOver(roomId, hostId, user.id).then((won) => {
        if (won) applyLocalChange(roomId, { kind: 'refresh' });
      });
    attempt();
    const timer = window.setInterval(attempt, TAKE_OVER_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [repository, roomId, hostId, user, amHost, live, members, membersHeard, myKey, music]);

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

  const { profile: myProfile } = usePublicProfile(user?.id ?? null);
  const hostMember = accounts.find((member) => member.userId === hostId);
  const hostName = hostMember?.name ?? room.originalHostLabel;
  const title = entryTitle ?? '';
  useEffect(() => {
    if (user === null || !live) {
      repository.setWatching(null);
      return;
    }
    repository.setWatching({ userId: user.id, roomId, hostName, title, hosting: amHost, unlisted: !myProfile.visibility.showOnline || room.privacy !== 'open' });
  }, [repository, user, live, roomId, hostName, title, amHost, myProfile.visibility.showOnline, room.privacy]);
  useEffect(() => () => repository.setWatching(null), [repository]);

  /* --- leaving --------------------------------------------------------------------------------- */

  const heir = user === null ? null : handoverTo(members, user.id);
  const myOtherTab = user !== null && members.some((member) => member.userId === user.id && member.key !== myKey);
  const [leaving, setLeaving] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  async function leave(choice: 'handover' | 'end') {
    setLeaving(true);
    try {
      // The canvas was asked about when the window's close key was pressed; ending the stream closes it too.
      if (choice === 'end') {
        await closeRoomCanvas(roomId);
        await repository.endRoom(roomId);
      }
      else if (heir !== null && heir.userId !== null) await repository.handOver(roomId, heir.userId);
    } catch {
      // Leaving is not stopped by a failed write: the room hands itself over once this tab is gone.
    }
    onLeft();
  }

  // Anybody but a host with something to decide simply goes. A music room's host closing it switches it off: kept,
  // and its songs are their up-next again.
  const switchOff = useEffectEvent(() => switchMusicRoomOff(read, player));
  const switching = useRef(false);
  useEffect(() => {
    if (!closing) return;
    if (music && amHost) {
      if (switching.current) return;
      switching.current = true;
      void switchOff()
        .catch(() => undefined)
        .finally(onLeft);
      return;
    }
    if (!(amHost && live && !myOtherTab)) onLeft();
  }, [closing, amHost, live, myOtherTab, onLeft, music]);

  // A host whose tab closes with others in the room hands over on the way out; if the write is lost
  // the others take over by themselves once the host has been quiet a few seconds.
  const goodbye = useEffectEvent(() => {
    if (music) return;
    const heirId = heir?.userId ?? null;
    if (amHost && live && !myOtherTab && heirId !== null) void repository.handOver(roomId, heirId).catch(() => undefined);
  });
  useEffect(() => {
    const onHide = () => goodbye();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  /* --- the picture ----------------------------------------------------------------------------- */

  // A song's sound is the music bar's (its own volume, and BARR's mute), not the room's speaker key.
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || songOn) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted, src, videoElement, songOn]);

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

  // A black screen has no player either (SPEC-cytube.md): the host's beat keeps the room live with nothing on.
  // Not while a play is being started, or a late beat would put the room back on nothing.
  const startingEntry = useRef<string | null>(null);
  const blankBeat = useEffectEvent(() => {
    // Also not once this host has put something on (a play from a post or profile): its echo is on the way.
    if (startingEntry.current !== null || hostEntry.current !== null) return;
    void repository
      .writePlayback(roomId, { currentEntryId: null, positionSeconds: 0, isPlaying: false })
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT BE UPDATED.'));
  });
  useEffect(() => {
    if (blank) goingBlack.current = false;
    if (!blank || !amHost || !live) return;
    blankBeat();
    return steadyInterval(() => blankBeat(), WATCH_HEARTBEAT_MS);
  }, [blank, amHost, live]);

  // Black, and a crown has queued something: the host starts it, from the top.
  const toStart = amHost && live ? blankStart(room, read.queue) : null;
  const toStartId = toStart?.id ?? null;
  const playIndexNow = useEffectEvent(() => nextPlayIndex(read.queue));
  useEffect(() => {
    // One start at a time: a second row queued at once waits until the first is on screen.
    if (toStartId === null || startingEntry.current !== null) return;
    startingEntry.current = toStartId;
    goingBlack.current = false;
    hostEntry.current = toStartId;
    void repository
      .startEntry(roomId, toStartId, playIndexNow())
      .then(() => applyLocalChange(roomId, { kind: 'refresh' }))
      .catch((failure: unknown) => {
        startingEntry.current = null;
        setFault(failure instanceof Error ? failure.message : 'THE NEXT FILE COULD NOT START.');
      });
  }, [toStartId, roomId, repository]);
  // On screen at last: the beat may speak again.
  useEffect(() => {
    if (room.currentEntryId !== null) startingEntry.current = null;
  }, [room.currentEntryId]);

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
  const pictureBox = useRef<HTMLDivElement>(null);
  function toggleFullscreen() {
    const box = stageRef.current;
    if (box === null) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    // A floating picture goes fullscreen alone, where it stands, and comes back as it was. Otherwise the stage, with its bar.
    const target = pictureFloats ? (pictureBox.current ?? box) : box;
    if (typeof target.requestFullscreen === 'function') {
      void target.requestFullscreen().catch(() => undefined);
      return;
    }
    // An iPhone fullscreens only a <video>, in its own player.
    const video = videoRef.current as (Playable & { webkitEnterFullscreen?: () => void }) | null;
    video?.webkitEnterFullscreen?.();
  }

  // The browser's own picture-in-picture is a <video>'s alone: an embedded site's player cannot be lifted out of the
  // tab. It floats inside the site instead (SPEC-floating-player.md): its box goes `position: fixed`, staying where it
  // is in the page, so the player never reloads and the sync never notices.
  const canPip = videoElement instanceof HTMLVideoElement && typeof document !== 'undefined' && document.pictureInPictureEnabled;
  function togglePip() {
    if (!(videoElement instanceof HTMLVideoElement)) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else void videoElement.requestPictureInPicture().catch(() => undefined);
  }

  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The search a blank screen's key opened the queue window with (SPEC-cytube.md). */
  const [queuePrefill, setQueuePrefill] = useState<string | undefined>(undefined);
  const openQueue = (key?: BlankKey) => {
    setQueuePrefill(key === undefined ? undefined : blankPrefill(key));
    setQueueOpen(true);
  };

  /* --- the room's look (SPEC-cytube.md) -------------------------------------------------------- */

  const myChoice = useLookChoice(user?.id ?? null);
  // Read fresh as the room opens: a look the host changed since this tab last read it shows.
  const hostChoice = useLookChoice(room.hostId, { fresh: true });
  const look = lookForRoom(hostChoice.look, myChoice, amHost);
  const lookCls = lookClass(look);
  /** With a look: its lines on the screen's frame and the LED's frames, its key colour on the bar's keys. */
  const lookLines = look === null ? '' : `${lookCls} [--frame-line:var(--room-lines)]`;
  const lookKeys = look === null ? '' : `${lookCls} room-keyed`;
  // The bar's own strip is drawn by the music player, outside this room: it reads the look from here.
  useEffect(() => {
    setOpenRoomLook(look);
  }, [look]);
  useEffect(() => () => setOpenRoomLook(null), []);

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
  const floatKey =
    link !== null && (officialOn || isEmbedKind(link.kind)) && song === null ? (
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label="Picture in picture: floats over the site" title="Floats over the site" onClick={pictureFloats ? onBackFromFloat : onFloatPicture}>
        [ PIP ]
      </button>
    ) : null;
  const pictureKeys = officialOn ? floatKey : hasTransport && song === null ? (
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
      ) : floatKey}
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
        {fullscreen ? '[ EXIT ]' : '[ FULL ]'}
      </button>
    </>
  ) : null;
  const endKey = hostKeys && !music ? (
    // Ending it for everybody takes a second press, like starting it did.
    <button
      type="button"
      className={`${confirmEnd ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} shrink-0`}
      onClick={() => {
        if (!confirmEnd) {
          setConfirmEnd(true);
          return;
        }
        // A changed canvas nobody saved asks "save this canvas?" first (SPEC-stream-art.md).
        void askToSaveCanvas(roomId, { ending: true })
          .then(() => repository.endRoom(roomId))
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
  const playerBar = !keysOnMusicBar && (hasTransport || hostKeys || floatKey !== null) ? (
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
  const pictureFit = fullscreen || pictureFloats ? 'h-full w-full' : 'aspect-video w-full sm:aspect-auto sm:h-full';
  /** A double press on the picture is the FULL key (Luke, 2026-11-05). Keys on the picture and a canvas being drawn on keep theirs. */
  const fullOnDoublePress = (event: MouseEvent<HTMLDivElement>) => {
    if (blank || song !== null || screen === 'canvas') return;
    if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea') !== null) return;
    toggleFullscreen();
  };

  // The room canvas (SPEC-stream-art.md): each viewer's own screen shows the picture or the shared canvas. While a
  // song plays the canvas is the default; with a video, the picture.
  const canvasAudio = song !== null;
  const screen = useScreenView(roomId, canvasAudio);
  const crownedIds = new Set(read.crowns.map((crown) => crown.userId));
  const canvasContext: CanvasContext = {
    me: user !== null ? { id: user.id, label: user.displayName } : roomGuest !== null && roomGuest.named && room.guestsCanTalk !== false ? { id: roomGuest.id, label: roomGuest.label } : null,
    guest: user === null,
    guests: new Set(members.flatMap((member) => (typeof member.guestId === 'string' ? [member.guestId] : []))),
    askName: user === null && live && room.guestsCanTalk !== false && (roomGuest === null || !roomGuest.named) ? () => setNaming(true) : undefined,
    host: { id: room.originalHostId, label: room.originalHostLabel },
    title: `${music ? 'MUSIC' : 'STREAM'} :: ${room.originalHostLabel.toUpperCase()}`,
    amHost,
    live,
    music,
    over: room.endedAt !== null || !room.isPublic,
    present: accounts.flatMap((member) => (member.userId === null ? [] : [{ id: member.userId, label: member.name, crowned: crownedIds.has(member.userId) }])),
    crowned: crownedIds,
  };

  const stage = (
    <div className="flex min-w-0 flex-col gap-1 sm:min-h-0 sm:flex-1">
      {/* The picture with its bar under it: the two go fullscreen together. */}
      <div ref={stageRef} className={`flex flex-col bg-ink-plate sm:min-h-0 sm:flex-1 ${look === null ? '' : `frame ${lookLines}`}`}>
      {/* Floating, the box leaves the folded window's invisible frame by staying in it: `visible` and `fixed`. */}
      <div ref={pictureBox} onDoubleClick={fullOnDoublePress} className={`${pictureFloats ? 'fixed visible frame bg-ink-plate pt-10 fullscreen:pt-0' : 'relative'} flex min-h-0 flex-1 items-center justify-center`} data-room-picture={pictureFloats ? 'floating' : 'in-room'}>
        {blank ? (
          <BlankScreen fit={pictureFit} onPick={(key) => openQueue(key)} hidden={screen === 'canvas'} />
        ) : src === undefined ? (
          <div className={`flex items-center justify-center text-label font-bold text-ink-bar ${pictureFit}`}>
            {catalogue.loading ? 'READING THE CATALOGUE...' : 'THIS FILE IS NOT IN THE CATALOGUE.'}
          </div>
        ) : songTrack !== null ? (
          <SongCoverCard track={songTrack} fit={pictureFit} />
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
        <RoomCanvas roomId={roomId} context={canvasContext} visible={screen === 'canvas'} />
        <CanvasToggle roomId={roomId} audio={canvasAudio} className="absolute right-1 top-1 z-30" />
        {pictureFloats ? <RoomFloatChrome host={pictureBox} title={entryTitle ?? 'STREAM'} onBack={onBackFromFloat} onHide={onHidePicture} /> : null}
      </div>
      {playerBar}
      </div>

      {notice === null ? null : <p className="w-fit bg-acid px-1 text-label font-bold text-ink-plate" role="status">{notice}</p>}
      {fault === null ? null : (
        <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          {fault}
        </p>
      )}
      {room.forumThreadId === null && live && !music ? (
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
            <span className={`min-w-0 flex-1 frame bg-hardware px-2 py-1 text-label ${lookLines}`} data-stream-bar-screen>
              <span className="flex min-w-0 items-center gap-2 font-bold text-ink-bar">
                <span className={`shrink-0 px-1 ${live ? 'bg-acid text-ink-plate' : 'bg-bubble-pale text-ink-bar'}`}>{live ? 'LIVE' : music ? 'OFF' : 'ENDED'}</span>
                <span className="truncate">
                  {music ? 'MUSIC' : 'STREAM'} :: {amHost ? 'YOU ARE HOSTING' : `HOSTED BY ${hostName.toUpperCase()}`}
                </span>
              </span>
              <MarqueeText className={`block text-key font-bold ${look === null ? 'text-acid' : 'text-room-readout'}`} text={blank ? 'NOTHING ON' : (entryTitle ?? '...')} />
              <MarqueeText className="block leading-readout-tight text-ink-bar" durationSeconds={22} text={barCaption} />
              {hasTransport ? (
                <span className="mt-1 flex min-w-0 items-center gap-2 text-ink-bar">
                  {seekLine}
                  {timeMark}
                </span>
              ) : null}
            </span>
            {/* `relative`: QUALITY and SUBS open their lists over their keys, above the bar. */}
            <span className={`relative flex shrink-0 flex-wrap items-center gap-1 frame bg-hardware px-1 py-0.5 text-label text-sun ${lookLines} ${lookKeys}`} data-watch-bar="music">
              {playKey}
              {skipKey}
              {pictureKeys}
              <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-haspopup="dialog" onClick={() => openQueue()} data-stream-bar-queue>
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
        <button type="button" className={`${TITLE_BAR_BUTTON} max-sm:min-h-tap`} aria-haspopup="dialog" onClick={() => openQueue()} data-watch-queue-key>
          [ QUEUE ]
        </button>
        {user !== null && mayEditRoom(room, read.crowns, user.id, live) ? (
          <button type="button" className={`${TITLE_BAR_BUTTON} max-sm:min-h-tap`} aria-haspopup="dialog" aria-label="Room settings" title="Room settings" onClick={() => setSettingsOpen(true)} data-room-settings-key>
            [ {'⚙︎'} ]
          </button>
        ) : null}
      </div>
      {room.topic === null ? null : (
        <p className="truncate text-label font-bold text-ink" title={room.topic} data-room-topic-line>
          {room.topic}
        </p>
      )}
      {user !== null && !amHost ? (
        <LookToggle compact choice={myChoice} onChange={(next) => void saveLookChoice(user.id, next).catch(() => undefined)} />
      ) : null}
      <StreamCrawl accounts={accounts} hostId={hostId} currentTitle={blank ? 'NOTHING ON' : (entryTitle ?? '...')} nextTitle={nextTitle} />
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
          prefill={queuePrefill}
          inRoom
          look={look}
        />
      ) : null}
      {naming && user === null ? <GuestWindow onNamed={() => setNaming(false)} onClose={() => setNaming(false)} /> : null}
      {settingsOpen && user !== null && mayEditRoom(room, read.crowns, user.id, live) ? <RoomSettingsWindow room={room} userId={user.id} look={look} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-2 sm:h-full sm:min-h-0">
      {musicBarPart}
      {ended ? (
        <p className="text-label font-bold text-ink" role="status">
          {music ? (room.isPublic ? 'THIS ROOM WENT QUIET.' : 'THIS ROOM IS OFF.') : room.endedAt === null ? 'THIS STREAM WENT QUIET.' : 'STREAM ENDED.'}{' '}
          {room.forumThreadId === null ? null : (
            <Link href={`/forum#${threadDomId(room.forumThreadId)}`} className="key px-1 py-1 text-label">
              [ READ THE RECORD ]
            </Link>
          )}
        </p>
      ) : null}

      {closing && amHost && live && !myOtherTab && !music ? (
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

      <CanvasSaveAsk roomId={roomId} reason="close" />

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
  const identity = useRoomIdentity();
  const repository = getWatchRepository();
  const [draft, setDraft] = useState(() => guestReturnDraft(read.room.id));
  /** The window that asks who is speaking (SPEC-guests.md). What was typed stays in the box behind it. */
  const [asking, setAsking] = useState(false);
  // Logged in from that window: there is nothing left to ask.
  if (asking && identity?.kind === 'account') setAsking(false);
  // What came back with this box has been put in it; an account has nothing more to come back to.
  const speakerKind = identity?.kind ?? null;
  useEffect(() => {
    if (speakerKind === 'account' || speakerKind === null) forgetGuestReturn();
  }, [speakerKind]);
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

  async function send(body: string, speaker: { id: string; label: string; named: boolean } | null = identity) {
    if (body.trim().length === 0) return false;
    if (speaker === null || !speaker.named) {
      keepGuestReturn(read.room.id, body);
      setAsking(true);
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await repository.sendMessage({
        roomId: read.room.id,
        queueEntryId: read.room.currentEntryId,
        mediaItemId: item?.id ?? null,
        author: { id: speaker.id, label: speaker.label },
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
      {asking ? (
        <GuestWindow
          onNamed={(guest) => {
            setAsking(false);
            forgetGuestReturn();
            void send(draft, guest).then((sent) => {
              if (sent) setDraft('');
            });
          }}
          onClose={() => {
            setAsking(false);
            forgetGuestReturn();
          }}
        />
      ) : null}
      {!live ? null : identity?.kind !== 'account' && read.room.guestsCanTalk === false ? (
        <p className="text-label font-bold text-ink" data-watch-guests-quiet>
          <Link href="/account" className="key px-1 py-1 text-label">
            [ LOG IN ]
          </Link>{' '}
          TO TALK. GUESTS WATCH ONLY IN THIS ROOM.
        </p>
      ) : (
        <div className="relative">
          {shelf === null ? null : (
            <ChatShelf
              tab={shelf}
              onTab={setShelf}
              emotesOnly={identity?.kind !== 'account'}
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
                  onClick={() => setShelf((open) => (open !== null ? null : identity?.kind === 'account' ? 'gif' : 'emote'))}
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
  emotesOnly,
  onEmote,
  onPicture,
  busy,
}: {
  tab: ShelfTab;
  onTab: (tab: ShelfTab) => void;
  /** Pictures are for accounts (SPEC-guests.md): the searches ask for one and a guest's line can't be one. */
  emotesOnly: boolean;
  onEmote: (text: string) => void;
  onPicture: (url: string) => void;
  busy: boolean;
}) {
  const [words, setWords] = useState('');
  // While the canvas is on screen the results can be dragged onto it, and now and then wiggle to say so.
  const canvasOpen = useCanvasOpen();
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
        {(emotesOnly ? SHELF_TABS.filter((entry) => entry.tab === 'emote') : SHELF_TABS).map((entry) => (
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
                  {state.results.map((result, index) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onPicture(result.url)}
                        {...(canvasOpen ? canvasDraggable(() => ({ type: 'picture', url: result.url, title: result.title })) : {})}
                        style={canvasOpen ? { animationDelay: `${(index % 6) * 0.45}s` } : undefined}
                        className={`block aspect-square w-full cursor-pointer overflow-hidden border border-ink bg-paper ${KEY_FOCUS} ${canvasOpen ? 'touch-none animate-wiggle hover:animate-none focus-visible:animate-none' : ''}`}
                        title={result.title}
                        aria-label={`Send ${result.title || 'this picture'}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked from GIPHY or Commons, never proxied or copied */}
                        <img src={result.thumb} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
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

/** Who said a line. A guest has no profile to open, so their name is plain, as a guest's post is on the board. */
function messageAuthor(message: WatchMessage) {
  return { id: isGuestLabel(message.authorLabel) ? null : message.authorId, displayName: message.authorLabel };
}

/** What a chat line says: its words, or the one GIPHY / Commons picture it links to, hotlinked from there. */
function MessageBody({ message }: { message: WatchMessage }) {
  const body = message.body;
  // Pictures are for accounts (SPEC-guests.md). The database writes a guest's name, so a guest's line always says so, however it is spelled.
  const picture = isGuestLabel(message.authorLabel) ? null : chatImageUrl(body);
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
  const author = messageAuthor(message);
  // While the canvas is on screen, a line can be dragged onto it (SPEC-stream-art.md).
  const drag = useChatLineDrag(message);
  return (
    <li className={`flex gap-2 py-1 ${drag === null ? '' : 'cursor-grab touch-none select-none'}`} data-watch-message={message.id} {...drag}>
      <ProfileAvatarLink author={author} size={CHAT_AVATAR} showName={false} variant="plain" className="shrink-0 self-start" />
      <span className="min-w-0 flex-1 wrap-anywhere">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-label font-bold">
            <ProfileName author={author} />
          </span>
          <span className="shrink-0 text-label text-ink-quiet">{formatMediaTime(message.mediaSeconds)}</span>
        </span>
        <MessageBody message={message} />
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
          <ProfileName author={messageAuthor(message)} />
        </span>{' '}
        <MessageBody message={message} />
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
