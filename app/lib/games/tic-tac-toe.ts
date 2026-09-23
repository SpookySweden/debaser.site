/**
 * Tic-tac-toe, as nine cells and eight lines.
 *
 * Pure: a board goes in, a board comes out, and nothing here knows about React, storage or the
 * network. The match sends one move at a time, so a move is the whole of the message - which is what
 * makes two browsers agree without either being the authority: both apply the same rule to the same
 * board, and an illegal move is refused on the side that receives it as well as the side that sends
 * it.
 *
 * The solo opponent is the same rule, asked which cell it would take: win if it can, block if it
 * must, else take the middle, a corner, a side. Beatable on purpose - it never looks two moves ahead.
 */

export type Mark = 'X' | 'O';
export type Cell = Mark | null;
export type Board = Cell[];

/** The nine cells, in reading order. */
export const CELL_COUNT = 9;

/** The eight ways to win, as cell indexes. */
export const LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function tttStart(): Board {
  return Array.from({ length: CELL_COUNT }, () => null);
}

export function otherMark(mark: Mark): Mark {
  return mark === 'X' ? 'O' : 'X';
}

/** The board a move makes, or null when the move is not one this board allows. */
export function tttPlay(board: Board, cell: number, mark: Mark): Board | null {
  if (cell < 0 || cell >= CELL_COUNT) return null;
  if (board[cell] !== null) return null;
  if (tttWinner(board) !== null) return null;

  const next = [...board];
  next[cell] = mark;

  return next;
}

/** The line three marks own, or null. */
export function tttWinningLine(board: Board): number[] | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] !== null && board[a] === board[b] && board[a] === board[c]) return line;
  }

  return null;
}

export function tttWinner(board: Board): Mark | null {
  const line = tttWinningLine(board);
  if (line === null) return null;

  return board[line[0]] as Mark;
}

export function tttFull(board: Board): boolean {
  return board.every((cell) => cell !== null);
}

/** A draw is a full board nobody won; `over` covers both ends. */
export function tttDraw(board: Board): boolean {
  return tttFull(board) && tttWinner(board) === null;
}

export function tttOver(board: Board): boolean {
  return tttWinner(board) !== null || tttFull(board);
}

/** Whose turn it is: X starts, and the count of marks played decides the rest. */
export function tttTurn(board: Board): Mark {
  return board.filter((cell) => cell !== null).length % 2 === 0 ? 'X' : 'O';
}

/**
 * The solo opponent's move: the same board, read greedily.
 *
 * `winningMove` is used twice - once to take the win, once to take the block - which is the whole
 * of its strategy apart from the opening preference. A move that would leave it with nothing to do
 * is not considered, so it can be beaten by a fork, and that is the point of a small game.
 */
export function tttBestMove(board: Board, me: Mark): number | null {
  if (tttOver(board)) return null;

  const winningMove = (mark: Mark): number | null => {
    for (const cell of tttEmptyCells(board)) {
      const line = tttWinningLine(tttPlay(board, cell, mark) ?? board);
      if (line !== null) return cell;
    }

    return null;
  };

  const take = winningMove(me);
  if (take !== null) return take;

  const block = winningMove(otherMark(me));
  if (block !== null) return block;

  if (board[4] === null) return 4;

  const corners = [0, 2, 6, 8].filter((cell) => board[cell] === null);
  if (corners.length > 0) return corners[0];

  const sides = [1, 3, 5, 7].filter((cell) => board[cell] === null);

  return sides.length === 0 ? null : sides[0];
}

export function tttEmptyCells(board: Board): number[] {
  return board.flatMap((cell, index) => (cell === null ? [index] : []));
}

/** One line of state for the hub's status bar. */
export function tttStatus(board: Board, me: Mark | null): string {
  const winner = tttWinner(board);
  if (winner !== null) return `${winner} WINS`;
  if (tttFull(board)) return 'DRAW - NOBODY MOVES';

  const turn = tttTurn(board);
  if (me === null) return `${turn} TO MOVE`;

  return turn === me ? 'YOUR MOVE' : 'WAITING FOR THE OTHER PLAYER';
}
