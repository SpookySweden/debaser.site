'use client';

import Link from 'next/link';
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
export default function CommentRow({ data, variant = 'full', href, hrefTitle }: CommentRowProps) {
  const author = data.author;

  if (variant === 'compact') {
    return (
      <li className="flex items-center gap-1 whitespace-nowrap pr-5 text-[10px]">
        <ProfileAvatarLink author={author} size={20} showName={false} variant="plain" />
        <ProfileName author={author} className="font-bold" />
        {data.tag === undefined ? null : (
          <span className="border border-black bg-[#000080] px-1 text-white">[ {data.tag} ]</span>
        )}
        <TimeStamp at={data.createdAt} className="text-[9px]" />

        {href === undefined ? (
          <span className="text-black">&quot;{data.body}&quot;</span>
        ) : (
          <Link href={href} title={hrefTitle} className="text-black hover:bg-[#000080]">
            &quot;{data.body}&quot;
          </Link>
        )}
      </li>
    );
  }

  return (
    <li className="rounded-none border border-gray-500 bg-white p-1">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
        <span className="flex flex-wrap items-center gap-1">
          <ProfileLink author={author}>
            <ProfileName author={author}>{authorTag(author)}</ProfileName>
          </ProfileLink>
          {data.tag === undefined ? null : (
            <span className="border border-black bg-[#000080] px-1 text-white">[ {data.tag} ]</span>
          )}
        </span>
        <TimeStamp at={data.createdAt} />
      </div>
      <p className="mt-1 whitespace-pre-line text-xs">{data.body}</p>
    </li>
  );
}
