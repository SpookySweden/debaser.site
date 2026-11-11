'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  bookmarkLabel,
  markTint,
  markToken,
  pageLayout,
  minutesLeft,
  percentOf,
  quoteOf,
  readerCss,
  readerSettingsFrom,
  spotFromSearch,
  DEFAULT_SETTINGS,
  type ReaderSettings,
} from '../../lib/books/reader-look';
import { bookKind, loadEngine, metadataText, openBook, remotePdf, type EngineView, type HighlightDraw, type TocItem } from '../../lib/books/reader-engine';
import { getBooksRepository } from '../../lib/books/repository';
import {
  bookThreadAnchor,
  bookThreadTitle,
  highlightPost,
  archiveViewerUrl,
  isCfi,
  QUOTE_MAX,
  type BookBookmark,
  type BookHighlight,
  type HighlightColour,
} from '../../lib/books/types';
import { PLATE, PLATE_MAIN, PLATE_PRESSED } from '../../lib/ui/controls';
import { useAuth } from '../AuthProvider';
import { useForum } from '../ForumProvider';
import HighlightBar, { type BarSpot } from './HighlightBar';
import { BookmarkList, ContentsList, HighlightList, LookSettings, Panel, SearchBox, type PanelName, type SearchGroup } from './ReaderPanels';

const LOOK_KEY = 'debaser-reader-look';
const NONE_HIGHLIGHTED: BookHighlight[] = [];
const NONE_BOOKMARKED: BookBookmark[] = [];
const placeKey = (bookRef: string) => `debaser-reader-place:${bookRef}`;

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

