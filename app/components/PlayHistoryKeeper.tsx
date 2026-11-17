'use client';

import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { lengthSeconds } from '../lib/audio/track-context';
import { accountName, loadAccountNames } from '../lib/history/names';
import { historyAccountChanged, notePlay, takePlayContext, type PlayHandle } from '../lib/history/plays';
import type { PlayHow, PlayNote } from '../lib/history/types';
import { floatingState } from '../lib/ui/floating-player';
import { twitchOf, youtubeIdOf } from '../lib/watch/links';
import { ownRoomState, subscribeToOwnRoom } from '../lib/watch/own-room-client';
import { isSongLink } from '../lib/watch/songs';
import type { WatchQueueEntry, WatchRoom } from '../lib/watch/types';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import { subscribeToWatchWindow, watchHref, watchWindowServerState, watchWindowState } from '../lib/watch/watch-window';
import { useAuth } from './AuthProvider';
import { useMusicPlayer, type MusicPlayerValue } from './MusicPlayerProvider';

/**
 * HISTORY's ears (SPEC-history.md, Luke 2026-11-17). Draws nothing.
 *
 * Since the perpetual room (SPEC-rooms-perpetual.md) everything the bar or the room's screen plays is a row in a room's
 * queue: your own room, or the live room you are in. So one thing is watched: **the room you are hearing moved on to a new
 * row while playing**. That row is one play (answer 1B: it started playing for you), with who added it from the row.
 * How it reached you comes from, in order: a letter, post or comment that said so as its PLAY was pressed
 * (`armPlayContext`); the bar's own record of where a song was pressed (`heardFrom`: a profile, a playlist, MEDIA...);
 * whose room it is and who added the row.
 *
 * When a play stops (the room moves on, or the page goes away), its line is told once where it got to, for jumping back
 * in: the song's own clock for a song on the bar, the room's place for a video.
 *
 * A book is noted by the reader itself (`ReaderPage.tsx`).
 */

/** A row added this close to its playing was pressed to play now, not queued earlier. */
const PRESSED_MS = 10_000;

type Current = { key: string; kind: 'song' | 'video'; ref: string; handle: PlayHandle; room: WatchRoom; length: number | null };

/** Where the room was in what it has on, now: its place when last written, plus the time since if it is playing. */
function roomPlace(room: WatchRoom, now: number): number {
  const since = room.isPlaying ? Math.max(0, (now - Date.parse(room.updatedAt)) / 1000) : 0;
  return Math.max(0, room.positionSeconds + since);
}

/** A name pulled out of the bar's `where` for a profile: `THE PROFILE OF MIA` -> `MIA`. */
function profileName(where: string | undefined): string {
  const found = /^THE PROFILE OF (.+)$/.exec(where ?? '');
  return found === null ? '' : found[1];
}

/** A name pulled out of a queue's context: `MIA'S QUEUE` -> `MIA`. */
function queueName(context: string | undefined): string {
  const found = /^(.+)'S QUEUE$/.exec(context ?? '');
  return found === null ? '' : found[1];
}

function roomLabel(room: WatchRoom): string {
  if (room.name && room.name.trim() !== '') return room.name.trim().toUpperCase();
  const host = room.originalHostLabel.trim().toUpperCase();
  return host === '' ? 'A ROOM' : `${host}'S ROOM`;
}

