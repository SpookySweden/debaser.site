'use client';

import Link from 'next/link';
import { useCallback, useEffect, useEffectEvent, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { lookClass, type LookId } from '../lib/cytube/looks';
import { useCatalogue } from '../lib/media/catalogue';
import type { MediaItem } from '../lib/media/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { useWatchingIn } from '../lib/watch/use-watching';
import { artSlot } from '../lib/ui/art/slots';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import { fetchEmbedTitle, isEmbedKind } from '../lib/watch/embeds';
import { LINK_REFUSALS, LINK_TITLE_MAX, linkTitle, recognizeLink } from '../lib/watch/links';
import { noteAddedHere } from '../lib/watch/outside-pictures';
import { PICTURE_REFUSALS, isTrustedPicture, mayTakeOutPicture, recognizePicture } from '../lib/watch/pictures';
import { keepsKind, QUEUE_LOOKUP_SOURCE, QUEUE_SOURCES, QUEUE_STREAM_SOURCE, queueSearchPlan, roomListable, screenIsBlank } from '../lib/watch/blank-screen';
import { getWebRepository } from '../lib/web/repository';
import { repositoryFor } from '../lib/watch/repository';
import { OWN_QUEUE_FULL, OWN_QUEUE_MAX } from '../lib/watch/own-room';
import { soloRefusal } from '../lib/watch/own-screen';
import {
  additionUnits,
  additionsPeople,
  dropSlot,
  formatMediaTime,
  hasCrown,
  mayTakeBack,
  moveInQueue,
  nextQueuePosition,
  placeInQueue,
  queueBlocks,
  queueRights,
  seriesRows,
  upcoming,
  upcomingUnits,
  waitingAdditions,
  type AdditionsPerson,
  type QueueUnit,
} from '../lib/watch/rules';
import { episodeLink, seriesMark, seriesTargetOf, type SeriesRead, type SeriesTarget } from '../lib/watch/series';
import { fetchSeries, useSeriesCount } from '../lib/watch/series-client';
import { checkLink } from '../lib/watch/stream-player';
import type { WatchLink, WatchMember, WatchQueueEntry, WatchRoomRead } from '../lib/watch/types';
import { applyLocalChange } from '../lib/watch/use-watch-room';
import { isQueueableWebLink, officialEmbedUrl, watchLinkForItem } from '../lib/web/bridges';
import { searchEverywhere, type EverywherePage, type ProviderLine } from '../lib/web/everywhere-client';
import type { WebStreamItem } from '../lib/web/dedupe';
import { oneRowPerTitle } from '../lib/web/live-merge';
import { rowAddresses } from '../lib/web/row-addresses';
import { authorList, matchesAuthor } from '../lib/web/search';
import { SITE_SERVER_LABEL } from '../lib/web/site-server';
import { PLATFORM_LABELS, type WebItem, type WebPlatform } from '../lib/web/types';
import { type MediaServerId } from '../lib/web/media-servers';
import { allAddNote, firstPick, pickedLine, pickHolders, roomAddFor, serverPlaysPick, type RoomAdd, type ServerPick } from '../lib/web/server-picks';
import ServerPickers from './ServerPickers';
import { heldEpisodes, type MediaInfo } from '../lib/web/media-titles';
import { searchOrder } from '../lib/web/web-sort';
import type { AudioTrack } from '../lib/audio/tracks';
import { songLink, songMatches, trackForSong } from '../lib/watch/songs';
import { listThings, playedSinceCleared, storedListItems, storedListName } from '../lib/watch/music-rooms';
import { NO_ROOM_YET } from '../lib/watch/my-queue';
import { ownRoomState } from '../lib/watch/own-room-client';
import { MAX_PLAYLIST_NAME, playlistId, type Playlist } from '../lib/audio/library';
import { isBarAudioPlatform, playsInBar } from '../lib/web/web-audio';
import { loadWebItem, webTrackNow } from '../lib/web/web-track-lookup';
import { KinoRow } from './WebMediaRow';
import ArtMark from './ArtMark';
import { useMusicLibrary } from './MusicLibraryProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import InfoFold from './InfoFold';
import { EntryLanguageFlags, EpisodeLanguageFlag, SeriesLanguageFlags, WithSeriesAudio } from './QueueLanguageFlags';
import PopoutWindow from './PopoutWindow';
import ProfileAvatarLink from './ProfileAvatarLink';
import ProfileName from './ProfileName';
import QueueSearchFilters from './QueueSearchFilters';
import SpriteSlot from './SpriteSlot';

/** The archive row's stand-in picture (`web-thumb-missing`), for a result whose platform gives none. */
const MISSING_THUMB_SRC = `/${artSlot('web-thumb-missing')?.path ?? 'assets/web/thumb-missing.png'}`;
/** The crowns (`mark-crown`, `mark-crown-filled` in app/lib/ui/art/slots.ts), shown at 16px. */
const CROWN_SRC = `/${artSlot('mark-crown')?.path ?? 'assets/icons/crown.png'}`;
const CROWN_HELD_SRC = `/${artSlot('mark-crown-filled')?.path ?? 'assets/icons/crown-filled.png'}`;
const CROWN_SIZE = 16;
/** Straight into the queue (`mark-add-queue`): a plus with a crown above it, shown at 16px. */
const ADD_QUEUE_SRC = `/${artSlot('mark-add-queue')?.path ?? 'assets/icons/add-queue.png'}`;
/** Until the drawings land: the font's chess queens, hollow and filled, asked for as symbols. */
const CROWN_GLYPH = '♕︎';
const CROWN_HELD_GLYPH = '♛︎';
/** How long a row says QUEUED (or ADDED) after its add, so the list can stay up for the next one. */
const QUEUED_MS = 2000;
/** How far a pressed addition moves before it is picked up: less is a press, not a drag. */
const PICK_UP_PX = 6;
/** The queue's titles in their state's colour: played red, on green, to come blue (Luke, 2026-11-02). */
const QUEUE_INK = { played: 'text-queue-played-ink', now: 'text-queue-now-ink', queued: 'text-queue-next-ink' } as const;

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
  /** A search to open with, already run: a blank screen's BOOKS / VIDEO / MUSIC key (SPEC-cytube.md). */
  prefill?: string;
  /** Opened from inside the room: the body goes Black and the frame and title wear the room's look. */
  inRoom?: boolean;
  look?: LookId | null;
  /** Drawn inside another window (the QUEUE window's UP NEXT tab, for your own room): no frame of its own. */
  bare?: boolean;
};

type Search =
  | { kind: 'none' }
  | { kind: 'searching'; words: string }
  | { kind: 'found'; words: string; ours: MediaItem[]; songs: AudioTrack[]; web: WebItem[]; problems: ProviderLine[]; next: string | null; loadingMore: boolean }
  | { kind: 'failed'; words: string; reason: string };

/** What an add says: QUEUED when a crown put it straight into the queue, ADDED when it went onto the adder's list. */
type AddedWords = 'QUEUED' | 'ADDED';

type LinkState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'added'; words: AddedWords } | { kind: 'refused'; reason: string };

/** An addition (a row, or a series' block by its id) being dragged: where the pointer is, and the queue slot it would land in (null: not over the queue). */
type Drag = { key: string; title: string; x: number; y: number; slot: number | null };

/** A pasted series link's episodes, as the window reads them (SPEC-stream-series.md). */
type SeriesState =
  | { kind: 'idle' }
  | { kind: 'reading'; key: string }
  | { kind: 'read'; key: string; read: SeriesRead }
  | { kind: 'failed'; key: string; reason: string };

/** A target as one string, so an effect can follow it. */
function targetKey(target: SeriesTarget): string {
  return target.source === 'internet_archive' ? `ia:${target.id}` : `yt:${target.list}`;
}

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

/** Our own videos whose title has every word in it (VIBE: any one); no words, all of them. `from:` keeps a file by its credit or filer, as the archive page does. */
/**
 * Podcast episodes for the queue (Luke, 2026-11-11): MEDIA's saved stream searched by the same words, keeping only the
 * podcasts' episodes the music bar can play. The stream is where podcasts are: no live search asks a podcast feed.
 */
async function savedPodcasts(words: string, authors: readonly string[]): Promise<WebStreamItem[]> {
  if (words.length === 0 && authors.length === 0) return [];
  try {
    const page = await getWebRepository().searchItems({ query: words, from: authors, limit: 40 });
    return page.items.filter((item) => item.platform === QUEUE_STREAM_SOURCE && playsInBar(item));
  } catch {
    return [];
  }
}

function ourMatches(videos: MediaItem[], words: string, anyWord: boolean, authors: readonly (readonly string[])[] | null): MediaItem[] {
  const wanted = words.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  return videos.filter((video) => {
    const hit = (word: string) => video.title.toLowerCase().includes(word);
    if (wanted.length > 0 && !(anyWord ? wanted.some(hit) : wanted.every(hit))) return false;
    return authors === null || matchesAuthor({ creator: video.credit }, authors) || matchesAuthor({ creator: video.uploadedByLabel }, authors);
  });
}

/**
 * Your own room is written to its store before something is added to it here: after END ROOM or a hand-on (and for a new
 * account) it is only in this browser until the next thing plays, and an add to a room the store does not hold is refused
 * (found by drive-own-room.cjs, list 3: "THE STREAM HAS ENDED." on [ + ADD ] after END ROOM). Any other room: nothing.
 */
async function ownRoomWritten(roomId: string): Promise<void> {
  const session = ownRoomState().session;
  if (session === null || session.id() !== roomId || session.isMade()) return;
  if (!(await session.ensureMade())) throw new Error('YOUR ROOM COULD NOT BE SAVED. TRY AGAIN.');
}

