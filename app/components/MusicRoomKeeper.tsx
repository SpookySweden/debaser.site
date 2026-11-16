'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useSyncExternalStore } from 'react';
import { lengthSeconds } from '../lib/audio/track-context';
import type { AudioTrack } from '../lib/audio/tracks';
import { useCatalogue } from '../lib/media/catalogue';
import type { MediaItem } from '../lib/media/types';
import { closeFloating, floatingState, onFloatingEnded, orderFloating, playFloating, subscribeToFloating } from '../lib/ui/floating-player';
import { getBrowserWatchRepository } from '../lib/watch/mock-watch-repository';
import { playInMainRoom } from '../lib/watch/main-room-play';
import { takeUnhandledPlay } from '../lib/watch/row-handoff';
import { collapseWatch, openWatch, watchWindowState } from '../lib/watch/watch-window';
import { OwnRoomSession, ownRoomPlace } from '../lib/watch/own-room';
import { clearOwnRoom, ownRoomState, patchOwnRoom, setOwnRoom, sharedRoomStore, storedVisitorRoomId, subscribeToOwnRoom, visitorRoomId } from '../lib/watch/own-room-client';
import { floatingForLink } from '../lib/watch/own-screen';
import { getWatchRepository, registerBrowserRoom } from '../lib/watch/repository';
import { currentEntry, upcoming } from '../lib/watch/rules';
import { isSongLink, songLink, trackForSong } from '../lib/watch/songs';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import { webTrackNow } from '../lib/web/web-track-lookup';
import { useAuth } from './AuthProvider';
import { useMusicPlayer, type MusicPlayerValue } from './MusicPlayerProvider';

/**
 * The keeper of your own room (SPEC-rooms-queues.md; it was the music room's keeper, SPEC-music-queues.md). Draws nothing.
 *
 * You always have a room of your own: private, with only you in it. This is what makes the music bar its controls
 * and the floating player its screen. It finds the room when the page opens (an account's in the database, a
 * signed-out visitor's in their browser), puts its queue on the bar as up-next, and tells it what you play:
 *
 * - a song or video you start is filed as what is on; the next thing queued starts when one ends, whatever kind;
 * - pause, resume and a seek that has settled are written once each. Nothing is written on a clock, and no live
 *   connection is held: nobody else is in the room, so there is nobody to keep in step;
 * - after a reload the room is back, paused: a browser allows no sound without a press;
 * - coming back to the tab reads the room again, in case another of your devices changed it.
 */

/** A drag on the scrubber is many seeks: only where it comes to rest is written. */
const SEEK_SETTLE_MS = 1200;
/** How long after a song's end the keeper looks at whether anything followed it. */
const ENDED_LOOK_MS = 800;
/** Coming back to the tab reads the room again at most this often. */
const REFRESH_EVERY_MS = 60 * 1000;
/** How many queued things in a row the screen may skip for having no player here, before it gives up. */
const SKIP_LIMIT = 25;

/** What a signed-out visitor queued in this browser goes onto the end of their account's queue when they log in. */
async function bringVisitorQueue(session: OwnRoomSession): Promise<void> {
  const visitorId = storedVisitorRoomId();
  if (visitorId === null) return;
  const browser = getBrowserWatchRepository(visitorId);
  const room = await browser.findMusicRoom(visitorId);
  if (room === null) return;
  const kept = await browser.readRoom(room.id);
  if (kept === null || kept.queue.length === 0) return;
  session.enqueueAll(upcoming([...kept.queue]).flatMap((entry) => (entry.link === null ? [] : [entry.link])));
  // The browser's copy is emptied only once the account's has been written, and only of what the account now holds:
  // a full queue, or a closed tab, loses nothing.
  if (!(await session.saved())) return;
  const held = new Set((session.read()?.queue ?? []).flatMap((entry) => (entry.link === null ? [] : [entry.link.url])));
  const moved = kept.queue.filter((entry) => entry.playedAt !== null || (entry.link !== null && held.has(entry.link.url)));
  await browser.removeOwnEntries(room.id, visitorId, moved.map((entry) => entry.id));
  await browser.writePlayback(room.id, { currentEntryId: null, positionSeconds: 0, isPlaying: false });
}

