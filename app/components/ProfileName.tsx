'use client';

import type { ReactNode } from 'react';
import { authorLabel } from '../lib/auth/author';
import type { ForumAuthor } from '../lib/forum/types';
import { profileNameColour } from '../lib/profile/name-colours';
import { usePublicProfile } from '../lib/profile/use-public-profile';

type ProfileNameProps = {
  author: ForumAuthor;
  /** Defaults to the author's display name. */
  children?: ReactNode;
  className?: string;
};

/**
 * A username drawn in the colour its account picked in the customiser.
 *
 * Reading the profile here means the colour follows the name everywhere it is
 * printed, and a visitor's browser sees the change as soon as the owner saves it.
 * Guests have no profile, so their names stay the page's own black.
 */
export default function ProfileName({ author, children, className }: ProfileNameProps) {
  const { profile } = usePublicProfile(author.id);
  const colour = profileNameColour(profile);

  return (
    <span className={className} style={colour === undefined ? undefined : { color: colour }}>
      {children ?? authorLabel(author)}
    </span>
  );
}
