'use client';

import { authorLabel } from '../lib/auth/author';
import { threadTagMatches } from '../lib/forum/board-query';
import { buildPostLayout, postLayoutInput } from '../lib/forum/post-layout';
import { postCredit } from '../lib/forum/site-author';
import { displayTags } from '../lib/forum/tags';
import { tagKey } from '../lib/forum/tag-vocabulary';
import type { ForumThread } from '../lib/forum/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { PLATE } from '../lib/ui/controls';
import PostAuthorRow from './PostAuthorRow';
import SheetImage from './SheetImage';
import TagStrip from './TagStrip';
import TimeStamp from './TimeStamp';

type ForumGalleryTileProps = {
  thread: ForumThread;
  /**
   * Opens the post where the replies are: the board leaves the gallery, opens this thread and
   * scrolls to it. A tile is a picture and what it is filed with - a conversation is not something
   * to read in a grid of them.
   */
  onOpen: (threadId: string) => void;
  /** The board's tag filter, so a tile marks the tags it matched on exactly as a row does. */
  tagFilter?: string[];
};

/**
 * One image post, already open.
 *
 * The gallery's unit is the same post the board's list draws, read the other way round: there a row
 * stays collapsed until somebody asks for it, and here the picture is the reason the post is on
 * screen at all, so the tile arrives with the drawing, the writing and the credit strip laid out.
 * Nothing on it has to be pressed to be read.
 *
 * What it deliberately leaves out is the conversation. A tile carries the reply count and one plate
 * that goes to the post, which is where the replies are; a grid of nested comment trees and composers
 * would be a worse board rather than a second view of one.
 *
 * The tile is not one big `<button>`: the drawing, the several links in the credit strip and the tag
 * badges are each their own target, and a tile that swallowed them would make every one of them
 * unreachable. The plate at the foot is the way through - one press, named.
 */
export default function ForumGalleryTile({ thread, onOpen, tagFilter = [] }: ForumGalleryTileProps) {
  const { profile } = usePublicProfile(postCredit(thread).id);
  // Pre-expanded: the layout is asked for the open shape, so the picture, the tags and the body are
  // all present without anybody having pressed anything.
  const layout = buildPostLayout(postLayoutInput(thread, true, profile));
  const image = layout.left.image;
  const matches = threadTagMatches(thread, tagFilter);
  const matched = displayTags([
    ...new Map(matches.map((match) => [tagKey(match.tag.label), match.tag])).values(),
  ]);
  const matchedReplyAuthors = [
    ...new Set(matches.flatMap((match) => (match.comment === undefined ? [] : [authorLabel(match.comment.author)]))),
  ];

  return (
    <li className="flex min-w-0 flex-col rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
      {/* The bar over the drawing says where the picture came from, because "a picture in this post"
          and "a picture somebody replied with" are different things to be shown - the second is why a
          reply can put a post in this view at all (app/lib/forum/media.ts). */}
      <div className="flex items-center justify-between gap-2 bg-chrome-dark px-2 py-[3px] text-[10px] font-bold leading-none text-ink">
        <span className="truncate" title={layout.left.imageSource}>
          {layout.left.imageSource}
        </span>
        <span className="shrink-0">{layout.repliesLabel}</span>
      </div>

      <div className="border-b border-black bg-paper p-1">
        {image === undefined ? null : (
          <SheetImage
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            sizes="(max-width: 640px) 90vw, (max-width: 1280px) 45vw, 320px"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2">
        <p className="text-sm font-bold leading-tight text-ink">{layout.title}</p>

        {/* The same one-line credit strip the board's rows carry, so a post looks like itself in
            both views: the picture leading, then the name, the stamp and the tags given to them. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink">
          <PostAuthorRow
            author={layout.author.credit}
            avatar={layout.avatar}
            avatarSize={28}
            nameColour={layout.author.nameColour}
            picture={layout.author.picture}
            location={layout.author.location}
            displayedTags={layout.author.displayedTags}
            stamp={
              <span className="font-bold">
                POSTED <TimeStamp at={thread.createdAt} />
              </span>
            }
          />
        </div>

        {layout.right.isAnchorPost ? null : (
          <p className="whitespace-pre-line text-xs leading-snug text-ink">{layout.right.body}</p>
        )}

        <TagStrip tags={layout.left.tags} limit={5} emptyLabel="NO TAGS" className="mt-1" />

        {/* The same line a filtered row draws, saying which tags brought this tile in and where they
            were typed - the tags belong to the post or to somebody's reply, and a tile whose own tag
            list does not show the match has to say where it is. */}
        {matched.length === 0 ? null : (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 border border-black bg-sun-pale px-1 py-[2px] text-[10px] font-bold text-ink">
            <span>FILTER MATCH:</span>
            <TagStrip tags={matched} />
            <span className="text-ink">
              {matchedReplyAuthors.length === 0 ? 'ON THIS POST' : `IN A REPLY BY ${matchedReplyAuthors.join(', ')}`}
            </span>
          </p>
        )}

        <button
          type="button"
          onClick={() => onOpen(thread.id)}
          title="Leave the gallery, open this post and read its replies"
          className={`${PLATE} mt-auto self-start`}
        >
          [ OPEN THE POST ]
        </button>
      </div>
    </li>
  );
}
