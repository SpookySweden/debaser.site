'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useCatalogue } from '../lib/media/catalogue';
import type { MediaItem } from '../lib/media/types';
import { artSlot } from '../lib/ui/art/slots';
import { FIELD_TIGHT, PLATE } from '../lib/ui/controls';
import { fetchEmbedTitle, isEmbedKind } from '../lib/watch/embeds';
import { LINK_TITLE_MAX, linkTitle, recognizeLink } from '../lib/watch/links';
import { getWatchRepository } from '../lib/watch/repository';
import { formatMediaTime, moveInQueue, nextQueuePosition, playOrder, upcoming } from '../lib/watch/rules';
import { checkLink } from '../lib/watch/stream-player';
import type { WatchLink, WatchQueueEntry, WatchRoomRead } from '../lib/watch/types';
import { applyLocalChange } from '../lib/watch/use-watch-room';
import { isQueueableWebLink, watchLinkForItem } from '../lib/web/bridges';
import { searchEverywhere, type ProviderLine } from '../lib/web/everywhere-client';
import { rowAddresses } from '../lib/web/row-addresses';
import { PLATFORM_LABELS, type WebItem } from '../lib/web/types';
import PopoutWindow from './PopoutWindow';
import SpriteSlot from './SpriteSlot';

/** The /web row's stand-in picture (`web-thumb-missing`), for a result whose platform gives none. */
const MISSING_THUMB_SRC = `/${artSlot('web-thumb-missing')?.path ?? 'assets/web/thumb-missing.png'}`;
/** How long a row says QUEUED after its add, so the list can stay up for the next one. */
const QUEUED_MS = 2000;

type StreamQueueWindowProps = {
  read: WatchRoomRead;
  itemsById: Map<string, MediaItem>;
  /** The host of a live room: reorders and takes out what has not played. */
  amHost: boolean;
  /** Signed in and the room is live: may add. */
  canAdd: boolean;
  userId: string | null;
  /** What is on is a live stream: it never ends, so nothing loops. */
  nowLive: boolean;
  onClose: () => void;
};

type Search =
  | { kind: 'none' }
  | { kind: 'searching'; words: string }
  | { kind: 'found'; words: string; ours: MediaItem[]; web: WebItem[]; problems: ProviderLine[]; next: string | null; loadingMore: boolean }
  | { kind: 'failed'; words: string; reason: string };

type LinkState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'queued' } | { kind: 'refused'; reason: string };

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
 * column rather than unfolding there.
 *
 * The list: what played in red, what is on in green, what is queued in blue, each as its chip, in every
 * theme (`.queue-played` and its pair in globals.css hold the dyes themselves; a Sherbet theme would turn
 * the role tokens into one Orchid). The host reorders and takes out what has not played.
 *
 * The bar across the top searches WEB the way /web does (`searchEverywhere`, signed-in people only), with the
 * site's own videos first; the results take the list's place in this window until the search is cleared.
 * An address in the bar is a pasted link instead (SPEC-watch-links.md): recognised as it is typed, its title
 * filled in for editing, and loaded once in this browser before it is added, so a link that won't play is
 * refused here. An empty search lists the site's own videos.
 */
