'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react';
import { artSlot } from '../lib/ui/art/slots';
import { FIELD_TIGHT, PLATE, PLATE_LINK, PLATE_MAIN } from '../lib/ui/controls';
import { pictureLink } from '../lib/watch/pictures';
import { seriesMark } from '../lib/watch/series';
import { useArchiveRowSubtitles, useSeriesCount } from '../lib/watch/series-client';
import type { WebStreamItem } from '../lib/web/dedupe';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../lib/web/paging';
import { pickSeed, recommendOrder, subscribedFirst } from '../lib/web/recommend';
import { noteOpened, readTaste } from '../lib/web/taste-store';
import { useYourYouTube } from '../lib/web/use-your-youtube';
import { askBrief, useBrief } from '../lib/web/use-brief';
import { readingPage } from '../lib/web/brief/reading-search';
import { useFeedLanes } from '../lib/web/use-feed-lanes';
import { useLiveLane } from '../lib/web/use-live-lane';
import { readingOpens, type Lane, type ReadingRow } from '../lib/web/feed-mix';
import { buildProfile, strongestSpelled, type Profile } from '../lib/web/feed-profile';
import { BLOCK_SIZE, rankFeed, type FeedLane, type Person, type SharedRow } from '../lib/web/feed-rank';
import { useFeedSignals, useStreamPool, type FeedPeopleSignals, type FiledThing } from '../lib/web/use-feed-signals';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import ProfileAvatarLink from './ProfileAvatarLink';
import { noteFirstBlock, noteOpenedRow, readResting } from '../lib/web/passed-over';
import { isReadingKind, openLinkSite } from '../lib/web/brief/feeds';
import { readingRowAddresses } from '../lib/web/brief/addresses';
import { YOUTUBE_LINK_ON } from '../lib/web/youtube-link';
import WebYouTubeHome from './WebYouTubeHome';
import { EverywhereError, loadLiveNow, loadPeertubeHosts, loadRelated, needsPeertubeHosts, searchEverywhere, type LinkOutcome, type ProviderLine, type Related } from '../lib/web/everywhere-client';
import { looksLikeLink, MAX_LINK_LENGTH } from '../lib/web/link-shape';
import { arrive, compareIn, EMPTY_LIVE, emptyLive, freeze, heldBack, lanesToAsk, release, type ListOrder, type LiveList } from '../lib/web/live-merge';
import { getWebRepository } from '../lib/web/repository';
import { rowAddresses, startingEmbed, type ExtraHosts } from '../lib/web/row-addresses';
import { embedWithPlace, timeSourceOf } from '../lib/web/embed-time';
import { closeFloatingIfMine, placeOf, playFloating } from '../lib/ui/floating-player';
import PlayerBox, { PipKey, usePlayingHere } from './PlayerBox';
import SplitKey, { type Half } from './SplitKey';
import { useQueueHalf } from './QueueHalf';
import { LetterPlaylistKey, MoreArrow, ThumbOpen } from './WebRowKeys';
import FeedbackKey from './FeedbackKey';
import Link from 'next/link';
import { isReadable } from '../lib/books/types';
import { editionCount } from '../lib/books/editions';
import { recordOpened, SAVE_OPENED } from '../lib/web/save-opened';
import { authorWords, searchText } from '../lib/web/search';
import { splitYear } from '../lib/web/search-intent';
import {
  activeFilter,
  authorsOf,
  boxFromAddress,
  formatWebSearch,
  hasFilters,
  isReadingSource,
  LANGUAGE_OPTIONS,
  languageLabel,
  matchesFilters,
  parseWebSearch,
  searchAddress,
  sortOf,
  sourcesToAsk,
  SOURCE_OPTIONS,
  sourceGroups,
  suggestFilterValues,
  TYPE_OPTIONS,
  withAuthor,
  withFilter,
  withoutAuthor,
  withoutFilters,
  type FilterKey,
  type SourceValue,
  type TypeValue,
  type WebSearch,
} from '../lib/web/web-filters';
import { PLATFORM_LABELS, type WebItem, type WebPlatform } from '../lib/web/types';
import { canSort, ORDER_KEYS, orderLabel, searchOrder, type SortChoice } from '../lib/web/web-sort';
import { FILTER_KEY, FILTER_KEY_ON, FilterRow, FOLD_KEY } from './WebFilterFold';
import { noteHistory } from '../lib/recommender/history';
import { isShort } from '../lib/web/shorts';
import { hiddenShortNow, useHiddenShort } from '../lib/web/use-hidden-short';
import { shortsVersion, subscribeShorts } from '../lib/web/shorts-client';
import { useAuth } from './AuthProvider';
import { useMediaView, viewLabel, viewListClass, type MediaView } from '../lib/web/media-view';
import { forgetMedia, keepMedia, keptFor } from '../lib/web/media-keep';
import WebViewKey from './WebViewKey';
import { hiddenKeys, keyOf, tasteFromHistory } from '../lib/recommender/engine';
import { useHistoryRows } from '../lib/recommender/use-history';
import type { HistoryRow } from '../lib/recommender/types';
import { contentLanguage } from '../lib/web/language';
import { burnedInSubtitles } from '../lib/web/subtitles';
import { isBarAudioPlatform, parseWebAudioSrc, playsInBar, webAudioFilePath, webTrackId } from '../lib/web/web-audio';
import { loadWebItem } from '../lib/web/web-track-lookup';
import { useCatalogue } from '../lib/media/catalogue';
import { siteFileMatches } from '../lib/web/site-server';
import { useMusicPlayer } from './MusicPlayerProvider';
import WebPickedList from './WebPickedList';
import AudioSubsFlags from './AudioSubsFlags';
import SpriteSlot from './SpriteSlot';
import WebMediaRow, { isKinoRow, isMediaRow, KinoRow } from './WebMediaRow';
import WebCatalogueFinds, { CatalogueLine, useCatalogueFinds } from './WebCatalogueFinds';
import WebSiteFiles from './WebSiteFiles';
import WebLiveRooms from './WebLiveRooms';
import StreamArtShelf from './StreamArtShelf';
import { watchLinkForItem } from '../lib/web/bridges';
import { canWatch, WebDiscussKey } from './WebBridgeKeys';
import { noteSettingChanged, subscribeToAccountSettings } from '../lib/settings/settings-bus';

/**
 * WEB: one stream of media from other platforms, newest first (SPEC-web.md).
 *
 * Not grouped and not filtered by source: the platform's name is on every row instead, next to the
 * link. Every address a row uses - page, thumbnail, player, licence - is checked against that
 * platform's allow-list and path shapes again before it is drawn (`rowAddresses`), and every piece of
 * third-party text is a React text node, so nothing a platform sends can become markup.
 *
 * One search field above the stream (search.ts): results keep the same order, paging and LOAD MORE. A
 * work found on several platforms is one row, with the other copies as ALSO ON links (dedupe.ts).
 *
 * One live search (SPEC-web-search.md; Luke, 2026-10-31: "all needs to turn live results ... much faster"):
 * a search asks the saved stream and every live platform at once, each in its own request (everywhere-client.ts),
 * and each one's rows join the list the moment they arrive (live-merge.ts: once each, newest first, and nothing
 * moves under the reader once they scroll). A slow platform is one plain line. A pasted address shows that one
 * item. Live rows look and work like stream rows.
 *
 * SOURCE and TYPE filters (Luke, 2026-10-31), the forum's way: typed in the box (`in:youtube`, `type:audio`,
 * with a suggestion list) or pressed as keys, which write the same words into the box; the address carries
 * them (`?q=&in=&type=`). They decide which sources are asked at all (web-filters.ts `sourcesToAsk`).
 *
 * SORT (SPEC-web-sort.md): BEST MATCH, POPULAR or DATE, and a flip key that turns DATE oldest first; typed `sort:`,
 * carried as `?sort=`. Each source is asked for that order; one that has none is not asked and says so in one line.
 * By date the rows are held back until no source's next page could beat them (live-merge.ts), and LOAD MORE asks
 * the source holding them back; BEST MATCH and POPULAR take one row from each source in turn. Searches only: the
 * plain stream stays newest first.
 *
 * DEBASER.SITE (Luke, 2026-11-03, when WEB became ARCHIVE, now MEDIA): a search also finds the site's own files, the old
 * archive page's (the media catalogue), listed first under that server's name (site-server.ts, WebSiteFiles.tsx).
 * They come from the catalogue already read in this browser, never from the merge above.
 */

const KIND_LABELS: Record<WebItem['kind'], string> = {
  audio: 'AUDIO',
  video: 'VIDEO',
  image: 'IMAGE',
  text: 'TEXT',
  other: 'OTHER',
};

/**
 * VIEW (Luke, 2026-11-14; media-view.ts): how a row is laid out. LIST is today's row. GRID is a YouTube-style card, a big
 * 16:9 picture over its title (two lines, then cut). LARGE is one big card, a wide picture beside its words. COMPACT is a
 * small picture and the title with the main keys. A video still never plays in its row (PlayerBox, playFloating).
 */
const ROW_LAYOUT: Record<MediaView, string> = {
  list: 'flex items-start gap-2',
  grid: 'flex flex-col gap-2',
  large: 'flex items-start gap-3 max-sm:flex-col',
  compact: 'flex items-center gap-2',
};
const THUMB_BOX: Record<MediaView, string> = {
  list: 'h-18 w-24',
  grid: 'aspect-video w-full',
  large: 'aspect-video w-80 max-sm:w-full',
  compact: 'h-9 w-12',
};
const TITLE_CLASS: Record<MediaView, string> = {
  list: 'text-sm',
  grid: 'text-sm line-clamp-2',
  large: 'text-title',
  compact: 'text-sm line-clamp-1',
};

/**
 * A GRID card's creator on one line, cut with "…" when long (MEDIACARD, 2026-11-17), so a card's facts, why-line and keys
 * stand at the same height as its neighbours'. The whole name is the key's tip and its name for a screen reader.
 */
const CREATOR_ONE_LINE = 'block max-w-full truncate';

const MISSING_THUMB_SRC = `/${artSlot('web-thumb-missing')?.path ?? 'assets/web/thumb-missing.png'}`;

/** The SOURCE, TYPE, `from:`, VIBE and SORT filters a list is shown under (web-filters.ts). */
type Filters = Pick<WebSearch, 'source' | 'type' | 'authors' | 'vibe' | 'sort' | 'lang' | 'live'>;

/** No filter at all: the only view MEDIA's default feed mixes (SPEC-media-feed.md). */
function plainFilters(filters: Filters): boolean {
  return filters.source === 'all' && filters.type === 'all' && authorsOf(filters).length === 0 && filters.vibe !== true && filters.sort === undefined && filters.lang === undefined && filters.live !== true;
}

/** The default feed's sources other than the saved stream, each taken once a visit (feed-rank.ts). */
type MixLanes = {
  reading?: Lane<ReadingRow<WebStreamItem>>;
  youtube?: Lane<WebStreamItem>;
  discover?: Lane<WebStreamItem>;
  /** People's picks read with the history: sent to the reader, queued in their rooms, public picks in the saved stream. */
  peopleNow?: Lane<SharedRow<WebStreamItem>>;
  /** People's public picks found later in the DISCOVER catalogue. */
  peopleFound?: Lane<SharedRow<WebStreamItem>>;
  /** Lives that fit the reader (use-live-lane.ts, SPEC-live-streams.md): the LIVE place of each screen. */
  live?: Lane<WebStreamItem>;
};

/** How many screens of 12 the default feed shows at first, and how many more each LOAD MORE adds. */
const FEED_FIRST_BLOCKS = 4;
const FEED_MORE_BLOCKS = 4;
/** How long the first screen waits for the lives (SPEC-live-streams.md) before it draws without them. */
const LIVE_WAIT_MS = 3000;

/** What a person filed (a letter, a recommendation), with the maker and title the saved stream knows for it. */
function filedWithMaker(things: readonly FiledThing[], byId: ReadonlyMap<string, WebStreamItem>): { ref: string; title: string; maker?: string }[] {
  return things.map((thing) => {
    const known = byId.get(thing.ref);
    return { ref: thing.ref, title: thing.title || known?.title || '', ...(known?.creator ? { maker: known.creator } : {}) };
  });
}

/**
 * People's picks found in the saved stream itself (so they can show on the first screen): sent to this reader, queued in
 * a room they joined by someone else, or recommended publicly by someone else. The reader is never their own reason.
 */
function sharedInPool(pool: readonly WebStreamItem[], signals: FeedPeopleSignals, me: string | null): SharedRow<WebStreamItem>[] {
  const byId = new Map(pool.map((item) => [item.id, item]));
  const rows: SharedRow<WebStreamItem>[] = [];
  const add = (ref: string, people: readonly Person[], how: SharedRow<WebStreamItem>['how']) => {
    const item = byId.get(ref);
    if (item !== undefined && people.length > 0 && !rows.some((row) => row.item.id === ref)) rows.push({ item, people, how });
  };
  for (const thing of signals.sent) add(thing.ref, thing.people.filter((person) => person.id !== me), 'sent');
  const gather = (into: Map<string, Person[]>, ref: string, person: Person) => {
    if (person.id === me) return;
    const people = into.get(ref) ?? [];
    if (!people.some((one) => one.id === person.id)) people.push(person);
    into.set(ref, people);
  };
  const queued = new Map<string, Person[]>();
  for (const thing of signals.queued) if (thing.by !== null) gather(queued, thing.ref, { id: thing.by, name: '' });
  for (const [ref, people] of queued) add(ref, people, 'queued');
  const picked = new Map<string, Person[]>();
  for (const pick of signals.picks) gather(picked, pick.itemId, { id: pick.person, name: pick.displayName });
  for (const [ref, people] of picked) add(ref, people, 'recommended');
  return rows;
}

/** Why a row of the default feed is here (feed-rank.ts), and the people who are the reason. */
type FeedWhy = { why: string; people: readonly Person[]; block: number };

/** One face beside a why-line: the person's picture, named by their profile when the pick didn't say (a room's queue). */
function FeedFace({ person }: { person: Person }) {
  const { profile } = usePublicProfile(person.id);
  const name = person.name || profile?.displayName || '';
  return <ProfileAvatarLink author={{ id: person.id, displayName: name }} size={20} showName={false} variant="plain" className="shrink-0" />;
}

/**
 * What the list shows: the stream (no words; filtered when filters are set), one search (the saved stream and
 * every live source the filters allow, together; its words may be none when it names a creator), or one pasted link.
 */
/** `picked`: a search the page chose because the stream had nothing to show (recommend.ts). The box stays empty. */
type Shown = { kind: 'stream'; filters: Filters } | { kind: 'search'; query: string; filters: Filters; picked?: boolean } | { kind: 'link'; link: string };

/** Who a search is still waiting on: the saved stream, or a live source. */
type Source = 'stream' | WebPlatform;

