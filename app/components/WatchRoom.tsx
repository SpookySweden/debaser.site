'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import Link from 'next/link';
import { stopFollowing } from '../lib/audio/follow';
import { AUTO_FILED_BODY, autoThreadTitle, threadDomId } from '../lib/forum/anchors';
import { webAnchor } from '../lib/web/bridges';
import { useForum } from './ForumProvider';
import { useCatalogue } from '../lib/media/catalogue';
import type { MediaItem } from '../lib/media/types';
import { ASCII_EMOTICONS } from '../lib/comms/ascii-emoticons';
import { FIELD_TIGHT, KEY_FOCUS, PLATE, PLATE_LINK, PLATE_MAIN, PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED, PLATE_PRESSED, TITLE_BAR, TITLE_BAR_BUTTON } from '../lib/ui/controls';
import { useNow } from '../lib/ui/use-now';
import { chatImageUrl, type ImageResult, type ImageSearchKind } from '../lib/watch/chat-images';
import { forgetGuestReturn, guestReturnDraft, keepGuestReturn } from '../lib/watch/guest-return';
import { createEmbed, isEmbedKind } from '../lib/watch/embeds';
import { liveJump, twitchOf } from '../lib/watch/links';
import { loadLiveNow } from '../lib/web/everywhere-client';
import { TwitchSignInNote } from './TwitchSignInNote';
import { hasQualityControl, hasSubtitleControl, type EmbedPlayable, type Playable, type QualityControl } from '../lib/watch/playable';
import type { EmbedRefusal } from '../lib/watch/embed-player';
import { JellyfinPlayable, isJellyfinHello } from '../lib/watch/jellyfin-player';
import { lookClass, lookForRoom } from '../lib/cytube/looks';
import { setOpenRoomLook } from '../lib/cytube/room-look';
import { saveLookChoice, useLookChoice } from '../lib/cytube/use-looks';
import { afterFile, blankPrefill, blankStart, screenIsBlank, type BlankKey } from '../lib/watch/blank-screen';
import { getWatchRepository, repositoryFor, type OwnDeviceLine } from '../lib/watch/repository';
import { OWN_ASK_AFTER_MS, OWN_VOLUME_SAY_MS } from '../lib/watch/own-devices';
import { playbackRole, takesSoundFrom, type DeviceMode } from '../lib/watch/own-device-modes';
import { useOwnDevices, type OwnPlaces } from '../lib/watch/use-own-devices';
import { OWN_PLACE_ASK_MS, OWN_PLACE_KEEPS_MS } from '../lib/watch/own-devices';
import { YouTubePlayable } from '../lib/watch/youtube-player';
import { offerRoomDevices } from '../lib/watch/room-devices-key';
import RoomDevicesWindow from './RoomDevicesWindow';
import { ownRoomState, subscribeToOwnRoom, takeComeBack } from '../lib/watch/own-room-client';
import type { AudioTrack } from '../lib/audio/tracks';
import { frontPosition } from '../lib/watch/music-rooms';
import { isSongLink, songLink, trackForSong } from '../lib/watch/songs';
import { comeHome, forgetCarried, isCarriedSong, wasCarried } from '../lib/watch/go-live-carry';
import { isPictureLink, pictureHost } from '../lib/watch/pictures';
import { chatPicture } from '../lib/watch/chat-picture';
import { noteAddedHere } from '../lib/watch/outside-pictures';
import QueuedPicture from './QueuedPicture';
import { useWebTrack, webTrackNow } from '../lib/web/web-track-lookup';

import {
  NO_FRAME_FULLSCREEN,
  ROOM_BAR,
  ROOM_BAR_ASLEEP,
  ROOM_BAR_OVER,
  ROOM_BAR_PLACE,
  ROOM_PICTURE_KEYS,
  ROOM_COG,
  ROOM_COLUMNS,
  ROOM_FULL_MARK,
  ROOM_LEAVE_FULL_MARK,
  ROOM_PICTURE_BOX,
  ROOM_PICTURE_FIT,
  ROOM_PIP_MARK,
  ROOM_ROOT,
  ROOM_SCREEN,
  ROOM_SIDE_BODY,
  ROOM_STAGE,
  roomSide,
} from '../lib/watch/room-frame';
import { useRoomSideWidth } from '../lib/watch/room-side-width';
import { useFullscreenBar, useIdleBar } from '../lib/watch/use-fullscreen-bar';
import { useKeysInPicture } from '../lib/watch/keys-in-picture';
import RoomSideGrip from './RoomSideGrip';
import { stillBars, watchVideoBars, type FrameBars } from '../lib/watch/bar-watch';
import { hasTrim, NO_TRIM, trimmedShape, type Trim } from '../lib/watch/video-bars';
import { pictureStyle, shapeFrom, stageStyle, videoShape, WIDE } from '../lib/watch/video-shape';
import { stageBkgOn, stageBkgOnServer, subscribeToStageBkg } from '../lib/ui/stage-bkg';
import { fullscreenBox } from '../lib/ui/whole-site-fullscreen';
import { siteFullscreenWorks, withoutFullscreen } from '../lib/ui/floating-player';
import { StageBackdrop } from './backdrops/Backdrops';
import StageKey from './StageKey';
import { noteRoomStart, roomStartFor } from '../lib/watch/room-start';
import { streamBarState, subscribeToStreamBar } from '../lib/watch/stream-bar';
import { expandWatch, subscribeToWatchWindow, watchWindowState } from '../lib/watch/watch-window';
import {
  MESSAGE_MAX_LENGTH,
  TAKE_OVER_RETRY_MS,
  WATCH_HEARTBEAT_MS,
  accountsPresent,
  currentEntry,
  followerJump,
  NEAR_SEEK_EVERY_MS,
  formatMediaTime,
  jumpLanded,
  handoverTo,
  hasCrown,
  hostMayPublish,
  hostPosition,
  mayEditRoom,
  refusedByBrowser,
  nextQueuePosition,
  nextPlayIndex,
  roomAnnounced,
  roomIsLive,
  serverElapsed,
  serverRestarted,
  shouldTakeOver,
  type FollowerJump,
  type ServerMark,
  upcoming,
  viewerStep,
  withSeries,
  isGuestLabel,
} from '../lib/watch/rules';
import type { WatchLink, WatchMember, WatchMessage, WatchQueueEntry, WatchRoomRead } from '../lib/watch/types';
import { previousPlay, registerRoomReplay } from '../lib/watch/room-transport';
import { steadyInterval } from '../lib/watch/steady-timer';
import { askForSound, everPressed, noticePress, soundAllowed, soundJustCame, soundRefused, soundWaiting, subscribeSoundGate } from '../lib/watch/sound-gate';
import { UP_NEXT_EVERY_MS, notInStepId, notInStepNote, upNextRepeats, type RoomNote } from '../lib/watch/room-notes';
import { attachStream, playsDirectly, type StreamHandle } from '../lib/watch/stream-player';
import { applyLocalChange } from '../lib/watch/use-watch-room';
import { SEEK_SECONDS, isOwnPlayback, leadFromChange, playbackChanged } from '../lib/watch/device-lead';
import { HiddenNote, HideControl, ReportKey } from './ModerationKeys';
import { useModeration } from './ModerationProvider';
import { officialEmbedUrl, WEB_EMBED_SANDBOX } from '../lib/web/official-embed';
import { useArchiveRoomFile } from '../lib/watch/archive-room-file';
import { setRoomPicture } from '../lib/watch/room-fit';
import { mediaServerForUrl, playerSandbox } from '../lib/web/media-servers';
import { subscribeFindInRoom, takeFindInRoom } from '../lib/watch/find-in-room';
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
import PlayerTv from './PlayerTv';
import ProfileName from './ProfileName';
import { QualityKey, SpeakerKey, SubsKey } from './StreamBarKeys';
import StreamCrawl from './StreamCrawl';
import RoomFloatChrome, { useRoomFloatDrag } from './RoomFloatChrome';
import RoomSettingsWindow from './RoomSettingsWindow';
import MainRoomKeys, { MainRoomEndSection, MainRoomLiveSection, VisitorRoomSettings } from './MainRoomKeys';
import { registerMainRoomPlay, subscribeToGoLiveAsk, takeGoLiveAsk, type MainRoomSource } from '../lib/watch/main-room-play';
import StreamQueueWindow from './StreamQueueWindow';
import CanvasToggle from './CanvasToggle';
import SeenTogether from './seeing/SeenTogether';
import RoomCornerKeys from './RoomCornerKeys';
import RoomVisualiser from './RoomVisualiser';
import VisualiserToggle from './VisualiserToggle';
import { useVisualiserOn } from '../lib/watch/visualiser';
import { analysableSrc } from '../lib/watch/audio-tap';
import { shareRoomScreen } from '../lib/audio/room-screen-sound';
import dynamic from 'next/dynamic';

/** Loaded on its own, in the browser only: the room's code keeps clear of the floating player's (a9b6af9). */
const SoundGraph = dynamic(() => import('./SoundGraph'), { ssr: false });
import RoomCanvas, { CanvasSaveAsk } from './RoomCanvas';
/** The owner's PC screen (SPEC-screens.md): loaded only when its key is pressed, so nobody else's room carries its code. */
const RoomScreen = dynamic(() => import('./RoomScreen'), { ssr: false });
import ScreenToggle from './ScreenToggle';
import { canvasDraggable, useCanvasOpen } from '../lib/watch/canvas-drag';
import { useScreenView } from '../lib/watch/canvas-view';
import { useChatLineDrag } from '../lib/watch/use-chat-line-drag';
import { askToSaveCanvas, closeRoomCanvas, type CanvasContext } from '../lib/watch/use-room-canvas';
import SongCoverCard from './SongCoverCard';
import SpeechAudioKey from './SpeechAudioKey';
import { noteHistory } from '../lib/recommender/history';
import { useCompanionScene } from '../lib/companion/use-companion-scene';
import { explain, NOTE } from '../lib/ui/explain';

