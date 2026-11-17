'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { threadDomId } from '../lib/forum/anchors';
import { talkedAboutIn } from '../lib/forum/talked-about';
import { useForum } from './ForumProvider';

type TalkedAboutInProps = {
  /** A thread filed under the thing: its anchor's kind and id (a doc: `doc` and the doc's id). */
  kind?: string;
  id?: string;
  /** Or a board thread whose anchor id carries this (a reader's thread for a book: `book:<person>:<bookRef>`). */
  idIncludes?: string;
  /** Addresses that mean the thing when written in a post or a reply. */
  links: string[];
  className?: string;
};

/**
 * One line under a thing's title: `TALKED ABOUT IN: Line weights (3) · Panel thumbnails (1)`, each a link to the thread on the
 * board (SPEC-forum-v3.md, S4A). Says nothing when nobody has talked about it. Reads the board the forum already holds.
 */
export default function TalkedAboutIn({ kind, id, idIncludes, links, className = '' }: TalkedAboutInProps) {
  const { threads } = useForum();
  const linkKey = links.join('|');
  const rows = useMemo(
    () =>
      talkedAboutIn(threads, {
        filedUnder: (anchor) =>
          (kind !== undefined && id !== undefined && anchor.kind === kind && anchor.id === id) ||
          (idIncludes !== undefined && anchor.kind === 'board' && anchor.id.startsWith('book:') && anchor.id.includes(idIncludes)),
        links: linkKey.length === 0 ? [] : linkKey.split('|'),
      }),
    [threads, kind, id, idIncludes, linkKey],
  );
  if (rows.length === 0) return null;

  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 text-label text-ink ${className}`} data-talked-about>
      <span className="font-bold">TALKED ABOUT IN:</span>
      {rows.map((row, index) => (
        <span key={row.threadId}>
          <Link href={`/forum#${threadDomId(row.threadId)}`} className="link-pixel hover:underline">
            {row.title}
          </Link>
          {` (${row.replies})`}
          {index < rows.length - 1 ? ' ·' : ''}
        </span>
      ))}
    </p>
  );
}
