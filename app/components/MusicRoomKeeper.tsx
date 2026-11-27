'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useSyncExternalStore } from 'react';
import { lengthSeconds } from '../lib/audio/track-context';
import type { AudioTrack } from '../lib/audio/tracks';
import { useCatalogue } from '../lib/media/catalogue';
import type { MediaItem } from '../lib/media/types';
import { closeFloating, floatingState, onFloatingEnded, orderFloating, playFloating, subscribeToFloating } from '../lib/ui/floating-player';
import { SEEK_SECONDS, isOwnPlayback, playbackChanged } from '../lib/watch/device-lead';
import { getBrowserWatchRepository } from '../lib/watch/mock-watch-repository';
import { playInMainRoom } from '../lib/watch/main-room-play';
import { takeUnhandledPlay } from '../lib/watch/row-handoff';
import { roomScreenSound, subscribeToRoomScreenSound, whoGivesWay } from '../lib/audio/room-screen-sound';
import { collapseWatch, openWatch, roomWindowWasOpen, watchWindowState } from '../lib/watch/watch-window';
import { OwnRoomSession, ownRoomPlace } from '../lib/watch/own-room';
import { clearOwnRoom, ownRoomState, patchOwnRoom, setOwnRoom, sharedRoomStore, storedVisitorRoomId, subscribeToOwnRoom, visitorRoomId } from '../lib/watch/own-room-client';
import { floatingForLink } from '../lib/watch/own-screen';
import { getWatchRepository, registerBrowserRoom } from '../lib/watch/repository';
import { currentEntry, hostPosition, upcoming } from '../lib/watch/rules';
import { isSongLink, songLink, trackForSong } from '../lib/watch/songs';
import type { WatchRoom, WatchRoomRead } from '../lib/watch/types';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import { webTrackNow } from '../lib/web/web-track-lookup';
import { useAuth } from './AuthProvider';
import { useMusicPlayer, type MusicPlayerValue } from './MusicPlayerProvider';
import { useOwnBarVolume } from '../lib/watch/use-own-bar-volume';

/**
 * The keeper of your own room (SPEC-rooms-queues.md; it was the music room's keeper, SPEC-music-queues.md). Draws nothing.
 *
 * You always have a room of your own: private, with only you in it. This is what makes the music bar its controls
 * and the floating player its screen. It finds the room when the page opens (an account's in the database, a
 * signed-out visitor's in their browser), puts its queue on the bar as up-next, and tells it what you play:
 *
 * - a song or video you start is filed as what is on; the next thing queued starts when one ends, whatever kind;
 * - pause, resume and a seek that has settled are written once each. Nothing is written on a clock;
 * - your other devices are in it too (Luke, 2026-11-27, 2A "follow live"): a signed-in room is followed live, and what
 *   another of your devices puts on, pauses, plays or moves to, this bar does too. The device you touched last leads
 *   (`device-lead.ts`); the others wait at a song's end for it to move the room on;
 * - after a reload the room is back, paused: a browser allows no sound without a press;
 * - coming back to the tab reads the room again, in case another of your devices changed it.
 */