/** The note for one row that just started playing. */
export function noteForRow(
  entry: WatchQueueEntry,
  room: WatchRoom,
  player: Pick<MusicPlayerValue, 'track' | 'heardFrom'>,
  ownRoomId: string | null,
  me: string | null,
  now: number,
): PlayNote | null {
  if (entry.link?.kind === 'picture') return null;
  const song = isSongLink(entry.link);
  const kind = song ? 'song' : 'video';
  const ref = entry.link?.url ?? (entry.mediaItemId === null ? '' : `file:${entry.mediaItemId}`);
  if (ref === '') return null;
  const onBar = song && player.track !== undefined && player.track.src === ref ? player.track : undefined;
  const screen = floatingState().entry;
  const title = entry.link?.title || onBar?.title || (screen !== null && screen.id === `own:${entry.id}` ? screen.title : '') || 'A FILE FROM THE SITE';
  const youtube = entry.link === null ? null : youtubeIdOf(entry.link);
  // A Twitch channel, live (SPEC-live-streams.md, 9A): the channel is the maker and Twitch's preview the picture; HISTORY marks
  // the line LIVE from its address.
  const channel = entry.link === null ? null : (twitchOf(entry.link)?.channel ?? null);
  const base = {
    kind,
    ref,
    title,
    maker: onBar?.credit ?? (channel !== null ? channel.toUpperCase() : ''),
    picture:
      channel !== null
        ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel}-320x180.jpg`
        : youtube === null || youtube === 'videoseries'
          ? null
          : `https://i.ytimg.com/vi/${youtube}/mqdefault.jpg`,
    roomId: room.id,
    queueEntryId: entry.id,
    whereHref: watchHref({ kind: 'room', roomId: room.id }),
    lengthSeconds: onBar === undefined ? null : lengthSeconds(onBar.length),
    addedBy: entry.addedBy,
    addedByName: entry.addedBy === null ? '' : entry.addedBy === me ? '' : accountName(entry.addedBy),
  } satisfies Partial<PlayNote>;

  const ownRoom = room.id === ownRoomId;
  const mine = entry.addedBy !== null && entry.addedBy === me;
  const context = mine ? takePlayContext() : null;
  if (context !== null) {
    return {
      ...base,
      how: context.how,
      whereLabel: context.whereLabel ?? '',
      whereHref: context.whereHref ?? base.whereHref,
      addedBy: context.addedBy ?? null,
      addedByName: context.addedByName ?? '',
      letterId: context.letterId ?? null,
      sourceRef: context.sourceRef ?? null,
    };
  }
  if (!ownRoom) return { ...base, how: 'room', whereLabel: roomLabel(room) };
  if (!mine) return { ...base, how: 'room', whereLabel: 'YOUR ROOM' };

  const heard = onBar === undefined ? null : player.heardFrom;
  if (heard?.origin === 'profile') {
    return { ...base, how: 'profile', whereLabel: heard.where ?? '', whereHref: heard.href ?? null, addedBy: null, addedByName: profileName(heard.where) };
  }
  if (heard?.origin === 'queue') {
    return { ...base, how: 'playlist', whereLabel: heard.where ?? '', whereHref: heard.href ?? null, addedBy: null, addedByName: queueName(heard.context) };
  }
  const startedAt = entry.playedAt === null ? now : Date.parse(entry.playedAt);
  const pressed = Math.abs(startedAt - Date.parse(entry.addedAt)) < PRESSED_MS;
  const how: PlayHow = pressed ? 'yourself' : 'own_queue';
  return { ...base, how, whereLabel: pressed ? (heard?.where ?? '') : '', whereHref: pressed ? (heard?.href ?? base.whereHref) : base.whereHref };
}

