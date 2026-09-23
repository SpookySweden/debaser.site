'use client';

import Link from 'next/link';
import { authorLabel } from '../lib/auth/author';
import type { ForumAuthor } from '../lib/forum/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { currentAvatarVersion } from '../lib/profile/visibility';
import ProfileAvatar from './ProfileAvatar';

type ProfileAvatarLinkProps = {
  author: ForumAuthor;
  /** Rendered edge length of the thumbnail. */
  size?: number;
  /** Show the display name next to the picture. */
  showName?: boolean;
  /** 'plain' drops the grey frame so the picture itself uses the space. */
  variant?: 'framed' | 'plain';
  /** Extra classes on the link (the board uses them to reveal it on hover). */
  className?: string;
};

/**
 * The clickable avatar that sits next to a post or a comment.
 *
 * Reading it through the profile repository means the picture the owner picked
 * in the customiser shows up everywhere their name appears. Guests have no
 * profile, so their posts keep the plain text name and the shared anonymous
 * placeholder avatar.
 */
export default function ProfileAvatarLink({
  author,
  size = 40,
  showName = true,
  variant = 'plain',
  className,
}: ProfileAvatarLinkProps) {
  const { profile } = usePublicProfile(author.id);
  const label = authorLabel(author);

  if (author.id === null) {
    return (
      <span className={`inline-flex items-center gap-1 align-middle ${className ?? ''}`}>
        <ProfileAvatar version={undefined} displayName={label} size={size} variant="plain" hideVersionLabel />
        {showName ? <span className="text-xs font-bold text-ink">{label}</span> : null}
      </span>
    );
  }

  return (
    <Link
      href={`/profile/${encodeURIComponent(author.id)}`}
      title={`Open ${label}'s public profile`}
      className={`inline-flex shrink-0 items-center gap-1 align-middle hover:bg-ice-pale ${className ?? ''}`}
    >
      <ProfileAvatar
        version={currentAvatarVersion(profile)}
        displayName={label}
        size={size}
        variant={variant}
        hideVersionLabel
      />
      {showName ? (
        <span className="text-xs font-bold text-ink underline decoration-dotted">{label}</span>
      ) : null}
    </Link>
  );
}
