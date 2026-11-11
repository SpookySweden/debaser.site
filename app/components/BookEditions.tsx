'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  coverUrl,
  editionCount,
  hasDetails,
  waysToRead,
  type EditionsAnswer,
  type EditionsOrder,
  type EditionsShow,
  type ListedEdition,
} from '../lib/books/editions';
import { PLATE, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';

const SHOWS: readonly { value: EditionsShow; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'readable', label: 'CAN BE READ HERE' },
  { value: 'details', label: 'HAS DETAILS' },
];
const ORDERS: readonly { value: EditionsOrder; label: string }[] = [
  { value: 'details', label: 'MOST DETAILS' },
  { value: 'newest', label: 'NEWEST' },
  { value: 'oldest', label: 'OLDEST' },
];

/** An edition's row's element id, so its address (`/media/book/edition:OL…M`) can bring it into view. */
export function editionDomId(key: string): string {
  return `edition-${key}`;
}

/**
 * A book's EDITIONS (SPEC-book-editions.md, Luke 2026-11-11): every edition Open Library lists, fifty at a time with
 * `[ MORE ]`, each its own row with its own address, and its READ, BORROW or NO FREE COPY. The filters (ALL, CAN BE READ
 * HERE, HAS DETAILS) and the order (most details first, newest, oldest) ask the list again. Opened at an edition (`at`),
 * that edition stands first, marked THIS EDITION.
 */