/**
 * The stream room's queue as its own window (Luke, 2026-11-02), opened from the QUEUE line in the chat
 * column rather than unfolding there. Split down the middle (SPEC-stream-queue.md): the real queue on the
 * left, the additions waiting for it on the right; in a narrow window the two stack, the queue first.
 *
 * The queue: what played in red, what is on in green, what is queued in blue - the titles themselves in
 * those colours (Luke, 2026-11-02), each a shade that reads on its theme's window (`queue-*-ink` in
 * themes.ts), one line each. Everybody sees it; a crown reorders it and takes out what has not played.
 *
 * The additions: an add from somebody without a crown waits on their own list (YOUR ADDITIONS, each with
 * `[ × ]` to take it back). The host and anybody they crown see one fold per person instead - the crown, the
 * name in its colour, how many - and with a crown pull an addition across: picked up and dropped where a line
 * in the queue shows (pointer events, so a finger works too; ESC puts it back), or `[ ← ]` onto the end.
 * Only the host presses a crown, their own included.
 *
 * The bar across the top searches the way the MEDIA page does (`searchEverywhere`, signed-in people only;
 * WEB until 2026-11-03), with the site's own videos first, marked DEBASER.SITE as the archive marks that server;
 * the results take the additions' place until `[ ◀ ADDITIONS ]`. An address in the
 * bar is a pasted link instead (SPEC-watch-links.md): recognised as it is typed, its title filled in for
 * editing, and loaded once in this browser before it is added, so a link that won't play is refused here.
 * An empty search lists the site's own videos. `[ + ADD ]` puts a video on your own list (ADDED); with a
 * crown a second key beside it, a plus under a crown, puts it straight into the queue (QUEUED).
 */
