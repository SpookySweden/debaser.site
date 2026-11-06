'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import GoLiveWindow from './GoLiveWindow';
import { useCatalogue } from '../lib/media/catalogue';
import { PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { useNow } from '../lib/ui/use-now';
import { roomIsLive } from '../lib/watch/rules';
import { getCanvasRepository } from '../lib/watch/canvas-repository';
import { enterRoom } from '../lib/watch/use-music-room';
import { useWatchRoom } from '../lib/watch/use-watch-room';
import { useWatching } from '../lib/watch/use-watching';
import { openWatch } from '../lib/watch/watch-window';
import type { AccountUser } from '../lib/auth/types';
import { useAuth } from './AuthProvider';
import CytubeLayout from './CytubeLayout';
import { useForum } from './ForumProvider';
import { useLiveStreams, usePrivateRoomLines, type LiveStreamRow } from './CytubeLiveStreams';
import StreamArtShelf from './StreamArtShelf';
import StreamQueueWindow from './StreamQueueWindow';

/**
 * The CYTUBE page (SPEC-cytube.md): what streaming here is, the live rooms, the stream canvases, and - always
 * above the tabs - GO LIVE (with the side panel's GO LIVE key, the only places a room is started) and CUSTOMIZE LAYOUT (your broadcast look).
 * Signed-in people only, like the archive: signed out it shows a sign-in prompt.
 *
 * The tab is in the address (`?tab=live`), so a link can open on the list of live rooms.
 */

type Tab = 'about' | 'live' | 'canvases';

const TABS: readonly { key: Tab; label: string }[] = [
  { key: 'about', label: 'ABOUT' },
  // Reads ROOM (Luke, 2026-11-05); the address keeps `?tab=live`, so old links still open it.
  { key: 'live', label: 'ROOM' },
  { key: 'canvases', label: 'CANVASES' },
];

/** How many live rooms the CANVASES tab asks about an open canvas. */
const OPEN_CANVAS_ROOMS = 12;

function readTab(value: string | null): Tab {
  return TABS.find((tab) => tab.key === value)?.key ?? 'about';
}

export default function CytubePage() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <p role="status" className="text-title font-bold text-ink">
        CHECKING YOUR SIGN-IN...
      </p>
    );
  }

  if (status !== 'signed-in' || user === null) {
    return (
      <section aria-labelledby="cytube-sign-in-title" className="flex flex-col items-start gap-3 py-2">
        <h2 id="cytube-sign-in-title" className="text-headline font-bold text-ink">
          SIGN IN TO USE STREAM
        </h2>
        <p className="text-prose text-ink">STREAM is for people with an account. Sign in to go live, join a room or pick your look.</p>
        <Link href="/account" className={PLATE_MAIN}>
          [ SIGN IN ]
        </Link>
      </section>
    );
  }

  return <SignedIn user={user} />;
}

function SignedIn({ user }: { user: AccountUser }) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = readTab(search.get('tab'));
  const [layoutOpen, setLayoutOpen] = useState(false);

  function show(next: Tab) {
    router.replace(next === 'about' ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <GoLiveKey user={user} />
        <button type="button" aria-expanded={layoutOpen} onClick={() => setLayoutOpen((open) => !open)} className={layoutOpen ? PLATE_PRESSED : PLATE} data-cytube-layout-key>
          [ CUSTOMIZE LAYOUT ]
        </button>
      </div>

      {layoutOpen ? <CytubeLayout userId={user.id} /> : null}

      {/* The tabs scroll sideways inside their strip on a narrow screen, never the page. */}
      <div className="flex min-w-0 flex-nowrap items-stretch gap-1 overflow-x-auto" role="tablist" aria-label="STREAM">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            id={`cytube-tab-${entry.key}`}
            aria-selected={tab === entry.key}
            aria-controls={`cytube-panel-${entry.key}`}
            onClick={() => show(entry.key)}
            className={`shrink-0 ${tab === entry.key ? `${PLATE_PRESSED} cursor-pointer` : PLATE}`}
          >
            [ {entry.label} ]
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`cytube-panel-${tab}`} aria-labelledby={`cytube-tab-${tab}`} className="min-w-0">
        {tab === 'about' ? <About /> : tab === 'live' ? <LiveRooms /> : <Canvases />}
      </div>
    </div>
  );
}

/**
 * GO LIVE: your room, empty, its screen black (SPEC-cytube.md). Already hosting a live room: back to it, never a
 * second one. One press opens the WHO CAN JOIN window, and START in it opens the room; it is the page's one main action.
 */
