'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createGameChannel, type GameChannel, type GameMessage } from '../lib/games/channel';
import { gameById } from '../lib/games/catalogue';
import {
  duelAiTarget,
  duelSides,
  duelStart,
  duelStatus,
  duelStep,
  duelWinner,
  type DuelSide,
  type DuelState,
} from '../lib/games/paddle-duel';
import {
  tttBestMove,
  tttOver,
  tttPlay,
  tttStart,
  tttStatus,
  tttTurn,
  type Board,
  type Mark,
} from '../lib/games/tic-tac-toe';
import type { GameId, GameInvite } from '../lib/games/types';
import { PANEL, PLATE_MEDIUM, STATUS_BAR, TITLE_BAR } from '../lib/ui/controls';
import PaddleDuelCourt from './PaddleDuelCourt';
import TicTacToeBoard from './TicTacToeBoard';

/**
 * One game, being played.
 *
 * The same component runs solo and across two browsers: solo is a match with nobody on the other
 * end (the computer answers), a match is a match with the invitation's other account on it, and
 * everything between the two is the message the other side sent (`./channel.ts`).
 *
 * Who is the authority differs by game, and only because that is what each rule needs:
 *
 *   tic-tac-toe   nobody. Both sides hold the board and apply the same move rule to it, so an
 *                 illegal move is refused on both ends and nothing has to be reconciled. The
 *                 account that sent the invitation is X, and X moves first.
 *   paddle duel   the host, which is the same account: it steps the whole court and sends it out,
 *                 while the guest sends only where its own paddle wants to be. Two clients stepping
 *                 the same physics would drift apart in seconds.
 *
 * A match waits for the other side: until a `hello` arrives, the ball holds still and the board does
 * not take a move, so nobody loses a game to a browser that had not opened yet.
 */

/** The step of a duel, and how often a whole court is sent across it. */
const DUEL_STEP_MS = 33;
const DUEL_SEND_EVERY = 2;
/** How long the computer takes to answer a move, so its turn is not over before yours is read. */
const SOLO_REPLY_MS = 320;

export type MatchPlayer = { id: string; displayName: string };