/** One per tab: two tabs of one account are two members of a room. */
function newTabKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tab-${Math.random().toString(36).slice(2)}`;
}

/**
 * The one key a viewer needs when their browser won't start the sound by itself: the main key's look, at least the 44px tap size
 * at every width and in the heading size, so it can't be missed (Luke's eyesight, 2026-11-08).
 */
const JOIN_KEY = PLATE_MAIN.replace('px-3 py-1 text-key', 'min-h-tap px-6 py-2 text-heading');
/** How often a follower checks itself against the host. */
const FOLLOW_TICK_MS = 500;
/** A follower out of step this long says LINING UP over its player (a moment's wobble does not). */
const LINING_UP_AFTER_MS = 400;
/** Further off than this is not in step yet. */
const LINING_UP_GAP_SECONDS = 0.5;
/**
 * A following device of the host's account waits this long at the end of a file for the device that leads to move the room on;
 * then it moves on itself (the leading device was shut mid-file: device-lead.ts).
 */
const LEAD_GONE_AT_END_MS = 4000;
/** A press that took the lead holds the follower's clock off this long, while this device turns into the one that leads. */
const PRESS_HOLD_MS = 1500;
/** A player event this soon after the follower's own order of the same kind is that order landing, not a press. */
const ORDER_LANDS_MS = 2500;
/** How long `<NAME> IS HOSTING NOW` stays up. */
const HANDOVER_NOTICE_MS = 15000;
/** How long the bar says why a device DEVICES keeps from moving the room didn't put a song on. */
const DEVICES_NOTICE_MS = 6000;
/** How long a host's player waits on a link that will not play before the room moves on. */
const DEAD_LINK_SKIP_MS = 5000;
/** How many of the room's own chat lines it keeps (how often UP NEXT comes: lib/watch/room-notes.ts). */
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
  /**
   * The room's window is folded by `[ PIP ]`, so its picture floats (SPEC-floating-player.md). Folded by `[ _ ]` it does
   * not: the window plays on out of sight (Luke, 2026-11-16). Either way the key above the player is the way back.
   */
  pictureFloats: boolean;
  /**
   * Folded by `[ _ ]`: the room's picture is out of sight, so FULL on the music bar opens the room before it fills the screen (it
   * used to fullscreen the hidden picture, and the browser showed the site instead; Luke, 2026-11-27). Floating by `[ PIP ]` it is
   * in sight and FULL works as it is.
   */
  pictureHidden?: boolean;
  /** `[ PIP ]`: folds the room with its picture floating. */
  onFloatPicture: () => void;
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
export default function WatchRoom({ read, closing, onStay, onLeft, pictureFloats, pictureHidden = false, onFloatPicture }: WatchRoomProps) {
  const { user } = useAuth();
  const catalogue = useCatalogue();
  const player = useMusicPlayer();
  const { room } = read;
  const roomId = room.id;
  // The store that holds this room: this browser's for a signed-out visitor's own room, the site's for every other.
  const repository = repositoryFor(roomId);
  /**
   * Who runs this room from here: the account, or, in a signed-out visitor's own room (list 3: "the same room as a signed-in
   * reader as far as a visitor can have one"), the visitor by their browser's id. It lives in this browser only, so nothing
   * of theirs leaves it: no link, no chat, no board, and GO LIVE asks them to log in.
   */
  const own = useSyncExternalStore(subscribeToOwnRoom, ownRoomState, ownRoomState);
  const visitorRoom = user === null && own.visitor && own.roomId === roomId && own.hostId !== null;
  const me = user !== null ? { id: user.id, displayName: user.displayName } : visitorRoom && own.hostId !== null ? { id: own.hostId, displayName: 'YOU' } : null;

  const now = useNow(5000);

  const live = roomIsLive(room, now);
  /**
   * The account hosts this room: its keys, its settings, handing it on. On several devices of one account only one of them
   * leads the playback (`amHost`, further down, once who is here is known; Luke 2026-11-27, device-lead.ts).
   */
  const accountHosts = me !== null && room.hostId === me.id;
  /** Somebody's music room (SPEC-music-queues.md): its owner always hosts, it is switched off rather than ended, and it is not on the board. */
  const music = room.origin === 'music';
  /**
   * Announced (SPEC-rooms-perpetual.md): a stream room, or a main room after GO LIVE. Only then does the host keep the
   * 3-second beat (a private main room writes on play, pause and seek only), can the room be taken over, and does it
   * light the lists and lamps.
   */
  const announced = roomAnnounced(room);
  const itemsById = useMemo(() => new Map(catalogue.items.map((item) => [item.id, item])), [catalogue.items]);
  const entry = currentEntry(read);
  /** Nothing on: the black screen with its three keys (SPEC-cytube.md). */
  const blank = screenIsBlank(room, read.queue);
  const item = entry?.mediaItemId ? itemsById.get(entry.mediaItemId) : undefined;
  // An Internet Archive video plays as its own file in the room's player, not in the Archive's (list 4, `archive-room-file.ts`).
  const archiveRead = useArchiveRoomFile(entry?.link ?? null);
  const link = archiveRead.link;
  /**
   * A song row (SPEC-music-queues.md): the music bar plays it, from its own address, and the room's sync
   * reads and steers the bar's one audio element as it does the stage's `<video>`.
   */
  const song = isSongLink(link) ? link : null;
  /**
   * A picture row (SPEC-rooms-queues.md, section 6): it holds the stage until NEXT. There is no player and no clock:
   * the host's beat keeps the room on it, and the host or a crown takes it off.
   */
  const pictureOn = isPictureLink(link);
  // FOR YOU's private history (SPEC-recommender.md): a room this person is in, by its name and topic. Signed in only.
  const roomName = room.name ?? '';
  const roomTopic = room.topic ?? '';
  const roomHost = room.originalHostLabel;
  // Open rooms only: a private room's name is never written down (code review, 2026-11-13).
  const roomOpen = room.privacy === 'open';
  useEffect(() => {
    if (user === null || !roomOpen) return;
    noteHistory({ kind: 'room', ref: roomId, title: roomName || `${roomHost.toUpperCase()}'S ROOM`, maker: roomHost, words: roomTopic ? [roomTopic] : [], action: 'opened' });
  }, [user, roomOpen, roomId, roomName, roomTopic, roomHost]);
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
  // The music bar's sound graph hears what the stage plays (list 4: ../lib/audio/room-screen-sound.ts).
  useEffect(() => {
    // A site's own embed with no player to ask (PeerTube, a friend's server) counts as playing while it is on.
    if (song !== null || (videoElement === null && link?.kind !== 'embed')) return;
    return shareRoomScreen(videoElement, link);
  }, [videoElement, song, link]);
  const [clock, setClock] = useState({ seconds: 0, duration: Number.NaN, paused: true });
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [needsPress, setNeedsPress] = useState(false);
  /** The browser holds this page's sound until a press (sound-gate.ts): the room plays muted and in step meanwhile. */
  const soundHeld = useSyncExternalStore(subscribeSoundGate, soundWaiting, () => false);
  useEffect(() => askForSound(), []);
  /** The player a muted start is being tried on, and the player that was refused even muted (asked again only after a press). */
  const mutedTry = useRef<Playable | null>(null);
  const refusedOn = useRef<Playable | null>(null);
  /**
   * A play() the browser turned down. On a page nobody has pressed yet it is tried again muted, so this device is in step at once
   * (Luke, 2026-11-28: sound first, muted only where the browser refuses); only if that is refused too, or on a pressed page, the
   * large JOIN PLAYBACK key. Not for a start that was only cut short (a pause or a new file arriving first, an AbortError): that
   * player is not refused, and the key over a host who is paused would play this one alone.
   */
  const refusedPlay = useCallback((error: unknown) => {
    if (!refusedByBrowser(error)) return;
    const video = videoRef.current;
    if (video !== null && !everPressed()) {
      // The muted start of this player is already under way.
      if (mutedTry.current === video) return;
      const name = error instanceof Error ? error.name : '';
      // An outside player that never started says so late and in its own words: that counts unless sound is known to be allowed.
      const forSound = name === 'NotAllowedError' || (name !== 'NotSupportedError' && !(video instanceof HTMLMediaElement) && !soundAllowed());
      if (!video.muted && forSound) {
        mutedTry.current = video;
        soundRefused();
        video.muted = true;
        void video.play().then(
          () => {
            mutedTry.current = null;
            setNeedsPress(false);
          },
          () => {
            mutedTry.current = null;
            refusedOn.current = video;
            setNeedsPress(true);
          },
        );
        return;
      }
      refusedOn.current = video;
    }
    setNeedsPress(true);
  }, []);
  const blockedByPlayer = useCallback(() => refusedPlay(new DOMException('Blocked.', 'NotAllowedError')), [refusedPlay]);
  const [notice, setNotice] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  /* --- who is here ----------------------------------------------------------------------------- */

  const [myKey] = useState(newTabKey);
  const roomGuest = useRoomGuest();
  const guestLabel = roomGuest?.label ?? '';
  const presenceGuestId = user === null ? (roomGuest?.id ?? null) : null;
  /** The window that asks who this is, from pressing the canvas (SPEC-guests.md). */
  const [naming, setNaming] = useState(false);
  const [members, setMembers] = useState<WatchMember[]>([]);
  /**
   * The room's presence really answered (not only the wait running out): only then does a page that came back with your room know
   * no other device of yours is playing it (device-lead.ts).
   */
  const presenceAnswered = useRef(false);
  /** How long a room waits for presence before it counts as heard: longer for the host's own account (its devices, device-lead.ts). */
  const heardWait = useEffectEvent(() => (accountHosts ? 10000 : 3000));
  /** False until the room's presence has answered once: before that, "the host is missing" means nothing. */
  const [membersHeard, setMembersHeard] = useState(false);

  /**
   * Your private main room, with nobody else ever let in by its link: no presence channel at all (SPEC-rooms-perpetual.md,
   * section 4). Once a member row of somebody else appears (they used the link), or the room goes live, it opens.
   */
  const [othersMayBeIn, setOthersMayBeIn] = useState(false);
  const aloneByRule = music && accountHosts && !room.isPublic;
  // Watched for the whole time you host your main room, live or not: a live room with people in it that goes private
  // keeps its presence (they stay in it).
  const watchMembers = music && accountHosts;
  const meId = me?.id ?? null;
  const meName = me?.displayName ?? '';
  useEffect(() => {
    if (!watchMembers || meId === null) return;
    const me = meId;
    let alive = true;
    void repository
      .listRoomMembers(roomId)
      .then((rows) => {
        if (alive && rows.some((row) => row.userId !== me && row.removedAt === null)) setOthersMayBeIn(true);
      })
      .catch(() => undefined);
    const off = repository.subscribeRoomMembers(roomId, (row) => {
      if (row.userId !== me && row.removedAt === null) setOthersMayBeIn(true);
    });
    return () => {
      alive = false;
      off();
    };
  }, [repository, roomId, watchMembers, meId]);
  // Signed in, your main room hears who is in it even when it is only you: your other devices are you too, and they need to
  // know of each other to keep in step (Luke, 2026-11-27: "streams being synced on multiple devices"; device-lead.ts).
  const presenceOn = !aloneByRule || othersMayBeIn || user !== null;

  useEffect(() => {
    if (room.endedAt !== null) return;
    if (!presenceOn) {
      // Just you: said here, nothing sent anywhere. Handed over once this effect is done, as the song's player is below.
      let current = true;
      const alone: WatchMember = { key: myKey, userId: meId, guestId: null, name: meName, joinedAt: Date.now() };
      presenceAnswered.current = true;
      void Promise.resolve().then(() => {
        if (!current) return;
        setMembers([alone]);
        setMembersHeard(true);
      });
      return () => {
        current = false;
      };
    }
    // The store says this tab at once, before the room has answered; every word after that is the room's own answer.
    let joining = true;
    const membership = repository.joinRoom(
      roomId,
      // A guest is here by name only: no id on the wire, so nobody can crown them or hand them the room.
      { key: myKey, userId: user?.id ?? null, guestId: presenceGuestId, name: user?.displayName ?? guestLabel },
      (next) => {
        setMembers(next);
        if (!joining || next.length > 1 || next.some((member) => member.key !== myKey)) {
          presenceAnswered.current = true;
          setMembersHeard(true);
        }
      },
    );
    joining = false;
    // A room alone hears only itself; after a moment that is an answer too.
    // Longer for the host's own account: a device that hears itself alone too early would take the lead from the one in use.
    const heard = window.setTimeout(() => setMembersHeard(true), heardWait());

    return () => {
      window.clearTimeout(heard);
      membership.leave();
    };
  }, [repository, roomId, room.endedAt, user?.id, user?.displayName, presenceGuestId, guestLabel, myKey, presenceOn, meId, meName]);

  const accounts = accountsPresent(members);

  /* --- which of your devices leads (Luke, 2026-11-27, 1A: "last one touched"; device-lead.ts) ------------------------- */

  /** Another device (or tab) of this account is in the room now. */
  const otherDeviceHere = me !== null && members.some((member) => member.userId === me.id && member.key !== myKey);
  /**
   * Whether this device leads your room's playback: `lead` after it pressed (its write is the room's last) or while it was
   * here alone when another came in; `follow` after another of your devices pressed; `unset` until either, when it leads
   * only while it is the one device here.
   */
  const [lead, setLead] = useState<'unset' | 'lead' | 'follow'>('unset');
  /** When a press here took the lead: the hosting below tells the room what this player shows, not the other way round. */
  const pressedLead = useRef(0);
  const [leadSeen, setLeadSeen] = useState({ room, otherDeviceHere, heard: membersHeard });
  if (leadSeen.room !== room || leadSeen.otherDeviceHere !== otherDeviceHere || leadSeen.heard !== membersHeard) {
    setLeadSeen({ room, otherDeviceHere, heard: membersHeard });
    let next = lead;
    if (!accountHosts) next = 'unset';
    else {
      // The other device went: this one is alone again, and leads.
      if (!otherDeviceHere && leadSeen.otherDeviceHere) next = 'unset';
      if (leadSeen.room !== room && playbackChanged(leadSeen.room, room)) {
        const before = read.queue.find((row) => row.id === leadSeen.room.currentEntryId);
        const said = leadFromChange({ own: isOwnPlayback(room), pictureTakenOff: room.currentEntryId === null && before?.link?.kind === 'picture' });
        if (said !== null) next = said;
      }
    }
    if (next !== lead) setLead(next);
  }
  // Another device of yours is playing your room: this page coming back is not a reload to pause for.
  useEffect(() => {
    if (membersHeard && otherDeviceHere) takeComeBack(roomId);
  }, [membersHeard, otherDeviceHere, roomId]);
  /**
   * Of your devices here, this one has been in the room longest (then by key, so two of them never both think so). Until one of them
   * presses, that one leads: a page that has just opened follows the device already playing.
   */
  const eldestDevice = me !== null && members.filter((member) => member.userId === me.id).sort((a, b) => a.joinedAt - b.joinedAt || a.key.localeCompare(b.key))[0]?.key === myKey;
  const accountId = user?.id ?? null;
  /** Your other devices' keys in this room, in the order they came in. */
  const otherDeviceKeys = useMemo(
    () => (me === null ? [] : members.filter((member) => member.userId === me.id && member.key !== myKey).sort((a, b) => a.joinedAt - b.joinedAt).map((member) => member.key)),
    [members, me, myKey],
  );
  /** [ DEVICES ] (Luke, 2026-11-27; own-device-modes.ts): how each of your other devices here goes with this one. */
  /** Where this device's player is, for your other devices, and where the one keeping the room last said it was. */
  const ownPlaces = useRef<OwnPlaces | null>(null);
  const leaderPlace = useRef<{ entryId: string; seconds: number; at: number } | null>(null);
  const [liningUp, setLiningUp] = useState(false);
  const ownDevices = useOwnDevices(repository, accountId, roomId, myKey, otherDeviceKeys, accountId !== null && otherDeviceHere, ownPlaces);
  /**
   * In your own room, what DEVICES leaves this device: following one of yours it was set to follow (it never takes the room),
   * ON ITS OWN beside the one that keeps the room (APART), leading one set to follow it, or free (today's rule).
   */
  const deviceRole = accountHosts && ownDevices.deviceId !== null ? playbackRole(ownDevices.book, ownDevices.deviceId, ownDevices.here.map((device) => device.deviceId)) : { role: 'free' as const, by: null };
  const keptFollowing = deviceRole.role === 'follow';
  const onItsOwn = deviceRole.role === 'own';
  /** The device DEVICES ties this one to, by name. */
  const roleBy = deviceRole.by === null ? null : (ownDevices.here.find((device) => device.deviceId === deviceRole.by)?.name ?? 'YOUR OTHER DEVICE');
  /** What the room's keys say in place of the ones that would move the room, on a device DEVICES keeps from it. */
  const devicesHoldNotice = () => (keptFollowing ? `FOLLOWING ${roleBy ?? ''} · CHANGE IT IN [ DEVICES ]` : `ON ITS OWN BESIDE ${roleBy ?? ''} · CHANGE IT IN [ DEVICES ]`);
  /** A press that would move the room, on a device DEVICES keeps from it (the music bar's NEXT, back, a song played in): the bar says why for a few seconds, and true. */
  const heldBackByDevices = (): boolean => {
    if (!accountHosts || !(keptFollowing || onItsOwn)) return false;
    setNotice(devicesHoldNotice());
    window.setTimeout(() => setNotice(null), DEVICES_NOTICE_MS);
    return true;
  };
  /** This device plays the room's clock and writes it: the host's account, on the one of its devices that leads. */
  const amHost =
    accountHosts &&
    !keptFollowing &&
    !onItsOwn &&
    (deviceRole.role === 'lead' || lead === 'lead' || (lead === 'unset' && membersHeard && (!otherDeviceHere || eldestDevice)));
  /**
   * A press on one of the host's keys (or the player's own) on a device that was following: it leads from now on. False when
   * this device may not move the room (not your room, or DEVICES has it following or on its own): the press goes no further.
   */
  function takeLead(byPress = true): boolean {
    if (!accountHosts || keptFollowing || onItsOwn) return false;
    if (amHost) return true;
    if (byPress) pressedLead.current = Date.now();
    setLead('lead');
    return true;
  }

  /* --- your devices' speaker key (Luke, 2026-11-27: "when two of the same account are watching media in a room, make sure the
     pause play and volume controls are all synced") -------------------------------------------------------------------------- */

  /** The account's own line while another of its devices is in this room (any room, hosted or not); nobody else's volume moves. */
  const ownLine = useRef<OwnDeviceLine | null>(null);
  /** The speaker key was turned on this device: the next settled volume is said to the others (one heard is never said back). */
  const turnedHere = useRef(false);
  const sayTimer = useRef<number | null>(null);
  const saidAt = useRef(0);
  /** This device came into the room after another of yours and has its sound now: from their answer, or from a turn of its own key. */
  const soundSettled = useRef(false);
  /** When this device came into the room, by the room's own list. */
  const cameInAt = useEffectEvent(() => members.find((member) => member.key === myKey)?.joinedAt ?? Number.POSITIVE_INFINITY);
  /** Luke's answer, "Take current volume on join": a device of yours that came in later asks; one that was here first answers. */
  const cameInLater = useEffectEvent(() => !eldestDevice);
  /** This device's id on the line, so your others take its sound only by the way DEVICES has them go with it. */
  const soundFrom = useEffectEvent(() => (ownDevices.deviceId === null ? {} : { from: ownDevices.deviceId }));
  /** The sound said by one of your devices is taken only from one this device follows, or from any while nothing is chosen. */
  const takesSound = useEffectEvent((from: string | undefined) => takesSoundFrom(ownDevices.book, from ?? null));
  const answerAsk = useEffectEvent((since: number) => {
    if (cameInAt() < since) ownLine.current?.send({ kind: 'volume', roomId, volume, muted, ...soundFrom() });
  });
  useEffect(() => {
    if (accountId === null || !otherDeviceHere) return;
    const line = repository.joinOwnDevices(accountId, (message) => {
      if (message.roomId !== roomId) return;
      if (message.kind === 'ask-room') answerAsk(message.since);
      if (message.kind !== 'volume' || !takesSound(message.from)) return;
      soundSettled.current = true;
      setVolume(message.volume);
      setMuted(message.muted);
    });
    ownLine.current = line;
    soundSettled.current = !cameInLater();
    const since = cameInAt();
    const asks = OWN_ASK_AFTER_MS.map((after) =>
      window.setTimeout(() => {
        if (!soundSettled.current) line.send({ kind: 'ask-room', roomId, since });
      }, after),
    );
    return () => {
      for (const ask of asks) window.clearTimeout(ask);
      if (sayTimer.current !== null) window.clearTimeout(sayTimer.current);
      sayTimer.current = null;
      ownLine.current = null;
      line.leave();
    };
  }, [repository, accountId, otherDeviceHere, roomId]);
  // Said once the key settles, both values together (the volume line also unmutes), and at most every OWN_VOLUME_SAY_MS while it is dragged.
  useEffect(() => {
    if (!turnedHere.current) return;
    turnedHere.current = false;
    if (ownLine.current === null) return;
    if (sayTimer.current !== null) window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(
      () => {
        sayTimer.current = null;
        saidAt.current = Date.now();
        ownLine.current?.send({ kind: 'volume', roomId, volume, muted, ...soundFrom() });
      },
      Math.max(0, OWN_VOLUME_SAY_MS - (Date.now() - saidAt.current)),
    );
  }, [volume, muted, roomId]);
  /**
   * Muted from DEVICES (on another device of yours, or this one's window): silent whatever the shared mute or volume says, and the
   * level still follows, so the sound comes back where your others have it. Lifted by MUTE again there, or this speaker key here.
   * Kept until then, but in force only while another device of yours is in the room, where DEVICES shows it: alone, nothing on
   * screen would say why this device was silent.
   */
  const heldMuted = otherDeviceHere ? ownDevices.book.heldMuted : null;
  // Also silent while the browser holds this page's sound: the speaker key says what is heard, and nothing unmutes early
  // (a browser pauses a video a script unmutes on an unpressed page).
  const silent = muted || heldMuted !== null || soundHeld;
  const { unholdSelf } = ownDevices;
  const turnVolume = useCallback((next: number) => {
    turnedHere.current = true;
    soundSettled.current = true;
    setVolume(next);
  }, []);
  const turnMuted = useCallback(
    (wanted: boolean) => {
      let next = wanted;
      // The press that has just brought this page its sound is only that: it turns nothing on your other devices, unless they
      // really are muted (then it asks to hear, like any press of the speaker key).
      if (soundJustCame()) {
        if (!muted && heldMuted === null) return;
        next = false;
      }
      // Sound asked for at this device lifts a mute from DEVICES: whoever presses it is standing here and wants to hear.
      if (!next && heldMuted !== null) {
        unholdSelf();
        if (!muted) return;
      }
      turnedHere.current = true;
      soundSettled.current = true;
      setMuted(next);
    },
    [heldMuted, muted, unholdSelf],
  );
  // The music bar is this device's sound too while a song plays here: silent with it.
  const { setSilenced } = player;
  useEffect(() => {
    setSilenced(heldMuted !== null);
    return () => setSilenced(false);
  }, [heldMuted, setSilenced]);

  /* --- the music stops (decision 7) ------------------------------------------------------------ */

  const steer = player.steer;
  const playing = player.playing;
  const stoppedMusic = useRef(false);
  /** The bar is already on the song this room has on. */
  const carriedIn = songTrack !== null && player.track?.src === songTrack.src;
  useEffect(() => {
    if (stoppedMusic.current) return;
    stoppedMusic.current = true;
    stopFollowing('');
    // Not the song GO LIVE carried in (go-live.ts): the room has that very song on, and it plays on with no gap.
    if (playing && !carriedIn) steer(false);
  }, [playing, steer, carriedIn]);

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
    // Moving on, the stage still holds the play that is ending until the room names the next one: its last events (a skip seeks
    // and pauses it) would write the next play's name with the old player's place, and if that write landed after the start's own
    // (0, playing) everybody's new video jumped there (seen live, 2026-11-08: the next file named at 24.1s). The start says it.
    if (!hostMayPublish(hostEntry.current, room.currentEntryId)) return;
    // Refused a start here (the browser would not even play it muted): that is not a pause, and the room plays on.
    if (needsPress && video.paused) return;

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
    if (!takeLead()) return;
    // The room's loop (ROOMSYNC, "the loop button to loop it"): at its end, what is on starts again. A skip still skips.
    if (!skip && player.roomLoop && entry !== undefined && !pictureOn) {
      fromTheTop();
      return;
    }
    const after = afterFile(read.queue);
    const video = videoRef.current;

    // The queue ran out: back to the black screen with its three keys (SPEC-cytube.md), not a loop of the last file.
    if (after.kind === 'black') {
      // A skip with nothing behind does nothing, except off a picture: NEXT is the only way a picture ever leaves.
      if (skip && !pictureOn) return;
      hostEntry.current = null;
      goingBlack.current = true;
      video?.pause();
      void repository
        .writePlayback(roomId, { currentEntryId: null, positionSeconds: 0, isPlaying: false })
        .then(() => applyLocalChange(roomId, { kind: 'refresh' }))
        .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT BE UPDATED.'));
      return;
    }
    startRow(after.entry);
  }

  /** The host starts a row: the next one, or (ROOMSYNC) one that played before, which keeps its place in the list. */
  function startRow(next: WatchQueueEntry) {
    if (!takeLead()) return;
    const video = videoRef.current;
    goingBlack.current = false;

    // From the top, at once: the next play may be the same file (nothing for the element to reload),
    // and a different file is loaded by its new `src` and started by `autoPlay`. The music bar's element
    // still holds the song that ended: the next row puts its own file on (`cue`, below).
    hostEntry.current = next.id;
    // Not when a picture is next: nothing plays behind a picture, so the file that just ended is not started again.
    if (video !== null && song === null && next.link?.kind !== 'picture') {
      video.currentTime = 0;
      void video.play().catch(refusedPlay);
    }

    void repository
      .startEntry(roomId, next.id, nextPlayIndex(read.queue))
      .then(() => applyLocalChange(roomId, { kind: 'refresh' }))
      .catch((failure: unknown) => {
        // Whatever the room names now (the start may have landed with its answer lost), the host's beat speaks for it again:
        // with no play of its own ahead of the room, the host writes the room's (`hostMayPublish`).
        hostEntry.current = null;
        setFault(failure instanceof Error ? failure.message : 'THE NEXT FILE COULD NOT START.');
      });
  }
  const fileEnded = useEffectEvent(() => moveOn(false));

  /** What is on starts again from the top, for everybody: the room's loop, or the back arrow with nothing before it. */
  function fromTheTop() {
    if (!takeLead()) return;
    const playing = songOn ? audioElement() : videoRef.current;
    if (playing !== null) {
      playing.currentTime = 0;
      void playing.play().catch(refusedPlay);
    }
    void repository
      .writePlayback(roomId, { currentEntryId: room.currentEntryId, positionSeconds: 0, isPlaying: true })
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT BE UPDATED.'));
  }

  /** The host's back arrow (ROOMSYNC): what played before what is on now, or what is on from the top. */
  function goBack() {
    const before = previousPlay(read);
    if (before === null) {
      if (entry !== undefined && !pictureOn) fromTheTop();
      return;
    }
    startRow(before);
  }
  const backFromBar = useEffectEvent(() => {
    if (!heldBackByDevices()) goBack();
  });

  // A press on a row that played, in the queue window (ROOMSYNC: "click on a previous thing in the queue to play it again").
  const replayRow = useEffectEvent((entryId: string) => {
    const row = read.queue.find((candidate) => candidate.id === entryId);
    if (row === undefined || row.playedAt === null || row.id === room.currentEntryId) return;
    startRow(row);
  });
  const hostKeysOn = accountHosts && live;
  useEffect(() => {
    if (!hostKeysOn) return;
    return registerRoomReplay(roomId, (entryId) => replayRow(entryId));
  }, [hostKeysOn, roomId]);

  /**
   * Going from your own room into somebody else's (ROOMSYNC, Luke 2026-11-16: "make sure the room you had before is waiting
   * for you"): your room holds where you were, paused, so it is there as you left it when you come back (`leaveRoom` brings
   * you back to it). Not a live room with other people in it: they watch on, and it is handed on as when you leave it.
   * Heard as the window is told to change, while this room and its player are still on the page.
   */
  const holdForReturn = useEffectEvent(() => {
    if (!music || !amHost || room.endedAt !== null) return;
    if (room.isPublic && accounts.some((member) => member.userId !== me?.id)) return;
    const playingNow = songOn ? audioElement() : videoRef.current;
    const at = playingNow !== null && Number.isFinite(playingNow.currentTime) ? playingNow.currentTime : hostPosition(room, Date.now());
    if (songOn && player.playing) player.toggle();
    else playingNow?.pause();
    void repository.writePlayback(roomId, { currentEntryId: room.currentEntryId, positionSeconds: at, isPlaying: false }).catch(() => undefined);
  });
  useEffect(
    () =>
      subscribeToWatchWindow(() => {
        const shown = watchWindowState();
        if (shown.open && shown.focus?.kind === 'room' && shown.focus.roomId !== roomId) holdForReturn();
      }),
    [roomId],
  );

  /**
   * PLAY on a video in MEDIA or FILES while your main room's window is drawn (SPEC-rooms-perpetual.md): it is filed in the
   * queue and started from the top, as moving on is, so this player and the room agree on what is on.
   */
  const playHere = useEffectEvent((source: MainRoomSource, startAt: number | null) => {
    if (me === null || !takeLead()) return;
    const queue = read.queue;
    const added = source.link !== undefined
      ? repository.addToQueue({ roomId, addedBy: me.id, position: nextQueuePosition(queue), inQueue: true, link: source.link })
      : repository.addToQueue({ roomId, addedBy: me.id, position: nextQueuePosition(queue), inQueue: true, mediaItemId: source.mediaItemId });
    void added
      .then((entry) => {
        // From where the viewer had got to, when the caller knew (`[ WATCH IN ROOM ]`).
        noteRoomStart(entry.id, startAt);
        hostEntry.current = entry.id;
        goingBlack.current = false;
        return repository.startEntry(roomId, entry.id, nextPlayIndex(queue));
      })
      .then(() => applyLocalChange(roomId, { kind: 'refresh' }))
      .catch((failure: unknown) => {
        hostEntry.current = null;
        setFault(failure instanceof Error ? failure.message : 'THAT COULD NOT BE PUT ON.');
      });
  });
  useEffect(() => {
    if (!music || !accountHosts) return;
    return registerMainRoomPlay(roomId, (source, startAt) => playHere(source, startAt));
  }, [music, accountHosts, roomId]);
  /** Whether the room says the host is playing, read by the effects without depending on every write. */
  const roomPlaying = useEffectEvent(() => room.isPlaying);
  useCompanionScene('watch', room.isPlaying);
  const roomNow = useEffectEvent(() => room);

  const currentId = useEffectEvent(() => room.currentEntryId);
  useEffect(() => {
    ownPlaces.current = {
      // Only the device keeping your own room answers, and only while its player runs.
      mine: () => {
        const video = videoRef.current;
        if (!accountHosts || !amHost || !room.isPlaying || room.currentEntryId === null || video === null || video.paused || video.readyState < 3) return null;
        return { entryId: room.currentEntryId, seconds: video.currentTime };
      },
      heard: (place) => {
        leaderPlace.current = place;
      },
    };
  });
  /** The room as a follower aims at it: your leading device's own place while it is fresh, else the room's record. */
  const followedRoom = useEffectEvent(() => {
    const place = leaderPlace.current;
    if (place === null || !accountHosts || !room.isPlaying || place.entryId !== room.currentEntryId || Date.now() - place.at > OWN_PLACE_KEEPS_MS) return room;
    return { ...room, positionSeconds: place.seconds, updatedAt: new Date(place.at).toISOString() };
  });
  // Asked only while something plays, another of your devices is here and this one follows it.
  const askPlace = useEffectEvent(() => ownDevices.askPlace());
  const asksPlace = accountHosts && !amHost && !onItsOwn && live && room.isPlaying && otherDeviceHere;
  useEffect(() => {
    if (!asksPlace) return;
    askPlace();
    return steadyInterval(() => askPlace(), OWN_PLACE_ASK_MS);
  }, [asksPlace]);
  // A tab that hands the transport on forgets where it was: if it hosts again, the room says.
  useEffect(() => {
    if (amHost) return;
    hostEntry.current = null;
    // A server's PLAY is the room's to tell: hosting again, this tab takes it from the room, not from its own old press.
    serverStart.current = null;
  }, [amHost]);

  // `[ WATCH IN ROOM ]`: the room's first video carries on from where the viewer had got to (SPEC-floating-player.md, part 3).
  // Before the hosting effect below, so its first word to the room already says that place. A player not ready yet holds on to it.
  useEffect(() => {
    if (!amHost || !live || videoElement === null || entryId === null) return;
    const place = roomStartFor(videoElement, entryId);
    if (place !== null) videoElement.currentTime = place;
  }, [amHost, live, videoElement, entryId]);

  // A paused room opened again by its host (ROOMSYNC: your room waits, paused, where you left it): its picture is put where
  // the room stands, once per play, rather than at the start. A playing room carries on as it always did.
  const resumedEntry = useRef<string | null>(null);
  const pausedAt = useEffectEvent(() => (!room.isPlaying && room.currentEntryId === entryId ? room.positionSeconds : null));
  useEffect(() => {
    if (!amHost || !live || videoElement === null || entryId === null || resumedEntry.current === entryId) return;
    resumedEntry.current = entryId;
    const at = pausedAt();
    if (at !== null && at > 0 && videoElement.currentTime < 0.5) videoElement.currentTime = at;
  }, [amHost, live, videoElement, entryId]);

  useEffect(() => {
    if (!amHost || !live) return;
    // Taken by a press here (device-lead.ts): what this player shows now is what the room is told, not the other way round.
    const pressed = Date.now() - pressedLead.current < PRESS_HOLD_MS;
    pressedLead.current = 0;
    // Your room came back with this page and no other device of yours is in it: a reload, so it waits paused (ROOMSYNC). Only when
    // presence answered: the wait running out says nothing about a laptop still playing it.
    const cameBack = takeComeBack(roomId) && presenceAnswered.current;
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
    // On a worker's clock, so a paused host in a background tab keeps the beat (lib/watch/steady-timer.ts). A private
    // main room has no beat: its play, pause and seek are written as they happen, and nobody can take it over.
    const stopBeat = announced ? steadyInterval(say, WATCH_HEARTBEAT_MS) : () => undefined;

    // Taking the transport over mid-file: carry on from where this player is, and say so at once. A follower
    // waits at the end of a file for the host to move on, so a hand-over at that moment finds this player
    // already ended - its `ended` came before it was host and will not come again: move on now.
    let starting = false;
    if (pressed) {
      // Nothing to put back: the press is the news.
    } else if (cameBack) {
      video.pause();
    } else if (roomPlaying() && video.ended) fileEnded();
    else if (roomPlaying() && video.paused) {
      starting = true;
      void video.play().catch(refusedPlay);
    }
    // A start still being asked for is said by its own `play`: a browser that refuses it must not pause the room first.
    if (!starting) say();

    return () => {
      video.removeEventListener('play', played);
      video.removeEventListener('pause', say);
      video.removeEventListener('seeked', say);
      video.removeEventListener('ended', ended);
      stopBeat();
    };
  }, [amHost, live, src, videoElement, refusedPlay, announced, roomId]);

  // A new play the room names while the host's file player already holds that file (the same file again: PLAY in MEDIA on the
  // video paused here, list 4): nothing loads, so `autoPlay` never fires. Started here; a new file starts by `autoPlay`.
  const playedEntry = useRef(entryId);
  useEffect(() => {
    if (playedEntry.current === entryId) return;
    playedEntry.current = entryId;
    const video = videoRef.current;
    if (!amHost || !live || song !== null || !roomPlaying() || !(video instanceof HTMLMediaElement)) return;
    if (video.readyState > 0 && video.paused) void video.play().catch(refusedPlay);
  }, [entryId, amHost, live, song, refusedPlay]);

  /* --- following ------------------------------------------------------------------------------- */

  /** A player the browser refused even muted is not asked again until something here is pressed: asking only flickers. */
  const heldForPress = useCallback((video: Playable) => refusedOn.current === video && !everPressed(), []);
  /** The follower's look at the room, so a change that has just arrived is followed at once, not on the next tick. */
  const followNow = useRef<(() => void) | null>(null);

  useEffect(() => {
    // ON ITS OWN (DEVICES, APART in your own room): this player is left where it is, and its presses move only itself.
    if (amHost || !live || onItsOwn) return;

    /** This player's last jump to the host, for this play only. */
    let lastJump: FollowerJump | null = null;
    /**
     * When this follower last told its player to play, pause or jump (device-lead.ts): a player event soon after its own order
     * is that order landing. Any other, on a device of the host's account, is a press there, and that device leads.
     */
    const ordered = { play: 0, pause: 0, seek: 0 };
    // A follower goes where the room is: a place noted for this play's start (a page that came back) is used up here, so it
    // never puts this player back there later, when this device takes the lead (device-lead.ts).
    const followed = currentId();
    if (videoRef.current !== null && followed !== null) roomStartFor(videoRef.current, followed);
    /** Since when this follower's player has sat at the end of the play the room still names, playing. */
    let endedSince: number | null = null;
    /** Since when this player has not been in step: shown as LINING UP once it has lasted. */
    let offSince: number | null = null;
    const inStep = (yes: boolean) => {
      offSince = yes ? null : (offSince ?? Date.now());
      setLiningUp(offSince !== null && Date.now() - offSince >= LINING_UP_AFTER_MS);
    };
    const tick = () => {
      noticePress();
      const video = videoRef.current;
      if (video === null || video.readyState < 1) return inStep(!roomPlaying());
      if (Date.now() - pressedLead.current < PRESS_HOLD_MS) return;
      // A live stream has no shared position: everybody plays and pauses with the host, at the live edge.
      if (stageLiveNow()) {
        inStep(true);
        ordered.seek = Date.now();
        toLiveEdge(video);
        if (video.playbackRate !== 1) video.playbackRate = 1;
        if (roomPlaying() && video.paused && !heldForPress(video)) {
          ordered.play = Date.now();
          void video.play().then(() => setNeedsPress(false), refusedPlay);
        } else if (!roomPlaying() && !video.paused) {
          ordered.pause = Date.now();
          video.pause();
        }
        return;
      }
      // The device of yours that leads went away mid-file (a laptop shut): at the end, this one moves the room on.
      endedSince = video.ended && roomPlaying() ? (endedSince ?? Date.now()) : null;
      if (endedSince !== null && Date.now() - endedSince > LEAD_GONE_AT_END_MS && leadWhenGone()) return;
      const aim = followedRoom();
      const mayJumpNear = lastJump === null || Date.now() - lastJump.at > NEAR_SEEK_EVERY_MS;
      const step = viewerStep(
        aim,
        { seconds: video.currentTime, duration: video.duration, playing: !video.paused, ended: video.ended, mayJumpNear, coarse: video instanceof YouTubePlayable },
        Date.now(),
      );
      inStep(!step.playing || video.ended || (step.at === undefined && !video.paused && Math.abs(hostPosition(aim, Date.now(), video.duration) - video.currentTime) <= LINING_UP_GAP_SECONDS));

      // Only a jump being fetched (`seeking`), not a stall from a slow download, which no jump would mend.
      const loading = video instanceof HTMLMediaElement && video.seeking;
      lastJump = jumpLanded(lastJump, loading, Date.now());
      if (step.at !== undefined) {
        // A jump already on its way is let land, and a player that keeps landing behind aims ahead (rules.ts `followerJump`).
        const jump = followerJump(lastJump, step.at, video.currentTime, step.playing, Date.now(), loading);
        if (jump !== undefined) {
          lastJump = jump.mark;
          ordered.seek = Date.now();
          video.currentTime = Number.isFinite(video.duration) && video.duration > 1 ? Math.min(jump.to, video.duration - 0.5) : jump.to;
        }
      }
      if (Math.abs(video.playbackRate - step.rate) > 0.004) video.playbackRate = step.rate;
      if (step.playing && video.paused && !heldForPress(video)) {
        ordered.play = Date.now();
        void video.play().then(
          () => setNeedsPress(false),
          refusedPlay,
        );
      } else if (!step.playing && !video.paused) {
        ordered.pause = Date.now();
        video.pause();
      }
    };

    tick();
    followNow.current = tick;
    // On a worker's clock: a background tab's own timers are slowed to a crawl, and this device would follow late.
    const stopTicking = steadyInterval(tick, FOLLOW_TICK_MS);
    // Back on screen: the room is read again (a sleeping tab can miss word of a change) and followed at once.
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      applyLocalChange(roomId, { kind: 'refresh' });
      tick();
    };
    document.addEventListener('visibilitychange', back);
    const video = videoRef.current;
    // A device of the host's account hears its own player's presses (its keys, the music bar's, the site's own player's) and leads.
    const heard = (kind: 'play' | 'pause' | 'seek') => () => {
      if (video === null || Date.now() - ordered[kind] < ORDER_LANDS_MS) return;
      pressedOnPlayer(kind, video);
    };
    const onPlay = heard('play');
    const onPause = heard('pause');
    const onSeeked = heard('seek');
    video?.addEventListener('play', onPlay);
    video?.addEventListener('pause', onPause);
    video?.addEventListener('seeked', onSeeked);
    return () => {
      followNow.current = null;
      setLiningUp(false);
      stopTicking();
      document.removeEventListener('visibilitychange', back);
      video?.removeEventListener('play', onPlay);
      video?.removeEventListener('pause', onPause);
      video?.removeEventListener('seeked', onSeeked);
      if (video !== null) video.playbackRate = 1;
    };
  }, [amHost, live, onItsOwn, src, videoElement, refusedPlay, heldForPress, roomId]);
  // The room said play, pause or another place: a follower does it now.
  useEffect(() => {
    // A place heard before this change is of the room as it was.
    leaderPlace.current = null;
    followNow.current?.();
  }, [room.isPlaying, room.positionSeconds, room.currentEntryId]);

  // A room that ended stops the picture where it is. Not the song of the person who started it and is ending it:
  // that carries on for them alone, on the bar (SPEC-rooms-queues.md, phase 3).
  /**
   * A press on the player of a following device of the host's account: it leads, if the player now shows something the room
   * does not say (the check keeps a slow start or a stall from counting as a press).
   */
  const pressedOnPlayer = useEffectEvent((kind: 'play' | 'pause' | 'seek', video: Playable) => {
    // A device nobody has pressed since its page loaded cannot have been pressed: its player did this by itself.
    if (!accountHosts || amHost || stageLive || !everPressed()) return;
    const now = Date.now();
    const differs =
      kind === 'pause' ? room.isPlaying && video.paused && !video.ended
      : kind === 'play' ? !room.isPlaying && !video.paused
      : Math.abs(video.currentTime - hostPosition(room, now)) > SEEK_SECONDS * 2;
    if (differs) takeLead();
  });
  /** The leading device went quiet at a file's end: this following device of the host's account leads and moves on. */
  const leadWhenGone = useEffectEvent((): boolean => {
    if (!accountHosts || amHost) return false;
    return takeLead(false);
  });

  const goingHome = useRef(false);
  const cameHome = useRef(false);
  const barAudio = player.audioElement;
  useEffect(() => {
    if (live) return;
    const stage = videoRef.current;
    if (stage !== null && !(goingHome.current && stage === barAudio())) stage.pause();
  }, [live, barAudio]);

  /* --- songs: the music bar plays them -------------------------------------------------------------- */

  const { bindRoom, cue, audioElement } = player;
  // While the room is live the bar's keys are the room's (MusicPlayerProvider `bindRoom`): the host's NEXT
  // skips, and a follower who takes the controls leaves the room.
  const skipFromBar = useEffectEvent(() => {
    if (!heldBackByDevices()) moveOn(true);
  });
  const leaveFromBar = useEffectEvent(() => onLeft());

  // Off-queue plays (SPEC-music-queues.md): a song the host plays from a post, a profile or PLAY FOR YOU slots into
  // the queue at the current spot as playing, so the queue never lies; a book's later chapters go in right after it.
  /** The play the host just put on from outside the queue: it starts from the top, whatever the room said before. */
  const fromTop = useRef<string | null>(null);
  const playFromOutside = useEffectEvent((tracks: AudioTrack[]) => {
    const [first, ...rest] = tracks;
    if (first === undefined || me === null || !accountHosts) return;
    // A device DEVICES keeps from moving the room: the song isn't put on, and the bar says why.
    if (heldBackByDevices() || !takeLead()) return;
    const queue = read.queue;
    const crowned = hasCrown(read.crowns, me.id);
    void repository
      .playNow({ roomId, by: me.id, link: songLink(first), position: nextQueuePosition(queue), playIndex: nextPlayIndex(queue) })
      .then(async (entry) => {
        fromTop.current = entry.id;
        hostEntry.current = entry.id;
        applyLocalChange(roomId, { kind: 'entry', entry });
        applyLocalChange(roomId, { kind: 'refresh' });
        if (rest.length === 1) await repository.addToQueue({ roomId, addedBy: me.id, position: frontPosition(queue), inQueue: crowned, link: songLink(rest[0]) });
        else if (rest.length > 1) await repository.addSeriesToQueue({ roomId, addedBy: me.id, position: frontPosition(queue), inQueue: crowned, seriesTitle: first.credit || first.title, links: rest.map(songLink) });
        if (rest.length > 0) applyLocalChange(roomId, { kind: 'refresh' });
      })
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'IT COULD NOT BE PLAYED IN THE ROOM.'));
  });
  // The host's ADD TO QUEUE / PLAY NEXT write into the room, by the crown rule: crowned, straight in; else their list.
  const enqueueFromOutside = useEffectEvent((track: AudioTrack, where: 'end' | 'next') => {
    if (me === null) return;
    void repository
      .addToQueue({
        roomId,
        addedBy: me.id,
        position: where === 'next' ? frontPosition(read.queue) : nextQueuePosition(read.queue),
        inQueue: hasCrown(read.crowns, me.id),
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
      hosting: accountHosts,
      onNext: () => skipFromBar(),
      onPrevious: () => backFromBar(),
      onLeave: () => leaveFromBar(),
      onPlay: (tracks) => playFromOutside(tracks),
      onEnqueue: (track, where) => enqueueFromOutside(track, where),
      waiting: waitingSongs,
    });
  }, [bindRoom, roomId, accountHosts, live, waitingSongs]);
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
  const cueSong = useEffectEvent((track: AudioTrack) => {
    const at = songStart();
    // The host's bar is already on this song (GO LIVE carried it in a moment ago): it is not moved, so nothing skips.
    // Known by the row GO LIVE filed, never by comparing clocks: this device's and the database's can disagree.
    const inPlace = amHost && player.track?.src === track.src && isCarriedSong(entryId);
    cue(track, inPlace ? {} : { at }, songPlays());
  });
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
    // A private main room is its owner's: a quiet host is waited for, never taken over. A live one is taken over after
    // 45 quiet seconds (the store's rule, MAIN_ROOM_TAKE_OVER_MS): until then each try is simply refused.
    if (!announced || user === null || accountHosts || !live || !membersHeard) return;
    if (!shouldTakeOver(members, hostId, myKey)) return;

    const attempt = () =>
      void repository.takeOver(roomId, hostId, user.id).then((won) => {
        if (won) applyLocalChange(roomId, { kind: 'refresh' });
      });
    attempt();
    const timer = window.setInterval(attempt, TAKE_OVER_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [repository, roomId, hostId, user, accountHosts, live, members, membersHeard, myKey, announced]);

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
    // A private main room is on no list and lights no lamp or TV key, whoever is in it (SPEC-rooms-perpetual.md).
    if (user === null || !live || !announced) {
      repository.setWatching(null);
      return;
    }
    repository.setWatching({ userId: user.id, roomId, hostName, title, hosting: accountHosts, unlisted: !myProfile.visibility.showOnline || room.privacy !== 'open' });
  }, [repository, user, live, announced, roomId, hostName, title, accountHosts, myProfile.visibility.showOnline, room.privacy]);
  useEffect(() => () => repository.setWatching(null), [repository]);

  /* --- leaving --------------------------------------------------------------------------------- */

  const heir = me === null ? null : handoverTo(members, me.id);
  const myOtherTab = otherDeviceHere;
  const [leaving, setLeaving] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  /**
   * END STREAM, or leaving the room to a new host, for the person whose queue GO LIVE carried into it
   * (go-live-carry.ts): their own queue becomes what was still waiting here, and what was on carries on for them
   * alone. In two steps, so a room that failed to end takes nothing: `setOut` reads the room as it stands, before the
   * end is written (and keeps their song from being stopped with the room); the function it returns brings it home,
   * once, when the room has ended or they have left. A host who took the room over, or whose queue never got in,
   * keeps their own queue as it is.
   */
  function setOut(): (() => void) | null {
    if (cameHome.current || music || user === null || !accountHosts || !live || !wasCarried(roomId)) return null;
    goingHome.current = true;
    const leaving = read;
    const songWasOn = songOn;
    return () => {
      if (cameHome.current) return;
      cameHome.current = true;
      forgetCarried(roomId);
      const audio = audioElement();
      comeHome(leaving, { now: Date.now(), origin: window.location.origin, song: songWasOn && audio !== null ? { place: audio.currentTime, playing: !audio.paused } : null });
    };
  }

  async function leave(choice: 'handover' | 'end') {
    setLeaving(true);
    const home = setOut();
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
    // Leaving either way, so the queue comes with them either way.
    home?.();
    onLeft();
  }

  // Anybody but a host with something to decide simply goes. A person's own room has nothing to decide: it is kept,
  // never ended, and closing its window only closes the window (SPEC-rooms-queues.md; GO PUBLIC's switch is gone).
  useEffect(() => {
    if (!closing) return;
    if (music || !(accountHosts && live && !myOtherTab)) onLeft();
  }, [closing, accountHosts, live, myOtherTab, onLeft, music]);

  // A host whose tab closes with others in the room hands over on the way out; if the write is lost
  // the others take over by themselves once the host has been quiet a few seconds.
  const goodbye = useEffectEvent(() => {
    if (music) return;
    const heirId = heir?.userId ?? null;
    if (accountHosts && live && !myOtherTab && heirId !== null) void repository.handOver(roomId, heirId).catch(() => undefined);
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
    video.muted = silent;
  }, [volume, silent, src, videoElement, songOn]);

  // A link that will not play in this browser (an address tied to somebody else's session, one that
  // expired in the queue): it says so on the stage, and chat goes on. A host's room moves on after a
  // moment, so one dead link does not stop the stream for everybody.
  const [deadEntry, setDeadEntry] = useState<string | null>(null);
  const linkDead = link !== null && deadEntry !== null && deadEntry === entryId;
  /**
   * A Twitch channel that is not broadcasting, or whose stream has just ended (SPEC-live-streams.md, Luke 2026-11-17, 3A and 4A):
   * Twitch's player says OFFLINE, and the room says so by the channel's name, then moves on like any link that won't play.
   */
  const [offlineEntry, setOfflineEntry] = useState<string | null>(null);
  const offlineChannel = linkDead && offlineEntry === entryId && link !== null ? (twitchOf(link)?.channel ?? null) : null;
  /** A Twitch channel's own page, for the note's way out when Twitch's player can't start here. */
  const twitchChannel = link === null ? null : (twitchOf(link)?.channel ?? null);
  const twitchPage = twitchChannel === null ? null : `https://www.twitch.tv/${encodeURIComponent(twitchChannel)}`;
  /**
   * Twitch shows this channel only after a sign-in: it is labelled for certain audiences, and Twitch's own player says
   * "log in to continue" over the picture (Luke, 2026-11-18: "Mark, explain, list playable first"). Asked once per channel
   * of the live list (kept a minute on the server); the stage then says why, with the two ways on.
   */
  const [gatedChannel, setGatedChannel] = useState<string | null>(null);
  useEffect(() => {
    if (twitchChannel === null) return;
    const login = twitchChannel.toLowerCase();
    let gone = false;
    void loadLiveNow({ channels: [login] }).then((items) => {
      if (!gone && items.some((item) => item.externalId === login && item.signInToWatch === true)) setGatedChannel(twitchChannel);
    });
    return () => {
      gone = true;
    };
  }, [twitchChannel]);
  /**
   * The play whose stream has played here: signed in to Twitch (or let in some other way), the sign-in note has nothing to say
   * and never comes back for it (Luke, 2026-11-18: "remove the error message on twitch streams after already being signed in").
   * The label alone said "sign in" even while the stream played.
   */
  const [streamPlayedEntry, setStreamPlayedEntry] = useState<string | null>(null);
  const signInGate = twitchChannel !== null && gatedChannel === twitchChannel && streamPlayedEntry !== entryId;
  const skipDead = useEffectEvent(() => {
    if (upcoming(read.queue).length === 0) return;
    setNotice(offlineChannel !== null ? `SKIPPED: ${offlineChannel.toUpperCase()} IS OFFLINE` : `SKIPPED: ${(entryTitle ?? '').toUpperCase()} WOULDN'T PLAY`);
    moveOn(true);
  });
  useEffect(() => {
    if (!linkDead || !amHost || !live) return;
    const timer = window.setTimeout(() => skipDead(), DEAD_LINK_SKIP_MS);
    return () => window.clearTimeout(timer);
  }, [linkDead, amHost, live]);

  /**
   * LUKE'S SERVER's player said it can be driven (Luke, 2026-11-27, 3A "full sync"; `jellyfin-player.ts`): for this play it is the
   * room's player as YouTube's is, followed for play, pause and jumps, and the server's own ways (PLAY FOR ALL, the restart, the beat)
   * stand down. Kept with the frame's restart count, so the frame is not made again as the room changes over.
   */
  const [remoteEntry, setRemoteEntry] = useState<{ entryId: string; restarts: number } | null>(null);
  const serverDriven = remoteEntry !== null && entryId !== null && remoteEntry.entryId === entryId;
  // A WEB platform's own player (`embed`) gives the room no transport to read, so the host's heartbeat is
  // said here instead: the room stays live (not closed as quiet) and on this play until the host moves on.
  const officialOn = link !== null && link.kind === 'embed' && !serverDriven;
  /**
   * A media server's own player (SPEC-media-servers.md): the host's PLAY restarts everybody's at once (Luke, 2026-11-08). Its beat
   * writes how long ago that PLAY was, walking up, and the PLAY writes 0, so everybody sees the restart as the position going back
   * (rules.ts `serverRestarted`) and a viewer who came in part-way can see how far in the room is.
   */
  const serverOn = officialOn && mediaServerForUrl(link.url) !== undefined;
  /** When this host's last PLAY on the server's player was, on its own clock; taken from the room when it starts hosting part-way. */
  const serverStart = useRef<{ entryId: string | null; at: number } | null>(null);
  /** The host's PLAY on a server's player: 0 now, and the beat walks up from here. */
  function playServerForAll() {
    if (!takeLead()) return;
    serverStart.current = { entryId: room.currentEntryId, at: Date.now() };
    void repository
      .writePlayback(roomId, { currentEntryId: room.currentEntryId, positionSeconds: 0, isPlaying: true })
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT BE UPDATED.'));
  }
  const officialBeat = useEffectEvent(() => {
    // Moving on from this player, the room must not be put back on it (`hostMayPublish`, as the host's own player's write).
    if (!hostMayPublish(hostEntry.current, room.currentEntryId)) return;
    let positionSeconds = 0;
    if (serverOn) {
      const nowMs = Date.now();
      if (serverStart.current === null || serverStart.current.entryId !== room.currentEntryId) {
        serverStart.current = { entryId: room.currentEntryId, at: nowMs - hostPosition(room, nowMs) * 1000 };
      }
      positionSeconds = Math.max(0, (nowMs - serverStart.current.at) / 1000);
    }
    void repository
      .writePlayback(roomId, { currentEntryId: room.currentEntryId, positionSeconds, isPlaying: true })
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT BE UPDATED.'));
  });
  // A picture has no transport either: the same beat keeps the room live and on it until NEXT.
  useEffect(() => {
    if (!(officialOn || pictureOn) || !amHost || !live) return;
    officialBeat();
    if (!announced) return;
    return steadyInterval(() => officialBeat(), WATCH_HEARTBEAT_MS);
  }, [officialOn, pictureOn, amHost, live, entryId, announced]);
  // A crown's NEXT takes the picture off by clearing the room's pointer (`watch_picture_next`). This host was on that
  // picture, not ahead of the room: its black-screen beat may speak again, and whatever is queued behind starts.
  const shownPicture = useRef<string | null>(null);
  useEffect(() => {
    if (pictureOn) {
      shownPicture.current = entryId;
      return;
    }
    if (room.currentEntryId === null && shownPicture.current !== null && hostEntry.current === shownPicture.current) hostEntry.current = null;
    shownPicture.current = null;
  }, [pictureOn, entryId, room.currentEntryId]);
  /** NEXT off a picture: the host moves the room on; a crown asks the database to take it off, and the host's tab starts what is next. */
  const crownedHere = me !== null && hasCrown(read.crowns, me.id);
  const mayNextPicture = pictureOn && live && (accountHosts || crownedHere);
  function nextFromPicture() {
    if (accountHosts) {
      moveOn(true);
      return;
    }
    if (user === null) return;
    void repository
      .pictureNext(roomId, user.id)
      .then(() => applyLocalChange(roomId, { kind: 'refresh' }))
      .catch((failure: unknown) => setFault(failure instanceof Error ? failure.message : 'THE PICTURE COULD NOT BE TAKEN OFF.'));
  }
  /** Any viewer can hide a picture for themselves; it comes back with the next one. */
  const [hiddenPicture, setHiddenPicture] = useState<string | null>(null);
  // Everybody's server player is made again when the room's position goes back on the same play: the host's PLAY. Counted from the
  // room's own rows, the host's tab included, so every player restarts on the same write.
  const [serverSeen, setServerSeen] = useState<{ mark: ServerMark; restarts: number }>({ mark: { entryId: null, position: 0 }, restarts: 0 });
  if (serverOn && (serverSeen.mark.entryId !== room.currentEntryId || serverSeen.mark.position !== room.positionSeconds)) {
    const sameplay = serverSeen.mark.entryId === room.currentEntryId;
    setServerSeen({
      mark: { entryId: room.currentEntryId, position: room.positionSeconds },
      restarts: sameplay ? serverSeen.restarts + (serverRestarted(serverSeen.mark, room) ? 1 : 0) : 0,
    });
  }

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
    if (!announced) return;
    return steadyInterval(() => blankBeat(), WATCH_HEARTBEAT_MS);
  }, [blank, amHost, live, announced]);

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
        hostEntry.current = null;
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
    // The key goes at the press, not when the picture has loaded enough to start (a slow file kept it up for seconds, so the press
    // looked like it did nothing: live drive, 2026-11-08). A browser that refuses again brings it back.
    setNeedsPress(false);
    void video.play().catch(refusedPlay);
  }

  /* --- the player bar -------------------------------------------------------------------------- */

  // The bar sits under the picture and always shows: nothing covers the video (Luke, 2026-11-02). The picture and the
  // bar go fullscreen together; there the bar lies over the foot of the picture and goes after a few seconds without the
  // pointer moving, or at once when it leaves (Luke, 2026-11-19; `useFullscreenBar`).
  const stageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const pictureBox = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // The stage, or the floating picture alone, is fullscreen: the chosen background is drawn round the picture, which takes
  // the video's own shape (SPEC-rooms-your-room.md, part 3; Luke, 2026-11-16: "i want the black bars replaced by the
  // backround of the website that is selected").
  const [staged, setStaged] = useState(false);
  useEffect(() => {
    const changed = () => {
      const full = document.fullscreenElement;
      setFullscreen(full !== null && full === stageRef.current);
      setStaged(full !== null && (full === stageRef.current || full === pictureBox.current));
    };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  // `[ BKG ]` (SPEC-rooms-your-room.md, part 4): off, a fullscreen video is as its player shows it, bars and all.
  const bkg = useSyncExternalStore(subscribeToStageBkg, stageBkgOn, stageBkgOnServer);
  const dressed = staged && bkg;
  /**
   * The shape of the room's own `<video>`, as its file says once it has loaded; kept against the file's address, not the play:
   * the same file named again keeps its element, which says its size only once (list 4).
   */
  const [fileShape, setFileShape] = useState<{ file: string | null; shape: number } | null>(null);
  /** The black bars in the room's own `<video>`, read from it as it plays where its host allows (`bar-watch.ts`). */
  const [fileTrim, setFileTrim] = useState<{ entry: string | null; trim: Trim } | null>(null);
  useEffect(() => {
    if (!(videoElement instanceof HTMLVideoElement)) return;
    return watchVideoBars(videoElement, (trim) => setFileTrim({ entry: entryId, trim }));
  }, [videoElement, entryId]);
  // Floating, the picture is a handle as well as its title line (SPEC-rooms-your-room.md, part 2).
  const floatDrag = useRoomFloatDrag(pictureBox);
  function toggleFullscreen() {
    const box = stageRef.current;
    if (box === null) return;
    if (fullscreenBox() !== null) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    // Folded by `[ _ ]`, the picture is out of sight: FULL on the music bar opens the room first, on screen before the ask, so the
    // ask fills the screen with the picture and never with a hidden box the site shows through (Luke, 2026-11-27, "Open room +
    // fullscreen"). A browser that refuses still leaves the room open, with FULL ready to press again.
    if (pictureHidden) flushSync(() => expandWatch());
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
  /** [ DEVICES ] (Luke, 2026-11-27): its key is on the window's title line while another device of yours is here. */
  const [devicesOpen, setDevicesOpen] = useState(false);
  const devicesKeyOn = accountId !== null && otherDeviceHere && live;
  const openDevices = useCallback(() => setDevicesOpen(true), []);
  useEffect(() => {
    if (!devicesKeyOn) return;
    offerRoomDevices(openDevices);
    return () => {
      offerRoomDevices(null);
      // The window goes with the key (the other device left), and doesn't come back by itself when one comes in again.
      setDevicesOpen(false);
    };
  }, [devicesKeyOn, openDevices]);
  const myDeviceId = ownDevices.deviceId;
  const { choose: chooseWay } = ownDevices;
  /** APART in your own room: the device playing the room now keeps it, and the other plays on its own. */
  const chooseDeviceMode = useCallback(
    (other: string, mode: DeviceMode | null) => chooseWay(other, mode, mode === 'apart' && accountHosts ? (amHost ? myDeviceId : other) : null),
    [chooseWay, accountHosts, amHost, myDeviceId],
  );
  /** Counts GO LIVE's asks: each opens the cog on WHO CAN JOIN (Luke, 2026-11-17), from the bar's key, the music bar or CYTUBE. */
  const [askedLive, setAskedLive] = useState(0);
  const askLive = () => {
    setSettingsOpen(true);
    setAskedLive((asked) => asked + 1);
  };
  /** Shut, the cog forgets the ask: the next plain press of the cog opens it at the top. */
  const closeSettings = () => {
    setSettingsOpen(false);
    setAskedLive(0);
  };
  /** The search a blank screen's key opened the queue window with (SPEC-cytube.md). */
  const [queuePrefill, setQueuePrefill] = useState<string | undefined>(undefined);
  const openQueue = (key?: BlankKey) => {
    setQueuePrefill(key === undefined ? undefined : blankPrefill(key));
    setQueueOpen(true);
  };
  // FIND IN ROOM from the media tab (SPEC-media-servers.md): a TMDB title no server holds opens the queue searched
  // for it, so a playable source can be queued. Fires as the room opens, and if another arrives while it is open.
  useEffect(() => {
    const check = () => {
      const title = takeFindInRoom(read.room.id);
      if (title !== null) {
        setQueuePrefill(title);
        setQueueOpen(true);
      }
    };
    check();
    return subscribeFindInRoom(check);
  }, [read.room.id]);

  /* --- the room's look (SPEC-cytube.md) -------------------------------------------------------- */

  const myChoice = useLookChoice(user?.id ?? null);
  // Read fresh as the room opens: a look the host changed since this tab last read it shows.
  // A visitor's own room: their browser id is no account, so there is no saved look to read for it.
  const hostChoice = useLookChoice(visitorRoom ? null : room.hostId, { fresh: true });
  const look = lookForRoom(hostChoice.look, myChoice, accountHosts);
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
  // A picture has nothing to play, pause or seek: it is held until NEXT.
  const hasTransport = src !== undefined && !officialOn && !pictureOn;
  const hostKeys = accountHosts && live;
  /** DEVICES: a device following one of yours has no keys that move the room; one ON ITS OWN keeps play, pause and seek, for itself. */
  const steersHere = hostKeys && !keptFollowing;
  const movesRoom = steersHere && !onItsOwn;
  /** Where those keys were: which of your devices this one follows, or that it plays on its own. */
  const devicesHold =
    hostKeys && (keptFollowing || onItsOwn) ? (
      <span className="shrink-0 px-1 text-label text-sun" data-room-devices-hold={keptFollowing ? 'follow' : 'own'}>
        {keptFollowing ? `FOLLOWING ${roleBy ?? ''}` : 'ON ITS OWN'}
      </span>
    ) : null;
  /** Your own main room, live: its WHO CAN JOIN and END ROOM are in the cog. */
  const mainRoomHost = hostKeys && music;
  // GO LIVE pressed on the music bar or the CYTUBE page opens this room (main-room-play.ts): here, its cog on WHO CAN JOIN.
  useEffect(() => {
    if (!mainRoomHost) return;
    const check = () => {
      if (!takeGoLiveAsk(roomId)) return;
      setSettingsOpen(true);
      setAskedLive((asked) => asked + 1);
    };
    check();
    return subscribeToGoLiveAsk(check);
  }, [mainRoomHost, roomId]);
  const duration = Number.isFinite(clock.duration) ? clock.duration : 0;
  const progress = duration > 0 ? Math.min(100, (clock.seconds / duration) * 100) : 0;

  // The music bar's box for the stream (lib/watch/stream-bar.ts): while the bar shows the stream, the keys live
  // there (Luke, 2026-11-03) and the picture has the room to itself. In fullscreen the bar is out of sight, and
  // while the bar shows the music it is not offered, so the keys come back under the picture.
  const barTarget = useSyncExternalStore(subscribeToStreamBar, () => streamBarState().target, () => null);
  const keysOnMusicBar = barTarget !== null && !fullscreen;
  // The room canvas (SPEC-stream-art.md): each viewer's own screen shows the picture or the shared canvas. While a
  // song plays the canvas is the default; with a video, the picture.
  const canvasAudio = song !== null;
  // A visitor's own room has no canvas (it is shared through the site, and their room never leaves this browser): the
  // song's cover is their screen instead.
  const screen = useScreenView(roomId, canvasAudio && !visitorRoom);
  // Remote controlling fullscreen (REMOTE: THE PC, THE SERVER, Remote Desktop): no player bar over the foot of the picture,
  // nor the pointer hiding with it (Luke, 2026-11-22: "when remote controlling in the room on fullscreen, we dont need the
  // player bar at the bottom of the screen"). Keys still go to the remote; Esc (held, while it has the keyboard) and the
  // remote's own SETTINGS > LEAVE FULLSCREEN are the way out, and leaving fullscreen brings the bar back.
  const remoteOn = screen === 'screen';
  const remoteFull = staged && remoteOn;
  const barAwake = useFullscreenBar(stageRef, barRef, fullscreen && !remoteFull);
  // `[ KEYS IN THE PICTURE ]` (ROOMBARS, Luke 2026-11-21; `keys-in-picture.ts`): the playback keys along the foot of the picture
  // as well. Not over a fullscreen stage, where the bar itself already lies over the picture's foot.
  const keysInPicture = useKeysInPicture(user?.id ?? null);
  const pictureBarRef = useRef<HTMLDivElement>(null);
  const pictureBarOn = keysInPicture && !fullscreen && !remoteFull && !blank && song === null && !pictureOn && !(needsPress && live);
  const pictureBarAwake = useIdleBar(pictureBox, pictureBarRef, pictureBarOn);

  // The keys, each drawn in whichever of the two bars is showing them.
  const playKey =
    serverOn && movesRoom ? (
      // A server's own player can't be paused from here: the host's PLAY starts everybody's again from the top, together.
      <button
        type="button"
        className={`${PLATE_ON_BLACK} shrink-0`}
        aria-label="Play: starts this player again from the top for everyone, together"
        title="Starts everyone's player from the top, together"
        {...explain('Starts this player again from the top for everyone in the room, together.', 'For a player the site can\'t steer itself: it gets everyone back in step.')}
        onClick={playServerForAll}
        data-server-play
      >
        [ ▶ PLAY FOR ALL ]
      </button>
    ) : hasTransport && steersHere ? (
      <button
        type="button"
        className={`${PLATE_ON_BLACK} shrink-0`}
        aria-label={clock.paused ? 'Play' : 'Pause'}
        {...explain(clock.paused ? 'Plays the video from where it is.' : 'Pauses the video where it is.', 'In a room you host, everyone watching along moves with you.')}
        onClick={() => {
          const video = videoRef.current;
          if (video === null) return;
          takeLead();
          if (video.paused) void video.play().catch(refusedPlay);
          else video.pause();
        }}
      >
        {clock.paused ? '[ ▶ ]' : '[ ❚❚ ]'}
      </button>
    ) : null;
  // A live stream has no position to show; the space is kept so the keys beside it stay put.
  const seekLine = stageLive ? (
    <span className="min-w-12 flex-1" />
  ) : steersHere ? (
    <input
      type="range"
      aria-label="Seek"
      min={0}
      max={duration}
      step={0.1}
      value={Math.min(clock.seconds, duration)}
      onChange={(event) => {
        const video = videoRef.current;
        takeLead();
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
  const timeMark = pictureOn ? (
    <span className="shrink-0 font-bold" data-watch-clock="held">
      HELD
    </span>
  ) : stageLive ? (
    <span className="shrink-0 bg-acid px-1 font-bold text-ink-plate" data-watch-clock={clock.seconds.toFixed(1)}>
      LIVE
    </span>
  ) : (
    <span className="shrink-0 tabular-nums" data-watch-clock={clock.seconds.toFixed(1)}>
      {formatMediaTime(clock.seconds)} / {duration > 0 ? formatMediaTime(duration) : '--:--'}
    </span>
  );
  // Back, skip and loop (ROOMSYNC adds back and loop beside the skip: "the back arrow ... to go back to it and the loop
  // button to loop it"). The loop is the bar's own loop key while you host (`roomLoop`), so the two always agree.
  const nothingBefore = previousPlay(read) === null && (entry === undefined || pictureOn);
  const skipKey = movesRoom ? (
    <>
      <button
        type="button"
        className={`${PLATE_ON_BLACK} shrink-0`}
        disabled={nothingBefore}
        aria-label="Back to what played before"
        title={nothingBefore ? 'Nothing played before' : 'Back'}
        {...explain('Goes back to what played before this.', 'In a room you host, everyone watching along moves with you.')}
        onClick={goBack}
        data-room-back
      >
        [ ◀◀ ]
      </button>
      <button
        type="button"
        className={`${PLATE_ON_BLACK} shrink-0`}
        disabled={waiting.length === 0 && !pictureOn}
        aria-label="Skip to the next video"
        title={waiting.length === 0 && !pictureOn ? 'Nothing queued' : 'Skip'}
        {...explain('Skips to the next thing in the queue.', 'In a room you host, everyone watching along moves with you. Greyed out when nothing is queued.')}
        onClick={() => moveOn(true)}
      >
        [ ▶▶ ]
      </button>
      <button
        type="button"
        className={`${player.roomLoop ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} shrink-0`}
        aria-pressed={player.roomLoop}
        aria-label="Loop what is on"
        title={player.roomLoop ? 'Looping: starts again when it ends' : 'Loop what is on'}
        {...explain(player.roomLoop ? 'Stops repeating what is on.' : 'Repeats what is on: it starts again when it ends.', 'Filled while it repeats.')}
        onClick={() => player.setRoomLoop(!player.roomLoop)}
        data-room-loop={player.roomLoop ? 'on' : 'off'}
      >
        [ ↻ ]
      </button>
    </>
  ) : null;
  const floatKey =
    link !== null && !archiveRead.waiting && (officialOn || isEmbedKind(link.kind)) && song === null ? (
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label="Picture in picture: floats over the site" title="Picture in picture: floats over the site" {...explain('Floats the video over the site, so it keeps playing on other pages.', 'Drag it where you like. The room stays open behind it.')} onClick={pictureFloats ? expandWatch : onFloatPicture} data-room-pip>
        {`[ ${ROOM_PIP_MARK} ]`}
      </button>
    ) : null;
  const pipKey = canPip ? (
    <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label="Picture in picture" title="Picture in picture" onClick={togglePip} data-room-pip {...explain('Pops the video out into the browser\'s own little window, above your other apps.', 'To keep watching while you use another program.')}>
      {`[ ${ROOM_PIP_MARK} ]`}
    </button>
  ) : floatKey;
  // As most video players mark them (Luke, 2026-11-17); the words stay in the name and the tooltip. The floating picture's own
  // fullscreen counts too (`staged`), for the key on the picture's own bar. Folded out of sight (`pictureHidden`), it opens the room
  // as it goes (Luke, 2026-11-27: "it can also be present without any video causing you to fullscreen the site instead of the video").
  const fullKey = (
    <button
      type="button"
      className={`${PLATE_ON_BLACK} shrink-0`}
      aria-label={staged ? 'Leave fullscreen' : pictureHidden ? 'Open the room and fullscreen its picture' : 'Fullscreen'}
      title={staged ? 'Leave full screen' : pictureHidden ? 'Open the room, full screen' : 'Full screen'}
      {...explain(
        staged ? 'Leaves full screen, back to the window.' : pictureHidden ? 'Opens the room window you folded away and fills the screen with its picture.' : 'Fills the screen with the room\'s picture.',
        'Esc also leaves full screen. Only your screen changes.',
      )}
      onClick={toggleFullscreen}
      data-room-full={staged ? 'leave' : 'enter'}
    >
      {`[ ${staged ? ROOM_LEAVE_FULL_MARK : ROOM_FULL_MARK} ]`}
    </button>
  );
  // The REMOTE view has its FULL key whatever is playing under it, or nothing is (Luke, 2026-11-23: "when using remote, there is no
  // full screen button, appearing only when you stream a video"). Another site's own player (LUKE'S SERVER, PeerTube, the Archive's)
  // has its own fullscreen switched off (`withoutFullscreen`), so the room's FULL is its way, driven or not (Luke, 2026-11-27: "it
  // dissapears when watching dolphin media", his Jellyfin before its remote said hello).
  const pictureKeys = officialOn ? (
    <>
      {floatKey}
      {fullKey}
    </>
  ) : hasTransport && song === null ? (
    <>
      <SpeakerKey muted={silent} volume={volume} onMuted={turnMuted} onVolume={turnVolume} followsYourDevices={user !== null} heldBy={heldMuted === null ? undefined : (heldMuted.by ?? 'THIS DEVICE')} />
      <QualityKey source={qualitySource} />
      <SubsKey
        key={entryId ?? 'none'}
        source={subtitleSource}
        play={entryId}
        seriesId={entry?.series?.id ?? null}
        textAudio={archiveList?.language ?? detectLanguage(subtitleTitle)}
        burnedIn={burnedInSubtitles(subtitleTitle)}
      />
      {pipKey}
      {fullKey}
    </>
  ) : remoteOn ? (
    fullKey
  ) : null;
  // Fullscreen with no FULL key among the picture's keys (the blank screen's BOOKS / VIDEO / MUSIC, a song, a held picture): the
  // way out is still on the bar (Luke, 2026-11-16: "the unfullscreen button is still visible").
  const exitKey =
    fullscreen && !(officialOn || (hasTransport && song === null)) ? (
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label="Leave fullscreen" title="Leave full screen" onClick={toggleFullscreen} data-room-exit-full {...explain('Leaves full screen, back to the window.', 'Esc does the same.')}>
        {`[ ${ROOM_LEAVE_FULL_MARK} ]`}
      </button>
    ) : null;
  // Your main room has its own keys instead (SPEC-rooms-perpetual.md): GO LIVE / ● LIVE, which opens the cog on WHO CAN JOIN,
  // and LEAVE while live. END ROOM is in the cog (Luke, 2026-11-17): nothing on the bar ends your room.
  const mainRoomKeys = mainRoomHost ? <MainRoomKeys room={room} heir={heir} onLeft={onLeft} onAskLive={askLive} /> : null;
  const endKey = mainRoomKeys ?? (hostKeys && !music ? (
    // Ending it for everybody takes a second press, like starting it did.
    <button
      type="button"
      className={`${confirmEnd ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} shrink-0`}
      {...explain(confirmEnd ? 'Ends the stream for everybody, now.' : 'Ends the stream. The first press asks; the second ends it for everybody.', 'Everyone is sent out; the room\'s record stays on the forum. It may ask to save the canvas first.', "CAN'T BE UNDONE.")}
      onClick={() => {
        if (!confirmEnd) {
          setConfirmEnd(true);
          return;
        }
        // A changed canvas nobody saved asks "save this canvas?" first (SPEC-stream-art.md).
        let home: (() => void) | null = null;
        void askToSaveCanvas(roomId, { ending: true })
          .then(() => {
            home = setOut();
            return repository.endRoom(roomId);
          })
          .then(() => {
            // Only now that the room has really ended.
            home?.();
            applyLocalChange(roomId, { kind: 'refresh' });
          })
          .catch((failure: unknown) => {
            // Still live: nothing came home, and the song is the room's to stop again.
            goingHome.current = false;
            setFault(failure instanceof Error ? failure.message : 'THE STREAM COULD NOT BE ENDED.');
          });
      }}
      onBlur={() => setConfirmEnd(false)}
    >
      {confirmEnd ? '[ END FOR EVERYBODY ]' : '[ END STREAM ]'}
    </button>
  ) : null);

  // Under the picture, left to right: play/pause (host), where it is and the time, skip (host), the sound, QUALITY,
  // PIP, FULL, END STREAM (host). The chat column's strip names the video.
  const playerBar = !keysOnMusicBar && !remoteFull && (hasTransport || hostKeys || remoteOn || floatKey !== null || exitKey !== null) ? (
    // `relative`: on a phone the SUBS list opens as a sheet across the bar, just above it.
    <div
      ref={barRef}
      className={`${ROOM_BAR} ${fullscreen ? ROOM_BAR_OVER : ''} ${barAwake ? '' : ROOM_BAR_ASLEEP}`}
      data-watch-bar="shown"
      data-watch-bar-awake={fullscreen ? (barAwake ? 'awake' : 'asleep') : undefined}
    >
      {playKey}
      {devicesHold}
      {/* Where it is, and the time: a row of its own on a phone, so the keys fit on the one under it. With no
          transport (a WEB platform's own player) the space only pushes the host's keys to the right. */}
      {serverOn ? (
        // How far in the room is, for anybody who came in part-way and wants to skip there in the server's own player.
        <span className="flex min-w-0 flex-1 items-center">
          <ServerClock room={room} />
        </span>
      ) : !hasTransport ? (
        <span className="flex-1" />
      ) : (
        <span className={ROOM_BAR_PLACE}>
          {seekLine}
          {timeMark}
        </span>
      )}
      {skipKey}
      {pictureKeys}
      {exitKey}
      {endKey}
    </div>
  ) : null;

  // The keys along the foot of the picture (ROOMBARS, `[ KEYS IN THE PICTURE ]`): play/pause, back, skip and loop (host), where it
  // is, the sound, PIP and FULL; QUALITY, SUBS and the host's END stay on the player bar. Over the picture it goes after a few
  // seconds without the pointer moving, or at once when the pointer leaves, and comes back on a move or a key (`useIdleBar`); its
  // strip still feels the pointer while it is gone, so moving over the picture's foot wakes it over another site's player too.
  const pictureBar = pictureBarOn && (hasTransport || hostKeys || pipKey !== null) ? (
    <div
      ref={pictureBarRef}
      role="toolbar"
      aria-label="Playback keys"
      // A double press on the bar is two presses of a key, never the picture's FULL.
      onDoubleClick={(event) => event.stopPropagation()}
      className={`${ROOM_PICTURE_KEYS} ${pictureBarAwake ? '' : ROOM_BAR_ASLEEP}`}
      data-room-picture-keys={pictureBarAwake ? 'awake' : 'asleep'}
    >
      {playKey}
      {serverOn ? (
        <span className="flex min-w-0 flex-1 items-center">
          <ServerClock room={room} />
        </span>
      ) : !hasTransport ? (
        <span className="flex-1" />
      ) : (
        <span className={ROOM_BAR_PLACE}>
          {seekLine}
          {timeMark}
        </span>
      )}
      {skipKey}
      {officialOn ? (
        <>
          {pipKey}
          {/* Another site's own player has no fullscreen of its own here: the room's FULL is its way in and out. */}
          {fullKey}
        </>
      ) : hasTransport ? (
        <>
          <SpeakerKey muted={silent} volume={volume} onMuted={turnMuted} onVolume={turnVolume} followsYourDevices={user !== null} heldBy={heldMuted === null ? undefined : (heldMuted.by ?? 'THIS DEVICE')} />
          {pipKey}
          {fullKey}
        </>
      ) : null}
    </div>
  ) : null;

  /** On a desktop the picture takes the column's height; on a phone (and in fullscreen there) its own shape. */
  const pictureFit = fullscreen || pictureFloats ? 'h-full w-full' : ROOM_PICTURE_FIT;
  /** Fullscreen, a video is its own shape with the background round it; a song's cover, a held picture and the blank screen fill the box as before. */
  const videoFit = dressed ? 'stage-fit' : pictureFit;
  const ownShape = fileShape !== null && fileShape.file === (src ?? null) ? fileShape.shape : WIDE;
  const ownTrim = fileTrim !== null && fileTrim.entry === entryId ? fileTrim.trim : NO_TRIM;
  // The room window fits itself to the picture's shape (list 4, `room-fit.ts`): a file's own, YouTube's or Vimeo's as their site
  // says, 16:9 for any other player; nothing to fit for a song, a held picture or the blank screen.
  const [siteShape, setSiteShape] = useState<{ url: string; shape: number } | null>(null);
  const shapeAsked = link !== null && (link.kind === 'youtube' || link.kind === 'vimeo') && song === null ? link.url : null;
  useEffect(() => {
    if (shapeAsked === null) return;
    let alive = true;
    void videoShape(shapeAsked).then((found) => {
      if (alive) setSiteShape({ url: shapeAsked, shape: found ?? WIDE });
    });
    return () => {
      alive = false;
    };
  }, [shapeAsked]);
  const roomShape =
    blank || song !== null || pictureOn || archiveRead.waiting || src === undefined
      ? null
      : shapeAsked !== null
        ? siteShape !== null && siteShape.url === shapeAsked
          ? siteShape.shape
          : null
        : officialOn || (link !== null && isEmbedKind(link.kind))
          ? WIDE
          : fileShape !== null && fileShape.file === (src ?? null)
            ? fileShape.shape
            : null;
  // Which play is on, too: each new one fits the window again, the same shape included (Luke, 2026-11-20).
  useEffect(() => {
    setRoomPicture(pictureFloats ? null : pictureBox.current, roomShape, entryId);
  }, [roomShape, pictureFloats, entryId]);
  useEffect(() => () => setRoomPicture(null, null), []);
  /** A double press on the picture is the FULL key (Luke, 2026-11-05). Keys on the picture and a canvas being drawn on keep theirs. */
  const fullOnDoublePress = (event: MouseEvent<HTMLDivElement>) => {
    if (blank || song !== null || screen === 'canvas') return;
    if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea') !== null) return;
    toggleFullscreen();
  };

  // `canvasAudio` and `screen` (which screen this viewer has picked) are read further up, beside the bar they hide.
  const visualiserOn = useVisualiserOn(roomId);
  /** The side column's width: the frame's own, or where the reader dragged its edge (`RoomSideGrip`). */
  const sideFrame = roomSide(useRoomSideWidth());
  const crownedIds = new Set(read.crowns.map((crown) => crown.userId));
  const canvasContext: CanvasContext = {
    // A visitor's own room keeps nothing outside this browser: its canvas is to look at, drawing needs an account.
    me: user !== null ? { id: user.id, label: user.displayName } : !visitorRoom && roomGuest !== null && roomGuest.named && room.guestsCanTalk !== false ? { id: roomGuest.id, label: roomGuest.label } : null,
    guest: user === null,
    guests: new Set(members.flatMap((member) => (typeof member.guestId === 'string' ? [member.guestId] : []))),
    askName: user === null && !visitorRoom && live && room.guestsCanTalk !== false && (roomGuest === null || !roomGuest.named) ? () => setNaming(true) : undefined,
    host: { id: room.originalHostId, label: room.originalHostLabel },
    title: `${music ? 'MUSIC' : 'STREAM'} :: ${room.originalHostLabel.toUpperCase()}`,
    amHost: accountHosts,
    live,
    music,
    // Only an ended room is over (SPEC-rooms-perpetual.md: private and live are the same room). Going private once
    // closed the canvas as the old music room's "public off" did, and the drawing went missing (CANVAS, 2026-11-17).
    over: room.endedAt !== null,
    present: accounts.flatMap((member) => (member.userId === null ? [] : [{ id: member.userId, label: member.name, crowned: crownedIds.has(member.userId) }])),
    crowned: crownedIds,
  };

  const stage = (
    <div className={ROOM_STAGE}>
      {/* The picture with its bar under it: the two go fullscreen together. */}
      {/* Fullscreen, the pointer goes with the bar while it is still, as most players do (ROOMBARS). */}
      <div ref={stageRef} className={`${ROOM_SCREEN} ${look === null ? '' : `frame ${lookLines} ${NO_FRAME_FULLSCREEN}`} ${fullscreen && !barAwake ? 'cursor-none' : ''}`}>
      {/* Floating, the box leaves the folded window's invisible frame by staying in it: `visible` and `fixed`. Its top is kept for
          its title strip, deeper on a phone where the strip's keys are the tap size, so nothing sits over the picture (2026-11-08). */}
      <div ref={pictureBox} onDoubleClick={fullOnDoublePress} {...(pictureFloats ? floatDrag.picture : {})} className={`${pictureFloats ? `fixed visible frame bg-ink-plate pt-10 max-sm:pt-14 [&:fullscreen]:pt-0 ${NO_FRAME_FULLSCREEN} select-none` : 'relative'} ${ROOM_PICTURE_BOX} ${dressed ? 'stage-surround' : ''}`} data-room-picture={pictureFloats ? 'floating' : 'in-room'} data-backdrop-press={dressed ? '' : undefined} data-companion-avoid={pictureFloats ? '' : undefined}>
        {blank ? (
          <BlankScreen fit={pictureFit} onPick={(key) => openQueue(key)} hidden={screen !== 'picture'} />
        ) : src === undefined ? (
          <div className={`flex items-center justify-center text-label font-bold text-ink-bar ${pictureFit}`}>
            {catalogue.loading ? 'READING THE CATALOGUE...' : 'THIS FILE IS NOT IN THE CATALOGUE.'}
          </div>
        ) : pictureOn && link !== null ? (
          <div className={`flex flex-col ${pictureFit}`} data-room-picture-held={entryId}>
            {hiddenPicture === entryId ? (
              <p className="flex min-h-0 flex-1 items-center justify-center text-label font-bold text-ink-bar">YOU HID THIS PICTURE.</p>
            ) : (
              <QueuedPicture key={entryId} src={link.url} title={link.title} className="min-h-0 flex-1" roomId={roomId} guest={user === null} />
            )}
            <div className="flex shrink-0 flex-wrap items-center gap-2 bg-ink-plate px-2 py-1 text-label text-ink-bar">
              <span className="font-bold">PICTURE :: HELD</span>
              {mayNextPicture ? (
                <button type="button" className={PLATE_ON_BLACK} onClick={nextFromPicture} aria-label="Next: take the picture off and start what is queued behind it" data-room-picture-next {...explain('Takes the picture off the screen and starts what is queued behind it.', 'A picture holds the screen until someone moves on.')}>
                  [ NEXT ► ]
                </button>
              ) : live ? (
                <span data-room-picture-waiting>WAITING FOR THE HOST</span>
              ) : null}
              <button type="button" className={PLATE_ON_BLACK} onClick={() => setHiddenPicture(hiddenPicture === entryId ? null : entryId)} aria-pressed={hiddenPicture === entryId} {...explain(hiddenPicture === entryId ? 'Shows the picture again.' : 'Hides this picture on your screen only.', 'Everyone else still sees it.')}>
                {hiddenPicture === entryId ? '[ SHOW IT ]' : '[ HIDE ]'}
              </button>
            </div>
          </div>
        ) : songTrack !== null ? (
          <SongCoverCard track={songTrack} fit={pictureFit} />
        ) : archiveRead.waiting ? (
          <div className={`flex items-center justify-center text-label font-bold text-ink-bar ${pictureFit}`} data-room-archive="reading">
            READING THE ARCHIVE...
          </div>
        ) : link !== null && link.kind === 'embed' ? (
          // A server's player is made again on each of the host's PLAYs (`restarts`), so everybody's starts from the top together.
          <OfficialEmbedStage
            key={`official-${entryId}-${serverDriven ? (remoteEntry?.restarts ?? 0) : serverOn ? serverSeen.restarts : 0}`}
            link={link}
            fit={videoFit}
            shaped={dressed}
            autoPlay={amHost && live && room.isPlaying}
            onRemote={(player) => {
              if (entryId === null) return;
              setRemoteEntry({ entryId, restarts: serverOn ? serverSeen.restarts : 0 });
              attachVideo(player);
            }}
            onGone={(gone) => {
              if (videoRef.current === gone) attachVideo(null);
              // Its frame went: a frame made again must say hello again before the room drives it.
              setRemoteEntry((held) => (held !== null && held.entryId === entryId ? null : held));
            }}
            onTime={onTime}
            onBlocked={blockedByPlayer}
            onPlaying={() => setNeedsPress(false)}
          />
        ) : link !== null && isEmbedKind(link.kind) ? (
          <EmbedStage
            key={`embed-${entryId}`}
            link={link}
            fit={videoFit}
            shaped={dressed}
            // Only while the room says it plays: a paused room's window opened (or brought back folded after a reload, list 4) stays paused.
            autoPlay={amHost && live && room.isPlaying}
            onPlayer={attachVideo}
            onGone={(gone) => {
              if (videoRef.current === gone) attachVideo(null);
            }}
            onTime={onTime}
            onPlaying={(player) => {
              setNeedsPress(false);
              setLiveEntry(player.isLive ? entryId : null);
              // It plays after all (the site's own RELOAD, a slow start): the room no longer calls it dead, so nothing skips it.
              setDeadEntry((dead) => (dead === entryId ? null : dead));
              setStreamPlayedEntry(entryId);
            }}
            onError={(why) => {
              setOfflineEntry(why === 'offline' ? entryId : null);
              setDeadEntry(entryId);
            }}
            onBlocked={blockedByPlayer}
            role={amHost ? 'host' : 'viewer'}
          />
        ) : (
          <video
            // Files share one element (the next play may be the same file, nothing to reload); each stream
            // gets its own, so a library tidying up after itself never touches the next play's element.
            key={playsDirectly(link) ? 'direct' : `stream-${entryId}`}
            ref={attachVideo}
            // Asked so the visualiser may hear it, only where the host allows that (lib/watch/audio-tap.ts); before `src`.
            crossOrigin={playsDirectly(link) && typeof window !== 'undefined' && analysableSrc(src, window.location.origin) ? 'anonymous' : undefined}
            src={playsDirectly(link) ? src : undefined}
            preload="auto"
            playsInline
            // Only while the room says it plays (as the embeds above).
            autoPlay={amHost && live && room.isPlaying}
            onTimeUpdate={onTime}
            onLoadedMetadata={(event) => {
              const shape = shapeFrom(event.currentTarget.videoWidth, event.currentTarget.videoHeight);
              if (shape !== null) setFileShape({ file: src ?? null, shape });
              onTime();
            }}
            onPlay={onTime}
            onPause={onTime}
            // Playing again (the next file after one that would not start) clears the JOIN PLAYBACK key.
            onPlaying={() => setNeedsPress(false)}
            onError={(event) => {
              // A host that turned down the visualiser's way of asking: load it again plainly before calling it dead.
              const element = event.currentTarget;
              if (element.getAttribute('crossorigin') !== null) {
                const at = element.currentTime;
                element.removeAttribute('crossorigin');
                element.load();
                if (at > 0) element.currentTime = at;
                return;
              }
              if (link !== null) setDeadEntry(entryId);
            }}
            className={`object-contain ${videoFit}`}
            // Its bars trimmed: the element is the shape of what is left and shows only that part of its picture.
            style={dressed ? (pictureStyle(ownShape, ownTrim) as CSSProperties) : undefined}
            data-backdrop-solid={dressed ? '' : undefined}
            data-stage-trim={dressed && hasTrim(ownTrim) ? `${ownTrim.x} ${ownTrim.y}` : undefined}
            data-watch-video={amHost ? 'host' : 'viewer'}
          >
            <track kind="captions" />
          </video>
        )}
        {linkDead ? (
          // Over another site's player the note sits at the top and lets every press through (LIVE TWITCH2000, Luke 2026-11-17: Twitch's
          // "network error (Error #2000)" with its own RELOAD key under a note that covered it): the site's own message and key stay
          // readable and pressable. Our own video's note stays in the middle.
          <div className={`pointer-events-none absolute inset-0 z-20 flex justify-center ${link !== null && (isEmbedKind(link.kind) || link.kind === 'embed') ? 'items-start pt-2' : 'items-center'}`} data-watch-dead>
            <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert" data-watch-offline={offlineChannel ?? undefined}>
              {offlineChannel !== null
                ? `${offlineChannel.toUpperCase()} IS OFFLINE`
                : signInGate
                  ? 'TWITCH ONLY SHOWS THIS STREAM AFTER YOU SIGN IN TO TWITCH'
                  : twitchPage !== null
                    ? 'TWITCH COULDN\u2019T START THIS STREAM HERE'
                    : 'THIS LINK WON\u2019T PLAY HERE'}
              {/* Twitch's network error (#2000) is its player failing to reach its stream: often an ad blocker, a VPN or a filtering DNS on
                  the viewer's side. Its own page may still play it. */}
              {offlineChannel === null && twitchPage !== null ? (
                <>
                  {' '}
                  <a href={twitchPage} target="_blank" rel="noopener noreferrer" className="pointer-events-auto underline" data-watch-twitch-page {...explain('Opens this channel on Twitch itself.', 'For when the stream will not play here.', NOTE.leaves)}>
                    [ WATCH ON TWITCH ↗ ]
                  </a>
                </>
              ) : null}
            </p>
          </div>
        ) : null}
        {/* Over Twitch's own "log in to continue" (its link in the middle stays pressable): why, and the two ways on. */}
        {signInGate && !linkDead ? <TwitchSignInNote channelPage={twitchPage} place="stage" linkClass="pointer-events-auto underline" /> : null}
        {needsPress && live && !linkDead ? (
          // Only the key takes the press. Over an embedded site's player it sits at the foot, so the site's own
          // play key in the middle stays in view and in reach: a phone may only start YouTube from there.
          <div
            className={`pointer-events-none absolute inset-0 z-20 flex justify-center ${
              link !== null && isEmbedKind(link.kind) ? 'items-end pb-3' : 'items-center'
            }`}
          >
            <button type="button" onClick={joinPlayback} className={`${JOIN_KEY} pointer-events-auto`} data-watch-join {...explain('Starts the room\'s video on your screen, in step with everyone else.', 'Browsers won\'t play sound until you press something; this is that press.')}>
              [ ▶ JOIN PLAYBACK ]
            </button>
          </div>
        ) : null}
        {/* This device is not yet in step with the one it follows (loading, waking, jumping): said, not pressed. */}
        {liningUp && live && !amHost && !needsPress && !linkDead ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center pt-3" data-watch-lining-up>
            <span className="bg-ink-plate px-2 text-label text-sun">LINING UP</span>
          </div>
        ) : null}
        {/* The browser is holding this device's sound (sound-gate.ts): it plays muted and in step. Any press on the page brings
            the sound; this says so, and is something to press. */}
        {soundHeld && live && !needsPress && !linkDead && (videoElement !== null || song !== null) ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center pb-3">
            <span className="pointer-events-auto bg-ink-plate">
              <button type="button" className={PLATE_ON_BLACK} onClick={noticePress} data-watch-sound-waiting {...explain('Turns the sound on here. Pressing anything else on the page does the same.', 'Your browser, not this site, is holding this device\'s sound until you press something. It is already in step.')}>
                [ SOUND IS WAITING ]
              </button>
            </span>
          </div>
        ) : null}
        {/* This viewer's music visualiser (Luke, 2026-11-11): hears the bar's song or the room's own player's file. */}
        {visualiserOn ? (
          <RoomVisualiser roomId={roomId} element={song !== null ? player.audioElement() : videoElement instanceof HTMLMediaElement ? videoElement : null} />
        ) : null}
        {visitorRoom ? null : <RoomCanvas roomId={roomId} context={canvasContext} visible={screen === 'canvas'} />}
        {/* The owner's own PC screen (SPEC-screens.md, phase 3): drawn, and connected, only while it is the chosen view. */}
        {screen === 'screen' ? <RoomScreen roomId={roomId} audio={canvasAudio && !visitorRoom} /> : null}
        <RoomCornerKeys box={pictureBox}>
          <VisualiserToggle roomId={roomId} audio={canvasAudio} />
          {visitorRoom ? null : <CanvasToggle roomId={roomId} audio={canvasAudio} />}
          <ScreenToggle roomId={roomId} audio={canvasAudio && !visitorRoom} />
          {visitorRoom ? null : <SeenTogether roomId={roomId} />}
        </RoomCornerKeys>
        {/* Only over the picture itself, never over the canvas or the PC's screen in its place. */}
        {screen === 'picture' ? pictureBar : null}
        {pictureFloats ? <RoomFloatChrome host={pictureBox} drag={floatDrag} title={entryTitle ?? (music ? 'ROOM' : 'STREAM')} /> : null}
        {/* Fullscreen: the chosen background, live, under everything in this box. Last in the box, so nothing before it is moved. */}
        {dressed ? <StageBackdrop /> : null}
        {/* `[ BKG ]`, in the corner of whatever is fullscreen: on or off, it is the way to the other. */}
        {staged ? <StageKey /> : null}
      </div>
      {playerBar}
      </div>

      {notice === null ? null : <p className="w-fit bg-acid px-1 text-label font-bold text-ink-plate" role="status">{notice}</p>}
      {fault === null ? null : (
        <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          {fault}
        </p>
      )}
      {room.forumThreadId === null && live && announced ? (
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
            <span className={`relative flex min-w-0 flex-1 gap-2 frame bg-hardware px-2 py-1 text-label ${lookLines}`} data-stream-bar-screen data-bar-led>
              {/* The music bar's sound graph behind these words too (list 4: "not always appearing in the black in the bottom
                  player bar"); its colours keep the site theme's words 4.5:1, so not under a room's own look. */}
              {look === null ? <SoundGraph /> : null}
              <span className="relative block min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2 font-bold text-ink-bar">
                <span className={`shrink-0 px-1 ${live ? 'bg-acid text-ink-plate' : 'bg-bubble-pale text-ink-bar'}`}>{music ? (!live ? 'CLOSED' : room.isPublic ? 'LIVE' : accountHosts ? 'PRIVATE' : 'BY LINK') : live ? 'LIVE' : 'ENDED'}</span>
                <span className="truncate">
                  {music ? 'ROOM' : 'STREAM'} :: {accountHosts ? 'YOU ARE HOSTING' : music ? `${hostName.toUpperCase()} IS PLAYING` : `HOSTED BY ${hostName.toUpperCase()}`}
                </span>
              </span>
              <MarqueeText className={`block text-key font-bold ${look === null ? 'text-acid' : 'text-room-readout'}`} text={blank ? 'NOTHING ON' : (entryTitle ?? '...')} />
              <MarqueeText className="block leading-readout-tight text-ink-bar" durationSeconds={22} text={barCaption} />
              {hasTransport ? (
                <span className="mt-1 flex min-w-0 items-center gap-2 text-ink-bar">
                  {seekLine}
                  {timeMark}
                </span>
              ) : serverOn ? (
                <span className="mt-1 flex min-w-0 items-center text-ink-bar">
                  <ServerClock room={room} />
                </span>
              ) : null}
              </span>
              {/* While a video plays: the little TV, at the right of the black (SPEC-player-tv.md). */}
              <PlayerTv />
            </span>
            {/* `relative`: QUALITY and SUBS open their lists over their keys, above the bar. */}
            <span className={`relative flex shrink-0 flex-wrap items-center gap-1 frame bg-hardware px-1 py-0.5 text-label text-sun ${lookLines} ${lookKeys}`} data-watch-bar="music">
              {playKey}
              {devicesHold}
              {skipKey}
              {pictureKeys}
              <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-haspopup="dialog" onClick={() => openQueue()} data-stream-bar-queue {...explain('Opens the room\'s queue: what plays next.', 'Search, add and see what is waiting. Who may add is set in the room settings.')}>
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
    <div className={sideFrame.className} style={sideFrame.style as CSSProperties | undefined}>
      {/* The edge between the picture and this column: dragged, the chat is wider or narrower (Luke, 2026-11-16). */}
      <RoomSideGrip />
      {/* One key for the queue window, where everything is added and seen (Luke, 2026-11-02). */}
      <div className={TITLE_BAR}>
        <button type="button" className={`${TITLE_BAR_BUTTON} max-sm:min-h-tap`} aria-haspopup="dialog" onClick={() => openQueue()} data-watch-queue-key {...explain('Opens the room\'s queue: what plays next.', 'Search, add and see what is waiting. Who may add is set in the room settings.')}>
          [ QUEUE ]
        </button>
        {/* A signed-out visitor's own room has a cog too: its END ROOM, and LOG IN for going live. */}
        {(user !== null && mayEditRoom(room, read.crowns, user.id, live)) || (visitorRoom && mainRoomHost) ? (
          <button type="button" className={`${TITLE_BAR_BUTTON} max-sm:min-h-tap`} aria-haspopup="dialog" aria-label="Room settings" title="Room settings" {...explain('Opens the room settings: its name, topic, who can join, who can add, and more.', 'Only the host and people they crowned have this key.')} onClick={() => setSettingsOpen(true)} data-room-settings-key>
            [ {ROOM_COG} ]
          </button>
        ) : null}
      </div>
      {room.topic === null ? null : (
        <p className="truncate text-label font-bold text-ink" title={room.topic} data-room-topic-line>
          {room.topic}
        </p>
      )}
      {user !== null && !accountHosts ? (
        <LookToggle compact choice={myChoice} onChange={(next) => void saveLookChoice(user.id, next).catch(() => undefined)} />
      ) : null}
      {/* A visitor's browser id is no account: the crawl names only what is on. */}
      <StreamCrawl accounts={visitorRoom ? [] : accounts} hostId={hostId} currentTitle={blank ? 'NOTHING ON' : (entryTitle ?? '...')} nextTitle={nextTitle} />
      {visitorRoom ? (
        // A signed-out visitor's own room is kept in this browser: nobody can join it, so there is nobody to chat with.
        <aside aria-label="Who is here" className={`${ROOM_SIDE_BODY} frame p-2 text-label text-ink sm:overflow-y-auto`} data-visitor-room-alone>
          <p className="text-key font-bold">JUST YOU HERE</p>
          <p>This room is kept in this browser. Nobody else can see it or join it.</p>
          <p className="mt-1">
            <Link href="/account" className={PLATE_LINK} {...explain('Goes to the ACCOUNT page to log in or make an account.', 'Signed in, your room can go live for other people to join and chat in.')}>
              [ LOG IN ]
            </Link>{' '}
            TO SHARE ITS LINK, CHAT WITH WHO JOINS, AND GO LIVE.
          </p>
        </aside>
      ) : (
        <ChatPanel
          read={read}
          item={item}
          videoRef={videoRef}
          live={live}
          nextTitle={live ? nextTitle : null}
          notInStep={live && officialOn && !archiveRead.waiting && entryId !== null ? { entryId, text: notInStepNote(serverOn) } : null}
        />
      )}
      {queueOpen ? (
        <StreamQueueWindow
          read={read}
          itemsById={itemsById}
          live={live}
          userId={me?.id ?? null}
          members={members}
          nowLive={stageLive}
          onClose={() => setQueueOpen(false)}
          prefill={queuePrefill}
          inRoom
          look={look}
        />
      ) : null}
      {naming && user === null ? <GuestWindow onNamed={() => setNaming(false)} onClose={() => setNaming(false)} /> : null}
      {devicesOpen && devicesKeyOn && myDeviceId !== null ? (
        <RoomDevicesWindow
          thisName={ownDevices.name}
          heldBy={ownDevices.book.heldMuted === null ? undefined : ownDevices.book.heldMuted.by}
          rows={ownDevices.here.map((device) => ({ deviceId: device.deviceId, name: device.name, mode: ownDevices.book.devices[device.deviceId]?.mode ?? null, muted: device.held }))}
          hosting={accountHosts}
          hostName={hostName}
          keepers={Object.fromEntries(ownDevices.here.map((device) => [device.deviceId, ownDevices.book.devices[device.deviceId]?.keeper === myDeviceId]))}
          onMode={chooseDeviceMode}
          onMute={ownDevices.muteDevice}
          onRename={ownDevices.rename}
          onUnholdSelf={ownDevices.unholdSelf}
          onClose={() => setDevicesOpen(false)}
        />
      ) : null}
      {settingsOpen && visitorRoom && mainRoomHost ? (
        <VisitorRoomSettings room={room} onLeft={onLeft} onClose={closeSettings} />
      ) : settingsOpen && user !== null && mayEditRoom(room, read.crowns, user.id, live) ? (
        <RoomSettingsWindow
          room={room}
          userId={user.id}
          look={look}
          onClose={closeSettings}
          liveSection={mainRoomHost ? <MainRoomLiveSection room={room} hostName={hostName} /> : undefined}
          endSection={mainRoomHost ? <MainRoomEndSection room={room} onLeft={onLeft} /> : undefined}
          askedLive={askedLive}
        />
      ) : null}
    </div>
  );

  return (
    <div className={ROOM_ROOT}>
      {musicBarPart}
      {ended ? (
        <p className="text-label font-bold text-ink" role="status">
          {music ? 'THIS ROOM IS CLOSED.' : room.endedAt === null ? 'THIS STREAM WENT QUIET.' : 'STREAM ENDED.'}{' '}
          {room.forumThreadId === null ? null : (
            <Link href={`/forum#${threadDomId(room.forumThreadId)}`} className="key px-1 py-1 text-label" {...explain('Goes to this room\'s record on the forum.', 'What played and what was said, kept after the room ends.')}>
              [ READ THE RECORD ]
            </Link>
          )}
        </p>
      ) : null}

      {closing && accountHosts && live && !myOtherTab && !music ? (
        <div className="flex flex-wrap items-center gap-2" role="alertdialog" aria-label="Leave the stream">
          <span className="text-label font-bold text-ink">{heir !== null ? `LEAVE? ${heir.name.toUpperCase()} WILL HOST.` : 'NOBODY ELSE IS HERE. END THE STREAM?'}</span>
          {heir !== null ? (
            <button type="button" disabled={leaving} className={PLATE} {...explain('Leaves the stream and hands it on: someone else becomes the host and it carries on.', 'The room keeps going without you.')} onClick={() => void leave('handover')}>
              [ LEAVE ]
            </button>
          ) : null}
          <button type="button" disabled={leaving} className={PLATE} {...explain('Ends the stream for everybody as you leave.', 'Everyone is sent out; the record stays on the forum.', "CAN'T BE UNDONE.")} onClick={() => void leave('end')}>
            [ END STREAM ]
          </button>
          <button type="button" disabled={leaving} className={PLATE} {...explain('Stays in the stream: nothing changes.', 'Closes this question.')} onClick={onStay}>
            [ STAY ]
          </button>
        </div>
      ) : null}

      <CanvasSaveAsk roomId={roomId} reason="close" />

      {/* One tree at every width, so the video element is never rebuilt when the layout changes (a phone
          turned, a window resized): the host's listeners are on that element, and a rebuilt one played on
          without them - no loop, no pause written. Only the side column changes. */}
      <div className={ROOM_COLUMNS}>
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
  notInStep,
}: {
  read: WatchRoomRead;
  item: MediaItem | undefined;
  videoRef: React.RefObject<Playable | null>;
  live: boolean;
  /** What plays next, announced in this chat every couple of minutes; null says nothing. */
  nextTitle: string | null;
  /** A play the room can't keep in step (a platform's or a server's own player): its line, said once per play. */
  notInStep: { entryId: string; text: string } | null;
}) {
  const identity = useRoomIdentity();
  const repository = getWatchRepository();
  const forum = useForum();
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

  // The room's own lines, in this browser only: never sent, never on the board or in the record. UP NEXT every two minutes
  // (once a minute until 2026-11-08), and not again while it would only repeat the line above it (Luke: "a bit less frequent").
  const [notes, setNotes] = useState<RoomNote[]>([]);
  const upNext = useEffectEvent(() => ({ title: nextTitle, lastSaid: read.messages[read.messages.length - 1]?.createdAt ?? '' }));
  useEffect(() => {
    const timer = window.setInterval(() => {
      const { title, lastSaid } = upNext();
      if (title === null) return;
      const at = new Date().toISOString();
      setNotes((kept) => (upNextRepeats(kept, title, lastSaid) ? kept : [...kept, { id: `up-next-${at}`, at, kind: 'next' as const, text: title }].slice(-UP_NEXT_KEPT)));
    }, UP_NEXT_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);
  // A play the room can't keep in step says so once, as it comes on (Luke, 2026-11-08), in place of a line under the picture.
  const stepEntry = notInStep?.entryId ?? null;
  const stepText = notInStep?.text ?? '';
  useEffect(() => {
    if (stepEntry === null) return;
    // On the next turn, as the UP NEXT timer's lines are: the effect only says when.
    const timer = window.setTimeout(() => {
      const at = new Date().toISOString();
      setNotes((kept) => (kept.some((note) => note.id === notInStepId(stepEntry)) ? kept : [...kept, { id: notInStepId(stepEntry), at, kind: 'step' as const, text: stepText }].slice(-UP_NEXT_KEPT)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [stepEntry, stepText]);

  // A blocked person's lines and other people's hidden ones are left out (SPEC-moderation.md); a moderator's hide anywhere, or a
  // block, reads the room again, since a line that just became unreadable sends no live change of its own.
  const moderation = useModeration();
  const { shows, version: moderationVersion } = moderation;
  const roomIdForModeration = read.room.id;
  useEffect(() => {
    if (moderationVersion > 0) applyLocalChange(roomIdForModeration, { kind: 'refresh' });
  }, [moderationVersion, roomIdForModeration]);
  const lines = useMemo(() => {
    const said = read.messages.filter((message) => shows('room_line', message.id, message.authorId, message.hidden)).map((message) => ({ at: message.createdAt, message, note: null }));
    const told = notes.map((note) => ({ at: note.at, message: null, note }));
    return [...said, ...told].sort((a, b) => a.at.localeCompare(b.at));
  }, [read.messages, notes, shows]);
  const count = lines.length;

  // The newest line stays in view as lines arrive.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [count]);

  /**
   * Room chat on DISCUSS (SPEC-room-chat-discuss.md): said over a MEDIA or KINO result, the line shows on that result's DISCUSS
   * page, and the first one files its forum thread when nobody has commented yet, so it is on the board (credited to the site,
   * as every thread an item files). An account's line only: a guest can't start a board thread. A thread somebody else filed
   * a moment before is not an error.
   */
  function fileDiscussThread(speakerId: string) {
    const entry = read.queue.find((candidate) => candidate.id === read.room.currentEntryId);
    if (identity?.kind !== 'account' || identity.id !== speakerId || read.room.chatOnDiscuss === false) return;
    if (entry === undefined || typeof entry.webRef !== 'string' || entry.webRef.length === 0) return;
    const anchor = webAnchor({ id: entry.webRef, title: entry.link?.title ?? entry.webRef });
    if (forum.threadForAnchor(anchor) !== undefined) return;
    void forum.createThread({ title: autoThreadTitle(anchor), body: AUTO_FILED_BODY, anchor }).catch(() => undefined);
  }

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
      // An outside picture you sent shows for you at once, as one you pasted into a queue does (`outside-pictures.ts`).
      const picture = chatPicture(body, false);
      if (picture !== null && picture.outside) noteAddedHere(picture.url);
      applyLocalChange(read.room.id, { kind: 'message', message });
      fileDiscussThread(speaker.id);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'THE MESSAGE WAS NOT SENT.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={ROOM_SIDE_BODY}>
      <ol ref={listRef} className="max-h-72 min-h-24 overflow-y-auto text-prose text-ink sm:max-h-none sm:min-h-0 sm:flex-1" aria-label="Chat" aria-live="polite">
        {count === 0 ? <li className="text-label text-ink-quiet">NOTHING SAID YET.</li> : null}
        {lines.map((line) =>
          line.message !== null ? (
            <ChatLine key={line.message.id} message={line.message} roomId={read.room.id} viewerGuest={identity?.kind !== 'account'} />
          ) : (
            line.note.kind === 'step' ? (
              <li key={line.note.id} className="rule-pixel py-1 text-label font-bold text-ink" data-watch-not-in-step>
                {line.note.text}
              </li>
            ) : (
              <li key={line.note.id} className="rule-pixel py-1 text-label font-bold text-ink-quiet" data-watch-up-next>
                UP NEXT :: {line.note.text}
                <LanguageFlag tag={detectLanguage(line.note.text)} className="ml-1.5" />
              </li>
            )
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
          <Link href="/account" className="key px-1 py-1 text-label" {...explain('Goes to the ACCOUNT page to log in or make an account.', 'In this room, guests may only watch; an account can talk.')}>
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
            {/* Character voices (SPEC-character-speech.md, PROFILE's key): each person's companion says what they type
                here. The key is made for a strip that is Black in both themes, and this row is the window's own colour,
                so it sits in a black recess of its own, as the bar's keys do. */}
            <span className="flex shrink-0 items-center frame bg-hardware px-0.5 py-0.5">
              <SpeechAudioKey />
            </span>
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
                  {...explain('Opens emotes, GIFs, stickers and pictures to send in the chat.', 'Pick one and it is sent to the room\'s chat.')}
                  onClick={() => setShelf((open) => (open !== null ? null : identity?.kind === 'account' ? 'gif' : 'emote'))}
                >
                  GIF
                </button>
                <button type="submit" disabled={busy || draft.trim().length === 0} className={PLATE} aria-label="Send" title="Send" data-watch-send {...explain('Sends your message to the room\'s chat.', 'Enter does the same.', NOTE.others)}>
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
            {...explain(`Shows the ${entry.label.toLowerCase()} to send.`, 'Search for one with the box below.')}
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
                    <button type="button" onClick={() => onEmote(emoticon.text)} className={`${PLATE} font-mono`} title={emoticon.about} {...explain(`Sends ${emoticon.text} to the chat.`, emoticon.about, NOTE.others)}>
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
            <button type="submit" className={PLATE} disabled={words.trim().length === 0 || state.kind === 'searching'} {...explain('Searches for what you typed.', 'The results show below; press one to send it.')}>
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
                        {...explain('Sends this to the room\'s chat.', canvasOpen ? 'Or drag it onto the canvas.' : 'Everyone in the room sees it.', NOTE.others)}
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

/**
 * What a chat line says: its words, or the one GIPHY / Commons picture it links to, hotlinked from there. In the room's own
 * chat (`roomId`), any other picture address is drawn as a picture too (ROOMSYNC: "rather than sending the text of the
 * url"), by the queue's own rules for an outside picture: covered with SHOW unless this viewer said otherwise.
 */
function MessageBody({ message, roomId = null, viewerGuest = true }: { message: WatchMessage; roomId?: string | null; viewerGuest?: boolean }) {
  const body = message.body;
  // Pictures are for accounts (SPEC-guests.md). The database writes a guest's name, so a guest's line always says so, however it is spelled.
  const guest = isGuestLabel(message.authorLabel);
  const picture = guest ? null : chatImageUrl(body);
  // A picture the host has taken down reads as its link rather than a blank.
  const [gone, setGone] = useState(false);
  if (picture === null && roomId !== null) {
    const other = chatPicture(body, guest);
    if (other !== null) return <QueuedPicture src={other.url} title={pictureHost(other.url).toUpperCase() || 'A PICTURE'} className="mt-0.5 max-h-48" roomId={roomId} guest={viewerGuest} />;
  }
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
function ChatLine({ message, roomId, viewerGuest }: { message: WatchMessage; roomId: string; /** Not an account: an outside picture is always asked first (`outside-pictures.ts`). */ viewerGuest: boolean }) {
  const author = messageAuthor(message);
  const moderation = useModeration();
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
          {/* REPORT the speaker, carrying the line (SPEC-moderation.md): a small flag, for accounts only. */}
          <ReportKey
            target={{ accountId: message.authorId, name: author.displayName, context: { kind: 'room_line', id: message.id, text: message.body } }}
            label="⚑"
            className={`${PLATE} shrink-0`}
          />
        </span>
        <MessageBody message={message} roomId={roomId} viewerGuest={viewerGuest} />
        <HiddenNote mark={moderation.markFor('room_line', message.id, message.hidden)} authorId={message.authorId} />
        <HideControl kind="room_line" id={message.id} authorId={message.authorId} text={message.body} mark={moderation.markFor('room_line', message.id, message.hidden)} />
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
function OfficialEmbedStage({
  link,
  fit,
  shaped,
  autoPlay = false,
  onRemote,
  onGone,
  onTime,
  onBlocked,
  onPlaying,
}: {
  link: WatchLink;
  fit: string;
  /** Fullscreen: a 16:9 box with the background round it (this player never says its video's shape). */
  shaped: boolean;
  /** A server's player that can be driven starts playing when it is handed over (the room plays, and this device leads). */
  autoPlay?: boolean;
  /** The server's frame said it can be driven (`jellyfin-player.ts`): its player, for the room's sync. */
  onRemote?: (player: EmbedPlayable) => void;
  onGone?: (player: EmbedPlayable) => void;
  onTime?: () => void;
  onBlocked?: () => void;
  onPlaying?: () => void;
}) {
  // A configured media server's own player page (SPEC-media-servers.md): played with that server's sandbox. The host
  // match also re-proves it is still a configured server, so a de-configured server's old queue link stops playing.
  const server = mediaServerForUrl(link.url);
  const frameRef = useRef<HTMLIFrameElement>(null);
  /** The frame said hello: the room drives it (shown on the frame for checks, `data-server-remote`). */
  const [driven, setDriven] = useState(false);
  const serverOrigin = server === undefined ? null : new URL(server.base).origin;
  const startsPlaying = useEffectEvent(() => autoPlay);
  const give = useEffectEvent((player: EmbedPlayable) => onRemote?.(player));
  const take = useEffectEvent((player: EmbedPlayable) => onGone?.(player));
  const tick = useEffectEvent(() => onTime?.());
  const block = useEffectEvent(() => onBlocked?.());
  const started = useEffectEvent(() => onPlaying?.());
  // The server's own page says hello when its bridge lets the room drive it (Luke, 2026-11-27, 3A): from then on it is driven like
  // YouTube's player. Until then, and for a server that never says it, it plays as it always has.
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null || serverOrigin === null) return;
    let player: JellyfinPlayable | null = null;
    const onTick = () => tick();
    const onBlock = () => block();
    const onPlay = () => started();
    const listen = (event: MessageEvent) => {
      if (player !== null || !isJellyfinHello(event, frame, serverOrigin)) return;
      const made = new JellyfinPlayable(frame, serverOrigin, startsPlaying());
      player = made;
      setDriven(true);
      for (const type of ['timeupdate', 'loadedmetadata', 'play', 'pause']) made.addEventListener(type, onTick);
      made.addEventListener('blocked', onBlock);
      made.addEventListener('playing', onPlay);
      give(made);
    };
    window.addEventListener('message', listen);
    return () => {
      window.removeEventListener('message', listen);
      if (player === null) return;
      player.destroy();
      take(player);
    };
  }, [serverOrigin]);
  const checked = server !== undefined ? link.url : officialEmbedUrl(link.url);
  // A PeerTube player is asked to start with English subtitles on foreign audio (SPEC-subtitles.md): its own
  // menu is the way to change them, since the room cannot drive this player. Added after the check, never stored.
  const url = checked !== null && server === undefined && new URL(checked).pathname.startsWith('/videos/embed/') ? quietPeerTube(withEnglishSubtitles(checked, 'peertube', detectLanguage(link.title))) : checked;

  if (url === null) {
    return (
      <div className={`flex items-center justify-center text-label font-bold text-ink-bar ${fit}`}>
        THIS LINK WON&apos;T PLAY HERE
      </div>
    );
  }

  // A server's player may start by itself when the host's PLAY makes it again, as on the MEDIA page.
  const allowed = server !== undefined ? 'autoplay; fullscreen' : 'fullscreen';

  // What this player does and doesn't share is said once in the chat (`notInStepNote`), never over or under the picture (Luke, 2026-11-08).
  return (
    <div className={`flex flex-col ${fit}`} style={shaped ? (stageStyle(WIDE) as CSSProperties) : undefined} data-backdrop-solid={shaped ? '' : undefined}>
      <iframe
        ref={frameRef}
        src={url}
        title={`Player: ${link.title}`}
        referrerPolicy="no-referrer"
        sandbox={server !== undefined ? playerSandbox(server) : WEB_EMBED_SANDBOX}
        // No fullscreen of the player's own where the room's FULL works (`withoutFullscreen`): that one shows the background.
        allow={siteFullscreenWorks() ? withoutFullscreen(allowed) : allowed}
        className="min-h-0 w-full flex-1 bg-paper"
        data-watch-embed={server !== undefined ? 'server' : 'embed'}
        data-server-remote={driven ? 'on' : undefined}
      />
    </div>
  );
}

/**
 * A PeerTube player in a room, asked (its documented embed options) to leave out its title line, its warning line and its
 * PeerTube link (Luke, 2026-11-16: "i need the embedded players ui to not be shown inside the room viewport"). Its play bar
 * stays: the room cannot drive a PeerTube player, so it is the only way to start or pause it. Added after the check, never stored.
 */
function quietPeerTube(embed: string): string {
  const url = new URL(embed);
  for (const name of ['title', 'warningTitle', 'peertubeLink']) url.searchParams.set(name, '0');
  return url.toString();
}

/** The room's place in a server's player, by the host's beat: redrawn each second on its own, not the whole room. */
function ServerClock({ room }: { room: WatchRoomRead['room'] }) {
  const now = useNow(1000);
  return (
    <span className="shrink-0 tabular-nums" data-server-clock>
      ROOM AT {formatMediaTime(serverElapsed(room, now))}
    </span>
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
  shaped,
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
  /** Fullscreen: the box is the video's own shape, with the background round it. */
  shaped: boolean;
  /** The box's shape, from the room: its own 16:9 on a phone, the stage's height on a desktop. */
  fit: string;
  autoPlay: boolean;
  onPlayer: (player: Playable) => void;
  onGone: (player: Playable) => void;
  onTime: () => void;
  onPlaying: (player: EmbedPlayable) => void;
  /** `why`: the site's own refusal, when it said one (`offline`: a Twitch channel that is not broadcasting). */
  onError: (why: EmbedRefusal | null) => void;
  /** The browser would not start it without a press. */
  onBlocked: () => void;
  role: 'host' | 'viewer';
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Read when the player is made, not a reason to make it again.
  const startsPlaying = useEffectEvent(() => autoPlay);
  const time = useEffectEvent(() => onTime());
  const playing = useEffectEvent((player: EmbedPlayable) => onPlaying(player));
  const failed = useEffectEvent((why: EmbedRefusal | null) => onError(why));
  const blocked = useEffectEvent(() => onBlocked());
  const give = useEffectEvent((player: EmbedPlayable) => onPlayer(player));
  const take = useEffectEvent((player: EmbedPlayable) => onGone(player));
  const { url, kind } = link;
  /** The video's true shape, asked of its site once (`video-shape.ts`); 16:9 until it answers, and where it never does. */
  const [shape, setShape] = useState(WIDE);
  /** Its black bars, from its site's stills (`bar-watch.ts`); null until they answer, and where there are none. */
  const [bars, setBars] = useState<FrameBars | null>(null);
  const made = useRef<EmbedPlayable | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const player = createEmbed({ url, kind, title: '' }, box, startsPlaying());
    if (player === null) {
      failed(null);
      return;
    }
    const onTick = () => time();
    const onPlay = () => playing(player);
    const onFail = () => failed(player.refusal ?? null);
    const onBlock = () => blocked();
    player.addEventListener('blocked', onBlock);
    for (const type of ['timeupdate', 'loadedmetadata', 'play', 'pause']) player.addEventListener(type, onTick);
    player.addEventListener('playing', onPlay);
    player.addEventListener('error', onFail);
    give(player);
    made.current = player;
    let alive = true;
    void videoShape(url).then((found) => {
      if (alive && found !== null) setShape(found);
    });
    void stillBars(url).then((found) => {
      if (alive) setBars(found);
    });
    return () => {
      alive = false;
      made.current = null;
      take(player);
      player.destroy();
      box.replaceChildren();
    };
  }, [url, kind]);

  // Fullscreen with bars found, a player that lays its own frame out (YouTube's, `setFit`) is the shape its stills picture
  // with the bars hung outside the box; otherwise it is the video's own shape, whole. Only YouTube's is trimmed in a room:
  // Vimeo's and Twitch's players lay themselves out.
  const trims = kind === 'youtube';
  const base = shaped && trims && bars !== null ? bars.base : shape;
  const trimX = shaped && trims && bars !== null ? bars.trim.x : 0;
  const trimY = shaped && trims && bars !== null ? bars.trim.y : 0;
  useEffect(() => {
    made.current?.setFit?.({ base, x: trimX, y: trimY });
  }, [base, trimX, trimY, url, kind]);

  return (
    <div
      ref={boxRef}
      className={fit}
      style={shaped ? (stageStyle(trimmedShape(base, { x: trimX, y: trimY })) as CSSProperties) : undefined}
      data-backdrop-solid={shaped ? '' : undefined}
      data-stage-trim={trimX > 0 || trimY > 0 ? `${trimX} ${trimY}` : undefined}
      data-watch-video={role}
      data-watch-embed={kind}
    />
  );
}
