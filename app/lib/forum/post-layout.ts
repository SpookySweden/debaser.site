import type { ForumAuthor, ForumPreview, ForumTag, ForumThread } from './types';
import { displayTags } from './tags';
import { SITE_AUTHOR_PICTURE, isItemOwnedThread, postCredit } from './site-author';
import { profileNameColour } from '../profile/name-colours';
import type { GivenTag, PublicProfile } from '../profile/types';
import { currentAvatarVersion, visibleGivenTags } from '../profile/visibility';

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
    /**
     * The colour the account chose for its username (`app/lib/profile/name-colours.ts`),
     * or undefined for the default. The item-owned credit is the house account,
     * whose seeded profile draws it in dark blue like any other account.
     */
    nameColour: string | undefined;
    /**
     * Picture slot when the credit has no picture of its own: the site's default
     * pfp, drawn for the archive's own byline. Undefined when the credit's profile
     * carries a picture, and for a guest with no profile at all.
     */
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
};

export function buildPostLayout(input: PostLayoutInput): PostLayout {
  const { thread, isOpen, authorProfile, postImage } = input;
  // A post an item owns - the thread an item's comment box opened - is credited
  // to the item, so its header never repeats the account that commented first.
  const itemOwned = isItemOwnedThread(thread);
  const credit = postCredit(thread);
  // The credit is a real account either way - the house account on an item's own
  // post - so its profile answers for the name colour and the picture. Given tags
  // stay off an item-owned post: they belong to a person, not to the archive.
  const creditProfile = authorProfile ?? null;
  const displayedTags = itemOwned || creditProfile === null ? [] : visibleGivenTags(creditProfile);
  const showsPicture = credit.id !== null;
  // A picture of its own wins; otherwise the archive's byline falls back to the
  // hand-drawn default pfp slot, so it is never a bare "?" square.
  const usesDefaultPicture = itemOwned && currentAvatarVersion(creditProfile) === undefined;

  return {
    postedLabel: input.postedLabel,
    title: thread.title,
    author: {
      credit,
      name: displayNameFor(credit),
      nameColour: profileNameColour(creditProfile),
      picture: usesDefaultPicture ? SITE_AUTHOR_PICTURE : undefined,
      location: itemOwned ? '' : (creditProfile?.location ?? ''),
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
      isAnchorPost: itemOwned,
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
