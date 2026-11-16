'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLedgeHeadroom } from '../lib/companion/use-ledge-headroom';
import { useCatalogue } from '../lib/media/catalogue';
import { PLATE_LINK, PLATE_MAIN, PLATE_ON_BLACK, TITLE_BAR, TITLE_BAR_BUTTON } from '../lib/ui/controls';
import { closeFloating, floatingClock, floatingState, orderFloating, subscribeToFloating, subscribeToFloatingClock, takesOrders, togglePlayerFullscreen } from '../lib/ui/floating-player';
import { blankPrefill, type BlankKey } from '../lib/watch/blank-screen';
import { ownRoomState, subscribeToOwnRoom } from '../lib/watch/own-room-client';
import { getWatchRepository } from '../lib/watch/repository';
import { ROOM_BAR, ROOM_BAR_PLACE, ROOM_COG, ROOM_COLUMNS, ROOM_PICTURE_BOX, ROOM_PICTURE_FIT, ROOM_ROOT, ROOM_SCREEN, ROOM_SIDE, ROOM_SIDE_BODY, ROOM_STAGE } from '../lib/watch/room-frame';
import type { RoomMemberRow } from '../lib/watch/types';
import { currentEntry, formatMediaTime, upcoming } from '../lib/watch/rules';
import { isSongLink, trackForSong } from '../lib/watch/songs';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import { webTrackNow } from '../lib/web/web-track-lookup';
import { useAuth } from './AuthProvider';
import BlankScreen from './BlankScreen';
import DockWindow from './DockWindow';
import { useForum } from './ForumProvider';
import GoLiveWindow from './GoLiveWindow';
import { useMusicPlayer } from './MusicPlayerProvider';
import PlayerBox from './PlayerBox';
import RoomSettingsWindow from './RoomSettingsWindow';
import SongCoverCard from './SongCoverCard';
import { SpeakerKey } from './StreamBarKeys';
import StreamQueueWindow from './StreamQueueWindow';

/** As a live room's window: it opens filling the screen, because the picture wants all the room it can get. */
const ROOM_SIZE = { w: 2560, h: 1440 };
const ROOM_MIN = { w: 560, h: 420 };

const noScreen = () => null;
const screenNow = () => floatingState().entry;
const noClock = () => null;

/**
 * Your own room's window (SPEC-rooms-queues.md, phase 2; Luke: "at any time you can click the pop up above the music
 * player to open the room window like usual and access all the usual stuff").
 *
 * **It is drawn in the live room's frame** (SPEC-rooms-your-room.md, part 1; Luke, 2026-11-16: "in the pre room
 * version of the room i need it so the ui is congruent with the streaming version"): the picture with the bar of keys
 * under it, and the side column with `[ QUEUE ]` and the cog, from the one set of class lists both windows read
 * (`lib/watch/room-frame.ts`). Where a live room has its chat, this has JUST YOU HERE and `[ GO LIVE ]`. It even shares
 * the live room's window (`id="stream"`), so GO LIVE turns this window into the live room where it stands.
 *
 * It is still NOT a live room (`WatchRoom.tsx`), on purpose. Nobody else is here, so there is no presence, no
 * heartbeat, no take-over, no chat and no canvas to run, and no live connection is opened: it reads the copy the
 * bar already plays from. The video on the screen is the site's one floating player, which sits over this
 * window's box while the window is open and goes back to its row (or its corner) when it shuts: the same element, so
 * it never restarts. So the keys under the picture drive that player and the bar's song, and each is drawn only where
 * it can do something: PLAY, the seek line, sound and FULL for a player that takes orders (our own files, YouTube,
 * Vimeo), `[ PIP ]` for any video, next when something is waiting. Nothing is drawn disabled, and there is no END.
 */