/** A drag on the scrubber is many seeks: only where it comes to rest is written. */
const SEEK_SETTLE_MS = 1200;
/** How long after a song's end the keeper looks at whether anything followed it. */
const ENDED_LOOK_MS = 800;
/** Coming back to the tab reads the room again at most this often. */
const REFRESH_EVERY_MS = 60 * 1000;
/** A following device waits this long at the end of a song for the one that leads to move your room on, then moves it on itself. */
const LEAD_GONE_AT_END_MS = 4000;
/** A bar event this soon after it followed another device is that order landing, not a press. */
const FOLLOWED_LANDS_MS = 2500;
/** How many of the room's past states the keeper remembers, to tell an old read from a new change. */
const PAST_STATES_KEPT = 20;
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
  // Followed live while signed in: your other devices change it (device-lead.ts). A visitor's lives in this browser only.
  const { read } = useWatchRoom(own.roomId, { follow: !own.visitor });
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
  // The bar's volume follows your other devices while their bars play your room (Luke, 2026-11-27: "Yes, it follows").
  useOwnBarVolume(identity !== null && identity !== 'visitor' ? identity : null, own.visitor ? null : own.roomId, player.volume, player.setVolume, player.room === null || player.room.roomId === own.roomId);

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

  /* --- your other devices (Luke, 2026-11-27, 1A + 2A; device-lead.ts) ----------------------------------------------- */

  /** Whether this device leads your room: it does until another of your devices changes what plays, and again once it presses. */
  const lead = useRef<'lead' | 'follow'>('lead');
  /** The room as this keeper last saw it, to tell a real change of what plays from a beat or a setting. */
  const seenRoom = useRef<WatchRoom | null>(null);
  /** The room's last few states as this keeper saw them, to know an old one read again (`PAST_STATES_KEPT`). */
  const pastStates = useRef<string[]>([]);
  /**
   * When this bar last did what another device of yours did (`followOther`): the bar's own pause, play and seek events that follow
   * soon after are that order landing, not a press here, and are not written back (or two devices write each other's for ever).
   */
  const followed = useRef({ at: 0, playing: false, seekAt: 0 });
  /** The wait at a song's end for the leading device (`LEAD_GONE_AT_END_MS`). */
  const leadWait = useRef(0);
  useEffect(() => () => window.clearTimeout(leadWait.current), []);

  /** At the end of what was on: a following device waits for the one that leads; if it never moves the room on, this one does. */
  const waitForLead = useEffectEvent((): boolean => {
    if (lead.current !== 'follow' || session === null) return false;
    const ended = session.read()?.room.currentEntryId ?? null;
    window.clearTimeout(leadWait.current);
    leadWait.current = window.setTimeout(() => {
      if (session.read()?.room.currentEntryId !== ended || now.current.room !== null) return;
      lead.current = 'lead';
      const next = takeNext();
      if (next === null) session.stopped();
      else if (next !== 'other') now.current.cue(next.track);
    }, LEAD_GONE_AT_END_MS);
    return true;
  });

  /** What another of your devices put on, paused, played or moved to: this bar and screen do the same. */
  const followOther = useEffectEvent((held: WatchRoomRead) => {
    window.clearTimeout(leadWait.current);
    followed.current = { ...followed.current, at: Date.now(), playing: held.room.isPlaying };
    // A live room has the bar: the room's own window follows (WatchRoom.tsx).
    const bar = now.current;
    if (bar.room !== null) return;
    const room = held.room;
    const at = hostPosition(room, Date.now());
    const on = currentEntry(held);
    const screen = floatingState().entry;
    const ownScreen = screen !== null && screen.id.startsWith('own:');
    if (on === undefined || on.link === null) {
      // Stopped there, or one of the site's own files, which plays on the screen the queue starts.
      if (on === undefined) {
        if (bar.playing) bar.steer(false);
        if (ownScreen) orderFloating('pause');
      }
      return;
    }
    if (isSongLink(on.link)) {
      if (ownScreen) closeFloating();
      const track = trackForSong(on.link, bar.queue, webTrackNow(on.link.url));
      const audio = bar.audioElement();
      if (audio === null || bar.track?.src !== track.src) {
        followed.current.seekAt = Date.now();
        bar.cue(track, { at }, room.isPlaying);
        return;
      }
      if (Math.abs(audio.currentTime - at) > SEEK_SECONDS) {
        followed.current.seekAt = Date.now();
        audio.currentTime = at;
      }
      if (room.isPlaying !== bar.playing) bar.steer(room.isPlaying);
      return;
    }
    // A video: the same one on this device's screen, playing or paused as the room says.
    if (screen?.id !== `own:${on.id}`) {
      const shown = floatingForLink(on.link, `own:${on.id}`, window.location.origin);
      if (shown === null) return;
      if (bar.playing) bar.steer(false);
      playFloating(shown);
    }
    orderFloating(room.isPlaying ? 'play' : 'pause');
  });

  const heldNow = read ?? null;
  useEffect(() => {
    if (heldNow === null || session === null || own.visitor) return;
    const room = heldNow.room;
    // What is on now has not reached this copy yet (its row comes on its own): looked at again when it has.
    if (room.currentEntryId !== null && currentEntry(heldNow) === undefined) return;
    // A read that brings back a state this copy has already been past (a read sent off before a later write landed) is old
    // news, not another device: it is let go by, and the newer state it would cover stays.
    const said = `${room.id}|${room.currentEntryId}|${room.isPlaying}|${room.positionSeconds}`;
    const before = seenRoom.current;
    const beforeSaid = before === null ? '' : `${before.id}|${before.currentEntryId}|${before.isPlaying}|${before.positionSeconds}`;
    if (said !== beforeSaid && pastStates.current.includes(said)) return;
    pastStates.current = [...pastStates.current.slice(-(PAST_STATES_KEPT - 1)), said];
    seenRoom.current = room;
    if (before === null || before.id !== room.id || room.id !== session.id() || !playbackChanged(before, room)) return;
    if (isOwnPlayback(room)) {
      lead.current = 'lead';
      return;
    }
    lead.current = 'follow';
    followOther(heldNow);
  }, [heldNow, session, own.visitor]);

  const { bindOwnRoom } = player;
  const roomId = own.roomId;
  useEffect(() => {
    if (session === null || roomId === null) {
      bindOwnRoom(null);
      return;
    }
    bindOwnRoom({ roomId, waiting, onEnqueue: (track, where) => enqueue(track, where), takeNext: () => takeNext(), waitAtEnd: () => waitForLead(), onPlaying: (track) => playing(track) });
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

  /* --- after a reload: a LIVE main room comes back (open if it was open, else folded), so its host's beat carries on --- */
  // Without its window nothing says "still here", and after 45 seconds its people would take it (SPEC-rooms-perpetual.md).

  const reopened = useRef<OwnRoomSession | null>(null);
  useEffect(() => {
    if (session === null || visitorRoom || read === undefined || read === null || reopened.current === session) return;
    reopened.current = session;
    const held = read.room;
    if (held.origin !== 'music' || !held.isPublic || held.endedAt !== null || held.hostId !== ownHost) return;
    if (watchWindowState().open) return;
    openWatch({ kind: 'room', roomId: held.id });
    // Its window open when the page went away: it stays open (Luke, 2026-11-22: "stays open on the screen if it was open").
    if (!roomWindowWasOpen(held.id)) collapseWatch();
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
    /** A pause or play this soon after following another device, the way it was told to go, is that order landing (`followed`). */
    const landed = (playing: boolean) => {
      if (Date.now() - followed.current.at < FOLLOWED_LANDS_MS && followed.current.playing === playing) return true;
      // A press here the other way: the follow is over, and the next pause or play here is a press too.
      followed.current.at = 0;
      return false;
    };
    const paused = () => {
      if (landed(false)) return;
      // The end of a song is not a pause: the next thing starts, or the room says it stopped.
      if (!audio.ended && mine()) session.playback(audio.currentTime, false);
    };
    const resumed = () => {
      if (landed(true)) return;
      if (mine()) session.playback(audio.currentTime, true);
    };
    const seeked = () => {
      if (Date.now() - followed.current.seekAt < FOLLOWED_LANDS_MS) return;
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
        // Not on a device that follows another of yours: that one moves the room on (`waitForLead`).
        if (audio.ended && !now.current.playing && mine() && lead.current === 'lead') session.stopped();
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
      if (waitForLead()) return;
      const next = takeNext();
      if (next === null) session.stopped();
      else if (next !== 'other') now.current.cue(next.track);
    });
    return () => {
      offStart();
      offEnd();
    };
  }, [session, roomId]);

  /* --- one thing at a time (list 4, item 5: "the audio kept running underneath the video") ------------- */

  // The bar's song and your room's video: the one that started last plays. The room's player is paused where it takes
  // orders (YouTube, Vimeo, Twitch, our own files); a site's embed with no player to ask (PeerTube, a friend's server)
  // cannot be. The bar is made quiet with `steer`, which never presses a room's keys it may be bound to.
  const screen = useSyncExternalStore(subscribeToRoomScreenSound, roomScreenSound, () => null);
  const barSounding = player.playing;
  // A site's embed with no player to ask only counts as on (`playing` null-player rule, for the graph): it never
  // silences the bar, since its appearing is not its starting (code review, list 4).
  const roomSounding = screen !== null && screen.element !== null && screen.playing;
  const sounding = useRef({ bar: false, room: false });
  useEffect(() => {
    const step = whoGivesWay(sounding.current, { bar: barSounding, room: roomSounding });
    sounding.current = { bar: barSounding, room: roomSounding };
    if (step === 'room') roomScreenSound()?.element?.pause();
    else if (step === 'bar') now.current.steer(false);
  }, [barSounding, roomSounding]);

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
