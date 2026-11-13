'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { cleanWork, matchLine, searchWorks, workKey, NOT_LISTED, type WorkMatch } from '../../lib/books/copies';
import { HOW_LINE, identify, matchFile, nameWords, workCover, type FileIdentity, type MatchHow, type ReadableBook } from '../../lib/books/own-files';
import { keepFile, keptFileOf, rematchKept } from '../../lib/books/own-library';
import { loadEngine, metadataText, openBook } from '../../lib/books/reader-engine';
import { fingerprint, progressText, whenText } from '../../lib/books/reading-places';
import { getBooksRepository } from '../../lib/books/repository';
import { ownRef, type BookPlace } from '../../lib/books/types';
import { FIELD_TIGHT, PLATE, PLATE_LINK, PLATE_MAIN, TITLE_BAR } from '../../lib/ui/controls';

type Me = { id: string } | null;

/** The file types the reader opens. */
export const OWN_ACCEPT = '.pdf,.epub,application/pdf,application/epub+zip';
export const isBookFile = (file: File) => /\.(pdf|epub)$/i.test(file.name) || file.type === 'application/pdf' || file.type === 'application/epub+zip';

/** Per-browser memory: never trusted, never required. */
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
    // A private window or blocked storage: the match still saves to the account.
  }
}

/**
 * [ CHANGE ] for your own file: BOOKS search (Open Library's works), each with [ THIS ONE ], and [ NOT LISTED ] at the foot.
 * Only the words typed go to Open Library.
 */
export function MatchSearch({ start, onChoose }: { start: string; onChoose: (chosen: WorkMatch | 'none') => void }) {
  const [query, setQuery] = useState(start);
  const [results, setResults] = useState<WorkMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setResults(await searchWorks(query));
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-2" data-match-search>
      <form onSubmit={(event) => void submit(event)} className="flex gap-1">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search BOOKS for this file&apos;s book</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} className={FIELD_TIGHT} maxLength={200} />
        </label>
        <button type="submit" className={PLATE} disabled={busy}>
          [ SEARCH BOOKS ]
        </button>
      </form>
      {busy ? (
        <p className="text-label" role="status">
          SEARCHING...
        </p>
      ) : null}
      {results !== null && results.length === 0 && !busy ? <p className="text-label">NO BOOKS FOUND.</p> : null}
      <ul>
        {(results ?? []).map((result) => (
          <li key={result.work} className="rule-pixel flex items-center gap-2 py-1.5" data-work={result.work}>
            <span className="min-w-0 flex-1 break-words text-label">
              {result.title.toUpperCase()}
              {result.author ? ` BY ${result.author.toUpperCase()}` : ''}
            </span>
            <button type="button" onClick={() => onChoose(result)} className={PLATE} aria-label={`THIS ONE: ${result.title}`}>
              [ THIS ONE ]
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => onChoose('none')} className={PLATE}>
        [ NOT LISTED ]
      </button>
    </div>
  );
}

/** What the card found across every copy of the matched book. */
type Copies = {
  editions: number | null;
  /** Your place in another copy of the book, newest. */
  elsewhere: BookPlace | null;
  /** Your highlights made in another copy. */
  yours: number;
  /** Other readers' public highlights, in any copy. */
  theirs: number;
  /** Readers with public highlights in the book (hidden accounts aren't counted). */
  readers: number;
};

type Picked = { file: File; ref: string };
type Status = 'reading' | 'finding' | 'ready' | { fault: string };

