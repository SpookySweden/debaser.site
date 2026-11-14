'use client';

import { useEffect, useRef } from 'react';
import { pokeCompanion } from './events';
import { holdCompanionScene, type CompanionScene } from './scene';

/**
 * One line for a part of the site to tell your companion what you are doing while it is on screen (`scene.ts`): reading
 * (the reader, with a book open), watching (a stream room's video playing).
 */
export function useCompanionScene(scene: CompanionScene, on: boolean = true): void {
  useEffect(() => (on ? holdCompanionScene(scene) : undefined), [scene, on]);
}

/**
 * One line for a game: your companion sits and watches the match while it is on screen, cheers when you win it and
 * slumps when you lose it. `winner` is null while it is being played (and for a draw); `mine` is your side of it. It
 * reacts once, when the game ends, not when a finished game is merely drawn again, and again after a rematch.
 */
export function useCompanionMatch(winner: string | null, mine: string): void {
  useCompanionScene('game');
  const last = useRef<string | null>(winner);
  useEffect(() => {
    if (winner !== null && last.current === null) pokeCompanion(winner === mine ? 'cheer' : 'slump');
    last.current = winner;
  }, [winner, mine]);
}
