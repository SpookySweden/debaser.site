'use client';

import { authorLabel } from '../lib/auth/author';
import type { ForumAuthor } from '../lib/forum/types';
import { tagColour } from '../lib/forum/tag-vocabulary';
import type { GivenTag } from '../lib/profile/types';
import ProfileAvatarLink from './ProfileAvatarLink';
import ProfileLink from './ProfileLink';
import { tagChipClasses, tagChipStyleFromColour } from './TagBadge';

type PostAuthorRowProps = {
  author: ForumAuthor;
  /**
   * 'hover' keeps the picture out of the way until the enclosing `.group` (the
   * post's header row) is pointed at; 'shown' always draws it; 'hidden' is for
   * guests, who have no picture to show.
   */
  avatar?: 'shown' | 'hover' | 'hidden';
  avatarSize?: number;
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
 */
export default function PostAuthorRow({
  author,
  avatar = 'shown',
  avatarSize = 56,
  location = '',
  displayedTags = [],
}: PostAuthorRowProps) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {avatar === 'hidden' ? null : (
        <span className={avatar === 'hover' ? 'hidden group-hover:inline-flex' : 'inline-flex'}>
          <ProfileAvatarLink author={author} size={avatarSize} showName={false} variant="plain" />
        </span>
      )}

      <ProfileLink author={author} className="text-xs font-bold">
        {authorLabel(author)}
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
              style={tagChipStyleFromColour(tag.colour ?? tagColour(tag.label))}
            >
              {tag.label}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
