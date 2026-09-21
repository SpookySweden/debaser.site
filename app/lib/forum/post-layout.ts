import type { ForumAuthor, ForumPreview, ForumTag, ForumThread } from './types';
import { displayTags } from './tags';
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
 */
export type PostLayout = {
  /** "POSTED 2026-09-21 04:12" */
  postedLabel: string;
  title: string;
  /** Author information for the meta row: name, place line, chosen tags. */
  author: {
    id: string | null;
    name: string;
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
  const displayedTags = authorProfile === null || authorProfile === undefined ? [] : visibleGivenTags(authorProfile);

  return {
    postedLabel: input.postedLabel,
    title: thread.title,
    author: {
      id: thread.author.id,
      name: displayNameFor(thread.author),
      location: authorProfile?.location ?? '',
      displayedTags,
    },
    hasProfile: thread.author.id !== null,
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
    // appear when the row is hovered, which the card wires to the title/name.
    avatar: thread.author.id === null ? 'hidden' : isOpen ? 'shown' : 'hover',
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
