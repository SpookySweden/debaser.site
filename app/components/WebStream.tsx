'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { artSlot } from '../lib/ui/art/slots';
import { FIELD_TIGHT, PLATE, PLATE_LINK, PLATE_MAIN, PLATE_PRESSED } from '../lib/ui/controls';
import { seriesMark } from '../lib/watch/series';
import { useArchiveRowSubtitles, useSeriesCount } from '../lib/watch/series-client';
import type { WebStreamItem } from '../lib/web/dedupe';
import { DEFAULT_PAGE_SIZE } from '../lib/web/paging';
import { EverywhereError, loadPeertubeHosts, loadRelated, needsPeertubeHosts, searchEverywhere, type LinkOutcome, type ProviderLine, type Related } from '../lib/web/everywhere-client';
import { looksLikeLink, MAX_LINK_LENGTH } from '../lib/web/link-shape';
import { arrive, compareIn, EMPTY_LIVE, emptyLive, freeze, heldBack, lanesToAsk, release, type ListOrder, type LiveList } from '../lib/web/live-merge';
import { getWebRepository } from '../lib/web/repository';
import { rowAddresses, startingEmbed, type ExtraHosts } from '../lib/web/row-addresses';
import { recordOpened, SAVE_OPENED } from '../lib/web/save-opened';
import { authorWords, searchText } from '../lib/web/search';
import { splitYear } from '../lib/web/search-intent';
import {
  activeFilter,
  authorsOf,
  boxFromAddress,
  formatWebSearch,
  matchesFilters,
  parseWebSearch,
  searchAddress,
  sortOf,
  sourcesToAsk,
  SOURCE_OPTIONS,
  suggestFilterValues,
  TYPE_OPTIONS,
  withAuthor,
  withFilter,
  type FilterKey,
  type WebSearch,
} from '../lib/web/web-filters';
import { PLATFORM_LABELS, type WebItem, type WebPlatform } from '../lib/web/types';
import { canSort, searchOrder, SORT_OPTIONS, type SortChoice } from '../lib/web/web-sort';
import { contentLanguage } from '../lib/web/language';
import { burnedInSubtitles } from '../lib/web/subtitles';
import { isBarAudioPlatform, parseWebAudioSrc, playsInBar } from '../lib/web/web-audio';
import { loadWebItem } from '../lib/web/web-track-lookup';
import { useCatalogue } from '../lib/media/catalogue';
import { siteFileMatches } from '../lib/web/site-server';
import { useMusicPlayer } from './MusicPlayerProvider';
import AudioSubsFlags from './AudioSubsFlags';
import SpriteSlot from './SpriteSlot';
import WebMediaRow, { isKinoRow, isMediaRow, KinoRow } from './WebMediaRow';
import WebSiteFiles from './WebSiteFiles';
import { canWatch, WebDiscussKey, WebWatchKey, WebWatchPanel } from './WebBridgeKeys';

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
 * DEBASER.SITE (Luke, 2026-11-03, when WEB became ARCHIVE): a search also finds the site's own files, the old
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

const MISSING_THUMB_SRC = `/${artSlot('web-thumb-missing')?.path ?? 'assets/web/thumb-missing.png'}`;

/** The SOURCE, TYPE, `from:`, VIBE and SORT filters a list is shown under (web-filters.ts). */
type Filters = Pick<WebSearch, 'source' | 'type' | 'authors' | 'vibe' | 'sort'>;

/**
 * What the list shows: the stream (no words; filtered when filters are set), one search (the saved stream and
 * every live source the filters allow, together; its words may be none when it names a creator), or one pasted link.
 */
type Shown = { kind: 'stream'; filters: Filters } | { kind: 'search'; query: string; filters: Filters } | { kind: 'link'; link: string };

/** Who a search is still waiting on: the saved stream, or a live source. */
type Source = 'stream' | WebPlatform;