export default function GameMatch({
  game,
  invite,
  me,
  onLeave,
}: {
  game: GameId;
  /** The invitation being played, or null for a game against the computer. */
  invite: GameInvite | null;
  me: MatchPlayer;
  onLeave: () => void;
}) {
  const entry = gameById(game);
  // The account that sent the invitation is the host: X on the board, the left paddle in the duel.
  const host = invite === null || invite.fromUserId === me.id;
  const opponentName = invite === null ? 'THE COMPUTER' : host ? invite.toName : invite.fromName;

  const [board, setBoard] = useState<Board>(() => tttStart());
  const [duel, setDuel] = useState<DuelState>(() => duelStart());
  const [opponentHere, setOpponentHere] = useState(invite === null);
  const [note, setNote] = useState<string | null>(null);

  // Everything the two effects below read lives in refs: a channel that re-subscribed on every move
  // would drop a message a second, and an interval that re-started on every frame would never step.
  const channel = useRef<GameChannel | null>(null);
  const boardRef = useRef<Board>(board);
  const duelRef = useRef<DuelState>(duel);
  const aim = useRef<number | null>(null);
  const theirPaddle = useRef<number | null>(null);

  // The live values the two effects below read, kept in refs *by an effect* rather than during
  // render: a channel that re-subscribed on every move would drop a message a second, and an
  // interval that re-started on every frame would never get to step.
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    duelRef.current = duel;
  }, [duel]);

  const myMark: Mark = host ? 'X' : 'O';
  const mySide: DuelSide = duelSides(host).mine;

  const send = useCallback((message: GameMessage) => {
    channel.current?.send(message);
  }, []);

  /**
   * The wire, opened once for the match.
   *
   * Both sides say `hello` as they arrive, and the host answers one with the board or the court it
   * holds - which is how a side that opened the match late catches up without a second protocol.
   */
  useEffect(() => {
    if (invite === null) return;

    const wire = createGameChannel(invite.id, (status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setNote('THE LIVE WIRE IS DOWN. THE GAME STILL PLAYS ON THIS SCREEN.');
      }
    });

    channel.current = wire;

    const stop = wire.subscribe((message) => {
      if (message.kind === 'hello') {
        setOpponentHere(true);
        if (host) {
          if (game === 'tic-tac-toe') wire.send({ kind: 'board', board: boardRef.current });
          else wire.send({ kind: 'state', state: duelRef.current });
        }

        return;
      }

      if (message.kind === 'move' && game === 'tic-tac-toe') {
        if (message.mark === myMark) return;
        setBoard((current) => tttPlay(current, message.cell, message.mark) ?? current);

        return;
      }

      if (message.kind === 'board' && game === 'tic-tac-toe') {
        setBoard(message.board);

        return;
      }

      if (message.kind === 'state' && game === 'paddle-duel') {
        setDuel(message.state);

        return;
      }

      if (message.kind === 'paddle') {
        theirPaddle.current = message.y;
      }
    });

    wire.send({ kind: 'hello', name: me.displayName });

    return () => {
      wire.send({ kind: 'bye' });
      stop();
      wire.close();
      channel.current = null;
    };
  }, [game, host, invite, me.displayName, myMark]);

  /**
   * A move on the board: played here, and told to the other side when there is one.
   *
   * The computer's answer is a timeout rather than an immediate one, so its turn is readable - and
   * it is computed from the board as it stands when it fires, which is what keeps a fast player from
   * playing into a stale answer.
   */
  function playCell(cell: number) {
    if (game !== 'tic-tac-toe') return;

    const theirs: Mark = myMark === 'X' ? 'O' : 'X';
    const next = tttPlay(boardRef.current, cell, myMark);
    if (next === null) return;

    setBoard(next);
    setNote(null);

    if (invite === null) {
      window.setTimeout(() => {
        const reply = tttBestMove(boardRef.current, theirs);
        if (reply === null) return;

        setBoard((current) => tttPlay(current, reply, theirs) ?? current);
      }, SOLO_REPLY_MS);

      return;
    }

    send({ kind: 'move', cell, mark: myMark });
  }

  /**
   * The duel, stepped.
   *
   * The host (or a solo player) runs the physics and, in a match, sends the whole court out twice a
   * step to keep the two screens together. The guest sends only where its own paddle wants to be and
   * draws the court it is sent, moving the ball on between messages so a 15-a-second wire still looks
   * like a game rather than a slideshow.
   */
  useEffect(() => {
    if (game !== 'paddle-duel') return;
    // A match holds still until the other side says it is here: nobody wants to lose a point to a
    // browser that was still loading.
    if (invite !== null && !opponentHere) return;

    let tick = 0;
    const dt = DUEL_STEP_MS / 1000;

    const timer = window.setInterval(() => {
      tick += 1;
      const current = duelRef.current;
      if (duelWinner(current) !== null) return;

      if (invite !== null && !host) {
        setDuel((prev) => ({ ...prev, ballX: prev.ballX + prev.vx * dt, ballY: prev.ballY + prev.vy * dt }));
        if (tick % 3 === 0 && aim.current !== null) send({ kind: 'paddle', side: mySide, y: aim.current, name: me.displayName });

        return;
      }

      const theirs = invite === null ? duelAiTarget(current, 'right') : theirPaddle.current;
      const inputs = host ? { left: aim.current, right: theirs } : { left: theirs, right: aim.current };
      const step = duelStep(current, inputs, dt);

      duelRef.current = step.state;
      setDuel(step.state);

      if (step.scored !== null) {
        setNote(step.scored === mySide ? 'YOUR POINT.' : `${opponentName} SCORES.`);
      }

      if (invite !== null && tick % DUEL_SEND_EVERY === 0) send({ kind: 'state', state: step.state });
    }, DUEL_STEP_MS);

    return () => window.clearInterval(timer);
  }, [game, host, invite, me.displayName, mySide, opponentName, opponentHere, send]);

  /** A fresh board, or a fresh court: the host deals, and tells the other side what it dealt. */
  function rematch() {
    setNote(null);

    if (game === 'tic-tac-toe') {
      const fresh = tttStart();
      setBoard(fresh);

      if (invite !== null) {
        if (host) send({ kind: 'board', board: fresh });
        else send({ kind: 'hello', name: me.displayName });
      }

      return;
    }

    const fresh = duelStart();
    setDuel(fresh);
    theirPaddle.current = null;

    if (invite !== null) {
      if (host) send({ kind: 'state', state: fresh });
      else send({ kind: 'hello', name: me.displayName });
    }
  }

  const myTurn = tttTurn(board) === myMark;
  const waiting = invite !== null && !opponentHere;
  const score = game === 'tic-tac-toe' ? tttStatus(board, myMark) : duelStatus(duel);

  return (
    <section className={`${PANEL} min-w-0`}>
      <div className={TITLE_BAR}>
        <span className="truncate">{entry.title}</span>
        <span className="truncate">{invite === null ? 'SOLO' : `MATCH :: ${opponentName}`}</span>
      </div>

      <div className="space-y-2 p-2">
        {note === null ? null : <p className="border border-ink bg-paper px-2 py-1 text-[10px] font-bold text-bubble-pale">{note}</p>}

        {/* Phones get the board first and the controls under it; a wide screen puts them side by side. */}
        <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_13rem]">
          <div className="min-w-0">
            {game === 'tic-tac-toe' ? (
              <TicTacToeBoard
                board={board}
                myMark={myMark}
                onPlay={playCell}
                disabled={waiting || !myTurn || tttOver(board)}
              />
            ) : (
              <PaddleDuelCourt
                state={duel}
                mySide={mySide}
                onAim={(y) => {
                  aim.current = y;
                }}
                scoresHidden={waiting}
              />
            )}
          </div>

          <div className="space-y-2">
            <div className={`${PANEL} p-2`}>
              <p className="text-[10px] font-bold text-ink">{myMark === 'X' ? 'X' : 'O'} :: {me.displayName}</p>
              <p className="truncate text-[10px] font-bold text-ink">
                {game === 'tic-tac-toe' ? (myMark === 'X' ? 'O' : 'X') : mySide === 'left' ? 'RIGHT' : 'LEFT'} ::{' '}
                {opponentName}
              </p>
              <p className="mt-1 text-[10px] text-ink">{entry.controls}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className={PLATE_MEDIUM} onClick={rematch}>
                [ REMATCH ]
              </button>
              <button type="button" className={PLATE_MEDIUM} onClick={onLeave}>
                [ LEAVE ]
              </button>
            </div>

            {invite === null ? (
              <p className="text-[10px] text-ink">
                Nobody else on this one. {entry.players} - invite somebody from the list below.
              </p>
            ) : (
              <p className="text-[10px] text-ink">
                {host ? 'YOU OPENED THIS MATCH.' : 'YOU WERE INVITED TO THIS MATCH.'} LEAVE WHEN YOU ARE DONE.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className={STATUS_BAR}>
        <span className="truncate">{score}</span>
        <span className="truncate">{waiting ? `WAITING FOR ${opponentName}` : game === 'paddle-duel' ? 'DRAG TO MOVE' : 'TAP A PLATE'}</span>
      </div>
    </section>
  );
}


