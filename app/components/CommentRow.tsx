'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { authorTag } from '../lib/auth/author';
import type { ForumAuthor } from '../lib/forum/types';
import { commentTag } from '../lib/profile/elements';
import type { ProfileComment } from '../lib/profile/types';
import ProfileAvatarLink from './ProfileAvatarLink';
import ProfileLink from './ProfileLink';
import ProfileName from './ProfileName';
import TimeStamp from './TimeStamp';

/**
 * What a row needs to be drawn: somebody, some words, when, and what it is about.
 *
 * Kept wider than a profile comment on purpose, because the same row serves the board's
 * wire as well - a post and a reply are the same thing to look at as a comment is, and
 * writing a second row for them would be how the two drift apart.
 */
export type CommentRowData = {
  id: string;
  author: ForumAuthor;
  body: string;
  createdAt: string;
  /** `P2` for a drawing, `M1` for a track, `POST` / `REPLY` on the wire. */
  tag?: string;
};

/** A profile comment as the row reads it: the tag derived from what it was written on. */
export function commentRowData(comment: ProfileComment): CommentRowData {
  return {
    id: comment.id,
    author: comment.author,
    body: comment.body,
    createdAt: comment.createdAt,
    ...(commentTag(comment) === undefined ? {} : { tag: commentTag(comment) as string }),
  };
}

type CommentRowProps = {
  data: CommentRowData;
  /**
   * 'compact' is the crawl's row: the little picture, the name, the tag, the stamp and the
   * words on one line that will not wrap - so a wire can slide a run of them past without
   * the strip changing height.
   */
  variant?: 'full' | 'compact';
  /**
   * Where the row's words lead, when they lead anywhere: the board's wire points each item
   * at the thread it came from. It is the words that carry the link rather than the whole
   * row, because a row already holds one link (the name) and a link inside a link is not a
   * thing a browser can draw honestly.
   */
  href?: string;
  hrefTitle?: string;
  /**
   * Set on the row a moderator has pinned: `PINNED`, `PINNED FOREVER`, `PINNED 3H LEFT`. It is
   * drawn as a dark plate at the front of the row, and the row itself is tinted, so a pinned
   * message is the thing the eye lands on as the wire goes past - which is the whole point of
   * pinning it.
   */
  pinnedLabel?: string;
  /**
   * A control the caller hangs on the row: the profile's pin, at the moment.
   *
   * It is drawn at the end of the line that names who wrote the comment - after the tag and the
   * plate a pinned one wears - so whatever a row can be asked to do sits with the row's own
   * facts rather than floating beside it. The row does not know what it is: the same control is
   * drawn on the comments list and nowhere else, because a wire going past is not a place
   * anything can be pressed.
   */
  action?: ReactNode;
};

/**
 * One comment, drawn the same way wherever it appears.
 *
 * Under a drawing, under a track, in the profile's own conversation, and on the board's
 * wire: the account's picture and name, the tag saying what it is about, when it was
 * filed, and what was said. One row means a remark is recognisable at a glance in any of
 * those places, which is the point of settling on it rather than writing a second one per
 * surface.
 */
export default function CommentRow({ data, variant = 'full', href, hrefTitle, pinnedLabel, action }: CommentRowProps) {
  const author = data.author;
  const pinned = pinnedLabel === undefined ? null : (
    <span className="border border-black bg-bubble-pale px-1 text-[9px] font-bold text-white">
      [ {pinnedLabel} ]
    </span>
  );

  if (variant === 'compact') {
    return (
      <li
        className={`flex items-center gap-1 whitespace-nowrap text-[10px] ${
          pinned === null ? 'pr-5' : 'mr-2 border border-black bg-sun-pale px-1'
        }`}
      >
        <ProfileAvatarLink author={author} size={20} showName={false} variant="plain" />
        <ProfileName author={author} className="font-bold" />
        {data.tag === undefined ? null : (
          <span className="border border-black bg-ena px-1 text-white">[ {data.tag} ]</span>
        )}
        {pinned}
        {action}
        <TimeStamp at={data.createdAt} className="text-[9px]" />

        {href === undefined ? (
          <span className="text-ink">&quot;{data.body}&quot;</span>
        ) : (
          <Link href={href} title={hrefTitle} className="text-ink hover:bg-ena">
            &quot;{data.body}&quot;
          </Link>
        )}
      </li>
    );
  }

  return (
    <li className={`rounded-none border border-ink p-1 ${pinned === null ? 'bg-paper' : 'bg-sun-pale'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
        <span className="flex flex-wrap items-center gap-1">
          <ProfileLink author={author}>
            <ProfileName author={author}>{authorTag(author)}</ProfileName>
          </ProfileLink>
          {data.tag === undefined ? null : (
            <span className="border border-black bg-ena px-1 text-white">[ {data.tag} ]</span>
          )}
          {pinned}
          {action}
        </span>
        <TimeStamp at={data.createdAt} />
      </div>
      <p className="mt-1 whitespace-pre-line text-xs">{data.body}</p>
    </li>
  );
}
