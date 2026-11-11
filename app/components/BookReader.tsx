'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { pageOf, pageStarts, paragraphsOf } from '../lib/books/pages';
import { closeReader, openReader, readerFromSearch, readerState, subscribeToReader } from '../lib/books/reader-window';
import { getBooksRepository } from '../lib/books/repository';
import { bookThreadAnchor, bookThreadTitle, COMMENT_MAX, highlightPost, highlightRef, QUOTE_MAX, type BookHighlight } from '../lib/books/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED } from '../lib/ui/controls';
import AddToLetterKey from './AddToLetterKey';
import { useAuth } from './AuthProvider';
import DockWindow from './DockWindow';
import { useForum } from './ForumProvider';

type Picked = { place: number; startAt: number; endAt: number; quote: string };

/**
 * The site's reader (SPEC-books.md, Luke 2026-11-10): a Project Gutenberg book's text, passed through /api/web/book/text and
 * never kept, as one column of plain text in pages, turned with the keys or the arrow keys. Signed in, it remembers the
 * page, and words picked with the pointer can be highlighted, with a comment and a lock: an unlocked highlight is also a
 * post in the reader's own thread for the book ("[NAME] READING [BOOK]"). Drawn once in `layout.tsx`; `?read=<ref>` opens it.
 */
export default function BookReader() {
  const state = useSyncExternalStore(subscribeToReader, readerState, readerState);
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const asked = search.toString();

  useEffect(() => {
    const named = readerFromSearch(asked);
    if (named !== null) openReader(named.bookRef, readerState().title || 'BOOK', named.at);
  }, [asked]);

  const close = useCallback(() => {
    closeReader();
    if (readerFromSearch(asked) !== null) router.replace(pathname);
  }, [asked, pathname, router]);

  if (!state.open || state.bookRef === null) return null;
  return <ReaderBody key={state.bookRef} bookRef={state.bookRef} title={state.title} at={state.at} onClose={close} />;
}

