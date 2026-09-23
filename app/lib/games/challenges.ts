import { gameById } from './catalogue';
import { INVITE_WINDOW_MS, type GameId, type GameInvite, type GamesRepository } from './types';
import { presenceLabel, type PresenceStatus } from '../profile/presence';

/**
 * Asking somebody for a game, in one place.
 *
 * A challenge is two writes in one act: a row in the arcade's own table (`game_invites`, section 23
 * of `supabase/schema.sql`) and a line in the recipient's notification feed. The row has to exist
 * before anything tells anybody about it, and the bell is the tip rather than the tackle, so both
 * halves live here instead of in whichever screen happened to grow the button first.
 *
 * That is also what lets the same press be offered in more than one place - the roster on the
 * arcade floor, and a `[ CHALLENGE ]` on the post that names somebody (./ForumThreadCard.tsx) -
 * without the two drifting apart. Nothing here knows about React: the caller passes the store, the
 * bell, and who is asking, so this is a function the project's own checks can hold to the rules.
 */

/** The refusal a signed-out reader meets, wherever they meet it. */
export const CHALLENGE_SIGN_IN = 'SIGN IN FIRST: AN INVITATION IS FROM ONE ACCOUNT TO ANOTHER.';

/** The refusal for asking yourself, which the store's own constraint also refuses. */
export const CHALLENGE_SELF = 'AN INVITATION GOES TO SOMEBODY ELSE - THE ARCADE WILL NOT LET YOU PLAY YOURSELF.';

/** How long an unanswered invitation is good for, in the words the plate and the window both use. */
const INVITE_WINDOW_MINUTES = Math.round(INVITE_WINDOW_MS / (60 * 1000));

/**
 * Why an account cannot be asked right now.
 *
 * A match opens on both screens at once, so the only honest time to ask is while they are on - and
 * the plate that offers it is dark with this sentence rather than hidden, because a verb that
 * disappears teaches nobody what the arcade does. The lamp's own words are used for the state
 * (`presenceLabel`), so the tooltip, the directory and this line cannot disagree.
 */
export function challengeOfflineReason(displayName: string, status: PresenceStatus): string {
  return `${displayName.toUpperCase()} IS ${presenceLabel(status)} - A MATCH NEEDS BOTH SCREENS, AND AN INVITATION LASTS ${INVITE_WINDOW_MINUTES} MINUTES.`;
}

/**
 * Null when the account can be challenged, or the one sentence saying why not.
 *
 * Every surface asks this before it draws or sends anything, so the reason a control is dark and
 * the reason a window refuses are the same words.
 */
export function challengeRefusal(input: {
  /** The account doing the asking, or null for a guest. */
  viewerId: string | null;
  targetId: string;
  targetName: string;
  /** The account's lamp, as the directory reads it. */
  status: PresenceStatus;
}): string | null {
  if (input.viewerId === null) return CHALLENGE_SIGN_IN;
  if (input.viewerId === input.targetId) return CHALLENGE_SELF;

  return input.status === 'online' ? null : challengeOfflineReason(input.targetName, input.status);
}

/** The bell's half: `NotificationsProvider.notifyInvited`, passed in rather than imported. */
export type ChallengeNotifier = (input: {
  inviteId: string;
  gameId: GameId;
  gameTitle: string;
  body: string;
  toUserId: string;
}) => Promise<void>;

/**
 * What came of the press: the row and a line about it, or the sentence saying why not.
 *
 * Read it with `outcome.ok === false`, never `!outcome.ok`: a plain negation only narrows a union
 * when the compiler is in strict mode, and several of this project's checks compile components
 * without it (`Temp/check-games-render.cjs` is one).
 */
export type ChallengeOutcome =
  | { ok: true; invite: GameInvite; notice: string }
  | { ok: false; error: string };

/**
 * Files the invitation and rings the bell.
 *
 * The failure that matters is the one in the middle: an account told "the store did not answer"
 * about an invitation that *was* filed would be lied to, and the row is the whole of the challenge
 * (both sides read it, and the match opens from it), so only the alert is lost when the feed
 * hiccups.
 */
export async function sendChallenge(input: {
  repository: Pick<GamesRepository, 'create'>;
  notify: ChallengeNotifier;
  /** The account asking, or null for a guest - who has no row to sign. */
  from: { id: string; displayName: string } | null;
  to: { id: string; displayName: string };
  game: GameId;
}): Promise<ChallengeOutcome> {
  const { from, game, notify, repository, to } = input;

  if (from === null) return { ok: false, error: CHALLENGE_SIGN_IN };

  const entry = gameById(game);

  try {
    // The row first, the bell second, and never the other way round.
    const invite = await repository.create({ game, from, to });

    try {
      await notify({
        inviteId: invite.id,
        gameId: game,
        gameTitle: entry.title,
        body: entry.tagline,
        toUserId: to.id,
      });
    } catch (caught) {
      console.warn('challenge: the invitation was filed, but the bell could not be told', caught);
    }

    return { ok: true, invite, notice: `${entry.title} SENT TO ${to.displayName.toUpperCase()}.` };
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : 'THE ARCADE STORE DID NOT ANSWER.',
    };
  }
}
