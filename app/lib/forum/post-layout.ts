import type { ForumAuthor, ForumPreview, ForumTag, ForumThread } from './types';
import { displayTags } from './tags';
import { SITE_AUTHOR, SITE_AUTHOR_PICTURE } from './site-author';
import type { GivenTag, PublicProfile } from '../profile/types';
import { visibleGivenTags } from '../profile/visibility';

/**
 * The board's post layout, as data.
 *
 * The layout rules the board cares about live here rather than inline in JSX,
 * so they can be reasoned about (and tested) on their own:
 *
 *   expanded   title, posted stamp and the author row, then a two column body -
 *              picture and small tags down the left, the body of the text and
 *              the replies on the right.
 *   collapsed  only the title, the posted stamp, the author and the small tags;
 *              no hand-drawn bulk. The picture and the avatar are marked as
 *              hover-reveal, so the collapsed list stays tight until somebody
 *              points at the title or the name.
 *
 * Who the header credits is part of the layout too: a thread opened by an item's
 * comment box belongs to that item, so it is credited to the site rather than to
 * the account that happened to comment first (app/lib/forum/site-author.ts).
 */
export type PostLayout = {
  /** "POSTED 2026-09-21 04:12" */
  postedLabel: string;
  title: string;
  /** Author information for the meta row: name, place line, chosen tags. */
  author: {
    /**
     * Who the header names: the poster, or the site itself when the thread is the
     * item's own (a comment box opened it), never the first commenter.
     */
    credit: ForumAuthor;
    /** `credit`'s display name, resolved to the fallback when it is blank. */
    name: string;
    /** Picture slot when the credit is not a person: the site's default pfp. */
    picture: string | undefined;
    location: string;
    /** Tags other users gave the author and the author chose to display. */
    displayedTags: GivenTag[];
  };
  /** The author has something worth clicking through to. */
  hasProfile: boolean;
  /** Replies, pre-formatted. */
  repliesLabel: string;
  replyCount: number;
  /** Collapsed-only: the post's own tags, small, under the meta row. */
  collapsedTags: ForumTag[];
  /** Expanded left column. */
  left: {
    image: ForumPreview | undefined;
    /** What the picture belongs to, for the tooltip. */
    imageSource: string;
    tags: ForumTag[];
  };
  /** Expanded right column. */
  right: {
    showBody: boolean;
    body: string;
    /** Auto-filed threads link back to the item instead of showing a body. */
    isAnchorPost: boolean;
  };
  /** Whether the avatar and picture are visible, and whether hovering reveals them. */
  avatar: 'shown' | 'hover' | 'hidden';
  image: 'shown' | 'hover' | 'hidden';
};

export type PostLayoutInput = {
  thread: ForumThread;
  isOpen: boolean;
  /** The author's profile when it is known, for the place line and tags. */
  authorProfile?: PublicProfile | null;
  /** Pre-formatted stamp, so this module stays free of date formatting. */
  postedLabel: string;
  repliesLabel: string;
  imageSourceLabel: string;
  /** Whether the thread's picture should be shown at all (post media only). */
  postImage: ForumPreview | undefined;
  isAnchorPost: boolean;
};

export function buildPostLayout(input: PostLayoutInput): PostLayout {
  const { thread, isOpen, authorProfile, postImage } = input;
  // A post an item owns - the thread an item's comment box opened - is credited
  // to the item, so its header never repeats the account that commented first.
  const itemOwned = input.isAnchorPost;
  const credit = itemOwned ? SITE_AUTHOR : thread.author;
  const displayedTags =
    itemOwned || authorProfile === null || authorProfile === undefined ? [] : visibleGivenTags(authorProfile);
  const showsPicture = itemOwned || credit.id !== null;

  return {
    postedLabel: input.postedLabel,
    title: thread.title,
    author: {
      credit,
      name: displayNameFor(credit),
      picture: itemOwned ? SITE_AUTHOR_PICTURE : undefined,
      location: itemOwned ? '' : (authorProfile?.location ?? ''),
      displayedTags,
    },
    hasProfile: credit.id !== null,
    repliesLabel: input.repliesLabel,
    replyCount: thread.comments.length,
    // Retired housekeeping badges (BOARD / TEXT_ONLY / SHORT) are stripped here,
    // so rows written by older builds look the same as new ones.
    collapsedTags: isOpen ? [] : displayTags(thread.tags),
    left: {
      image: isOpen ? postImage : undefined,
      imageSource: input.imageSourceLabel,
      tags: displayTags(thread.tags),
    },
    right: {
      showBody: isOpen,
      body: thread.body,
      isAnchorPost: input.isAnchorPost,
    },
    // Collapsed rows keep the ink for the text: the avatar and the picture only
    // appear when the row is hovered, which the card wires to the title/name. A
    // site-owned post has a default pfp to show; a guest post has none at all.
    avatar: showsPicture ? (isOpen ? 'shown' : 'hover') : 'hidden',
    image: postImage === undefined ? 'hidden' : isOpen ? 'shown' : 'hover',
  };
}

function displayNameFor(author: ForumAuthor): string {
  return author.displayName.length > 0 ? author.displayName : 'Anonymous';
}

/** Convenience for callers that only need the meta line. */
export function postMetaLine(layout: PostLayout): string {
  const parts = [layout.postedLabel, layout.author.name];
  if (layout.author.location.length > 0) parts.push(layout.author.location);

  return parts.join(' :: ');
}