const LINK_WORDS: Record<LinkOutcome, string> = {
  found: 'FROM THE LINK',
  unknown: "MEDIA CAN'T PLAY LINKS FROM THERE.",
  'not-found': 'NOTHING TO PLAY AT THAT LINK.',
  'no-answer': "THAT SITE DIDN'T ANSWER. TRY AGAIN.",
};

const SUGGESTIONS_ID = 'web-search-suggestions';
const sourceLabel = (source: Source) => (source === 'stream' ? 'THE STREAM' : PLATFORM_LABELS[source]);

/** What the box asks for: a pasted address, the words of a search, or (no words) the stream, with its filters. */
function requestFor(box: string): Shown {
  const parsed = parseWebSearch(box);
  if (looksLikeLink(parsed.text)) return { kind: 'link', link: parsed.text };
  const filters: Filters = {
    source: parsed.source,
    type: parsed.type,
    ...(parsed.authors ? { authors: parsed.authors } : {}),
    ...(parsed.vibe ? { vibe: true as const } : {}),
    ...(parsed.sort ? { sort: parsed.sort } : {}),
    ...(parsed.lang ? { lang: parsed.lang } : {}),
    ...(parsed.live ? { live: true as const } : {}),
  };
  const query = searchText(parsed.text);
  // A creator alone is a search too: every source is asked for their items.
  if (query === null && authorsOf(filters).length === 0) return { kind: 'stream', filters };
  return { kind: 'search', query: query ?? '', filters };
}

/** A search in the page's words: `"TRAINS"`, `FROM PRELINGER: "TRAINS"`, `FROM A OR B`. */
function searchWordsShown(query: string, filters: Filters): string {
  const authors = authorsOf(filters);
  const words = query === '' ? '' : `"${query}"`;
  if (authors.length === 0) return words.toUpperCase();
  return `FROM ${authors.join(' OR ')}${words === '' ? '' : `: ${words}`}`.toUpperCase();
}

/** WHERE FROM in plain words: `ALL SOURCES`, `YOUTUBE`. */
function sourceInWords(source: SourceValue): string {
  return source === 'all' ? 'ALL SOURCES' : (SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? 'ALL SOURCES');
}

/** WHAT KIND in plain words: `ALL KINDS`, `VIDEO ONLY`. */
function typeInWords(type: TypeValue): string {
  return type === 'all' ? 'ALL KINDS' : `${TYPE_OPTIONS.find((option) => option.value === type)?.label ?? 'ALL KINDS'} ONLY`;
}

/** The filter panel's one plain line: everything chosen, in order (Luke, 2026-11-13: "much clearer"). */
function filtersInWords(search: WebSearch, art: boolean): string {
  if (art) return 'STREAM ART, THE SAVED ROOM CANVASES';
  const authors = authorsOf(search);
  return [
    sourceInWords(search.source),
    typeInWords(search.type),
    ...(authors.length > 0 ? [`FROM ${authors.join(' OR ').toUpperCase()}`] : []),
    ...(search.vibe ? ['MOOD SEARCH ON'] : []),
    ...(search.lang ? [`IN ${languageLabel(search.lang)}`] : []),
    ...(search.live ? ['ON NOW ONLY'] : []),
    orderLabel(sortOf(search)),
  ].join(', ');
}

/** YOUR YOUTUBE's view: twelve at a time, [ MORE ] for twelve more. */
const MINE_STEP = 12;

/** Which filter sections are open, kept in this browser only (a convenience; shut when nothing is kept). */
const FOLDS_KEY = 'debaser.media.filter-folds.v1';
/** PICKS: the plain search, or the site's own picks (SPEC-discover.md, SPEC-recommender.md). */
const PICKS: readonly { value: 'recommended' | 'discover' | null; label: string; line: string }[] = [
  { value: null, label: 'ALL', line: 'EVERYTHING THE SEARCH FINDS.' },
  { value: 'recommended', label: 'RECOMMENDED', line: "WHAT PEOPLE HERE RECOMMEND, THEN WHAT FITS WHAT YOU OPEN, PLAY AND READ." },
  { value: 'discover', label: 'DISCOVER', line: 'ODDER FINDS THAT FIT YOUR DISCOVER SETTINGS.' },
];

const FOLD_IDS = ['media-filters', 'media-view', 'media-order','media-filter-picks', 'media-filter-source', 'media-filter-type', 'media-filter-order', 'media-filter-vibe', 'media-filter-creator', 'media-filter-view'];

/**
 * The quick picks at the top of the FILTERS panel (Luke, 2026-11-14: "more optimised"): the commonest choices in one press
 * each. Each sets WHERE FROM and WHAT KIND together, so it is one search, not two.
 */
const QUICK_PICKS: readonly { label: string; name: string; source: SourceValue; type: TypeValue }[] = [
  { label: 'ALL', name: 'everything', source: 'all', type: 'all' },
  { label: 'VIDEO', name: 'videos from every source', source: 'all', type: 'video' },
  { label: 'MUSIC', name: 'music and other sound from every source', source: 'all', type: 'audio' },
  { label: 'BOOKS', name: 'books', source: 'books', type: 'all' },
  { label: 'IMAGES', name: 'pictures from every source', source: 'all', type: 'image' },
];

function readFolds(): ReadonlySet<string> {
  try {
    const kept: unknown = JSON.parse(window.localStorage.getItem(FOLDS_KEY) ?? '[]');
    return new Set(Array.isArray(kept) ? kept.filter((id): id is string => typeof id === 'string' && FOLD_IDS.includes(id)) : []);
  } catch {
    return new Set();
  }
}

function keepFolds(folds: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(FOLDS_KEY, JSON.stringify([...folds]));
  } catch {
    // Kept for this visit only.
  }
}

/**
 * The filters a source's rows are held to. A READING kind's rows came from the brief under that kind, so its news videos
 * (YOUTUBE rows) and lectures (ARCHIVE rows) count as the kind: only WHAT KIND, CREATOR and LANGUAGE apply to them.
 */
function readingAware<F extends { source: SourceValue }>(source: Source, filters: F): F {
  return isReadingSource(source) ? { ...filters, source: 'all' } : filters;
}

/** The sources a request asks: a link is one live answer; otherwise whatever the filters allow, in the order chosen. */
function sourcesFor(shown: Shown): Source[] {
  if (shown.kind === 'link') return ['youtube'];
  // READING (WHERE FROM's group, SPEC-media-feed.md): the brief alone, words or none; not under POPULAR (no counts).
  if (isReadingSource(shown.filters.source)) return canSort(shown.filters.source, sortOf(shown.filters)) ? [shown.filters.source] : [];
  const plan = sourcesToAsk(shown.filters);
  const stream: Source[] = plan.stream ? ['stream'] : [];
  // The `[ ● LIVE ]` key with no words: what is on now on Twitch (its own most-watched order); YouTube needs words.
  if (shown.kind === 'stream' && shown.filters.live === true) return plan.live.includes('twitch') ? ['twitch'] : [];
  // Live sources need words to search for; with none, the list is the stream alone.
  if (shown.kind === 'stream') return stream;
  return [...stream, ...plan.live].filter((source) => canSort(source, sortOf(shown.filters)) || swapsOnly(source, shown));
}

/** The sources a search leaves out because they have no such order: one plain line each (SPEC-web-sort.md). */
function unsortedFor(shown: Shown): Source[] {
  if (shown.kind === 'link') return [];
  if (isReadingSource(shown.filters.source)) return canSort(shown.filters.source, sortOf(shown.filters)) ? [] : [shown.filters.source];
  if (shown.kind !== 'search') return [];
  const plan = sourcesToAsk(shown.filters);
  return [...(plan.stream ? (['stream'] as Source[]) : []), ...plan.live].filter((source) => !canSort(source, sortOf(shown.filters)) && !swapsOnly(source, shown));
}

/**
 * Under POPULAR with KINO the saved stream is still read, for the media servers' copies only: a server's row takes
 * its KINO row's place (so it sits where TMDB's rating put it) and never shows on its own.
 */
function swapsOnly(source: Source, shown: Shown): boolean {
  return source === 'stream' && shown.kind === 'search' && sortOf(shown.filters).sort === 'popular' && shown.filters.source === 'kino';
}

/** The order a list is in: a search's SORT; the plain stream and a link, newest first. */
function orderFor(shown: Shown): ListOrder {
  // A READING kind takes its SORT with no words too: the brief is in the page, so every order is free.
  const choice: SortChoice = shown.kind === 'search' || (shown.kind === 'stream' && isReadingSource(shown.filters.source)) ? sortOf(shown.filters) : { sort: 'date', dir: 'desc' };
  return choice.sort === 'date' ? { kind: 'date', dir: choice.dir } : { kind: 'turns' };
}

type SourcePage = { items: WebStreamItem[]; nextCursor: string | null; problems?: ProviderLine[]; link?: LinkOutcome | null };

/**
 * One page from one source for a search, a link or the stream (the main list and each related section ask the same
 * way). `sorted`: in the search's SORT order (the main list); a related section asks for each site's best match.
 */
