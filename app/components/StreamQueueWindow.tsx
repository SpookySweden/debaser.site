'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useCatalogue } from '../lib/media/catalogue';
import type { MediaItem } from '../lib/media/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { artSlot } from '../lib/ui/art/slots';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import { fetchEmbedTitle, isEmbedKind } from '../lib/watch/embeds';
import { LINK_TITLE_MAX, linkTitle, recognizeLink } from '../lib/watch/links';
import { getWatchRepository } from '../lib/watch/repository';
import {
  additionsPeople,
  dropSlot,
  formatMediaTime,
  mayTakeBack,
  moveInQueue,
  nextQueuePosition,
  placeInQueue,
  playOrder,
  queueRights,
  upcoming,
  waitingAdditions,
  type AdditionsPerson,
} from '../lib/watch/rules';
import { checkLink } from '../lib/watch/stream-player';
import type { WatchLink, WatchMember, WatchQueueEntry, WatchRoomRead } from '../lib/watch/types';
import { applyLocalChange } from '../lib/watch/use-watch-room';
import { isQueueableWebLink, watchLinkForItem } from '../lib/web/bridges';
import { searchEverywhere, type ProviderLine } from '../lib/web/everywhere-client';
import { rowAddresses } from '../lib/web/row-addresses';
import { PLATFORM_LABELS, type WebItem } from '../lib/web/types';
import ArtMark from './ArtMark';
import InfoFold from './InfoFold';
import PopoutWindow from './PopoutWindow';
import ProfileName from './ProfileName';
import SpriteSlot from './SpriteSlot';

/** The /web row's stand-in picture (`web-thumb-missing`), for a result whose platform gives none. */
const MISSING_THUMB_SRC = `/${artSlot('web-thumb-missing')?.path ?? 'assets/web/thumb-missing.png'}`;
/** The crowns (`mark-crown`, `mark-crown-filled` in app/lib/ui/art/slots.ts), shown at 16px. */
const CROWN_SRC = `/${artSlot('mark-crown')?.path ?? 'assets/icons/crown.png'}`;
const CROWN_HELD_SRC = `/${artSlot('mark-crown-filled')?.path ?? 'assets/icons/crown-filled.png'}`;
const CROWN_SIZE = 16;
/** Until the drawings land: the font's chess queens, hollow and filled, asked for as symbols. */
const CROWN_GLYPH = '♕︎';
const CROWN_HELD_GLYPH = '♛︎';
/** How long a row says QUEUED (or ADDED) after its add, so the list can stay up for the next one. */
const QUEUED_MS = 2000;
/** How far a pressed addition moves before it is picked up: less is a press, not a drag. */
const PICK_UP_PX = 6;

type StreamQueueWindowProps = {
  read: WatchRoomRead;
  itemsById: Map<string, MediaItem>;
  /** The room is live: once it is not, nothing is added, moved or crowned. */
  live: boolean;
  userId: string | null;
  /** The room's presence: everybody in it now is listed for the host, ready to be crowned. */
  members: WatchMember[];
  /** What is on is a live stream: it never ends, so nothing loops. */
  nowLive: boolean;
  onClose: () => void;
};

type Search =
  | { kind: 'none' }
  | { kind: 'searching'; words: string }
  | { kind: 'found'; words: string; ours: MediaItem[]; web: WebItem[]; problems: ProviderLine[]; next: string | null; loadingMore: boolean }
  | { kind: 'failed'; words: string; reason: string };

/** What an add says: QUEUED when a crown put it straight into the queue, ADDED when it went onto the adder's list. */
type AddedWords = 'QUEUED' | 'ADDED';

type LinkState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'added'; words: AddedWords } | { kind: 'refused'; reason: string };

/** An addition being dragged: where the pointer is, and the queue slot it would land in (null: not over the queue). */
type Drag = { entryId: string; title: string; x: number; y: number; slot: number | null };

/** The pointer's events on an addition a crown can drag. */
type PickUp = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
};

/** Words or an address: anything starting `http(s)://` is taken as a pasted link. */
function isAddress(text: string): boolean {
  return /^https?:\/\//i.test(text.trim());
}

/** Our own videos whose title has every word in it; no words, all of them. */
function ourMatches(videos: MediaItem[], words: string): MediaItem[] {
  const wanted = words.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  return videos.filter((video) => wanted.every((word) => video.title.toLowerCase().includes(word)));
}