/** How many editions Open Library holds of a work, when a match came without the count. */
async function editionsOf(work: string): Promise<number | null> {
  const id = /^books:(OL[1-9][0-9]{0,11}W)$/.exec(work)?.[1];
  if (!id) return null;
  try {
    const response = await fetch(`https://openlibrary.org/works/${id}/editions.json?limit=1`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    const body = response.ok ? ((await response.json()) as { size?: unknown }) : null;
    return typeof body?.size === 'number' && body.size > 0 ? body.size : null;
  } catch {
    return null;
  }
}

/** A matched work's title and author (the site's own book info route), and its cover number (Open Library's work record). */
async function workInfo(work: string): Promise<WorkMatch> {
  const id = /^books:(OL[1-9][0-9]{0,11}W)$/.exec(work)?.[1];
  const [info, record] = await Promise.all([
    fetch(`/api/web/book/info?ref=${encodeURIComponent(work)}`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null),
    id
      ? fetch(`https://openlibrary.org/works/${id}.json`, { credentials: 'omit', referrerPolicy: 'no-referrer' })
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null)
      : null,
  ]);
  const item = (info as { item?: { title?: string; creator?: string } } | null)?.item;
  const covers = (record as { covers?: unknown } | null)?.covers;
  const cover = Array.isArray(covers) ? covers.find((each): each is number => typeof each === 'number' && Number.isInteger(each) && each > 0) ?? null : null;
  return { work, title: item?.title ?? 'THE MATCHED BOOK', author: item?.creator ?? '', cover };
}

/**
 * The READ module's front door (Luke, 2026-11-13): drop a PDF or EPUB (or choose one) and, before it opens, the site says
 * which book it is and what it found across every copy of that book: how many editions, your place in another copy, your
 * highlights from other copies, other readers' public ones. Its highlights and place then count as that book's everywhere
 * (copies.ts). The file stays in this browser: it is fingerprinted and read here, kept in this browser's own storage when
 * KEEP IT ON THIS DEVICE is ticked (own-library.ts), and never sent anywhere.
 */
