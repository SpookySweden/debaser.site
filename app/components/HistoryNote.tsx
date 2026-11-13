'use client';

import { useEffect } from 'react';
import { noteHistory } from '../lib/recommender/history';
import type { HistoryKind } from '../lib/recommender/types';
import { useAuth } from './AuthProvider';

/**
 * Notes one thing in FOR YOU's private history when a server-drawn page opens (SPEC-recommender.md): a lore page, for
 * one. Draws nothing. Signed out, it notes nothing.
 */
export default function HistoryNote({ kind, refName, title, maker = '', words = [] }: { kind: HistoryKind; refName: string; title: string; maker?: string; words?: string[] }) {
  const { user } = useAuth();
  const signedIn = user !== null;
  const wordKey = words.join('|');
  useEffect(() => {
    if (signedIn) noteHistory({ kind, ref: refName, title, maker, words: wordKey === '' ? [] : wordKey.split('|'), action: 'read' });
  }, [signedIn, kind, refName, title, maker, wordKey]);
  return null;
}
