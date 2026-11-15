'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLedgeHeadroom } from '../lib/companion/use-ledge-headroom';
import { useCatalogue } from '../lib/media/catalogue';
import { PLATE, PLATE_LINK, PLATE_MAIN } from '../lib/ui/controls';
import { floatingState, subscribeToFloating } from '../lib/ui/floating-player';
import { ownRoomState, subscribeToOwnRoom } from '../lib/watch/own-room-client';
import { getWatchRepository } from '../lib/watch/repository';
import type { RoomMemberRow } from '../lib/watch/types';
import { currentEntry, upcoming } from '../lib/watch/rules';
import { isSongLink, trackForSong } from '../lib/watch/songs';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import { webTrackNow } from '../lib/web/web-track-lookup';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';
import { useForum } from './ForumProvider';
import GoLiveWindow from './GoLiveWindow';
import { useMusicPlayer } from './MusicPlayerProvider';
import PlayerBox from './PlayerBox';
import RoomSettingsWindow from './RoomSettingsWindow';
import SongCoverCard from './SongCoverCard';
import StreamQueueWindow from './StreamQueueWindow';

/** As a live room's window: it opens filling the screen, because the picture wants all the room it can get. */
const ROOM_SIZE = { w: 2560, h: 1440 };
const ROOM_MIN = { w: 560, h: 420 };

const noScreen = () => null;
const screenNow = () => floatingState().entry;

/**
 * Your own room's window (SPEC-rooms-queues.md, phase 2; Luke: "at any time you can click the pop up above the music
 * player to open the room window like usual and access all the usual stuff").
 *
 * The room is the one you always have: the music bar is its controls and the floating player is its screen. This
 * window is the same room seen whole: the screen, the cover card for a song, the queue, and who is here, which while
 * it is just you is one panel saying so, with GO LIVE on it.
 *
 * It is NOT a live room's window (`WatchRoom.tsx`), on purpose. Nobody else is here, so there is no presence, no
 * heartbeat, no take-over, no chat and no canvas to run, and no live connection is opened: it reads the copy the
 * bar already plays from. The video on the screen is the site's one floating player, which sits over this
 * window's box while the window is open and goes back to its row (or its corner) when it shuts: the same element, so
 * it never restarts.
 */
export default function OwnRoomWindow({ roomId, collapsed, onCollapse, onClose }: { roomId: string; collapsed: boolean; onCollapse: () => void; onClose: () => void }) {
  const own = useSyncExternalStore(subscribeToOwnRoom, ownRoomState, ownRoomState);
  const { read } = useWatchRoom(roomId, { follow: false });
  const screen = useSyncExternalStore(subscribeToFloating, screenNow, noScreen);
  const player = useMusicPlayer();
  const { user } = useAuth();
  const forum = useForum();
  const catalogue = useCatalogue();
  const itemsById = useMemo(() => new Map(catalogue.items.map((item) => [item.id, item])), [catalogue.items]);
  const headroom = useLedgeHeadroom();
  const [goingLive, setGoingLive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  return (
    <>
      <DockWindow
        id="own-room"
        fill
        title="YOUR ROOM"
        badge={own.visitor ? 'IN THIS BROWSER' : 'JUST YOU'}
        onClose={onClose}
        onMinimize={onCollapse}
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
          <div className="flex flex-col gap-3" data-own-room-window={own.visitor ? 'browser' : 'account'}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
              <section aria-label="Screen" className="min-w-0 lg:flex-[2]" data-own-room-screen={videoOn ? 'video' : song !== null ? 'song' : 'empty'}>
                {videoOn ? (
                  // The site's one player sits exactly over this box while it is on screen: nothing is loaded again.
                  <PlayerBox id={screen.id} title={screen.title} className="aspect-video max-h-[60vh] w-full bg-ink-plate" />
                ) : song !== null ? (
                  <SongCoverCard track={song} fit="aspect-video max-h-[60vh] w-full" />
                ) : (
                  <div className="flex aspect-video max-h-[60vh] w-full items-center justify-center bg-ink-plate p-4 text-center text-label font-bold text-ink-bar">
                    NOTHING ON. PLAY SOMETHING, OR ADD TO THE QUEUE BELOW.
                  </div>
                )}
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-label text-ink">
                  <span className="font-bold">{title === null ? 'NOTHING ON' : `${videoOn ? 'VIDEO' : 'SONG'} :: ${title}`}</span>
                  <span className="text-ink-quiet">{waiting === 0 ? 'NOTHING QUEUED' : `${waiting} QUEUED`}</span>
                </p>
              </section>

              {/* Where a live room has its chat. Alone, there is nobody to talk to: the panel says so, and how to let people in. */}
              <aside aria-label="Who is here" className="shrink-0 frame p-2 text-label text-ink lg:w-72" data-own-room-alone={joined.length === 0 ? 'alone' : 'joined'}>
                {joined.length === 0 ? (
                  <>
                    <p className="text-key font-bold">JUST YOU HERE</p>
                    <p className="mt-1">
                      {own.visitor
                        ? 'This room is kept in this browser. Nobody else can see it or join it.'
                        : 'Nobody can see this room or join it unless you give them its link. It is saved to your account, so your queue follows you.'}
                    </p>
                  </>
                ) : (
                  <>
                    {/* Whoever joined by your link, so nobody follows along without you knowing (Luke, 2026-11-15). */}
                    <p className="text-key font-bold">IN YOUR ROOM BY YOUR LINK: {joined.length}</p>
                    <p className="mt-1 break-words" data-own-room-joined>
                      {joined.map((person) => person.label.toUpperCase()).join(', ')}
                    </p>
                    <p className="mt-1">They hear and see what you play, see your queue, and can add to it and draw. REMOVE is in the settings.</p>
                  </>
                )}
                {own.visitor || user === null ? null : (
                  <p className="mt-2">
                    <button type="button" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog" aria-expanded={settingsOpen} className={PLATE} data-own-room-settings>
                      [ ⚙ LINK AND SETTINGS ]
                    </button>
                  </p>
                )}
                <p className="mt-2">GO LIVE starts a new room that people can join, with chat and a canvas.</p>
                <p className="mt-2">
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

            <section aria-label="Queue">
              <StreamQueueWindow bare read={read} itemsById={itemsById} live userId={own.hostId} members={[]} nowLive={false} onClose={onClose} />
            </section>
          </div>
        )}
      </DockWindow>

      {/* The room's settings, as a live room's cog opens them: COPY LINK with REFRESH LINK beside it, and who joined, with REMOVE. */}
      {settingsOpen && readable && user !== null && account !== null ? <RoomSettingsWindow room={read.room} userId={account} look={null} onClose={() => setSettingsOpen(false)} /> : null}

      {/* The same menu GO LIVE opens everywhere (WHO CAN JOIN, PRIVATE picked); a video on the screen goes in from the same spot. */}
      {goingLive && user !== null ? (
        <GoLiveWindow
          user={user}
          createThread={forum.createThread}
          first={videoOn && screen.room !== undefined ? { source: screen.room, playId: screen.id, title: screen.title } : undefined}
          onClose={() => setGoingLive(false)}
        />
      ) : null}
    </>
  );
}
