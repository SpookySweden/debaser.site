'use client';

import { authorLabel } from '../lib/auth/author';
import type { ForumAuthor } from '../lib/forum/types';
import { tagColour } from '../lib/forum/tag-vocabulary';
import type { GivenTag } from '../lib/profile/types';
import ProfileAvatarLink from './ProfileAvatarLink';
import ProfileLink from './ProfileLink';
import ProfileName from './ProfileName';
import { AVATAR_PLAIN_FRAME } from './ProfileAvatar';
import SheetImage from './SheetImage';
import { TagMark, tagChipClasses, tagMarkColourFromColour } from './TagBadge';

type PostAuthorRowProps = {
  author: ForumAuthor;
  /**
   * 'hover' keeps the picture out of the way until the enclosing `.group` (the
   * post's header row) is pointed at; 'shown' always draws it; 'hidden' is for
   * guests, who have no picture to show.
   */
  avatar?: 'shown' | 'hover' | 'hidden';
  avatarSize?: number;
  /**
   * The colour the account chose for its username (`app/lib/profile/name-colours.ts`).
   * Left out, the name is drawn in the page's own black.
   */
  nameColour?: string;
  /**
   * Picture slot for a row that is not a person: a post owned by the item itself
   * is credited to the site, which has no profile to open but does have a default
   * pfp (`app/lib/forum/site-author.ts`).
   */
  picture?: string;
  /** The author's place line, when their profile sets one. */
  location?: string;
  /** Tags other users gave the author, filtered to the ones they display. */
  displayedTags?: GivenTag[];
};

/**
 * The "posted ... by ..." line that opens every post.
 *
 * Order matches the board's reading order: the stamp, the poster with their
 * picture, the place line, then the tags the author chose to display. Guests
 * fall back to a plain name with no picture, and the whole row drops its
 * decoration when collapsed (`avatar="hover"`).
 *
 * `picture` is for rows that are not a person at all: a post owned by the item
 * itself is credited to the site, so it draws the house default pfp instead of
 * an account's profile picture. `nameColour` is the swatch the account picked in
 * the customiser, so a username looks the same here as it does everywhere else.
 */
export default function PostAuthorRow({
  author,
  avatar = 'shown',
  avatarSize = 56,
  nameColour,
  picture,
  location = '',
  displayedTags = [],
}: PostAuthorRowProps) {
  const label = authorLabel(author);

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {avatar === 'hidden' ? null : (
        <span className={avatar === 'hover' ? 'hidden group-hover:inline-flex' : 'inline-flex'}>
          {picture === undefined ? (
            <ProfileAvatarLink author={author} size={avatarSize} showName={false} variant="plain" />
          ) : (
            <span
              className={AVATAR_PLAIN_FRAME}
              style={{ width: avatarSize, height: avatarSize }}
              title={`Default picture for ${label}: add ${picture} to the project assets folder.`}
            >
              <SheetImage
                src={picture}
                alt={`${label} default profile picture`}
                width={avatarSize}
                height={avatarSize}
                sizes={`${avatarSize}px`}
                compact
              />
            </span>
          )}
        </span>
      )}

      <ProfileLink author={author} className="text-xs font-bold">
        <ProfileName author={author} colour={nameColour}>
          {label}
        </ProfileName>
      </ProfileLink>

      {location.length === 0 ? null : (
        <span className="text-[10px] text-gray-700" title="Place line from this account's public profile">
          :: {location}
        </span>
      )}

      {displayedTags.length === 0 ? null : (
        <span className="inline-flex flex-wrap items-center gap-1">
          {displayedTags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              title={`Tag given by ${authorLabel(tag.givenBy)}`}
              className={tagChipClasses({ id: tag.id, kind: 'user', label: tag.label }, true)}
            >
              <TagMark colour={tagMarkColourFromColour(tag.colour ?? tagColour(tag.label))} compact />
              {tag.label}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