const LINK_WORDS: Record<LinkOutcome, string> = {
  found: 'FROM THE LINK',
  unknown: "THE ARCHIVE CAN'T PLAY LINKS FROM THERE.",
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

/** The sources a request asks: a link is one live answer; otherwise whatever the filters allow, in the order chosen. */
function sourcesFor(shown: Shown): Source[] {
  if (shown.kind === 'link') return ['youtube'];
  const plan = sourcesToAsk(shown.filters);
  const stream: Source[] = plan.stream ? ['stream'] : [];
  // Live sources need words to search for; with none, the list is the stream alone.
  if (shown.kind === 'stream') return stream;
  return [...stream, ...plan.live].filter((source) => canSort(source, sortOf(shown.filters)) || swapsOnly(source, shown));
}

/** The sources a search leaves out because they have no such order: one plain line each (SPEC-web-sort.md). */
function unsortedFor(shown: Shown): Source[] {
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
  const choice: SortChoice = shown.kind === 'search' ? sortOf(shown.filters) : { sort: 'date', dir: 'desc' };
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
      : repository.listItems({ cursor: after, limit: DEFAULT_PAGE_SIZE });
  }
  if (what.kind === 'link') return searchEverywhere(what.link, after);
  // A live source is asked about one creator at a time: the first.
  return searchEverywhere(what.kind === 'search' ? what.query : '', after, source, authorsOf(what.filters)[0] ?? null, what.filters.type, {
    vibe: what.filters.vibe === true,
    ...(keyword !== undefined ? { keyword } : {}),
    ...(order !== undefined ? { order } : {}),
  });
}

/** How many rows LOAD MORE adds by date before it stops asking (one page's worth). */
const MORE_ROWS = 20;
/** How many single-source pages one LOAD MORE may ask by date, so a source with nothing new cannot spin. */
const MAX_PULLS = 8;

/** The box with its words replaced (a DID YOU MEAN), every filter kept. */
function withWords(box: string, words: string): string {
  return formatWebSearch({ ...parseWebSearch(box), text: words });
}

