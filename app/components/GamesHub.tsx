'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ARCADE_DEFAULT_GAME, type ArcadeFocus } from '../lib/games/arcade-window';
import { gameById, GAME_CATALOGUE } from '../lib/games/catalogue';
import { answerChallenge, challengeRefusal, sendChallenge } from '../lib/games/challenges';
import { inviteSummary, opponentIdOf, opponentOf, splitInvites } from '../lib/games/invites';
import { getGamesRepository } from '../lib/games/repository';
import type { GameId, GameInvite } from '../lib/games/types';
import { buildUserDirectory } from '../lib/profile/directory';
import { PANEL, PLATE, PLATE_LARGE, PLATE_LINK, PLATE_PRESSED, TITLE_BAR, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useComms } from './CommsProvider';
import GameMatch from './GameMatch';
import { useNotifications } from './NotificationsProvider';
import { usePresenceDirectory } from './PresenceProvider';
import UserDirectoryRow from './UserDirectoryRow';

/** What the arcade window was opened to do. */
type GamesHubProps = {
  /** The floor, unless it was opened for an invitation or for an account to ask. */
  focus?: ArcadeFocus;
};

/**
 * The arcade floor: what there is to play, who is around to play it with, and the invitations
 * between the two.
 *
 * This is the screen inside the arcade window (./ArcadeWindow.tsx), and the window is the only way
 * in: the arcade is not a page any more, because asking somebody for a game should not cost a reader
 * the thread they were reading. `focus` is what the window was opened to do, and when it is an
 * account to ask, a `CHALLENGE` panel leads the screen - that is what the reader pressed for, and
 * the invitation is the next press.
 *
 * Three panels and a game, stacked on a phone and in one column here on purpose - the screen is read
 * top to bottom in the order it is used (pick a game, pick a player, answer a knock, play), and a
 * phone gets exactly that order with nothing beside anything. Every control is a plate from
 * `lib/ui/controls`, so the arcade is the same furniture as the rest of the site.
 *
 * The two stores meet here and nowhere else: the invitation is written to the arcade's own table
 * (section 23) and the alert to the notification feed, in that order, so the row exists before
 * anything tells anybody about it. That pair lives in `lib/games/challenges.ts`, so this screen and
 * the plate that opened it cannot file an invitation two different ways.
 */
