'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isReadable, openReader } from '../lib/books/reader-window';
import { getBooksRepository } from '../lib/books/repository';
import { bookThreadAnchor, type BookReader as Reader } from '../lib/books/types';
import { threadDomId } from '../lib/forum/anchors';
import { TITLE_BAR } from '../lib/ui/controls';
import type { WebItem } from '../lib/web/types';
import { useForum } from './ForumProvider';
import ProfileAvatarLink from './ProfileAvatarLink';
import { WebRow } from './WebStream';

const NO_HOSTS = {};
const NOTHING = () => undefined;
const REF = /^(books:OL[1-9][0-9]{0,11}W(?:-pg[1-9][0-9]{0,6})?|audiobooks:[1-9][0-9]{0,8})$/;

/**
 * A book's page (SPEC-books.md): the book as MEDIA draws it (cover, title, authors, READ or LISTEN), then everyone with
 * public highlights in it, each opening their own thread for the book. A visitor sees ANON for each.
 */
export default function BookPage({ bookRef }: { bookRef: string }) {
  const valid = REF.test(bookRef);
  const search = useSearchParams();
  const forum = useForum();
  const [item, setItem] = useState<WebItem | null | undefined>(undefined);
  const [fault, setFault] = useState<string | null>(null);
  const [readers, setReaders] = useState<Reader[] | null>(null);
  const at = Number(search.get('at'));

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
    getBooksRepository()
      .readers(bookRef)
      .then((found) => live && setReaders(found))
      .catch(() => live && setReaders([]));
    return () => {
      live = false;
    };
  }, [bookRef, valid]);

  // A highlight's link (`?at=`): straight to that spot in the reader.
  useEffect(() => {
    if (item && isReadable(bookRef) && search.has('at') && Number.isInteger(at) && at >= 0) openReader(bookRef, item.title, at);
  }, [item, bookRef, search, at]);

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

      <section aria-labelledby="book-readers">
        <h2 id="book-readers" className={TITLE_BAR}>
          READERS
        </h2>
        {readers === null ? <p className="p-3 text-label text-ink">READING...</p> : null}
        {readers !== null && readers.length === 0 ? <p className="p-3 text-label text-ink">NOBODY HAS HIGHLIGHTED THIS BOOK YET.</p> : null}
        <ul className="flex flex-col gap-1 p-2">
          {(readers ?? []).map((reader, index) => {
            const thread = reader.person ? forum.threadForAnchor(bookThreadAnchor(reader.person, bookRef, '')) : undefined;
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