export default function WebStream() {
  const params = useSearchParams();
  /** What is in the field (the one truth for the filters too), and what the list shows. */
  const [draft, setDraft] = useState(() => boxFromAddress(params));
  const [shown, setShown] = useState<Shown>(() => requestFor(boxFromAddress(params)));
  /** The rows, as they arrive from each source (live-merge.ts: once each, nothing moving under the reader). */
  const [list, setList] = useState<LiveList>(() => emptyLive(orderFor(requestFor(boxFromAddress(params)))));
  /** By date, LOAD MORE keeps asking the source holding rows back until this many rows show (null: not loading). */
  const [target, setTarget] = useState<number | null>(null);
  /** Pages asked by date for this search (`MAX_PULLS` per LOAD MORE); `null` once the first top-up is spent. */
  const [pulls, setPulls] = useState(0);
  const [toppedUp, setToppedUp] = useState(false);
  /** The sources a by-date top-up has just asked (the effect below sends the requests). */
  const [pulled, setPulled] = useState<{ sources: Source[] } | null>(null);
  /** The pages being asked for are the reader's own LOAD MORE (focus moves to the first new row), not a top-up. */
  const readerAsked = useRef(false);
  /** Results found live rather than read from the stream: opening one asks for it to be saved. */
  const [liveIds, setLiveIds] = useState<ReadonlySet<string>>(() => new Set());
  /** Bumped by every new search, so a slow answer to an old one is dropped rather than shown. */
  const generation = useRef(0);
  /** Each source's next page; a source with none has no more. */
  const [cursors, setCursors] = useState<Partial<Record<Source, string>>>({});
  /** The sources still being asked, in the order they were asked. */
  const [asking, setAsking] = useState<Source[]>(() => sourcesFor(requestFor(boxFromAddress(params))));
  /** One plain line per live source that failed ("OPENVERSE: NO ANSWER"); a pasted link's outcome. */
  const [problems, setProblems] = useState<ProviderLine[]>([]);
  const [linkOutcome, setLinkOutcome] = useState<LinkOutcome | null>(null);
  /** The stream itself could not be read; or the route's own refusal ("Too many searches..."). */
  const [failed, setFailed] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
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
  const [related, setRelated] = useState<Related | null>(null);
  /** Every source has answered the search's first page once: only then may a related section load. */
  const [firstRoundDone, setFirstRoundDone] = useState(false);
  /** The site's own files the search finds (DEBASER.SITE), from the catalogue the whole site shares. */
  const catalogue = useCatalogue();
  const siteFiles = useMemo(
    () => (shown.kind === 'search' ? siteFileMatches(catalogue.entries, { query: shown.query, filters: shown.filters }) : []),
    [catalogue.entries, shown],
  );

  /** Asks for the search's suggestion and related topics; a new search drops a late answer. */
  const askRelated = useCallback((asked: number, what: Shown) => {
    if (what.kind !== 'search' || what.query === '') return;
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
      const items = what.kind === 'link' ? page.items : page.items.filter((item) => matchesFilters(item, what.filters, source === 'stream'));
      if (source !== 'stream') setLiveIds((current) => new Set([...current, ...items.map((item) => item.id)]));
      setList((current) => {
        let next: LiveList;
        if (what.kind !== 'search') next = arrive(current, items, end);
        else {
          // The media servers' titles that come with the first live answer (wildcard-search.ts) are a source of their
          // own, with no more pages, so they never stand in for that platform's place by date.
          const own = items.filter((item) => source === 'stream' || item.platform === source);
          const servers = items.filter((item) => source !== 'stream' && item.platform !== source);
          const sent = page.items.filter((item) => source === 'stream' || item.platform === source);
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
    [],
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
  const restart = useCallback(
    (box: string) => {
      const next = requestFor(box);
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
      window.history.replaceState(window.history.state, '', next.kind === 'link' ? searchAddress({ text: next.link, source: 'all', type: 'all' }) : searchAddress(parseWebSearch(box)));
    },
    [ask, askRelated],
  );

  // The first answer: the address's search, or the stream. The state above already starts as "asking" them.
  useEffect(() => {
    for (const source of sourcesFor(shown)) ask(generation.current, source, shown, null, false);
    askRelated(generation.current, shown);
    // Once, for what the page opened with; later searches go through restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, askRelated]);

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

  const clear = () => {
    setDraft('');
    restart('');
    document.getElementById('web-search')?.focus();
  };

  /** A SOURCE or TYPE key: the filter is written into the box (so the two never disagree) and the search runs. */
  const pickFilter = (key: FilterKey, value: string) => {
    const next = withFilter(draft, key, value);
    setDraft(next);
    restart(next);
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
    pickFilter('sort', word);
  };

  const boxFilters = parseWebSearch(draft);
  const boxSort = sortOf(boxFilters);
  const filtered = shown.kind !== 'stream' || shown.filters.source !== 'all' || shown.filters.type !== 'all';
  const busy = asking.length > 0 || target !== null;
  const unsorted = unsortedFor(shown);
  const empty = list.shown.length === 0 && list.held.length === 0;
  // By date, only once the first top-up has been decided, so the related sections start below a settled list.
  if (!busy && !firstRoundDone && (!sortedByDate || toppedUp)) setFirstRoundDone(true);

  const emptyWords = (): string | null => {
    if (shown.kind === 'link') return busy ? 'READING THE LINK...' : LINK_WORDS[linkOutcome ?? 'no-answer'];
    if (busy) return shown.kind === 'stream' ? 'READING THE ARCHIVE...' : null;
    if (shown.kind === 'stream' && !sourcesToAsk(shown.filters).stream) return `TYPE WORDS TO SEARCH ${sourceLabel(shown.filters.source as WebPlatform)}.`;
    if (shown.kind === 'stream') return filtered ? 'NOTHING SAVED MATCHES.' : 'NOTHING YET.';
    return `NOTHING ${siteFiles.length > 0 ? 'ELSE ' : ''}MATCHES ${searchWordsShown(shown.query, shown.filters)}.`;
  };
  const emptyLine = empty && !failed ? emptyWords() : null;

  /** One row, drawn by the component for its kind: a media server's title, a KINO title, or anything else. */
  const renderRow = (item: WebStreamItem) =>
    isMediaRow(item) ? (
      // A title from a media server (SPEC-media-servers.md): its SERVER buttons, pickers and player.
      <WebMediaRow key={item.id} item={item} titleId={rowTitleId(item.id)} />
    ) : isKinoRow(item) ? (
      <KinoRow key={item.id} item={item} titleId={rowTitleId(item.id)} />
    ) : (
      <WebRow key={item.id} item={item} extraHosts={extraHosts} found={liveIds.has(item.id)} onCreator={searchCreator} />
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
    <section aria-label="Archive stream">
      <form role="search" aria-label="Search the archive" onSubmit={submit} className="mb-1 flex flex-wrap items-center gap-2">
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
        {filtered || draft.length > 0 ? (
          <button type="button" onClick={clear} aria-label="Clear the search" className={PLATE}>
            [ CLEAR ]
          </button>
        ) : null}
      </form>

      {/* The filters, as keys. Each writes its filter into the box above, which stays the one truth. */}
      <div className="mb-2 space-y-1">
        <div role="group" aria-label="Source" className="flex flex-wrap items-center gap-1">
          <span className="text-label font-bold text-ink-quiet">SOURCE:</span>
          {SOURCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => pickFilter('in', option.value)}
              aria-pressed={boxFilters.source === option.value}
              aria-label={`Source: ${option.label}`}
              className={boxFilters.source === option.value ? PLATE_PRESSED : PLATE}
            >
              {`[ ${option.label} ]`}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Type" className="flex flex-wrap items-center gap-1">
          <span className="text-label font-bold text-ink-quiet">TYPE:</span>
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => pickFilter('type', option.value)}
              aria-pressed={boxFilters.type === option.value}
              aria-label={`Type: ${option.label}`}
              className={boxFilters.type === option.value ? PLATE_PRESSED : PLATE}
            >
              {`[ ${option.label} ]`}
            </button>
          ))}
        </div>
        {/* VIBE: mood and tag words ("cosy", "80s horror") instead of exact words (search-intent.ts). */}
        <div role="group" aria-label="Vibe" className="flex flex-wrap items-center gap-1">
          <span className="text-label font-bold text-ink-quiet">VIBE:</span>
          <button
            type="button"
            onClick={() => pickFilter('vibe', boxFilters.vibe ? 'off' : 'on')}
            aria-pressed={boxFilters.vibe === true}
            aria-label="Vibe search: mood and tag words"
            className={boxFilters.vibe ? PLATE_PRESSED : PLATE}
          >
            {boxFilters.vibe ? '[ ON ]' : '[ OFF ]'}
          </button>
          <span className="text-label text-ink-quiet">MOODS, TAGS, GENRES, DECADES</span>
        </div>
        {/* SORT (SPEC-web-sort.md): the order a search is shown in, and the flip key, which only DATE uses. */}
        <div role="group" aria-label="Sort" className="flex flex-wrap items-center gap-1">
          <span className="text-label font-bold text-ink-quiet">SORT:</span>
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => pickSort({ sort: option.value, dir: option.value === 'date' ? boxSort.dir : 'desc' })}
              aria-pressed={boxSort.sort === option.value}
              aria-label={`Sort: ${option.label}`}
              className={boxSort.sort === option.value ? PLATE_PRESSED : PLATE}
            >
              {`[ ${option.label} ]`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => pickSort({ sort: 'date', dir: boxSort.dir === 'asc' ? 'desc' : 'asc' })}
            disabled={boxSort.sort !== 'date'}
            aria-label={
              boxSort.sort !== 'date'
                ? `Flip the order: only for DATE (${boxSort.sort === 'popular' ? 'no site gives a least popular order' : 'a best match backwards is no use'})`
                : boxSort.dir === 'asc'
                  ? 'Oldest first: flip to newest first'
                  : 'Newest first: flip to oldest first'
            }
            className={PLATE}
          >
            {boxSort.dir === 'asc' && boxSort.sort === 'date' ? '[ ↑ ]' : '[ ↓ ]'}
          </button>
          <span className="text-label text-ink-quiet">
            {boxSort.sort === 'date' ? (boxSort.dir === 'asc' ? 'OLDEST FIRST' : 'NEWEST FIRST') : boxSort.sort === 'popular' ? 'EACH SITE TAKES TURNS' : 'EACH SITE TAKES TURNS'}
          </span>
        </div>
      </div>

      {/* DEBASER.SITE first: the site's own files the search finds. Keyed by the search, so ALL n FILES starts shut. */}
      {shown.kind === 'search' ? <WebSiteFiles key={searchAddress({ ...shown.filters, text: shown.query })} matches={siteFiles} /> : null}

      {emptyLine !== null ? (
        <p role="status" className="text-label font-bold text-ink wrap-anywhere">
          {emptyLine}
        </p>
      ) : null}
      {!empty && shown.kind !== 'stream' ? (
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
      {/* Its own fixed line, so a source finishing never moves the rows below it. */}
      {searching ? (
        <p role="status" className="text-label text-ink-quiet wrap-anywhere">
          {busy ? `ASKING: ${asking.map(sourceLabel).join(', ')}...` : 'EVERY SOURCE HAS ANSWERED.'}
        </p>
      ) : null}
      {shown.kind === 'stream' && boxFilters.sort !== undefined && boxFilters.text === '' ? (
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

      {list.shown.length === 0 ? null : (
        <ul aria-label={shown.kind === 'stream' ? 'Items, newest first' : `Results, ${list.order.kind === 'turns' ? 'each site in turn' : list.order.dir === 'asc' ? 'oldest first' : 'newest first'}`}>
          {list.shown.map(renderRow)}
        </ul>
      )}

      {failed ? (
        <p role="alert" className="mt-2 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">
          {refusal ?? (shown.kind === 'stream' ? 'COULD NOT READ THE STREAM. TRY AGAIN.' : 'COULD NOT SEARCH. TRY AGAIN.')}
        </p>
      ) : null}

      {(Object.keys(cursors).length > 0 && !empty) || (failed && empty) ? (
        <div className="mt-3">
          <button type="button" onClick={failed && empty ? () => restart(draft) : loadMore} disabled={busy} className={PLATE_MAIN}>
            {busy ? '[ LOADING... ]' : failed && empty ? '[ TRY AGAIN ]' : shown.kind === 'search' && shown.query !== '' ? `[ MORE FOR "${shown.query.toUpperCase()}" ]` : '[ LOAD MORE ]'}
          </button>
        </div>
      ) : null}

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
            const items = page.items.filter((item) => !exclude.has(item.id) && matchesFilters(item, filters, source === 'stream'));
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
      {list.shown.length > 0 ? <ul aria-label={`Related to ${topic.label}`}>{list.shown.map(renderRow)}</ul> : null}
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

/** The id of a row's title, which takes focus after LOAD MORE. Item ids are `platform:identifier`. */
function rowTitleId(itemId: string): string {
  return `web-row-${itemId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/**
 * `found`: a result of a search everywhere or a pasted link, not (yet) in the stream. Opening one (PLAY,
 * DISCUSS, WATCH) asks for it to be saved into the stream (save-opened.ts); DISCUSS is offered only while that
 * saving is on, so a thread is never filed under an item that will not arrive.
 */
function WebRow({
  item,
  extraHosts,
  found,
  onCreator,
}: {
  item: WebStreamItem;
  extraHosts: ExtraHosts;
  found: boolean;
  /** The creator's name is a key: everything from them (`from:`), like a name on the forum. */
  onCreator: (name: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const opened = () => {
    if (found) void recordOpened(item);
  };

  const source = PLATFORM_LABELS[item.platform];
  const addresses = rowAddresses(item, extraHosts);
  const { link, embed, licence } = addresses;
  const thumb = thumbFailed ? null : addresses.thumb;
  const inBar = playsInBar(item);
  const date = item.publishedAt.slice(0, 10);
  // An Archive item with two or more videos is a series (SPEC-stream-series.md): marked here, ticked in a room's queue.
  const seriesCount = useSeriesCount(item);
  const archiveSubtitles = useArchiveRowSubtitles(item);

  return (
    <li className="rule-pixel py-2">
      <div className="flex items-start gap-2">
        {/* A fixed box, so a slow or missing picture never moves the row. */}
        <span className="block h-18 w-24 shrink-0 overflow-hidden border border-ink-plate bg-paper">
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
        </span>

        <div className="min-w-0 flex-1">
          <p id={rowTitleId(item.id)} tabIndex={-1} className="text-sm font-bold text-ink wrap-anywhere">
            {item.title}
            <AudioSubsFlags audio={contentLanguage(item)} subs={archiveSubtitles} burnedIn={burnedInSubtitles(item.description ? `${item.title}
${item.description}` : item.title)} className="ml-1.5" />
          </p>
          {item.creator && authorWords(item.creator) !== null ? (
            <p>
              <button
                type="button"
                onClick={() => onCreator(item.creator ?? '')}
                aria-label={`Search for more from ${item.creator}`}
                title="More from this creator"
                className="cursor-pointer text-left text-label text-ink wrap-anywhere hover:underline max-sm:min-h-tap"
              >
                {item.creator}
              </button>
            </p>
          ) : item.creator ? (
            <p className="text-label text-ink wrap-anywhere">{item.creator}</p>
          ) : null}
          {item.description ? <p className="mt-0.5 line-clamp-2 text-label text-ink wrap-anywhere">{item.description}</p> : null}

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label">
            <span className="font-bold text-ink-quiet">{KIND_LABELS[item.kind]}</span>
            {seriesCount === null ? null : (
              <span className="bg-acid px-1 font-bold text-ink-plate" data-series-mark>
                {seriesMark(seriesCount)}
              </span>
            )}
            <time dateTime={item.publishedAt} className="text-ink">
              {date}
            </time>
            {licence ? (
              <a
                href={licence}
                target="_blank"
                rel="noopener noreferrer nofollow"
                aria-label={`Licence for "${item.title}" (new tab)`}
                className="inline-flex items-center text-ink hover:underline max-sm:min-h-tap"
              >
                LICENCE
              </a>
            ) : null}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="bg-ice-pale px-1 text-label font-bold text-ink">{source}</span>
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                aria-label={`Open "${item.title}" on ${source} (new tab)`}
                className={PLATE}
              >
                [ OPEN ↗ ]
              </a>
            ) : null}
            {/* Audio the bar can play goes there (web-audio.ts); the platform's player is the fallback. */}
            {inBar && !playing ? (
              <WebBarPlayKey item={item} onOpen={opened} onFallback={embed ? () => setPlaying(true) : null} />
            ) : embed ? (
              <button
                type="button"
                onClick={() => {
                  if (!playing) opened();
                  setPlaying((current) => !current);
                }}
                aria-expanded={playing}
                // The visible word leads the name (PLAY / CLOSE), so a voice command for what is on screen works.
                aria-label={playing ? `Close the ${source} player for "${item.title}"` : `Play "${item.title}" (loads the ${source} player)`}
                className={playing ? PLATE_PRESSED : PLATE}
              >
                {playing ? '[ ■ CLOSE ]' : '[ ▶ PLAY ]'}
              </button>
            ) : null}
            {/* The bridges (Phase 5): the item's forum thread, and the stream room the reader hosts. */}
            {!found || SAVE_OPENED ? <WebDiscussKey item={item} onOpen={opened} /> : null}
            {canWatch(item) ? (
              <WebWatchKey
                item={item}
                open={watchOpen}
                onToggle={() => {
                  if (!watchOpen) opened();
                  setWatchOpen((current) => !current);
                }}
              />
            ) : null}
          </div>

          {item.alsoOn.length > 0 ? <AlsoOn item={item} /> : null}
          {watchOpen && canWatch(item) ? <WebWatchPanel item={item} /> : null}
        </div>
      </div>

      {/* Nothing from the platform loads until the reader asks: the iframe exists only while open. */}
      {playing && embed ? (
        <iframe
          src={startingEmbed(embed, item.platform, contentLanguage(item))}
          title={`${source} player: ${item.title}`}
          loading="lazy"
          // YouTube's player refuses to start without knowing which site embeds it ("Error 153: video player
          // configuration error", live-checked 2026-10-31 with no-referrer), so it alone is told our origin -
          // strict-origin: the site's address only, never the page path, and nothing over plain http.
          referrerPolicy={item.platform === 'youtube' ? 'strict-origin' : 'no-referrer'}
          // Live-checked 2026-10-31: the Archive's player needs its scripts, and its own origin to fetch the
          // files it plays; it drew and played with exactly these two. allow-same-origin keeps it on
          // archive.org's origin, never ours (it is cross-origin). No popups, forms or top navigation.
          sandbox="allow-scripts allow-same-origin"
          // autoplay: the player starts on the reader's own press of PLAY (`startingEmbed`).
          allow={item.kind === 'video' ? 'autoplay; fullscreen' : 'autoplay'}
          className={`mt-2 block w-full border border-ink-plate bg-paper ${
            item.kind === 'video' ? 'aspect-video' : item.kind === 'text' ? 'h-[360px]' : 'h-[44px]'
          }`}
        />
      ) : null}
    </li>
  );
}

/**
 * The other copies of this work (dedupe.ts): each one's own source name and its own link, so every
 * source a row stands for is still one press away. A copy whose address fails its checks shows its name only.
 */
function AlsoOn({ item }: { item: WebStreamItem }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-label font-bold text-ink-quiet">ALSO ON</span>
      <ul aria-label={`Other copies of "${item.title}"`} className="contents">
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
/** Where the bar's globe sends a listener back to, for a track started here: the archive (WEB until 2026-11-03). */
const WEB_ORIGIN = { origin: 'shelf', href: '/archive', where: 'ARCHIVE' } as const;

/**
 * PLAY for audio the site's music bar can play (web-audio.ts): asks our route for the item's files, then
 * hands them to the bar - one file, or a book's chapters in order - where every feature of the bar applies.
 * While this item is the one on the bar the key pauses and resumes it. When no file can be found, the
 * platform's own player opens instead (`onFallback`), or the row says so when there is none.
 */
function WebBarPlayKey({ item, onOpen, onFallback }: { item: WebStreamItem; onOpen: () => void; onFallback: (() => void) | null }) {
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
    if (onFallback) {
      setState('idle');
      onFallback();
    } else {
      setState('none');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void press()}
        aria-pressed={sounding}
        aria-busy={state === 'finding'}
        // The visible word leads the name, so a voice command for what is on screen works.
        aria-label={sounding ? `Pause "${item.title}" in the music player` : `Play "${item.title}" in the music player`}
        className={sounding ? PLATE_PRESSED : PLATE}
      >
        {state === 'finding' ? '[ … FINDING ]' : sounding ? '[ ❚❚ PAUSE ]' : '[ ▶ PLAY ]'}
      </button>
      {state === 'none' ? (
        <span role="status" className="text-label font-bold text-ink">
          NO PLAYABLE FILE
        </span>
      ) : null}
    </>
  );
}

