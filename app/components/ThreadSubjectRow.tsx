'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ThreadSubject } from '../lib/forum/thread-subject';
import PostAuthorRow from './PostAuthorRow';

type ThreadSubjectRowProps = {
  subject: ThreadSubject;
  /** The owner's chosen username colour, for a profile's thread (`app/lib/profile/name-colours.ts`). */
  nameColour?: string;
  /** The owner's country code, for the same. */
  country?: string;
  /** The instant, drawn after the subject: `LAST COMMENT <time>`. */
  stamp?: ReactNode;
  /** Edge length of the picture, matching the byline the row stands in for. */
  avatarSize?: number;
};

/** The one look every subject link shares: a name link, not a bracket key. */
const SUBJECT_LINK = 'text-key font-bold underline decoration-dotted hover:bg-ice';

/**
 * The strip under an item's own thread: what the comments are on.
 *
 * It stands where a post's byline stands and reads the same way - picture, name, stamp - so
 * the list keeps one rhythm, but it says `ON` rather than crediting anybody, because nobody
 * posted this thread (app/lib/forum/thread-subject.ts). The subject itself is the link to the
 * item, which is why the card no longer carries a `[ ↳ GO TO ... ]` key under the title.
 */
export default function ThreadSubjectRow({
  subject,
  nameColour,
  country = '',
  stamp,
  avatarSize = 28,
}: ThreadSubjectRowProps) {
  if (subject.kind === 'person') {
    // The byline itself, led by `ON`: the picture, the name and the flag open the page as they do
    // under any post, and the row wraps at its stamp rather than as one block under the word.
    return (
      <PostAuthorRow
        lead={<span className="font-bold">ON</span>}
        author={subject.owner}
        avatar="shown"
        avatarSize={avatarSize}
        nameColour={nameColour}
        country={country}
        stamp={stamp}
      />
    );
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-bold">ON</span>
      {subject.kind === 'item' && subject.preview !== undefined ? (
        /* The item's own drawing, at the size a byline's picture takes, so a sheet's thread leads
           with the sheet the way a person's leads with their picture. */
        <Link href={subject.href} className="inline-flex shrink-0">
          <Image
            src={subject.preview.src}
            alt={subject.preview.alt}
            width={avatarSize}
            height={avatarSize}
            className="rounded-none border border-ink bg-paper object-cover"
            style={{ width: avatarSize, height: avatarSize }}
          />
        </Link>
      ) : null}
      <Link
        href={subject.href}
        title={subject.kind === 'track' ? 'Open the music window' : undefined}
        className={SUBJECT_LINK}
      >
        {subject.kind === 'track' ? `♪ ${subject.title}` : subject.label}
      </Link>
      {stamp}
    </span>
  );
}