function ReaderBody({ bookRef, title, at, onClose }: { bookRef: string; title: string; at: number | null; onClose: () => void }) {
  const { user, status } = useAuth();
  const me = user !== null && status === 'signed-in' ? user : null;
  const forum = useForum();
  const [text, setText] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [bookTitle, setBookTitle] = useState(title);
  const [highlights, setHighlights] = useState<BookHighlight[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [writing, setWriting] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);

  // The text, read once per opening, never kept by the site (the route answers `private, no-store`).
  useEffect(() => {
    let live = true;
    fetch(`/api/web/book/text?ref=${encodeURIComponent(bookRef)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? 'THIS BOOK CAN\'T BE READ HERE.');
        return response.text();
      })
      .then((body) => live && setText(body))
      .catch((error: unknown) => live && setFault(error instanceof Error ? error.message : 'THIS BOOK CAN\'T BE READ HERE.'));
    if (!title || title === 'BOOK') {
      fetch(`/api/web/book/info?ref=${encodeURIComponent(bookRef)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { item?: { title?: string } } | null) => live && body?.item?.title && setBookTitle(body.item.title))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [bookRef, title]);

  const paragraphs = useMemo(() => (text === null ? [] : paragraphsOf(text)), [text]);
  const starts = useMemo(() => pageStarts(paragraphs), [paragraphs]);

  // Where to start: the paragraph the address names, or where this reader left off.
  useEffect(() => {
    if (paragraphs.length === 0) return;
    let live = true;
    const go = (paragraph: number) => live && setPage(pageOf(starts, Math.min(paragraph, paragraphs.length - 1)));
    if (at !== null) go(at);
    else if (me) void getBooksRepository().place(me.id, bookRef).then((place) => place !== null && go(place));
    return () => {
      live = false;
    };
  }, [paragraphs.length, starts, at, me, bookRef]);

  useEffect(() => {
    if (!me) return;
    void getBooksRepository()
      .mine(me.id, bookRef)
      .then(setHighlights)
      .catch(() => undefined);
  }, [me, bookRef]);

  const turn = (to: number) => {
    const next = Math.max(0, Math.min(starts.length - 1, to));
    setPage(next);
    setPicked(null);
    setWriting(false);
    pageRef.current?.scrollTo({ top: 0 });
    if (me) void getBooksRepository().savePlace(me.id, bookRef, starts[next] ?? 0);
  };

  const first = starts[page] ?? 0;
  const last = (starts[page + 1] ?? paragraphs.length) - 1;

  /** The words picked with the pointer, within one paragraph (a pick across two keeps the first's part). */
  const notePick = () => {
    if (!me) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return setPicked(null);
    const range = selection.getRangeAt(0);
    const start = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest('[data-para]');
    if (!start || !pageRef.current?.contains(start)) return setPicked(null);
    const place = Number(start.getAttribute('data-para'));
    const before = document.createRange();
    before.setStart(start, 0);
    before.setEnd(range.startContainer, range.startOffset);
    const startAt = before.toString().length;
    const whole = paragraphs[place] ?? '';
    const endInside = start.contains(range.endContainer);
    let endAt = whole.length;
    if (endInside) {
      const upTo = document.createRange();
      upTo.setStart(start, 0);
      upTo.setEnd(range.endContainer, range.endOffset);
      endAt = upTo.toString().length;
    }
    const quote = whole.slice(startAt, endAt).trim().slice(0, QUOTE_MAX);
    setPicked(quote.length > 0 ? { place, startAt, endAt: Math.min(endAt, startAt + QUOTE_MAX), quote } : null);
  };

  /** An unlocked highlight's post in the reader's own thread for the book, made the first time it's needed. */
  const post = async (highlight: BookHighlight): Promise<string | null> => {
    if (!me) return null;
    const anchor = bookThreadAnchor(me.id, bookRef, bookTitle);
    const thread = forum.threadForAnchor(anchor) ?? (await forum.createThread({ title: bookThreadTitle(me.displayName, bookTitle), body: '', anchor }));
    const result = await forum.addComment({ threadId: thread.id, body: highlightPost(highlight) });
    return result.comment.id;
  };

  const save = async (comment: string, locked: boolean) => {
    if (!me || !picked) return;
    setFault(null);
    try {
      let highlight = await getBooksRepository().add(me.id, { bookRef, bookTitle, ...picked, comment: comment.trim(), isLocked: locked });
      if (!locked) {
        const forumCommentId = await post(highlight).catch(() => null);
        if (forumCommentId) {
          await getBooksRepository().update(highlight.id, { forumCommentId });
          highlight = { ...highlight, forumCommentId };
        }
      }
      setHighlights((held) => [...held, highlight].sort((a, b) => a.place - b.place || a.startAt - b.startAt));
      setPicked(null);
      setWriting(false);
      window.getSelection()?.removeAllRanges();
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
      setHighlights((held) => held.map((each) => (each.id === highlight.id ? { ...each, isLocked: locking, forumCommentId } : each)));
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The highlight could not be saved.');
    }
  };

  const remove = async (highlight: BookHighlight) => {
    if (!window.confirm('Delete this highlight? Its forum post goes too.')) return;
    try {
      if (highlight.forumCommentId) await forum.deleteComment(highlight.forumCommentId).catch(() => undefined);
      await getBooksRepository().remove(highlight.id);
      setHighlights((held) => held.filter((each) => each.id !== highlight.id));
    } catch (error) {
      setFault(error instanceof Error ? error.message : 'The highlight could not be deleted.');
    }
  };

  const keys = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowRight') turn(page + 1);
    if (event.key === 'ArrowLeft') turn(page - 1);
  };

  return (
    <DockWindow id="reader" title="READER" badge={starts.length > 1 ? `${page + 1} / ${starts.length}` : undefined} onClose={onClose} defaultSize={{ w: 620, h: 640 }} minSize={{ w: 300, h: 320 }}>
      <div className="flex h-full flex-col bg-sun-pale" onKeyDown={keys}>
        <header className="flex flex-wrap items-center gap-2 border-b border-ink p-2">
          <h2 className="min-w-0 flex-1 break-words text-key text-ink">{bookTitle}</h2>
          {me ? (
            <button type="button" onClick={() => setListOpen((open) => !open)} aria-expanded={listOpen} className={listOpen ? PLATE_PRESSED : PLATE}>
              [ HIGHLIGHTS ({highlights.length}) ]
            </button>
          ) : null}
        </header>

        {listOpen && me ? (
          <HighlightList highlights={highlights} onGo={(place) => turn(pageOf(starts, place))} onLock={(each) => void flipLock(each)} onRemove={(each) => void remove(each)} />
        ) : null}

        <div ref={pageRef} tabIndex={0} aria-label="The book's page" onMouseUp={notePick} onTouchEnd={notePick} className="min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-ink">
          {fault ? <p className="text-label text-ink">{fault}</p> : null}
          {text === null && !fault ? <p className="text-label text-ink">READING THE BOOK FROM PROJECT GUTENBERG...</p> : null}
          {paragraphs.slice(first, last + 1).map((paragraph, offset) => (
            <Paragraph key={first + offset} index={first + offset} words={paragraph} marks={highlights.filter((each) => each.place === first + offset)} />
          ))}
        </div>

        {/* The pick's keys: their own line, kept whether or not anything is picked, so the page never jumps. */}
        <div className="min-h-12 border-t border-ink p-2">
          {!me ? <p className="text-label text-ink-quiet">SIGN IN TO HIGHLIGHT AND KEEP YOUR PLACE.</p> : null}
          {me && !picked ? <p className="text-label text-ink-quiet">PICK SOME WORDS TO HIGHLIGHT THEM.</p> : null}
          {me && picked && !writing ? (
            <p className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-label text-ink">&quot;{picked.quote}&quot;</span>
              <button type="button" onClick={() => setWriting(true)} className={PLATE_MAIN}>
                HIGHLIGHT
              </button>
            </p>
          ) : null}
          {me && picked && writing ? <HighlightForm quote={picked.quote} onSave={(comment, locked) => void save(comment, locked)} onCancel={() => setWriting(false)} /> : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-ink p-2">
          <button type="button" onClick={() => turn(page - 1)} disabled={page === 0} className={PLATE}>
            [ ◀ PAGE ]
          </button>
          <span className="text-label text-ink">
            {starts.length > 0 && text !== null ? `PAGE ${page + 1} OF ${starts.length}` : ''}
          </span>
          <button type="button" onClick={() => turn(page + 1)} disabled={page >= starts.length - 1} className={PLATE}>
            [ PAGE ▶ ]
          </button>
        </footer>
      </div>
    </DockWindow>
  );
}

/** One paragraph, with this reader's highlights in it marked. Plain text only: nothing from the book is drawn as markup. */
function Paragraph({ index, words, marks }: { index: number; words: string; marks: readonly BookHighlight[] }) {
  const pieces: { text: string; marked: boolean }[] = [];
  let at = 0;
  for (const mark of [...marks].sort((a, b) => a.startAt - b.startAt)) {
    const start = Math.max(mark.startAt, at);
    const end = Math.min(mark.endAt, words.length);
    if (end <= start) continue;
    if (start > at) pieces.push({ text: words.slice(at, start), marked: false });
    pieces.push({ text: words.slice(start, end), marked: true });
    at = end;
  }
  if (at < words.length) pieces.push({ text: words.slice(at), marked: false });
  return (
    <p data-para={index} className="mb-3 text-prose leading-relaxed text-ink">
      {pieces.map((piece, n) => (piece.marked ? <span key={n} className="bg-sun text-ink-plate">{piece.text}</span> : <span key={n}>{piece.text}</span>))}
    </p>
  );
}

function HighlightForm({ quote, onSave, onCancel }: { quote: string; onSave: (comment: string, locked: boolean) => void; onCancel: () => void }) {
  const [comment, setComment] = useState('');
  const [locked, setLocked] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <p className="break-words text-label text-ink">&quot;{quote}&quot;</p>
      <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={COMMENT_MAX} rows={2} placeholder="A COMMENT (OPTIONAL)" aria-label="Your comment" className={FIELD_TIGHT} />
      <label className="flex items-center gap-2 text-label text-ink">
        <input type="checkbox" checked={locked} onChange={(event) => setLocked(event.target.checked)} />
        🔒 KEEP IT TO MYSELF (UNLOCKED, IT&apos;S POSTED IN YOUR THREAD FOR THIS BOOK)
      </label>
      <p className="flex gap-2">
        <button type="button" onClick={() => onSave(comment, locked)} className={PLATE_MAIN}>
          SAVE
        </button>
        <button type="button" onClick={onCancel} className={PLATE}>
          [ CANCEL ]
        </button>
      </p>
    </div>
  );
}