export default function StreamQueueWindow({ read, itemsById, live, userId, members, nowLive, onClose, prefill, inRoom = false, look = null, bare = false }: StreamQueueWindowProps) {
  // A visitor's own room lives in their browser (SPEC-rooms-queues.md); every other room is the site's.
  const repository = repositoryFor(read.room.id);
  /** Somebody's own room, with only them in it: it holds 200 things at most, and only what can play without a live room. */
  const ownRoom = read.room.origin === 'music';
  const catalogue = useCatalogue();
  const roomId = read.room.id;
  const rights = queueRights(read.room, read.crowns, userId, live);
  const watchingHere = useWatchingIn(read.room.id);
  // Since the last STORE AND START BLANK (SPEC-music-queues.md); a room never cleared shows every play.
  const played = playedSinceCleared(read);
  const waiting = upcoming(read.queue);
  // A song (SPEC-music-queues.md) is marked with a note, the way the music bar names what it plays.
  const titleOf = (entry: WatchQueueEntry) =>
    entry.link !== null
      ? entry.link.kind === 'audio'
        ? `♪ ${entry.link.title}`
        : entry.link.kind === 'picture'
          ? // An outside picture is marked in the queue, before it ever shows (SPEC-rooms-queues.md, section 6).
            `▣ ${isTrustedPicture(entry.link.url) ? '' : 'OUTSIDE :: '}${entry.link.title}`
          : entry.link.title
      : entry.mediaItemId
        ? (itemsById.get(entry.mediaItemId)?.title ?? 'A FILE NOT HELD')
        : 'A FILE NO LONGER HELD';
  // The site's own songs, as the music shelf holds them, for the search.
  const player = useMusicPlayer();
  const shelf = player.queue.slice(0, player.shelfSize);
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

  /** One add: onto your own list, or (`straight`, a crown's key) into the queue. Drawn at once; null signed out. */
  async function put(what: { mediaItemId: string } | { link: WatchLink }, straight: boolean): Promise<AddedWords | null> {
    if (userId === null) return null;
    if (ownRoom) {
      if (upcoming(read.queue).length >= OWN_QUEUE_MAX) throw new Error(OWN_QUEUE_FULL);
      const refusal = 'link' in what ? soloRefusal(what.link) : null;
      if (refusal !== null) throw new Error(refusal);
    }
    // A blank screen (the three keys) takes what is added straight into the queue, so it starts at once (Luke, 2026-11-16:
    // "it plays, no skip needed first"). Only for somebody who may arrange the queue: anybody else's still waits for a crown.
    const inQueue = (straight || ownRoom || screenIsBlank(read.room, read.queue)) && rights.arrange;
    await ownRoomWritten(roomId);
    const entry = await repository.addToQueue({ roomId, addedBy: userId, position: nextQueuePosition(read.queue), inQueue, ...what });
    applyLocalChange(roomId, { kind: 'entry', entry });
    return inQueue ? 'QUEUED' : 'ADDED';
  }

  async function addFile(mediaItemId: string, straight: boolean) {
    setProblem(null);
    try {
      const words = await put({ mediaItemId }, straight);
      if (words !== null) setJustAdded({ key: `ours:${mediaItemId}`, words });
    } catch (failure) {
      fail('THE FILE COULD NOT BE ADDED.')(failure);
    }
  }

  /** A series' ticked episodes as one block: onto your own list, or (`straight`) into the queue. Null signed out. */
  async function putSeries(title: string, links: WatchLink[], straight: boolean): Promise<AddedWords | null> {
    if (userId === null || links.length === 0) return null;
    if (ownRoom) {
      if (upcoming(read.queue).length + links.length > OWN_QUEUE_MAX) throw new Error(OWN_QUEUE_FULL);
      const refusal = links.map(soloRefusal).find((reason) => reason !== null) ?? null;
      if (refusal !== null) throw new Error(refusal);
    }
    const inQueue = (straight || ownRoom || screenIsBlank(read.room, read.queue)) && rights.arrange;
    await ownRoomWritten(roomId);
    const entries = await repository.addSeriesToQueue({ roomId, addedBy: userId, position: nextQueuePosition(read.queue), inQueue, seriesTitle: title, links });
    for (const entry of entries) applyLocalChange(roomId, { kind: 'entry', entry });
    return inQueue ? 'QUEUED' : 'ADDED';
  }

  /** A search result's series: the ticked episodes, or (never opened) every one. */
  async function addSeriesResult(item: WebItem, episodes: WatchLink[] | null, straight: boolean) {
    setProblem(null);
    try {
      const links = episodes ?? (await fetchSeries({ source: 'internet_archive', id: item.externalId })).episodes.map(episodeLink);
      const words = await putSeries(item.title, links, straight);
      if (words !== null) setJustAdded({ key: `web:${item.id}`, words });
    } catch (failure) {
      fail('THE SERIES COULD NOT BE ADDED.')(failure);
    }
  }

  /** One of the site's own songs (SPEC-music-queues.md): a song row, which the music bar plays. */
  async function addSong(track: AudioTrack, straight: boolean) {
    setProblem(null);
    try {
      const words = await put({ link: songLink(track) }, straight);
      if (words !== null) setJustAdded({ key: `song:${track.src}`, words });
    } catch (failure) {
      fail('THE SONG COULD NOT BE ADDED.')(failure);
    }
  }

  /** Archive audio the music bar streams from its platform: one song row, or an album's or a book's files as a block. */
  async function addWebAudio(item: WebItem, straight: boolean) {
    if (!isBarAudioPlatform(item.platform)) return;
    try {
      const tracks = await loadWebItem(item.platform, item.externalId);
      if (tracks === null || tracks.length === 0) {
        setProblem("THIS ONE CAN'T PLAY IN A ROOM.");
        return;
      }
      const words = tracks.length === 1 ? await put({ link: songLink(tracks[0]) }, straight) : await putSeries(item.title, tracks.map(songLink), straight);
      if (words !== null) setJustAdded({ key: `web:${item.id}`, words });
    } catch (failure) {
      fail('IT COULD NOT BE ADDED.')(failure);
    }
  }

  async function addWeb(item: WebItem, straight: boolean) {
    setProblem(null);
    if (playsInBar(item)) {
      await addWebAudio(item, straight);
      return;
    }
    const link = watchLinkForItem(item);
    if (link === null || !isQueueableWebLink(link)) {
      setProblem("THIS ONE CAN'T PLAY IN A ROOM.");
      return;
    }
    try {
      const words = await put({ link }, straight);
      if (words !== null) setJustAdded({ key: `web:${item.id}`, words });
    } catch (failure) {
      fail('IT COULD NOT BE ADDED.')(failure);
    }
  }

  /**
   * WATCH on a media server (Luke, 2026-11-07): what the row's pickers chose on the picked server (server-picks.ts): a film, an
   * episode, the whole-series player, or ALL, every episode as one block in one write, so nothing is ever half added. A show
   * longer than ALL takes at once says so in words (`allAddNote`).
   */
  async function addServer(item: WebItem, add: RoomAdd, straight: boolean) {
    setProblem(null);
    const links = add.kind === 'one' ? [add.link] : add.links;
    if (links.length === 0 || !links.every((link) => isQueueableWebLink(link))) {
      setProblem("THIS ONE CAN'T PLAY IN A ROOM.");
      return;
    }
    try {
      const words = add.kind === 'one' ? await put({ link: add.link }, straight) : await putSeries(add.title, add.links, straight);
      if (words !== null) setJustAdded({ key: `web:${item.id}`, words });
      const note = allAddNote(add);
      if (words !== null && note !== null) setProblem(note);
    } catch (failure) {
      fail('IT COULD NOT BE ADDED.')(failure);
    }
  }

  /* --- the bar: words to search, or a pasted link ------------------------------------------------ */

  const [text, setText] = useState(prefill ?? '');
  const [linkName, setLinkName] = useState('');
  const [nameTyped, setNameTyped] = useState(false);
  const [linkState, setLinkState] = useState<LinkState>({ kind: 'idle' });
  const [search, setSearch] = useState<Search>({ kind: 'none' });
  const searchBar = useRef<HTMLInputElement>(null);
  const address = isAddress(text);
  // A series link (an archive.org `details` page, a YouTube playlist) is read and ticked in a pop-up instead.
  const seriesTarget = address ? seriesTargetOf(text) : null;
  const verdict = address && seriesTarget === null ? recognizeLink(text) : null;

  /* --- a pasted series link: its episodes read once, then the tick pop-up --------------------------- */

  const [seriesFound, setSeriesState] = useState<SeriesState>({ kind: 'idle' });
  const [picking, setPicking] = useState<SeriesRead | null>(null);
  const seriesKey = seriesTarget === null ? null : targetKey(seriesTarget);
  // An answer counts only for the address in the bar now; until it comes, that address is being read.
  const seriesState: SeriesState =
    seriesKey === null ? { kind: 'idle' } : seriesFound.kind !== 'idle' && seriesFound.key === seriesKey ? seriesFound : { kind: 'reading', key: seriesKey };
  const popped = useRef<string | null>(null);
  useEffect(() => {
    if (seriesKey === null || seriesTarget === null) return;
    let stale = false;
    fetchSeries(seriesTarget).then(
      (found) => {
        if (stale) return;
        setSeriesState({ kind: 'read', key: seriesKey, read: found });
        // Two or more episodes: the pop-up opens by itself, once per pasted link.
        if (found.episodes.length >= 2 && popped.current !== seriesKey) {
          popped.current = seriesKey;
          setPicking(found);
        }
      },
      (failure: unknown) => {
        if (!stale) setSeriesState({ kind: 'failed', key: seriesKey, reason: failure instanceof Error ? failure.message : 'THE SERIES COULD NOT BE READ.' });
      },
    );
    return () => {
      stale = true;
    };
    // The target is read again only when the address names another one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey]);

  /** The bar's ADD for a series link: the pop-up again for a series; one video (or the Archive's own player) as one row. */
  async function addSeriesLink(straight: boolean) {
    if (seriesState.kind !== 'read') return;
    const found = seriesState.read;
    if (found.episodes.length >= 2) {
      setPicking(found);
      return;
    }
    let link: WatchLink | null = found.episodes.length === 1 ? { ...episodeLink(found.episodes[0]), title: found.title } : null;
    // An Archive item none of whose videos plays in a browser: its own player, as the archive page would queue it.
    if (link === null && found.target.source === 'internet_archive') {
      const url = officialEmbedUrl(`https://archive.org/embed/${found.target.id}`);
      link = url === null ? null : { url, kind: 'embed', title: found.title };
    }
    if (link === null) {
      setLinkState({ kind: 'refused', reason: 'NOTHING HERE PLAYS IN A ROOM.' });
      return;
    }
    try {
      const words = await put({ link }, straight);
      if (words === null) return;
      clearBar();
      setLinkState({ kind: 'added', words });
    } catch (failure) {
      setLinkState({ kind: 'refused', reason: failure instanceof Error ? failure.message : 'IT COULD NOT BE ADDED.' });
    }
  }

  /** The pop-up's ADD: the ticked episodes as one block. */
  async function addPicked(found: SeriesRead, links: WatchLink[], straight: boolean): Promise<string | null> {
    try {
      const words = await putSeries(found.title, links, straight);
      if (words === null) return null;
      setPicking(null);
      clearBar();
      setLinkState({ kind: 'added', words });
      return null;
    } catch (failure) {
      return failure instanceof Error ? failure.message : 'THE SERIES COULD NOT BE ADDED.';
    }
  }

  const closePicker = useCallback(() => setPicking(null), []);

  function clearBar() {
    popped.current = null;
    setText('');
    setLinkName('');
    setNameTyped(false);
  }

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
    // An emptied bar forgets the pop-up was shown: the same series pasted again opens it again.
    if (next.trim().length === 0) popped.current = null;
    if (linkState.kind === 'refused' || linkState.kind === 'added') setLinkState({ kind: 'idle' });
    // An emptied box starts over; a title the adder typed is kept while they fix the link.
    if (next.trim().length === 0) setNameTyped(false);
    else if (nameTyped) return;
    const recognised = isAddress(next) ? recognizeLink(next) : null;
    setLinkName(recognised?.ok ? recognised.link.title : '');
  }

  async function addLink(straight: boolean) {
    if (userId === null || verdict === null || linkState.kind === 'checking') return;
    // Not a video by its address: it may still be a picture whose address does not end in a picture's file name.
    // Its address rules decide whether it is tried at all, and the drawing test (in this browser) whether it is one.
    const guessed = !verdict.ok && verdict.reason === LINK_REFUSALS.notVideo ? recognizePicture(text) : null;
    // The picture rules' own refusal is the one to show (ONLY A PUBLIC WEB ADDRESS), not NOT A VIDEO LINK.
    const found = guessed ?? verdict;
    if (!found.ok) {
      setLinkState({ kind: 'refused', reason: found.reason });
      return;
    }
    setLinkState({ kind: 'checking' });
    const reason = await checkLink(found.link);
    if (reason !== null) {
      setLinkState({ kind: 'refused', reason: guessed !== null && reason === PICTURE_REFUSALS.wouldNotLoad ? PICTURE_REFUSALS.notEither : reason });
      return;
    }
    // Pasted here, checked here: this browser remembers the address as this viewer's own, so it shows for them
    // uncovered. Nothing else ever makes an outside picture "yours" (outside-pictures.ts).
    if (found.link.kind === 'picture' && !isTrustedPicture(found.link.url)) noteAddedHere(found.link.url);
    if (guessed !== null) {
      try {
        const words = await put({ link: { ...found.link, title: linkTitle(linkName, found.link.title) } }, straight);
        if (words === null) return;
        setText('');
        setLinkName('');
        setNameTyped(false);
        setLinkState({ kind: 'added', words });
      } catch (failure) {
        setLinkState({ kind: 'refused', reason: failure instanceof Error ? failure.message : 'THE LINK COULD NOT BE ADDED.' });
      }
      return;
    }
    if (!verdict.ok) return;
    // ADD pressed before the site's title came back: ask once more rather than keep the placeholder.
    const named = !nameTyped && isEmbedKind(verdict.link.kind) && linkName === verdict.link.title ? ((await fetchEmbedTitle(verdict.link)) ?? linkName) : linkName;
    const link: WatchLink = { ...verdict.link, title: linkTitle(named, verdict.link.title) };
    try {
      const words = await put({ link }, straight);
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
    // The filter words (a blank screen's keys, the filter rows, or typed: `type:video`, `in:youtube`, `from:`, `vibe:on`,
    // `sort:popular`) decide which of the site's files are listed and what the archive is asked (lib/watch/blank-screen.ts).
    const plan = queueSearchPlan(trimmed);
    const authors = authorList(plan.authors);
    const ours = plan.site.videos ? ourMatches(videos, plan.words, plan.vibe, authors) : [];
    const songs = plan.site.songs ? songMatches(shelf, plan.words, undefined, { listAll: plan.preset === 'music', anyWord: plan.vibe, authors }) : [];
    // No words: only what the site holds (the archive's other sources need something to look for).
    const ask = plan.ask;
    if (ask === null) {
      // One source and no words: nothing to list at all, so the bar asks for some rather than saying NOTHING FOUND.
      if (!plan.site.videos && !plan.site.songs) {
        setSearch({ kind: 'none' });
        setProblem('TYPE WHAT TO LOOK FOR.');
        return;
      }
      setSearch({ kind: 'found', words: trimmed, ours, songs, web: [], problems: [], next: null, loadingMore: false });
      return;
    }
    try {
      // Audio from beyond the live search (Luke, 2026-11-11: "audiobooks and other audio" in the queue), first page only:
      // podcast episodes from MEDIA's saved stream, and for BOOKS, LibriVox's audiobooks (asked only when named, like KINO).
      const firstPage = cursor === null;
      const wantsAudio = keepsKind(ask.keep, 'audio');
      const podcasts =
        firstPage && wantsAudio && (plan.source === 'all' || plan.source === QUEUE_STREAM_SOURCE) ? savedPodcasts(plan.words, plan.authors) : Promise.resolve([]);
      const audiobooks =
        firstPage && plan.preset === 'books' && plan.source === 'all' && plan.words.length > 0
          ? searchEverywhere(plan.words, null, 'audiobooks', plan.authors[0] ?? null, 'audio').then((found) => found.items, () => [])
          : Promise.resolve([]);
      const live =
        plan.source === QUEUE_STREAM_SOURCE
          ? Promise.resolve<EverywherePage>({ items: [], problems: [], nextCursor: null, link: null })
          : searchEverywhere(ask.words, cursor, plan.source === 'all' ? undefined : (plan.source as WebPlatform), plan.authors[0] ?? null, ask.type, {
              vibe: plan.vibe,
              order: searchOrder(plan.sort),
            });
      const [found, episodes, books] = await Promise.all([live, podcasts, audiobooks]);
      const page = { ...found, items: [...episodes, ...books, ...found.items] };
      if (run !== searchRun.current) return;
      const lookingUp = plan.source === QUEUE_LOOKUP_SOURCE;
      // A source a room cannot play from is still asked in an ALL search; its rows are never listed, so nor is its line.
      const problems = page.problems.filter((line) => lookingUp || QUEUE_SOURCES.some((option) => option.value === line.platform));
      // Videos a room can play, and audio the music bar streams from its platform (a song row). IMDB's films and shows
      // play nowhere and are listed anyway: they are looked up, not added.
      // A title on a friend's media server is listed too, with its WATCH ON row (blank-screen.ts `roomListable`).
      const web = page.items.filter((item) => roomListable(item, ask.keep, lookingUp));
      setSearch((current) =>
        cursor !== null && current.kind === 'found'
          ? { ...current, web: oneRowPerTitle([...current.web, ...web]), next: page.nextCursor, loadingMore: false }
          : { kind: 'found', words: trimmed, ours, songs, web: oneRowPerTitle(web), problems, next: page.nextCursor, loadingMore: false },
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

  /** A filter key: its word goes into the bar and the search runs again, as on the archive page. */
  function pickFilter(next: string) {
    type(next);
    void find(next);
    // A source with nothing typed has nothing to search yet: the caret goes where the words go, after a space, so what
    // is typed next is not read as part of the filter (`in:kinoalien`).
    const plan = queueSearchPlan(next);
    if (plan.ask === null && !plan.site.videos && !plan.site.songs) {
      type(`${next} `);
      searchBar.current?.focus();
    }
  }

  // A blank screen's key opened the window with its search filled in: it runs once, as if it had been typed.
  const ranPrefill = useRef(false);
  const findPrefill = useEffectEvent((words: string) => void find(words));
  useEffect(() => {
    if (prefill === undefined || ranPrefill.current) return;
    const frame = window.requestAnimationFrame(() => {
      ranPrefill.current = true;
      findPrefill(prefill);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [prefill]);

  /* --- a crown's work: pulling in, reordering, taking out; the host's: crowning --------------------- */

  /**
   * A drop or `[ ← ]`: the places `placeInQueue` gives (a row, or a series' whole block by its id), drawn at once
   * and read again if the store refuses.
   */
  async function place(key: string, slot: number) {
    if (userId === null) return;
    const moves = placeInQueue(read.queue, key, slot);
    if (moves.length === 0) return;
    setProblem(null);
    for (const move of moves) {
      const rows = move.series === true ? seriesRows(read.queue, move.id) : read.queue.filter((candidate) => candidate.id === move.id);
      for (const entry of rows) applyLocalChange(roomId, { kind: 'entry', entry: { ...entry, position: move.position, inQueue: entry.inQueue || move.pull === true } });
    }
    try {
      await repository.reorderQueue(moves, userId);
    } catch (failure) {
      applyLocalChange(roomId, { kind: 'refresh' });
      fail('IT COULD NOT BE PUT IN THE QUEUE.')(failure);
    }
  }

  function reorder(key: string, direction: -1 | 1) {
    if (userId === null) return;
    setProblem(null);
    void repository.reorderQueue(moveInQueue(read.queue, key, direction), userId).catch(fail('THE QUEUE COULD NOT BE REORDERED.'));
  }

  /** A series' block out (every episode of it not yet played): a crown's `[ × ]`, or your own taken back. */
  function takeOutSeries(seriesId: string, fallback: string) {
    if (userId === null) return;
    setProblem(null);
    const rows = seriesRows(read.queue, seriesId);
    void repository
      .removeSeries(seriesId, userId)
      .then(() => {
        for (const entry of rows) applyLocalChange(roomId, { kind: 'removed', table: 'queue', id: entry.id });
      })
      .catch(fail(fallback));
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
      // A crown given comes back as its row. One taken off is read again rather than assumed gone: the
      // database leaves a crown it will not let you take (the host changed a moment ago) without a word.
      applyLocalChange(roomId, given === null ? { kind: 'refresh' } : { kind: 'crown', crown: given });
    } catch (failure) {
      fail('THE CROWN COULD NOT BE CHANGED.')(failure);
    }
  }

  /* --- dragging an addition onto the queue ---------------------------------------------------------- */

  const queueZone = useRef<HTMLElement>(null);
  const queueList = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The pressed row (not yet a drag until it moves) and the drag itself, as the pointer's own events read them. */
  const press = useRef<{ key: string; title: string; x: number; y: number; pointerId: number } | null>(null);
  const dragNow = useRef<Drag | null>(null);

  function follow(next: Drag | null) {
    dragNow.current = next;
    setDrag(next);
  }

  /*
   * What the queue draws (SPEC-stream-series.md): what played and what is to come, each run of one series' episodes
   * as one folded block; and what a crown moves, a row or a block (`units`, which ↑ ↓, drops and [ ← ] count in).
   */
  const blocks = queueBlocks([...played, ...waiting]);
  const units = upcomingUnits(read.queue);
  const nowId = read.room.currentEntryId;
  /** The drawn block holding a unit: a lone row's id, or its block's key. */
  const blockOf = (unit: QueueUnit) => blocks.find((block) => block.entries.includes(unit.entries[0]))?.key ?? unit.id;
  /**
   * 1 while a series that has started (the one on screen, as a rule) still has episodes to come: they are unit 0,
   * drawn inside its block rather than as a queued row of their own, so the drop rows start after it.
   */
  const slotBase =
    units.length > 0 && units[0].series && blocks.some((block) => block.entries.includes(units[0].entries[0]) && block.entries.some((entry) => entry.playedAt !== null)) ? 1 : 0;

  /**
   * The queue slot under the pointer: anywhere over the queue's half (stretched to the window's row) counts; above
   * its first queued row is 0 - or 1 while a series plays, whose episodes still to come stay in its block (a drop
   * never lands inside the series on screen).
   */
  function slotAt(x: number, y: number): number | null {
    const zone = queueZone.current?.getBoundingClientRect();
    if (zone === undefined || x < zone.left || x > zone.right || y < zone.top || y > zone.bottom) return null;
    const rows = queueList.current?.querySelectorAll<HTMLElement>('[data-queue-state="queued"]') ?? [];
    return slotBase + dropSlot(
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
  function pickUp(key: string, title: string): PickUp {
    return {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button, a, input') !== null) return;
        press.current = { key, title, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const pressed = press.current;
        if (pressed === null || pressed.pointerId !== event.pointerId) return;
        // No button down: the release went somewhere else (Alt-Tab, the row went). Forget the press.
        if (event.buttons === 0) {
          press.current = null;
          if (dragNow.current !== null) follow(null);
          return;
        }
        if (dragNow.current === null && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < PICK_UP_PX) return;
        follow({ key: pressed.key, title: pressed.title, x: event.clientX, y: event.clientY, slot: slotAt(event.clientX, event.clientY) });
      },
      onPointerUp(event: ReactPointerEvent<HTMLElement>) {
        const pressed = press.current;
        const dropped = dragNow.current;
        press.current = null;
        follow(null);
        if (pressed === null || pressed.pointerId !== event.pointerId || dropped === null || dropped.slot === null) return;
        void place(dropped.key, dropped.slot);
      },
      onPointerCancel() {
        press.current = null;
        follow(null);
      },
    };
  }

  // Where the line in the queue shows the drop: above the queued row (or block) it would push down, under the last
  // one for the end, or under what is on when nothing is queued.
  const lastBlock = blocks[blocks.length - 1];
  const lineAt: { key: string; edge: 'top' | 'bottom' } | null =
    drag === null || drag.slot === null
      ? null
      : drag.slot < units.length
        ? { key: blockOf(units[drag.slot]), edge: 'top' }
        : lastBlock !== undefined
          ? { key: lastBlock.key, edge: 'bottom' }
          : null;
  const line = (key: string) => (lineAt !== null && lineAt.key === key ? <DropLine edge={lineAt.edge} /> : null);

  /* --- the window ------------------------------------------------------------------------------ */

  const searching = search.kind !== 'none';
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(() => new Set());
  // People's folds, the queue's series blocks and the additions' series blocks all start folded.
  const toggleFold = (key: string) =>
    setOpenFolds((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /** One addition waiting: a row, or a series' block (its episodes under a fold). */
  const additionRow = (unit: QueueUnit) => {
    if (!unit.series) {
      const entry = unit.entries[0];
      return (
        <AdditionRow
          key={entry.id}
          entry={entry}
          title={titleOf(entry)}
          picked={drag?.key === entry.id}
          handlers={rights.arrange ? pickUp(entry.id, titleOf(entry)) : undefined}
          onPull={rights.arrange ? () => void place(entry.id, units.length) : null}
          onTakeBack={mayTakeBack(entry, userId) ? () => takeOut(entry, "IT COULDN'T BE TAKEN BACK.") : null}
        />
      );
    }
    const title = unit.entries[0].series?.title ?? 'SERIES';
    const fold = `add:${unit.id}`;
    return (
      <AdditionBlock
        key={unit.id}
        unit={unit}
        title={title}
        open={openFolds.has(fold)}
        onToggle={() => toggleFold(fold)}
        picked={drag?.key === unit.id}
        handlers={rights.arrange ? pickUp(unit.id, title) : undefined}
        onPull={rights.arrange ? () => void place(unit.id, units.length) : null}
        onTakeBack={unit.entries.every((entry) => mayTakeBack(entry, userId)) ? () => takeOutSeries(unit.id, "IT COULDN'T BE TAKEN BACK.") : null}
        episodeOut={(entry) => (rights.arrange || mayTakeBack(entry, userId) ? () => takeOut(entry, 'THE EPISODE COULD NOT BE TAKEN OUT.') : null)}
        titleOf={titleOf}
      />
    );
  };

  const frame = (body: ReactNode) =>
    bare ? (
      <div data-own-queue>{body}</div>
    ) : (
      <PopoutWindow
        title="QUEUE"
        onClose={onClose}
        maxWidth={rights.sees === 'nothing' ? 'max-w-3xl' : 'max-w-5xl'}
        // Inside a room (SPEC-cytube.md): a Black body whatever the theme, the frame and title in the room's look.
        windowClassName={inRoom ? `room-black ${lookClass(look)} [--frame-line:var(--room-lines)]` : undefined}
        titleInk={inRoom ? 'text-room-title' : undefined}
      >
        {body}
      </PopoutWindow>
    );

  return frame(
    <>
      <div className="flex flex-col gap-2 p-2 text-label text-ink">
        {rights.add ? (
          // noValidate: the room says what is wrong with a link, not the browser's own bubble.
          <form
            noValidate
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (seriesTarget !== null) void addSeriesLink(false);
              else if (address) void addLink(false);
              else void find(text);
            }}
          >
            <div className="flex items-center gap-1">
              <label htmlFor="stream-queue-search" className="sr-only">
                Search media or paste a video or picture link
              </label>
              <input
                ref={searchBar}
                id="stream-queue-search"
                type="search"
                value={text}
                onChange={(event) => type(event.target.value)}
                placeholder="SEARCH MEDIA OR PASTE A VIDEO OR PICTURE LINK"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                className={`${FIELD_TIGHT} min-w-0 flex-1`}
              />
              <button type="submit" className={PLATE} disabled={search.kind === 'searching' || linkState.kind === 'checking' || (seriesTarget !== null && seriesState.kind !== 'read')}>
                {address ? '[ + ADD ]' : '[ SEARCH ]'}
              </button>
              {address && rights.arrange ? (
                <QueueKey
                  label="the link"
                  disabled={linkState.kind === 'checking' || (seriesTarget !== null && seriesState.kind !== 'read')}
                  onAdd={() => void (seriesTarget !== null ? addSeriesLink(true) : addLink(true))}
                />
              ) : null}
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
              ) : seriesTarget !== null && seriesState.kind === 'reading' ? (
                'READING THE SERIES...'
              ) : seriesTarget !== null && seriesState.kind === 'failed' && linkState.kind !== 'refused' ? (
                <span className="bg-bubble-pale px-1 text-ink-bar">{seriesState.reason}</span>
              ) : seriesTarget !== null && seriesState.kind === 'read' && linkState.kind === 'idle' ? (
                seriesState.read.episodes.length >= 2 ? `${seriesState.read.title.toUpperCase()} :: ${seriesMark(seriesState.read.episodes.length)}` : seriesState.read.title.toUpperCase()
              ) : linkState.kind === 'added' ? (
                linkState.words
              ) : linkState.kind === 'refused' ? (
                <span className="bg-bubble-pale px-1 text-ink-bar">{linkState.reason}</span>
              ) : (
                ' '
              )}
            </p>
            <QueueSearchFilters bar={text} disabled={address} onPick={pickFilter} />
          </form>
        ) : read.room.endedAt === null && userId === null ? (
          <p className="font-bold">
            {/* The room stays drawn on every page, and this window with it: going to log in closes it. */}
            <Link href="/account" className="key px-1 py-1 text-label" onClick={onClose}>
              [ LOG IN ]
            </Link>{' '}
            TO ADD VIDEOS
          </p>
        ) : live && read.room.addMode === 'crowns' ? (
          <p className="font-bold" data-watch-crowns-only>
            ONLY CROWNS CAN ADD TO THIS ROOM.
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
          <section ref={queueZone} aria-label="Queue" className="min-w-0 md:flex-1 md:self-stretch">
            <ol ref={queueList} className="md:max-h-[60vh] md:overflow-y-auto" aria-label="Queue" data-watch-queue>
              {played.length + waiting.length === 0 ? <li className="font-bold text-ink-quiet">NOTHING QUEUED.</li> : null}
              {blocks.map((block) => {
                const now = block.entries.some((entry) => entry.id === nowId);
                const queued = block.entries.every((entry) => entry.playedAt === null);
                const state = now ? 'now' : queued ? 'queued' : 'played';
                const unitIndex = queued ? units.findIndex((unit) => unit.entries[0] === block.entries[0]) : -1;
                const first = block.entries[0];
                const name = block.series === null ? titleOf(first) : block.series.title;
                // A crown's keys on what is still to come: up, down, out (a block's are for all its episodes).
                const keys =
                  rights.arrange && queued && unitIndex !== -1 ? (
                    <span className="flex shrink-0 items-center">
                      <button type="button" className={PLATE} disabled={unitIndex - 1 < slotBase} aria-label={`Move ${name} up`} onClick={() => reorder(units[unitIndex].id, -1)}>
                        [ ↑ ]
                      </button>
                      <button type="button" className={PLATE} disabled={unitIndex === units.length - 1} aria-label={`Move ${name} down`} onClick={() => reorder(units[unitIndex].id, 1)}>
                        [ ↓ ]
                      </button>
                      <button
                        type="button"
                        className={PLATE}
                        aria-label={`Take ${name} out`}
                        onClick={() => (block.series === null ? takeOut(first, 'THE FILE COULD NOT BE TAKEN OUT.') : takeOutSeries(block.series.id, 'THE SERIES COULD NOT BE TAKEN OUT.'))}
                      >
                        [ × ]
                      </button>
                    </span>
                  ) : queued && block.series === null && mayTakeOutPicture(first, read.room.hostId, userId) ? (
                    // A picture not yet shown: whoever added it, and the room's host, may take it out without a crown.
                    <button type="button" className={PLATE} aria-label={`Take ${name} out`} onClick={() => takeOut(first, 'THE PICTURE COULD NOT BE TAKEN OUT.')} data-picture-out>
                      [ × ]
                    </button>
                  ) : null;
                const said = now ? 'Now playing: ' : queued ? `Next ${unitIndex + 1}: ` : 'Played: ';

                if (block.series === null) {
                  return (
                    <li key={block.key} className="rule-pixel relative flex items-center gap-2 py-1" data-queue-state={state}>
                      <EntryLanguageFlags entry={first} title={name} className="shrink-0" />
                      <span className={`min-w-0 flex-1 truncate ${QUEUE_INK[state]}`} title={name}>
                        <span className="sr-only">{said}</span>
                        {name}
                      </span>
                      {keys}
                      {line(block.key)}
                    </li>
                  );
                }

                const open = openFolds.has(block.key);
                return (
                  <li key={block.key} className="rule-pixel relative py-1" data-queue-state={state} data-series-block={block.series.id}>
                    <div className="flex items-center gap-2">
                      <SeriesLanguageFlags entries={block.entries} title={name} titleOf={titleOf} className="shrink-0" />
                      <button
                        type="button"
                        onClick={() => toggleFold(block.key)}
                        aria-expanded={open}
                        title={name}
                        className={`min-w-0 flex-1 cursor-pointer truncate text-left hover:underline max-sm:min-h-tap ${QUEUE_INK[state]}`}
                      >
                        <span className="sr-only">{`${said}series, `}</span>
                        {open ? '[-]' : '[+]'} {name} ({block.entries.length})
                      </button>
                      {keys}
                    </div>
                    {open ? (
                      <ol className="pl-4" aria-label={`Episodes of ${name}`}>
                        <WithSeriesAudio entries={block.entries} title={name} titleOf={titleOf}>
                        {(blockAudio) => block.entries.map((entry) => {
                          const episodeState = entry.id === nowId ? 'now' : entry.playedAt === null ? 'queued' : 'played';
                          return (
                            <li key={entry.id} className="flex items-center gap-2 py-0.5" data-episode={entry.id} data-episode-state={episodeState}>
                              <EpisodeLanguageFlag entry={entry} title={titleOf(entry)} blockAudio={blockAudio} className="shrink-0" />
                              <span className={`min-w-0 flex-1 truncate ${QUEUE_INK[episodeState]}`} title={titleOf(entry)}>
                                {titleOf(entry)}
                              </span>
                              {rights.arrange && episodeState === 'queued' ? (
                                <button type="button" className={PLATE} aria-label={`Take ${titleOf(entry)} out`} onClick={() => takeOut(entry, 'THE EPISODE COULD NOT BE TAKEN OUT.')}>
                                  [ × ]
                                </button>
                              ) : null}
                            </li>
                          );
                        })}
                        </WithSeriesAudio>
                      </ol>
                    ) : null}
                    {line(block.key)}
                  </li>
                );
              })}
            </ol>
            {/* A stream room loops its last file when nothing is queued; your own room simply stops. */}
            {waiting.length === 0 && played.length > 0 && !nowLive && !ownRoom ? <p className="text-ink-quiet">LAST VIDEO LOOPS.</p> : null}
            {/* Every queue you may arrange. A playlist is an account's: a signed-out visitor's browser room has none to save into. */}
            {rights.arrange && userId !== null && live && !userId.startsWith('visitor:') ? <PlaylistKeys read={read} userId={userId} shelf={player.queue} waiting={waiting} /> : null}
          </section>

          {/* The additions (or a search's answer in their place); a narrow window puts a search's answer first. */}
          {rights.sees === 'nothing' ? null : (
            <section aria-label={rights.sees === 'people' ? 'Additions' : 'Your additions'} className={`min-w-0 md:flex-1 ${searching ? 'max-md:order-first' : ''}`}>
              {searching ? (
                <Results
                  search={search}
                  justAdded={justAdded}
                  crowned={rights.arrange}
                  onAddFile={(id, straight) => void addFile(id, straight)}
                  onAddWeb={(item, straight) => void addWeb(item, straight)}
                  onAddServer={(item, serverId, straight) => void addServer(item, serverId, straight)}
                  onAddSeries={(item, links, straight) => void addSeriesResult(item, links, straight)}
                  onAddSong={(track, straight) => void addSong(track, straight)}
                  onMore={(words, cursor) => void find(words, cursor)}
                  onFindToPlay={pickFilter}
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
                    {additionsPeople(read, members, watchingHere).map((person) => (
                      <PersonFold
                        key={person.userId}
                        person={person}
                        mine={person.userId === userId}
                        canCrown={rights.crown}
                        open={openFolds.has(person.userId)}
                        onToggle={() => toggleFold(person.userId)}
                        onCrown={() => void crown(person)}
                      >
                        {person.additions.length === 0 ? <li className="py-1 text-ink-quiet">NOTHING ADDED.</li> : additionUnits(person.additions).map(additionRow)}
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
                  <YourAdditions units={additionUnits(waitingAdditions(read.queue).filter((entry) => entry.addedBy === userId))} row={additionRow} />
                </>
              )}
            </section>
          )}
        </div>
      </div>

      {picking !== null && typeof document !== 'undefined' ? (
        <SeriesPicker read={picking} crowned={rights.arrange} onAdd={(links, straight) => addPicked(picking, links, straight)} onCancel={closePicker} />
      ) : null}

      {/* What is being dragged, under the pointer; out of the window's flow, so nothing in it moves. */}
      {drag !== null && typeof document !== 'undefined'
        ? createPortal(
            <div aria-hidden="true" className="frame pointer-events-none fixed z-overlay max-w-64 truncate bg-sun-pale px-1 text-label text-queue-next-ink" style={{ left: drag.x + 12, top: drag.y + 12 }}>
              {drag.title}
            </div>,
            document.body,
          )
        : null}
    </>,
  );
}

/** The line in the queue where a dragged addition would land: drawn over the row's edge, so no row moves. */
/**
 * The three keys under every queue you may arrange (SPEC-rooms-queues.md, phase 4: "a playlist is a saved queue"):
 * your own, or one you hold a crown in. They replaced the music room's STORE + START BLANK and LOAD A LIST.
 *
 * - SAVE AS PLAYLIST asks a name and saves what is on and what waits, in order, each thing kept whole (a song, a
 *   video, one of the site's own files). The queue is left as it is. A name already in use says so before the press.
 * - LOAD A PLAYLIST adds one of your playlists to the end of the queue. Nothing is taken out: CLEAR first to swap.
 * - CLEAR (two presses) empties what waits. What is on plays on, and people's own additions stay on their lists.
 */
function PlaylistKeys({ read, userId, shelf, waiting }: { read: WatchRoomRead; userId: string; shelf: readonly AudioTrack[]; waiting: readonly WatchQueueEntry[] }) {
  const repository = repositoryFor(read.room.id);
  const library = useMusicLibrary();
  const roomId = read.room.id;
  /** Your own room: its session writes (the browser first, the database after), and it holds only what plays alone. */
  const mine = read.room.origin === 'music' && read.room.hostId === userId;
  const [mode, setMode] = useState<'idle' | 'naming' | 'picking' | 'clearing'>('idle');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const wanted = name.trim();
  const taken = wanted.length > 0 && library.playlists.some((list) => list.id === playlistId(userId, wanted));

  async function save() {
    setBusy(true);
    setSaid(null);
    try {
      const at = new Date();
      const trackIdOf = (link: WatchLink) => {
        const track = trackForSong(link, shelf, webTrackNow(link.url));
        return track.id === link.url ? null : track.id;
      };
      const items = storedListItems(read, trackIdOf, at.toISOString());
      if (items.length === 0) {
        setSaid('NOTHING IN THE QUEUE TO SAVE.');
        return;
      }
      const list = await library.savePlaylist(wanted, items);
      setMode('idle');
      setSaid(`SAVED AS ${list.name}: ${items.length} ${items.length === 1 ? 'THING' : 'THINGS'}. THE QUEUE IS AS IT WAS.`);
    } catch (failure) {
      setSaid(failure instanceof Error ? failure.message : 'THE QUEUE COULD NOT BE SAVED.');
    } finally {
      setBusy(false);
    }
  }

  async function load(list: Playlist) {
    setMode('idle');
    setBusy(true);
    setSaid(null);
    try {
      const byId = new Map(shelf.map((track) => [track.id, track]));
      const things = listThings(list.items, (id) => byId.get(id) ?? webTrackNow(id) ?? undefined);
      if (things.length === 0) {
        setSaid('NOTHING IN THAT PLAYLIST PLAYS HERE.');
        return;
      }
      if (mine) {
        const session = ownRoomState().session;
        if (session === null) throw new Error(NO_ROOM_YET);
        const plays = things.filter((thing) => thing.link === undefined || soloRefusal(thing.link) === null);
        const added = session.enqueueThings(plays);
        const liveOnly = things.length - plays.length;
        setSaid(
          `${added} ADDED FROM ${list.name}.${added < plays.length ? ' THE REST WERE ALREADY WAITING, OR THE QUEUE IS FULL.' : ''}${liveOnly > 0 ? ` ${liveOnly} PLAY IN A LIVE ROOM ONLY.` : ''}`,
        );
        return;
      }
      const crowned = hasCrown(read.crowns, userId);
      let position = nextQueuePosition(read.queue);
      for (const thing of things) await repository.addToQueue({ roomId, addedBy: userId, position: position++, inQueue: crowned, ...thing });
      applyLocalChange(roomId, { kind: 'refresh' });
      setSaid(`${things.length} ADDED FROM ${list.name}.`);
    } catch (failure) {
      applyLocalChange(roomId, { kind: 'refresh' });
      setSaid(failure instanceof Error ? failure.message : 'THE PLAYLIST COULD NOT BE LOADED.');
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setMode('idle');
    setBusy(true);
    setSaid(null);
    try {
      if (mine) {
        const session = ownRoomState().session;
        if (session === null) throw new Error(NO_ROOM_YET);
        session.replaceWaiting([]);
      } else {
        await repository.removeOwnEntries(roomId, userId, waiting.map((entry) => entry.id));
        applyLocalChange(roomId, { kind: 'refresh' });
      }
      setSaid('THE QUEUE IS EMPTY. WHAT IS ON PLAYS ON.');
    } catch (failure) {
      setSaid(failure instanceof Error ? failure.message : 'THE QUEUE COULD NOT BE CLEARED.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1" data-playlist-keys>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={mode === 'naming' ? PLATE_PRESSED : PLATE}
          disabled={busy}
          aria-expanded={mode === 'naming'}
          onClick={() => {
            if (name.length === 0) setName(storedListName(new Date()));
            setMode((was) => (was === 'naming' ? 'idle' : 'naming'));
          }}
          title="Save what is on and what waits as one of your playlists. The queue stays as it is."
          data-save-playlist
        >
          [ SAVE AS PLAYLIST ]
        </button>
        <button type="button" className={mode === 'picking' ? PLATE_PRESSED : PLATE} disabled={busy} aria-expanded={mode === 'picking'} onClick={() => setMode((was) => (was === 'picking' ? 'idle' : 'picking'))} data-load-playlist>
          [ LOAD A PLAYLIST ]
        </button>
        <button
          type="button"
          className={mode === 'clearing' ? PLATE_PRESSED : PLATE}
          disabled={busy || waiting.length === 0}
          onClick={() => (mode === 'clearing' ? void clear() : setMode('clearing'))}
          onBlur={() => setMode((was) => (was === 'clearing' ? 'idle' : was))}
          title="Empty what waits. What is on plays on."
          data-clear-queue
        >
          {mode === 'clearing' ? '[ CLEAR THE QUEUE? ]' : '[ CLEAR ]'}
        </button>
      </div>
      {mode === 'naming' ? (
        <form
          className="flex flex-wrap items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && wanted.length > 0) void save();
          }}
        >
          <input value={name} maxLength={MAX_PLAYLIST_NAME} autoComplete="off" aria-label="Playlist name" onChange={(event) => setName(event.target.value)} className={`${FIELD_TIGHT} min-w-0 flex-1`} data-save-playlist-name />
          <button type="submit" className={PLATE} disabled={busy || wanted.length === 0} data-save-playlist-go>
            {taken ? '[ REPLACE IT ]' : '[ SAVE ]'}
          </button>
          {taken ? (
            <p className="w-full font-bold" role="status" data-save-playlist-taken>
              YOU HAVE A PLAYLIST BY THAT NAME: SAVING REPLACES WHAT IS IN IT.
            </p>
          ) : null}
        </form>
      ) : null}
      {mode === 'picking' ? (
        library.playlists.length === 0 ? (
          <p className="text-ink-quiet">NO PLAYLISTS YET.</p>
        ) : (
          <ul aria-label="Your playlists" className="flex flex-col gap-0.5">
            {library.playlists.map((list) => (
              <li key={list.id}>
                <button type="button" className="cursor-pointer truncate text-left font-bold hover:underline max-sm:min-h-tap" onClick={() => void load(list)} data-load-pick={list.name}>
                  {list.name} ({list.items.length})
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {said === null ? null : (
        <p className="font-bold" role="status" data-playlist-said>
          {said}
        </p>
      )}
    </div>
  );
}

function DropLine({ edge }: { edge: 'top' | 'bottom' }) {
  return <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 h-0.5 bg-accent-ink ${edge === 'top' ? '-top-px' : '-bottom-px'}`} data-drop-line={edge} />;
}

/** Somebody without a crown: their own additions, each with `[ × ]` until a crown pulls it in (a series as one block). */
function YourAdditions({ units, row }: { units: QueueUnit[]; row: (unit: QueueUnit) => ReactNode }) {
  return (
    <ul className="md:max-h-[60vh] md:overflow-y-auto" aria-label="Your additions" data-watch-additions="mine">
      {units.length === 0 ? <li className="font-bold text-ink-quiet">NOTHING ADDED.</li> : units.map(row)}
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
      <EntryLanguageFlags entry={entry} title={title} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={title}>
        {title}
      </span>
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

/**
 * A series waiting on somebody's list (SPEC-stream-series.md): one folded block, dragged, `[ ← ]`d and `[ × ]`d as
 * one; opened, its episodes, each with `[ × ]` for a crown (or its own adder) to drop it first.
 */
function AdditionBlock({
  unit,
  title,
  open,
  onToggle,
  picked,
  handlers,
  onPull,
  onTakeBack,
  episodeOut,
  titleOf,
}: {
  unit: QueueUnit;
  title: string;
  open: boolean;
  onToggle: () => void;
  picked: boolean;
  handlers: PickUp | undefined;
  onPull: (() => void) | null;
  onTakeBack: (() => void) | null;
  episodeOut: (entry: WatchQueueEntry) => (() => void) | null;
  titleOf: (entry: WatchQueueEntry) => string;
}) {
  return (
    <li className={`rule-pixel py-1 ${picked ? 'opacity-50' : ''}`} data-addition={unit.id} data-series-block={unit.id}>
      <div {...handlers} className={`flex items-center gap-2 ${handlers === undefined ? '' : 'cursor-grab touch-pan-y select-none'}`}>
        <SeriesLanguageFlags entries={unit.entries} title={title} titleOf={titleOf} className="shrink-0" />
        <button type="button" onClick={onToggle} aria-expanded={open} title={title} className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline max-sm:min-h-tap">
          <span className="sr-only">Series: </span>
          {open ? '[-]' : '[+]'} {title} ({unit.entries.length})
        </button>
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
      </div>
      {open ? (
        <ol className="pl-4" aria-label={`Episodes of ${title}`}>
          <WithSeriesAudio entries={unit.entries} title={title} titleOf={titleOf}>
          {(blockAudio) => unit.entries.map((entry) => {
            const out = episodeOut(entry);
            return (
              <li key={entry.id} className="flex items-center gap-2 py-0.5" data-episode={entry.id}>
                <EpisodeLanguageFlag entry={entry} title={titleOf(entry)} blockAudio={blockAudio} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate" title={titleOf(entry)}>
                  {titleOf(entry)}
                </span>
                {out === null ? null : (
                  <button type="button" className={PLATE} aria-label={`Take ${titleOf(entry)} out`} onClick={out}>
                    [ × ]
                  </button>
                )}
              </li>
            );
          })}
          </WithSeriesAudio>
        </ol>
      ) : null}
    </li>
  );
}

/** A name to show: the room's presence knows somebody who is here; somebody who has left is asked of their profile. */
function useShownName(userId: string, name: string): string {
  const { profile, ready } = usePublicProfile(name.length > 0 ? null : userId);
  if (name.length > 0) return name;
  return profile.displayName.length > 0 ? profile.displayName : ready ? 'SOMEBODY' : '...';
}

/** One person on the right for the host and the crowned: crown, picture, lamp and name in its colour, how many, their status line, and their fold. */
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
  const { profile } = usePublicProfile(person.userId);
  const status = profile.status.trim();
  const author = { id: person.userId, displayName: name };

  return (
    <li className="rule-pixel py-1" data-person={person.userId} data-crowned={person.crowned ? 'yes' : 'no'}>
      <div className="flex items-center gap-1">
        <Crown held={person.crowned} name={name} mine={mine} canPress={canCrown} onPress={onCrown} />
        <ProfileAvatarLink author={author} size={20} showName={false} variant="plain" className="shrink-0" />
        <button type="button" onClick={onToggle} aria-expanded={open} title={status.length > 0 ? status : undefined} className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline max-sm:min-h-tap">
          {open ? '[-]' : '[+]'} <ProfileName author={author} /> ({additionUnits(person.additions).length})
          {status.length > 0 ? <span className="ml-1 text-ink-quiet" data-person-status>{status}</span> : null}
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

/** A search's answer in the additions' place: the site's own videos (DEBASER.SITE) first, then the rest of the archive's, each with its ADD. */
function Results({
  search,
  justAdded,
  crowned,
  onAddFile,
  onAddWeb,
  onAddServer,
  onAddSeries,
  onAddSong,
  onMore,
  onFindToPlay,
  onBack,
}: {
  search: Exclude<Search, { kind: 'none' }>;
  justAdded: { key: string; words: AddedWords } | null;
  crowned: boolean;
  onAddFile: (mediaItemId: string, straight: boolean) => void;
  onAddWeb: (item: WebItem, straight: boolean) => void;
  onAddServer: (item: WebItem, add: RoomAdd, straight: boolean) => void;
  /** A series result's ticked episodes, or null for all of them (the fold never opened). */
  onAddSeries: (item: WebItem, links: WatchLink[] | null, straight: boolean) => void;
  /** One of the site's own songs. */
  onAddSong: (track: AudioTrack, straight: boolean) => void;
  onMore: (words: string, cursor: string) => void;
  /** An IMDB title's key: its name searched for among what a room can play. */
  onFindToPlay: (title: string) => void;
  onBack: () => void;
}) {
  const added = (key: string) => (justAdded !== null && justAdded.key === key ? justAdded.words : null);

  return (
    <div className="flex flex-col gap-1" data-watch-results={search.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-bold">{search.words.length === 0 ? 'OUR VIDEOS' : `RESULTS :: ${search.words.toUpperCase()}`}</span>
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
          {search.ours.length + search.songs.length + search.web.length === 0 ? <li className="font-bold">NOTHING FOUND.</li> : null}
          {search.ours.map((video) => (
            <li key={video.id} className="rule-pixel flex items-center gap-2 py-1">
              <span className="w-28 shrink-0 bg-ice-pale px-1 text-center font-bold text-ink">{SITE_SERVER_LABEL}</span>
              <span className="min-w-0 flex-1 truncate" title={video.title}>
                {video.title}
              </span>
              {video.length.length === 0 ? null : <span className="shrink-0">{video.length}</span>}
              <AddKey crowned={crowned} added={added(`ours:${video.id}`)} onAdd={(straight) => onAddFile(video.id, straight)} label={video.title} />
            </li>
          ))}
          {search.songs.map((track) => (
            <li key={track.src} className="rule-pixel flex items-center gap-2 py-1" data-song-result>
              <span className="w-28 shrink-0 bg-ice-pale px-1 text-center font-bold text-ink">{SITE_SERVER_LABEL}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate" title={track.title}>
                  ♪ {track.title}
                </span>
                {track.credit.length > 0 ? <span className="block truncate">{track.credit}</span> : null}
              </span>
              {track.length === '--:--' ? null : <span className="shrink-0">{track.length}</span>}
              <AddKey crowned={crowned} added={added(`song:${track.src}`)} onAdd={(straight) => onAddSong(track, straight)} label={track.title} />
            </li>
          ))}
          {search.web.map((item) => {
            const media = item.media;
            return media !== undefined ? (
              <KinoRow
                key={item.id}
                item={{ ...item, media }}
                titleId={`queue-title-${item.externalId}`}
                action={
                  <>
                    {media.copies.length > 0 ? (
                      <ServerWatch item={{ ...item, media }} crowned={crowned} added={added(`web:${item.id}`)} onAdd={(add, straight) => onAddServer(item, add, straight)} />
                    ) : null}
                    <button type="button" className={PLATE} onClick={() => onFindToPlay(item.title)} aria-label={`Search for "${item.title}" among what a room can play`} data-imdb-find>
                      [ FIND TO PLAY ]
                    </button>
                  </>
                }
              />
            ) : (
              <WebResult
                key={item.id}
                item={item}
                crowned={crowned}
                added={added(`web:${item.id}`)}
                onAdd={(straight) => onAddWeb(item, straight)}
                onAddSeries={(links, straight) => onAddSeries(item, links, straight)}
              />
            );
          })}
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

/**
 * One WEB result: its picture (hotlinked, re-checked like every archive row), title, maker, where from, length. A series
 * (an Archive item with 2+ videos, SPEC-stream-series.md) says `SERIES :: n EPISODES` beside its platform, and its
 * title is a fold, starting folded, opening to its episodes, each ticked; the ADD keys then add the ticked ones.
 */
function WebResult({
  item,
  crowned,
  added,
  onAdd,
  onAddSeries,
}: {
  item: WebItem;
  crowned: boolean;
  added: AddedWords | null;
  onAdd: (straight: boolean) => void;
  onAddSeries: (links: WatchLink[] | null, straight: boolean) => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumb = thumbFailed ? null : rowAddresses(item).thumb;
  // Audio the music bar plays is added as songs (a book's or an album's files as one block), never as a video series.
  const videoSeries = useSeriesCount(item);
  const count = playsInBar(item) ? null : videoSeries;
  const [open, setOpen] = useState(false);
  const [episodes, setEpisodes] = useState<{ kind: 'reading' } | { kind: 'read'; read: SeriesRead } | { kind: 'failed'; reason: string } | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => new Set());

  function toggle() {
    setOpen((was) => !was);
    if (episodes !== null) return;
    setEpisodes({ kind: 'reading' });
    fetchSeries({ source: 'internet_archive', id: item.externalId }).then(
      (found) => {
        setEpisodes({ kind: 'read', read: found });
        setTicked(new Set(found.episodes.map((_, index) => index)));
      },
      (failure: unknown) => setEpisodes({ kind: 'failed', reason: failure instanceof Error ? failure.message : 'THE SERIES COULD NOT BE READ.' }),
    );
  }

  if (count !== null) {
    const read = episodes?.kind === 'read' ? episodes.read : null;
    const links = read === null ? null : read.episodes.filter((_, index) => ticked.has(index)).map(episodeLink);
    return (
      <li className="rule-pixel py-1" data-series-result={item.id}>
        <div className="flex items-center gap-2">
          <ResultThumb thumb={thumb} onFailed={() => setThumbFailed(true)} />
          <span className="min-w-0 flex-1">
            <button type="button" onClick={toggle} aria-expanded={open} title={item.title} className="block w-full cursor-pointer truncate text-left font-bold hover:underline max-sm:min-h-tap">
              {open ? '[-]' : '[+]'} {item.title}
            </button>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2">
              <span className="bg-ice-pale px-1 font-bold">{PLATFORM_LABELS[item.platform]}</span>
              <span className="bg-acid px-1 font-bold text-ink-plate" data-series-mark>
                {seriesMark(count)}
              </span>
              {item.creator ? <span className="min-w-0 truncate">{item.creator}</span> : null}
            </span>
          </span>
          {/* Nothing ticked: both keys go quiet. */}
          <AddKey crowned={crowned} added={added} disabled={links !== null && links.length === 0} onAdd={(straight) => onAddSeries(links, straight)} label={item.title} />
        </div>
        {open ? (
          <div className="pl-4 pt-1">
            {episodes === null || episodes.kind === 'reading' ? (
              <p className="font-bold">READING THE EPISODES...</p>
            ) : episodes.kind === 'failed' ? (
              <p className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar">{episodes.reason}</p>
            ) : (
              <EpisodeTicks read={episodes.read} ticked={ticked} onTicked={setTicked} />
            )}
          </div>
        ) : null}
      </li>
    );
  }

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
        <span className="block truncate font-bold" title={item.title}>
          {item.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2">
          <span className="bg-ice-pale px-1 font-bold">{PLATFORM_LABELS[item.platform]}</span>
          {item.creator ? <span className="min-w-0 truncate">{item.creator}</span> : null}
          {item.durationSeconds !== undefined && item.durationSeconds > 0 ? <span>{formatMediaTime(item.durationSeconds)}</span> : null}
        </span>
      </span>
      <AddKey crowned={crowned} added={added} onAdd={onAdd} label={item.title} />
    </li>
  );
}

/**
 * `[ + ADD ]` onto your own list, and for a crown the crown-plus key beside it, straight into the queue; QUEUED or
 * ADDED for a moment after. The box is as wide as both keys either way, so the row never moves.
 */
/**
 * WATCH on a server (SPEC-media-servers.md; Luke 2026-11-07): the server to use — a picker when a title is on more
 * than one — and the add key (your own list, or straight into the queue for a crown). Shown on a KINO result a media
 * server holds, beside FIND TO PLAY.
 */
function ServerWatch({ item, crowned, added, onAdd }: { item: WebItem & { media: MediaInfo }; crowned: boolean; added: AddedWords | null; onAdd: (add: RoomAdd, straight: boolean) => void }) {
  const media = item.media;
  // The MEDIA page's choices (ServerPickers.tsx, server-picks.ts): FILM for a film series; WHOLE SERIES, SEASON and EPISODE for a
  // show, with ALL first in the EPISODE list (Luke, 2026-11-08). Until then a show always queued its whole-show player or first episode.
  const [pick, setPick] = useState<ServerPick>(() => firstPick(media));
  const holders = pickHolders(media, pick);
  const [chosen, setChosen] = useState<MediaServerId | undefined>(undefined);
  // The server picked, while it can play the pick; otherwise the first that can.
  const server = chosen !== undefined && holders.includes(chosen) ? chosen : holders[0];
  const wholeOffered = media.type === 'tv' && media.copies.some((copy) => serverPlaysPick(media, { ...pick, whole: true, all: false }, copy.server));
  const add = server === undefined ? null : roomAddFor(server, media, item.title, pick);
  if (media.copies.length === 0) return null;
  return (
    <div className="flex basis-full flex-col items-start gap-1" data-watch-server={server ?? 'none'}>
      <ServerPickers media={media} pick={pick} onPick={setPick} wholeOffered={wholeOffered} title={item.title} />
      {media.type === 'tv' && heldEpisodes(media).size > 0 && server !== undefined ? (
        <p className="text-label font-bold text-ink-quiet" data-picked-line>{`PICKED: ${pickedLine(media, pick, server)}`}</p>
      ) : null}
      <span className="flex flex-wrap items-center gap-1">
        <span className="font-bold">WATCH ON</span>
        {holders.length > 1 && server !== undefined ? (
          <select
            value={server}
            onChange={(event) => setChosen(event.target.value as MediaServerId)}
            aria-label={`Server for "${item.title}"`}
            className="min-h-tap border border-ink-plate bg-paper px-1 font-bold"
            data-pick-server
          >
            {holders.map((id) => (
              <option key={id} value={id}>
                {PLATFORM_LABELS[id]}
              </option>
            ))}
          </select>
        ) : server !== undefined ? (
          <span className="font-bold">{PLATFORM_LABELS[server]}</span>
        ) : (
          <span className="font-bold">NO SERVER HAS THIS PICK</span>
        )}
        {add !== null && server !== undefined ? (
          <AddKey crowned={crowned} added={added} onAdd={(straight) => onAdd(add, straight)} label={`${add.kind === 'one' ? add.link.title : `every episode of ${item.title}`} on ${PLATFORM_LABELS[server]}`} />
        ) : null}
      </span>
    </div>
  );
}

function AddKey({
  crowned,
  added,
  onAdd,
  label,
  disabled = false,
}: {
  crowned: boolean;
  added: AddedWords | null;
  onAdd: (straight: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className={`flex shrink-0 items-center justify-end ${crowned ? 'w-36' : 'w-24'}`}>
      {added !== null ? (
        <span className="font-bold" role="status">
          {added}
        </span>
      ) : (
        <>
          <button type="button" className={PLATE} disabled={disabled} onClick={() => onAdd(false)} aria-label={`Add ${label} to your list`}>
            [ + ADD ]
          </button>
          {crowned ? <QueueKey label={label} disabled={disabled} onAdd={() => onAdd(true)} /> : null}
        </>
      )}
    </span>
  );
}

/**
 * A crown's add, straight into the queue: a plus under a crown (`mark-add-queue`, the asset rules: a slot), and
 * until it is drawn the font's filled queen stacked over a plus.
 */
function QueueKey({ label, disabled = false, onAdd }: { label: string; disabled?: boolean; onAdd: () => void }) {
  return (
    <button type="button" className={`${PLATE} shrink-0`} disabled={disabled} onClick={onAdd} aria-label={`Add ${label} straight to the queue`} title="Straight into the queue" data-add-queue>
      <ArtMark
        src={ADD_QUEUE_SRC}
        size={CROWN_SIZE}
        fallback={
          <span className="flex flex-col items-center leading-none">
            <span>{CROWN_HELD_GLYPH}</span>
            <span>+</span>
          </span>
        }
      />
    </button>
  );
}

/** A result's picture box: hotlinked, a fixed box so a slow or missing picture never moves the row. */
function ResultThumb({ thumb, onFailed }: { thumb: string | null; onFailed: () => void }) {
  return (
    <span className="block h-18 w-24 shrink-0 overflow-hidden border border-ink-plate bg-paper">
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- hotlinked from the platform, never proxied or copied (SPEC-web.md)
        <img src={thumb} alt="" width={96} height={72} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={onFailed} className="block h-full w-full object-cover" />
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
  );
}

/**
 * A series' episodes, each with a tick (all ticked to start), and `[ TICK ALL ]` / `[ TICK NONE ]`. The list scrolls
 * on its own however long the series is.
 */
function EpisodeTicks({ read, ticked, onTicked }: { read: SeriesRead; ticked: ReadonlySet<number>; onTicked: (next: ReadonlySet<number>) => void }) {
  const all = read.episodes.length;
  return (
    <div className="flex flex-col gap-1" data-episode-ticks={all}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="min-w-0 flex-1 font-bold">{`${ticked.size} OF ${all} TICKED`}</span>
        <button type="button" className={PLATE} disabled={ticked.size === all} onClick={() => onTicked(new Set(read.episodes.map((_, index) => index)))}>
          [ TICK ALL ]
        </button>
        <button type="button" className={PLATE} disabled={ticked.size === 0} onClick={() => onTicked(new Set())}>
          [ TICK NONE ]
        </button>
      </div>
      {read.partial ? <p className="text-ink-quiet">{`THE FIRST ${all} EPISODES: THE REST TOOK TOO LONG TO READ.`}</p> : null}
      <ul className="max-h-[40vh] overflow-y-auto" aria-label={`Episodes of ${read.title}`}>
        {read.episodes.map((episode, index) => (
          <li key={`${index}-${episode.url}`}>
            <label className="flex cursor-pointer items-center gap-2 py-0.5 max-sm:min-h-tap">
              <input
                type="checkbox"
                checked={ticked.has(index)}
                onChange={(event) => {
                  const next = new Set(ticked);
                  if (event.target.checked) next.add(index);
                  else next.delete(index);
                  onTicked(next);
                }}
              />
              <span className="min-w-0 flex-1 truncate" title={episode.title}>
                {episode.title}
              </span>
              {episode.seconds === null ? null : <span className="shrink-0 tabular-nums">{formatMediaTime(episode.seconds)}</span>}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The pop-up a pasted series link opens over the queue window (SPEC-stream-series.md), like a torrent client's
 * "which files" window: the series' name, every episode ticked, the two ADD keys and `[ CANCEL ]`. ESC and a press
 * on the dimmed window behind close it alone, never the queue window under it.
 */
function SeriesPicker({
  read,
  crowned,
  onAdd,
  onCancel,
}: {
  read: SeriesRead;
  crowned: boolean;
  /** The ticked episodes as one block; resolves to a refusal to show, or null once added. */
  onAdd: (links: WatchLink[], straight: boolean) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => new Set(read.episodes.map((_, index) => index)));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  async function add(straight: boolean) {
    const links = read.episodes.filter((_, index) => ticked.has(index)).map(episodeLink);
    if (links.length === 0 || busy) return;
    setBusy(true);
    setRefusal(null);
    const said = await onAdd(links, straight);
    setBusy(false);
    if (said !== null) setRefusal(said);
  }

  const none = ticked.size === 0;
  return createPortal(
    <div className="fixed inset-0 z-overlay flex items-start justify-center overflow-y-auto bg-hardware/60 p-4 sm:p-8" onMouseDown={onCancel}>
      <div
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Pick episodes of ${read.title}`}
        onMouseDown={(event) => event.stopPropagation()}
        className="frame mt-6 w-full max-w-xl bg-sun-pale text-label text-ink"
        data-series-picker
      >
        <div className={TITLE_BAR}>
          <span className="truncate" title={read.title}>
            {read.title}
          </span>
          <span className="shrink-0">{seriesMark(read.episodes.length)}</span>
        </div>
        <div className="flex flex-col gap-2 p-2">
          <EpisodeTicks read={read} ticked={ticked} onTicked={setTicked} />
          {refusal === null ? null : (
            <p className="w-fit bg-bubble-pale px-1 font-bold text-ink-bar" role="alert">
              {refusal}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-1">
            {busy ? <span className="font-bold">ADDING...</span> : null}
            <button type="button" className={PLATE} disabled={none || busy} onClick={() => void add(false)} aria-label={`Add the ticked episodes of ${read.title} to your list`}>
              [ + ADD ]
            </button>
            {crowned ? <QueueKey label={`the ticked episodes of ${read.title}`} disabled={none || busy} onAdd={() => void add(true)} /> : null}
            <button type="button" className={PLATE} onClick={onCancel}>
              [ CANCEL ]
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
