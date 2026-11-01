import Link from 'next/link';
import type { ReactNode } from 'react';
import { authorLabel } from '../lib/auth/author';
import type { ForumAuthor } from '../lib/forum/types';

type ProfileLinkProps = {
  author: ForumAuthor;
  /** Defaults to the author's display name. */
  children?: ReactNode;
  className?: string;
};

/**
 * A username that opens its public profile.
 *
 * Guests post without an account (`id: null`), so those names stay plain text -
 * there is no profile to open. Account posts link to `/profile/<id>`, which is
 * the page the customiser styles.
 */
export default function ProfileLink({ author, children, className }: ProfileLinkProps) {
  const label = authorLabel(author);

  if (author.id === null) {
    return <span className={className}>{children ?? label}</span>;
  }

  return (
    <Link
      href={`/profile/${encodeURIComponent(author.id)}`}
      title={`Open ${label}'s public profile`}
      className={`underline decoration-dotted hover:bg-ice ${className ?? ''}`}
    >
      {children ?? label}
    </Link>
  );
}
