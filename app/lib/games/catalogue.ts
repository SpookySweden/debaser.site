import type { GameId } from './types';

/**
 * The arcade's own list: what a game is called, how many play it, and how it is played in one line.
 *
 * The hub draws this and nothing else, so a game added to ./types.ts and implemented beside it
 * cannot be half-listed: either it is in the catalogue with a control that opens it, or it is not on
 * the site at all.
 */
export type GameEntry = {
  id: GameId;
  title: string;
  /** One line, in the site's voice: what the game is. */
  tagline: string;
  /** `1 PLAYER`, `2 PLAYERS` - how many keyboards, not how many accounts. */
  players: string;
  /** How it is played, in as few words as the controls need. */
  controls: string;
  /** The badge colour: the navy plates this site uses for a choice. */
  badge: string;
};

export const GAME_CATALOGUE: GameEntry[] = [
  {
    id: 'tic-tac-toe',
    title: 'TIC-TAC-TOE',
    tagline: 'Three in a row on a nine-plate board.',
    players: '1 OR 2 PLAYERS',
    controls: 'TAP A PLATE. X STARTS. THE COMPUTER BLOCKS.',
    badge: 'bg-[#000080]',
  },
  {
    id: 'paddle-duel',
    title: 'PADDLE DUEL',
    tagline: 'Two paddles, one ball, first to seven.',
    players: '1 OR 2 PLAYERS',
    controls: 'DRAG THE COURT. FIRST TO 7 TAKES IT.',
    badge: 'bg-[#800000]',
  },
];

export function gameById(id: GameId): GameEntry {
  return GAME_CATALOGUE.find((entry) => entry.id === id) ?? GAME_CATALOGUE[0];
}
