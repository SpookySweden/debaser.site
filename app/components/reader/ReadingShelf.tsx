'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { getBooksRepository } from '../../lib/books/repository';
import { browserPlaces, continueHref, coverOf, finishedWhen, placeKey, progressText, shelves, storedPlace, whenText } from '../../lib/books/reading-places';
import { ownHash, type BookPlace } from '../../lib/books/types';
import { PLATE, PLATE_LINK, TITLE_BAR } from '../../lib/ui/controls';

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
function Cover({ place }: { place: BookPlace }) {
  const cover = coverOf(place.bookRef);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex h-20 w-14 shrink-0 items-center justify-center overflow-hidden border border-ink bg-paper text-center text-label text-ink-quiet">
      {cover && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- a hotlinked thumbnail, as every cover on the site is
        <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : ownHash(place.bookRef) ? (
        'YOUR FILE'
      ) : (
        'NO COVER'
      )}
    </div>
  );
}

function titleOf(place: BookPlace): string {
  if (place.title) return place.title.toUpperCase();
  return ownHash(place.bookRef) ? 'A FILE WITH NO TITLE INSIDE' : 'A BOOK';
}

/**
 * The reader's front page (SPEC-reading-places.md, Luke 2026-11-13): CONTINUE READING, the books you're partway through, and
 * READ, the ones you finished, each newest first; under them, opening your own PDF or EPUB. Signed in, the lists are the
 * account's (they follow you between devices); signed out, they're this browser's. Your own file's row says YOUR FILE, and
 * its READ asks you to choose the file again, since the site never has it.
 */
export default function ReadingShelf({ me, wantedFile, picker }: { me: Me; wantedFile: string | null; picker: ReactNode }) {
  const [places, setPlaces] = useState<BookPlace[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);
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

  const { reading, read } = shelves(places ?? []);
  const wanted = wantedFile ? (places ?? []).find((place) => place.bookRef === `own:${wantedFile}`) : undefined;

  return (
    <div className="absolute inset-0 overflow-y-auto bg-sun-pale text-ink">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-3">
        {wantedFile ? (
          <section aria-label="Choose your file again" className="frame flex flex-col items-center gap-2 bg-paper p-3 text-center">
            <p className="text-key">
              CHOOSE {wanted?.title ? `"${wanted.title.toUpperCase()}"` : 'YOUR FILE'} AGAIN{wanted ? ` TO CONTINUE FROM ${progressText(wanted)}` : ''}.
            </p>
            <p className="text-label">THE SITE NEVER HAS YOUR FILE: ONLY WHERE YOU ARE IN IT.</p>
            {picker}
          </section>
        ) : null}

        <section aria-labelledby="continue-reading">
          <h2 id="continue-reading" className={TITLE_BAR}>
            CONTINUE READING
          </h2>
          {fault ? (
            <p className="mt-1 w-fit bg-bubble-pale px-1 text-label text-ink-bar" role="alert">
              {fault}
            </p>
          ) : null}
          {places === null ? (
            <p className="py-2 text-label" role="status">
              FINDING YOUR BOOKS...
            </p>
          ) : reading.length === 0 ? (
            <p className="py-2 text-label">
              NOTHING STARTED YET. A BOOK YOU READ HERE KEEPS YOUR PLACE.{' '}
              <Link href="/media" className={PLATE_LINK}>
                FIND A BOOK IN MEDIA
              </Link>
            </p>
          ) : (
            <ul data-shelf="reading">
              {reading.map((place) => (
                <li key={place.bookRef} className="rule-pixel flex items-center gap-2 py-2" data-book={place.bookRef}>
                  <Cover place={place} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-key">{titleOf(place)}</p>
                    <p className="text-label text-ink-quiet">
                      {ownHash(place.bookRef) ? 'YOUR FILE · ' : ''}
                      <span data-progress>{progressText(place)}</span>
                      {place.updatedAt ? ` · LAST READ ${whenText(place.updatedAt)}` : ''}
                    </p>
                  </div>
                  <Link href={continueHref(place.bookRef)} className={PLATE} aria-label={`READ ${titleOf(place)}`}>
                    [ READ ]
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {read.length > 0 ? (
          <section aria-labelledby="read-shelf">
            <h2 id="read-shelf" className={TITLE_BAR}>
              READ
            </h2>
            <ul data-shelf="read">
              {read.map((place) => (
                <li key={place.bookRef} className="rule-pixel flex flex-wrap items-center gap-2 py-2" data-book={place.bookRef}>
                  <Cover place={place} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-key">{titleOf(place)}</p>
                    <p className="text-label text-ink-quiet">
                      {ownHash(place.bookRef) ? 'YOUR FILE · ' : ''}FINISHED {finishedWhen(place.finishedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Link href={continueHref(place.bookRef)} className={PLATE} aria-label={`READ AGAIN: ${titleOf(place)}`}>
                      [ READ AGAIN ]
                    </Link>
                    <button type="button" onClick={() => void unfinish(place)} className={PLATE} aria-label={`NOT FINISHED: ${titleOf(place)}`}>
                      [ NOT FINISHED ]
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {wantedFile ? null : (
          <section aria-labelledby="own-book" className="flex flex-col items-center gap-2 border-t border-ink pt-3 text-center">
            <h2 id="own-book" className={TITLE_BAR}>
              YOUR OWN BOOK
            </h2>
            {picker}
            <p className="text-label">IT OPENS HERE AND STAYS ON YOUR DEVICE. ONLY ITS FINGERPRINT, TITLE AND YOUR PLACE ARE SAVED.</p>
          </section>
        )}
      </div>
    </div>
  );
}
