'use client';

import { inkOnNameColour } from '../lib/profile/name-colours';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { currentAvatarVersion } from '../lib/profile/visibility';

type DocFaceProps = {
  name: string;
  colour: string;
  userId: string | null;
  /** Adds "(YOU)" for this tab's own face. */
  self?: boolean;
};

/**
 * A person in a document: their profile picture (20px) and name on a tag filled with their name colour,
 * the words in whichever of Black or White reads on it - so it reads on every theme. The same tag rides
 * their caret (../lib/docs/people.ts draws that one, outside React) and their pointer.
 */
export default function DocFace({ name, colour, userId, self = false }: DocFaceProps) {
  const { profile } = usePublicProfile(userId);
  const src = currentAvatarVersion(userId === null ? null : profile)?.src;
  const picture = typeof src === 'string' && (src.startsWith('/') || src.startsWith('https://')) ? src : null;

  return (
    <span className="doc-face" style={{ backgroundColor: colour, color: inkOnNameColour(colour) }}>
      <span className={picture === null ? 'doc-face__picture' : 'doc-face__picture doc-face__picture--drawn'} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a 20px profile picture from the profile's own address */}
        {picture === null ? null : <img src={picture} alt="" width={20} height={20} loading="lazy" />}
      </span>
      {self ? `${name} (YOU)` : name}
    </span>
  );
}