/**
 * The stream room's queue as its own window (Luke, 2026-11-02), opened from the QUEUE line in the chat
 * column rather than unfolding there. Split down the middle (SPEC-stream-queue.md): the real queue on the
 * left, the additions waiting for it on the right; in a narrow window the two stack, the queue first.
 *
 * The queue: what played in red, what is on in green, what is queued in blue, each as its chip, in every
 * theme (`.queue-played` and its pair in globals.css hold the dyes themselves; a Sherbet theme would turn
 * the role tokens into one Orchid). Everybody sees it; a crown reorders it and takes out what has not played.
 *
 * The additions: an add from somebody without a crown waits on their own list (YOUR ADDITIONS, each with
 * `[ × ]` to take it back). The host and anybody they crown see one fold per person instead - the crown, the
 * name in its colour, how many - and with a crown pull an addition across: picked up and dropped where a line
 * in the queue shows (pointer events, so a finger works too; ESC puts it back), or `[ ← ]` onto the end.
 * Only the host presses a crown, their own included.
 *
 * The bar across the top searches WEB the way /web does (`searchEverywhere`, signed-in people only), with the
 * site's own videos first; the results take the additions' place until `[ ◀ ADDITIONS ]`. An address in the
 * bar is a pasted link instead (SPEC-watch-links.md): recognised as it is typed, its title filled in for
 * editing, and loaded once in this browser before it is added, so a link that won't play is refused here.
 * An empty search lists the site's own videos. ADD goes where the adder's crown says: QUEUED or ADDED.
 */