export default function GamesHub({ focus = { kind: 'floor' } }: GamesHubProps) {
  const { user } = useAuth();
  const { accounts, allAccounts, recordGameEvent } = useComms();
  const presence = usePresenceDirectory();
  const { notifyInvited } = useNotifications();
  const repository = useMemo(() => getGamesRepository(), []);

  const userId = user?.id ?? null;
  const me = useMemo(() => ({ id: userId ?? 'guest', displayName: user?.displayName ?? 'Anonymous' }), [user, userId]);

  const [invites, setInvites] = useState<GameInvite[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The game a press would send: the one the window was opened on, or the catalogue's first. */
  const [chosen, setChosen] = useState<GameId>(focus.kind === 'challenge' ? focus.game : ARCADE_DEFAULT_GAME);
  /** The match on screen: an invitation, or null. `solo` is the same screen without one. */
  const [match, setMatch] = useState<GameInvite | null>(null);
  const [solo, setSolo] = useState<GameId | null>(null);
  const answered = useRef(false);

  /**
   * The game an invitation would be for: the card drawn `[ PICKED ]`. Each card's own keys are the only
   * game chooser now - the second row of game plates (`PLAYING:` / `INVITE THEM TO:`) said the same
   * choice again - so its name is read back where an invitation is sent from.
   */
  const picked = gameById(chosen);

  /**
   * An answer to an invitation: the row moves, and both sides see it move.
   *
   * Accepting opens the match on the spot (the answer *is* the entry), while declining and cancelling
   * only move the row - there is nothing to open.
   *
   * The answer is also a line in the conversation, which is what `answerChallenge` files. The row
   * moves first, because that is the fact both sides are watching; the line is the record of it. If
   * the record fails it is a warning inside `answerChallenge` and not an error here: the game did
   * start, and telling the player their acceptance did not happen when it did would be a lie.
   */
  const answer = useCallback(
    async (invite: GameInvite, status: 'accepted' | 'declined') => {
      setBusy(invite.id);
      setError(null);

      try {
        await repository.setStatus(invite.id, status);

        await answerChallenge({
          record: recordGameEvent,
          from: userId === null ? null : { id: userId },
          withUserId: opponentIdOf(invite, userId ?? me.id),
          inviteId: invite.id,
          game: invite.game,
        });

        if (status === 'accepted') {
          setSolo(null);
          setMatch({ ...invite, status });
        } else {
          setNotice(`${opponentOf(invite, userId ?? me.id)} DECLINED. NO HARD FEELINGS.`);
        }
      } catch (caught: unknown) {
        setError(caught instanceof Error ? caught.message : 'THE ARCADE STORE DID NOT ANSWER.');
      } finally {
        setBusy(null);
      }
    },
    [me.id, recordGameEvent, repository, userId],
  );

  /** The invitation the window was opened on, if it was opened from a link that names one. */
  const wantedInviteId = focus.kind === 'invite' ? focus.inviteId : null;

  /**
   * The read, the subscription, and the two ways a match opens by itself.
   *
   * Everything that writes state here does it in a callback rather than in the effect body: the
   * invitation the window was opened on (the bell's link, or a `?invite=<id>` address) opens on the
   * first read, and one that is answered while the window is open opens when the answer arrives over
   * realtime - which is the half that makes an invitation a game rather than a message. A signed-out
   * reader is left with nothing to read instead of an empty list written into state.
   */
  useEffect(() => {
    if (userId === null) return;

    let cancelled = false;

    void repository
      .list(userId)
      .then((next) => {
        if (cancelled) return;

        setInvites(next);
        setReady(true);

        if (answered.current || wantedInviteId === null) return;

        const found = next.find((row) => row.id === wantedInviteId);
        if (found === undefined) return;

        answered.current = true;

        if (found.status === 'accepted') setMatch(found);
        else if (found.status === 'pending' && found.toUserId === userId) void answer(found, 'accepted');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;

        setReady(true);
        setError(caught instanceof Error ? caught.message : 'THE ARCADE STORE DID NOT ANSWER.');
      });

    const stop = repository.subscribe(userId, (next) => {
      if (cancelled) return;

      setInvites(next);

      // Answered while this page is open: the sender is sitting here, so the board appears under
      // them. Only one match is on screen at a time, so an open one is never replaced.
      const joined = next.find(
        (invite) => invite.status === 'accepted' && (invite.fromUserId === userId || invite.toUserId === userId),
      );

      if (joined !== undefined) setMatch((current) => current ?? joined);
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [answer, repository, userId, wantedInviteId]);

  /** A signed-out reader has no invitations to read, whatever the last store answer said. */
  const visible = useMemo(() => (userId === null ? [] : invites), [invites, userId]);
  const loaded = ready || userId === null;

  /**
   * Asks one account for a game.
   *
   * The invitation and the bell are one act, so both halves live in `lib/games/challenges`: this
   * decides which game and who, and reports what came of it - which is what keeps this roster's
   * button and the `[ CHALLENGE ]` a post carries (./ForumThreadCard.tsx) the same press.
   */
  async function invitePlayer(player: { id: string; displayName: string }) {
    setBusy(player.id);
    setError(null);

    try {
      const outcome = await sendChallenge({
        repository,
        notify: notifyInvited,
        record: recordGameEvent,
        from: userId === null ? null : { id: userId, displayName: me.displayName },
        to: { id: player.id, displayName: player.displayName },
        game: chosen,
      });

      // `=== false` rather than `!outcome.ok`: a plain negation only narrows a union when the
      // compiler is in strict mode, and several of this project's checks compile without it (the
      // same reason `attachLink` reads its refusal back this way).
      if (outcome.ok === false) setError(outcome.error);
      else setNotice(outcome.notice);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Off the board for both sides: the sender's cancel, and clearing an answered row.
   *
   * `answered: false` tells `answerChallenge` this was called off rather than decided, which is a
   * different line in the conversation - a challenge that never happened, not one that was turned
   * down. The row goes first: a cancel that failed to remove the invitation but did file a line
   * saying it was gone would be the worse of the two orders.
   */
  async function drop(invite: GameInvite) {
    setBusy(invite.id);
    setError(null);

    try {
      await repository.remove(invite.id);

      await answerChallenge({
        record: recordGameEvent,
        from: userId === null ? null : { id: userId },
        withUserId: opponentIdOf(invite, userId ?? me.id),
        inviteId: invite.id,
        game: invite.game,
        answered: false,
      });

      setMatch((current) => (current?.id === invite.id ? null : current));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'THE ARCADE STORE DID NOT ANSWER.');
    } finally {
      setBusy(null);
    }
  }

  const split = useMemo(() => splitInvites(visible, userId ?? ''), [userId, visible]);

  /** Who is around: the same directory the site draws everywhere, narrowed to its green lamp. */
  const around = useMemo(
    () =>
      buildUserDirectory({
        accounts,
        statusFor: presence.statusFor,
        recordFor: presence.recordFor,
        viewerId: userId,
      }).filter((row) => row.status === 'online' && !row.you),
    [accounts, presence.recordFor, presence.statusFor, userId],
  );

  /**
   * The account the window was opened to ask, or null when it was not opened for one.
   *
   * The name is read from the account list rather than from the address, so a hand-written
   * `?challenge=<id>` link cannot label somebody as somebody else - the whole list, so a hidden test
   * account reached by its link still has its name. An id the list has never heard of is still
   * askable - the store knows both accounts - and falls back to the id itself.
   */
  const challengeOpponent = useMemo(() => {
    if (focus.kind !== 'challenge') return null;

    return {
      id: focus.opponentId,
      displayName: allAccounts.find((account) => account.id === focus.opponentId)?.displayName ?? focus.opponentId,
    };
  }, [allAccounts, focus]);

  /** Why the invitation cannot be sent yet, or null when it can: `lib/games/challenges.ts` decides. */
  const challengeRefusalText =
    challengeOpponent === null
      ? null
      : challengeRefusal({
          viewerId: userId,
          targetId: challengeOpponent.id,
          targetName: challengeOpponent.displayName,
          status: presence.statusFor(challengeOpponent.id),
        });

  return (
    <div className="space-y-3">
      {error === null ? null : (
        <p className="w-fit bg-bubble-pale px-2 py-1 text-label font-bold text-ink-bar">{error}</p>
      )}
      {notice === null ? null : (
        <p className="px-2 py-1 text-label font-bold text-ink">{notice}</p>
      )}

      {/* What the window was opened to do, when a post's `[ CHALLENGE ]` opened it: the account is
          already addressed and the game is already chosen, so the reader's next press is the
          invitation itself. The panel is navy because it is the thing being done, the same rule the
          match window keeps. How it works is the title line's tip; the game it will send sits at the
          title line's end, and a card's `[ INVITE SOMEONE ]` below changes it. */}
      {challengeOpponent === null ? null : (
        <section className={PANEL}>
          <div className={TITLE_BAR}>
            <span
              className="truncate"
              title={`ASK ${challengeOpponent.displayName.toUpperCase()} FOR A GAME. THE BOARD OPENS ON BOTH SCREENS THE MOMENT THEY ANSWER, AND THE BELL TELLS THEM IT IS WAITING.`}
            >
              CHALLENGE // {challengeOpponent.displayName.toUpperCase()}
            </span>
            <span className="truncate">{picked.title}</span>
          </div>

          <div className="space-y-2 p-2 text-label font-bold text-ink">
            <p className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={PLATE_LARGE}
                disabled={busy !== null || challengeRefusalText !== null}
                onClick={() => void invitePlayer(challengeOpponent)}
              >
                {busy === challengeOpponent.id ? '[ ASKING... ]' : '[ SEND INVITATION ]'}
              </button>

              {challengeRefusalText === null ? null : (
                <span className="bg-bubble-pale px-1 text-ink-bar box-decoration-clone">{challengeRefusalText}</span>
              )}
            </p>
          </div>
        </section>
      )}

      {solo === null && match === null ? null : (
        <GameMatch
          key={match?.id ?? `solo-${solo ?? ''}`}
          game={match?.game ?? (solo as GameId)}
          invite={match}
          me={me}
          onLeave={() => {
            setMatch(null);
            setSolo(null);
          }}
        />
      )}

      {/* `GAMES` rather than `ARCADE n GAMES`: the window is already titled ARCADE, and the cards are
          right below to be counted (SPEC-efficiency.md). */}
      <section className={PANEL}>
        <div className={TITLE_BAR_INACTIVE}>
          <span>GAMES</span>
        </div>

        <div className="grid gap-2 p-2 sm:grid-cols-2">
          {GAME_CATALOGUE.map((game) => (
            // Who plays and how is the card's tip; a running match keeps its controls line on screen.
            <div key={game.id} className="p-2" title={`${game.players} :: ${game.controls}`}>
              <p className="flex items-center gap-2 text-key font-bold text-ink">
                {/* Navy or Rose in both themes, so the bar ink; `text-paper` went Nigrosine in the dark one. */}
                <span className={`px-1 text-label text-ink-bar ${game.badge}`}>
                  {game.id === 'tic-tac-toe' ? 'X/O' : 'DUEL'}
                </span>
                {game.title}
              </p>
              <p className="mt-1 text-label text-ink">{game.tagline}</p>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={PLATE}
                  onClick={() => {
                    setMatch(null);
                    setSolo(game.id);
                  }}
                >
                  [ PLAY SOLO ]
                </button>
                <button type="button" className={chosen === game.id ? PLATE_PRESSED : PLATE} disabled={chosen === game.id} onClick={() => setChosen(game.id)}>
                  {chosen === game.id ? '[ PICKED ]' : '[ INVITE SOMEONE ]'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>


      <section className={PANEL}>
        <div className={TITLE_BAR_INACTIVE}>
          <span>INVITATIONS</span>
          <span>
            {split.incoming.length > 0 ? `${split.incoming.length} WAITING ON YOU` : split.sent.length > 0 ? `${split.sent.length} WAITING` : 'NOTHING WAITING'}
          </span>
        </div>

        <div className="space-y-2 p-2">
          {!loaded ? <p className="text-label text-ink">READING THE ARCADE STORE...</p> : null}

          {loaded && visible.length === 0 ? (
            <p className="text-label text-ink">No invitations either way. Pick a game above, then somebody below.</p>
          ) : null}

          {split.incoming.map((invite) => (
            <InviteLine
              key={invite.id}
              text={inviteSummary(invite, userId ?? '', gameById(invite.game).title)}
              tone="firm"
              actions={[
                { label: '[ ACCEPT ]', run: () => void answer(invite, 'accepted'), busy: busy === invite.id },
                { label: '[ DECLINE ]', run: () => void answer(invite, 'declined'), busy: busy === invite.id },
              ]}
            />
          ))}

          {split.sent.map((invite) => (
            <InviteLine
              key={invite.id}
              text={inviteSummary(invite, userId ?? '', gameById(invite.game).title)}
              tone="plain"
              actions={[{ label: '[ CANCEL ]', run: () => void drop(invite), busy: busy === invite.id }]}
            />
          ))}

          {split.answered.map((invite) => (
            <InviteLine
              key={invite.id}
              text={inviteSummary(invite, userId ?? '', gameById(invite.game).title)}
              tone="plain"
              actions={[
                ...(invite.status === 'accepted'
                  ? [{ label: '[ OPEN ]', run: () => setMatch(invite), busy: false }]
                  : []),
                { label: '[ CLEAR ]', run: () => void drop(invite), busy: busy === invite.id },
              ]}
            />
          ))}

          {split.stale.map((invite) => (
            <InviteLine
              key={invite.id}
              text={`${inviteSummary(invite, userId ?? '', gameById(invite.game).title)} (OLD)`}
              tone="faint"
              actions={[{ label: '[ CLEAR ]', run: () => void drop(invite), busy: busy === invite.id }]}
            />
          ))}
        </div>
      </section>

      <section className={PANEL}>
        <div className={TITLE_BAR_INACTIVE}>
          <span>WHO IS AROUND</span>
          <span>{around.length} ONLINE</span>
        </div>

        <div className="space-y-2 p-2">
          {/* The game is picked on its card above (`[ INVITE SOMEONE ]`), so there is no second row of
              game plates here; each `[ INVITE TO GAME ]` names the picked game in its tip. */}
          {userId === null ? (
            <p className="text-label text-ink">
              <Link href="/account" className={PLATE_LINK}>
                [ LOG IN ]
              </Link>{' '}
              TO INVITE ANYBODY
            </p>
          ) : null}

          {userId !== null && around.length === 0 ? (
            <p className="text-label text-ink">Nobody else is on. Both players have to be here, so try solo meanwhile.</p>
          ) : null}

          {around.length === 0 ? null : (
            <ul className="overflow-hidden text-ink">
              {around.map((row) => (
                <UserDirectoryRow
                  key={row.account.id}
                  row={row}
                  viewerId={userId}
                  actions={
                    <button
                      type="button"
                      className={PLATE}
                      disabled={busy === row.account.id}
                      title={`Invite ${row.account.displayName} to ${picked.title}`}
                      onClick={() => void invitePlayer({ id: row.account.id, displayName: row.account.displayName })}
                    >
                      {busy === row.account.id ? '[ ASKING... ]' : '[ INVITE TO GAME ]'}
                    </button>
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/** One invitation, as a row: what it is, and the one or two things it can be answered with. */
function InviteLine({
  text,
  tone,
  actions,
}: {
  text: string;
  tone: 'firm' | 'plain' | 'faint';
  actions: { label: string; run: () => void; busy: boolean }[];
}) {
  const frame =
    tone === 'firm'
      ? 'bg-paper text-ink'
      : tone === 'plain'
        ? 'bg-bubble-pale text-ink-bar [--key-ink:var(--color-ink-bar)] [--key-hover-ink:var(--color-bubble-pale)] [--key-quiet-ink:var(--color-ink-bar)]'
        : 'bg-bubble-pale text-ink-bar [--key-ink:var(--color-ink-bar)] [--key-hover-ink:var(--color-bubble-pale)] [--key-quiet-ink:var(--color-ink-bar)]';

  // No outline (a box inside a section); the Rose lines set White for the keys on them.
  return (
    <div className={`flex flex-wrap items-center gap-2 px-2 py-1 text-label font-bold ${frame}`}>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {actions.map((action) => (
        <button key={action.label} type="button" className={PLATE} disabled={action.busy} onClick={action.run}>
          {action.label}
        </button>
      ))}
    </div>
  );
}
