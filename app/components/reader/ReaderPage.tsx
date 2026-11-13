'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  bookmarkLabel,
  markTint,
  markToken,
  pageLayout,
  percentOf,
  quoteOf,
  readerCss,
  readerSettingsFrom,
  spotFromSearch,
  DEFAULT_SETTINGS,
  type ReaderSettings,
} from '../../lib/books/reader-look';
import { bookKind, loadEngine, metadataText, openBook, remotePdf, type EngineBook, type EngineView, type HighlightDraw, type TocItem } from '../../lib/books/reader-engine';
import { getBooksRepository } from '../../lib/books/repository';
import { fetchPages, pictureBook } from '../../lib/books/page-pictures';
import {
  archiveWork,
  backLinkOf,
  cleanWork,
  findWorks,
  ipfsWork,
  matchLine,
  offsetIn,
  pageCfi,
  pageOfCfi,
  quoteProbe,
  rangeIn,
  threadKeyOf,
  workKey,
  workOf,
  NOT_LISTED,
  type WorkMatch,
} from '../../lib/books/copies';
import {
  bookOf,
  browserPlaces,
  chapterLeftText,
  fingerprint,
  finishedAfter,
  finishedWhen,
  pageText,
  paceAfter,
  paceFrom,
  paceKey,
  placeFromStored,
  placeKey,
  progressText,
  storedPlace,
  storyEndOf,
  storyFraction,
  whenText,
  LICENCE_LABEL,
  NO_PACE,
  type Pace,
} from '../../lib/books/reading-places';
import { fetchFromGateways, ipfsCid, IpfsFetchError, IPFS_MAX_BYTES, type IpfsProblem, type IpfsProgress } from '../../lib/books/ipfs';
import {
  bookThreadAnchor,
  bookThreadTitle,
  highlightPost,
  archiveBookId,
  archiveViewerUrl,
  isCfi,
  ownHash,
  ownRef,
  HIGHLIGHT_COLOURS,
  QUOTE_MAX,
  type BookBookmark,
  type BookHighlight,
  type BookPlace,
  type HighlightColour,
  type PlaceSave,
} from '../../lib/books/types';
import { PLATE, PLATE_MAIN, PLATE_PRESSED } from '../../lib/ui/controls';
import { asFile, keptFileOf, rematchKept } from '../../lib/books/own-library';
import { useAuth } from '../AuthProvider';
import { useForum } from '../ForumProvider';
import HighlightBar, { type BarSpot } from './HighlightBar';
import { BookmarkList, ContentsList, HighlightList, LookSettings, Panel, SearchBox, type PanelName, type SearchGroup } from './ReaderPanels';
import ReadingShelf from './ReadingShelf';
import { MatchSearch, OWN_ACCEPT } from './OwnFileDrop';

const LOOK_KEY = 'debaser-reader-look';
/** How long a click on the page's edge waits before turning it: long enough for a double-click to choose a word. */
const TURN_WAIT_MS = 250;
const NONE_HIGHLIGHTED: BookHighlight[] = [];
const NONE_BOOKMARKED: BookBookmark[] = [];

/** What the reader says when no IPFS gateway gave the book (`ipfs.ts`). */
const IPFS_LINES: Record<IpfsProblem, string> = {
  'NOT A BOOK ADDRESS': "THIS BOOK CAN'T BE READ HERE.",
  'NO COPY FOUND': 'NO COPY FOUND ON IPFS.',
  'SOURCE NOT ANSWERING': 'SOURCE NOT ANSWERING. TRY AGAIN.',
  'BLOCKED BY THE SOURCE': 'BLOCKED BY THE SOURCE. TRY AGAIN LATER.',
  'TOO BIG TO READ HERE': `TOO BIG TO READ HERE. THE LIMIT IS ${IPFS_MAX_BYTES / (1024 * 1024)} MB.`,
};

/** How much of an IPFS book has come: a percentage when the gateway said its size, else megabytes. */
function arrivedText(progress: IpfsProgress): string {
  if (progress.total) return `${Math.min(100, Math.floor((progress.loaded / progress.total) * 100))}%`;
  return `${(progress.loaded / (1024 * 1024)).toFixed(1)} MB`;
}

/** Every place this browser kept, or none where storage is blocked. */
function placesHere(): BookPlace[] {
  try {
    return browserPlaces(window.localStorage);
  } catch {
    return [];
  }
}

/** Per-browser memory (a visitor's look and place): never trusted, never required. */
function remembered(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A private window or blocked storage: the reader works without it.
  }
}

const PAPER_CLASS: Record<ReaderSettings['paper'], string> = {
  light: 'bg-reader-light-paper text-reader-light-ink',
  dark: 'bg-reader-dark-paper text-reader-dark-ink',
  sepia: 'bg-reader-sepia-paper text-reader-sepia-ink',
};

/** A value from the page's stylesheet (the theme writes every colour token onto `<html>`). */
function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The site face's @font-face rules (next/font's own files on this site), so a chapter can wear the site's face too. */
function siteFontFaces(): string {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSFontFaceRule && /url\(["']?\/_next\/static\/media\/[A-Za-z0-9._-]+\.woff2["']?\)/.test(rule.cssText) && !/[<\\]/.test(rule.cssText)) {
        rules.push(rule.cssText.replace(/url\(["']?(\/_next\/[^"')]+)["']?\)/g, (_, path: string) => `url("${window.location.origin}${path}")`));
      }
    }
  }
  return rules.join('\n');
}

/** Where the book itself ends: the start of the contents item that is Project Gutenberg's licence, as the engine counts. */
function bookEnd(view: EngineView, toc: readonly TocItem[]): number {
  const flat = (items: readonly TocItem[]): TocItem[] => items.flatMap((item) => [item, ...flat(item.subitems ?? [])]);
  const licence = flat(toc).find((item) => LICENCE_LABEL.test(item.label ?? '') && item.href);
  if (!licence?.href) return 1;
  try {
    const resolved = (view as unknown as { resolveNavigation: (target: string) => { index?: number } | undefined }).resolveNavigation(licence.href);
    const start = typeof resolved?.index === 'number' ? view.getSectionFractions()[resolved.index] : undefined;
    return storyEndOf([{ label: licence.label ?? '', start: typeof start === 'number' ? start : null }]);
  } catch {
    return 1;
  }
}

type Location = { fraction: number; chapter: string; chapterHref: string | null; timeLeft: string; cfi: string | null; page: number };
type Relocated = {
  fraction?: number;
  tocItem?: { label?: string; href?: string };
  time?: { section?: number; total?: number };
  section?: { current?: number; total?: number };
  cfi?: string;
};
/** Words chosen to highlight: an EPUB's CFI, or a PDF page's short address and the characters within its words. */
type Picked = { cfi: string; quote: string; spot: BarSpot; startAt?: number; endAt?: number };
/** The question before a started book: its place, and whether that place was in another copy of the same book. */
type Asked = BookPlace & { other?: boolean };
type PdfWindow = Window & { Highlight?: new (...ranges: Range[]) => unknown; CSS: { highlights?: Map<string, unknown> } };
type Shown = { highlight: BookHighlight; spot: BarSpot };

/**
 * The DEBASER reader (SPEC-reader.md, Luke 2026-11-11): a Project Gutenberg book's EPUB, pictures included, passed through
 * /api/web/book/epub and never kept, laid out by foliate-js (`app/lib/books/reader-engine.ts`): two pages side by side on a
 * wide screen, one on a phone; turned with the arrow keys, a swipe, or a tap on the page's outer thirds. Around it: the
 * contents, search in the book, bookmarks, highlights (five colours, a comment, the lock, a post in your "[NAME] READING
 * [BOOK]" thread), the LOOK settings, a progress bar to drag, and focus mode, which hides everything but the book.
 *
 * Since Luke's asks of 2026-11-11 it also reads an Internet Archive book: its own EPUB, else its PDF a slice at a time (fixed
 * pages: no highlights there, the engine can't draw them on a PDF), else the Archive's own viewer. And a reader's own PDF or
 * EPUB (`bookRef` null, at /read): opened in this browser from their device, never sent anywhere. Since
 * SPEC-reading-places.md (2026-11-13) it is known by a fingerprint of its bytes (`own:<SHA-256>`), so its place, the title
 * written inside it and how far you are save like any book's; the bytes themselves still go nowhere.
 * Keeping your place (the same spec): a started book asks CONTINUE FROM 42% or START OVER before its page; the foot shows how
 * far you are, PAGE 12 OF 300 on fixed pages and minutes left in the chapter at your own pace; the last page marks it
 * FINISHED. A scanned Archive book with no EPUB or PDF shows its page pictures here, straight from archive.org.
 * And a book on IPFS (`ipfs:<CID>`, Luke 2026-11-11): fetched by this browser from a public gateway (`lib/books/ipfs.ts`),
 * with how much has come shown as it arrives, a line and TRY AGAIN when no gateway gives it, and its title from the book.
 */
