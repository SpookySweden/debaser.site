import { INVITE_WINDOW_MS, type GameInvite } from './types';

/**
 * The invitations, sorted into the four things a screen does with them.
 *
 * Pure, so the hub draws what this says and the offline check can ask the same questions: which rows
 * are waiting for me, which are waiting for somebody else, which have been answered, and which have
 * been sitting there so long they are only history. An invitation is a knock on a door, so it stops
 * being one after `INVITE_WINDOW_MS` - the row is not deleted, it simply stops asking to be answered.
 */

export type SplitInvites = {
  /** Waiting on me: the ones with a button that starts a game. */
  incoming: GameInvite[];
  /** Waiting on somebody else: cancellable, and the ones that open themselves when answered. */
  sent: GameInvite[];
  /** Answered, either way: readable for a while, then cleared. */
  answered: GameInvite[];
  /** Answered too long ago to act on: shown as history and nothing more. */
  stale: GameInvite[];
};

export function isInviteFresh(invite: GameInvite, now: number = Date.now()): boolean {
  return now - Date.parse(invite.updatedAt) < INVITE_WINDOW_MS;
}

export function splitInvites(invites: GameInvite[], viewerId: string, now: number = Date.now()): SplitInvites {
  const split: SplitInvites = { incoming: [], sent: [], answered: [], stale: [] };

  for (const invite of invites) {
    if (invite.status !== 'pending') {
      (isInviteFresh(invite, now) ? split.answered : split.stale).push(invite);
      continue;
    }

    if (invite.toUserId === viewerId) split.incoming.push(invite);
    else if (invite.fromUserId === viewerId) split.sent.push(invite);
  }

  return split;
}

/** The opponent's name, from whichever side of the row is not the reader. */
export function opponentOf(invite: GameInvite, viewerId: string): string {
  return invite.fromUserId === viewerId ? invite.toName : invite.fromName;
}

/**
 * The opponent's account, from whichever side of the row is not the reader.
 *
 * The sibling of `opponentOf`, and the same derivation off the same pair of ids - one reads the name
 * and one reads the id, so a caller filing something against "the other account" cannot end up with
 * a name where an id belongs. `withUserId` on a game event is an id, which is why this exists rather
 * than a caller reaching into the row itself.
 */
export function opponentIdOf(invite: GameInvite, viewerId: string): string {
  return invite.fromUserId === viewerId ? invite.toUserId : invite.fromUserId;
}

/** One line for a row: what it is, and who it is with. */
export function inviteSummary(invite: GameInvite, viewerId: string, gameTitle: string): string {
  const mine = invite.fromUserId === viewerId;
  const verb = invite.status === 'pending' ? (mine ? 'SENT TO' : 'FROM') : invite.status === 'accepted' ? 'ACCEPTED WITH' : 'DECLINED WITH';

  return `${gameTitle} :: ${verb} ${opponentOf(invite, viewerId)}`;
}