type Location = { fraction: number; chapter: string; chapterHref: string | null; timeLeft: string; cfi: string | null };
type Picked = { cfi: string; quote: string; spot: BarSpot };
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
 * EPUB (`bookRef` null, at /read): opened in this browser from their device, never sent anywhere, nothing saved about it.
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
  const touchRef = useRef(false);
  const annotationHit = useRef(false);
  const placeTimer = useRef<number | null>(null);
  const meRef = useRef(me);

  const [phase, setPhase] = useState<'choose' | 'reading-file' | 'opening' | 'ready' | 'viewer' | { fault: string }>(own ? 'choose' : 'reading-file');
  // What the engine opened (an EPUB reflows and takes highlights; a PDF has fixed pages), a reader's own file, and a count
  // that opens the book again where it was (a PDF's ONE PAGE / TWO PAGES is decided when it opens).
  const [kind, setKind] = useState<'epub' | 'pdf' | null>(null);
  const [ownFile, setOwnFile] = useState<File | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const resumeRef = useRef<string | null>(null);
  const kindRef = useRef<'epub' | 'pdf' | null>(null);
  const [title, setTitle] = useState('');
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [location, setLocation] = useState<Location>({ fraction: 0, chapter: '', chapterHref: null, timeLeft: '', cfi: null });
  const [dragging, setDragging] = useState<number | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [panel, setPanel] = useState<PanelName | null>(null);
  const [focus, setFocus] = useState(false);
  const [ownHighlights, setHighlights] = useState<BookHighlight[]>([]);
  const [ownBookmarks, setBookmarks] = useState<BookBookmark[]>([]);
  // Signed out, there are none to show (what was read for an account stays with it).
  const mine = me ? ownHighlights : NONE_HIGHLIGHTED;
  const highlights = mine;
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
    if (own) return;
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

  useEffect(() => {
    if (!me || own) return;
    let live = true;
    void getBooksRepository()
      .mine(me.id, bookRef)
      .then((found) => live && setHighlights(found))
      .catch(() => undefined);
    void getBooksRepository()
      .bookmarks(me.id, bookRef)
      .then((found) => live && setBookmarks(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [me, bookRef, own]);

  // Every highlight with a place drawn on whatever chapters are on screen (the engine draws only those it holds).
  const drawAll = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    for (const highlight of highlightsRef.current) {
      if (highlight.cfi) void view.addAnnotation({ value: highlight.cfi, color: tokenValue(markToken(highlight.colour)) }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (phase === 'ready') drawAll();
  }, [highlights, phase, drawAll]);

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

  const turn = useCallback((direction: 'left' | 'right') => {
    const view = viewRef.current;
    if (!view) return;
    closeBars();
    void (direction === 'left' ? view.goLeft() : view.goRight());
  }, [closeBars]);

  /**
   * A tap at this point on the screen: the outer thirds of the reading area turn the page. Taps on the page itself come
   * from the chapter's frame; taps beside it (a phone shows the site 1280px wide and shrunk, so one page sits in the
   * middle with margins round it) come from the stage.
   */
  const tapAt = useCallback(
    (clientX: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const box = stage.getBoundingClientRect();
      const x = clientX - box.left;
      if (x < box.width / 3) turn('left');
      else if (x > (box.width * 2) / 3) turn('right');
    },
    [turn],
  );

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

  useEffect(() => {
    let live = true;
    let view: EngineView | null = null;
    const host = hostRef.current;
    (async () => {
      try {
        let file: Blob;
        if (own) {
          // A reader's own file: opened here, from their device, never sent anywhere.
          if (!ownFile) {
            setPhase('choose');
            return;
          }
          file = ownFile;
          setTitle(ownFile.name.replace(/\.(pdf|epub)$/i, ''));
        } else {
          const response = await fetch(`/api/web/book/epub?ref=${encodeURIComponent(bookRef)}`, { cache: 'no-store' });
          const json = (response.headers.get('content-type') ?? '').startsWith('application/json');
          const said = json ? ((await response.json().catch(() => ({}))) as { error?: string; viewer?: boolean; pdf?: { size?: number } }) : null;
          // An Internet Archive book with neither an EPUB nor a PDF: the Archive's own viewer, on this page (Luke, 2026-11-11).
          if (said?.viewer === true && archiveViewerUrl(bookRef) !== null) {
            if (live) setPhase('viewer');
            return;
          }
          if (!response.ok) throw new Error(said?.error ?? 'THIS BOOK CAN\'T BE READ HERE.');
          // One with only a PDF: read a slice at a time through the site's route, never kept.
          if (said?.pdf && typeof said.pdf.size === 'number' && said.pdf.size > 0) file = remotePdf(bookRef, said.pdf.size);
          else if (said) throw new Error(said.error ?? 'THIS BOOK CAN\'T BE READ HERE.');
          else file = await response.blob();
        }
        if (!live) return;
        setPhase('opening');
        const engine = await loadEngine();
        drawRef.current = engine.highlight;
        const book = await openBook(file, engine.makeBook);
        const opened = bookKind(book);
        kindRef.current = opened;
        setKind(opened);
        // A PDF shows one page at a time when ONE PAGE is chosen (its spread is set as it opens).
        if (opened === 'pdf' && settingsRef.current.pages === 'one') {
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
          doc.addEventListener('pointerdown', (pointer) => {
            touchRef.current = pointer.pointerType === 'touch' || pointer.pointerType === 'pen';
          });
          let timer: number | null = null;
          doc.addEventListener('selectionchange', () => {
            // Highlights are an EPUB's, in a book the site knows: none on a PDF's fixed pages or in a reader's own file.
            if (kindRef.current !== 'epub' || own) return;
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
              const selection = doc.getSelection();
              if (!selection || selection.isCollapsed || selection.rangeCount === 0) return setPicked((held) => (held ? null : held));
              const range = selection.getRangeAt(0);
              const quote = quoteOf(range.toString(), QUOTE_MAX);
              const spot = spotOf(doc, range);
              const current = viewRef.current;
              if (!quote || !spot || !current) return;
              const cfi = current.getCFI(indexOf.current.get(doc) ?? index, range);
              if (!isCfi(cfi)) return;
              setShown(null);
              setPicked({ cfi, quote, spot });
            }, 280);
          });
          // A tap on the page's outer thirds turns it (a touch, not a mouse: a click on a desktop is for choosing words).
          doc.addEventListener('click', (click) => {
            window.setTimeout(() => {
              if (annotationHit.current) {
                annotationHit.current = false;
                return;
              }
              if (!touchRef.current) return;
              const selection = doc.getSelection();
              if (selection && !selection.isCollapsed) return;
              if ((click.target as Element | null)?.closest?.('a[href]')) return;
              const frame = doc.defaultView?.frameElement;
              if (frame) tapAt(frame.getBoundingClientRect().left + click.clientX);
            }, 0);
          });
        });
        view.addEventListener('relocate', (event) => {
          const detail = (event as CustomEvent<{ fraction?: number; tocItem?: { label?: string; href?: string }; time?: { section?: number }; cfi?: string }>).detail;
          const cfi = isCfi(detail.cfi) ? detail.cfi : null;
          setLocation({ fraction: detail.fraction ?? 0, chapter: (detail.tocItem?.label ?? '').trim(), chapterHref: detail.tocItem?.href ?? null, timeLeft: minutesLeft(detail.time?.section), cfi });
          if (!cfi || own) return;
          if (placeTimer.current !== null) window.clearTimeout(placeTimer.current);
          placeTimer.current = window.setTimeout(() => {
            remember(placeKey(bookRef), cfi);
            const person = meRef.current;
            if (person) void getBooksRepository().savePlace(person.id, bookRef, cfi).catch(() => undefined);
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
          if (highlight && spot) {
            setPicked(null);
            setShown({ highlight, spot });
          }
        });

        await view.open(book);
        if (!live) return;
        applyLook(settingsRef.current);
        setToc(book.toc ?? []);
        setTitle((held) => held || metadataText(book.metadata?.title));

        // Where to open: back where it was (opened again for ONE PAGE / TWO PAGES), a highlight (`?h=`), a spot (`?at=`),
        // or where this reader left off. A reader's own file starts at its start.
        const spot = own ? { cfi: null, highlight: null } : spotFromSearch(asked);
        let start: string | null = resumeRef.current ?? spot.cfi;
        resumeRef.current = null;
        if (own) start = start ?? null;
        else if (!start && spot.highlight) {
          const highlight = await getBooksRepository().get(spot.highlight).catch(() => null);
          if (highlight?.bookRef === bookRef && highlight.cfi) start = highlight.cfi;
        }
        if (!start && !own && meRef.current) start = await getBooksRepository().place(meRef.current.id, bookRef).catch(() => null);
        if (!start && !own) {
          const local = remembered(placeKey(bookRef));
          start = isCfi(local) ? local : null;
        }
        await view.init({ lastLocation: start, showTextStart: start === null });
        if (live) setPhase('ready');
      } catch (error) {
        if (live) setPhase({ fault: error instanceof Error && /^[A-Z0-9 .,'!?-]+$/.test(error.message) ? error.message : 'THIS BOOK COULD NOT BE OPENED.' });
      }
    })();
    return () => {
      live = false;
      if (placeTimer.current !== null) window.clearTimeout(placeTimer.current);
      view?.close();
      view?.remove();
      viewRef.current = null;
    };
    // Opened once per book (or own file), and again for a PDF's ONE PAGE / TWO PAGES.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookRef, ownFile, openCount]);

  // ---------- highlights ----------

  /** An unlocked highlight's post in the reader's own thread for the book, made the first time it's needed. */
  const post = async (highlight: BookHighlight): Promise<string | null> => {
    if (!me) return null;
    const name = title || 'A BOOK';
    const anchor = bookThreadAnchor(me.id, bookRef, name);
    const thread = forum.threadForAnchor(anchor) ?? (await forum.createThread({ title: bookThreadTitle(me.displayName, name), body: '', anchor }));
    const result = await forum.addComment({ threadId: thread.id, body: highlightPost(highlight) });
    return result.comment.id;
  };

  const save = async (colour: HighlightColour, comment: string, locked: boolean) => {
    if (!me || !picked) return;
    setFault(null);
    const chosen = picked;
    closeBars();
    viewRef.current?.deselect();
    try {
      let highlight = await getBooksRepository().add(me.id, { bookRef, bookTitle: title || 'A BOOK', cfi: chosen.cfi, quote: chosen.quote, comment: comment.trim(), colour, isLocked: locked });
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
    setFault(null);
    setPanel(null);
    setToc([]);
    setOwnFile(chosen);
  };
  const ownPicker = (label: string, className: string) => (
    <label className={`${className} cursor-pointer`}>
      {label}
      <input type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" onChange={chooseOwn} className="sr-only" />
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
    if (dragging !== null) void viewRef.current?.goToFraction(dragging);
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
            {title ? title.toUpperCase() : own ? 'YOUR OWN BOOK' : 'BOOK'}
          </h1>
          <nav aria-label="The reader's keys" className="flex flex-wrap items-center gap-1">
            {/* The Archive's viewer has its own contents and search: only FOCUS is ours there. Bookmarks and highlights belong
                to a book the site knows (not a reader's own file), and highlights to an EPUB (not a PDF's fixed pages). */}
            {phase !== 'viewer' && phase !== 'choose' ? (
              <>
                {topKey('contents', 'CONTENTS')}
                {topKey('search', 'SEARCH')}
                {own ? null : topKey('bookmarks', `BOOKMARKS${bookmarks.length ? ` ${bookmarks.length}` : ''}`)}
                {own || kind === 'pdf' ? null : topKey('highlights', `HIGHLIGHTS${highlights.length ? ` ${highlights.length}` : ''}`)}
                {topKey('look', 'LOOK')}
              </>
            ) : null}
            {own && phase !== 'choose' ? ownPicker('[ ANOTHER FILE ]', PLATE) : null}
            <button type="button" onClick={() => setFocus(true)} className={PLATE}>
              [ FOCUS ]
            </button>
          </nav>
        </header>
      ) : null}

      <div ref={stageRef} className={`relative min-h-0 flex-1 overflow-hidden ${PAPER_CLASS[settings.paper]}`}>
        <div
          ref={hostRef}
          className="absolute inset-0"
          aria-label="The book"
          role="document"
          onPointerDown={(event) => {
            touchRef.current = event.pointerType === 'touch' || event.pointerType === 'pen';
          }}
          onClick={(event) => touchRef.current && tapAt(event.clientX)}
        />

        {phase === 'choose' ? (
          <div className="absolute inset-x-0 top-1/4 flex flex-col items-center gap-3 p-4 text-center">
            {ownPicker('CHOOSE A PDF OR EPUB', PLATE_MAIN)}
            <p className="text-label">IT OPENS HERE AND STAYS ON YOUR DEVICE.</p>
          </div>
        ) : null}
        {phase === 'reading-file' || phase === 'opening' ? (
          <p className="absolute inset-x-0 top-1/3 text-center text-label" role="status">
            {phase === 'reading-file' ? `READING THE BOOK FROM ${archiveViewerUrl(bookRef) ? 'THE INTERNET ARCHIVE' : 'PROJECT GUTENBERG'}...` : 'OPENING THE BOOK...'}
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
        {typeof phase === 'object' ? (
          <div className="absolute inset-x-0 top-1/3 flex flex-col items-center gap-2 p-4">
            <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{phase.fault}</p>
            <button type="button" onClick={back} className={PLATE}>
              [ ◀ BACK ]
            </button>
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
              highlights={highlights}
              onGo={(highlight) => highlight.cfi && go(highlight.cfi)}
              onLock={(highlight) => void flipLock(highlight)}
              onRemove={(highlight) => void remove(highlight)}
            />
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
      {!focus && phase !== 'viewer' ? (
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
            <span className="w-10 text-right text-key" aria-live="off">
              {percent}%
            </span>
          </label>
          <button type="button" onClick={() => turn('right')} disabled={!ready} className={PLATE} aria-label="Page forward">
            [ ▶ ]
          </button>
          <p className="flex w-full min-w-0 flex-wrap justify-between gap-x-2 text-label text-ink-quiet">
            <span className="min-w-0 truncate">{location.chapter.toUpperCase()}</span>
            <span>{location.timeLeft}</span>
          </p>
        </footer>
      ) : null}
    </div>
  );
}