export default function StreamQueueWindow({ read, itemsById, live, userId, members, nowLive, onClose }: StreamQueueWindowProps) {
  const repository = getWatchRepository();
  const catalogue = useCatalogue();
  const roomId = read.room.id;
  const rights = queueRights(read.room, read.crowns, userId, live);
  const played = playOrder(read.queue);
  const waiting = upcoming(read.queue);
  const titleOf = (entry: WatchQueueEntry) =>
    entry.link !== null ? entry.link.title : entry.mediaItemId ? (itemsById.get(entry.mediaItemId)?.title ?? 'A FILE NOT HELD') : 'A FILE NO LONGER HELD';
  // Said in this window, over the dimmed room, not under the video where nobody would see it.
  const [problem, setProblem] = useState<string | null>(null);
  const fail = (fallback: string) => (failure: unknown) => setProblem(failure instanceof Error ? failure.message : fallback);

  /* --- adding: straight into the queue with a crown, otherwise onto your own list ----------------- */

  // The row just added reads QUEUED (or ADDED) for a moment.
  const [justAdded, setJustAdded] = useState<{ key: string; words: AddedWords } | null>(null);
  useEffect(() => {
    if (justAdded === null) return;
    const timer = window.setTimeout(() => setJustAdded(null), QUEUED_MS);
    return () => window.clearTimeout(timer);
  }, [justAdded]);

  /** One add, where the adder's crown says; drawn at once, before the store's echo. Null when signed out. */
  async function put(what: { mediaItemId: string } | { link: WatchLink }): Promise<AddedWords | null> {
    if (userId === null) return null;
    const inQueue = rights.addsTo === 'queue';
    const entry = await repository.addToQueue({ roomId, addedBy: userId, position: nextQueuePosition(read.queue), inQueue, ...what });
    applyLocalChange(roomId, { kind: 'entry', entry });
    return inQueue ? 'QUEUED' : 'ADDED';
  }

  async function addFile(mediaItemId: string) {
    setProblem(null);
    try {
      const words = await put({ mediaItemId });
      if (words !== null) setJustAdded({ key: `ours:${mediaItemId}`, words });
    } catch (failure) {
      fail('THE FILE COULD NOT BE ADDED.')(failure);
    }
  }

  async function addWeb(item: WebItem) {
    setProblem(null);
    const link = watchLinkForItem(item);
    if (link === null || !isQueueableWebLink(link)) {
      setProblem("THIS ONE CAN'T PLAY IN A ROOM.");
      return;
    }
    try {
      const words = await put({ link });
      if (words !== null) setJustAdded({ key: `web:${item.id}`, words });
    } catch (failure) {
      fail('IT COULD NOT BE ADDED.')(failure);
    }
  }

  /* --- the bar: words to search, or a pasted link ------------------------------------------------ */

  const [text, setText] = useState('');
  const [linkName, setLinkName] = useState('');
  const [nameTyped, setNameTyped] = useState(false);
  const [linkState, setLinkState] = useState<LinkState>({ kind: 'idle' });
  const [search, setSearch] = useState<Search>({ kind: 'none' });
  const address = isAddress(text);
  const verdict = address ? recognizeLink(text) : null;

  useEffect(() => {
    if (linkState.kind !== 'added') return;
    const timer = window.setTimeout(() => setLinkState({ kind: 'idle' }), QUEUED_MS);
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

  function type(next: string) {
    setText(next);
    if (linkState.kind === 'refused' || linkState.kind === 'added') setLinkState({ kind: 'idle' });
    // An emptied box starts over; a title the adder typed is kept while they fix the link.
    if (next.trim().length === 0) setNameTyped(false);
    else if (nameTyped) return;
    const recognised = isAddress(next) ? recognizeLink(next) : null;
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
    // ADD pressed before the site's title came back: ask once more rather than keep the placeholder.
    const named = !nameTyped && isEmbedKind(verdict.link.kind) && linkName === verdict.link.title ? ((await fetchEmbedTitle(verdict.link)) ?? linkName) : linkName;
    const link: WatchLink = { ...verdict.link, title: linkTitle(named, verdict.link.title) };
    try {
      const words = await put({ link });
      if (words === null) return;
      setText('');
      setLinkName('');
      setNameTyped(false);
      setLinkState({ kind: 'added', words });
    } catch (failure) {
      setLinkState({ kind: 'refused', reason: failure instanceof Error ? failure.message : 'THE LINK COULD NOT BE ADDED.' });
    }
  }

  const videos = catalogue.items.filter((item) => item.kind === 'video');

  /**
   * Which search is the newest. Only its answer is drawn: one overtaken by another search, or left behind
   * with `[ ◀ ADDITIONS ]`, would otherwise land seconds later over the additions or under the wrong words.
   */
  const searchRun = useRef(0);

  async function find(words: string, cursor: string | null = null) {
    const trimmed = words.trim();
    const run = cursor === null ? ++searchRun.current : searchRun.current;
    setProblem(null);
    if (cursor === null) setSearch({ kind: 'searching', words: trimmed });
    else setSearch((current) => (current.kind === 'found' ? { ...current, loadingMore: true } : current));
    const ours = ourMatches(videos, trimmed);
    // No words: only what the site holds (WEB needs something to look for).
    if (trimmed.length === 0) {
      setSearch({ kind: 'found', words: trimmed, ours, web: [], problems: [], next: null, loadingMore: false });
      return;
    }
    try {
      const page = await searchEverywhere(trimmed, cursor);
      if (run !== searchRun.current) return;
      const web = page.items.filter((item) => {
        const link = watchLinkForItem(item);
        return link !== null && isQueueableWebLink(link);
      });
      setSearch((current) =>
        cursor !== null && current.kind === 'found'
          ? { ...current, web: [...current.web, ...web.filter((item) => !current.web.some((known) => known.id === item.id))], next: page.nextCursor, loadingMore: false }
          : { kind: 'found', words: trimmed, ours, web, problems: page.problems, next: page.nextCursor, loadingMore: false },
      );
    } catch (failure) {
      if (run !== searchRun.current) return;
      const reason = failure instanceof Error ? failure.message : 'COULD NOT SEARCH.';
      // A later page that fails keeps what was already found.
      if (cursor !== null) {
        setSearch((current) => (current.kind === 'found' ? { ...current, loadingMore: false } : current));
        setProblem(reason);
        return;
      }
      setSearch({ kind: 'failed', words: trimmed, reason });
    }
  }

  function backToAdditions() {
    searchRun.current += 1;
    setSearch({ kind: 'none' });
  }

  /* --- a crown's work: pulling in, reordering, taking out; the host's: crowning --------------------- */

  /** A drop or `[ ← ]`: the places `placeInQueue` gives, drawn at once and read again if the store refuses. */
  async function place(entryId: string, slot: number) {
    if (userId === null) return;
    const moves = placeInQueue(read.queue, entryId, slot);
    if (moves.length === 0) return;
    setProblem(null);
    for (const move of moves) {
      const entry = read.queue.find((candidate) => candidate.id === move.id);
      if (entry !== undefined) applyLocalChange(roomId, { kind: 'entry', entry: { ...entry, position: move.position, inQueue: entry.inQueue || move.pull === true } });
    }
    try {
      await repository.reorderQueue(moves, userId);
    } catch (failure) {
      applyLocalChange(roomId, { kind: 'refresh' });
      fail('IT COULD NOT BE PUT IN THE QUEUE.')(failure);
    }
  }

  function reorder(entryId: string, direction: -1 | 1) {
    if (userId === null) return;
    setProblem(null);
    void repository.reorderQueue(moveInQueue(read.queue, entryId, direction), userId).catch(fail('THE QUEUE COULD NOT BE REORDERED.'));
  }

  /** An unplayed row out: a crown's `[ × ]` in the queue, or your own addition taken back. */
  function takeOut(entry: WatchQueueEntry, fallback: string) {
    if (userId === null) return;
    setProblem(null);
    void repository
      .removeFromQueue(entry.id, userId)
      .then(() => applyLocalChange(roomId, { kind: 'removed', table: 'queue', id: entry.id }))
      .catch(fail(fallback));
  }

  async function crown(person: AdditionsPerson) {
    if (userId === null) return;
    setProblem(null);
    try {
      const given = await repository.setCrown(roomId, person.userId, !person.crowned, userId);
      applyLocalChange(roomId, given === null ? { kind: 'uncrowned', userId: person.userId } : { kind: 'crown', crown: given });
    } catch (failure) {
      fail('THE CROWN COULD NOT BE CHANGED.')(failure);
    }
  }

  /* --- dragging an addition onto the queue ---------------------------------------------------------- */

  const queueZone = useRef<HTMLElement>(null);
  const queueList = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The pressed row (not yet a drag until it moves) and the drag itself, as the pointer's own events read them. */
  const press = useRef<{ entryId: string; title: string; x: number; y: number; pointerId: number } | null>(null);
  const dragNow = useRef<Drag | null>(null);

  function follow(next: Drag | null) {
    dragNow.current = next;
    setDrag(next);
  }

  /** The queue slot under the pointer: anywhere over the queue's half counts, and above its first queued row is 0. */
  function slotAt(x: number, y: number): number | null {
    const zone = queueZone.current?.getBoundingClientRect();
    if (zone === undefined || x < zone.left || x > zone.right || y < zone.top || y > zone.bottom) return null;
    const rows = queueList.current?.querySelectorAll<HTMLElement>('[data-queue-state="queued"]') ?? [];
    return dropSlot(
      [...rows].map((row) => {
        const box = row.getBoundingClientRect();
        return box.top + box.height / 2;
      }),
      y,
    );
  }

  // While something is picked up: ESC puts it back (and is kept from closing the window), and a release that
  // never reached its row - the row went, pulled in by somebody else - drops nothing.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const putBack = () => {
      press.current = null;
      dragNow.current = null;
      setDrag(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      putBack();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerup', putBack);
    window.addEventListener('pointercancel', putBack);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerup', putBack);
      window.removeEventListener('pointercancel', putBack);
    };
  }, [dragging]);

  /** What makes an addition row draggable for a crown: a press, a move past PICK_UP_PX, a release over the queue. */
  function pickUp(entry: WatchQueueEntry): PickUp {
    return {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button, a, input') !== null) return;
        press.current = { entryId: entry.id, title: titleOf(entry), x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const pressed = press.current;
        if (pressed === null || pressed.pointerId !== event.pointerId) return;
        if (dragNow.current === null && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < PICK_UP_PX) return;
        follow({ entryId: pressed.entryId, title: pressed.title, x: event.clientX, y: event.clientY, slot: slotAt(event.clientX, event.clientY) });
      },
      onPointerUp(event: ReactPointerEvent<HTMLElement>) {
        const pressed = press.current;
        const dropped = dragNow.current;
        press.current = null;
        follow(null);
        if (pressed === null || pressed.pointerId !== event.pointerId || dropped === null || dropped.slot === null) return;
        void place(dropped.entryId, dropped.slot);
      },
      onPointerCancel() {
        press.current = null;
        follow(null);
      },
    };
  }

  // Where the line in the queue shows the drop: above the queued row it would push down, under the last one
  // for the end, or under what is on when nothing is queued.
  const lineAt: { id: string; edge: 'top' | 'bottom' } | null =
    drag === null || drag.slot === null
      ? null
      : drag.slot < waiting.length
        ? { id: waiting[drag.slot].id, edge: 'top' }
        : waiting.length > 0
          ? { id: waiting[waiting.length - 1].id, edge: 'bottom' }
          : played.length > 0
            ? { id: played[played.length - 1].id, edge: 'bottom' }
            : null;
  const line = (entryId: string) => (lineAt !== null && lineAt.id === entryId ? <DropLine edge={lineAt.edge} /> : null);

  /* --- the window ------------------------------------------------------------------------------ */

  const searching = search.kind !== 'none';
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFold = (personId: string) =>
    setOpenFolds((current) => {
      const next = new Set(current);
      if (!next.delete(personId)) next.add(personId);
      return next;
    });

  const additionRow = (entry: WatchQueueEntry) => (
    <AdditionRow
      key={entry.id}
      entry={entry}
      title={titleOf(entry)}
      picked={drag?.entryId === entry.id}
      handlers={rights.arrange ? pickUp(entry) : undefined}
      onPull={rights.arrange ? () => void place(entry.id, waiting.length) : null}
      onTakeBack={mayTakeBack(entry, userId) ? () => takeOut(entry, "IT COULDN'T BE TAKEN BACK.") : null}
    />
  );

  return (
    <PopoutWindow title="QUEUE" onClose={onClose} maxWidth={rights.sees === 'nothing' ? 'max-w-3xl' : 'max-w-5xl'}>
      <div className="flex flex-col gap-2 p-2 text-label text-ink">
        {rights.add ? (
          // noValidate: the room says what is wrong with a link, not the browser's own bubble.
          <form
            noValidate
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (address) void addLink();
              else void find(text);
            }}
          >
            <div className="flex items-center gap-1">
              <label htmlFor="stream-queue-search" className="sr-only">
                Search WEB or paste a video link
              </label>
              <input
                id="stream-queue-search"
                type="search"
                value={text}
                onChange={(event) => type(event.target.value)}
                placeholder="SEARCH WEB OR PASTE A VIDEO LINK"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                className={`${FIELD_TIGHT} min-w-0 flex-1`}
              />
              <button type="submit" className={PLATE} disabled={search.kind === 'searching' || linkState.kind === 'checking'}>
                {address ? '[ + ADD ]' : '[ SEARCH ]'}
              </button>
            </div>
            {/* Kept on screen with nothing in it, so nothing under it moves when a link is pasted. */}
            <label htmlFor="stream-queue-link-title" className="sr-only">
              Title
            </label>
            <input
              id="stream-queue-link-title"
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
            <p className="font-bold" role="status" data-watch-link-state={linkState.kind}>
              {linkState.kind === 'checking' ? (
                'CHECKING THE LINK...'
              ) : linkState.kind === 'added' ? (
                linkState.words
              ) : linkState.kind === 'refused' ? (
                <span className="bg-bubble-pale px-1 text-ink-bar">{linkState.reason}</span>
              ) : (
                ' '
              )}
            </p>
          </form>
        ) : read.room.endedAt === null && userId === null ? (
          <p className="font-bold">
            {/* The room stays drawn on every page, and this window with it: going to log in closes it. */}
            <Link href="/account" className="key px-1 py-1 text-label" onClick={onClose}>
              [ LOG IN ]
            </Link>{' '}
            TO ADD VIDEOS
          </p>
        ) : null}

        {problem === null ? null : (
          <p className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">
            {problem}
          </p>
        )}

        {/* Side by side each half scrolls on its own; stacked, the window's body is the one thing that scrolls. */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start">
          {/* The queue: everybody reads it; a crown moves it, and drops an addition into it. */}
          <section ref={queueZone} aria-label="Queue" className="min-w-0 md:flex-1">
            <ol ref={queueList} className="md:max-h-[60vh] md:overflow-y-auto" aria-label="Queue" data-watch-queue>
              {played.length + waiting.length === 0 ? <li className="font-bold text-ink-quiet">NOTHING QUEUED.</li> : null}
              {played.map((entry) => {
                const now = entry.id === read.room.currentEntryId;
                return (
                  <li key={entry.id} className="rule-pixel relative flex items-center gap-2 py-1" data-queue-state={now ? 'now' : 'played'}>
                    {now ? (
                      <span className="queue-now w-16 shrink-0 px-1 text-center font-bold">▶ NOW</span>
                    ) : (
                      <span className="queue-played w-16 shrink-0 px-1 text-center font-bold">PLAYED</span>
                    )}
                    <span className={`min-w-0 flex-1 wrap-anywhere ${now ? 'font-bold' : ''}`}>{titleOf(entry)}</span>
                    {line(entry.id)}
                  </li>
                );
              })}
              {waiting.map((entry, index) => (
                <li key={entry.id} className="rule-pixel relative flex items-center gap-2 py-1" data-queue-state="queued">
                  <span className="queue-next w-16 shrink-0 px-1 text-center font-bold">{index + 1}</span>
                  <span className="min-w-0 flex-1 wrap-anywhere">{titleOf(entry)}</span>
                  {rights.arrange ? (
                    <span className="flex shrink-0 items-center">
                      <button type="button" className={PLATE} disabled={index === 0} aria-label={`Move ${titleOf(entry)} up`} onClick={() => reorder(entry.id, -1)}>
                        [ ↑ ]
                      </button>
                      <button
                        type="button"
                        className={PLATE}
                        disabled={index === waiting.length - 1}
                        aria-label={`Move ${titleOf(entry)} down`}
                        onClick={() => reorder(entry.id, 1)}
                      >
                        [ ↓ ]
                      </button>
                      <button type="button" className={PLATE} aria-label={`Take ${titleOf(entry)} out`} onClick={() => takeOut(entry, 'THE FILE COULD NOT BE TAKEN OUT.')}>
                        [ × ]
                      </button>
                    </span>
                  ) : null}
                  {line(entry.id)}
                </li>
              ))}
            </ol>
            {waiting.length === 0 && played.length > 0 && !nowLive ? <p className="text-ink-quiet">LAST VIDEO LOOPS.</p> : null}
          </section>

          {/* The additions (or a search's answer in their place); a narrow window puts a search's answer first. */}
          {rights.sees === 'nothing' ? null : (
            <section aria-label={rights.sees === 'people' ? 'Additions' : 'Your additions'} className={`min-w-0 md:flex-1 ${searching ? 'max-md:order-first' : ''}`}>
              {searching ? (
                <Results
                  search={search}
                  justAdded={justAdded}
                  addsTo={rights.addsTo}
                  onAddFile={(id) => void addFile(id)}
                  onAddWeb={(item) => void addWeb(item)}
                  onMore={(words, cursor) => void find(words, cursor)}
                  onBack={backToAdditions}
                />
              ) : rights.sees === 'people' ? (
                <>
                  <div className={TITLE_BAR}>
                    <span>ADDITIONS</span>
                  </div>
                  <div className="py-1">
                    <InfoFold topic="additions and crowns">
                      {rights.crown
                        ? 'WHAT PEOPLE ADD WAITS HERE UNTIL SOMEBODY WITH A CROWN DRAGS IT ONTO THE QUEUE OR PRESSES [ ← ]. PRESS A CROWN TO GIVE OR TAKE IT, YOURS TOO.'
                        : 'WHAT PEOPLE ADD WAITS HERE UNTIL SOMEBODY WITH A CROWN DRAGS IT ONTO THE QUEUE OR PRESSES [ ← ]. ONLY THE HOST GIVES CROWNS.'}
                    </InfoFold>
                  </div>
                  <ul className="md:max-h-[60vh] md:overflow-y-auto" aria-label="Everybody's additions" data-watch-additions="people">
                    {additionsPeople(read, members).map((person) => (
                      <PersonFold
                        key={person.userId}
                        person={person}
                        mine={person.userId === userId}
                        canCrown={rights.crown}
                        open={openFolds.has(person.userId)}
                        onToggle={() => toggleFold(person.userId)}
                        onCrown={() => void crown(person)}
                      >
                        {person.additions.length === 0 ? <li className="py-1 text-ink-quiet">NOTHING ADDED.</li> : person.additions.map(additionRow)}
                      </PersonFold>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <div className={TITLE_BAR}>
                    <span>YOUR ADDITIONS</span>
                  </div>
                  <div className="py-1">
                    <InfoFold topic="additions">SOMEBODY WITH A CROWN PULLS THESE INTO THE QUEUE.</InfoFold>
                  </div>
                  <YourAdditions entries={waitingAdditions(read.queue).filter((entry) => entry.addedBy === userId)} row={additionRow} />
                </>
              )}
            </section>
          )}
        </div>
      </div>

      {/* What is being dragged, under the pointer; out of the window's flow, so nothing in it moves. */}
      {drag !== null && typeof document !== 'undefined'
        ? createPortal(
            <div aria-hidden="true" className="queue-next pointer-events-none fixed z-overlay max-w-64 truncate px-1 text-label font-bold" style={{ left: drag.x + 12, top: drag.y + 12 }}>
              {drag.title}
            </div>,
            document.body,
          )
        : null}
    </PopoutWindow>
  );
}

/** The line in the queue where a dragged addition would land: drawn over the row's edge, so no row moves. */
function DropLine({ edge }: { edge: 'top' | 'bottom' }) {
  return <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 h-0.5 bg-accent-ink ${edge === 'top' ? '-top-px' : '-bottom-px'}`} data-drop-line={edge} />;
}

/** Somebody without a crown: their own additions, each with `[ × ]` until a crown pulls it in. */
function YourAdditions({ entries, row }: { entries: WatchQueueEntry[]; row: (entry: WatchQueueEntry) => ReactNode }) {
  return (
    <ul className="md:max-h-[60vh] md:overflow-y-auto" aria-label="Your additions" data-watch-additions="mine">
      {entries.length === 0 ? <li className="font-bold text-ink-quiet">NOTHING ADDED.</li> : entries.map(row)}
    </ul>
  );
}

/** One addition: draggable and `[ ← ]` for a crown, `[ × ]` for its own adder until it is pulled in. */
function AdditionRow({
  entry,
  title,
  picked,
  handlers,
  onPull,
  onTakeBack,
}: {
  entry: WatchQueueEntry;
  title: string;
  picked: boolean;
  handlers: PickUp | undefined;
  onPull: (() => void) | null;
  onTakeBack: (() => void) | null;
}) {
  return (
    <li
      {...handlers}
      className={`rule-pixel flex items-center gap-2 py-1 ${handlers === undefined ? '' : 'cursor-grab touch-pan-y select-none'} ${picked ? 'opacity-50' : ''}`}
      data-addition={entry.id}
    >
      <span className="min-w-0 flex-1 wrap-anywhere">{title}</span>
      {onPull === null ? null : (
        <button type="button" className={PLATE} aria-label={`Put ${title} at the end of the queue`} title="To the end of the queue" onClick={onPull}>
          [ ← ]
        </button>
      )}
      {onTakeBack === null ? null : (
        <button type="button" className={PLATE} aria-label={`Take back ${title}`} onClick={onTakeBack}>
          [ × ]
        </button>
      )}
    </li>
  );
}

/** A name to show: the room's presence knows somebody who is here; somebody who has left is asked of their profile. */
function useShownName(userId: string, name: string): string {
  const { profile, ready } = usePublicProfile(name.length > 0 ? null : userId);
  if (name.length > 0) return name;
  return profile.displayName.length > 0 ? profile.displayName : ready ? 'SOMEBODY' : '...';
}

/** One person on the right for the host and the crowned: crown, name in its colour, how many, and their fold. */
function PersonFold({
  person,
  mine,
  canCrown,
  open,
  onToggle,
  onCrown,
  children,
}: {
  person: AdditionsPerson;
  mine: boolean;
  canCrown: boolean;
  open: boolean;
  onToggle: () => void;
  onCrown: () => void;
  children: ReactNode;
}) {
  const name = useShownName(person.userId, person.name);

  return (
    <li className="rule-pixel py-1" data-person={person.userId} data-crowned={person.crowned ? 'yes' : 'no'}>
      <div className="flex items-center gap-1">
        <Crown held={person.crowned} name={name} mine={mine} canPress={canCrown} onPress={onCrown} />
        <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 cursor-pointer text-left wrap-anywhere hover:underline max-sm:min-h-tap">
          {open ? '[-]' : '[+]'} <ProfileName author={{ id: person.userId, displayName: name }} lamp={false} /> ({person.additions.length})
        </button>
        {person.host ? <span className="shrink-0 bg-acid px-1 font-bold text-ink-plate">HOST</span> : null}
      </div>
      {open ? (
        <ul className="pl-4" aria-label={`Added by ${name}`}>
          {children}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * A crown, filled for yes and hollow for no: a key for the host, a mark for everybody else (the asset rules: a
 * slot). A held crown also sits on a filled pill, the way every switch on the site says "on" (`PLATE_PRESSED`):
 * at 16px the font's two queens are hard to tell apart. One box in both states, so pressing it moves no name.
 */
function Crown({ held, name, mine, canPress, onPress }: { held: boolean; name: string; mine: boolean; canPress: boolean; onPress: () => void }) {
  const mark = held ? (
    <ArtMark key="held" src={CROWN_HELD_SRC} size={CROWN_SIZE} fallback={<span className="text-title leading-none">{CROWN_HELD_GLYPH}</span>} />
  ) : (
    <ArtMark key="none" src={CROWN_SRC} size={CROWN_SIZE} fallback={<span className="text-title leading-none">{CROWN_GLYPH}</span>} />
  );
  const box = 'inline-flex h-6 w-6 shrink-0 items-center justify-center';

  if (!canPress) {
    return (
      <span className={`${box} ${held ? 'bg-ink text-paper' : 'text-ink'}`} role="img" aria-label={held ? `${name} holds a crown` : `${name} holds no crown`} title={held ? 'Crowned' : 'No crown'}>
        {mark}
      </span>
    );
  }

  const action = held ? (mine ? 'Take your own crown off' : `Take ${name}'s crown`) : mine ? 'Put your crown back on' : `Crown ${name}`;
  return (
    <button type="button" className={`${held ? PLATE_PRESSED : PLATE} ${box}`} aria-pressed={held} aria-label={action} title={action} onClick={onPress} data-crown-key>
      {mark}
    </button>
  );
}

/** A search's answer in the additions' place: the site's own videos first, then WEB's, each with its ADD. */
function Results({
  search,
  justAdded,
  addsTo,
  onAddFile,
  onAddWeb,
  onMore,
  onBack,
}: {
  search: Exclude<Search, { kind: 'none' }>;
  justAdded: { key: string; words: AddedWords } | null;
  addsTo: 'queue' | 'list';
  onAddFile: (mediaItemId: string) => void;
  onAddWeb: (item: WebItem) => void;
  onMore: (words: string, cursor: string) => void;
  onBack: () => void;
}) {
  const added = (key: string) => (justAdded !== null && justAdded.key === key ? justAdded.words : null);

  return (
    <div className="flex flex-col gap-1" data-watch-results={search.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-bold wrap-anywhere">{search.words.length === 0 ? 'OUR VIDEOS' : `RESULTS :: ${search.words.toUpperCase()}`}</span>
        <button type="button" className={PLATE} onClick={onBack}>
          [ ◀ ADDITIONS ]
        </button>
      </div>
      {search.kind === 'searching' ? (
        <p className="font-bold">SEARCHING...</p>
      ) : search.kind === 'failed' ? (
        <p className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">
          {search.reason}
        </p>
      ) : (
        <ul className="md:max-h-[60vh] md:overflow-y-auto" aria-label="Results">
          {search.ours.length + search.web.length === 0 ? <li className="font-bold">NOTHING FOUND.</li> : null}
          {search.ours.map((video) => (
            <li key={video.id} className="rule-pixel flex items-center gap-2 py-1">
              <span className="w-24 shrink-0 bg-ice-pale px-1 text-center font-bold text-ink">OUR VIDEO</span>
              <span className="min-w-0 flex-1 wrap-anywhere">{video.title}</span>
              {video.length.length === 0 ? null : <span className="shrink-0">{video.length}</span>}
              <AddKey addsTo={addsTo} added={added(`ours:${video.id}`)} onAdd={() => onAddFile(video.id)} label={video.title} />
            </li>
          ))}
          {search.web.map((item) => (
            <WebResult key={item.id} item={item} addsTo={addsTo} added={added(`web:${item.id}`)} onAdd={() => onAddWeb(item)} />
          ))}
        </ul>
      )}
      {search.kind === 'found' && search.problems.length > 0 ? (
        <p className="flex flex-wrap gap-1">
          {search.problems.map((problem) => (
            <span key={problem.platform} className="bg-bubble-pale px-1 text-ink-bar">
              {problem.label}: {problem.problem}
            </span>
          ))}
        </p>
      ) : null}
      {search.kind === 'found' && search.next !== null ? (
        <button type="button" className={`${PLATE} w-fit`} disabled={search.loadingMore} onClick={() => onMore(search.words, search.next ?? '')}>
          {search.loadingMore ? '[ LOADING... ]' : '[ MORE ]'}
        </button>
      ) : null}
    </div>
  );
}

/** One WEB result: its picture (hotlinked, re-checked like every /web row), title, maker, where from, length. */
function WebResult({ item, addsTo, added, onAdd }: { item: WebItem; addsTo: 'queue' | 'list'; added: AddedWords | null; onAdd: () => void }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumb = thumbFailed ? null : rowAddresses(item).thumb;

  return (
    <li className="rule-pixel flex items-center gap-2 py-1">
      {/* A fixed box, so a slow or missing picture never moves the row. */}
      <span className="block h-18 w-24 shrink-0 overflow-hidden border border-ink-plate bg-paper">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- hotlinked from the platform, never proxied or copied (SPEC-web.md)
          <img src={thumb} alt="" width={96} height={72} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setThumbFailed(true)} className="block h-full w-full object-cover" />
        ) : (
          <SpriteSlot
            src={MISSING_THUMB_SRC}
            alt=""
            width={96}
            height={72}
            title="No picture"
            fallback={<span aria-hidden="true" className="flex h-full w-full items-center justify-center text-label font-bold text-ink">NO IMAGE</span>}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold wrap-anywhere">{item.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2">
          <span className="bg-ice-pale px-1 font-bold">{PLATFORM_LABELS[item.platform]}</span>
          {item.creator ? <span className="wrap-anywhere">{item.creator}</span> : null}
          {item.durationSeconds !== undefined && item.durationSeconds > 0 ? <span>{formatMediaTime(item.durationSeconds)}</span> : null}
        </span>
      </span>
      <AddKey addsTo={addsTo} added={added} onAdd={onAdd} label={item.title} />
    </li>
  );
}

/** ADD, or QUEUED / ADDED for a moment after it worked; its box is kept so the row never moves. */
function AddKey({ addsTo, added, onAdd, label }: { addsTo: 'queue' | 'list'; added: AddedWords | null; onAdd: () => void; label: string }) {
  return (
    <span className="w-24 shrink-0 text-right">
      {added !== null ? (
        <span className="font-bold" role="status">
          {added}
        </span>
      ) : (
        <button type="button" className={PLATE} onClick={onAdd} aria-label={addsTo === 'queue' ? `Add ${label} to the queue` : `Add ${label} to your list`}>
          [ + ADD ]
        </button>
      )}
    </span>
  );
}