function GoLiveKey({ user }: { user: AccountUser }) {
  const forum = useForum();
  const watching = useWatching(user.id);
  const [asking, setAsking] = useState(false);
  const hosting = watching !== null && watching.hosting ? watching.roomId : null;

  function goLive() {
    if (hosting !== null) openWatch({ kind: 'room', roomId: hosting });
    else setAsking(true);
  }

  return (
    <>
      <button type="button" onClick={goLive} className={PLATE_MAIN} data-cytube-go-live={hosting === null ? 'new' : 'back'}>
        {hosting === null ? '[ GO LIVE ]' : '[ BACK TO YOUR ROOM ]'}
      </button>
      {asking ? <GoLiveWindow user={user} createThread={forum.createThread} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

/** ABOUT: streaming here, in plain words (written by the building session; Luke reviews). */
function About() {
  return (
    <div className="flex max-w-3xl flex-col gap-3 text-prose text-ink" data-cytube-about>
      <AboutPart title="ROOMS">
        A room is somebody&apos;s stream: everybody in it sees and hears the same thing at the same moment, and talks in its chat. Press GO LIVE
        to open yours. It starts empty, on a black screen with three keys - BOOKS, VIDEO and MUSIC - that open the queue with a search ready.
      </AboutPart>
      <AboutPart title="WHO CAN JOIN">
        GO LIVE asks first, with PRIVATE already picked. PRIVATE: only people with the room&apos;s link. PRIVATE + PASSWORD: the link and a password. Five
        wrong tries locks somebody out for ten minutes. OPEN: anyone. Everyone outside a private room sees that it is on and how much is going on, with names
        as ANON tags and words as bars. No account on the site can read a private room, the house account included. Going open later never opens what came
        before.
      </AboutPart>
      <AboutPart title="THE QUEUE AND ADDITIONS">
        What plays comes from the room&apos;s queue: red has played, green is on, blue is next. Anybody can add things. Without a crown, what
        you add waits on your own list until somebody with a crown pulls it into the queue. When the queue runs out, the screen goes black
        again until something new is queued.
      </AboutPart>
      <AboutPart title="CROWNS">
        The host holds a crown and can give one to anybody in the room. A crown puts things straight into the queue, moves them around and
        takes out what has not played yet. Playing, pausing, skipping and ending the stream stay with the host.
      </AboutPart>
      <AboutPart title="ROOM SETTINGS">
        The cog beside QUEUE is for the host and anybody with a crown. It lists who joined, each with REMOVE, names the room, gives it a topic, and sets who can add: anyone, or
        crowns only. It also copies the room&apos;s link and picks your look. The host alone changes who can join and the password.
      </AboutPart>
      <AboutPart title="THE STREAM BAR AND THE TV KEY">
        While you are in a room, the music bar along the foot of the screen becomes the stream&apos;s: what is on, what is next, and the
        room&apos;s keys. The TV key at its left turns it back into your music player, and back again.
      </AboutPart>
      <AboutPart title="MUSIC ROOMS">
        GO PUBLIC in the QUEUES window opens a room for your music. People who join hear what you play in their own music bar, add songs
        and talk in its chat. A room&apos;s queue takes songs and videos alike. Switch it off and it is kept for next time.
      </AboutPart>
      <AboutPart title="THE CANVAS">
        Every room has a shared drawing canvas. The canvas key on the screen switches your own screen to it, and back. Anybody in the room
        can draw on it and drag the chat&apos;s pictures and lines onto it. Nobody can clear it.
      </AboutPart>
      <AboutPart title="STREAM ART">
        Anybody in the room can save the canvas. Saved canvases are kept on the MEDIA page under STREAM ART, with everybody who was there,
        and are listed on the CANVASES tab here.
      </AboutPart>
      <AboutPart title="YOUR LOOK">
        CUSTOMIZE LAYOUT picks the colours your room is drawn in when you broadcast. In somebody else&apos;s room you see their look, or keep
        your own if you prefer.
      </AboutPart>
    </div>
  );
}

function AboutPart({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className={TITLE_BAR_INACTIVE}>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

/**
 * LIVE: every live room, each with JOIN and QUEUE. The list is `useLiveStreams` (./CytubeLiveStreams.tsx), the
 * one source the page reads.
 */
function LiveRooms() {
  const rooms = useLiveStreams();
  const privateRooms = usePrivateRoomLines();
  const [queueFor, setQueueFor] = useState<string | null>(null);

  if (rooms === null) return <p className="text-label font-bold text-ink">READING THE ROOMS...</p>;
  if (rooms.length === 0 && privateRooms.length === 0) return <p className="text-label font-bold text-ink">NOBODY IS LIVE.</p>;

  return (
    <>
      <ul className="flex flex-col" data-cytube-live>
        {rooms.map((room) => (
          <li key={room.roomId} className="rule-pixel flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-label text-ink" data-cytube-room={room.roomId}>
            <span className="shrink-0 bg-acid px-1 font-bold text-ink-plate">LIVE</span>
            <span className="font-bold">{room.hostName.toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate" title={room.title}>
              {room.kind === 'music' ? 'MUSIC' : 'STREAM'} :: {room.name ? `${room.name} :: ` : ''}
              {room.title.length > 0 ? room.title : 'NOTHING ON YET'}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {/* As QUEUES joins: a music room folded with the bar playing it, a video stream opened. */}
              <button type="button" onClick={() => enterRoom(room.roomId, room.kind)} className={PLATE} aria-label={`Join ${room.hostName}'s room`} data-cytube-join>
                [ JOIN ]
              </button>
              <button type="button" onClick={() => setQueueFor(room.roomId)} aria-haspopup="dialog" className={PLATE} aria-label={`${room.hostName}'s queue`}>
                [ QUEUE ]
              </button>
            </span>
          </li>
        ))}
        {/* No key: the link is the key (decision 1). */}
        {privateRooms.map((line, index) => (
          <li key={index} className="rule-pixel flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-label text-ink" data-cytube-private>
            <span className="shrink-0 bg-acid px-1 font-bold text-ink-plate">LIVE</span>
            <span className="font-bold">PRIVATE ROOM :: {line.joined} JOINED</span>
            <span className="min-w-0 flex-1 truncate">{line.messages} MESSAGES :: {line.strokes} STROKES</span>
          </li>
        ))}
      </ul>
      {queueFor === null ? null : <RoomQueue roomId={queueFor} onClose={() => setQueueFor(null)} />}
    </>
  );
}

/** A live room's queue window, to look before joining (outside a room it keeps its usual look). */
function RoomQueue({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { read } = useWatchRoom(roomId);
  const { user } = useAuth();
  const catalogue = useCatalogue();
  const now = useNow(5000);
  const itemsById = useMemo(() => new Map(catalogue.items.map((item) => [item.id, item])), [catalogue.items]);
  if (read === undefined || read === null) return null;
  return (
    <StreamQueueWindow read={read} itemsById={itemsById} live={roomIsLive(read.room, now)} userId={user?.id ?? null} members={[]} nowLive={false} onClose={onClose} />
  );
}

/**
 * CANVASES (SPEC-stream-art.md): the rooms whose canvas is open right now, then every saved STREAM ART piece - the
 * archive's own shelf, so the same pieces, credits and participant pop-up.
 */
function Canvases() {
  const rooms = useLiveStreams();
  const open = useOpenCanvases(rooms);

  return (
    <div className="flex min-w-0 flex-col gap-3" data-cytube-canvases>
      <section className="flex flex-col gap-1">
        <h2 className={TITLE_BAR_INACTIVE}>LIVE NOW</h2>
        {open === null ? (
          <p className="text-label font-bold text-ink">READING THE ROOMS...</p>
        ) : open.length === 0 ? (
          <p className="text-label font-bold text-ink">NO CANVAS IS OPEN.</p>
        ) : (
          <ul className="flex flex-col">
            {open.map((room) => (
              <li key={room.roomId} className="rule-pixel flex flex-wrap items-center gap-2 py-1.5 text-label text-ink" data-cytube-canvas-room={room.roomId}>
                <span className="font-bold">{room.hostName.toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate">{room.kind === 'music' ? 'MUSIC' : 'STREAM'}</span>
                <button type="button" onClick={() => enterRoom(room.roomId, room.kind)} className={PLATE} aria-label={`Join ${room.hostName}'s room`}>
                  [ JOIN ]
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-1">
        <h2 className={TITLE_BAR_INACTIVE}>STREAM ART</h2>
        <StreamArtShelf />
      </section>
    </div>
  );
}

/** Of the live rooms, the ones with an open canvas (one read per live room: there are only ever a few). */
function useOpenCanvases(rooms: LiveStreamRow[] | null): LiveStreamRow[] | null {
  const key = rooms === null ? null : rooms.map((room) => room.roomId).join(',');
  const [found, setFound] = useState<{ key: string; rooms: LiveStreamRow[] } | null>(null);
  const roomsNow = useRef(rooms);
  useEffect(() => {
    roomsNow.current = rooms;
  });
  useEffect(() => {
    const listed = roomsNow.current;
    if (key === null || listed === null) return;
    let alive = true;
    const shown = listed.slice(0, OPEN_CANVAS_ROOMS);
    void Promise.all(shown.map((room) => getCanvasRepository().findOpenCanvas(room.roomId).catch(() => null))).then((canvases) => {
      if (alive) setFound({ key, rooms: shown.filter((_, index) => canvases[index] !== null) });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  if (key === null) return null;
  return found?.key === key ? found.rooms : null;
}
