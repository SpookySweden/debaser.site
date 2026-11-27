'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { cleanWork, ipfsWork, type WorkMatch } from '../../lib/books/copies';
import { ipfsCid } from '../../lib/books/ipfs';
import { sizeText, workCover } from '../../lib/books/own-files';
import { asFile, forgetFile, keptFileOf, keptFiles, type KeptRow } from '../../lib/books/own-library';
import { getBooksRepository } from '../../lib/books/repository';
import { browserPlaces, continueHref, coverOf, finishedWhen, placeKey, progressText, shelves, storedPlace, whenText } from '../../lib/books/reading-places';
import { ownHash, type BookPlace } from '../../lib/books/types';
import { PLATE, PLATE_LINK, TITLE_BAR } from '../../lib/ui/controls';
import { explain } from '../../lib/ui/explain';
import OwnFileDrop, { isBookFile } from './OwnFileDrop';

type Me = { id: string } | null;

/** This browser's places (a visitor's shelf), or none where storage is blocked. */
function placesHere(): BookPlace[] {
  try {
    return browserPlaces(window.localStorage);
  } catch {
    return [];
  }
}

/** A row's cover: the book's own, hotlinked; your own file and a book with none say so in words instead. */
function Cover({ src, own }: { src: string | null; own: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex h-20 w-14 shrink-0 items-center justify-center overflow-hidden border border-ink bg-paper text-center text-label text-ink-quiet">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- a hotlinked thumbnail, as every cover on the site is
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : own ? (
        'YOUR FILE'
      ) : (
        'NO COVER'
      )}
    </div>
  );
}

/** A ref the site's book info route answers for (`/api/web/book/info`): a Gutenberg book, an Open Library work, an Archive book. */
const LOOKUP_REF = /^(books:OL[1-9][0-9]{0,11}W(?:-pg[1-9][0-9]{0,6})?|internet_archive:[A-Za-z0-9][A-Za-z0-9._-]{0,100})$/;

/**
 * Where a place with no title (saved before titles were kept, 2026-11-13) can have it looked up: the book itself, or for your
 * own file or an IPFS copy, the work it was matched to. Null when nothing can be asked.
 */
function lookupRefOf(place: BookPlace): string | null {
  const work = cleanWork(place.workRef);
  if (ownHash(place.bookRef)) return work;
  const cid = ipfsCid(place.bookRef);
  if (cid) return work ?? ipfsWork(cid);
  return LOOKUP_REF.test(place.bookRef) ? place.bookRef : work;
}

type Named = { title: string; author: string };

/** A book's title and author from the site's own book info route, or null. */
async function namedBook(ref: string): Promise<Named | null> {
  try {
    const response = await fetch(`/api/web/book/info?ref=${encodeURIComponent(ref)}`);
    const body = response.ok ? ((await response.json()) as { item?: { title?: unknown; creator?: unknown } }) : null;
    const title = typeof body?.item?.title === 'string' ? body.item.title.trim() : '';
    return title ? { title, author: typeof body?.item?.creator === 'string' ? body.item.creator.trim() : '' } : null;
  } catch {
    return null;
  }
}

/**
 * The READ module's front page (SPEC-reading-places.md and Luke's ask of 2026-11-13): at the top, OPEN YOUR OWN PDF OR EPUB
 * (drop it anywhere on the page); then CONTINUE READING, the books you're partway through, YOUR FILES, the files this browser
 * keeps, and READ, the ones you finished. Signed in, the places are the account's (they follow you between devices); signed
 * out, they're this browser's. YOUR FILES lives only in this browser: a kept file opens at once, and one that isn't kept
 * here asks to be chosen again, since the site never has it.
 */