export default function OwnRoomWindow({ roomId, collapsed, onCollapse, onClose }: { roomId: string; collapsed: boolean; onCollapse: () => void; onClose: () => void }) {
  const own = useSyncExternalStore(subscribeToOwnRoom, ownRoomState, ownRoomState);
  const { read } = useWatchRoom(roomId, { follow: false });
  const screen = useSyncExternalStore(subscribeToFloating, screenNow, noScreen);
  const clock = useSyncExternalStore(subscribeToFloatingClock, floatingClock, noClock);
  const player = useMusicPlayer();
  const { user } = useAuth();
  const forum = useForum();
  const catalogue = useCatalogue();
  const itemsById = useMemo(() => new Map(catalogue.items.map((item) => [item.id, item])), [catalogue.items]);
  const headroom = useLedgeHeadroom();
  const [goingLive, setGoingLive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  /** The search a blank screen's key opened the queue window with, as in a live room. */
  const [queuePrefill, setQueuePrefill] = useState<string | undefined>(undefined);
  const openQueue = useCallback((key?: BlankKey) => {
    setQueuePrefill(key === undefined ? undefined : blankPrefill(key));
    setQueueOpen(true);
  }, []);

  // Who has joined by your link: read when the window opens and when its settings shut (a REMOVE happens there).
  // No connection is held for it; a signed-out visitor's browser room has no link and nobody to list.
  const [joined, setJoined] = useState<RoomMemberRow[]>([]);
  const account = own.visitor ? null : own.hostId;
  useEffect(() => {
    if (account === null || settingsOpen) return;
    let alive = true;
    void getWatchRepository()
      .listRoomMembers(roomId)
      .then((people) => {
        if (alive) setJoined(people.filter((person) => person.userId !== account && person.removedAt === null));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [roomId, account, settingsOpen]);

  const readable = read !== undefined && read !== null;
  const on = readable ? currentEntry(read) : undefined;
  // One thing is on in your room: a video while the bar is quiet, otherwise the bar's song.
  const videoOn = screen !== null && !player.playing;
  const song = videoOn || on === undefined || !isSongLink(on.link) ? null : player.track?.src === on.link.url ? player.track : trackForSong(on.link, player.queue, webTrackNow(on.link.url));
  const title = videoOn ? screen.title : (song?.title ?? null);
  const waiting = readable ? upcoming(read.queue).length : 0;

  // Folded (`[ _ ]`, `[ PIP ]`), the window tucks away and the video floats, with `[ BACK ]` on it: that picture is the
  // only way back. Only a video can float, so the key is there only then; and when the floating video goes (it ended
  // into a song, a song was started, it was closed), the window shuts and `[ ▲ ROOM ]` above the bar is its door again.
  useEffect(() => {
    if (collapsed && !videoOn) onClose();
  }, [collapsed, videoOn, onClose]);

  /* --- the keys under the picture: the live room's bar, driving the floating player and the bar's song --- */

  const screenPlay = screen?.play ?? 0;
  /** A picture holds the screen until NEXT: nothing to play, pause or seek. */
  const pictureOn = videoOn && screen.shape === 'picture';
  /** The video's player can be told what to do: our own files, YouTube, Vimeo. Any other keeps its own keys. */
  const obeys = videoOn && takesOrders(screen);
  /** The song the room has on is the one on the bar, so the bar's transport is this room's. */
  const songOnBar = song !== null && player.track?.src === song.src;
  const hasTransport = obeys || songOnBar;
  const paused = songOnBar ? !player.playing : (clock?.paused ?? false);
  const seconds = songOnBar ? player.elapsed : (clock?.seconds ?? 0);
  const length = songOnBar ? player.duration : (clock?.duration ?? Number.NaN);
  const duration = Number.isFinite(length) && length > 0 ? length : 0;

  /** What this window last asked of the video's sound, kept against the PLAY it was asked of: a new video starts as its player has it. */
  const [soundAsked, setSoundAsked] = useState<{ play: number; volume: number; muted: boolean } | null>(null);
  const asked = soundAsked !== null && soundAsked.play === screenPlay ? soundAsked : null;
  const volume = asked?.volume ?? clock?.volume ?? 1;
  const muted = asked?.muted ?? clock?.muted ?? false;
  const askedVolume = asked?.volume;
  const askedMuted = asked?.muted;
  useEffect(() => {
    if (askedVolume !== undefined && askedMuted !== undefined) orderFloating({ volume: askedVolume, muted: askedMuted });
  }, [askedVolume, askedMuted]);

  // NEXT off a picture, as the bar's own key does it (`MusicPlayer.tsx`): what is queued behind it starts; with
  // nothing behind it the picture simply comes off, and your room says nothing is on.
  const playNext = player.next;
  const nextFromPicture = useCallback(() => {
    playNext();
    if (floatingState().entry?.play !== screenPlay) return;
    closeFloating();
    ownRoomState().session?.stopped();
  }, [playNext, screenPlay]);

  const playKey = hasTransport ? (
    <button
      type="button"
      className={`${PLATE_ON_BLACK} shrink-0`}
      aria-label={paused ? 'Play' : 'Pause'}
      onClick={() => {
        if (songOnBar) player.toggle();
        else orderFloating(paused ? 'play' : 'pause');
      }}
      data-own-room-play={paused ? 'paused' : 'playing'}
    >
      {paused ? '[ ▶ ]' : '[ ❚❚ ]'}
    </button>
  ) : null;
  // A player that has not said how long it is has no line to drag yet; the space is kept so the keys beside it stay put.
  const seekLine =
    duration > 0 ? (
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={duration}
        step={0.1}
        value={Math.min(seconds, duration)}
        onChange={(event) => {
          const to = Number(event.target.value);
          if (songOnBar) player.seek(to);
          else orderFloating({ seek: to });
        }}
        className="min-w-12 flex-1 accent-sun"
      />
    ) : (
      <span className="min-w-12 flex-1" />
    );
  const timeMark = (
    <span className="shrink-0 tabular-nums" data-watch-clock={seconds.toFixed(1)}>
      {formatMediaTime(seconds)} / {duration > 0 ? formatMediaTime(duration) : '--:--'}
    </span>
  );
  // Next is drawn when it has something to do: something waits, the bar's shelf walks on from a song, or a picture comes off.
  const skipKey =
    waiting > 0 || songOnBar || pictureOn ? (
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label={pictureOn ? 'Next: take the picture off and start what is queued behind it' : 'Skip to the next in your queue'} title={pictureOn ? 'Takes the picture off' : 'Skip'} onClick={pictureOn ? nextFromPicture : playNext} data-own-room-next>
        [ ▶▶ ]
      </button>
    ) : null;
  // `[ PIP ]` is the window's `[ _ ]`: the window tucks away and the video floats (SPEC-rooms-your-room.md, part 2).
  const floatKey =
    videoOn && !pictureOn ? (
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label="Picture in picture: floats over the site" title="Floats over the site" onClick={onCollapse} data-own-room-pip>
        [ PIP ]
      </button>
    ) : null;
  // The sound, PIP and FULL, as a live room's bar has them. QUALITY and SUBS are not here: the platform's own player
  // on this screen carries its own, and a plain file has one quality (a live room draws neither then, either).
  const pictureKeys = obeys ? (
    <>
      <SpeakerKey
        muted={muted}
        volume={volume}
        onMuted={(next) => setSoundAsked((was) => ({ play: screenPlay, volume: was !== null && was.play === screenPlay ? was.volume : volume, muted: next }))}
        onVolume={(next) => setSoundAsked((was) => ({ play: screenPlay, volume: next, muted: was !== null && was.play === screenPlay ? was.muted : muted }))}
      />
      {floatKey}
      <button type="button" className={`${PLATE_ON_BLACK} shrink-0`} aria-label="Fullscreen" onClick={togglePlayerFullscreen} data-own-room-full>
        [ FULL ]
      </button>
    </>
  ) : (
    floatKey
  );
  const playerBar =
    playKey !== null || skipKey !== null || pictureKeys !== null ? (
      <div className={ROOM_BAR} data-watch-bar="shown" data-own-room-bar>
        {playKey}
        {/* With no transport (a platform's own player, a picture) the space only pushes the keys to the right. */}
        {hasTransport ? (
          <span className={ROOM_BAR_PLACE}>
            {seekLine}
            {timeMark}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {skipKey}
        {pictureKeys}
      </div>
    ) : null;

  const mayEdit = !own.visitor && user !== null;

  return (
    <>
      <DockWindow
        // The live room's own window, on purpose: GO LIVE swaps what is in it and the frame stays exactly where it is.
        id="stream"
        fill
        title="YOUR ROOM"
        badge={own.visitor ? 'IN THIS BROWSER' : 'JUST YOU'}
        onClose={onClose}
        onMinimize={readable && videoOn ? onCollapse : undefined}
        minimizeTip="Picture in picture: the window tucks away and the video floats"
        minimized={collapsed}
        aboveBottomBar
        headroom={headroom}
        dock="top"
        defaultSize={ROOM_SIZE}
        minSize={ROOM_MIN}
      >
        {!readable ? (
          <p className="text-label font-bold text-ink">READING YOUR ROOM...</p>
        ) : (
          <div className={ROOM_ROOT} data-own-room-window={own.visitor ? 'browser' : 'account'}>
            <div className={ROOM_COLUMNS}>
              <div className={ROOM_STAGE}>
                {/* The picture with its bar under it, as in a live room. */}
                <section aria-label="Screen" className={ROOM_SCREEN} data-own-room-stage>
                  <div className={`relative ${ROOM_PICTURE_BOX}`} data-own-room-screen={videoOn ? 'video' : song !== null ? 'song' : 'empty'}>
                    {videoOn ? (
                      // The site's one player sits exactly over this box while it is on screen: nothing is loaded again.
                      <PlayerBox id={screen.id} title={screen.title} className={`${ROOM_PICTURE_FIT} bg-ink-plate`} />
                    ) : song !== null ? (
                      <SongCoverCard track={song} fit={ROOM_PICTURE_FIT} />
                    ) : (
                      // Nothing on: the black screen with its three keys, each opening the queue searched for its kind.
                      <BlankScreen fit={ROOM_PICTURE_FIT} onPick={openQueue} />
                    )}
                  </div>
                  {playerBar}
                </section>
              </div>

              <div className={ROOM_SIDE} data-own-room-side>
                {/* One key for the queue window, where everything is added and seen, and the cog beside it: as in a live room. */}
                <div className={TITLE_BAR}>
                  <button type="button" className={`${TITLE_BAR_BUTTON} max-sm:min-h-tap`} aria-haspopup="dialog" onClick={() => openQueue()} data-own-room-queue-key>
                    [ QUEUE ]
                  </button>
                  {mayEdit ? (
                    <button
                      type="button"
                      className={`${TITLE_BAR_BUTTON} max-sm:min-h-tap`}
                      aria-haspopup="dialog"
                      aria-expanded={settingsOpen}
                      aria-label="Room link and settings"
                      title="Link and settings"
                      onClick={() => setSettingsOpen(true)}
                      data-own-room-settings
                    >
                      [ {ROOM_COG} ]
                    </button>
                  ) : null}
                </div>
                {/* What is on and how much waits: a live room says this on its crawl, which needs somebody to read it to. */}
                <p className="flex flex-wrap items-baseline gap-x-2 text-label text-ink" data-own-room-now>
                  <span className="min-w-0 truncate font-bold" title={title ?? undefined}>
                    {title === null ? 'NOTHING ON' : `${videoOn ? (pictureOn ? 'PICTURE (HELD UNTIL NEXT)' : 'VIDEO') : 'SONG'} :: ${title}`}
                  </span>
                  <span className="text-ink-quiet">{waiting === 0 ? 'NOTHING QUEUED' : `${waiting} QUEUED`}</span>
                </p>

                {/* Where a live room has its chat. Alone, there is nobody to talk to: the panel says so, and how to let people in. */}
                <aside aria-label="Who is here" className={`${ROOM_SIDE_BODY} frame p-2 text-label text-ink sm:overflow-y-auto`} data-own-room-alone={joined.length === 0 ? 'alone' : 'joined'}>
                  {joined.length === 0 ? (
                    <>
                      <p className="text-key font-bold">JUST YOU HERE</p>
                      <p>
                        {own.visitor
                          ? 'This room is kept in this browser. Nobody else can see it or join it.'
                          : 'Nobody can see this room or join it unless you give them its link. It is saved to your account, so your queue follows you.'}
                      </p>
                    </>
                  ) : (
                    <>
                      {/* Whoever joined by your link, so nobody follows along without you knowing (Luke, 2026-11-15). */}
                      <p className="text-key font-bold">IN YOUR ROOM BY YOUR LINK: {joined.length}</p>
                      <p className="break-words" data-own-room-joined>
                        {joined.map((person) => person.label.toUpperCase()).join(', ')}
                      </p>
                      <p>They hear and see what you play, see your queue, and can add to it and draw. REMOVE is in the settings.</p>
                    </>
                  )}
                  <p className="mt-1">GO LIVE starts a new room that people can join, with chat and a canvas.</p>
                  <p>
                    {user === null ? (
                      <>
                        <Link href="/account" className={PLATE_LINK}>
                          [ LOG IN ]
                        </Link>{' '}
                        TO GO LIVE
                      </>
                    ) : (
                      <button type="button" onClick={() => setGoingLive(true)} aria-haspopup="dialog" aria-expanded={goingLive} className={PLATE_MAIN} data-own-room-go-live>
                        [ GO LIVE ]
                      </button>
                    )}
                  </p>
                </aside>
              </div>
            </div>
          </div>
        )}
      </DockWindow>

      {/* The queue as its own window, opened from the QUEUE line as a live room's is. Your own room is always open to you. */}
      {queueOpen && readable ? (
        <StreamQueueWindow read={read} itemsById={itemsById} live userId={own.hostId} members={[]} nowLive={false} onClose={() => setQueueOpen(false)} prefill={queuePrefill} inRoom />
      ) : null}

      {/* The room's settings, as a live room's cog opens them: COPY LINK with REFRESH LINK beside it, and who joined, with REMOVE. */}
      {settingsOpen && readable && user !== null && account !== null ? <RoomSettingsWindow room={read.room} userId={account} look={null} onClose={() => setSettingsOpen(false)} /> : null}

      {/* The same menu GO LIVE opens everywhere (WHO CAN JOIN, PRIVATE picked); what is on goes in from the same spot, with your queue. */}
      {goingLive && user !== null ? (
        <GoLiveWindow user={user} createThread={forum.createThread} onClose={() => setGoingLive(false)} />
      ) : null}
    </>
  );
}