export default function StreamQueueWindow({ read, itemsById, amHost, canAdd, userId, nowLive, onClose }: StreamQueueWindowProps) {
  const repository = getWatchRepository();
  const catalogue = useCatalogue();
  const played = playOrder(read.queue);
  const waiting = upcoming(read.queue);
  const titleOf = (entry: WatchQueueEntry) =>
    entry.link !== null ? entry.link.title : entry.mediaItemId ? (itemsById.get(entry.mediaItemId)?.title ?? 'A FILE NOT HELD') : 'A FILE NO LONGER HELD';
  // Said in this window, over the dimmed room, not under the video where nobody would see it.
  const [problem, setProblem] = useState<string | null>(null);
  const fail = (fallback: string) => (failure: unknown) => setProblem(failure instanceof Error ? failure.message : fallback);

  /* --- adding ---------------------------------------------------------------------------------- */

  // The row just added reads QUEUED for a moment.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  useEffect(() => {
    if (justAdded === null) return;
    const timer = window.setTimeout(() => setJustAdded(null), QUEUED_MS);
    return () => window.clearTimeout(timer);
  }, [justAdded]);

  async function addFile(mediaItemId: string) {
    if (userId === null) return;
    setProblem(null);
    try {
      const entry = await repository.addToQueue({ roomId: read.room.id, mediaItemId, addedBy: userId, position: nextQueuePosition(read.queue) });
      applyLocalChange(read.room.id, { kind: 'entry', entry });
      setJustAdded(`ours:${mediaItemId}`);
    } catch (failure) {
      fail('THE FILE COULD NOT BE ADDED.')(failure);
    }
  }

  async function addWeb(item: WebItem) {
    if (userId === null) return;
    setProblem(null);
    const link = watchLinkForItem(item);
    if (link === null || !isQueueableWebLink(link)) {
      setProblem("THIS ONE CAN'T PLAY IN A ROOM.");
      return;
    }
    try {
      const entry = await repository.addToQueue({ roomId: read.room.id, link, addedBy: userId, position: nextQueuePosition(read.queue) });
      applyLocalChange(read.room.id, { kind: 'entry', entry });
      setJustAdded(`web:${item.id}`);
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
    if (linkState.kind !== 'queued') return;
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
    if (linkState.kind === 'refused' || linkState.kind === 'queued') setLinkState({ kind: 'idle' });
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
      const entry = await repository.addToQueue({ roomId: read.room.id, link, addedBy: userId, position: nextQueuePosition(read.queue) });
      applyLocalChange(read.room.id, { kind: 'entry', entry });
      setText('');
      setLinkName('');
      setNameTyped(false);
      setLinkState({ kind: 'queued' });
    } catch (failure) {
      setLinkState({ kind: 'refused', reason: failure instanceof Error ? failure.message : 'THE LINK COULD NOT BE ADDED.' });
    }
  }

  const videos = catalogue.items.filter((item) => item.kind === 'video');

  /**
   * Which search is the newest. Only its answer is drawn: one overtaken by another search, or left behind
   * with `[ ◀ QUEUE ]`, would otherwise land seconds later over the queue or under the wrong words.
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

  function backToQueue() {
    searchRun.current += 1;
    setSearch({ kind: 'none' });
  }

  /* --- the window ------------------------------------------------------------------------------ */

  const searching = search.kind !== 'none';

  return (
    <PopoutWindow title="QUEUE" onClose={onClose} maxWidth="max-w-3xl">
      <div className="flex flex-col gap-2 p-2 text-label text-ink">
        {canAdd ? (
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
              ) : linkState.kind === 'queued' ? (
                'QUEUED'
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

        {searching ? (
          <Results
            search={search}
            justAdded={justAdded}
            canAdd={canAdd}
            onAddFile={(id) => void addFile(id)}
            onAddWeb={(item) => void addWeb(item)}
            onMore={(words, cursor) => void find(words, cursor)}
            onBack={backToQueue}
          />
        ) : (
          <>
            <ol className="max-h-[60vh] overflow-y-auto" aria-label="Queue" data-watch-queue>
              {played.length + waiting.length === 0 ? <li className="font-bold text-ink-quiet">NOTHING QUEUED.</li> : null}
              {played.map((entry) => {
                const now = entry.id === read.room.currentEntryId;
                return (
                  <li key={entry.id} className="rule-pixel flex items-center gap-2 py-1" data-queue-state={now ? 'now' : 'played'}>
                    {now ? (
                      <span className="queue-now w-16 shrink-0 px-1 text-center font-bold">▶ NOW</span>
                    ) : (
                      <span className="queue-played w-16 shrink-0 px-1 text-center font-bold">PLAYED</span>
                    )}
                    <span className={`min-w-0 flex-1 wrap-anywhere ${now ? 'font-bold' : ''}`}>{titleOf(entry)}</span>
                  </li>
                );
              })}
              {waiting.map((entry, index) => (
                <li key={entry.id} className="rule-pixel flex items-center gap-2 py-1" data-queue-state="queued">
                  <span className="queue-next w-16 shrink-0 px-1 text-center font-bold">{index + 1}</span>
                  <span className="min-w-0 flex-1 wrap-anywhere">{titleOf(entry)}</span>
                  {amHost ? (
                    <span className="flex shrink-0 items-center">
                      <button
                        type="button"
                        className={PLATE}
                        disabled={index === 0}
                        aria-label={`Move ${titleOf(entry)} up`}
                        onClick={() => void repository.reorderQueue(moveInQueue(read.queue, entry.id, -1)).catch(fail('THE QUEUE COULD NOT BE REORDERED.'))}
                      >
                        [ ↑ ]
                      </button>
                      <button
                        type="button"
                        className={PLATE}
                        disabled={index === waiting.length - 1}
                        aria-label={`Move ${titleOf(entry)} down`}
                        onClick={() => void repository.reorderQueue(moveInQueue(read.queue, entry.id, 1)).catch(fail('THE QUEUE COULD NOT BE REORDERED.'))}
                      >
                        [ ↓ ]
                      </button>
                      <button
                        type="button"
                        className={PLATE}
                        aria-label={`Take ${titleOf(entry)} out`}
                        onClick={() =>
                          void repository
                            .removeFromQueue(entry.id)
                            .then(() => applyLocalChange(read.room.id, { kind: 'removed', table: 'queue', id: entry.id }))
                            .catch(fail('THE FILE COULD NOT BE TAKEN OUT.'))
                        }
                      >
                        [ × ]
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            {waiting.length === 0 && played.length > 0 && !nowLive ? <p className="text-ink-quiet">LAST VIDEO LOOPS.</p> : null}
          </>
        )}
      </div>
    </PopoutWindow>
  );
}

/** A search's answer in the queue's place: the site's own videos first, then WEB's, each with its ADD. */
function Results({
  search,
  justAdded,
  canAdd,
  onAddFile,
  onAddWeb,
  onMore,
  onBack,
}: {
  search: Exclude<Search, { kind: 'none' }>;
  justAdded: string | null;
  canAdd: boolean;
  onAddFile: (mediaItemId: string) => void;
  onAddWeb: (item: WebItem) => void;
  onMore: (words: string, cursor: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-1" data-watch-results={search.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-bold wrap-anywhere">{search.words.length === 0 ? 'OUR VIDEOS' : `RESULTS :: ${search.words.toUpperCase()}`}</span>
        <button type="button" className={PLATE} onClick={onBack}>
          [ ◀ QUEUE ]
        </button>
      </div>
      {search.kind === 'searching' ? (
        <p className="font-bold">SEARCHING...</p>
      ) : search.kind === 'failed' ? (
        <p className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">
          {search.reason}
        </p>
      ) : (
        <ul className="max-h-[60vh] overflow-y-auto" aria-label="Results">
          {search.ours.length + search.web.length === 0 ? <li className="font-bold">NOTHING FOUND.</li> : null}
          {search.ours.map((video) => (
            <li key={video.id} className="rule-pixel flex items-center gap-2 py-1">
              <span className="w-24 shrink-0 bg-ice-pale px-1 text-center font-bold text-ink">OUR VIDEO</span>
              <span className="min-w-0 flex-1 wrap-anywhere">{video.title}</span>
              {video.length.length === 0 ? null : <span className="shrink-0">{video.length}</span>}
              <AddKey canAdd={canAdd} added={justAdded === `ours:${video.id}`} onAdd={() => onAddFile(video.id)} label={video.title} />
            </li>
          ))}
          {search.web.map((item) => (
            <WebResult key={item.id} item={item} canAdd={canAdd} added={justAdded === `web:${item.id}`} onAdd={() => onAddWeb(item)} />
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
function WebResult({ item, canAdd, added, onAdd }: { item: WebItem; canAdd: boolean; added: boolean; onAdd: () => void }) {
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
      <AddKey canAdd={canAdd} added={added} onAdd={onAdd} label={item.title} />
    </li>
  );
}

/** ADD, or QUEUED for a moment after it worked; its box is kept so the row never moves. */
function AddKey({ canAdd, added, onAdd, label }: { canAdd: boolean; added: boolean; onAdd: () => void; label: string }) {
  if (!canAdd) return null;
  return (
    <span className="w-24 shrink-0 text-right">
      {added ? (
        <span className="font-bold" role="status">
          QUEUED
        </span>
      ) : (
        <button type="button" className={PLATE} onClick={onAdd} aria-label={`Add ${label} to the queue`}>
          [ + ADD ]
        </button>
      )}
    </span>
  );
}
