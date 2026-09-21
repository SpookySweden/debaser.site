'use client';

import type { ReactNode } from 'react';
import { authorLabel } from '../lib/auth/author';
import { showsPresenceLamp } from '../lib/auth/builtin-account';
import type { ForumAuthor } from '../lib/forum/types';
import { profileNameColour } from '../lib/profile/name-colours';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { usePresence } from './PresenceProvider';
import StatusDot from './StatusDot';

type ProfileNameProps = {
  author: ForumAuthor;
  /** Defaults to the author's display name. */
  children?: ReactNode;
  className?: string;
  /**
   * The swatch colour to draw, when the caller already knows it (the board's post
   * row does - it reads it with the author's profile). Left out, the colour comes
   * from the author's own profile, which is where every other caller gets it.
   */
  colour?: string;
};

/**
 * A username: the lamp beside it, and the colour its account picked.
 *
 * Reading the profile here means the colour follows the name everywhere it is
 * printed, and a visitor's browser sees a change as soon as the owner saves it.
 * The lamp comes from `usePresence`, so green / yellow / red follow presence the
 * same way. Guests have neither: an anonymous post has no profile and no account
 * to be online with.
 */
export default function ProfileName({ author, children, className, colour }: ProfileNameProps) {
  const { profile } = usePublicProfile(author.id);
  const { status, record } = usePresence(author.id);
  const chosen = colour !== undefined && colour.length > 0 ? colour : profileNameColour(profile);
  // The house account is the archive's byline rather than somebody who steps away,
  // so `showsPresenceLamp` keeps the dot off it - see ./builtin-account.ts.
  const showsLamp = showsPresenceLamp(author.id);

  return (
    <span className={className} style={chosen === undefined ? undefined : { color: chosen }}>
      {showsLamp && status !== undefined ? <StatusDot status={status} record={record} className="mr-1" /> : null}
      {children ?? authorLabel(author)}
    </span>
  );
}
