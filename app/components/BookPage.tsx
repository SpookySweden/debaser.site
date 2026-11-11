'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getBooksRepository } from '../lib/books/repository';
import { bookThreadAnchor, isCfi, isReadable, readHref, type BookReader as Reader } from '../lib/books/types';
import { threadDomId } from '../lib/forum/anchors';
import { TITLE_BAR } from '../lib/ui/controls';
import type { WebItem } from '../lib/web/types';
import { useForum } from './ForumProvider';
import BookEditions from './BookEditions';
import ProfileAvatarLink from './ProfileAvatarLink';
import { WebRow } from './WebStream';

const NO_HOSTS = {};
const NOTHING = () => undefined;
const REF = /^(books:OL[1-9][0-9]{0,11}W(?:-pg[1-9][0-9]{0,6})?|audiobooks:[1-9][0-9]{0,8}|edition:OL[1-9][0-9]{0,11}M)$/;

/**
 * A book's page (SPEC-books.md): the book as MEDIA draws it (cover, title, authors, READ or LISTEN), then everyone with
 * public highlights in it, each opening their own thread for the book. A visitor sees ANON for each. A book from Open
 * Library also lists every edition of it (SPEC-book-editions.md, `BookEditions`); one edition's address,
 * `/media/book/edition:OL…M`, is its book's page opened at that edition.
 */
export default function BookPage({ bookRef }: { bookRef: string }) {
  const valid = REF.test(bookRef);
  const search = useSearchParams();
  const router = useRouter();
  const forum = useForum();
  const [item, setItem] = useState<WebItem | null | undefined>(undefined);
  const [fault, setFault] = useState<string | null>(null);
  const [readers, setReaders] = useState<Reader[] | null>(null);
  const at = search.get('at');
  const startShow = search.get('show') === 'readable' ? 'readable' : search.get('show') === 'details' ? 'details' : 'all';
  // An edition's page is its book's: the book's own ref once its details have come.
  const isEdition = bookRef.startsWith('edition:');
  const workRef = isEdition ? (item ? item.id : null) : bookRef;

  useEffect(() => {
    if (!valid) return;
    let live = true;
    fetch(`/api/web/book/info?ref=${encodeURIComponent(bookRef)}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { item?: WebItem; error?: string };
        if (!live) return;
        if (body.item) setItem(body.item);
        else {
          setItem(null);
          setFault(body.error ?? 'NO SUCH BOOK.');
        }
      })
      .catch(() => live && setFault('THE CATALOGUE DID NOT ANSWER.'));
    return () => {
      live = false;
    };
  }, [bookRef, valid]);

  useEffect(() => {
    if (!valid || workRef === null) return;
    let live = true;
    getBooksRepository()
      .readers(workRef)
      .then((found) => live && setReaders(found))
      .catch(() => live && setReaders([]));
    return () => {
      live = false;
    };
  }, [workRef, valid]);

  // An old highlight link (`/media/book/<ref>?at=`): on to the reader (SPEC-reader.md), at that spot when it's a CFI.
  useEffect(() => {
    if (at !== null && isReadable(bookRef)) router.replace(readHref(bookRef, { cfi: isCfi(at) ? at : null }));
  }, [at, bookRef, router]);

  if (!valid) return <p className="p-3 text-label text-ink">THAT ISN&apos;T A BOOK&apos;S ADDRESS.</p>;

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="book-itself">
        <h2 id="book-itself" className={TITLE_BAR}>
          {item ? item.title.toUpperCase() : 'BOOK'}
        </h2>
        {item === undefined && !fault ? <p className="p-3 text-label text-ink">READING...</p> : null}
        {fault ? <p className="p-3 text-label text-ink">{fault}</p> : null}
        {item ? (
          <ul className="px-2">
            <WebRow item={{ ...item, alsoOn: [] }} extraHosts={NO_HOSTS} found={false} onCreator={NOTHING} />
          </ul>
        ) : null}
        <p className="px-3 text-label">
          <Link href="/media" className="underline">
            BACK TO MEDIA
          </Link>
        </p>
      </section>

      {item && item.platform === 'books' ? <BookEditions key={`${startShow}:${item.book?.edition ?? ''}`} bookRef={item.id} at={item.book?.edition ?? null} startShow={startShow} /> : null}

      <section aria-labelledby="book-readers">
        <h2 id="book-readers" className={TITLE_BAR}>
          READERS
        </h2>
        {readers === null ? <p className="p-3 text-label text-ink">READING...</p> : null}
        {readers !== null && readers.length === 0 ? <p className="p-3 text-label text-ink">NOBODY HAS HIGHLIGHTED THIS BOOK YET.</p> : null}
        <ul className="flex flex-col gap-1 p-2">
          {(readers ?? []).map((reader, index) => {
            const thread = reader.person && workRef ? forum.threadForAnchor(bookThreadAnchor(reader.person, workRef, '')) : undefined;
            return (
              <li key={reader.person ?? `anon-${index}`} className="rule-pixel flex flex-wrap items-center gap-2 py-1 text-label">
                {reader.person ? (
                  <ProfileAvatarLink author={{ id: reader.person, displayName: reader.displayName ?? '' }} size={24} variant="plain" />
                ) : (
                  <span className="text-ink">ANON</span>
                )}
                <span className="text-ink-quiet">
                  {reader.highlights} {reader.highlights === 1 ? 'HIGHLIGHT' : 'HIGHLIGHTS'}
                </span>
                {thread ? (
                  <Link href={`/forum#${threadDomId(thread.id)}`} className="underline">
                    THEIR THREAD
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
