'use client';

import { tttDraw, tttWinningLine, tttWinner, type Board, type Mark } from '../lib/games/tic-tac-toe';

/**
 * The nine-plate board.
 *
 * A game surface is made of the site's own chrome - the raised grey plates every control is made of,
 * and the navy and maroon it already draws a choice in - never of drawn artwork: `X` and `O` are
 * letters, not pictures, and there is no character or illustration anywhere on this board. A screen
 * that wanted one would point at a hand-drawn file instead (see CLAUDE.md, Asset Rules).
 *
 * Phone first: the board is a square that takes the width it is given, each plate is a thumb-sized
 * target, and the whole thing is one `grid` - so it cannot overflow whatever it is put in.
 */
export default function TicTacToeBoard({
  board,
  myMark,
  onPlay,
  disabled = false,
}: {
  board: Board;
  /** Whose plates these are, so the caller's own mark is drawn as the live one. */
  myMark: Mark;
  onPlay: (cell: number) => void;
  disabled?: boolean;
}) {
  const winning = tttWinningLine(board);
  const winner = tttWinner(board);
  const draw = tttDraw(board);
  const sealed = disabled || winner !== null || draw;

  return (
    <div className="frame bg-sun-pale p-1">
      <div className="grid aspect-square w-full grid-cols-3 gap-1">
        {board.map((cell, index) => {
          const inWinningLine = winning !== null && winning.includes(index);
          const open = cell === null && !sealed;

          return (
            <button
              key={index}
              type="button"
              disabled={!open}
              aria-label={`Cell ${index + 1}${cell === null ? ', empty' : `, ${cell}`}`}
              onClick={() => onPlay(index)}
              className={`flex items-center justify-center rounded-none border-line text-4xl font-bold leading-none sm:text-5xl ${
                inWinningLine
                  ? 'border-t-ink-plate border-l-ink-plate border-r-ink-bar border-b-ink-bar bg-sun'
                  : open
                    ? 'border-t-ink-bar border-l-ink-bar border-r-ink-plate border-b-ink-plate bg-sun-pale hover:bg-ice-pale'
                    : 'border-t-ink-plate border-l-ink-plate border-r-ink-bar border-b-ink-bar bg-paper'
              } ${open ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className={cell === 'X' ? 'text-accent-ink' : 'text-bubble-pale'}>
                {cell === null ? (open ? '' : '·') : cell}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-1 truncate text-label font-bold text-ink">
        {/* A space while the game runs, so the line keeps its height and the board does not move. The
            side panel already says which mark is yours. */}
        {winner === null ? (draw ? 'DRAW' : '\u00a0') : winner === myMark ? 'YOU WIN' : `${winner} WINS`}
      </p>
    </div>
  );
}
