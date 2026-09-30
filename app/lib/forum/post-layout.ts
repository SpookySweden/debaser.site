import type { ForumAuthor, ForumPreview, ForumTag, ForumThread } from './types';
import { displayTags } from './tags';
import { countReplies, formatStamp } from './format';
import { collectThreadImages, imageSourceLabel } from './media';
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
 *   expanded   title, then the one-line author/date strip, then a two column body
 *              - picture and small tags down the left, the body of the text and
 *              the replies on the right.
 *   collapsed  the title, and the strip under it: the poster's picture leading,
 *              then their name, the stamp and the small tags. The post's own
 *              picture is not drawn while a row is collapsed, so the strip carries
 *              an `[ IMG ]` badge instead and the drawing itself waits for the
 *              click that opens the post. The right half of the row is held open
 *              for the hover preview (`./components/PostHoverPreview.tsx`), which
 *              is where the writing and the reply reel show themselves.
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
  /**
   * Whether the strip draws the poster's picture at all.
   *
   * `shown` for anybody the board can name (a real account, the house account
   * included, which has a default pfp to fall back on); `hidden` for a guest,
   * who has no profile and therefore no picture. There is no hover state any
   * more: the picture *leads* the strip, and a picture that arrives on hover
   * cannot lead anything.
   */
  avatar: 'shown' | 'hidden';
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
    // The strip is one line either way, and the poster's picture leads it: a row
    // that is open and a row that is shut draw the same strip, so opening a post
    // moves nothing that the reader was already looking at. A guest has no
    // profile, so a guest post has no picture to draw.
    avatar: showsPicture ? 'shown' : 'hidden',
  };
}

/**
 * The layout input for a thread, with the labels read off the thread itself.
 *
 * `buildPostLayout` takes its three label strings pre-formatted so it stays free of date formatting
 * and of the media rules. That made every caller spell the same three derivations, and there are
 * three of them now - the board's card, the gallery tile, and the check - so they live here, where
 * they can only disagree in one place.
 */
export function postLayoutInput(
  thread: ForumThread,
  isOpen: boolean,
  authorProfile?: PublicProfile | null,
): PostLayoutInput {
  const images = collectThreadImages(thread);

  return {
    thread,
    isOpen,
    authorProfile,
    postedLabel: `POSTED ${formatStamp(thread.createdAt)}`,
    repliesLabel: countReplies(thread.comments.length),
    imageSourceLabel: imageSourceLabel(images.source),
    postImage: images.preview,
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