function readSource(source: Source, what: Shown, after: string | null, keyword?: number, sorted = false): Promise<SourcePage> {
  const repository = getWebRepository();
  const order = sorted && what.kind === 'search' ? searchOrder(sortOf(what.filters)) : undefined;
  if (isReadingSource(source) && what.kind !== 'link') {
    // READING: one kind of the brief the page already holds (use-brief.ts), searched and paged here; nothing new is asked.
    const asked = searchOrder(sortOf(what.filters));
    return askBrief().then((rows) => {
      const page = readingPage(rows, source, {
        query: what.kind === 'search' ? what.query : '',
        from: authorsOf(what.filters),
        anyWord: what.filters.vibe === true,
        order: asked === 'popular' ? 'relevance' : asked,
        cursor: after,
        limit: DEFAULT_PAGE_SIZE,
      });
      // `pickPage`: with no words the list is ordered for the reader a page at a time, so LOAD MORE never moves a row.
      return { items: page.items.map((item) => ({ ...item, alsoOn: [], pickPage: after ?? '' })), nextCursor: page.nextCursor };
    });
  }
  if (source === 'stream') {
    return what.kind === 'search'
      ? repository.searchItems({
          query: what.query,
          from: authorsOf(what.filters),
          cursor: after,
          limit: DEFAULT_PAGE_SIZE,
          ...(what.filters.vibe ? { anyWord: true } : {}),
          ...(order === 'oldest' ? { oldestFirst: true } : {}),
        })
      : // A whole page to choose from, since this list is ordered by what suits the reader, with Claude's words for each row.
        // Words that cannot be read only make the order plainer; they never stop the list.
        repository.listItems({ cursor: after, limit: MAX_PAGE_SIZE }).then(async (page) => {
          const words = await repository.itemWords(page.items.map((item) => item.id)).catch(() => new Map<string, string[]>());
          return { ...page, items: page.items.map((item) => ({ ...item, pickWords: words.get(item.id), pickPage: after ?? '' })) };
        });
  }
  if (what.kind === 'link') return searchEverywhere(what.link, after);
  // The `[ ● LIVE ]` key with no words: what is on now (`/api/web/live`), one page.
  if (what.kind === 'stream') return after === null ? loadLiveNow().then((items) => ({ items, nextCursor: null })) : Promise.resolve({ items: [], nextCursor: null });
  // A live source is asked about one creator at a time: the first.
  return searchEverywhere(what.kind === 'search' ? what.query : '', after, source, authorsOf(what.filters)[0] ?? null, what.filters.type, {
    vibe: what.filters.vibe === true,
    ...(keyword !== undefined ? { keyword } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(what.filters.lang !== undefined ? { lang: what.filters.lang } : {}),
    ...(what.filters.live === true ? { live: true } : {}),
  });
}

/** What MEDIA leaves in media-keep.ts when it goes (M14): enough to draw it again as it was, with nothing asked. */
type KeptMedia = {
  art: boolean;
  home: boolean;
  picked: 'recommended' | 'discover' | null;
  draft: string;
  shown: Shown;
  list: LiveList;
  pulls: number;
  toppedUp: boolean;
  liveIds: ReadonlySet<string>;
  cursors: Partial<Record<Source, string>>;
  problems: ProviderLine[];
  linkOutcome: LinkOutcome | null;
  failed: boolean;
  refusal: string | null;
  related: Related | null;
  firstRoundDone: boolean;
  tried: ReadonlySet<string>;
  mineShown: number;
};

/** The box the page scrolls in: the nearest parent that scrolls, else the page itself. */
function scrollBox(from: HTMLElement | null): HTMLElement {
  for (let node = from?.parentElement ?? null; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** How many rows LOAD MORE adds by date before it stops asking (one page's worth). */
const MORE_ROWS = 20;
/** How many single-source pages one LOAD MORE may ask by date, so a source with nothing new cannot spin. */
const MAX_PULLS = 8;

/** The box with its words replaced (a DID YOU MEAN), every filter kept. */
function withWords(box: string, words: string): string {
  return formatWebSearch({ ...parseWebSearch(box), text: words });
}

/** The SORT keys on RECOMMENDED and DISCOVER, read from the box as everywhere (web-sort.ts). */
function pickSortOf(filters: Parameters<typeof sortOf>[0]): 'best' | 'newest' | 'oldest' | 'popular' {
  const { sort, dir } = sortOf(filters);
  return sort === 'popular' ? 'popular' : sort === 'date' ? (dir === 'asc' ? 'oldest' : 'newest') : 'best';
}

export default function WebStream() {
  const params = useSearchParams();
  const router = useRouter();
  // M14 (Luke's list, 2026-11-14: "retains the way it was when you switch around tabs"): coming back to MEDIA at the address
  // it left, or at plain /media, shows what it showed, at once, with nothing asked (media-keep.ts). Read once, in the browser.
  const [restored] = useState(() => (typeof window === 'undefined' ? null : keptFor<KeptMedia>(params.toString())));
  const back = restored?.state;
  /** STREAM ART (SPEC-stream-art.md): the saved room canvases instead of the stream (`?art=1`). Any search leaves it. */
  const [art, setArt] = useState(() => back?.art ?? params.get('art') === '1');
  /** YOUR YOUTUBE's own view (Luke, 2026-11-14: "the youtube homepage as header options"), `?home=youtube`. Any search leaves it. */
  const [home, setHome] = useState(() => back?.home ?? params.get('home') === 'youtube');
  const { user, status: authStatus } = useAuth();
  // RECOMMENDED and DISCOVER (SPEC-discover.md): lists in their own right, blank until the pool is large enough.
  const [picked, setPicked] = useState<'recommended' | 'discover' | null>(() => {
    if (back !== undefined) return back.picked;
    const list = params.get('list');
    return list === 'recommended' || list === 'discover' ? list : null;
  });
  /** What is in the field (the one truth for the filters too), and what the list shows. */
  const [draft, setDraft] = useState(() => back?.draft ?? boxFromAddress(params));
  const [shown, setShown] = useState<Shown>(() => back?.shown ?? requestFor(boxFromAddress(params)));
  /** The rows, as they arrive from each source (live-merge.ts: once each, nothing moving under the reader). */
  const [list, setList] = useState<LiveList>(() => back?.list ?? emptyLive(orderFor(requestFor(boxFromAddress(params)))));
  /** By date, LOAD MORE keeps asking the source holding rows back until this many rows show (null: not loading). */
  const [target, setTarget] = useState<number | null>(null);
  /** Pages asked by date for this search (`MAX_PULLS` per LOAD MORE); `null` once the first top-up is spent. */
  const [pulls, setPulls] = useState(() => back?.pulls ?? 0);
  const [toppedUp, setToppedUp] = useState(() => back?.toppedUp ?? false);
  /** The sources a by-date top-up has just asked (the effect below sends the requests). */
  const [pulled, setPulled] = useState<{ sources: Source[] } | null>(null);
  /** The pages being asked for are the reader's own LOAD MORE (focus moves to the first new row), not a top-up. */
  const readerAsked = useRef(false);
  /** Results found live rather than read from the stream: opening one asks for it to be saved. */
  const [liveIds, setLiveIds] = useState<ReadonlySet<string>>(() => back?.liveIds ?? new Set());
  /** Bumped by every new search, so a slow answer to an old one is dropped rather than shown. */
  const generation = useRef(0);
  /** Each source's next page; a source with none has no more. */
  const [cursors, setCursors] = useState<Partial<Record<Source, string>>>(() => back?.cursors ?? {});
  /** The sources still being asked, in the order they were asked. */
  const [asking, setAsking] = useState<Source[]>(() => (back !== undefined ? [] : sourcesFor(requestFor(boxFromAddress(params)))));
  /** One plain line per live source that failed ("OPENVERSE: NO ANSWER"); a pasted link's outcome. */
  const [problems, setProblems] = useState<ProviderLine[]>(() => back?.problems ?? []);
  const [linkOutcome, setLinkOutcome] = useState<LinkOutcome | null>(() => back?.linkOutcome ?? null);
  /** The stream itself could not be read; or the route's own refusal ("Too many searches..."). */
  const [failed, setFailed] = useState(() => back?.failed ?? false);
  const [refusal, setRefusal] = useState<string | null>(() => back?.refusal ?? null);
  /** PeerTube instances from the public index, read once some row needs them (`rowAddresses`). */
  const [peertubeHosts, setPeertubeHosts] = useState<readonly string[]>([]);
  /** What a screen reader is told when more rows arrive; the visible list is the sighted reader's answer. */
  const [announcement, setAnnouncement] = useState('');
  /** The first row a LOAD MORE or MORE RESULTS added: focus moves there. */
  const [focusId, setFocusId] = useState<string | null>(null);
  /** The suggestion list under the box while a filter's value is typed (`in:you|`), and its highlighted row. */
  const [caret, setCaret] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** "Did you mean" and related topics for the search shown (related.ts), once they arrive. */
  const [related, setRelated] = useState<Related | null>(() => back?.related ?? null);
  /** Every source has answered the search's first page once: only then may a related section load. */
  const [firstRoundDone, setFirstRoundDone] = useState(() => back?.firstRoundDone ?? false);
  /** What this reader has opened in this browser, read once so the list holds still while they look at it. */
  const [savedTaste] = useState(readTaste);
  /**
   * YOUR YOUTUBE (use-your-youtube.ts; Luke, 2026-11-14): the shelf in order (channels the reader still watches, a few new
   * ones, now and then a subscription gone quiet), what it teaches this page's own lists, and the LINK keys' work.
   */
  const youtube = useYourYouTube();
  /** How many of its videos the YOUR YOUTUBE shelf shows: twelve, and twelve more each [ MORE ]. */
  const [mineShown, setMineShown] = useState(() => back?.mineShown ?? MINE_STEP);
  /** The names of the channels that stand, for `subscribedFirst` while a search's rows arrive (read from a ref, so asking never restarts). */
  const subscribed = youtube.standing;
  // The reader's own FOR YOU history too (SPEC-recommender.md step 3): what they opened, played and read anywhere on the site.
  const history = useHistoryRows();
  const [historyNow] = useState(() => Date.now());
  const notForMe = useMemo(() => hiddenKeys(history ?? []), [history]);
  // The history counts if it is read before the first rows arrive; then it is fixed for the visit, so nothing on screen
  // moves when it comes (NOT FOR ME still takes a row out at once).
  const [historyUsed, setHistoryUsed] = useState<readonly HistoryRow[] | null>(null);
  if (historyUsed === null && (history !== null || list.shown.length > 0)) setHistoryUsed(history ?? []);
  // What their YouTube teaches is where each channel stands (a subscription they no longer watch teaches nothing, a channel
  // they like but never subscribed to counts in full), their topics, and an imported history's words. It is taken once a
  // visit, so a press of the feedback key reshapes the YOUR YOUTUBE shelf but never moves this page's rows.
  const teach = youtube.teach;
  const taste = useMemo(() => teach(tasteFromHistory(historyUsed ?? [], historyNow, savedTaste)), [teach, savedTaste, historyUsed, historyNow]);
  const [openedAt] = useState(() => Date.now());
  /** The words already tried for this filter when the stream had nothing (recommend.ts `pickSeed`). */
  const [tried, setTried] = useState<ReadonlySet<string>>(() => back?.tried ?? new Set());
  /** The site's own files the search finds (DEBASER.SITE), from the catalogue the whole site shares. */
  const catalogue = useCatalogue();
  // The tagged catalogue's rows for this search: their own request, so the outside sites are neither waited on nor slowed.
  const finds = useCatalogueFinds(shown.kind === 'search' && (shown.filters.lang ?? 'en') === 'en' ? { query: shown.query, source: shown.filters.source, type: shown.filters.type, authors: authorsOf(shown.filters) } : null);
  const siteFiles = useMemo(
    // The site's own files say no language, so they count as English (language.ts `inLanguage`): another LANGUAGE hides them.
    () => (shown.kind === 'search' && (shown.filters.lang ?? 'en') === 'en' ? siteFileMatches(catalogue.entries, { query: shown.query, filters: shown.filters }) : []),
    [catalogue.entries, shown],
  );

  /** Asks for the search's suggestion and related topics; a new search drops a late answer. */
  const askRelated = useCallback((asked: number, what: Shown) => {
    if (what.kind !== 'search' || what.query === '' || what.picked) return;
    void loadRelated(what.query, what.filters.source === 'kino').then((answer) => {
      if (asked === generation.current) setRelated(answer);
    });
  }, []);

  /** One source answered: its rows (those the filters allow) join the list, and it is no longer waited on. */
  const settle = useCallback(
    (
      asked: number,
      source: Source,
      what: Shown,
      page: { items: WebStreamItem[]; nextCursor: string | null; problems?: ProviderLine[]; link?: LinkOutcome | null } | null,
      end: boolean,
    ) => {
      if (asked !== generation.current) return;
      setAsking((current) => current.filter((waiting) => waiting !== source));
      if (page === null) {
        // A source that failed holds nothing back any more.
        if (what.kind === 'search') setList((current) => arrive(current, [], end, { lane: source, more: false }));
        return;
      }
      // No YouTube Shorts (shorts.ts; Luke, 2026-11-14), older saved rows included. A pasted link shows what was pasted.
      const items = what.kind === 'link' ? page.items : page.items.filter((item) => !isShort(item) && matchesFilters(item, readingAware(source, what.filters), source === 'stream'));
      if (source !== 'stream') setLiveIds((current) => new Set([...current, ...items.map((item) => item.id)]));
      setList((current) => {
        let next: LiveList;
        if (what.kind !== 'search') next = arrive(current, items, end);
        else {
          // The media servers' titles that come with the first live answer (wildcard-search.ts) are a source of their
          // own, with no more pages, so they never stand in for that platform's place by date.
          // A READING kind's rows are all its own, the news videos (YOUTUBE rows) and lectures (ARCHIVE rows) included.
          const ownLane = (item: WebItem) => source === 'stream' || item.platform === source || isReadingSource(source);
          const ownRows = items.filter(ownLane);
          // Under BEST MATCH, rows by channels the reader subscribes to lead their site's page (recommend.ts).
          const own = sortOf(what.filters).sort === 'best' ? subscribedFirst(ownRows, subscribed.current) : ownRows;
          const servers = items.filter((item) => !ownLane(item));
          const sent = page.items.filter(ownLane);
          next = arrive(current, own, end, { lane: source, more: page.nextCursor !== null, swapOnly: swapsOnly(source, what), page: sent });
          if (servers.length > 0) next = arrive(next, servers, end, { lane: 'servers', more: false });
        }
        if (end && readerAsked.current && next.shown.length > current.shown.length) {
          readerAsked.current = false;
          setFocusId(next.shown[current.shown.length].id);
        }
        return next;
      });
      setCursors((current) => {
        const next = { ...current };
        if (page.nextCursor === null) delete next[source];
        else next[source] = page.nextCursor;
        return next;
      });
      if (page.problems && page.problems.length > 0) setProblems((current) => [...current, ...(page.problems ?? [])]);
      if (page.link !== undefined) setLinkOutcome(page.link);
      if (end) setAnnouncement(`${items.length} MORE FROM ${sourceLabel(source)}.`);
    },
    // `subscribed` is a ref the YouTube hook keeps for the whole visit: it never changes, so asking never restarts.
    [subscribed],
  );

  /** Asks one source (a page of it), and settles it whatever happens. */
  const ask = useCallback(
    (asked: number, source: Source, what: Shown, after: string | null, end: boolean) => {
      void readSource(source, what, after, undefined, true)
        .then((page) => settle(asked, source, what, page, end))
        .catch((failure: unknown) => {
          if (asked !== generation.current) return;
          if (source === 'stream' || what.kind === 'link') setFailed(true);
          else setProblems((current) => [...current, { platform: source, label: PLATFORM_LABELS[source], problem: 'COULD NOT READ' }]);
          if (failure instanceof EverywhereError) setRefusal(failure.message.toUpperCase());
          settle(asked, source, what, null, end);
        });
    },
    [settle],
  );

  /** Starts over with what a box says, and puts it in the address so the search can be shared. */
  const start = useCallback(
    (next: Shown, box: string | null) => {
      setArt(false);
      setHome(false);
      generation.current += 1;
      const asked = generation.current;
      setShown(next);
      setLiveIds(new Set());
      setList(emptyLive(orderFor(next)));
      setTarget(null);
      setPulls(0);
      setToppedUp(false);
      readerAsked.current = false;
      setCursors({});
      setProblems([]);
      setLinkOutcome(null);
      setFailed(false);
      setRefusal(null);
      setFocusId(null);
      setAnnouncement('');
      setRelated(null);
      setFirstRoundDone(false);
      const sources = sourcesFor(next);
      setAsking(sources);
      for (const source of sources) ask(asked, source, next, null, false);
      askRelated(asked, next);
      if (box !== null) window.history.replaceState(window.history.state, '', next.kind === 'link' ? searchAddress({ text: next.link, source: 'all', type: 'all' }) : searchAddress(parseWebSearch(box)));
    },
    [ask, askRelated],
  );

  const restart = useCallback(
    (box: string) => {
      setTried(new Set());
      // Anything that runs a search leaves RECOMMENDED or DISCOVER, or its results would sit behind the list.
      setPicked(null);
      start(requestFor(box), box);
    },
    [start],
  );

  /** Shows what a word finds, without touching the box or the address: the reader has not searched for anything. */
  const browseWith = useCallback(
    (seed: string, filters: Filters) => {
      setTried((current) => new Set([...current, seed]));
      start({ kind: 'search', query: seed, filters: { ...filters, ...(filters.source === 'kino' ? { vibe: true as const } : {}) }, picked: true }, null);
    },
    [start],
  );

  // The first answer: the address's search, or the stream. The state above already starts as "asking" them. Back on the page
  // as it was left (M14): nothing is asked; plain /media takes back the address it left at, and the page its scroll.
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (restored !== null) {
      if (params.toString() === '' && restored.address !== '') window.history.replaceState(window.history.state, '', `?${restored.address}`);
      const box = scrollBox(root.current);
      let tries = 0;
      // The router may scroll to the top after the page is drawn: set the place again for a few frames until it holds.
      const put = () => {
        box.scrollTop = restored.scroll;
        tries += 1;
        if (tries < 10) window.requestAnimationFrame(put);
      };
      window.requestAnimationFrame(put);
      // RELATED and DID YOU MEAN had not answered when the page went: asked for again (only they; askRelated skips a non-search).
      if (restored.state.related === null) askRelated(generation.current, restored.state.shown);
      return;
    }
    for (const source of sourcesFor(shown)) ask(generation.current, source, shown, null, false);
    askRelated(generation.current, shown);
    // Once, for what the page opened with; later searches go through restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, askRelated]);

  // M14: what the page shows, kept up to date, and left in media-keep.ts when the page goes (unless a source is still being
  // asked: half a list is not "as it was"). The address and the scroll are read while the page is here.
  const latest = useRef<{ state: KeptMedia; asking: number; address: string; scroll: number } | null>(null);
  useEffect(() => {
    const address = window.location.pathname === '/media' ? window.location.search.replace(/^\?/, '') : (latest.current?.address ?? '');
    latest.current = {
      state: { art, home, picked, draft, shown, list, pulls, toppedUp, liveIds, cursors, problems, linkOutcome, failed, refusal, related, firstRoundDone, tried, mineShown },
      asking: asking.length,
      address,
      scroll: latest.current?.scroll ?? 0,
    };
  });
  useEffect(() => {
    // Any scroll on the page, read from whichever box scrolls now: on a fresh search the list is empty when this starts, so
    // the box can only be known once there is something to scroll (scroll events don't bubble, but a capturing listener hears them).
    const note = () => {
      if (latest.current !== null) latest.current.scroll = scrollBox(root.current).scrollTop;
    };
    document.addEventListener('scroll', note, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', note, { capture: true });
      const last = latest.current;
      if (last !== null && last.asking === 0) keepMedia<KeptMedia>({ address: last.address, at: Date.now(), scroll: last.scroll, state: last.state });
      else forgetMedia();
    };
  }, []);

  // Once the reader scrolls or presses anything in a list that has rows, later arrivals wait behind
  // "N MORE RESULTS" instead of slotting in above what they are looking at.
  const searching = shown.kind === 'search';
  useEffect(() => {
    if (!searching) return;
    const hold = () => setList((current) => (current.shown.length > 0 ? freeze(current) : current));
    const events = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const;
    for (const name of events) document.addEventListener(name, hold, { capture: true, passive: true });
    return () => {
      for (const name of events) document.removeEventListener(name, hold, { capture: true });
    };
  }, [searching]);

  // A PeerTube row from an instance outside the fixed three draws its link, picture and player only once
  // the index's hosts are here; until then it shows its name and words alone.
  const needHosts = peertubeHosts.length === 0 && list.shown.some(needsPeertubeHosts);
  useEffect(() => {
    if (!needHosts) return;
    let live = true;
    void loadPeertubeHosts().then((hosts) => {
      if (live) setPeertubeHosts(hosts);
    });
    return () => {
      live = false;
    };
  }, [needHosts]);
  const extraHosts = useMemo<ExtraHosts>(() => ({ peertube: peertubeHosts }), [peertubeHosts]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuggesting(false);
    restart(draft);
  };

  /** A SOURCE or TYPE key: the filter is written into the box (so the two never disagree) and the search runs. */
  /** A press that changes nothing (the choice already on, the same search already showing) asks no source again. */
  const alreadyShowing = (box: string) => !art && picked === null && JSON.stringify(requestFor(box)) === JSON.stringify(shown);

  const pickFilter = (key: FilterKey, value: string) => {
    const next = withFilter(draft, key, value);
    setDraft(next);
    // On RECOMMENDED or DISCOVER the list filters itself from the box: nothing is asked.
    if (picked !== null) return;
    if (!alreadyShowing(next)) restart(next);
  };

  /** A creator's name on a row: everything from them, under the same SOURCE and TYPE (`from:` in the box). */
  const searchCreator = (name: string) => {
    const next = withAuthor(draft, name);
    setDraft(next);
    setSuggesting(false);
    restart(next);
    document.getElementById('web-search')?.focus();
  };

  // The filter value the caret is in, and what the list offers for it (for `from:`, the creators on the page).
  const active = suggesting ? activeFilter(draft, caret) : null;
  const creators = active?.key === 'from' ? list.shown.flatMap((item) => (item.creator ? [item.creator] : [])) : [];
  const suggestions = active === null ? [] : suggestFilterValues(active.key, active.partial, creators);
  // Tab or a click fills the value in; Enter fills it in and searches, so one Enter always searches.
  const choose = (word: string, search = false) => {
    if (active === null) return;
    const next = `${draft.slice(0, active.start)}${word}${draft.slice(active.end)}`;
    setDraft(next.endsWith(' ') ? next : `${next} `);
    setSuggesting(false);
    if (search) restart(next);
    document.getElementById('web-search')?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => (current + step + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choose(suggestions[Math.min(highlight, suggestions.length - 1)].word, event.key === 'Enter');
    } else if (event.key === 'Escape') {
      setSuggesting(false);
    }
  };

  useEffect(() => {
    if (focusId !== null) document.getElementById(rowTitleId(focusId))?.focus();
  }, [focusId]);

  /** Asks the next page of each source given (those that have one). */
  const askNext = (sources: Source[]) => {
    const asking = sources.filter((source) => cursors[source] !== undefined);
    setAsking(asking);
    for (const source of asking) ask(generation.current, source, shown, cursors[source] ?? null, true);
  };

  const loadMore = () => {
    readerAsked.current = true;
    // By date: page by page from whichever source holds the rest back, until a page's worth more shows.
    if (list.order.kind === 'date' && shown.kind === 'search') {
      setPulls(0);
      setTarget(list.shown.length + list.held.length + MORE_ROWS);
      return;
    }
    askNext(Object.keys(cursors) as Source[]);
  };

  // By date: once the first answers are in, rows held back by a source with more are fetched (up to a page's worth),
  // and a LOAD MORE goes on asking until its rows show. One source at a time (live-merge.ts `lanesToAsk`). The
  // decisions are made while drawing (as `firstRoundDone` is); the effect below only asks.
  const sortedByDate = shown.kind === 'search' && list.order.kind === 'date';
  const settledRound = asking.length === 0;
  const rows = list.shown.length + list.held.length;
  const pullable = (lanesToAsk(list) as Source[]).filter((source) => cursors[source] !== undefined);
  // Once, when the first answers are all in (before the related sections may start: they wait on `firstRoundDone`).
  if (sortedByDate && settledRound && !toppedUp) {
    setToppedUp(true);
    if (target === null && rows < MORE_ROWS && heldBack(list) > 0) setTarget(MORE_ROWS);
  }
  if (target !== null && settledRound && (!sortedByDate || rows >= target || pulls >= MAX_PULLS || pullable.length === 0)) setTarget(null);
  if (target !== null && settledRound && sortedByDate && rows < target && pulls < MAX_PULLS && pullable.length > 0) {
    // Marked as asking now, so this runs once per settled round; the requests go out from the effect.
    setAsking(pullable);
    setPulls(pulls + 1);
    setPulled({ sources: pullable });
  }
  useEffect(() => {
    if (pulled === null) return;
    for (const source of pulled.sources) ask(generation.current, source, shown, cursors[source] ?? null, true);
    // Only when a top-up was decided: `shown` and `cursors` are this render's, unchanged until those pages settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulled]);

  const showMore = () => {
    if (list.held.length > 0) setFocusId([...list.held].sort(compareIn(list))[0].id);
    setList(release);
  };

  /** A SORT key or the flip key: the order written into the box (`sort:`), and the search runs again. */
  const pickSort = (choice: SortChoice) => {
    const word = choice.sort === 'date' ? (choice.dir === 'asc' ? 'oldest' : 'newest') : choice.sort;
    // On RECOMMENDED or DISCOVER the list reads the box's order itself, so nothing needs asking again.
    if (picked !== null) {
      setDraft(withFilter(draft, 'sort', word));
      return;
    }
    pickFilter('sort', word);
  };

  /** A box the panel made (a creator dropped): written in and searched, as a filter key does. */
  const applyBox = (next: string) => {
    setDraft(next);
    if (picked !== null) return;
    if (!alreadyShowing(next)) restart(next);
  };

  /** A quick pick: WHERE FROM and WHAT KIND written into the box together, and one search. */
  const pickQuick = (pick: (typeof QUICK_PICKS)[number]) => {
    applyBox(formatWebSearch({ ...parseWebSearch(draft), source: pick.source, type: pick.type }));
  };

  /** RESET FILTERS: every filter back to its start, the words kept. STREAM ART is a source, so it goes too. */
  const resetFilters = () => {
    const next = withoutFilters(draft);
    setDraft(next);
    // PICKS is a filter too (Luke, 2026-11-14): RESET goes back to ALL.
    if (picked !== null) setPicked(null);
    if (art || JSON.stringify(requestFor(next)) !== JSON.stringify(shown)) restart(next);
    else window.history.replaceState(window.history.state, '', searchAddress(parseWebSearch(next)));
  };

  /** PICKS (Luke, 2026-11-14: "the reccomended and discover need to also be filters"): ALL, RECOMMENDED or DISCOVER. */
  const choosePicks = (next: 'recommended' | 'discover' | null) => {
    if (next === picked && !art && !home) return;
    setPicked(next);
    setArt(false);
    setHome(false);
    if (next !== null) {
      window.history.replaceState(window.history.state, '', `?list=${next}`);
      return;
    }
    // Back to ALL: the search under the list is asked again only if the box has changed since it was.
    if (JSON.stringify(requestFor(draft)) !== JSON.stringify(shown)) restart(draft);
    else window.history.replaceState(window.history.state, '', searchAddress(parseWebSearch(draft)));
  };

  /** [ KINO ] at the top: films and shows, the KINO source, out of any other view. */
  const openKino = () => {
    const next = withFilter(draft, 'in', 'kino');
    setDraft(next);
    const leaving = art || home || picked !== null;
    setPicked(null);
    if (leaving || JSON.stringify(requestFor(next)) !== JSON.stringify(shown)) restart(next);
  };

  /** [ YOUR YOUTUBE ] at the top: the reader's YouTube in a view of its own; pressed again, back to the list. */
  const toggleHome = () => {
    const next = !home;
    setHome(next);
    setArt(false);
    setPicked(null);
    // KINO is a view of its own too, so it never stays on behind YOUR YOUTUBE (Luke, 2026-11-14): going in takes it out of
    // the box; coming back shows the list the box now says, searching only if that differs from what was shown.
    const box = next && boxFilters.source === 'kino' ? withFilter(draft, 'in', 'all') : draft;
    if (box !== draft) setDraft(box);
    if (!next && JSON.stringify(requestFor(box)) !== JSON.stringify(shown)) {
      restart(box);
      return;
    }
    window.history.replaceState(window.history.state, '', next ? '?home=youtube' : searchAddress(parseWebSearch(box)));
  };

  /** Which filter sections are open: shut on the server's draw, then what this browser kept. */
  const [folds, setFolds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    // Read after the first draw so the server's page and the browser's agree; nothing else sets it on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFolds(readFolds());
    // Signed in, the account's folds arrive in storage on sign-in (SPEC-forum-v3.md, F2A).
    return subscribeToAccountSettings(() => setFolds(readFolds()));
  }, []);
  const toggleFold = (id: string) => {
    const next = new Set(folds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    keepFolds(next);
    setFolds(next);
    noteSettingChanged('mediaFolds');
  };

  /** A WHERE FROM key: writes `in:` into the box. While STREAM ART shows, it is the one source key on. */
  const sourceKey = (option: { value: SourceValue; label: string }) => (
    <button
      key={option.value}
      type="button"
      onClick={() => pickFilter('in', option.value)}
      aria-pressed={!art && boxFilters.source === option.value}
      aria-label={`Source: ${option.label}`}
      className={!art && boxFilters.source === option.value ? FILTER_KEY_ON : FILTER_KEY}
    >
      {!art && boxFilters.source === option.value ? (option.value === 'all' ? 'ALL SOURCES' : option.label) : `[ ${option.value === 'all' ? 'ALL SOURCES' : option.label} ]`}
    </button>
  );

  const boxFilters = parseWebSearch(draft);
  /** VIEW (media-view.ts): how the lists below are laid out, kept in this browser. */
  const view = useMediaView();
  const boxSort = sortOf(boxFilters);
  const busy = asking.length > 0 || target !== null;
  const unsorted = unsortedFor(shown);
  // The plain stream under BEST MATCH, ordered for this reader a page at a time, so LOAD MORE adds below and never moves
  // a row they are looking at. DATE and POPULAR keep their own order.
  const picksOrdered = shown.kind === 'stream' && sortOf(shown.filters).sort === 'best';
  const drawn = useMemo(() => {
    if (!picksOrdered) return list.shown;
    // By the page each row came in, not by counting: filters can leave a page with any number of rows.
    const pages = new Map<string, WebStreamItem[]>();
    for (const item of list.shown) {
      const key = item.pickPage ?? '';
      pages.set(key, [...(pages.get(key) ?? []), item]);
    }
    const words = new Map(list.shown.map((item) => [item.id, item.pickWords ?? []]));
    return [...pages.values()].flatMap((page) => recommendOrder(page, taste, (id) => words.get(id) ?? [], openedAt)).filter((item) => !notForMe.has(keyOf('media', item.id)));
  }, [picksOrdered, list.shown, taste, openedAt, notForMe]);

  // MEDIA's default feed, version 2 (SPEC-media-feed-v2.md; Luke, 2026-11-17: "All A"): with nothing searched and no
  // filter, every saved row, the reader's YouTube, the reading, the DISCOVER catalogue and people's picks, ranked for this
  // reader (feed-profile.ts, feed-rank.ts) and laid out 12 at a time. A source that answers late joins from the next screen
  // not yet drawn, so nothing on screen moves.
  const mixOn = picksOrdered && shown.kind === 'stream' && plainFilters(shown.filters);
  const briefRows = useBrief(mixOn);
  // A whole-stream read that failed is tried again once the page's own stream read answers (its TRY AGAIN, say).
  const pool = useStreamPool(mixOn, list.shown.length > 0 ? 1 : 0);
  const signedOut = authStatus !== 'loading' && authStatus !== 'signed-in';
  const roomIds = useMemo(() => (history === null ? null : [...new Set(history.filter((row) => row.kind === 'room').map((row) => row.ref))]), [history]);
  const peopleSignals = useFeedSignals(mixOn, user?.id ?? null, signedOut, roomIds);
  // The LIVE places (SPEC-live-streams.md): lives that fit this reader's history, linked YouTube and taste.
  const youtubeMakers = useMemo(() => [...new Set(youtube.items.flatMap((item) => (item.creator ? [item.creator] : [])))], [youtube.items]);
  const liveLane = useLiveLane(mixOn, historyUsed === null ? null : taste, historyUsed, youtubeMakers, openedAt);
  /**
   * The first screen waits for the whole saved stream, the reader's history, whether they are signed in and their shared
   * signals (each of those reads has its own short limit): no timer gives up on the history any more (SPEC-media-feed-v2.md,
   * fix 1). What it was drawn with is then held for the visit, so a late answer never reshuffles rows already on screen.
   */
  const [mixGate, setMixGate] = useState(false);
  // The lives (SPEC-live-streams.md) are waited for too, so the LIVE places are on the first screens, but only up to
  // LIVE_WAIT_MS: lives come from outside sites. The history is never given up on.
  const [liveWaited, setLiveWaited] = useState(false);
  useEffect(() => {
    if (!mixOn || liveWaited) return;
    const timer = window.setTimeout(() => setLiveWaited(true), LIVE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [mixOn, liveWaited]);
  if (mixOn && !mixGate && pool !== null && history !== null && authStatus !== 'loading' && peopleSignals !== null && (liveLane !== null || liveWaited)) setMixGate(true);
  const [mixProfile, setMixProfile] = useState<Profile | null>(null);
  const [mixHistory, setMixHistory] = useState<readonly HistoryRow[] | null>(null);
  const [mixVisitor, setMixVisitor] = useState<boolean | null>(null);
  if (mixGate && mixProfile === null && pool !== null && peopleSignals !== null) {
    const byId = new Map(pool.map((item) => [item.id, item]));
    setMixProfile(
      buildProfile({
        history: history ?? [],
        browser: savedTaste,
        youtube: youtube.signals,
        presetWords: peopleSignals.presetWords,
        letters: filedWithMaker(peopleSignals.letters, byId),
        recommended: filedWithMaker(peopleSignals.recommended, byId),
        queued: peopleSignals.queued,
        closeness: peopleSignals.closeness,
        now: historyNow,
      }),
    );
    setMixHistory(history ?? []);
    setMixVisitor(authStatus !== 'signed-in');
  }
  // DISCOVER's catalogue is asked for the reader's strongest words as spelled (or their preset), once the profile is made.
  const askTaste = useMemo(
    () => (mixProfile === null ? null : { tags: Object.fromEntries(strongestSpelled(mixProfile, 12).map((word, index) => [word, 12 - index])), creators: {}, platforms: {} }),
    [mixProfile],
  );
  const feedLanes = useFeedLanes(mixOn, askTaste, openedAt);
  const [mixLanes, setMixLanes] = useState<MixLanes>({});
  const [resting] = useState(() => readResting(Date.now()));
  const kindOpens = useMemo(() => readingOpens(mixHistory ?? [], historyNow), [mixHistory, historyNow]);
  const visitor = mixVisitor ?? true;
  const shortsSeen = useSyncExternalStore(subscribeShorts, shortsVersion, () => 0);
  const [feedBlocks, setFeedBlocks] = useState(FEED_FIRST_BLOCKS);
  const mixed = useMemo(() => {
    if (!mixOn) return null;
    if (!mixGate || mixProfile === null || pool === null) return [];
    return rankFeed<WebStreamItem>({
      pool,
      youtube: mixLanes.youtube ?? null,
      reading: mixLanes.reading ?? null,
      discover: mixLanes.discover ?? null,
      people: [mixLanes.peopleNow, mixLanes.peopleFound].filter((lane): lane is Lane<SharedRow<WebStreamItem>> => lane !== undefined),
      live: mixLanes.live ?? null,
      visitor,
      readingOpens: kindOpens,
      profile: mixProfile,
      // A Short YouTube has confirmed is dropped here, so its place is filled rather than left a hole (WebRow hides it).
      // A live is never rested for being passed over: a channel watched here is what the LIVE places look for.
      dropped: (item) => notForMe.has(keyOf('media', item.id)) || (item.live !== true && resting.has(item.id)) || hiddenShortNow(item),
      now: openedAt,
      // One screen more than shown, so LOAD MORE knows there is more.
      maxBlocks: feedBlocks + 1,
    });
    // shortsSeen: ranked again when YouTube answers about a Short, so the dropped rule above reads the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixOn, mixGate, mixProfile, pool, mixLanes, visitor, kindOpens, notForMe, resting, openedAt, feedBlocks, shortsSeen]);
  const feedRows = useMemo(() => (mixed === null ? null : mixed.filter((row) => row.block < feedBlocks)), [mixed, feedBlocks]);
  /** How many screens are on screen now: a source that answers from here on joins below them. */
  const [drawnBlocks, setDrawnBlocks] = useState(0);
  const lastDrawnBlock = feedRows === null || feedRows.length === 0 ? -1 : feedRows[feedRows.length - 1].block;
  useEffect(() => {
    // Counted after the rows are on screen, so a source arriving in the same moment still joins the first screen. It never
    // goes down (NOT FOR ME can empty the last screen): a screen once seen never takes a late source's rows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawnBlocks((drawn) => Math.max(drawn, lastDrawnBlock + 1));
  }, [lastDrawnBlock]);
  // A source that has just answered: taken once, from the screen after the last one drawn (0 before the first is drawn).
  if (mixOn) {
    const from = drawnBlocks;
    const arrivals: MixLanes = {};
    if (mixLanes.reading === undefined && briefRows !== null) arrivals.reading = { rows: briefRows.map(({ kind, item }) => ({ kind, item: { ...item, alsoOn: [] } })), fromBlock: from };
    if (mixLanes.youtube === undefined && mixVisitor === false && youtube.items.length > 0) arrivals.youtube = { rows: youtube.items.map((item) => ({ ...item, alsoOn: [] })), fromBlock: from };
    if (mixLanes.discover === undefined && feedLanes.discover !== null) arrivals.discover = { rows: feedLanes.discover.map((item) => ({ ...item, alsoOn: [] })), fromBlock: from };
    if (mixLanes.peopleNow === undefined && pool !== null && peopleSignals !== null && mixVisitor !== null) {
      arrivals.peopleNow = { rows: sharedInPool(pool, peopleSignals, user?.id ?? null), fromBlock: from };
    }
    if (mixLanes.peopleFound === undefined && feedLanes.people !== null) {
      arrivals.peopleFound = { rows: feedLanes.people.filter((row) => !row.people.some((person) => person.id === user?.id)).map((row) => ({ item: { ...row.item, alsoOn: [] }, people: row.people, how: 'recommended' as const })), fromBlock: from };
    }
    if (mixLanes.live === undefined && liveLane !== null) arrivals.live = { rows: liveLane.map((item) => ({ ...item, alsoOn: [] })), fromBlock: from };
    if (Object.keys(arrivals).length > 0) setMixLanes({ ...mixLanes, ...arrivals });
  }
  // Today's first block, noted once a visit in this browser: three days of being passed over rests a row for a week.
  const notedFirstBlock = useRef(false);
  useEffect(() => {
    if (feedRows === null || notedFirstBlock.current || feedRows.length < BLOCK_SIZE) return;
    notedFirstBlock.current = true;
    noteFirstBlock(feedRows.slice(0, BLOCK_SIZE).map(({ item }) => item.id), Date.now());
  }, [feedRows]);
  /** LOAD MORE in the default feed: the next screens, already ranked; the first new row takes focus. */
  const moreFeed = () => {
    const next = mixed?.find((row) => row.block >= feedBlocks);
    // The screen already ranked beyond what showed counts as drawn at once, so a source arriving in this same moment
    // joins below it rather than on it; the count rises further once the new screens are on screen.
    if (next !== undefined) setDrawnBlocks((drawn) => Math.max(drawn, next.block + 1));
    setFeedBlocks((blocks) => blocks + FEED_MORE_BLOCKS);
    if (next !== undefined) setFocusId(next.item.id);
  };
  const empty = list.shown.length === 0 && list.held.length === 0;
  // By date, only once the first top-up has been decided, so the related sections start below a settled list.
  if (!busy && !firstRoundDone && (!sortedByDate || toppedUp)) setFirstRoundDone(true);

  // Not searched yet and nothing to show: the page asks a live source for something rather than draw an empty list
  // (Luke, 2026-11-04). Only an honest last line once every word has been tried.
  const browsing = !art && (shown.kind === 'stream' || (shown.kind === 'search' && shown.picked === true));
  const browsed = shown.kind === 'link' ? null : shown.filters;
  const nextSeed =
    // A READING kind with nothing in it searches nowhere else for a word: it just says so.
    browsing && browsed !== null && empty && !busy && !failed && !isReadingSource(browsed.source)
      ? pickSeed({ kino: browsed.source === 'kino', kind: browsed.type }, taste, tried, openedAt)
      : null;
  useEffect(() => {
    if (nextSeed === null || browsed === null) return;
    // Starting a fetch is what this effect is for: the list's state moves to "asking" as it does, as `restart` does.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    browseWith(nextSeed, browsed);
    // Runs when the next word changes; the filters are read as they stand then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextSeed]);

  const kinoOn = !art && !home && picked === null && boxFilters.source === 'kino';

  /**
   * YOUR YOUTUBE's view (Luke, 2026-11-14; WebYouTubeHome.tsx): the reader's YouTube, laid out by VIEW (GRID by choice),
   * with its LINK and IMPORT YOUTUBE HISTORY keys. The rows are this page's own, so each plays, queues and takes the
   * feedback key as it does anywhere; how many show stays here, so MEDIA keeps its place (media-keep.ts).
   */
  const youtubeHome = () => (
    <WebYouTubeHome
      youtube={youtube}
      signedIn={user !== null}
      shown={mineShown}
      onMore={() => setMineShown((shownNow) => shownNow + MINE_STEP)}
      renderRow={(item) => renderRow({ ...item, alsoOn: [] } as WebStreamItem)}
      listClass={viewListClass(view)}
      keyClass={FILTER_KEY}
    />
  );

  const emptyWords = (): string | null => {
    if (nextSeed !== null || (browsing && busy)) return 'READING MEDIA...';
    if (browsing) return 'NOTHING TO SHOW HERE YET. TYPE WORDS TO SEARCH.';
    if (shown.kind === 'link') return busy ? 'READING THE LINK...' : LINK_WORDS[linkOutcome ?? 'no-answer'];
    if (busy) return shown.kind === 'stream' ? 'READING MEDIA...' : null;
    if (shown.kind === 'stream') return null;
    return `NOTHING ${siteFiles.length > 0 || finds.rows.length > 0 ? 'ELSE ' : ''}MATCHES ${searchWordsShown(shown.query, shown.filters)}.`;
  };
  const emptyLine = empty && !failed ? emptyWords() : null;
  const resultIds = new Set(list.shown.map((item) => item.id));

  /** One row, drawn by the component for its kind: a media server's title, a KINO title, or anything else. */
  const renderRow = (item: WebStreamItem, lane?: FeedLane, feed?: FeedWhy) =>
    isMediaRow(item) ? (
      // A title from a media server (SPEC-media-servers.md): its SERVER buttons, pickers and player.
      <WebMediaRow key={item.id} item={item} titleId={rowTitleId(item.id)} />
    ) : isKinoRow(item) ? (
      <KinoRow key={item.id} item={item} titleId={rowTitleId(item.id)} />
    ) : (
      <WebRow key={item.id} item={item} extraHosts={extraHosts} found={liveIds.has(item.id)} onCreator={searchCreator} feedLane={lane} feedWhy={feed} />
    );

  /** DID YOU MEAN pressed: the suggested words in the box, the filters kept, and the search runs. */
  const takeSuggestion = (words: string) => {
    const next = withWords(draft, words);
    setDraft(next);
    restart(next);
  };
  // A year in the words (search-intent.ts): said once, so the reader knows why older titles show.
  const yearWord = shown.kind === 'search' ? splitYear(shown.query).year : null;

  return (
    <section ref={root} aria-label="Media stream">
      <form role="search" aria-label="Search media" onSubmit={submit} className="mb-1 flex flex-wrap items-center gap-2">
        <label htmlFor="web-search" className="text-label font-bold text-ink">
          SEARCH:
        </label>
        <div className="relative min-w-0 flex-1 max-sm:basis-full">
          <input
            id="web-search"
            type="search"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls={SUGGESTIONS_ID}
            aria-autocomplete="list"
            aria-activedescendant={suggestions.length > 0 ? `${SUGGESTIONS_ID}-${Math.min(highlight, suggestions.length - 1)}` : undefined}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setCaret(event.target.selectionStart ?? event.target.value.length);
              setSuggesting(true);
              setHighlight(0);
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
            onKeyDown={onKeyDown}
            onBlur={() => setSuggesting(false)}
            maxLength={MAX_LINK_LENGTH}
            placeholder="Words, a link, in:youtube, type:audio, from:name..."
            enterKeyHint="search"
            className={`${FIELD_TIGHT} w-full`}
          />
          {/* Drawn over the page, not in it, so typing a filter never pushes the rows down. */}
          {suggestions.length > 0 ? (
            <ul id={SUGGESTIONS_ID} role="listbox" aria-label="Filter values" className="absolute top-full right-0 left-0 z-menu mt-1 frame bg-paper p-1">
              {suggestions.map((option, index) => (
                <li
                  key={option.word}
                  id={`${SUGGESTIONS_ID}-${index}`}
                  role="option"
                  aria-selected={index === highlight}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setHighlight(index)}
                  onClick={() => choose(option.word)}
                  className={`flex cursor-pointer items-center justify-between gap-2 px-1 py-0.5 text-label max-sm:min-h-tap ${index === highlight ? 'bg-ink text-paper' : 'text-ink'}`}
                >
                  <span>{`${active?.key ?? ''}:${option.word}`}</span>
                  <span className={index === highlight ? '' : 'text-ink-quiet'}>{option.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button type="submit" className={PLATE}>
          [ SEARCH ]
        </button>
        {/* No CLEAR key (Luke, 2026-11-14: "Remove both"): RESET FILTERS clears the filters, and the box empties by hand. */}
      </form>

      {/* The filters, as keys. Each writes its filter into the box above, which stays the one truth. */}
      <div className="mb-2 space-y-1">
        {/* The top row (Luke, 2026-11-14): three big keys, each its own view. RECOMMENDED and DISCOVER are PICKS in FILTERS. */}
        <div className="flex flex-wrap justify-center gap-2" data-top-row>
          <button type="button" onClick={openKino} aria-pressed={kinoOn} aria-label="KINO: films and shows, and where to watch them" className={kinoOn ? FILTER_KEY_ON : FILTER_KEY} data-kino-key>
            {kinoOn ? 'KINO' : '[ KINO ]'}
          </button>
          {YOUTUBE_LINK_ON ? (
            <button type="button" onClick={toggleHome} aria-pressed={home} aria-label="Your YouTube: new videos from your channels, and your likes" className={home ? FILTER_KEY_ON : FILTER_KEY} data-youtube-home-key>
              {home ? 'YOUR YOUTUBE' : '[ YOUR YOUTUBE ]'}
            </button>
          ) : null}
          {/* Luke, 2026-11-11: your own PDF or EPUB in the site's reader, opened in the browser, never uploaded. */}
          {/* A move within the site, never a fresh page load: that took a room and what was playing down with it (Luke,
              2026-11-16). Nothing to prefetch for a page that only opens a file picker. */}
          <button type="button" onClick={() => router.push('/read')} className={FILTER_KEY} data-own-book-key>
            [ READ YOUR OWN BOOK ]
          </button>
        </div>
        {/* The filter panel (Luke, 2026-11-13: "expandable, organised and much clearer"): one plain line of what is
            chosen, RESET, and a section for each filter that folds open and shut. Every key still only writes its
            filter into the box above, which stays the one truth. */}
        <div className="flex flex-wrap items-center gap-2 py-1" data-filters-summary>
          {/* The one fold (Luke, 2026-11-14: "one initial expansion"): every filter section sits inside it. Shut on a first
              visit; this browser remembers it after that. */}
          <button
            type="button"
            onClick={() => toggleFold('media-filters')}
            aria-expanded={folds.has('media-filters')}
            aria-controls="media-filters-panel"
            className={FOLD_KEY}
            data-filters-key
          >
            {`[ ${folds.has('media-filters') ? '−' : '+'} FILTERS ]`}
          </button>
          {/* VIEW, its own key beside FILTERS (Luke, 2026-11-14: "separate the view button as a separate button next to the
              filters"): it says the view, and folds the four choices open under this row. */}
          <button type="button" onClick={() => toggleFold('media-view')} aria-expanded={folds.has('media-view')} aria-controls="media-view-panel" className={FOLD_KEY} data-view-toggle>
            {`[ VIEW: ${viewLabel(view)} ]`}
          </button>
          {/* ORDER, its own key to the right of VIEW (Luke, 2026-11-14: "make the order settings be a separate expandable button to
              the right of view and filters"): it says the order, and folds its four choices open under this row. */}
          <button type="button" onClick={() => toggleFold('media-order')} aria-expanded={folds.has('media-order')} aria-controls="media-order-panel" className={FOLD_KEY} data-order-toggle>
            {`[ ORDER: ${orderLabel(boxSort)} ]`}
          </button>
          {/* LIVE, beside ORDER (SPEC-live-streams.md, Luke 2026-11-17, 1A): only what is on now, this site's live rooms first, then
              Twitch and YouTube. Typed `is:live` too; it only writes that into the box, like every filter key. */}
          <button
            type="button"
            onClick={() => pickFilter('is', boxFilters.live === true ? 'all' : 'live')}
            aria-pressed={boxFilters.live === true}
            aria-label="Live: only what is on now"
            className={boxFilters.live === true ? FILTER_KEY_ON : FILTER_KEY}
            data-live-key
          >
            {boxFilters.live === true ? '● LIVE' : '[ ● LIVE ]'}
          </button>
          <p className="text-key text-ink wrap-anywhere">
            <span className="text-accent-ink">SHOWING: </span>
            {home ? 'YOUR YOUTUBE' : filtersInWords(boxFilters, art)}
            {picked !== null && !home ? ` · ${picked.toUpperCase()}` : ''}
          </p>
          {hasFilters(boxFilters) || art || picked !== null ? (
            <button type="button" onClick={resetFilters} className={FILTER_KEY} data-reset-filters>
              [ RESET FILTERS ]
            </button>
          ) : null}
        </div>
        <div id="media-view-panel" hidden={!folds.has('media-view')} className="py-1">
          <WebViewKey />
        </div>
        {/* ORDER's choices, one to a line (SPEC-web-sort.md): a press on the order already chosen asks nothing (pickFilter). */}
        <div id="media-order-panel" role="group" aria-label="Order" hidden={!folds.has('media-order')} data-undo-picks="ORDER" className="flex flex-col items-start gap-1 py-1" data-order-panel>
          {ORDER_KEYS.map((key) => {
            const on = boxSort.sort === key.choice.sort && boxSort.dir === key.choice.dir;
            return (
              <button key={key.label} type="button" onClick={() => pickSort(key.choice)} aria-pressed={on} aria-label={`Order: ${key.label}`} className={on ? FILTER_KEY_ON : FILTER_KEY}>
                {on ? key.label : `[ ${key.label} ]`}
              </button>
            );
          })}
        </div>
        <div id="media-filters-panel" data-filter-panel hidden={!folds.has('media-filters')}>
          <div role="group" aria-label="Quick picks" className="flex flex-wrap items-center gap-1 py-1" data-quick-picks>
            {QUICK_PICKS.map((pick) => {
              const on = !art && boxFilters.source === pick.source && boxFilters.type === pick.type;
              return (
                <button key={pick.label} type="button" onClick={() => pickQuick(pick)} aria-pressed={on} aria-label={`Quick pick: ${pick.name}`} className={on ? FILTER_KEY_ON : FILTER_KEY}>
                  {on ? pick.label : `[ ${pick.label} ]`}
                </button>
              );
            })}
          </div>
          {/* Every choice at once, one labelled row each (Luke, 2026-11-14: "more space efficient, showing all the selectable
              filters organised but not needing so many clicks"): one press opens FILTERS, one more picks anything. */}
          <FilterRow label="PICKS">
            {PICKS.map((choice) => {
              const on = !art && !home && picked === choice.value;
              return (
                <button key={choice.label} type="button" onClick={() => choosePicks(choice.value)} aria-pressed={on} aria-label={`Picks: ${choice.label}. ${choice.line}`} title={choice.line} className={on ? FILTER_KEY_ON : FILTER_KEY} data-picks={choice.label}>
                  {on ? choice.label : `[ ${choice.label} ]`}
                </button>
              );
            })}
          </FilterRow>
          <FilterRow label="WHERE FROM">
            {sourceKey(SOURCE_OPTIONS[0])}
            {sourceGroups().map((group) => (
              <span key={group.heading} className="contents">
                <span className="text-label text-ink-quiet">{`${group.heading}:`}</span>
                {group.options.map(sourceKey)}
              </span>
            ))}
            <span className="text-label text-ink-quiet">THIS SITE:</span>
            <button
              type="button"
              onClick={() => {
                setArt(true);
                setPicked(null);
                setHome(false);
                window.history.replaceState(window.history.state, '', '?art=1');
              }}
              aria-pressed={art}
              aria-label="Source: stream art, the saved room canvases"
              className={art ? FILTER_KEY_ON : FILTER_KEY}
              data-stream-art-key
            >
              [ STREAM ART ]
            </button>
          </FilterRow>
          <FilterRow label="WHAT KIND">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => pickFilter('type', option.value)}
                aria-pressed={boxFilters.type === option.value}
                aria-label={`Type: ${option.label}`}
                className={boxFilters.type === option.value ? FILTER_KEY_ON : FILTER_KEY}
              >
                {boxFilters.type === option.value ? (option.value === 'all' ? 'ALL KINDS' : option.label) : `[ ${option.value === 'all' ? 'ALL KINDS' : option.label} ]`}
              </button>
            ))}
          </FilterRow>
          {/* LANGUAGE (Luke's list, 2026-11-14, M13: "allow search by language among the filters"), typed `lang:fr` too. The
              Archive, BOOKS and PeerTube are asked for it; every other source's rows show only when their language is known
              (language.ts `inLanguage`), which the line under the keys says. */}
          <FilterRow label="LANGUAGE">
            {[{ value: 'all', label: 'ANY' }, ...LANGUAGE_OPTIONS].map((option) => {
              const on = (boxFilters.lang ?? 'all') === option.value;
              return (
                <button key={option.value} type="button" onClick={() => pickFilter('lang', option.value)} aria-pressed={on} aria-label={`Language: ${option.label}`} className={on ? FILTER_KEY_ON : FILTER_KEY} data-lang-key={option.value}>
                  {on ? option.label : `[ ${option.label} ]`}
                </button>
              );
            })}
            {boxFilters.lang !== undefined && !LANGUAGE_OPTIONS.some((option) => option.value === boxFilters.lang) ? (
              <span className={FILTER_KEY_ON}>{languageLabel(boxFilters.lang)}</span>
            ) : null}
            <span className="text-label text-ink-quiet">ARCHIVE, BOOKS AND PEERTUBE ARE ASKED; OTHER SITES SHOW A ROW ONLY WHEN ITS LANGUAGE IS KNOWN</span>
          </FilterRow>
          {/* ORDER has its own key beside VIEW (Luke, 2026-11-14), so it is not a row here. */}
          {/* MOOD SEARCH (VIBE): mood and tag words ("cosy", "80s horror") instead of exact words (search-intent.ts). */}
          <FilterRow label="MOOD SEARCH">
            {(['off', 'on'] as const).map((value) => {
              const on = (value === 'on') === (boxFilters.vibe === true);
              return (
                <button key={value} type="button" onClick={() => pickFilter('vibe', value)} aria-pressed={on} aria-label={`Mood search: ${value}`} className={on ? FILTER_KEY_ON : FILTER_KEY}>
                  {on ? value.toUpperCase() : `[ ${value.toUpperCase()} ]`}
                </button>
              );
            })}
            <span className="text-label text-ink-quiet">MOODS, TAGS, GENRES AND DECADES, NOT EXACT WORDS</span>
          </FilterRow>
          {/* CREATOR (`from:`): shown once one is chosen, by a creator's name on a row or typed. */}
          {authorsOf(boxFilters).length > 0 ? (
            <FilterRow label="CREATOR">
              {authorsOf(boxFilters).map((name) => (
                <button key={name} type="button" onClick={() => applyBox(withoutAuthor(draft, name))} aria-label={`Stop showing only ${name}`} className={FILTER_KEY}>
                  {`[ × ${name.toUpperCase()} ]`}
                </button>
              ))}
            </FilterRow>
          ) : null}
        </div>
      </div>

      {home ? youtubeHome() : picked !== null && !art ? <WebPickedList key={boxFilters.lang ?? 'any'} list={picked} sort={pickSortOf(boxFilters)} filters={boxFilters} renderRow={(item) => renderRow({ ...item, alsoOn: [] } as WebStreamItem)} /> : art ? <StreamArtShelf /> : <>
      {/* DEBASER.SITE first: the site's own files the search finds. Keyed by the search, so ALL n FILES starts shut. */}
      {/* This site's live rooms, first of all (SPEC-live-streams.md: "prioritises user rooms"): under a search, or the LIVE key. */}
      {(shown.kind === 'search' || (shown.kind === 'stream' && (shown.filters.live === true || mixOn))) && shown.filters.source === 'all' && (shown.filters.type === 'all' || shown.filters.type === 'video') && authorsOf(shown.filters).length === 0 ? (
        <WebLiveRooms key={searchAddress({ ...shown.filters, text: shown.kind === 'search' ? shown.query : '' })} query={shown.kind === 'search' ? shown.query : ''} />
      ) : null}
      {shown.kind === 'search' && shown.filters.live !== true ? <WebSiteFiles key={searchAddress({ ...shown.filters, text: shown.query })} matches={siteFiles} /> : null}

      {emptyLine !== null ? (
        <p role="status" className="text-label font-bold text-ink wrap-anywhere">
          {emptyLine}
        </p>
      ) : null}
      {!empty && shown.kind !== 'stream' && !browsing ? (
        <p className="text-label font-bold text-ink-quiet wrap-anywhere">
          {shown.kind === 'link'
            ? LINK_WORDS.found
            : `${authorsOf(shown.filters).length > 0 ? '' : 'RESULTS FOR '}${searchWordsShown(shown.query, shown.filters)}`}
        </p>
      ) : null}
      {shown.kind === 'search' && related?.suggestion ? (
        <p className="flex flex-wrap items-center gap-1 text-label font-bold text-ink">
          <span>DID YOU MEAN</span>
          <button type="button" onClick={() => takeSuggestion(related.suggestion as string)} className={PLATE} aria-label={`Search for "${related.suggestion}" instead`}>
            {`[ ${related.suggestion.toUpperCase()} ]`}
          </button>
          <span>?</span>
        </p>
      ) : null}
      {yearWord !== null ? (
        <p className="text-label text-ink-quiet wrap-anywhere">{`${yearWord} IS ALSO READ AS THE YEAR IT WAS MADE (KINO, INTERNET ARCHIVE).`}</p>
      ) : null}
      {shown.kind === 'search' && authorsOf(shown.filters).length > 1 && sourcesFor(shown).some((source) => source !== 'stream') ? (
        <p className="text-label text-ink-quiet wrap-anywhere">
          {`LIVE SOURCES ARE ASKED ABOUT ONE CREATOR AT A TIME: ${authorsOf(shown.filters)[0].toUpperCase()}.`}
        </p>
      ) : null}
      {finds.asked ? <CatalogueLine finds={finds} /> : null}
      {/* Its own fixed line, so a source finishing never moves the rows below it. */}
      {searching ? (
        <p role="status" className="text-label text-ink-quiet wrap-anywhere">
          {busy ? `ASKING: ${asking.map(sourceLabel).join(', ')}...` : 'EVERY SOURCE HAS ANSWERED.'}
        </p>
      ) : null}
      {shown.kind === 'stream' && boxFilters.sort !== undefined && boxFilters.text === '' && !isReadingSource(boxFilters.source) ? (
        <p className="text-label text-ink-quiet wrap-anywhere">SORT IS FOR SEARCHES: THE STREAM STAYS NEWEST FIRST.</p>
      ) : null}
      {problems.length > 0 || unsorted.length > 0 ? (
        <ul aria-label="Sources that did not answer" className="mb-1">
          {unsorted.map((source) => (
            <li key={`unsorted-${source}`} className="text-label font-bold text-ink-quiet">
              {`${source === 'stream' ? 'SAVED' : PLATFORM_LABELS[source]}: NO POPULARITY ORDER`}
            </li>
          ))}
          {problems.map((line, index) => (
            <li key={`${line.platform}-${index}`} className="text-label font-bold text-ink-quiet">
              {`${line.label}: ${line.problem}`}
            </li>
          ))}
        </ul>
      ) : null}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {list.held.length > 0 ? (
        <div className="my-1">
          <button type="button" onClick={showMore} className={PLATE}>
            {`[ ${list.held.length} MORE RESULTS ]`}
          </button>
        </div>
      ) : null}

      {browsing && list.shown.length > 0 && (mixed === null || mixed.length > 0) ? <p className="text-label font-bold text-ink-quiet">PICKED FOR YOU</p> : null}
      {list.shown.length === 0 ? null : (
        <ul className={viewListClass(view)} aria-label={picksOrdered ? 'Items picked for you' : shown.kind === 'stream' ? 'Items, newest first' : `Results, ${list.order.kind === 'turns' ? 'each site in turn' : list.order.dir === 'asc' ? 'oldest first' : 'newest first'}`}>
          {feedRows !== null ? feedRows.map(({ item, lane, why, people, block }) => renderRow(item, lane, { why, people: people ?? [], block })) : drawn.map((item) => renderRow(item))}
        </ul>
      )}

      {failed ? (
        <p role="alert" className="mt-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">
          {refusal ?? (shown.kind === 'stream' ? 'COULD NOT READ THE STREAM. TRY AGAIN.' : 'COULD NOT SEARCH. TRY AGAIN.')}
        </p>
      ) : null}

      {mixed !== null && feedRows !== null && mixed.length > feedRows.length ? (
        <div className="mt-3">
          <button type="button" onClick={moreFeed} className={PLATE_MAIN}>
            [ LOAD MORE ]
          </button>
        </div>
      ) : null}

      {(mixed === null && Object.keys(cursors).length > 0 && !empty) || (failed && empty) ? (
        <div className="mt-3">
          <button type="button" onClick={failed && empty ? () => restart(draft) : loadMore} disabled={busy} className={PLATE_MAIN}>
            {busy ? '[ LOADING... ]' : failed && empty ? '[ TRY AGAIN ]' : shown.kind === 'search' && shown.query !== '' ? `[ MORE FOR "${shown.query.toUpperCase()}" ]` : '[ LOAD MORE ]'}
          </button>
        </div>
      ) : null}

      {shown.kind === 'search' ? <WebCatalogueFinds key={searchAddress({ ...shown.filters, text: shown.query })} finds={finds} resultIds={resultIds} renderRow={(item) => renderRow({ ...item, alsoOn: [] } as WebStreamItem)} /> : null}

      {/* Related topics (related.ts), each its own section below the results, loaded once the reader scrolls to it. */}
      {shown.kind === 'search' && related !== null
        ? related.topics.map((topic) => (
            <RelatedSection
              key={`${searchAddress({ ...shown.filters, text: shown.query })}:${topic.label}`}
              topic={topic}
              filters={shown.filters}
              exclude={list.seen}
              renderRow={renderRow}
              ready={firstRoundDone}
            />
          ))
        : null}
      </>}
    </section>
  );
}

/**
 * One related topic (related.ts) under the results: "RELATED: DOCTOR WHO" for a search for "dalek". It asks the same
 * sources as the search, for the topic's words (or, for a TMDB keyword, KINO alone), once the reader scrolls it into
 * view or presses its key; its rows join below its heading and never move the results above. A row already listed
 * above is not shown again. MORE asks each source for its next page, here only.
 */
function RelatedSection({
  topic,
  filters,
  exclude,
  renderRow,
  ready,
}: {
  topic: Related['topics'][number];
  filters: Filters;
  exclude: ReadonlySet<string>;
  renderRow: (item: WebStreamItem) => React.ReactNode;
  /** The search's own results have all answered once, so this section starts below them, not among them. */
  ready: boolean;
}) {
  const view = useMediaView();
  // Each site's best match, newest first, as before the SORT row: the order chosen is the search's own.
  const what: Shown = { kind: 'search', query: topic.query, filters: { ...filters, sort: undefined } };
  const sources: Source[] = topic.keyword !== undefined ? ['kino'] : sourcesFor(what);
  const [started, setStarted] = useState(false);
  const [list, setList] = useState<LiveList>(EMPTY_LIVE);
  const [cursors, setCursors] = useState<Partial<Record<Source, string>>>({});
  const [asking, setAsking] = useState<Source[]>([]);
  const mark = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  /** Asked already: a section loads its first page once. */
  const begun = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const askAll = useCallback(
    (from: Partial<Record<Source, string>> | null) => {
      const asked = from === null ? sources : (Object.keys(from) as Source[]);
      setAsking(asked);
      for (const source of asked) {
        void readSource(source, what, from?.[source] ?? null, topic.keyword)
          .then((page) => {
            if (!alive.current) return;
            const items = page.items.filter((item) => !exclude.has(item.id) && matchesFilters(item, readingAware(source, filters), source === 'stream'));
            setList((current) => arrive(current, items, true));
            setCursors((current) => {
              const next = { ...current };
              if (page.nextCursor === null) delete next[source];
              else next[source] = page.nextCursor;
              return next;
            });
          })
          .catch(() => undefined)
          .finally(() => {
            if (alive.current) setAsking((current) => current.filter((waiting) => waiting !== source));
          });
      }
    },
    // The topic and filters are fixed for this section's life (its key changes with every search).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const start = useCallback(() => {
    if (begun.current) return;
    begun.current = true;
    setStarted(true);
    askAll(null);
  }, [askAll]);

  // Loaded when its heading comes into view, so it costs nothing for a reader who never scrolls this far.
  useEffect(() => {
    const node = mark.current;
    if (node === null || started || !ready || typeof IntersectionObserver === 'undefined') return;
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) start();
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, [started, start, ready]);

  const busy = asking.length > 0;
  return (
    <section aria-label={`Related: ${topic.label}`} className="mt-4">
      <div ref={mark} className="rule-pixel flex flex-wrap items-center gap-2 py-1">
        <h3 className="text-heading font-bold text-ink wrap-anywhere">{topic.keyword !== undefined ? topic.label : `RELATED: ${topic.label}`}</h3>
        {!started ? (
          <button type="button" onClick={start} className={PLATE}>
            [ SHOW ]
          </button>
        ) : null}
      </div>
      {started && busy && list.shown.length === 0 ? (
        <p role="status" className="text-label text-ink-quiet">
          {`LOOKING FOR ${topic.label}...`}
        </p>
      ) : null}
      {started && !busy && list.shown.length === 0 ? <p className="text-label text-ink-quiet">NOTHING MORE HERE.</p> : null}
      {list.shown.length > 0 ? <ul aria-label={`Related to ${topic.label}`} className={viewListClass(view)}>{list.shown.map(renderRow)}</ul> : null}
      {started && Object.keys(cursors).length > 0 && list.shown.length > 0 ? (
        <div className="mt-3">
          <button type="button" onClick={() => askAll(cursors)} disabled={busy} className={PLATE_MAIN}>
            {busy ? '[ LOADING... ]' : `[ MORE: ${topic.label} ]`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * YouTube's player refuses to start without knowing which site embeds it ("Error 153: video player configuration
 * error", live-checked 2026-10-31 with no-referrer), so it alone is told our origin - strict-origin: the site's address
 * only, never the page path, and nothing over plain http.
 */
function embedReferrer(platform: WebItem['platform']): 'strict-origin' | 'no-referrer' {
  return platform === 'youtube' ? 'strict-origin' : 'no-referrer';
}

/**
 * Live-checked 2026-10-31: the Archive's player needs its scripts, and its own origin to fetch the files it plays; it
 * drew and played with exactly these two. allow-same-origin keeps it on archive.org's origin, never ours (it is
 * cross-origin). No popups, forms or top navigation. Autoplay: the player starts on the reader's own press of PLAY.
 */
const EMBED_SANDBOX = 'allow-scripts allow-same-origin';

/**
 * A reading row's key out (SPEC-media-feed.md): the site the link goes to. A paper names arXiv or Europe PMC, where it
 * opens (decision 3A); a Hacker News or Lobsters story names the story's own site (decision 2A); anything else its outlet.
 */
function readingKeyLabel(item: WebItem, link: string): string {
  const host = new URL(link).hostname;
  if (item.platform === 'paper') return host === 'arxiv.org' ? 'ARXIV' : 'EUROPE PMC';
  if (item.platform === 'tech' && (item.outlet === 'HACKER NEWS' || item.outlet === 'LOBSTERS')) return openLinkSite(link);
  return item.outlet ?? openLinkSite(link);
}

/** The id of a row's title, which takes focus after LOAD MORE. Item ids are `platform:identifier`. */
function rowTitleId(itemId: string): string {
  return `web-row-${itemId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/**
 * `found`: a result of a search everywhere or a pasted link, not (yet) in the stream. Opening one (PLAY,
 * DISCUSS, WATCH) asks for it to be saved into the stream (save-opened.ts); DISCUSS is offered only while that
 * saving is on, so a thread is never filed under an item that will not arrive.
 */
export function WebRow({
  item,
  extraHosts,
  found,
  onCreator,
  feedLane,
  feedWhy,
}: {
  item: WebStreamItem;
  extraHosts: ExtraHosts;
  found: boolean;
  /** In MEDIA's default feed: which of its sources placed this row (feed-mix.ts), as a data attribute only. */
  feedLane?: FeedLane;
  /** In MEDIA's default feed: why this row is here, in plain words, and the faces of the people who are the reason. */
  feedWhy?: FeedWhy;
  /** The creator's name is a key: everything from them (`from:`), like a name on the forum. */
  onCreator: (name: string) => void;
}) {
  /** A reader (a book's page-turner) stays in its row; a video or a sound is the site's one floating player. */
  const floats = item.kind === 'video' || item.kind === 'audio';
  const playId = `web:${item.id}`;
  const playingHere = usePlayingHere(playId);
  const [readerOpen, setReaderOpen] = useState(false);
  const playing = floats ? playingHere : readerOpen;
  const [thumbFailed, setThumbFailed] = useState(false);
  const opened = () => {
    noteOpened(item, item.pickWords ?? []);
    // FOR YOU's private history (SPEC-recommender.md): kept on the account, owner only, 90 days.
    noteHistory({ kind: 'media', ref: item.id, title: item.title, maker: item.creator ?? '', words: [...(item.tags ?? []), ...(item.pickWords ?? [])], action: floats ? 'played' : 'opened' });
    if (found) void recordOpened(item);
    noteOpenedRow(item.id);
  };

  const source = PLATFORM_LABELS[item.platform];
  // A reading row is checked against the reading lists (brief/addresses.ts); every other row against its platform's.
  const addresses = isReadingKind(item.platform) ? readingRowAddresses(item) : rowAddresses(item, extraHosts);
  const { link, embed, licence } = addresses;
  // A book the site's reader opens (Luke, 2026-11-13: "any book can be read in the ereader"): every Open Library work,
  // every Internet Archive text (free, lent or unknown), and every book on IPFS. The reader resolves a bare OL work ref
  // to its best copy server-side, opens the Archive's viewer for lent items, and shows a "no free copy" page inside its
  // own frame when nothing opens.
  const readable = (item.platform === 'books' || item.platform === 'ipfs' || (item.platform === 'internet_archive' && item.kind === 'text')) && isReadable(item.id);
  const bookPage = item.platform === 'books' && item.book?.edition ? `/media/book/edition:${item.book.edition}` : `/media/book/${item.id}`;
  const thumb = thumbFailed ? null : addresses.thumb;
  const inBar = playsInBar(item);
  const date = item.publishedAt.slice(0, 10);
  const view = useMediaView();
  /** COMPACT shows the title and the main keys only. */
  const full = view !== 'compact';
  // An Archive item with two or more videos is a series (SPEC-stream-series.md): marked here, ticked in a room's queue.
  const seriesCount = useSeriesCount(item);
  const archiveSubtitles = useArchiveRowSubtitles(item);

  /**
   * How this row can play in a room: it has the key only if it can. A picture result takes its turn as a picture
   * (SPEC-rooms-queues.md, phase 5): the same hotlinked picture the row shows, from the platform's own picture host,
   * held on the screen until NEXT.
   */
  const pictureAddress = item.kind === 'image' ? addresses.thumb : null;
  const roomLink = canWatch(item) ? watchLinkForItem(item) : pictureAddress !== null && pictureAddress !== undefined ? pictureLink(pictureAddress, item.title, item.creator) : null;
  // `webRef`: the queue item keeps which result it is, so this row's DISCUSS page finds the room chat said over it.
  const roomSource = roomLink === null ? undefined : { link: roomLink, webRef: item.id };

  /** Starts the platform's own player: the reader has just pressed PLAY, and only then does anything of theirs load. */
  const startPlayer = () => {
    if (embed === null) return;
    if (!floats) {
      setReaderOpen(true);
      return;
    }
    const timeFrom = timeSourceOf(item.platform);
    playFloating({
      id: playId,
      title: item.title,
      shape: item.kind === 'audio' ? 'audio' : 'video',
      room: roomSource,
      player: {
        kind: 'frame',
        src: embedWithPlace(startingEmbed(embed, item.platform, contentLanguage(item)), timeFrom, placeOf(playId), window.location.origin),
        frameTitle: `${source} player: ${item.title}`,
        referrerPolicy: embedReferrer(item.platform),
        sandbox: EMBED_SANDBOX,
        allow: item.kind === 'video' ? 'autoplay; fullscreen' : 'autoplay',
        allowFullScreen: false,
        timeFrom,
      },
    });
  };
  const stopPlayer = () => {
    if (floats) closeFloatingIfMine(playId);
    else setReaderOpen(false);
  };

  // PLAY / + QUEUE, one key of two halves (Luke's list, 2026-11-14, M6 and his ROOMS answer 7A). PLAY is the bar's key for
  // audio it plays, else the platform's own player; the second half is QueueHalf.tsx's to say. Audio the bar plays never
  // falls back to the platform's player in the row (list 4): with no file it says so and offers the platform's own page.
  const barPlay = useBarPlay(item, opened, link === null ? null : { href: link, source });
  const barItem = inBar && isBarAudioPlatform(item.platform) ? { platform: item.platform, externalId: item.externalId } : null;
  const queueHalf = useQueueHalf({ bar: barItem, room: roomSource, playId, title: item.title, onPress: opened });
  const playHalf: Half | null = readable
    ? null
    : inBar && !playing
      ? barPlay
      : embed
        ? {
            words: playing ? '■ CLOSE' : '▶ PLAY',
            // The visible word leads the name (PLAY / CLOSE), so a voice command for what is on screen works.
            label: playing ? `Close the ${source} player for "${item.title}"` : `Play "${item.title}" (loads the ${source} player)`,
            press: () => {
              if (playing) {
                stopPlayer();
                return;
              }
              opened();
              startPlayer();
            },
            expanded: playing,
            on: playing,
            data: 'play',
          }
        : null;
  // GRID (Luke, 2026-11-17: "fitting the < . > on the end of the play and queue buttons"): the arrow is the last part of the
  // PLAY / QUEUE key, so a card about 160px wide keeps them on one line. Other views keep the arrow as its own key.
  const keyHoldsArrow: { label: string; first: Half; second: Half | null } | null =
    view !== 'grid' || !full
      ? null
      : playHalf !== null
        ? { label: `Play or queue "${item.title}"`, first: playHalf, second: queueHalf }
        : queueHalf !== null && !readable
          ? { label: `Queue "${item.title}"`, first: queueHalf, second: null }
          : null;
  const arrowInKey =
    keyHoldsArrow === null
      ? undefined
      : (arrow: React.ReactNode) => <SplitKey label={keyHoldsArrow.label} first={keyHoldsArrow.first} second={keyHoldsArrow.second} end={arrow} tight />;
  // What the arrow opens (MEDIACARD, Luke 2026-11-17: "with the source also only showing on expansion"): an area of its own
  // under the keys, each row starting shut.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = `${rowTitleId(item.id)}-more`;
  // The row's thing for a playlist (playlist-adding.ts): what the bar plays, by its first file's id; otherwise a video,
  // kept whole by the same link a room would queue (SPEC-rooms-queues.md, phase 4: ADD TO PLAYLIST takes a video).
  const playlistThing =
    barItem !== null
      ? { title: item.title, link: { url: webAudioFilePath(barItem.platform, barItem.externalId, 0), kind: 'audio' as const, title: item.title }, trackId: webTrackId(barItem.platform, barItem.externalId, 0) }
      : roomLink !== null
        ? { title: item.title, link: roomLink }
        : null;
  // M7: the other copies fold open from a key that stands before PLAY.
  const [alsoOpen, setAlsoOpen] = useState(false);
  const alsoId = `${rowTitleId(item.id)}-also`;
  // A paper, news story, long read or tech link (SPEC-media-feed.md): its kind and outlet in the facts, and a key out to
  // the outlet in a new tab. Never saved into the stream, so no thread, letter or playlist hangs off it.
  const reading = isReadingKind(item.platform);
  // MEDIACARD (Luke, 2026-11-17: "with the source also only showing on expansion"): shut, a row says what it is and when
  // (a reading row's kind is its platform's name: PAPER, NEWS, LONG READ, TECH); where it is from waits behind the arrow:
  // the platform, or for a reading row its outlet and the site its key opens.
  const kind = reading ? source : KIND_LABELS[item.kind];
  const outletKey = !reading || link === null ? null : readingKeyLabel(item, link);
  const from = reading ? [...new Set([item.outlet ?? '', outletKey ?? ''].filter(Boolean))] : [source];
  // No YouTube Shorts anywhere in MEDIA (shorts-client.ts; Luke, 2026-11-14): the last net for rows from the picks, the tagged
  // catalogue and YOUR YOUTUBE. A marked Short never draws; one YouTube confirms goes; an unsure one (and music) stays.
  const hiddenShort = useHiddenShort(item);
  if (hiddenShort) return null;

  return (
    <li className={`rule-pixel ${full ? 'py-2' : 'py-1'} ${view === 'grid' ? 'min-w-0' : ''}`} data-view={view} data-feed-lane={feedLane} data-feed-block={feedWhy?.block} data-reading={reading ? item.platform : undefined}>
      <div className={ROW_LAYOUT[view]}>
        {/* A fixed box, so a slow or missing picture never moves the row. OPEN sits in its top right corner (M8). */}
        <span className={`relative block ${THUMB_BOX[view]} shrink-0 overflow-hidden border border-ink-plate bg-paper`}>
          {/* A hotlinked third-party thumbnail: a plain <img> sends no referrer and costs no Vercel image
              optimisation, where next/image would proxy (and count) every one. Hence the one lint exception. */}
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt=""
              width={96}
              height={72}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setThumbFailed(true)}
              className="block h-full w-full object-cover"
            />
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
          {link ? <ThumbOpen href={link} label={`Open "${item.title}" on ${source} (new tab)`} /> : null}
        </span>

        {/* M5: the title in the one heavier weight; who made it and the small facts in the caption ink; the description in
            plain ink between them. No words say which is which. COMPACT is one line: the title, then its keys. */}
        <div className={full ? 'min-w-0 flex-1' : 'flex min-w-0 flex-1 items-center gap-2'}>
          <p id={rowTitleId(item.id)} tabIndex={-1} className={`${TITLE_CLASS[view]} font-strong text-ink wrap-anywhere ${full ? '' : 'min-w-0 flex-1'}`}>
            {item.title}
            <AudioSubsFlags audio={contentLanguage(item)} subs={archiveSubtitles} burnedIn={burnedInSubtitles(item.description ? `${item.title}
${item.description}` : item.title)} className="ml-1.5" />
          </p>
          {!full ? null : item.creator && authorWords(item.creator) !== null ? (
            <p>
              <button
                type="button"
                onClick={() => onCreator(item.creator ?? '')}
                aria-label={`Search for more from ${item.creator}`}
                title={view === 'grid' ? `More from ${item.creator}` : 'More from this creator'}
                className={`cursor-pointer text-left text-label text-ink-quiet wrap-anywhere hover:underline max-sm:min-h-tap ${view === 'grid' ? CREATOR_ONE_LINE : ''}`}
              >
                {item.creator}
              </button>
            </p>
          ) : item.creator ? (
            <p className={`text-label text-ink-quiet wrap-anywhere ${view === 'grid' ? CREATOR_ONE_LINE : ''}`} title={view === 'grid' ? item.creator : undefined}>
              {item.creator}
            </p>
          ) : null}
          {item.description && full && view !== 'grid' ? (
            <p className={`mt-1 ${view === 'large' ? 'line-clamp-6 text-key' : 'line-clamp-2 text-label'} text-ink wrap-anywhere`}>{item.description}</p>
          ) : null}

          {/* The small facts, then the keys on the same line (M11): fewer lines, so more results fit. */}
          <div className={full ? 'mt-1 flex flex-wrap items-center gap-x-3 gap-y-1' : 'contents'}>
            {/* MEDIACARD (Luke, 2026-11-17: "the media stuff needs to be significantly neater, with the source also only
                showing on expansion"): shut, the facts are what it is and when, KIND · DATE (● LIVE for one on now), always
                whole, never cut with "…". GRID keeps them on one line with tight dots (GRIDCARD: "the details of the video ...
                should take one line"); a series mark, too long for a narrow card's line, takes the next one whole. Where it is
                from, its licence and a book's editions are behind the arrow. */}
            {full ? (
              <p className={`flex flex-wrap items-center text-label text-ink-quiet ${view === 'grid' ? 'w-full whitespace-nowrap' : 'gap-x-1.5'}`} data-row-facts>
                <span>{kind}</span>
                {seriesCount === null ? null : (
                  <span className={`bg-acid px-1 font-bold text-ink-plate ${view === 'grid' ? 'ml-1' : ''}`} data-series-mark>
                    {seriesMark(seriesCount)}
                  </span>
                )}
                {view === 'grid' ? <TightDot /> : <span aria-hidden="true">·</span>}
                {item.live ? (
                  // On now (SPEC-live-streams.md): where a date goes, the same LIVE mark the room lists use.
                  <span className="bg-acid px-1 font-bold text-ink-plate" data-live-mark>
                    ● LIVE
                  </span>
                ) : (
                  <time dateTime={item.publishedAt}>{date}</time>
                )}
              </p>
            ) : null}

            {/* Why it is here (SPEC-media-feed-v2.md, decision 4A): plain words, and the faces of the people who are the reason. */}
            {feedWhy !== undefined && full ? (
              <p className="flex min-w-0 flex-wrap items-center gap-1 text-label text-ink-quiet" data-why>
                {feedWhy.people
                  .filter((person) => !person.id.startsWith('anon:'))
                  .slice(0, 3)
                  .map((person) => (
                    <FeedFace key={person.id} person={person} />
                  ))}
                <span className="min-w-0 break-words">{feedWhy.why}</span>
              </p>
            ) : null}

            <div className={`flex flex-wrap items-center gap-1 ${view === 'list' || view === 'large' ? 'ml-auto' : ''}`} data-row-keys>
              {/* A book (SPEC-books.md, SPEC-reader.md) opens in the site's reader at /read (Luke, 2026-11-11), for a
                  Gutenberg book and for an Internet Archive one (its EPUB in the reader, or the Archive's own viewer there). */}
              {readable ? (
                <Link href={`/read/${item.id}`} onClick={opened} className={PLATE}>
                  [ READ ]
                </Link>
              ) : null}
              {/* A reading row's way out, to the outlet in a new tab. Its name waits behind the arrow with the other sources
                  (MEDIACARD): `[ QUANTA MAGAZINE ↗ ]` broke inside its brackets on a card about 160px wide. */}
              {outletKey !== null && link !== null ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  onClick={opened}
                  aria-label={`Read "${item.title}" on ${outletKey} (new tab)`}
                  className={PLATE_LINK}
                  data-outlet-key
                >
                  [ READ ↗ ]
                </a>
              ) : null}
              {/* Audio the bar can play goes there (web-audio.ts); the platform's player is the fallback. In GRID the arrow
                  is the key's last part instead (`[ ▶ PLAY│+ QUEUE│▾ ]`, below), so it fits the card's one line. */}
              {keyHoldsArrow !== null ? null : playHalf !== null ? (
                <SplitKey label={`Play or queue "${item.title}"`} first={playHalf} second={queueHalf} />
              ) : queueHalf !== null && !readable ? (
                <SplitKey label={`Queue "${item.title}"`} first={queueHalf} second={null} />
              ) : null}
              {floats && playing ? <PipKey id={playId} title={item.title} /> : null}
              {/* The rest behind one arrow on the same line (Luke, 2026-11-16: "only play and queue, with an arrow on the same
                  row beside them that reveals the rest of the options"). COMPACT keeps to the main keys, as it always has. */}
              {full ? <MoreArrow title={item.title} open={moreOpen} onToggle={() => setMoreOpen(!moreOpen)} controls={moreId} inKey={arrowInKey} /> : null}
            </div>
          </div>

          {/* What the arrow opens (MEDIACARD, Luke 2026-11-17: "significantly neater, with the source also only showing on
              expansion"), the same in every view: an area of its own under the keys, tied to them by the open rule down its
              left (`fold-body`). First where it is from (the platform, or a reading row's outlet), a book's editions and the
              licence, as words; then the keys, every one whole (no key breaks inside its brackets), starting at one left
              edge: one to a line in a GRID card (the pen and the feedback key share one), along one line in LIST and LARGE. */}
          {full && moreOpen ? (
            <div id={moreId} className="fold-body mt-1 flex flex-col items-start gap-1" data-row-more>
              <p className="flex flex-wrap items-center gap-x-3 text-label text-ink-quiet" data-row-source>
                {from.map((name) => (
                  <span key={name} className="whitespace-nowrap">
                    {name}
                  </span>
                ))}
                {item.platform === 'books' && item.book && item.book.editions > 0 ? <span className="whitespace-nowrap">{editionCount(item.book.editions)}</span> : null}
                {licence ? (
                  <a href={licence} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Licence for "${item.title}" (new tab)`} className="hit whitespace-nowrap underline hover:text-ink" data-licence-key>
                    LICENCE ↗
                  </a>
                ) : null}
              </p>
              {/* `-ml-1`: a key's own side padding, given back, so its bracket stands under the first letter of the words above. */}
              <div className={`-ml-1 whitespace-nowrap ${view === 'grid' ? 'flex flex-col items-start gap-1' : 'flex flex-wrap items-center gap-1'}`} data-row-more-keys>
                {/* M7: several copies of the work fold open from here. */}
                {item.alsoOn.length > 0 ? (
                  <button type="button" onClick={() => setAlsoOpen(!alsoOpen)} aria-expanded={alsoOpen} aria-controls={alsoId} className={PLATE}>
                    {`[ ALSO ON ${alsoOpen ? '▴' : '▾'} ]`}
                  </button>
                ) : null}
                {/* M9: `[ + LETTER│PLAYLIST ]`; in a GRID card the two apart, as the joined key is wider than the card. */}
                {!reading ? <LetterPlaylistKey letter={{ kind: 'web', ref: item.id, title: item.title, picture: addresses.thumb ?? undefined }} playlist={playlistThing} apart={view === 'grid'} /> : null}
                <span className="flex items-center gap-1 empty:hidden">
                  {/* The bridges (Phase 5): the item's forum thread, now a small pen (M6). */}
                  {!reading && (!found || SAVE_OPENED) ? <WebDiscussKey item={item} onOpen={opened} short /> : null}
                  {/* NOT FOR ME, SHOW LESS FROM THIS CHANNEL, MORE LIKE THIS (the YOUR YOUTUBE session's key, Luke 2026-11-14:
                      "a single expandable clear button"); it draws nothing signed out. */}
                  <FeedbackKey item={{ kind: 'media', ref: item.id, title: item.title, maker: item.creator ?? '', words: [...(item.tags ?? []), ...(item.pickWords ?? [])] }} why={feedWhy?.why ?? null} />
                </span>
                {item.platform === 'books' ? (
                  <Link href={bookPage} aria-label={`Editions of "${item.title}": every one Open Library lists`} className={PLATE}>
                    [ EDITIONS ]
                  </Link>
                ) : item.platform === 'audiobooks' ? (
                  <Link href={`/media/book/${item.id}`} className={PLATE}>
                    [ BOOK PAGE ]
                  </Link>
                ) : null}
              </div>
              {item.alsoOn.length > 0 ? <AlsoOn item={item} id={alsoId} open={alsoOpen} /> : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Nothing from the platform loads until the reader asks: the player exists only while open. A video or a sound
          plays in the site's one layer, which sits over this box (FloatingPlayer.tsx); a reader stays in its row. */}
      {playing && embed && floats ? (
        <PlayerBox id={playId} title={item.title} className={`mt-2 w-full border border-ink-plate bg-paper ${item.kind === 'video' ? 'aspect-video' : 'h-[44px]'}`} />
      ) : null}
      {playing && embed && !floats ? (
        <iframe
          src={startingEmbed(embed, item.platform, contentLanguage(item))}
          title={`${source} player: ${item.title}`}
          loading="lazy"
          referrerPolicy={embedReferrer(item.platform)}
          sandbox={EMBED_SANDBOX}
          allow="autoplay"
          className={`mt-2 block w-full border border-ink-plate bg-paper ${item.kind === 'text' ? 'h-[360px]' : 'h-[44px]'}`}
        />
      ) : null}
    </li>
  );
}

/**
 * The other copies of this work (dedupe.ts): each one's own source name and its own link, so every
 * source a row stands for is still one press away. A copy whose address fails its checks shows its name only.
 */
// Folded under its `[ ALSO ON ▾ ]` key (M7): drawn while shut too (`hidden`), so opening it moves nothing above it.
function AlsoOn({ item, id, open }: { item: WebStreamItem; id: string; open: boolean }) {
  return (
    <div id={id} hidden={!open} className="mt-1">
      <ul aria-label={`Other copies of "${item.title}"`} className="flex flex-wrap items-center gap-1">
        {item.alsoOn.map((copy) => {
          const source = PLATFORM_LABELS[copy.platform];
          const { link } = rowAddresses(copy);
          return (
            <li key={copy.id} className="contents">
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={`Open "${copy.title}" on ${source} (new tab)`}
                  className={PLATE_LINK}
                >
                  [ {source} ↗ ]
                </a>
              ) : (
                <span className="bg-ice-pale px-1 text-label font-bold text-ink">{source}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
/** GRID's dot between the facts: the face's own middle dot, which sits centred in its letter's width, with no more room round it. */
function TightDot() {
  return <span aria-hidden="true">·</span>;
}

/** Where the bar's globe sends a listener back to, for a track started here: the archive (WEB until 2026-11-03). */
const WEB_ORIGIN = { origin: 'shelf', href: '/media', where: 'MEDIA' } as const;

/**
 * PLAY for audio the site's music bar can play (web-audio.ts): asks our route for the item's files, then
 * hands them to the bar - one file, or a book's chapters in order - where every feature of the bar applies.
 * While this item is the one on the bar the key pauses and resumes it. When no file can be found (an item the
 * platform only lends, or one it would not answer for), the row says so and offers the platform's own page in a new
 * tab (`elsewhere`). It used to open the platform's player in the row, under a key that said "in the music player",
 * while the bar kept the old track (list 4, item 6).
 */
function useBarPlay(item: WebStreamItem, onOpen: () => void, elsewhere: { href: string; source: string } | null): Half {
  /** The row's own checked address (rowAddresses), the only kind an outbound link here may use. */
  const link = elsewhere?.href ?? null;
  const player = useMusicPlayer();
  const [state, setState] = useState<'idle' | 'finding' | 'none'>('idle');
  const onBar = player.track ? parseWebAudioSrc(player.track.src) : null;
  const mine = onBar !== null && onBar.platform === item.platform && onBar.externalId === item.externalId;
  const sounding = mine && player.playing;

  const press = async () => {
    if (mine) {
      player.toggle();
      return;
    }
    if (!playsInBar(item) || state === 'finding') return;
    onOpen();
    setState('finding');
    // The shared lookup (web-track-lookup.ts): the answer is kept, so likes, lists and followers find it too.
    const tracks = isBarAudioPlatform(item.platform) ? await loadWebItem(item.platform, item.externalId) : null;
    if (tracks) {
      setState('idle');
      player.playList(tracks, WEB_ORIGIN);
      return;
    }
    setState('none');
  };

  return {
    words: state === 'finding' ? '… FINDING' : sounding ? '❚❚ PAUSE' : '▶ PLAY',
    // The visible word leads the name, so a voice command for what is on screen works.
    label: sounding ? `Pause "${item.title}" in the music player` : `Play "${item.title}" in the music player`,
    press: () => void press(),
    pressed: sounding,
    busy: state === 'finding',
    on: sounding,
    data: 'bar-play',
    after:
      state === 'none' ? (
        <>
          <span role="status" className="text-label font-bold text-ink">
            NO PLAYABLE FILE
          </span>
          {elsewhere !== null && link !== null ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label={`Open "${item.title}" on ${elsewhere.source} (new tab)`}
              className={PLATE_LINK}
              data-bar-play-elsewhere
            >
              {`[ OPEN ON ${elsewhere.source} ↗ ]`}
            </a>
          ) : null}
        </>
      ) : null,
  };
}