function HighlightList({
  highlights,
  onGo,
  onLock,
  onRemove,
}: {
  highlights: readonly BookHighlight[];
  onGo: (place: number) => void;
  onLock: (highlight: BookHighlight) => void;
  onRemove: (highlight: BookHighlight) => void;
}) {
  return (
    <ul className="max-h-60 overflow-y-auto border-b border-ink p-2">
      {highlights.length === 0 ? <li className="text-label text-ink">NO HIGHLIGHTS IN THIS BOOK YET.</li> : null}
      {highlights.map((highlight) => (
        <li key={highlight.id} className="rule-pixel py-1">
          <p className="break-words text-label text-ink">&quot;{highlight.quote}&quot;</p>
          {highlight.comment ? <p className="break-words text-label text-ink-quiet">{highlight.comment}</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-1">
            <time className="text-label text-ink-quiet" dateTime={highlight.createdAt}>
              {highlight.createdAt.slice(0, 16).replace('T', ' ')}
            </time>
            <button type="button" onClick={() => onGo(highlight.place)} className={PLATE}>
              [ GO TO ]
            </button>
            <button type="button" onClick={() => onLock(highlight)} aria-pressed={highlight.isLocked} className={PLATE}>
              {highlight.isLocked ? '[ 🔒 PRIVATE ]' : '[ 🔓 POSTED ]'}
            </button>
            <button type="button" onClick={() => onRemove(highlight)} className={PLATE}>
              [ DELETE ]
            </button>
            <AddToLetterKey thing={{ kind: 'highlight', ref: highlightRef(highlight), title: highlight.quote.slice(0, 120) }} />
          </p>
        </li>
      ))}
    </ul>
  );
}
