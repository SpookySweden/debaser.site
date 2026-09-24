import { gameById } from './catalogue';
import { gameEvent } from './events';
import { INVITE_WINDOW_MS, type GameId, type GameInvite, type GamesRepository } from './types';
import type { CommsEvent } from '../comms/types';
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
 * The conversation's half: the same fact written into the DM between the two accounts.
 *
 * A challenge is news between two people, and the conversation is where they already read their news -
 * so it is filed there as a message (`lib/comms/types.ts`, `CommsEvent`), which is what makes "who
 * asked me for a game, and what did I say" answerable in the thread rather than only in the arcade.
 *
 * Passed in rather than imported, for the same reason the bell is: nothing in this file knows about
 * React, and the checks can hold the whole act to its rules without mounting a provider.
 */
export type GameEventRecorder = (input: {
  /** The account the event is with - the other half of the DM. */
  withUserId: string;
  event: CommsEvent;
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
 * Files the invitation: the row, the conversation line, and the bell.
 *
 * The failure that matters is the one in the middle: an account told "the store did not answer" about
 * an invitation that *was* filed would be lied to, and the row is the whole of the challenge (both
 * sides read it, and the match opens from it), so only the later halves are lost when they hiccup.
 *
 * Order is the point. The row goes first because everything else refers to it by id. The conversation
 * line goes second because it is the *record* - a reader scrolling back has to find the challenge
 * between the messages either side of it, so it wants to be in the thread before any answer to it can
 * be. The bell goes last, because a bell is a tip rather than a tackle: a challenge that is filed and
 * unannounced is a missed alert, and one that is announced and unfiled is a lie.
 */
export async function sendChallenge(input: {
  repository: Pick<GamesRepository, 'create'>;
  notify: ChallengeNotifier;
  /** Writes the line into the conversation between the two accounts. */
  record?: GameEventRecorder;
  /** The account asking, or null for a guest - who has no row to sign. */
  from: { id: string; displayName: string } | null;
  to: { id: string; displayName: string };
  game: GameId;
}): Promise<ChallengeOutcome> {
  const { from, game, notify, record, repository, to } = input;

  if (from === null) return { ok: false, error: CHALLENGE_SIGN_IN };

  const entry = gameById(game);

  try {
    // The row first, and never any of the later halves before it.
    const invite = await repository.create({ game, from, to });

    try {
      await record?.({
        withUserId: to.id,
        event: gameEvent('invite', game, invite.id),
      });
    } catch (caught) {
      console.warn('challenge: the invitation was filed, but the conversation line was not', caught);
    }

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

/**
 * Files what became of an invitation, into the same two places the invitation went.
 *
 * A challenge has a life after it is sent - taken up, turned down, or called off - and each of those is
 * as much a line in the conversation as the challenge itself was. Kept here beside `sendChallenge` so
 * the two ends of an invitation are written by the same file and read by the same reader.
 *
 * There is no bell on this side. The account that answered already knows what it answered, and the one
 * that asked is watching the arcade; a notification for "they said yes to the thing you are looking at"
 * is noise. The conversation is where the record belongs, and the record is all this writes.
 */
export async function answerChallenge(input: {
  record: GameEventRecorder | undefined;
  /** The account asking, or null for a guest - who has no row to sign. */
  from: { id: string } | null;
  /** The account on the other end of the conversation the line is filed in. */
  withUserId: string;
  inviteId: string;
  game: GameId;
  /** False when the challenge was called off rather than answered. */
  answered?: boolean;
}): Promise<void> {
  const { answered = true, from, game, inviteId, record, withUserId } = input;

  if (from === null) return;

  try {
    await record?.({
      withUserId,
      event: gameEvent(answered ? 'answer' : 'cancel', game, inviteId),
    });
  } catch (caught) {
    console.warn('challenge: the answer was filed in the arcade, but not in the conversation', caught);
  }
}