export default function MusicRoomKeeper() {
  const { user, status } = useAuth();
  const player = useMusicPlayer();
  const own = useSyncExternalStore(subscribeToOwnRoom, ownRoomState, ownRoomState);
  const { read } = useWatchRoom(own.roomId, { follow: false });
  const session = own.session;

  /** Whose room: an account's id, `visitor` for anybody signed out, null until the sign-in has been read. */
  const identity = status === 'loading' ? null : status === 'signed-in' && user !== null ? user.id : 'visitor';
  const label = useRef('');
  /** The site's own files by id, filled only while the queue holds one (`OwnRoomFiles`). */
  const files = useRef(new Map<string, MediaItem>());
  /** The player as it is now, for the listeners below, which outlive a render. */
  const now = useRef<MusicPlayerValue>(player);
  useEffect(() => {
    label.current = user?.displayName ?? '';
    now.current = player;
  });

  /* --- the session: one per person ------------------------------------------------------------------ */

  useEffect(() => {
    if (identity === null) return;
    const visitor = identity === 'visitor';
    const hostId = visitor ? visitorRoomId() : identity;
    const repository = visitor ? getBrowserWatchRepository(hostId) : getWatchRepository();
    const made: OwnRoomSession = new OwnRoomSession({
      repository,
      host: { id: hostId, label: visitor ? 'YOU' : label.current || 'Unknown' },
      store: sharedRoomStore,
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
      onRoom: (roomId) => {
        if (visitor) registerBrowserRoom(roomId, repository);
        patchOwnRoom(made, { roomId });
      },
      onWaiting: (waiting) => patchOwnRoom(made, { waiting }),
    });
    setOwnRoom({ session: made, roomId: null, hostId, visitor, waiting: false });
    void made
      .load()
      .then(() => (visitor ? undefined : bringVisitorQueue(made)))
      .catch(() => undefined);
    return () => {
      made.close();
      clearOwnRoom(made);
    };
  }, [identity]);

  /* --- the bar: up-next is the room's queue --------------------------------------------------------- */

  const shelf = player.queue;
  const queue = read?.queue;
  // On the stored queue's identity (a new list each render would re-bind the player, which draws this again).
  const fresh = useMemo(
    () => (queue === undefined ? [] : upcoming([...queue]).flatMap((next) => (isSongLink(next.link) ? [trackForSong(next.link, shelf, webTrackNow(next.link.url))] : []))),
    [queue, shelf],
  );
  // The same up-next, kept as the same list while what is in it is the same: a room read again (a refused write's
  // reread, a refresh) must not hand the bar a new binding, or the bar tells the room "playing" again, which writes,
  // which reads again: the loop PLAYERBAR found (2026-11-16, 'Maximum update depth exceeded' for a visitor).
  const contents = fresh.map((track) => `${track.id}\u0001${track.src}\u0001${track.title}`).join('\u0002');
  // Keyed on what is in it, not on the list itself: that is the point.
  const waiting = useMemo(() => fresh, [contents]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The next thing queued becomes what is on: a song for the bar, or a video started on the room's screen. */
  const takeNext = useEffectEvent((): { track: AudioTrack } | 'other' | null => {
    if (session === null) return null;
    for (let skipped = 0; skipped < SKIP_LIMIT; skipped += 1) {
      const entry = session.takeNext();
      if (entry === null) return null;
      if (entry.link === null) {
        // One of the site's own files (a FILES video): played from where the site holds it, as its own row plays it.
        const item = entry.mediaItemId === null ? undefined : files.current.get(entry.mediaItemId);
        if (item === undefined || item.kind !== 'video') continue;
        playFloating({ id: `own:${entry.id}`, title: item.title, shape: 'video', room: { mediaItemId: item.id }, player: { kind: 'file', src: item.src } });
        return 'other';
      }
      if (isSongLink(entry.link)) {
        // The room has moved on from whatever was on its screen.
        closeFloating();
        return { track: trackForSong(entry.link, now.current.queue, webTrackNow(entry.link.url)) };
      }
      const screen = floatingForLink(entry.link, `own:${entry.id}`, window.location.origin);
      // No player for it outside a live room: it is passed over, and the one after it has its turn.
      if (screen === null) continue;
      playFloating(screen);
      return 'other';
    }
    return null;
  });
  const enqueue = useEffectEvent((track: AudioTrack, where: 'end' | 'next') => {
    if (session === null) return;
    try {
      session.enqueue(songLink(track), where);
      patchOwnRoom(session, { note: null });
    } catch (failure) {
      patchOwnRoom(session, { note: failure instanceof Error ? failure.message : 'IT COULD NOT BE QUEUED.' });
    }
  });
  const playing = useEffectEvent((track: AudioTrack) => {
    if (session === null) return;
    const before = session.read()?.room.currentEntryId ?? null;
    const entry = session.started(songLink(track));
    // A new song while a video is on the screen: the video is asked to pause, where its player takes orders. A
    // picture is a stop, not a backdrop (SPEC-rooms-queues.md, section 6): the song starting means it has had its turn.
    const screen = floatingState().entry;
    if (entry === null || entry.id === before || screen === null) return;
    if (screen.player.kind === 'picture') closeFloating();
    else orderFloating('pause');
  });

  const { bindOwnRoom } = player;
  const roomId = own.roomId;
  useEffect(() => {
    if (session === null || roomId === null) {
      bindOwnRoom(null);
      return;
    }
    bindOwnRoom({ roomId, waiting, onEnqueue: (track, where) => enqueue(track, where), takeNext: () => takeNext(), onPlaying: (track) => playing(track) });
  }, [bindOwnRoom, session, roomId, waiting]);
  useEffect(() => () => bindOwnRoom(null), [bindOwnRoom]);

  /* --- the room stopped being your main room: you ended it, or it was handed on (SPEC-rooms-perpetual.md) --- */

  const ownHost = own.hostId;
  const visitorRoom = own.visitor;
  useEffect(() => {
    if (session === null || visitorRoom || read === undefined || read === null) return;
    const held = read.room;
    if (held.id !== session.id()) return;
    if (held.endedAt !== null || held.origin !== 'music' || held.hostId !== ownHost) session.renew(held.id);
  }, [session, read, ownHost, visitorRoom]);

  /* --- after a reload: a LIVE main room comes back folded, so its host's beat carries on ---------------- */
  // Without its window nothing says "still here", and after 45 seconds its people would take it (SPEC-rooms-perpetual.md).

  const reopened = useRef<OwnRoomSession | null>(null);
  useEffect(() => {
    if (session === null || visitorRoom || read === undefined || read === null || reopened.current === session) return;
    reopened.current = session;
    const held = read.room;
    if (held.origin !== 'music' || !held.isPublic || held.endedAt !== null || held.hostId !== ownHost) return;
    if (watchWindowState().open) return;
    openWatch({ kind: 'room', roomId: held.id });
    collapseWatch();
  }, [session, read, ownHost, visitorRoom]);

  /* --- after a reload: the room is back, paused ------------------------------------------------------ */

  const restored = useRef<OwnRoomSession | null>(null);
  const loading = player.loading;
  useEffect(() => {
    if (session === null || read === undefined || read === null || loading || restored.current === session) return;
    restored.current = session;
    // The reader was quicker, or is in a live room: nothing is put over what they chose.
    if (now.current.playing || now.current.room !== null) return;
    const on = currentEntry(read);
    // A picture was holding the screen: it is put back, held as before, so NEXT is there to take it off.
    if (on !== undefined && on.link !== null && on.link.kind === 'picture' && floatingState().entry === null) {
      const screen = floatingForLink(on.link, `own:${on.id}`, window.location.origin);
      if (screen !== null) playFloating(screen);
      return;
    }
    if (on === undefined || !isSongLink(on.link)) return;
    const track = trackForSong(on.link, now.current.queue, webTrackNow(on.link.url));
    // With the song's own length where the shelf knows it: one left playing past its end starts from the top.
    now.current.cue(track, { at: ownRoomPlace(read.room, Date.now(), lengthSeconds(track.length)) }, false);
  }, [session, read, loading]);

  /* --- pause, resume, a settled seek: written once each, never on a clock ----------------------------- */

  const { audioElement } = player;
  useEffect(() => {
    const audio = audioElement();
    if (session === null || roomId === null || audio === null) return;
    let settle = 0;
    /** The song on the bar is what the room has on, and no live room has the bar. */
    const mine = () => {
      const held = session.read();
      const on = held === null ? undefined : currentEntry(held);
      return now.current.room === null && on !== undefined && on.link?.url === now.current.track?.src;
    };
    const paused = () => {
      // The end of a song is not a pause: the next thing starts, or the room says it stopped.
      if (!audio.ended && mine()) session.playback(audio.currentTime, false);
    };
    const resumed = () => {
      if (mine()) session.playback(audio.currentTime, true);
    };
    const seeked = () => {
      window.clearTimeout(settle);
      // Back to the very start while playing is a song repeating itself: the same play, and a short clip does it
      // every few seconds, so it is not written.
      if (audio.currentTime < 1 && !audio.paused) return;
      settle = window.setTimeout(() => {
        if (mine()) session.playback(audio.currentTime, !audio.paused);
      }, SEEK_SETTLE_MS);
    };
    // The last song ended and nothing followed it (nothing queued, no shelf to walk on to): the room says it stopped,
    // once. Looked at a moment later, when the bar has either started the next thing or gone quiet.
    let after = 0;
    const ended = () => {
      window.clearTimeout(after);
      after = window.setTimeout(() => {
        if (audio.ended && !now.current.playing && mine()) session.stopped();
      }, ENDED_LOOK_MS);
    };
    audio.addEventListener('pause', paused);
    audio.addEventListener('play', resumed);
    audio.addEventListener('seeked', seeked);
    audio.addEventListener('ended', ended);
    return () => {
      window.clearTimeout(settle);
      window.clearTimeout(after);
      audio.removeEventListener('pause', paused);
      audio.removeEventListener('play', resumed);
      audio.removeEventListener('seeked', seeked);
      audio.removeEventListener('ended', ended);
    };
  }, [audioElement, session, roomId]);

  /* --- the screen: a video started, and a video ended ------------------------------------------------ */

  useEffect(() => {
    if (session === null || roomId === null) return;
    const onStart = () => {
      // Each PLAY once, including one pressed while your room was still being read (list 4, ./lib/watch/row-handoff.ts).
      const entry = takeUnhandledPlay(floatingState().entry);
      if (entry === null) return;
      // PLAY on a row's video opens your main room's window with it on screen, not the floating player
      // (SPEC-rooms-perpetual.md, Luke 2026-11-16), a signed-out visitor's too (list 3). Not a video this keeper put on
      // from the queue (`own:`). In somebody else's room you are asked first (Luke, Q2 A).
      if (entry.shape === 'video' && entry.room !== undefined && !entry.id.startsWith('own:')) {
        const went = playInMainRoom(entry.room.link !== undefined ? { link: entry.room.link } : { mediaItemId: entry.room.mediaItemId }, entry.title);
        // Asked first: the video plays on where it was until the answer (CANCEL keeps it).
        if (went === 'room') {
          closeFloating();
          if (now.current.playing && now.current.room === null) now.current.steer(false);
          return;
        }
        if (went === 'ask') return;
      }
      // In a live room the bar and the queue are that room's; a video played beside it is its own business.
      if (now.current.room !== null) return;
      if (entry.room?.link !== undefined) session.started(entry.room.link);
      else if (entry.room?.mediaItemId !== undefined) session.startedFile(entry.room.mediaItemId);
      // One thing is on in your room: the song gives way to the video.
      if (now.current.playing) now.current.steer(false);
    };
    const offStart = subscribeToFloating(onStart);
    // A PLAY pressed before your room was read (a moment on the live site) is handed over now it is.
    onStart();
    const offEnd = onFloatingEnded(() => {
      if (now.current.room !== null || now.current.playing) return;
      const next = takeNext();
      if (next === null) session.stopped();
      else if (next !== 'other') now.current.cue(next.track);
    });
    return () => {
      offStart();
      offEnd();
    };
  }, [session, roomId]);

  /* --- back on this tab, or back online --------------------------------------------------------------- */

  useEffect(() => {
    if (session === null) return;
    let last = Date.now();
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      void session.retry().catch(() => undefined);
      // A visitor's room lives in this browser: there is no other device to have changed it.
      if (ownRoomState().visitor || Date.now() - last < REFRESH_EVERY_MS) return;
      last = Date.now();
      void session.refresh().catch(() => undefined);
    };
    const online = () => void session.retry().catch(() => undefined);
    document.addEventListener('visibilitychange', back);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('online', online);
    };
  }, [session]);

  // The catalogue is read only while the queue holds one of the site's own files: most queues never do.
  const holdsFiles = queue !== undefined && queue.some((entry) => entry.mediaItemId !== null && entry.playedAt === null);
  return holdsFiles ? <OwnRoomFiles filesRef={files} /> : null;
}

/** Reads the FILES catalogue for the keeper, so a queued file can be played when its turn comes. Draws nothing. */
function OwnRoomFiles({ filesRef }: { filesRef: { current: Map<string, MediaItem> } }) {
  const catalogue = useCatalogue();
  useEffect(() => {
    filesRef.current = new Map(catalogue.items.map((item) => [item.id, item]));
  }, [catalogue.items, filesRef]);
  return null;
}
