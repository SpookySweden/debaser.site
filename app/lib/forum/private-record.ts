import type { ForumThread } from './types';
import { streamThreadTitle } from '../watch/rules';

/**
 * A private stream's record as a row on the board, for somebody outside it (SPEC-privacy-phase-3.md). Built from what the database hands out, a day and
 * a count, so there is no title, author or word here to hide.
 */
export function privateRecordThread(threadId: string, onDay: string, messages: number): ForumThread {
  return {
    id: threadId,
    title: streamThreadTitle('PRIVATE', onDay),
    body: '',
    author: { id: null, displayName: 'ANON' },
    createdAt: onDay,
    anchor: { kind: 'board', id: `private-record:${threadId}`, label: 'STREAM' },
    tags: [],
    comments: [],
    origin: 'user',
    privateRecord: { messages },
  };
}