export default function ReadingShelf({
  me,
  wantedFile,
  forWork,
  incoming,
  onIncoming,
  onOpen,
}: {
  me: Me;
  /** `/read?file=<fingerprint>` for a file this browser doesn't keep: choose it again. */
  wantedFile: string | null;
  forWork: WorkMatch | null;
  incoming: File | null;
  onIncoming: (file: File) => void;
  onOpen: (file: File) => void;
}) {
  const [places, setPlaces] = useState<BookPlace[] | null>(null);
  const [kept, setKept] = useState<KeptRow[]>([]);
  const [fault, setFault] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  // A row's READ for your own file this browser doesn't keep: the drop box asks for it (no new address needed).
  const [askFor, setAskFor] = useState<string | null>(null);
  const meId = me?.id ?? null;

  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(() => (meId ? getBooksRepository().places(meId) : placesHere()))
      .then((found) => live && setPlaces(found))
      .catch(() => {
        if (!live) return;
        setPlaces([]);
        setFault('YOUR BOOKS COULD NOT BE READ. TRY AGAIN SOON.');
      });
    return () => {
      live = false;
    };
  }, [meId]);

  const readKept = useCallback(() => {
    void keptFiles().then(setKept);
  }, []);
  useEffect(() => {
    readKept();
  }, [readKept]);

  // Places saved with no title (Luke, 2026-11-13: "make sure they come with their titles here"): each book's title and author
  // looked up as its page does, shown, and written onto the place (yours on the account, a visitor's in this browser) so it
  // is there next time. Your own file is shown by its matched book's title, and that is never written onto it.
  const [named, setNamed] = useState<Record<string, Named>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!places) return;
    for (const place of places) {
      if (place.title || asked.current.has(place.bookRef)) continue;
      asked.current.add(place.bookRef);
      const ref = lookupRefOf(place);
      if (!ref) continue;
      void namedBook(ref).then((found) => {
        if (!found) return;
        setNamed((held) => ({ ...held, [place.bookRef]: found }));
        if (ownHash(place.bookRef)) return;
        if (meId) void getBooksRepository().setTitle(meId, place.bookRef, found.title).catch(() => undefined);
        else {
          try {
            window.localStorage.setItem(placeKey(place.bookRef), storedPlace({ ...place, title: found.title }, place, new Date(place.updatedAt || Date.now())));
          } catch {
            // Blocked storage: shown now, looked up again next time.
          }
        }
      });
    }
  }, [places, meId]);

  /** A row's title: the one saved, else the one looked up, else your file's matched book, else what it is. */
  const titleOf = (place: BookPlace): string => {
    const title = place.title || named[place.bookRef]?.title || (ownHash(place.bookRef) ? (kept.find((row) => row.ref === place.bookRef)?.match?.title ?? '') : '');
    if (title) return title.toUpperCase();
    return ownHash(place.bookRef) ? 'YOUR FILE' : 'A BOOK';
  };
  const byOf = (place: BookPlace): string => {
    const author = named[place.bookRef]?.author;
    return author ? `BY ${author.toUpperCase()} · ` : '';
  };

  const unfinish = async (place: BookPlace) => {
    setFault(null);
    try {
      if (meId) await getBooksRepository().unfinish(meId, place.bookRef);
      else window.localStorage.setItem(placeKey(place.bookRef), storedPlace({ ...place, finishedAt: null }, place));
      const now = new Date().toISOString();
      setPlaces((held) => (held ?? []).map((each) => (each.bookRef === place.bookRef ? { ...each, finishedAt: null, updatedAt: now } : each)));
    } catch {
      setFault('THAT COULD NOT BE SAVED.');
    }
  };

  const openKept = async (ref: string) => {
    setFault(null);
    const file = await keptFileOf(ref);
    if (file) onOpen(asFile(file));
    else {
      setFault('THAT FILE IS NO LONGER ON THIS DEVICE. CHOOSE IT AGAIN.');
      readKept();
    }
  };

  /** READ on your own file's row: at once when this browser keeps it, else the box at the top asks for it. */
  const readOwn = (ref: string) => {
    if (keptRefs.has(ref)) {
      void openKept(ref);
      return;
    }
    setAskFor(ownHash(ref));
    window.scrollTo?.(0, 0);
    document.getElementById('own-file')?.scrollIntoView({ block: 'start' });
  };

  const forget = async (ref: string) => {
    // Two presses: the first asks, the second forgets.
    if (forgetting !== ref) {
      setForgetting(ref);
      return;
    }
    setForgetting(null);
    if (!(await forgetFile(ref))) setFault('THAT COULD NOT BE FORGOTTEN.');
    readKept();
  };

  // A file dropped anywhere on the page goes to the drop box.
  const dropAnywhere = (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && isBookFile(file)) onIncoming(file);
  };

  const { reading, read } = shelves(places ?? []);
  const keptRefs = new Set(kept.map((row) => row.ref));
  const placeOf = (ref: string) => (places ?? []).find((place) => place.bookRef === ref);
  const wantedHere = wantedFile ?? askFor;
  const wanted = wantedHere ? placeOf(`own:${wantedHere}`) : undefined;
  const rowCover = (place: BookPlace) => coverOf(place.bookRef) ?? workCover(kept.find((row) => row.ref === place.bookRef)?.match?.cover);

  return (
    <div className="absolute inset-0 overflow-y-auto bg-sun-pale text-ink" onDragOver={(event) => event.preventDefault()} onDrop={dropAnywhere}>
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-3">
        <OwnFileDrop
          me={me}
          incoming={incoming}
          forWork={forWork}
          heading={wantedHere ? `CHOOSE ${wanted?.title ? `"${wanted.title.toUpperCase()}"` : 'YOUR FILE'} AGAIN${wanted ? ` TO CONTINUE FROM ${progressText(wanted)}` : ''}` : undefined}
          onOpen={onOpen}
          onKept={readKept}
        />

        {fault ? (
          <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar" role="alert">
            {fault}
          </p>
        ) : null}

        <section aria-labelledby="continue-reading">
          <h2 id="continue-reading" className={TITLE_BAR}>
            CONTINUE READING
          </h2>
          {places === null ? (
            <p className="py-2 text-label" role="status">
              FINDING YOUR BOOKS...
            </p>
          ) : reading.length === 0 ? (
            <p className="py-2 text-label">
              NOTHING STARTED YET. A BOOK YOU READ HERE KEEPS YOUR PLACE.{' '}
              <Link href="/media" className={PLATE_LINK} {...explain('Opens the MEDIA page, where books are searched for and opened.', 'Any book you start reading from there is listed here afterwards, with your place in it.')}>
                FIND A BOOK IN MEDIA
              </Link>
            </p>
          ) : (
            <ul data-shelf="reading">
              {reading.map((place) => (
                <li key={place.bookRef} className="rule-pixel flex items-center gap-2 py-2" data-book={place.bookRef}>
                  <Cover src={rowCover(place)} own={ownHash(place.bookRef) !== null} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-key">{titleOf(place)}</p>
                    <p className="text-label text-ink-quiet">
                      {ownHash(place.bookRef) ? (keptRefs.has(place.bookRef) ? 'YOUR FILE, ON THIS DEVICE · ' : 'YOUR FILE · ') : ''}
                      {byOf(place)}
                      <span data-progress>{progressText(place)}</span>
                      {place.updatedAt ? ` · LAST READ ${whenText(place.updatedAt)}` : ''}
                    </p>
                  </div>
                  {ownHash(place.bookRef) ? (
                    <button
                      type="button"
                      onClick={() => readOwn(place.bookRef)}
                      className={PLATE}
                      aria-label={`READ ${titleOf(place)}`}
                      {...explain(
                        'Opens your own file in the reader, which then asks whether to continue from your place or start over.',
                        'A file this browser keeps (ON THIS DEVICE) opens at once. Otherwise the box at the top of the page asks you to choose the file again, because the site never holds it.',
                      )}
                    >
                      [ READ ]
                    </button>
                  ) : (
                    <Link
                      href={continueHref(place.bookRef)}
                      className={PLATE}
                      aria-label={`READ ${titleOf(place)}`}
                      {...explain('Opens this book in the reader, which then asks whether to continue from your place or start over.', 'Your place is saved as you turn pages: on your account when signed in, else in this browser.')}
                    >
                      [ READ ]
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {kept.length > 0 ? (
          <section aria-labelledby="your-files">
            <h2 id="your-files" className={TITLE_BAR}>
              YOUR FILES
            </h2>
            <p className="pt-1 text-label text-ink-quiet">KEPT IN THIS BROWSER ONLY. NOBODY ELSE CAN SEE THEM, AND THEY ARE NEVER SENT ANYWHERE.</p>
            <ul data-shelf="files">
              {kept.map((row) => {
                const place = placeOf(row.ref);
                const name = row.match?.title.toUpperCase() || place?.title.toUpperCase() || row.name.toUpperCase();
                return (
                  <li key={row.ref} className="rule-pixel flex flex-wrap items-center gap-2 py-2" data-file={row.ref}>
                    <Cover src={workCover(row.match?.cover)} own />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-key">{name}</p>
                      <p className="break-words text-label text-ink-quiet">
                        {row.match ? `${row.match.author ? `BY ${row.match.author.toUpperCase()} · ` : ''}` : 'NOT MATCHED TO A BOOK · '}
                        {sizeText(row.size)}
                        {place ? ` · ${place.finishedAt ? 'FINISHED' : progressText(place)}` : ''}
                        {row.keptAt ? ` · KEPT ${whenText(row.keptAt)}` : ''}
                      </p>
                      <p className="break-words text-label text-ink-quiet">{row.name}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => void openKept(row.ref)}
                        className={PLATE}
                        aria-label={`READ YOUR FILE ${name}`}
                        {...explain('Opens this file in the reader, straight from the copy this browser keeps.', 'Nothing is uploaded: the file is read on this device. A book you have started asks whether to continue or start over.')}
                      >
                        [ READ ]
                      </button>
                      {row.match ? (
                        <Link
                          href={`/media/book/${row.match.work}`}
                          className={PLATE_LINK}
                          aria-label={`BOOK PAGE: ${name}`}
                          {...explain('Opens the MEDIA page of the book this file was matched to.', 'That page lists the book and its editions; your place and highlights in this file count as that book.')}
                        >
                          [ BOOK PAGE ]
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void forget(row.ref)}
                        className={PLATE}
                        aria-label={forgetting === row.ref ? `SURE? FORGET ${name}` : `FORGET ${name}`}
                        {...(forgetting === row.ref
                          ? explain("Removes this browser's copy of the file for good.", 'Your place and highlights in it stay. The file on your own disk is not touched, so you can choose it again later.', "THIS IS THE SECOND PRESS: THE BROWSER'S COPY GOES NOW.")
                          : explain("Asks to remove this browser's copy of the file: the key turns to SURE? FORGET, and a second press removes it.", 'Frees the room it takes in this browser. Your place and highlights in it stay, and the file on your own disk is not touched.'))}
                      >
                        {forgetting === row.ref ? '[ SURE? FORGET ]' : '[ FORGET ]'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {read.length > 0 ? (
          <section aria-labelledby="read-shelf">
            <h2 id="read-shelf" className={TITLE_BAR}>
              READ
            </h2>
            <ul data-shelf="read">
              {read.map((place) => (
                <li key={place.bookRef} className="rule-pixel flex flex-wrap items-center gap-2 py-2" data-book={place.bookRef}>
                  <Cover src={rowCover(place)} own={ownHash(place.bookRef) !== null} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-key">{titleOf(place)}</p>
                    <p className="text-label text-ink-quiet">
                      {ownHash(place.bookRef) ? 'YOUR FILE · ' : ''}
                      {byOf(place)}FINISHED {finishedWhen(place.finishedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ownHash(place.bookRef) ? (
                      <button
                        type="button"
                        onClick={() => readOwn(place.bookRef)}
                        className={PLATE}
                        aria-label={`READ AGAIN: ${titleOf(place)}`}
                        {...explain(
                          'Opens your own finished file in the reader again, which asks whether to continue from the end or start over.',
                          'A file this browser keeps opens at once. Otherwise the box at the top of the page asks you to choose the file again, because the site never holds it.',
                        )}
                      >
                        [ READ AGAIN ]
                      </button>
                    ) : (
                      <Link
                        href={continueHref(place.bookRef)}
                        className={PLATE}
                        aria-label={`READ AGAIN: ${titleOf(place)}`}
                        {...explain('Opens this finished book in the reader again, which asks whether to continue from the end or start over.', 'Turning pages before its end takes the FINISHED mark off, so the book moves back up to CONTINUE READING.')}
                      >
                        [ READ AGAIN ]
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => void unfinish(place)}
                      className={PLATE}
                      aria-label={`NOT FINISHED: ${titleOf(place)}`}
                      {...explain('Takes the FINISHED mark off this book and moves it back up to CONTINUE READING.', 'For a book marked finished by reaching its last page when you were not done with it. Your place in it is kept.')}
                    >
                      [ NOT FINISHED ]
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
