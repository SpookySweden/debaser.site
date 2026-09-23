'use client';

import { authorLabel } from '../lib/auth/author';
import { ARCADE_DEFAULT_GAME, openArcade } from '../lib/games/arcade-window';
import { challengeRefusal } from '../lib/games/challenges';
import type { ForumAuthor } from '../lib/forum/types';
import type { PresenceStatus } from '../lib/profile/presence';
import { PLATE } from '../lib/ui/controls';

type ChallengeControlProps = {
  /** The account the post is credited to. */
  author: ForumAuthor;
  /** The account doing the reading, or null for a guest. */
  viewerId: string | null;
  /** The account's lamp, as the directory reads it (`lib/profile/presence.ts`). */
  status: PresenceStatus;
};

/**
 * `[ CHALLENGE ]`: ask the account a post names for a game, from the post itself.
 *
 * The arcade used to be the only place to ask, which meant leaving the conversation, walking to the
 * arcade, and hoping the account was in the roster of whoever happened to be online when you got
 * there. The verb belongs where the account is named.
 *
 * One press opens the arcade window with that account already addressed (./ArcadeWindow.tsx); the
 * second sends it. The plate is dark rather than hidden while they are not on, with
 * `challengeRefusal`'s sentence as its tooltip - a verb that vanishes teaches nobody what the arcade
 * does - and it is not drawn at all for a guest (who has no row to sign) or on your own post, which
 * is the same rule the account directory's `[ MESSAGE ]` keeps.
 */
export default function ChallengeControl({ author, status, viewerId }: ChallengeControlProps) {
  const targetId = author.id;
  if (targetId === null || viewerId === null || viewerId === targetId) return null;

  const label = authorLabel(author);
  const refusal = challengeRefusal({ viewerId, targetId, targetName: label, status });

  return (
    <button
      type="button"
      disabled={refusal !== null}
      title={refusal ?? `Ask ${label} for a game: the arcade opens over this thread`}
      onClick={() => openArcade({ kind: 'challenge', opponentId: targetId, game: ARCADE_DEFAULT_GAME })}
      className={PLATE}
    >
      [ CHALLENGE ]
    </button>
  );
}