export default function OwnFileDrop({
  me,
  incoming,
  forWork,
  heading,
  onOpen,
  onKept,
}: {
  me: Me;
  /** A file dropped elsewhere on the page, or chosen from the reader's [ ANOTHER FILE ]. */
  incoming: File | null;
  /** From a book page's READ YOUR OWN COPY: the file is that book, no guessing. */
  forWork: WorkMatch | null;
  /** Instead of the usual heading (CHOOSE YOUR FILE AGAIN...). */
  heading?: string;
  onOpen: (file: File) => void;
  /** A file was kept in this browser (YOUR FILES reads them again). */
  onKept: () => void;
}) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [match, setMatch] = useState<WorkMatch | 'none' | null>(null);
  const [how, setHow] = useState<MatchHow | null>(null);
  const [copies, setCopies] = useState<Copies | null>(null);
  const [kept, setKept] = useState<boolean | null>(null);
  const [keep, setKeep] = useState(true);
  const [over, setOver] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [searchStart, setSearchStart] = useState('');
  const run = useRef(0);
  const meId = me?.id ?? null;

  /** The match, on the account and in this browser, so the reader and another device find it. */
  const saveMatch = useCallback(
    async (ref: string, value: string) => {
      remember(workKey(ref), value);
      if (meId) await getBooksRepository().setWork(meId, ref, value);
    },
    [meId],
  );

  /** What every copy of the work holds for you and others. */
  const countCopies = useCallback(
    async (ref: string, chosen: WorkMatch) => {
      const books = getBooksRepository();
      const [editions, readers, places, highlights] = await Promise.all([
        chosen.editions ?? editionsOf(chosen.work),
        books.readers(chosen.work).catch(() => []),
        meId ? books.placesOfWork(meId, chosen.work).catch(() => []) : Promise.resolve([]),
        meId ? books.acrossCopies(meId, ref, chosen.work).catch(() => []) : Promise.resolve([]),
      ]);
      const elsewhere = places.find((place) => place.bookRef !== ref && (place.progress > 0 || place.cfi !== null || place.finishedAt !== null)) ?? null;
      return {
        editions,
        elsewhere,
        yours: highlights.filter((highlight) => highlight.person === meId && highlight.bookRef !== ref).length,
        theirs: highlights.filter((highlight) => highlight.person !== meId).length,
        readers: readers.length,
      };
    },
    [meId],
  );

  const take = useCallback(
    async (file: File) => {
      const mine = ++run.current;
      const live = () => run.current === mine;
      setChoosing(false);
      setCopies(null);
      setMatch(null);
      setHow(null);
      setKept(null);
      if (!isBookFile(file)) {
        setPicked(null);
        setStatus({ fault: 'A PDF OR AN EPUB, PLEASE.' });
        return;
      }
      setStatus('reading');
      try {
        // Known by a fingerprint of its bytes (SHA-256, worked out here). Only the fingerprint is ever sent.
        const ref = ownRef(await fingerprint(file));
        if (!ref) throw new Error('THIS FILE COULD NOT BE READ.');
        if (!live()) return;
        setPicked({ file, ref });
        setSearchStart(nameWords(file.name));
        setStatus('finding');
        // The account's match first (a failed read isn't "no match": then no guess is saved over it), else this browser's.
        let unread = false;
        const onAccount = meId
          ? await getBooksRepository()
              .place(meId, ref)
              .catch(() => {
                unread = true;
                return null;
              })
          : null;
        const saved = onAccount?.workRef ?? remembered(workKey(ref));
        let found: WorkMatch | 'none' | null = null;
        let foundHow: MatchHow | null = null;
        if (forWork) {
          // The book page's book (its title may still be coming: asked here then).
          found = forWork.title ? { ...forWork, cover: forWork.cover ?? (await workInfo(forWork.work)).cover } : await workInfo(forWork.work);
          foundHow = 'chosen';
          await saveMatch(ref, forWork.work).catch(() => undefined);
        } else if (saved === NOT_LISTED) {
          found = 'none';
          foundHow = 'saved';
        } else if (cleanWork(saved)) {
          // As this browser kept it with the file (YOUR FILES), else asked again.
          const keptMatch = (await keptFileOf(ref))?.match;
          found = keptMatch?.work === saved ? keptMatch : await workInfo(cleanWork(saved) as string);
          foundHow = 'saved';
        } else {
          // Read here, nothing drawn: the ISBN printed inside, the title and author written inside, then the file's name.
          // A file the engine can't read inside is still matched by its name (and can be found by hand).
          let identity: FileIdentity = { isbns: [], title: '', author: '', name: file.name };
          try {
            const engine = await loadEngine();
            const book = (await openBook(file, engine.makeBook)) as ReadableBook & { destroy?: () => void };
            identity = await identify(book, file.name, metadataText);
            try {
              book.destroy?.();
            } catch {
              // Already closed.
            }
          } catch {
            // Read by its name only.
          }
          if (identity.title) setSearchStart(identity.title);
          const result = await matchFile(identity);
          if (result) {
            found = result.match;
            foundHow = result.how;
            if (!unread) await saveMatch(ref, result.match.work).catch(() => undefined);
          }
        }
        if (!live()) return;
        // Kept before the card offers [ CHANGE ], so a change made at once reaches the kept copy too.
        const done = keep ? await keepFile(ref, file, found && found !== 'none' ? found : null) : null;
        if (!live()) return;
        setMatch(found);
        setHow(foundHow);
        setStatus('ready');
        setKept(done);
        if (done) onKept();
        if (found && found !== 'none') {
          const counted = await countCopies(ref, found);
          if (live()) setCopies(counted);
        }
      } catch (error) {
        if (live()) setStatus({ fault: error instanceof Error && /^[A-Z0-9 .,'!?:-]+$/.test(error.message) ? error.message : 'THIS FILE COULD NOT BE READ.' });
      }
    },
    [countCopies, forWork, keep, meId, onKept, saveMatch],
  );

  const handled = useRef<File | null>(null);
  useEffect(() => {
    // A file handed in from elsewhere on the page: read once (not again when signing in or KEEP changes).
    if (!incoming || handled.current === incoming) return;
    handled.current = incoming;
    // Not cancelled on a re-run: the file is marked handled, so a cancelled read would never happen (take() drops stale runs).
    queueMicrotask(() => void take(incoming));
  }, [incoming, take]);

  const choose = async (chosen: WorkMatch | 'none') => {
    if (!picked) return;
    setChoosing(false);
    setCopies(null);
    try {
      await saveMatch(picked.ref, chosen === 'none' ? NOT_LISTED : chosen.work);
    } catch {
      setStatus({ fault: 'THE MATCH COULD NOT BE SAVED.' });
      return;
    }
    await rematchKept(picked.ref, chosen === 'none' ? null : chosen);
    onKept();
    setMatch(chosen);
    setHow(chosen === 'none' ? 'saved' : 'chosen');
    setStatus('ready');
    if (chosen !== 'none') setCopies(await countCopies(picked.ref, chosen));
  };

  const fromInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (file) void take(file);
  };
  const fromDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void take(file);
  };
  const reset = () => {
    run.current += 1;
    setPicked(null);
    setStatus(null);
    setMatch(null);
    setCopies(null);
    setChoosing(false);
  };

  const picker = (label: string, className: string) => (
    <label className={`${className} cursor-pointer`}>
      {label}
      <input type="file" accept={OWN_ACCEPT} onChange={fromInput} className="sr-only" data-own-input />
    </label>
  );

  const fault = typeof status === 'object' && status !== null ? status.fault : null;
  const cover = match && match !== 'none' ? workCover(match.cover) : null;

  if (!picked || fault) {
    return (
      <section
        aria-labelledby="own-file"
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={fromDrop}
        className={`flex flex-col items-center gap-2 border-line border-dashed border-ink p-4 text-center ${over ? 'bg-bubble-pale' : 'bg-paper'}`}
        data-own-drop
      >
        <h2 id="own-file" className={TITLE_BAR}>
          {heading ?? (forWork ? `YOUR OWN COPY OF ${(forWork.title || 'THIS BOOK').toUpperCase()}` : 'OPEN YOUR OWN PDF OR EPUB')}
        </h2>
        {/* The words swap; the box keeps its size (a reveal never moves what you're pointing at). */}
        <p className="text-key">{over ? 'LET GO TO OPEN IT' : 'DROP IT HERE, OR'}</p>
        {picker('[ CHOOSE A FILE ]', PLATE_MAIN)}
        {status === 'reading' ? (
          <p className="text-label" role="status">
            READING YOUR FILE...
          </p>
        ) : null}
        {fault ? (
          <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar" role="alert">
            {fault}
          </p>
        ) : null}
        <p className="max-w-xl text-label">
          {forWork
            ? 'IT WILL COUNT AS THIS BOOK: YOUR PLACE AND HIGHLIGHTS JOIN EVERY OTHER COPY OF IT.'
            : 'THE SITE WORKS OUT WHICH BOOK IT IS, SO YOUR PLACE AND HIGHLIGHTS COUNT IN EVERY COPY AND EDITION OF THAT BOOK.'}{' '}
          IT STAYS ON YOUR DEVICE: ONLY ITS FINGERPRINT, ITS BOOK AND YOUR PLACE ARE SAVED.
        </p>
        <label className="flex items-center gap-1 text-label">
          <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} data-own-keep />
          KEEP IT ON THIS DEVICE, SO IT STAYS ON YOUR SHELF
        </label>
      </section>
    );
  }

  return (
    <section aria-labelledby="own-card" className="frame flex flex-col gap-2 bg-paper p-3" data-own-card={picked.ref}>
      <h2 id="own-card" className={TITLE_BAR}>
        YOUR FILE
      </h2>
      <div className="flex gap-3">
        <div className="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden border border-ink bg-sun-pale text-center text-label text-ink-quiet">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- a hotlinked Open Library cover, as every cover on the site is
            <img src={cover} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            'YOUR FILE'
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {status === 'finding' ? (
            <p className="text-key" role="status">
              FINDING WHICH BOOK THIS IS...
            </p>
          ) : (
            <>
              <p className="break-words text-key text-accent-ink" data-match-line>
                {match === 'none' ? 'NOT LISTED: KEPT AS YOUR OWN FILE.' : match ? matchLine(match) : 'NO BOOK FOUND FOR THIS FILE.'}
              </p>
              {how && match ? (
                <p className="text-label text-ink-quiet" data-match-how={how}>
                  {HOW_LINE[how]}
                </p>
              ) : null}
              {!match ? <p className="text-label">FIND IT BELOW, AND ITS HIGHLIGHTS AND PLACE COUNT AS THAT BOOK&apos;S. OR READ IT AS IT IS.</p> : null}
            </>
          )}
          {match && match !== 'none' ? (
            <ul className="text-label" data-copies>
              {copies === null ? (
                <li role="status">LOOKING THROUGH EVERY COPY OF THIS BOOK...</li>
              ) : (
                <>
                  {copies.editions ? (
                    <li data-editions={copies.editions}>
                      {copies.editions === 1 ? '1 EDITION' : `${copies.editions} EDITIONS`} OF THIS BOOK: YOUR HIGHLIGHTS AND PLACE COUNT IN EVERY ONE.
                    </li>
                  ) : null}
                  {copies.elsewhere ? (
                    <li data-elsewhere>
                      {copies.elsewhere.finishedAt ? 'YOU FINISHED IT IN ANOTHER COPY' : `YOU'RE ${progressText(copies.elsewhere)} THROUGH IN ANOTHER COPY`}
                      {copies.elsewhere.updatedAt ? ` · LAST READ ${whenText(copies.elsewhere.updatedAt)}` : ''}: IT OPENS THERE.
                    </li>
                  ) : null}
                  {copies.yours > 0 ? (
                    <li data-yours={copies.yours}>
                      {copies.yours === 1 ? '1 OF YOUR HIGHLIGHTS' : `${copies.yours} OF YOUR HIGHLIGHTS`} FROM OTHER COPIES SHOW HERE.
                    </li>
                  ) : null}
                  {copies.theirs > 0 ? (
                    <li data-theirs={copies.theirs}>
                      {copies.theirs === 1 ? '1 PUBLIC HIGHLIGHT' : `${copies.theirs} PUBLIC HIGHLIGHTS`} BY OTHER READERS
                      {copies.readers > 0 ? ` (${copies.readers === 1 ? '1 READER' : `${copies.readers} READERS`})` : ''}.
                    </li>
                  ) : null}
                  {!me ? <li>SIGN IN TO KEEP HIGHLIGHTS AND FIND YOUR PLACE ON ANOTHER DEVICE.</li> : null}
                </>
              )}
            </ul>
          ) : null}
          {kept !== null ? (
            <p className="text-label text-ink-quiet" data-kept={kept ? 'yes' : 'no'}>
              {kept ? 'KEPT ON THIS DEVICE: IT STAYS ON YOUR SHELF.' : 'NOT KEPT ON THIS DEVICE (NO ROOM, OR A PRIVATE WINDOW): CHOOSE IT AGAIN NEXT TIME.'}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => onOpen(picked.file)} className={PLATE_MAIN} disabled={status === 'finding'} data-own-read>
          [ READ ]
        </button>
        <button type="button" onClick={() => setChoosing((open) => !open)} className={PLATE} disabled={status === 'finding'} aria-expanded={choosing}>
          {match && match !== 'none' ? '[ CHANGE ]' : '[ FIND IT ]'}
        </button>
        {match !== 'none' && status !== 'finding' ? (
          <button type="button" onClick={() => void choose('none')} className={PLATE}>
            [ NOT LISTED ]
          </button>
        ) : null}
        {match && match !== 'none' ? (
          <Link href={`/media/book/${match.work}`} className={PLATE_LINK}>
            [ BOOK PAGE ]
          </Link>
        ) : null}
        <button type="button" onClick={reset} className={PLATE}>
          [ ANOTHER FILE ]
        </button>
      </div>
      {choosing ? <MatchSearch start={searchStart} onChoose={(chosen) => void choose(chosen)} /> : null}
    </section>
  );
}