export default function BookEditions({ bookRef, at, startShow }: { bookRef: string; at: string | null; startShow: EditionsShow }) {
  const [show, setShow] = useState<EditionsShow>(startShow);
  const [order, setOrder] = useState<EditionsOrder>('details');
  const [answer, setAnswer] = useState<EditionsAnswer | null>(null);
  const [editions, setEditions] = useState<ListedEdition[]>([]);
  const [loading, setLoading] = useState(true);
  const [fault, setFault] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let live = true;
    const query = new URLSearchParams({ ref: bookRef, offset: String(offset), show, order });
    if (at) query.set('at', at);
    fetch(`/api/web/book/editions?${query.toString()}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Partial<EditionsAnswer> & { error?: string };
        if (!live) return;
        if (!response.ok || !Array.isArray(body.editions)) {
          setFault(body.error ?? 'THE CATALOGUE DID NOT ANSWER.');
          return;
        }
        const page = body as EditionsAnswer;
        setFault(null);
        setAnswer(page);
        setEditions((before) => (offset === 0 ? page.editions : [...before, ...page.editions]));
      })
      .catch(() => live && setFault('THE CATALOGUE DID NOT ANSWER.'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [bookRef, at, show, order, offset]);

  // Opened at an edition: brought into view once it's drawn.
  const atShown = answer?.at?.key ?? null;
  useEffect(() => {
    if (atShown) document.getElementById(editionDomId(atShown))?.scrollIntoView({ block: 'center' });
  }, [atShown]);

  const choose = (next: { show?: EditionsShow; order?: EditionsOrder }) => {
    setLoading(true);
    setEditions([]);
    // The count is the old filter's until the new answer comes: cleared, so it never shows under the new one's name.
    setAnswer(null);
    setOffset(0);
    if (next.show) setShow(next.show);
    if (next.order) setOrder(next.order);
  };

  const work = { gutenbergRef: answer?.gutenbergRef ?? null, ipfsCid: answer?.ipfsCid ?? null };
  const pinned = answer?.at ?? null;

  return (
    <section aria-labelledby="book-editions">
      <h2 id="book-editions" className={TITLE_BAR}>
        EDITIONS
      </h2>
      <div className="flex flex-col gap-1 px-2 pt-1 text-label">
        <div role="group" aria-label="Which editions" className="flex flex-wrap items-center gap-1">
          {SHOWS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={show === option.value}
              onClick={() => show !== option.value && choose({ show: option.value })}
              className={show === option.value ? PLATE_PRESSED : PLATE}
            >
              {show === option.value ? option.label : `[ ${option.label} ]`}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Order" className="flex flex-wrap items-center gap-1">
          <span className="font-bold text-ink-quiet">ORDER</span>
          {ORDERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={order === option.value}
              onClick={() => order !== option.value && choose({ order: option.value })}
              className={order === option.value ? PLATE_PRESSED : PLATE}
            >
              {order === option.value ? option.label : `[ ${option.label} ]`}
            </button>
          ))}
        </div>
        {answer ? (
          <p className="text-ink" data-editions-count>
            {show === 'all' ? editionCount(answer.size) : `${answer.matching.toLocaleString('en-GB')} OF ${editionCount(answer.size)}`}
            {answer.read < answer.size ? ` · THE ${answer.read.toLocaleString('en-GB')} OPEN LIBRARY EDITED LATEST ARE LISTED` : ''}
          </p>
        ) : null}
      </div>

      {pinned ? (
        <ul aria-label="This edition" className="px-2 pt-1">
          <EditionRow edition={pinned} work={work} marked />
        </ul>
      ) : null}

      {fault ? <p className="p-3 text-label text-ink">{fault}</p> : null}
      {loading && editions.length === 0 && !fault ? <p className="p-3 text-label text-ink">READING...</p> : null}
      {!loading && !fault && answer && editions.length === 0 ? <p className="p-3 text-label text-ink">NONE.</p> : null}
      <ul aria-label="Editions" className="px-2">
        {editions.map((edition) => (
          <EditionRow key={edition.key} edition={edition} work={work} marked={false} />
        ))}
      </ul>
      {answer?.next != null ? (
        <p className="px-3 py-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setOffset(answer.next ?? 0);
            }}
            className={PLATE}
          >
            {loading ? '[ READING... ]' : '[ MORE ]'}
          </button>
        </p>
      ) : null}
    </section>
  );
}

const WAY_LABELS = {
  scan: '[ READ ]',
  borrow: '[ BORROW ON ARCHIVE.ORG ↗ ]',
  archive: '[ SCAN ON ARCHIVE.ORG ↗ ]',
  gutenberg: '[ READ GUTENBERG TEXT ]',
  ipfs: '[ READ IPFS COPY ]',
  none: '[ OPEN LIBRARY ↗ ]',
} as const;

function EditionRow({ edition, work, marked }: { edition: ListedEdition; work: { gutenbergRef: string | null; ipfsCid: string | null }; marked: boolean }) {
  const [open, setOpen] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const ways = waysToRead(edition, work);
  const facts = [
    edition.publishers.join(', '),
    edition.year !== null ? String(edition.year) : edition.publishDate,
    edition.pages !== null ? `${edition.pages} PAGES` : '',
    edition.format,
    edition.isbn ? `ISBN ${edition.isbn}` : '',
    edition.languages.join(', '),
  ].filter(Boolean);
  const detailed = hasDetails(edition);
  const detailsId = `${marked ? 'at' : 'list'}-details-${edition.key}`;
  return (
    <li id={marked ? editionDomId(edition.key) : undefined} className={`rule-pixel py-2 ${marked ? 'border-l-thick border-acid pl-2' : ''}`} data-edition={edition.key}>
      <div className="flex items-start gap-2">
        {/* A fixed box, so a slow or missing cover never moves the row. Hotlinked from Open Library's cover server. */}
        <span className="block h-18 w-12 shrink-0 overflow-hidden border border-ink-plate bg-paper">
          {edition.cover !== null && !coverFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl(edition.cover)}
              alt=""
              width={48}
              height={72}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setCoverFailed(true)}
              className="block h-full w-full object-cover"
            />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          {marked ? <p className="mb-0.5 inline-block bg-acid px-1 text-label font-bold text-ink-plate">THIS EDITION</p> : null}
          <p className="text-sm font-bold text-ink wrap-anywhere">
            <Link href={`/media/book/edition:${edition.key}`} className="hover:underline">
              {edition.title}
              {edition.subtitle ? `: ${edition.subtitle}` : ''}
            </Link>
          </p>
          {edition.editionName ? <p className="text-label text-ink wrap-anywhere">{edition.editionName}</p> : null}
          {facts.length > 0 ? <p className="text-label text-ink-quiet wrap-anywhere">{facts.join(' · ')}</p> : null}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {ways.map((way) =>
              way.kind === 'borrow' || way.kind === 'archive' || way.kind === 'none' ? (
                <span key={way.kind} className="contents">
                  {way.kind === 'none' ? <span className="text-label font-bold text-ink-quiet">NO FREE COPY</span> : null}
                  <a
                    href={way.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={
                      way.kind === 'borrow'
                        ? `Borrow "${edition.title}" on archive.org (new tab)`
                        : way.kind === 'archive'
                          ? `Scan of "${edition.title}" on archive.org (new tab)`
                          : `Open Library's page for this edition of "${edition.title}" (new tab)`
                    }
                    className={PLATE}
                  >
                    {WAY_LABELS[way.kind]}
                  </a>
                </span>
              ) : (
                <Link key={way.kind} href={way.href} className={PLATE}>
                  {WAY_LABELS[way.kind]}
                </Link>
              ),
            )}
            {detailed ? (
              <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((was) => !was)} className={open ? PLATE_PRESSED : PLATE}>
                {open ? 'DETAILS ▴' : '[ DETAILS ▾ ]'}
              </button>
            ) : null}
          </div>
          {detailed && open ? (
            <div id={detailsId} className="mt-1 flex flex-col gap-1 text-label text-ink wrap-anywhere">
              {edition.contributors.length > 0 ? (
                <ul aria-label="Who else is in it">
                  {edition.contributors.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {edition.byStatement ? <p>{edition.byStatement}</p> : null}
              {edition.notes ? <p className="whitespace-pre-line">{edition.notes}</p> : null}
              {edition.contents.length > 0 ? (
                <div>
                  <p className="font-bold text-ink-quiet">CONTENTS</p>
                  <ol className="list-inside">
                    {edition.contents.map((line, index) => (
                      <li key={`${index}-${line}`}>{line}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