export default function ReaderPage({ bookRef: askedRef }: { bookRef: string | null }) {
  const own = askedRef === null;
  const bookRef = askedRef ?? '';
  const router = useRouter();
  const search = useSearchParams();
  const { user, status } = useAuth();
  const me = user !== null && status === 'signed-in' ? user : null;
  const forum = useForum();

  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EngineView | null>(null);
  const drawRef = useRef<HighlightDraw | null>(null);
  const indexOf = useRef(new WeakMap<Document, number>());
  const highlightsRef = useRef<BookHighlight[]>([]);
  const settingsRef = useRef<ReaderSettings>(DEFAULT_SETTINGS);
  const annotationHit = useRef(false);
  const barsOpenRef = useRef(false);
  const turnTimer = useRef<number | null>(null);
  const placeTimer = useRef<number | null>(null);
  const meRef = useRef(me);
  // Keeping your place (SPEC-reading-places.md): the ref places are saved under (the book's, or `own:<fingerprint>` for your
  // own file), what was saved when it opened, your pace in it, the title to save, and whether the reader has moved yet (the
  // page it opens at isn't saved: only where you go from there).
  const placeRefOf = useRef<string | null>(own ? null : bookRef);
  const heldPlace = useRef<BookPlace | null>(null);
  const pace = useRef<Pace>(NO_PACE);
  // Where the book itself ends in the engine's fraction: before a Gutenberg book's licence, else 1 (reading-places.ts).
  const storyEnd = useRef(1);
  const lastTurn = useRef<{ at: number; left: number } | null>(null);
  const savedTitle = useRef('');
  const opened = useRef(false);
  const answerAsk = useRef<((choice: 'continue' | 'over') => void) | null>(null);
  const [ask, setAsk] = useState<Asked | null>(null);
  // Every copy of a book counts as that book (Luke, 2026-11-13; lib/books/copies.ts): this copy's ref (your own file's once
  // its fingerprint is known), the Open Library work it is a copy of, and for your own file the match and its words.
  const [copyRef, setCopyRef] = useState<string | null>(own ? null : bookRef);
  const [work, setWork] = useState<string | null>(null);
  const workNow = useRef<string | null>(null);
  const [ownMeta, setOwnMeta] = useState<{ title: string; author: string } | null>(null);
  const [match, setMatch] = useState<WorkMatch | 'none' | 'unfound' | null>(null);
  const [choosing, setChoosing] = useState(false);
  // A scanned book's page pictures: fixed pages with no words to highlight.
  const [pictures, setPictures] = useState(false);
  // Highlights made in another copy, found by their words in this one: highlight id -> where (a CFI here).
  const [found, setFound] = useState<Record<string, string>>({});
  // A PDF's pages on screen, and each one's highlights as ranges (for a click on one).
  const pdfDocs = useRef(new Map<number, Document>());
  const pdfHits = useRef(new WeakMap<Document, { highlight: BookHighlight; range: Range }[]>());

  const [phase, setPhase] = useState<'choose' | 'reading-file' | 'opening' | 'ask' | 'ready' | 'viewer' | 'no-free-copy' | { fault: string }>(own ? 'choose' : 'reading-file');
  // A work with no free copy anywhere (Luke, 2026-11-13): shown inside the reader with a link to Open Library, and, when
  // a lending-library Archive scan exists, a [ BORROW ON ARCHIVE ↗ ] key beside it.
  const [noFreeCopyUrl, setNoFreeCopyUrl] = useState<string | null>(null);
  const [borrowOnArchive, setBorrowOnArchive] = useState<string | null>(null);
  // What the engine opened (an EPUB reflows and takes highlights; a PDF has fixed pages), a reader's own file, and a count
  // that opens the book again where it was (a PDF's ONE PAGE / TWO PAGES is decided when it opens).
  const [kind, setKind] = useState<'epub' | 'pdf' | null>(null);
  const [ownFile, setOwnFile] = useState<File | null>(null);
  // The READ module (2026-11-13): a file dropped or chosen goes to the drop box's card first, which finds its book.
  const [incoming, setIncoming] = useState<File | null>(null);
  // `/read?file=<fingerprint>`: whether this browser keeps that file (null while asking).
  const [keptMissing, setKeptMissing] = useState<boolean | null>(null);
  // `/read?for=<work>`: a book page's READ YOUR OWN COPY.
  // Its title and author, once the site's book info answers; the work itself is known from the address at once.
  const [forInfo, setForInfo] = useState<{ work: string; title: string; author: string } | null>(null);
  // It applies to the first file opened from that address only: a later one is matched as any file is.
  const [forDoneFor, setForDoneFor] = useState<string | null>(null);
  const [openCount, setOpenCount] = useState(0);
  // An IPFS book (`ipfs:<CID>`): fetched by this browser from a gateway, and how much of it has come.
  const ipfs = own ? null : ipfsCid(bookRef);
  const [arriving, setArriving] = useState<IpfsProgress | null>(null);
  // Every gateway refused this browser, so the book is coming through the site's own route (step 3).
  const [through, setThrough] = useState(false);
  // The page turn being drawn (globals.css, "The reader's page turn"): which way, and over half the stage (a two-page
  // spread, turning about the spine) or all of it (one page). A new turn replaces one still swinging.
  const [flip, setFlip] = useState<{ id: number; side: 'left' | 'right'; spread: boolean } | null>(null);
  const flipCount = useRef(0);
  const resumeRef = useRef<string | null>(null);
  const kindRef = useRef<'epub' | 'pdf' | null>(null);
  const [title, setTitle] = useState('');
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [location, setLocation] = useState<Location>({ fraction: 0, chapter: '', chapterHref: null, timeLeft: '', cfi: null, page: 0 });
  const [dragging, setDragging] = useState<number | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [panel, setPanel] = useState<PanelName | null>(null);
  const [focus, setFocus] = useState(false);
  const [ownHighlights, setHighlights] = useState<BookHighlight[]>([]);
  const [ownBookmarks, setBookmarks] = useState<BookBookmark[]>([]);
  // Signed out, there are none to show (what was read for an account stays with it). Signed in: yours in every copy of the
  // book, and other readers' public ones. Drawn here: this copy's own, and those from another copy whose words were found.
  const highlights = me ? ownHighlights : NONE_HIGHLIGHTED;
  const mine = useMemo(
    () => highlights.flatMap((highlight) => (highlight.bookRef === copyRef ? [highlight] : found[highlight.id] ? [{ ...highlight, cfi: found[highlight.id] }] : [])),
    [highlights, copyRef, found],
  );
  const findable = useMemo(() => new Set(mine.filter((highlight) => highlight.cfi).map((highlight) => highlight.id)), [mine]);
  const bookmarks = me ? ownBookmarks : NONE_BOOKMARKED;
  const [picked, setPicked] = useState<Picked | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [searching, setSearching] = useState<number | null>(null);
  const [searched, setSearched] = useState('');

  // The latest values, for the engine's own listeners (set after each render, never during one).
  useEffect(() => {
    meRef.current = me;
    highlightsRef.current = mine;
    barsOpenRef.current = picked !== null || shown !== null;
    // Your own file's saved title is the one written inside it (set as it opens), never its file name.
    if (!own) savedTitle.current = title;
    workNow.current = work;
  });

  // ---------- the look: read once (the account's, else this browser's), applied to the engine on every change ----------

  useEffect(() => {
    let live = true;
    // This browser's look first, then the account's when it answers (it wins: it follows the person between machines).
    void Promise.resolve()
      .then(() => {
        const local = remembered(LOOK_KEY);
        if (live && local) setSettings(readerSettingsFrom(JSON.parse(local)));
      })
      .catch(() => undefined)
      .then(() => (me ? getBooksRepository().readerSettings(me.id) : null))
      .then((saved) => live && saved && setSettings(readerSettingsFrom(saved)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [me]);

  const applyLook = useCallback((look: ReaderSettings) => {
    const view = viewRef.current;
    if (!view?.renderer) return;
    const layout = pageLayout(look);
    view.renderer.setAttribute('flow', 'paginated');
    view.renderer.setAttribute('gap', layout.gap);
    view.renderer.setAttribute('max-inline-size', layout.maxInlineSize);
    view.renderer.setAttribute('max-column-count', String(layout.columns));
    view.renderer.setAttribute('margin', look.layout === 'comic' ? '0px' : '24px');
    // A PDF's pages: each as large as fits (COMIC and STANDARD), or as wide as the reading area (VERSE: a script's lines).
    view.renderer.setAttribute('zoom', look.layout === 'verse' ? 'fit-width' : 'fit-page');
    const colours = { paper: tokenValue(`--color-reader-${look.paper}-paper`), ink: tokenValue(`--color-reader-${look.paper}-ink`) };
    const body = getComputedStyle(document.body);
    const faces = { site: body.fontFamily, typewriter: tokenValue('--font-emote') || body.fontFamily };
    view.renderer.setStyles?.(`${look.font === 'site' ? siteFontFaces() : ''}\n${readerCss(look, colours, faces)}`);
    const tint = markTint(look.paper);
    view.style.setProperty('--overlayer-highlight-opacity', String(tint.opacity));
    view.style.setProperty('--overlayer-highlight-blend-mode', tint.blend);
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    applyLook(settings);
  }, [settings, applyLook]);

  const changeLook = (next: ReaderSettings) => {
    // A PDF's spread is set as it opens: ONE PAGE / TWO PAGES opens it again, at the same page.
    if (kind === 'pdf' && next.pages !== settings.pages) {
      resumeRef.current = location.cfi;
      setOpenCount((count) => count + 1);
    }
    setSettings(next);
    remember(LOOK_KEY, JSON.stringify(next));
    if (me) void getBooksRepository().saveReaderSettings(me.id, next).catch(() => undefined);
  };

  // ---------- the book's title, from its catalogue (the thread's name uses it) ----------

  useEffect(() => {
    // An IPFS book has no catalogue: its title comes from the book itself once it opens.
    if (own || ipfsCid(bookRef)) return;
    let live = true;
    fetch(`/api/web/book/info?ref=${encodeURIComponent(bookRef)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { item?: { title?: string } } | null) => live && body?.item?.title && setTitle(body.item.title))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bookRef, own]);

  useEffect(() => {
    if (title) document.title = `${title.toUpperCase()} - DEBASER.SITE`;
  }, [title]);

  // ---------- this reader's highlights and bookmarks ----------

  // ---------- which book this copy is (copies.ts) ----------

  useEffect(() => {
    if (!copyRef) return;
    let live = true;
    (async () => {
      const cid = ipfsCid(copyRef);
      let found = workOf(copyRef) ?? (cid ? ipfsWork(cid) : null) ?? (archiveBookId(copyRef) ? await archiveWork(copyRef) : null);
      if (ownHash(copyRef)) {
        // Your own file: the match saved to the account (so another device finds it), else this browser's, else a guess from
        // the title and author written inside the file, saved at once (THIS IS: ... with [ CHANGE ] and [ NOT LISTED ]).
        const person = meRef.current;
        // A failed read isn't "no match": then only this browser's is used, and no guess is saved over the account's.
        let unread = false;
        const onAccount = person
          ? await getBooksRepository()
              .place(person.id, copyRef)
              .catch(() => {
                unread = true;
                return null;
              })
          : null;
        const saved = onAccount?.workRef ?? remembered(workKey(copyRef));
        const savedWork = cleanWork(saved);
        if (saved === NOT_LISTED) {
          if (live) setMatch('none');
        } else if (savedWork) {
          found = savedWork;
          // The book as this browser kept it with the file (YOUR FILES), else the catalogue's (which may not answer).
          const keptMatch = (await keptFileOf(copyRef))?.match;
          if (keptMatch?.work === savedWork) {
            if (live) setMatch(keptMatch);
          } else {
            const info = await fetch(`/api/web/book/info?ref=${encodeURIComponent(savedWork)}`).then((response) => (response.ok ? response.json() : null)).catch(() => null);
            const item = (info as { item?: { title?: string; creator?: string } } | null)?.item;
            if (live) setMatch({ work: savedWork, title: item?.title ?? 'THE MATCHED BOOK', author: item?.creator ?? '', cover: null });
          }
        } else if (ownMeta?.title && !unread) {
          const guess = (await findWorks(ownMeta.title, ownMeta.author))[0];
          if (guess) {
            found = guess.work;
            remember(workKey(copyRef), guess.work);
            if (person) await getBooksRepository().setWork(person.id, copyRef, guess.work).catch(() => undefined);
            if (live) setMatch(guess);
          } else if (live) setMatch('unfound');
        } else if (live) setMatch('unfound');
      }
      if (live) setWork(found);
    })();
    return () => {
      live = false;
    };
  }, [copyRef, ownMeta]);

  /** [ CHANGE ]: this file is that book (or [ NOT LISTED ]), on the account and in this browser. */
  const chooseMatch = async (chosen: WorkMatch | 'none') => {
    if (!copyRef) return;
    const value = chosen === 'none' ? NOT_LISTED : chosen.work;
    remember(workKey(copyRef), value);
    if (me) await getBooksRepository().setWork(me.id, copyRef, value).catch(() => setFault('THE MATCH COULD NOT BE SAVED.'));
    await rematchKept(copyRef, chosen === 'none' ? null : chosen);
    setMatch(chosen);
    setWork(chosen === 'none' ? null : chosen.work);
    setChoosing(false);
  };

  // ---------- this reader's highlights and bookmarks ----------

  useEffect(() => {
    if (!me || !copyRef) return;
    let live = true;
    void getBooksRepository()
      .acrossCopies(me.id, copyRef, work)
      .then((got) => live && setHighlights(got))
      .catch(() => undefined);
    if (!own) {
      void getBooksRepository()
        .bookmarks(me.id, copyRef)
        .then((got) => live && setBookmarks(got))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [me, copyRef, work, own]);

  /**
   * A PDF page's highlights, painted over its words with the browser's own highlight layer (CSS Custom Highlights: the
   * engine's drawing layer is an EPUB's only). Each is the page's words from its start to its end character.
   */
  const paintPdf = useCallback((doc: Document, index: number) => {
    const win = doc.defaultView as PdfWindow | null;
    const layer = doc.querySelector('.textLayer');
    if (!win || !layer || !win.Highlight || !win.CSS.highlights) return;
    let style = doc.getElementById('debaser-marks');
    if (!style) {
      style = doc.createElement('style');
      style.id = 'debaser-marks';
      (doc.head ?? doc.documentElement).append(style);
    }
    // The page's words are an invisible layer over its picture: multiplied onto it, a highlight tints the page and its
    // printed words still show through.
    style.textContent = [
      '.textLayer { mix-blend-mode: multiply; }',
      ...HIGHLIGHT_COLOURS.map((colour) => `::highlight(debaser-${colour}) { background-color: ${tokenValue(markToken(colour))}; }`),
    ].join('\n');
    const hits: { highlight: BookHighlight; range: Range }[] = [];
    const byColour = new Map<string, Range[]>();
    for (const highlight of highlightsRef.current) {
      if (pageOfCfi(highlight.cfi) !== index || highlight.endAt <= highlight.startAt) continue;
      const range = rangeIn(layer, highlight.startAt, highlight.endAt);
      if (!range) continue;
      hits.push({ highlight, range });
      byColour.set(highlight.colour, [...(byColour.get(highlight.colour) ?? []), range]);
    }
    for (const colour of HIGHLIGHT_COLOURS) {
      const ranges = byColour.get(colour) ?? [];
      if (ranges.length) win.CSS.highlights.set(`debaser-${colour}`, new win.Highlight(...ranges));
      else win.CSS.highlights.delete(`debaser-${colour}`);
    }
    pdfHits.current.set(doc, hits);
  }, []);

  // Every highlight with a place drawn on whatever chapters are on screen (the engine draws only those it holds).
  const drawAll = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    if (kindRef.current === 'pdf') {
      for (const [index, doc] of pdfDocs.current) paintPdf(doc, index);
      return;
    }
    for (const highlight of highlightsRef.current) {
      if (highlight.cfi) void view.addAnnotation({ value: highlight.cfi, color: tokenValue(markToken(highlight.colour)) }).catch(() => undefined);
    }
  }, [paintPdf]);

  useEffect(() => {
    if (phase === 'ready') drawAll();
  }, [mine, phase, drawAll]);

  /**
   * Highlights made in another copy of this book, found here by their words (an EPUB only: the engine searches its text).
   * A short run of the quote is searched for; found, it is drawn and GO TO goes there; not found, the panel lists it FROM
   * ANOTHER COPY with its quote and where it was. At most 60, one at a time, after the book is open.
   */
  useEffect(() => {
    if (phase !== 'ready' || kind !== 'epub' || !copyRef) return;
    const elsewhere = highlights.filter((highlight) => highlight.bookRef !== copyRef && !(highlight.id in found)).slice(0, 60);
    if (elsewhere.length === 0) return;
    let live = true;
    (async () => {
      const view = viewRef.current;
      if (!view) return;
      const located: Record<string, string> = {};
      for (const highlight of elsewhere) {
        if (!live) return;
        let at = '';
        try {
          for await (const result of view.search({ query: quoteProbe(highlight.quote) })) {
            if (result === 'done') break;
            if ('subitems' in result && result.subitems[0]) {
              at = result.subitems[0].cfi;
              break;
            }
          }
        } catch {
          at = '';
        }
        located[highlight.id] = at;
      }
      view.clearSearch();
      // Found: where; not found: empty, so it isn't searched for again and the panel says FROM ANOTHER COPY.
      if (live) setFound((held) => ({ ...held, ...Object.fromEntries(Object.entries(located).map(([id, at]) => [id, isCfi(at) ? at : ''])) }));
    })();
    return () => {
      live = false;
    };
  }, [phase, kind, copyRef, highlights, found]);

  // ---------- opening the book ----------

  const closeBars = useCallback(() => {
    setPicked(null);
    setShown(null);
  }, []);

  /** Where in the stage a range in a chapter sits, for the highlight bar. */
  const spotOf = useCallback((doc: Document, range: Range): BarSpot | null => {
    const stage = stageRef.current;
    const frame = doc.defaultView?.frameElement;
    if (!stage || !frame) return null;
    const stageBox = stage.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
    const first = rects[0] ?? range.getBoundingClientRect();
    const last = rects[rects.length - 1] ?? first;
    return {
      x: frameBox.left + (first.left + last.right) / 2 - stageBox.left,
      top: frameBox.top + first.top - stageBox.top,
      bottom: frameBox.top + last.bottom - stageBox.top,
      stageWidth: stageBox.width,
      stageHeight: stageBox.height,
    };
  }, []);

  /**
   * A page turn (the arrow keys, a click or tap on the page's outer thirds, the ◀ ▶ keys), with the leaf swinging over it
   * (Luke, 2026-11-11). The leaf is drawn first, covering the page being left, and the book changes on the next frames
   * underneath it. Under reduced motion the page simply changes. A swipe is the engine's own and turns without the leaf.
   */
  const turn = useCallback((direction: 'left' | 'right') => {
    const view = viewRef.current;
    if (!view) return;
    closeBars();
    const go = () => void (direction === 'left' ? view.goLeft() : view.goRight());
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      go();
      return;
    }
    // Two pages side by side: the engine draws one column head per column; a PDF's spread is ONE PAGE / TWO PAGES.
    const columns = kindRef.current === 'pdf' ? (settingsRef.current.pages === 'two' ? 2 : 1) : ((view.renderer as { heads?: unknown[] | null }).heads?.length ?? 1);
    flipCount.current += 1;
    setFlip({ id: flipCount.current, side: direction, spread: columns >= 2 });
    // A plain timer, not animation frames (those wait while the tab is hidden): long enough for the leaf to be painted first.
    window.setTimeout(go, 40);
  }, [closeBars]);

  /**
   * A click or a tap at this point on the screen: the outer thirds of the reading area turn the page (a mouse too, Luke
   * 2026-11-11). Clicks on the page itself come from the chapter's frame; clicks beside it come from the stage. The turn
   * waits a quarter of a second, so a double-click to choose a word cancels it, and it doesn't happen if words were chosen
   * meanwhile. With the highlight bar open, a click only closes the bar.
   */
  const tapAt = useCallback(
    (clientX: number, doc: Document | null = null) => {
      const stage = stageRef.current;
      if (!stage) return;
      if (barsOpenRef.current) {
        closeBars();
        return;
      }
      const box = stage.getBoundingClientRect();
      const x = clientX - box.left;
      const side = x < box.width / 3 ? 'left' : x > (box.width * 2) / 3 ? 'right' : null;
      if (side === null) return;
      if (turnTimer.current !== null) window.clearTimeout(turnTimer.current);
      turnTimer.current = window.setTimeout(() => {
        turnTimer.current = null;
        const selection = doc?.getSelection();
        if (selection && !selection.isCollapsed) return;
        turn(side);
      }, TURN_WAIT_MS);
    },
    [turn, closeBars],
  );

  /** A double-click is for choosing a word: the turn its first click set off is cancelled. */
  const cancelTurn = useCallback(() => {
    if (turnTimer.current !== null) window.clearTimeout(turnTimer.current);
    turnTimer.current = null;
  }, []);

  const keys = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        turn('left');
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        turn('right');
      } else if (event.key === 'Escape') {
        if (picked || shown) closeBars();
        else if (panel) setPanel(null);
        else setFocus(false);
      }
    },
    [turn, picked, shown, panel, closeBars],
  );

  const keysRef = useRef(keys);
  useEffect(() => {
    keysRef.current = keys;
  }, [keys]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keysRef.current(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  const asked = search.toString();
  // `/read?file=<fingerprint>`: CONTINUE READING's READ for your own file, which the site doesn't have: choose it again.
  const wantedFile = own && /^[0-9a-f]{64}$/.test(search.get('file') ?? '') ? search.get('file') : null;
  const forRef = own ? cleanWork(search.get('for')) : null;

  useEffect(() => {
    // A file this browser keeps (YOUR FILES) opens at once; one it doesn't asks to be chosen again.
    if (!wantedFile) return;
    let live = true;
    void keptFileOf(`own:${wantedFile}`).then((kept) => {
      if (!live) return;
      setKeptMissing(kept === null);
      if (kept) {
        setToc([]);
        setOwnFile(asFile(kept));
      }
    });
    return () => {
      live = false;
    };
  }, [wantedFile]);

  useEffect(() => {
    // READ YOUR OWN COPY from a book page: the file chosen here is that book.
    if (!forRef) return;
    let live = true;
    void fetch(`/api/web/book/info?ref=${encodeURIComponent(forRef)}`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((body: { item?: { title?: string; creator?: string } } | null) => {
        if (live) setForInfo({ work: forRef, title: body?.item?.title ?? '', author: body?.item?.creator ?? '' });
      });
    return () => {
      live = false;
    };
  }, [forRef]);
  // Known from the address before its title comes (a file chosen at once is still that book); the card fills the title in.
  const forWork: WorkMatch | null =
    forRef && forDoneFor !== forRef ? { work: forRef, title: forInfo?.work === forRef ? forInfo.title : '', author: forInfo?.work === forRef ? forInfo.author : '', cover: null } : null;

  useEffect(() => {
    let live = true;
    let view: EngineView | null = null;
    const host = hostRef.current;
    // Leaving the page (or another book) cancels an IPFS book still arriving, and no other gateway is asked.
    const leaving = new AbortController();
    (async () => {
      try {
        let file: Blob | null = null;
        // A scanned Archive book's page pictures, made into a book the engine opens like a PDF (page-pictures.ts).
        let prepared: EngineBook | null = null;
        opened.current = false;
        heldPlace.current = null;
        lastTurn.current = null;
        storyEnd.current = 1;
        pdfDocs.current.clear();
        const cid = own ? null : ipfsCid(bookRef);
        if (cid) {
          // A book on IPFS: fetched by this browser straight from a gateway, one at a time, into memory (ipfs.ts).
          setArriving(null);
          setThrough(false);
          try {
            const got = await fetchFromGateways(cid, { signal: leaving.signal, onProgress: (progress) => live && setArriving(progress) });
            file = got.blob;
          } catch (error) {
            // Every gateway refused this browser: the book through the site's own route instead (step 3, ipfs-pass.ts),
            // passed on as it streams and never kept. Its refusals are plain capitals, shown as they come.
            if (!(error instanceof IpfsFetchError) || error.problem !== 'BLOCKED BY THE SOURCE') throw error;
            if (live) setThrough(true);
            const response = await fetch(`/api/web/book/epub?ref=${encodeURIComponent(bookRef)}`, { cache: 'no-store', signal: leaving.signal });
            if (!response.ok) {
              const said = (await response.json().catch(() => ({}))) as { error?: string };
              throw new Error(said.error ?? IPFS_LINES['BLOCKED BY THE SOURCE']);
            }
            file = await response.blob();
          }
        } else if (own) {
          // A reader's own file: opened here, from their device, never sent anywhere.
          if (!ownFile) {
            setPhase('choose');
            return;
          }
          file = ownFile;
          setTitle(ownFile.name.replace(/\.(pdf|epub)$/i, ''));
          // Known by a fingerprint of its bytes (SHA-256, worked out here), so its place follows the account to another
          // device. Only the fingerprint is ever sent; the bytes stay in this browser.
          placeRefOf.current = ownRef(await fingerprint(ownFile).catch(() => ''));
          savedTitle.current = '';
          // Its highlights and match are kept under that ref too (copies.ts).
          if (live) {
            setCopyRef(placeRefOf.current);
            setWork(null);
            setMatch(null);
            setOwnMeta(null);
            setFound({});
          }
        } else {
          const response = await fetch(`/api/web/book/epub?ref=${encodeURIComponent(bookRef)}`, { cache: 'no-store' });
          const json = (response.headers.get('content-type') ?? '').startsWith('application/json');
          const said = json
            ? ((await response.json().catch(() => ({}))) as {
                error?: string;
                viewer?: boolean;
                pdf?: { size?: number };
                redirect?: string;
                noFreeCopy?: { work?: string; openLibraryUrl?: string; borrowOnArchive?: string };
              })
            : null;
          // A bare Open Library work (Luke, 2026-11-13: "any book can be read in the ereader"): the server resolved it to a
          // concrete copy; the reader reopens at that ref. Only a /read/… address on this site, and never where we came from.
          if (said?.redirect && /^\/read\/[A-Za-z0-9][A-Za-z0-9:_.-]{1,200}(?:\?[A-Za-z0-9=&_.-]*)?$/.test(said.redirect) && said.redirect !== `/read/${bookRef}`) {
            if (live) router.replace(said.redirect);
            return;
          }
          // A work with no free copy anywhere: a page inside the reader with a link to Open Library, and, when a
          // lending-library Archive scan exists, a [ BORROW ON ARCHIVE ↗ ] key beside it.
          if (said?.noFreeCopy?.openLibraryUrl && /^https:\/\/openlibrary\.org\/works\/OL[1-9][0-9]{0,11}W$/.test(said.noFreeCopy.openLibraryUrl)) {
            if (live) {
              setNoFreeCopyUrl(said.noFreeCopy.openLibraryUrl);
              setBorrowOnArchive(
                typeof said.noFreeCopy.borrowOnArchive === 'string' && /^https:\/\/archive\.org\/details\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(said.noFreeCopy.borrowOnArchive)
                  ? said.noFreeCopy.borrowOnArchive
                  : null,
              );
              setPhase('no-free-copy');
            }
            return;
          }
          // An Internet Archive book with neither an EPUB nor a PDF: its page pictures in the site's own reader, straight from
          // archive.org (SPEC-reading-places.md, 2026-11-13); the Archive's own viewer when those can't be read.
          const archiveId = archiveBookId(bookRef);
          if (said?.viewer === true && archiveId !== null) {
            const found = await fetchPages(archiveId, leaving.signal);
            if (!found) {
              if (live) setPhase('viewer');
              return;
            }
            prepared = pictureBook(found, '');
          } else {
            if (!response.ok) throw new Error(said?.error ?? 'THIS BOOK CAN\'T BE READ HERE.');
            // One with only a PDF: read a slice at a time through the site's route, never kept.
            if (said?.pdf && typeof said.pdf.size === 'number' && said.pdf.size > 0) file = remotePdf(bookRef, said.pdf.size);
            else if (said) throw new Error(said.error ?? 'THIS BOOK CAN\'T BE READ HERE.');
            else file = await response.blob();
          }
        }
        if (!live) return;
        setPhase('opening');
        const engine = await loadEngine();
        drawRef.current = engine.highlight;
        const book = prepared ?? (file ? await openBook(file, engine.makeBook) : null);
        if (!book) throw new Error('THIS BOOK COULD NOT BE OPENED.');
        if (own) {
          savedTitle.current = metadataText(book.metadata?.title);
          // The title and author written inside your own file: what it is matched to an Open Library work by.
          if (live) setOwnMeta({ title: metadataText(book.metadata?.title), author: metadataText(book.metadata?.author) });
        }
        if (live) setPictures(prepared !== null);
        const openedKind = bookKind(book);
        kindRef.current = openedKind;
        setKind(openedKind);
        // A PDF shows one page at a time when ONE PAGE is chosen (its spread is set as it opens).
        if (openedKind === 'pdf' && settingsRef.current.pages === 'one') {
          const rendition = (book as { rendition?: Record<string, unknown> }).rendition;
          if (rendition) rendition.spread = 'none';
        }
        if (!live || !host) return;
        view = document.createElement('foliate-view') as EngineView;
        view.className = 'block h-full w-full';
        host.replaceChildren(view);
        viewRef.current = view;

        view.addEventListener('load', (event) => {
          const { doc, index } = (event as CustomEvent<{ doc: Document; index: number }>).detail;
          indexOf.current.set(doc, index);
          doc.addEventListener('keydown', (keyEvent) => keysRef.current(keyEvent));
          doc.addEventListener('dblclick', cancelTurn);
          // A PDF page: its highlights painted now and again whenever its words are drawn afresh (a new zoom).
          if (kindRef.current === 'pdf' && !prepared) {
            pdfDocs.current.set(index, doc);
            let paintTimer: number | null = null;
            new MutationObserver(() => {
              if (paintTimer !== null) window.clearTimeout(paintTimer);
              paintTimer = window.setTimeout(() => paintPdf(doc, index), 120);
            }).observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });
            paintPdf(doc, index);
          }
          let timer: number | null = null;
          doc.addEventListener('selectionchange', () => {
            // Highlights: an EPUB's words, or a PDF page's (its words layer); a scan's pictures have no words to choose.
            if (kindRef.current !== 'epub' && (kindRef.current !== 'pdf' || prepared)) return;
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
              const selection = doc.getSelection();
              if (!selection || selection.isCollapsed || selection.rangeCount === 0) return setPicked((held) => (held ? null : held));
              const range = selection.getRangeAt(0);
              const quote = quoteOf(range.toString(), QUOTE_MAX);
              const spot = spotOf(doc, range);
              const current = viewRef.current;
              if (!quote || !spot || !current) return;
              if (kindRef.current === 'pdf') {
                // A PDF highlight: the page, and the characters within its words where the choice starts and ends.
                const layer = doc.querySelector('.textLayer');
                if (!layer || !layer.contains(range.commonAncestorContainer)) return;
                const startAt = offsetIn(layer, range.startContainer, range.startOffset);
                const endAt = offsetIn(layer, range.endContainer, range.endOffset);
                if (endAt <= startAt) return;
                setShown(null);
                setPicked({ cfi: pageCfi(indexOf.current.get(doc) ?? index), quote, spot, startAt, endAt });
                return;
              }
              const cfi = current.getCFI(indexOf.current.get(doc) ?? index, range);
              if (!isCfi(cfi)) return;
              setShown(null);
              setPicked({ cfi, quote, spot });
            }, 280);
          });
          // A click or tap on the page's outer thirds turns it; not on a link, a highlight, or after choosing words.
          doc.addEventListener('click', (click) => {
            window.setTimeout(() => {
              if (annotationHit.current) {
                annotationHit.current = false;
                return;
              }
              const selection = doc.getSelection();
              if (selection && !selection.isCollapsed) return;
              if ((click.target as Element | null)?.closest?.('a[href]')) return;
              // A click on one of your highlights on a PDF page opens it (the engine finds an EPUB's itself).
              const hit = (pdfHits.current.get(doc) ?? []).find(({ range }) =>
                Array.from(range.getClientRects()).some((box) => click.clientX >= box.left && click.clientX <= box.right && click.clientY >= box.top && click.clientY <= box.bottom),
              );
              if (hit && hit.highlight.person === meRef.current?.id) {
                const spot = spotOf(doc, hit.range);
                if (spot) {
                  setPicked(null);
                  setShown({ highlight: hit.highlight, spot });
                }
                return;
              }
              const frame = doc.defaultView?.frameElement;
              if (frame) tapAt(frame.getBoundingClientRect().left + click.clientX, doc);
            }, 0);
          });
        });
        view.addEventListener('relocate', (event) => {
          const detail = (event as CustomEvent<Relocated>).detail;
          const cfi = isCfi(detail.cfi) ? detail.cfi : null;
          const fraction = storyFraction(typeof detail.fraction === 'number' ? detail.fraction : 0, storyEnd.current);
          // Fixed pages (a PDF, a scan's pictures): PAGE 12 OF 300. Reflowing ones: minutes left in the chapter at your own
          // pace in this book, once there's enough to judge (reading-places.ts).
          const fixed = kindRef.current === 'pdf';
          const page = fixed && typeof detail.section?.current === 'number' ? detail.section.current + 1 : 0;
          const pages = fixed && typeof detail.section?.total === 'number' ? detail.section.total : 0;
          const left = detail.time?.total;
          if (!fixed && typeof left === 'number' && Number.isFinite(left)) {
            const now = Date.now();
            if (lastTurn.current && opened.current) pace.current = paceAfter(pace.current, lastTurn.current, { at: now, left });
            lastTurn.current = { at: now, left };
          }
          setLocation({
            fraction,
            chapter: (detail.tocItem?.label ?? '').trim(),
            chapterHref: detail.tocItem?.href ?? null,
            timeLeft: fixed ? pageText(page, pages) : chapterLeftText(pace.current, detail.time?.section),
            cfi,
            page,
          });
          const ref = placeRefOf.current;
          // Saved only once the reader has moved from where the book opened, 1.5 s after the last turn.
          if (!cfi || !ref || !opened.current) return;
          if (placeTimer.current !== null) window.clearTimeout(placeTimer.current);
          placeTimer.current = window.setTimeout(() => {
            const held = heldPlace.current;
            const finishedAt = finishedAfter(fraction, held?.finishedAt ?? null);
            const save: PlaceSave = {
              cfi,
              page,
              title: savedTitle.current,
              progress: finishedAt ? 100 : percentOf(fraction),
              finishedAt,
              // The work this copy is, so every copy of the book is found together (copies.ts).
              ...(workNow.current ? { workRef: workNow.current } : {}),
            };
            remember(placeKey(ref), storedPlace(save, held));
            remember(paceKey(ref), JSON.stringify(pace.current));
            heldPlace.current = { bookRef: ref, ...save, title: save.title || held?.title || '', updatedAt: new Date().toISOString() };
            const person = meRef.current;
            if (person) void getBooksRepository().savePlace(person.id, ref, save).catch(() => undefined);
          }, 1500);
        });
        view.addEventListener('create-overlay', () => drawAll());
        view.addEventListener('draw-annotation', (event) => {
          const { draw, annotation } = (event as CustomEvent<{ draw: (fn: HighlightDraw, options: { color: string }) => void; annotation: { color?: string } }>).detail;
          if (drawRef.current) draw(drawRef.current, { color: annotation.color ?? tokenValue('--color-mark-yellow') });
        });
        view.addEventListener('show-annotation', (event) => {
          const { value, index, range } = (event as CustomEvent<{ value: string; index: number; range: Range }>).detail;
          annotationHit.current = true;
          const highlight = highlightsRef.current.find((each) => each.cfi === value);
          const doc = viewRef.current?.renderer.getContents().find((each) => each.index === index)?.doc;
          const spot = doc ? spotOf(doc, range) : null;
          // Only your own open the bar (another reader's public one is theirs to change).
          if (highlight && spot && highlight.person === meRef.current?.id) {
            setPicked(null);
            setShown({ highlight, spot });
          }
        });

        await view.open(book);
        if (!live) return;
        storyEnd.current = openedKind === 'epub' ? bookEnd(view, book.toc ?? []) : 1;
        applyLook(settingsRef.current);
        setToc(book.toc ?? []);
        setTitle((held) => held || metadataText(book.metadata?.title));

        // Where to open: back where it was (opened again for ONE PAGE / TWO PAGES), a highlight (`?h=`) or a spot (`?at=`),
        // which skip the question; else, for a book you've started, the question (SPEC-reading-places.md): CONTINUE FROM 42%
        // or START OVER. The place is the account's (it follows you between devices), else this browser's.
        const spot = own ? { cfi: null, highlight: null } : spotFromSearch(asked);
        let start: string | null = resumeRef.current ?? spot.cfi;
        resumeRef.current = null;
        if (!own && !start && spot.highlight) {
          const highlight = await getBooksRepository().get(spot.highlight).catch(() => null);
          if (highlight?.bookRef === bookRef && highlight.cfi) start = highlight.cfi;
        }
        const ref = placeRefOf.current;
        /** The one question, answered by its keys. */
        const askAbout = async (place: Asked): Promise<'continue' | 'over' | null> => {
          setAsk(place);
          setPhase('ask');
          const choice = await new Promise<'continue' | 'over'>((resolve) => {
            answerAsk.current = resolve;
          });
          answerAsk.current = null;
          if (!live) return null;
          setAsk(null);
          return choice;
        };
        // A place in another copy of the same book, offered by how far through: `CONTINUE FROM 42% (READ IN ANOTHER COPY)`.
        let elsewhere: number | null = null;
        if (ref) {
          const person = meRef.current;
          const saved = (person ? await getBooksRepository().place(person.id, ref).catch(() => null) : null) ?? placeFromStored(ref, remembered(placeKey(ref)));
          heldPlace.current = saved;
          pace.current = paceFrom(remembered(paceKey(ref)));
          if (!start && saved?.cfi) {
            if (!live) return;
            const choice = await askAbout(saved);
            if (choice === null) return;
            if (choice === 'continue') start = saved.cfi;
          } else if (!start) {
            const cidHere = ipfsCid(ref);
            const workHere = own
              ? cleanWork(saved?.workRef ?? remembered(workKey(ref)))
              : (workOf(ref) ?? (cidHere ? ipfsWork(cidHere) : null) ?? (archiveBookId(ref) ? await archiveWork(ref) : null));
            if (workHere) {
              const candidates = person ? await getBooksRepository().placesOfWork(person.id, workHere).catch(() => []) : placesHere().filter((place) => bookOf(place) === workHere);
              const other = candidates
                .filter((place) => place.bookRef !== ref && place.cfi !== null && place.progress > 0 && !place.finishedAt)
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
              if (other && live) {
                const choice = await askAbout({ ...other, other: true });
                if (choice === null) return;
                if (choice === 'continue') elsewhere = other.progress / 100;
              }
            }
          }
        }
        if (!live) return;
        await view.init({ lastLocation: start, showTextStart: start === null && elsewhere === null });
        if (elsewhere !== null) await view.goToFraction(Math.min(1, elsewhere * storyEnd.current));
        opened.current = true;
        if (live) setPhase('ready');
      } catch (error) {
        if (!live) return;
        if (error instanceof IpfsFetchError) setPhase({ fault: IPFS_LINES[error.problem] });
        else setPhase({ fault: error instanceof Error && /^[A-Z0-9 .,'!?-]+$/.test(error.message) ? error.message : 'THIS BOOK COULD NOT BE OPENED.' });
      }
    })();
    return () => {
      live = false;
      leaving.abort();
      answerAsk.current = null;
      if (placeTimer.current !== null) window.clearTimeout(placeTimer.current);
      (view?.book as { destroy?: () => void } | undefined)?.destroy?.();
      view?.close();
      view?.remove();
      viewRef.current = null;
    };
    // Opened once per book (or own file), and again for a PDF's ONE PAGE / TWO PAGES.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookRef, ownFile, openCount]);

  // ---------- highlights ----------

  /** An unlocked highlight's post in the reader's own thread for the book, made the first time it's needed. */
  // The book's name for its thread and its highlights: the matched book's for your own file (else the title inside it).
  const matched = match && match !== 'none' && match !== 'unfound' ? match : null;
  // Never your own file's name: it may say more than you'd post (only the title written inside the file, or the match's).
  const bookName = (own ? matched?.title || ownMeta?.title || 'MY OWN BOOK' : title) || 'A BOOK';

  /**
   * An unlocked highlight's post in the reader's own thread for the book, made the first time it's needed: one thread for
   * every copy of the book once the copy's work is known (copies.ts), found first by the work and then by the copy's own
   * ref (threads made before 2026-11-13 were named by the copy).
   */
  const post = async (highlight: BookHighlight): Promise<string | null> => {
    if (!me) return null;
    const ref = copyRef ?? bookRef;
    const anchor = bookThreadAnchor(me.id, threadKeyOf(ref, work), bookName);
    const thread =
      forum.threadForAnchor(anchor) ??
      (work ? forum.threadForAnchor(bookThreadAnchor(me.id, ref, bookName)) : undefined) ??
      (await forum.createThread({ title: bookThreadTitle(me.displayName, bookName), body: '', anchor }));
    const result = await forum.addComment({ threadId: thread.id, body: highlightPost(highlight, own ? backLinkOf(ref, work) : undefined) });
    return result.comment.id;
  };

  const save = async (colour: HighlightColour, comment: string, locked: boolean) => {
    if (!me || !picked || !copyRef) return;
    setFault(null);
    const chosen = picked;
    closeBars();
    viewRef.current?.deselect();
    try {
      let highlight = await getBooksRepository().add(me.id, {
        bookRef: copyRef,
        bookTitle: bookName,
        cfi: chosen.cfi,
        quote: chosen.quote,
        comment: comment.trim(),
        colour,
        isLocked: locked,
        startAt: chosen.startAt,
        endAt: chosen.endAt,
        workRef: work,
      });
      if (!locked) {
        const forumCommentId = await post(highlight).catch(() => null);
        if (forumCommentId) {
          await getBooksRepository().update(highlight.id, { forumCommentId });
          highlight = { ...highlight, forumCommentId };
        }
      }
      setHighlights((held) => [...held, highlight]);
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The highlight could not be saved.');
    }
  };

  const recolour = async (highlight: BookHighlight, colour: HighlightColour) => {
    setFault(null);
    try {
      await getBooksRepository().update(highlight.id, { colour });
      setHighlights((held) => held.map((each) => (each.id === highlight.id ? { ...each, colour } : each)));
      setShown((open) => (open && open.highlight.id === highlight.id ? { ...open, highlight: { ...open.highlight, colour } } : open));
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The highlight could not be saved.');
    }
  };

  const flipLock = async (highlight: BookHighlight) => {
    setFault(null);
    try {
      const locking = !highlight.isLocked;
      let forumCommentId = highlight.forumCommentId;
      if (locking && forumCommentId) {
        await forum.deleteComment(forumCommentId).catch(() => undefined);
        forumCommentId = null;
      }
      if (!locking) forumCommentId = await post(highlight).catch(() => null);
      await getBooksRepository().update(highlight.id, { isLocked: locking, forumCommentId });
      const changed = { ...highlight, isLocked: locking, forumCommentId };
      setHighlights((held) => held.map((each) => (each.id === highlight.id ? changed : each)));
      setShown((open) => (open && open.highlight.id === highlight.id ? { ...open, highlight: changed } : open));
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The highlight could not be saved.');
    }
  };

  const remove = async (highlight: BookHighlight) => {
    if (!window.confirm('Delete this highlight? Its forum post goes too.')) return;
    try {
      if (highlight.forumCommentId) await forum.deleteComment(highlight.forumCommentId).catch(() => undefined);
      await getBooksRepository().remove(highlight.id);
      if (highlight.cfi) void viewRef.current?.deleteAnnotation({ value: highlight.cfi }).catch(() => undefined);
      setHighlights((held) => held.filter((each) => each.id !== highlight.id));
      setShown(null);
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The highlight could not be deleted.');
    }
  };

  // ---------- bookmarks ----------

  const addBookmark = async () => {
    if (!me || !location.cfi) return;
    setFault(null);
    try {
      const bookmark = await getBooksRepository().addBookmark(me.id, { bookRef, cfi: location.cfi, label: bookmarkLabel(location.chapter, percentOf(location.fraction)) });
      setBookmarks((held) => (held.some((each) => each.id === bookmark.id) ? held : [...held, bookmark]));
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The bookmark could not be saved.');
    }
  };

  const removeBookmark = async (bookmark: BookBookmark) => {
    try {
      await getBooksRepository().removeBookmark(bookmark.id);
      setBookmarks((held) => held.filter((each) => each.id !== bookmark.id));
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The bookmark could not be deleted.');
    }
  };

  // ---------- search ----------

  const runSearch = async (query: string) => {
    const view = viewRef.current;
    if (!view) return;
    setSearched(query);
    setGroups([]);
    setSearching(0);
    try {
      for await (const result of view.search({ query, drawOptions: { color: tokenValue('--color-mark-pink') } })) {
        if (result === 'done') break;
        if ('progress' in result) setSearching(result.progress);
        else if ('subitems' in result) setGroups((held) => [...held, { label: result.label, subitems: result.subitems }]);
      }
    } catch {
      setFault('THE SEARCH STOPPED.');
    }
    setSearching(null);
  };

  const go = (target: string) => {
    closeBars();
    void viewRef.current?.goTo(target);
    // On an upright screen the panel is a sheet over the page: going somewhere closes it so the page shows.
    if (window.matchMedia('(orientation: portrait)').matches) setPanel(null);
  };

  // ---------- the bars ----------

  const back = () => {
    if (window.history.length > 1) router.back();
    // An Archive book, or a reader's own file, has no book page of its own: back to MEDIA.
    else router.push(own || archiveViewerUrl(bookRef) ? '/media' : `/media/book/${bookRef}`);
  };

  /** A reader's own PDF or EPUB, chosen from their device: it opens here and goes nowhere else. */
  const chooseOwn = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!chosen) return;
    if (!/\.(pdf|epub)$/i.test(chosen.name)) {
      setFault('A PDF OR AN EPUB, PLEASE.');
      return;
    }
    // To the drop box's card, which finds its book before it opens.
    setFault(null);
    setPanel(null);
    setOwnFile(null);
    setIncoming(chosen);
  };
  /** The card's [ READ ], or a file YOUR FILES keeps: it opens here and goes nowhere else. */
  const openOwn = (file: File) => {
    setForDoneFor(forRef);
    setFault(null);
    setPanel(null);
    setToc([]);
    setOwnFile(file);
  };
  const ownPicker = (label: string, className: string) => (
    <label className={`${className} cursor-pointer`}>
      {label}
      <input type="file" accept={OWN_ACCEPT} onChange={chooseOwn} className="sr-only" />
    </label>
  );

  const toggle = (name: PanelName) => {
    closeBars();
    setPanel((open) => (open === name ? null : name));
  };

  const shownFraction = dragging ?? location.fraction;
  const percent = percentOf(shownFraction);
  const ready = phase === 'ready';

  const commitDrag = () => {
    // The bar spans the book itself: its end is where a Gutenberg book's licence starts.
    if (dragging !== null) void viewRef.current?.goToFraction(Math.min(1, dragging * storyEnd.current));
    setDragging(null);
  };

  const topKey = (name: PanelName, label: string) => (
    <button type="button" onClick={() => toggle(name)} aria-pressed={panel === name} disabled={!ready} className={panel === name ? PLATE_PRESSED : PLATE}>
      {panel === name ? label : `[ ${label} ]`}
    </button>
  );

  return (
    <div className={focus ? 'fixed inset-0 z-overlay flex flex-col' : 'flex h-full min-h-[24rem] flex-col'}>
      {!focus ? (
        <header className="flex flex-wrap items-center gap-1 border-b border-ink bg-sun-pale px-2 py-1 text-ink">
          <button type="button" onClick={back} className={PLATE}>
            [ ◀ BACK ]
          </button>
          <h1 className="min-w-0 flex-1 truncate px-1 text-key text-accent-ink" title={title}>
            {own && phase === 'choose' ? 'YOUR BOOKS' : title ? title.toUpperCase() : own ? 'YOUR OWN BOOK' : 'BOOK'}
          </h1>
          <nav aria-label="The reader's keys" className="flex flex-wrap items-center gap-1">
            {/* The Archive's viewer has its own contents and search: only FOCUS is ours there. Bookmarks belong to a book the
                site knows (not a reader's own file); highlights to any book with words, your own file and PDFs included
                (2026-11-13), but not a scan's page pictures. */}
            {phase !== 'viewer' && phase !== 'choose' && phase !== 'no-free-copy' ? (
              <>
                {topKey('contents', 'CONTENTS')}
                {topKey('search', 'SEARCH')}
                {own ? null : topKey('bookmarks', `BOOKMARKS${bookmarks.length ? ` ${bookmarks.length}` : ''}`)}
                {pictures ? null : topKey('highlights', `HIGHLIGHTS${highlights.length ? ` ${highlights.length}` : ''}`)}
                {topKey('look', 'LOOK')}
              </>
            ) : null}
            {own && phase !== 'choose' ? ownPicker('[ ANOTHER FILE ]', PLATE) : null}
            {phase === 'choose' ? null : (
              <button type="button" onClick={() => setFocus(true)} className={PLATE}>
                [ FOCUS ]
              </button>
            )}
          </nav>
        </header>
      ) : null}
      {!focus && own && phase !== 'choose' && match !== null ? (
        // Your own file, matched to its book (copies.ts): its highlights and place then count as that book's.
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-ink bg-sun-pale px-2 py-1 text-label text-ink" data-match>
          <span className="min-w-0 break-words">
            {match === 'none'
              ? 'NOT LISTED: KEPT AS YOUR OWN FILE.'
              : match === 'unfound'
                ? 'NO BOOK FOUND FOR THIS FILE: KEPT AS YOUR OWN FILE.'
                : matchLine(match)}
          </span>
          <button type="button" onClick={() => setChoosing(true)} className={PLATE}>
            {match === 'unfound' || match === 'none' ? '[ FIND IT ]' : '[ CHANGE ]'}
          </button>
          {match !== 'none' ? (
            <button type="button" onClick={() => void chooseMatch('none')} className={PLATE}>
              [ NOT LISTED ]
            </button>
          ) : null}
        </p>
      ) : null}

      <div ref={stageRef} className={`relative min-h-0 flex-1 overflow-hidden ${PAPER_CLASS[settings.paper]}`}>
        <div
          ref={hostRef}
          className="absolute inset-0"
          aria-label="The book"
          role="document"
          onClick={(event) => tapAt(event.clientX)}
          onDoubleClick={cancelTurn}
        />

        {flip && ready ? (
          // The page turn: a leaf of this paper swinging over the spine in whole frames (globals.css). Its front covers the page
          // being left; its back, past the edge-on frame, the page it lands on. Taken away when it lands.
          <div
            key={flip.id}
            aria-hidden="true"
            className={`page-leaf pointer-events-none absolute inset-y-0 z-30 ${PAPER_CLASS[settings.paper]} ${
              flip.side === 'right' ? 'page-leaf-right animate-page-turn-right' : 'page-leaf-left animate-page-turn-left'
            } ${flip.spread ? (flip.side === 'right' ? 'left-1/2 right-0' : 'left-0 right-1/2') : 'inset-x-0'}`}
            onAnimationEnd={() => setFlip((held) => (held?.id === flip.id ? null : held))}
          >
            <div className={`page-leaf-face border-current ${flip.side === 'right' ? 'border-r-line' : 'border-l-line'}`}>
              <div className={`page-leaf-fold ${flip.side === 'right' ? 'left-0' : 'right-0'}`} />
            </div>
            <div className={`page-leaf-face page-leaf-back border-current ${flip.side === 'right' ? 'border-l-line' : 'border-r-line'}`}>
              <div className={`page-leaf-fold ${flip.side === 'right' ? 'right-0' : 'left-0'}`} />
            </div>
          </div>
        ) : null}

        {phase === 'choose' && wantedFile && keptMissing === null ? (
          <p className="absolute inset-x-0 top-1/3 text-center text-label" role="status">
            OPENING YOUR FILE...
          </p>
        ) : phase === 'choose' ? (
          <ReadingShelf me={me} wantedFile={keptMissing ? wantedFile : null} forWork={forWork} incoming={incoming} onIncoming={setIncoming} onOpen={openOwn} />
        ) : null}
        {phase === 'ask' && ask ? (
          // The one question before a started book's page (SPEC-reading-places.md): where you were, or the start.
          <div className="absolute inset-x-0 top-1/3 flex flex-col items-center gap-2 p-4 text-center" role="dialog" aria-label="Where to open the book">
            <p className="w-fit bg-sun-pale px-1 text-label text-ink">
              {ask.finishedAt
                ? `YOU FINISHED THIS ${finishedWhen(ask.finishedAt)}.`
                : `YOU'RE ${ask.progress > 0 ? `${progressText(ask)} THROUGH` : 'PART WAY THROUGH'}${ask.other ? ' IN ANOTHER COPY OF THIS BOOK' : ''}${ask.updatedAt ? ` · LAST READ ${whenText(ask.updatedAt)}` : ''}.`}
            </p>
            <div className="flex flex-wrap justify-center gap-1">
              <button type="button" onClick={() => answerAsk.current?.('continue')} className={PLATE_MAIN} autoFocus>
                {ask.other
                  ? `CONTINUE FROM ${progressText(ask)} (READ IN ANOTHER COPY)`
                  : ask.progress > 0 || ask.finishedAt
                    ? `CONTINUE FROM ${ask.finishedAt ? '100%' : progressText(ask)}`
                    : 'CONTINUE WHERE YOU WERE'}
              </button>
              <button type="button" onClick={() => answerAsk.current?.('over')} className={PLATE}>
                [ START OVER ]
              </button>
            </div>
          </div>
        ) : null}
        {phase === 'reading-file' || phase === 'opening' ? (
          <p className="absolute inset-x-0 top-1/3 text-center text-label" role="status">
            {phase === 'reading-file'
              ? ipfs
                ? through
                  ? 'READING THE BOOK FROM IPFS THROUGH DEBASER.SITE...'
                  : `READING THE BOOK FROM IPFS${arriving ? ` (${arriving.gateway})... ${arrivedText(arriving)}` : '...'}`
                : `READING THE BOOK FROM ${archiveViewerUrl(bookRef) ? 'THE INTERNET ARCHIVE' : 'PROJECT GUTENBERG'}...`
              : 'OPENING THE BOOK...'}
          </p>
        ) : null}
        {phase === 'viewer' ? (
          // The Archive's own viewer for a book with no EPUB (Luke, 2026-11-11): its pages come straight from archive.org.
          <iframe
            src={archiveViewerUrl(bookRef) ?? undefined}
            title={`${title || 'The book'} in the Internet Archive's viewer`}
            className="absolute inset-0 h-full w-full border-0"
            allow="fullscreen"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        ) : null}
        {phase === 'no-free-copy' && noFreeCopyUrl ? (
          // A work with no free copy anywhere (Luke, 2026-11-13): shown inside the reader. The keys open Open Library
          // and, when offered, the Internet Archive's borrow page in new tabs; the browser never leaves /read on its own.
          <div className="absolute inset-x-0 top-1/3 flex flex-col items-center gap-2 p-4 text-center">
            <p className="w-fit bg-sun-pale px-1 text-label text-ink">NO FREE COPY OF THIS BOOK WAS FOUND.</p>
            <p className="max-w-prose text-label text-ink">
              {borrowOnArchive
                ? 'The Internet Archive lends it for an hour at a time (free; a reader account is needed). Open Library lists libraries that lend it and shops that sell it.'
                : 'Open Library lists libraries that lend it and shops that sell it.'}
            </p>
            <div className="flex flex-wrap justify-center gap-1">
              {borrowOnArchive ? (
                <a
                  href={borrowOnArchive}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label="Borrow this book on the Internet Archive (new tab)"
                  className={PLATE_MAIN}
                >
                  [ BORROW ON ARCHIVE ↗ ]
                </a>
              ) : null}
              <a
                href={noFreeCopyUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                aria-label="Open this book on Open Library (new tab)"
                className={borrowOnArchive ? PLATE : PLATE_MAIN}
              >
                [ OPEN LIBRARY ↗ ]
              </a>
              <button type="button" onClick={back} className={PLATE}>
                [ ◀ BACK ]
              </button>
            </div>
          </div>
        ) : null}
        {typeof phase === 'object' ? (
          <div className="absolute inset-x-0 top-1/3 flex flex-col items-center gap-2 p-4">
            <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{phase.fault}</p>
            <div className="flex flex-wrap justify-center gap-1">
              {/* An IPFS book may come next time: gateways are slow, and a file nobody held may be held again. */}
              {ipfs ? (
                <button
                  type="button"
                  onClick={() => {
                    setPhase('reading-file');
                    setOpenCount((count) => count + 1);
                  }}
                  className={PLATE_MAIN}
                >
                  [ TRY AGAIN ]
                </button>
              ) : null}
              <button type="button" onClick={back} className={PLATE}>
                [ ◀ BACK ]
              </button>
            </div>
          </div>
        ) : null}
        {fault ? (
          <p className="absolute left-2 top-2 z-40 flex items-center gap-1 bg-bubble-pale px-1 text-label text-ink-bar" role="alert">
            {fault}
            <button type="button" onClick={() => setFault(null)} className="px-1" aria-label="Dismiss">
              ×
            </button>
          </p>
        ) : null}

        {picked ? (
          <HighlightBar
            key={picked.cfi}
            spot={picked.spot}
            quote={picked.quote}
            existing={null}
            signedIn={me !== null}
            onColour={(colour, locked) => void save(colour, '', locked)}
            onComment={(colour, comment, locked) => void save(colour, comment, locked)}
            onLock={() => undefined}
            onDelete={() => undefined}
            onClose={closeBars}
          />
        ) : null}
        {shown ? (
          <HighlightBar
            key={shown.highlight.id}
            spot={shown.spot}
            quote={shown.highlight.quote}
            existing={{ colour: shown.highlight.colour, isLocked: shown.highlight.isLocked }}
            signedIn={me !== null}
            onColour={(colour) => void recolour(shown.highlight, colour)}
            onComment={() => undefined}
            onLock={() => void flipLock(shown.highlight)}
            onDelete={() => void remove(shown.highlight)}
            onClose={closeBars}
          />
        ) : null}

        {panel === 'contents' ? (
          <Panel title="CONTENTS" onClose={() => setPanel(null)}>
            <ContentsList toc={toc} current={location.chapterHref} onGo={go} />
          </Panel>
        ) : null}
        {panel === 'search' ? (
          <Panel title="SEARCH" onClose={() => setPanel(null)}>
            <SearchBox onSearch={(query) => void runSearch(query)} onGo={go} groups={groups} searching={searching} searched={searched} />
          </Panel>
        ) : null}
        {panel === 'bookmarks' ? (
          <Panel title="BOOKMARKS" onClose={() => setPanel(null)}>
            <BookmarkList signedIn={me !== null} bookmarks={bookmarks} onAdd={() => void addBookmark()} onGo={go} onRemove={(bookmark) => void removeBookmark(bookmark)} />
          </Panel>
        ) : null}
        {panel === 'highlights' ? (
          <Panel title="HIGHLIGHTS" onClose={() => setPanel(null)}>
            <HighlightList
              signedIn={me !== null}
              me={me?.id ?? null}
              bookRef={copyRef ?? bookRef}
              highlights={highlights}
              findable={findable}
              onGo={(highlight) => {
                const here = mine.find((each) => each.id === highlight.id)?.cfi;
                if (here) go(here);
              }}
              onLock={(highlight) => void flipLock(highlight)}
              onRemove={(highlight) => void remove(highlight)}
            />
          </Panel>
        ) : null}
        {choosing ? (
          <Panel title="WHICH BOOK IS THIS?" onClose={() => setChoosing(false)}>
            <MatchSearch start={ownMeta?.title || title} onChoose={(chosen) => void chooseMatch(chosen)} />
          </Panel>
        ) : null}
        {panel === 'look' ? (
          <Panel title="LOOK" onClose={() => setPanel(null)}>
            <LookSettings settings={settings} onChange={changeLook} fixedPages={kind === 'pdf'} />
          </Panel>
        ) : null}

        {focus ? (
          <button type="button" onClick={() => setFocus(false)} className="absolute right-1 top-1 z-10 px-1 text-label underline max-sm:min-h-tap" aria-label="Leave focus mode">
            EXIT FOCUS
          </button>
        ) : null}
      </div>

      {!focus && phase === 'viewer' ? (
        <footer className="border-t border-ink bg-sun-pale px-2 py-1 text-label text-ink-quiet">THE INTERNET ARCHIVE&apos;S OWN VIEWER: THIS BOOK HAS NO EPUB FOR THE SITE&apos;S READER.</footer>
      ) : null}
      {!focus && phase !== 'viewer' && phase !== 'choose' && phase !== 'no-free-copy' ? (
        <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-ink bg-sun-pale px-2 py-1 text-ink">
          <button type="button" onClick={() => turn('left')} disabled={!ready} className={PLATE} aria-label="Page back">
            [ ◀ ]
          </button>
          <label className="flex min-w-[10rem] flex-1 items-center gap-2">
            <span className="sr-only">Where you are in the book</span>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(shownFraction * 1000)}
              disabled={!ready}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setDragging(Number(event.target.value) / 1000)}
              onPointerUp={commitDrag}
              onKeyUp={commitDrag}
              onBlur={() => dragging !== null && commitDrag()}
              aria-valuetext={`${percent}%`}
              className="min-w-0 flex-1 max-sm:min-h-tap"
            />
            <span className="w-10 text-right text-key" aria-live="off" data-reader-percent>
              {percent}%
            </span>
          </label>
          <button type="button" onClick={() => turn('right')} disabled={!ready} className={PLATE} aria-label="Page forward">
            [ ▶ ]
          </button>
          <p className="flex w-full min-w-0 flex-wrap justify-between gap-x-2 text-label text-ink-quiet">
            <span className="min-w-0 truncate">{location.chapter.toUpperCase()}</span>
            <span data-reader-left>{location.timeLeft}</span>
          </p>
        </footer>
      ) : null}
    </div>
  );
}
