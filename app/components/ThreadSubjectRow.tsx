'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ThreadSubject } from '../lib/forum/thread-subject';
import type { ForumAnchor } from '../lib/forum/types';
import { PLATE } from '../lib/ui/controls';
import { ITEM_GONE_NOTE, webAnchorItemId, webItemStatus } from '../lib/web/bridges';
import { rowAddresses } from '../lib/web/row-addresses';
import { PLATFORM_LABELS } from '../lib/web/types';
import { useWebItem } from '../lib/web/use-web-item';
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

  if (subject.kind === 'web') return <WebSubject anchor={subject.anchor} href={subject.href} stamp={stamp} />;

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

/**
 * A WEB item's thread (app/lib/web/bridges.ts): the title it was filed under, opening /web, and the
 * item's own page on its platform while it is still in the stream. Once the item is hidden or removed,
 * the title stays as plain words with a note saying so: the thread and its comments are the forum's.
 */
function WebSubject({ anchor, href, stamp }: { anchor: ForumAnchor; href: string; stamp?: ReactNode }) {
  const item = useWebItem(webAnchorItemId(anchor));
  const status = webItemStatus(anchor, item);
  const outbound = item ? rowAddresses(item).link : null;

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-web-item-status={status}>
      <span className="font-bold">ON</span>
      <span className="bg-ice-pale px-1 font-bold text-ink">WEB</span>
      {status === 'gone' ? (
        <>
          <span className="font-bold wrap-anywhere">{anchor.label}</span>
          <span className="bg-bubble-pale px-1 font-bold text-ink-bar">{ITEM_GONE_NOTE}</span>
        </>
      ) : (
        <Link href={href} title="Open the WEB stream" className={`${SUBJECT_LINK} wrap-anywhere`}>
          {anchor.label}
        </Link>
      )}
      {outbound !== null && item ? (
        <a
          href={outbound}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={`Open "${item.title}" on ${PLATFORM_LABELS[item.platform]} (new tab)`}
          className={PLATE}
        >
          [ OPEN ↗ ]
        </a>
      ) : null}
      {stamp}
    </span>
  );
}
