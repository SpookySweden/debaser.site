'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gameById, GAME_CATALOGUE } from '../lib/games/catalogue';
import { inviteSummary, opponentOf, splitInvites } from '../lib/games/invites';
import { getGamesRepository } from '../lib/games/repository';
import type { GameId, GameInvite } from '../lib/games/types';
import { buildUserDirectory } from '../lib/profile/directory';
import { FIELD_TIGHT, PANEL, PLATE, PLATE_PRESSED, STATUS_BAR, TITLE_BAR_INACTIVE } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import { useComms } from './CommsProvider';
import GameMatch from './GameMatch';
import { useNotifications } from './NotificationsProvider';
import { usePresenceDirectory } from './PresenceProvider';
import UserDirectoryRow from './UserDirectoryRow';

/**
 * The arcade floor: what there is to play, who is around to play it with, and the invitations
 * between the two.
 *
 * Three panels and a game, stacked on a phone and in one column here on purpose - the page is read
 * top to bottom in the order it is used (pick a game, pick a player, answer a knock, play), and a
 * phone gets exactly that order with nothing beside anything. Every control is a plate from
 * `lib/ui/controls`, so the arcade is the same furniture as the rest of the site.
 *
 * The two stores meet here and nowhere else: the invitation is written to the arcade's own table
 * (section 23) and the alert to the notification feed, in that order, so the row exists before
 * anything tells anybody about it.
 */
export default function GamesHub() {
  const { user } = useAuth();
  const { accounts } = useComms();
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
  const [chosen, setChosen] = useState<GameId>('tic-tac-toe');
  /** The match on screen: an invitation, or null. `solo` is the same screen without one. */
  const [match, setMatch] = useState<GameInvite | null>(null);
  const [solo, setSolo] = useState<GameId | null>(null);
  const answered = useRef(false);

  /** The game the chooser beside the roster is pointing at. */
  const picked = gameById(chosen);

  /**
   * An answer to an invitation: the row moves, and both sides see it move.
   *
   * Accepting opens the match on the spot (the answer *is* the entry), while declining and cancelling
   * only move the row - there is nothing to open.
   */
  const answer = useCallback(
    async (invite: GameInvite, status: 'accepted' | 'declined') => {
      setBusy(invite.id);
      setError(null);

      try {
        await repository.setStatus(invite.id, status);
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
    [me.id, repository, userId],
  );

  /**
   * The read, the subscription, and the two ways a match opens by itself.
   *
   * Everything that writes state here does it in a callback rather than in the effect body: the
   * invitation that answers the bell's `?invite=<id>` link opens on the first read, and one that is
   * answered while this page is open opens when the answer arrives over realtime - which is the half
   * that makes an invitation a game rather than a message. A signed-out reader is left with nothing
   * to read instead of an empty list written into state.
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

        if (answered.current) return;

        const wanted = new URLSearchParams(window.location.search).get('invite');
        const found = next.find((row) => row.id === wanted);
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
  }, [answer, repository, userId]);

  /** A signed-out reader has no invitations to read, whatever the last store answer said. */
  const visible = useMemo(() => (userId === null ? [] : invites), [invites, userId]);
  const loaded = ready || userId === null;

  /** Asks one account for a game, and tells them through the bell every other row uses. */
  async function invitePlayer(player: { id: string; displayName: string }) {
    if (userId === null) {
      setError('SIGN IN FIRST: AN INVITATION IS FROM ONE ACCOUNT TO ANOTHER.');
      return;
    }

    const entry = gameById(chosen);
    setBusy(player.id);
    setError(null);

    try {
      const invite = await repository.create({
        game: chosen,
        from: { id: userId, displayName: me.displayName },
        to: { id: player.id, displayName: player.displayName },
      });

      setNotice(`${entry.title} SENT TO ${player.displayName.toUpperCase()}.`);
      await notifyInvited({
        inviteId: invite.id,
        gameId: chosen,
        gameTitle: entry.title,
        body: entry.tagline,
        toUserId: player.id,
      });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'THE ARCADE STORE DID NOT ANSWER.');
    } finally {
      setBusy(null);
    }
  }

  /** Off the board for both sides: the sender's cancel, and clearing an answered row. */
  async function drop(invite: GameInvite) {
    setBusy(invite.id);
    setError(null);

    try {
      await repository.remove(invite.id);
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

  return (
    <div className="space-y-3">
      {error === null ? null : (
        <p className="rounded-none border-2 border-black bg-white px-2 py-1 text-[10px] font-bold text-[#800000]">{error}</p>
      )}
      {notice === null ? null : (
        <p className="rounded-none border-2 border-black bg-white px-2 py-1 text-[10px] font-bold text-black">{notice}</p>
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

      <section className={PANEL}>
        <div className={TITLE_BAR_INACTIVE}>
          <span>ARCADE</span>
          <span>
            {GAME_CATALOGUE.length} GAME{GAME_CATALOGUE.length === 1 ? '' : 'S'}
          </span>
        </div>

        <div className="grid gap-2 p-2 sm:grid-cols-2">
          {GAME_CATALOGUE.map((game) => (
            <div
              key={game.id}
              className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-2"
            >
              <p className="flex items-center gap-2 text-xs font-bold text-black">
                <span className={`px-1 text-[9px] text-white ${game.badge}`}>
                  {game.id === 'tic-tac-toe' ? 'X/O' : 'DUEL'}
                </span>
                {game.title}
              </p>
              <p className="mt-1 text-[10px] text-gray-700">{game.tagline}</p>
              <p className="text-[10px] text-gray-700">
                {game.players} :: {game.controls}
              </p>

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
          {!loaded ? <p className="text-[10px] text-gray-700">READING THE ARCADE STORE...</p> : null}

          {loaded && visible.length === 0 ? (
            <p className="text-[10px] text-gray-700">No invitations either way. Pick a game above, then somebody below.</p>
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
          <p className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-black">
            INVITE THEM TO:
            <select
              className={FIELD_TIGHT}
              value={chosen}
              onChange={(event) => setChosen(event.target.value as GameId)}
              aria-label="Which game to invite somebody to"
            >
              {GAME_CATALOGUE.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.title}
                </option>
              ))}
            </select>
          </p>

          {userId === null ? (
            <p className="text-[10px] text-gray-700">Sign in to invite anybody: an invitation is from one account to another.</p>
          ) : null}

          {userId !== null && around.length === 0 ? (
            <p className="text-[10px] text-gray-700">Nobody else is on. Both players have to be here, so try solo meanwhile.</p>
          ) : null}

          {around.length === 0 ? null : (
            <ul className="overflow-hidden rounded-none border border-gray-500 bg-white text-black">
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

        <div className={STATUS_BAR}>
          <span className="truncate">{picked.title} SELECTED</span>
          <span className="truncate">{getGamesRepository().source === 'supabase' ? 'LIVE ARCADE' : 'LOCAL ARCADE'}</span>
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
      ? 'border-black bg-white text-black'
      : tone === 'plain'
        ? 'border-gray-500 bg-[#e8e8e8] text-black'
        : 'border-gray-400 bg-[#e8e8e8] text-gray-700';

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-none border px-2 py-1 text-[10px] font-bold ${frame}`}>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {actions.map((action) => (
        <button key={action.label} type="button" className={PLATE} disabled={action.busy} onClick={action.run}>
          {action.label}
        </button>
      ))}
    </div>
  );
}
