'use client';

import { LINES, tttDraw, tttWinningLine, tttWinner, type Board, type Mark } from '../lib/games/tic-tac-toe';
import { PANEL_INSET } from '../lib/ui/controls';

/**
 * The nine-plate board.
 *
 * A game surface is made of the site's own chrome - the raised grey plates every control is made of,
 * and the navy and maroon it already draws a choice in - never of drawn artwork: `X` and `O` are
 * letters, not pictures, and there is no character or illustration anywhere on this board. A screen
 * that wanted one would point at a hand-drawn file instead (see AGENTS.md, Asset Rules).
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
    <div className={`${PANEL_INSET} bg-[#c0c0c0] p-1`}>
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
              className={`flex items-center justify-center rounded-none border-2 text-4xl font-bold leading-none sm:text-5xl ${
                inWinningLine
                  ? 'border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-yellow-100'
                  : open
                    ? 'border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] hover:bg-yellow-100'
                    : 'border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white'
              } ${open ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className={cell === 'X' ? 'text-[#000080]' : 'text-[#800000]'}>
                {cell === null ? (open ? '' : '·') : cell}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-1 truncate text-[10px] font-bold text-gray-700">
        {winner === null
          ? draw
            ? 'ALL NINE PLATES TAKEN. NOBODY WINS THIS ONE.'
            : `YOU ARE ${myMark}. ${LINES.length} WAYS TO TAKE IT.`
          : winner === myMark
            ? `${winner} TAKES IT. WELL PLAYED.`
            : `${winner} TAKES IT. GO AGAIN?`}
      </p>
    </div>
  );
}