export default function PlayHistoryKeeper() {
  const { user, status } = useAuth();
  const player = useMusicPlayer();
  const own = useSyncExternalStore(subscribeToOwnRoom, ownRoomState, ownRoomState);
  const watch = useSyncExternalStore(subscribeToWatchWindow, watchWindowState, watchWindowServerState);
  const watched = watch.open && watch.focus?.kind === 'room' ? watch.focus.roomId : null;
  // The rooms you may be hearing: your own, the live room the bar follows, and the room window that is open. Each is
  // listened to on its own (code review: watching only one let your own room's songs go unnoted while another's window
  // was open); a room that is not playing notes nothing.
  const rooms = [...new Set([own.roomId, player.room?.roomId ?? null, watched].filter((id): id is string => id !== null))];

  const playerNow = useRef(player);
  useEffect(() => {
    playerNow.current = player;
  });

  // A sign-in or sign-out moves the log between the account and this browser.
  const who = status === 'loading' ? null : (user?.id ?? 'visitor');
  useEffect(() => {
    if (who === null) return;
    historyAccountChanged();
    void loadAccountNames();
  }, [who]);
  const me = user?.id ?? (own.visitor ? own.hostId : null);

  /* --- where the song on the bar has got to, for the line's place when it stops -------------------- */

  const songPlace = useRef<SongPlace | null>(null);
  const { audioElement } = player;
  useEffect(() => {
    const audio = audioElement();
    if (audio === null) return;
    const tick = () => {
      const src = playerNow.current.track?.src;
      if (src !== undefined && audio.currentTime > 0) {
        songPlace.current = { src, at: audio.currentTime, length: Number.isFinite(audio.duration) ? audio.duration : null };
      }
    };
    audio.addEventListener('timeupdate', tick);
    audio.addEventListener('pause', tick);
    return () => {
      audio.removeEventListener('timeupdate', tick);
      audio.removeEventListener('pause', tick);
    };
  }, [audioElement]);

  return (
    <>
      {rooms.map((roomId) => (
        <RoomEars key={roomId} roomId={roomId} ownRoomId={own.roomId} me={me} playerNow={playerNow} songPlace={songPlace} />
      ))}
    </>
  );
}

type SongPlace = { src: string; at: number; length: number | null };

/** One room listened to: when it moves on to a new row while playing, the last play stops and the new one is noted. */
function RoomEars({
  roomId,
  ownRoomId,
  me,
  playerNow,
  songPlace,
}: {
  roomId: string;
  ownRoomId: string | null;
  me: string | null;
  playerNow: RefObject<MusicPlayerValue>;
  songPlace: RefObject<SongPlace | null>;
}) {
  const { read } = useWatchRoom(roomId, { follow: false });
  const current = useRef<Current | null>(null);

  const stopCurrent = (now: number) => {
    const held = current.current;
    if (held === null) return;
    current.current = null;
    if (held.kind === 'song') {
      const place = songPlace.current;
      if (place !== null && place.src === held.ref) held.handle.stop(place.at, place.length ?? held.length);
      else held.handle.stop(null, held.length);
    } else {
      held.handle.stop(roomPlace(held.room, now), null);
    }
  };

  useEffect(() => {
    if (read === undefined || read === null) return;
    const room = read.room;
    const held = current.current;
    // Keep the room as last read with the play it holds, for the video's place when it stops.
    const key = room.currentEntryId === null ? null : `${room.id}:${room.currentEntryId}`;
    if (held !== null && key !== null && held.key === key) {
      current.current = { ...held, room };
    }
    if (!room.isPlaying || key === null) return;
    if (held?.key === key) return;
    const entry = read.queue.find((row) => row.id === room.currentEntryId);
    if (entry === undefined) return;
    const now = Date.now();
    const note = noteForRow(entry, room, playerNow.current, ownRoomId, me, now);
    if (note === null) return;
    stopCurrent(now);
    current.current = { key, kind: note.kind === 'song' ? 'song' : 'video', ref: note.ref, handle: notePlay(note), room, length: note.lengthSeconds ?? null };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stopCurrent` reads refs only.
  }, [read, ownRoomId, me, playerNow]);

  // Where it got to is said when the tab is hidden (the request still goes out then; one sent while the page is being
  // closed may be cut off), and again as the page goes away. Coming back, the same row is the same line (6-hour rule).
  useEffect(() => {
    const away = () => stopCurrent(Date.now());
    const hidden = () => {
      if (document.visibilityState === 'hidden') away();
    };
    window.addEventListener('pagehide', away);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', away);
      document.removeEventListener('visibilitychange', hidden);
      away();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stopCurrent` reads refs only.
  }, []);

  return null;
}
