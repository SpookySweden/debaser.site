import { ANONYMOUS_AUTHOR } from '../auth/author';
import { AUTO_FILED_BODY, FORUM_ANCHORS } from './anchors';
import { deriveTags } from './tags';
import type { ForumAnchor, ForumComment, ForumThread } from './types';

/**
 * Deterministic seed board for the mock repository.
 *
 * Everything here is fixed data (stable ids, fixed UTC stamps) so the server
 * render and the browser render match exactly. Tags are *derived*, never hand
 * written, which also proves the auto-tagging rules against real copy.
 */

type SeedComment = {
  id: string;
  body: string;
  createdAt: string;
};

type SeedThreadInput = {
  id: string;
  title: string;
  body: string;
  anchor: ForumAnchor;
  createdAt: string;
  comments?: SeedComment[];
};

function seedThread(input: SeedThreadInput): ForumThread {
  const comments: ForumComment[] = (input.comments ?? []).map((comment) => ({
    id: comment.id,
    threadId: input.id,
    body: comment.body,
    author: { ...ANONYMOUS_AUTHOR },
    createdAt: comment.createdAt,
    tags: deriveTags({ text: comment.body, anchor: input.anchor, maxTags: 3 }),
  }));

  return {
    id: input.id,
    title: input.title,
    body: input.body,
    author: { ...ANONYMOUS_AUTHOR },
    createdAt: input.createdAt,
    anchor: input.anchor,
    tags: deriveTags({ text: `${input.title}\n${input.body}`, anchor: input.anchor }),
    comments,
    origin: 'seed',
  };
}

export const SEED_THREADS: ForumThread[] = [
  seedThread({
    id: 'seed-thread-001',
    title: 'READ FIRST: how the board files its own threads',
    body: [
      'Every text box and every hand-drawn asset on this site carries a comment box.',
      'Leave a comment under one of them and the board opens a thread for it automatically,',
      'then keeps later comments in the same thread instead of spawning duplicates.',
      '',
      'Posts created from the New Post form land in whichever box you point them at.',
      'Badges under each title are generated automatically: a source badge (ASSET_SRC, TEXT_BOX, BOARD),',
      'categorisation badges read out of the copy, and content descriptors such as LINK or LONG_READ.',
    ].join('\n'),
    anchor: FORUM_ANCHORS.board,
    createdAt: '2026-09-14T09:12:00.000Z',
    comments: [
      {
        id: 'seed-comment-001',
        body: 'Copy read. Posting my concept art notes under the viewer instead of here.',
        createdAt: '2026-09-14T10:02:00.000Z',
      },
      {
        id: 'seed-comment-002',
        body: 'Does the board keep threads after a reload?',
        createdAt: '2026-09-15T08:41:00.000Z',
      },
    ],
  }),
  seedThread({
    id: 'seed-thread-002',
    title: 'Concept sheet 01: silhouette pass notes',
    body: [
      'Second pass on the lead character silhouettes. Heavy shapes read best at 32px,',
      'so the cloak got flattened and the shoulder line widened. Palette stays at four greys.',
    ].join('\n'),
    anchor: FORUM_ANCHORS.conceptsViewer,
    createdAt: '2026-09-16T17:25:00.000Z',
    comments: [
      {
        id: 'seed-comment-003',
        body: 'The wider shoulder line reads much better against the environment sheet.',
        createdAt: '2026-09-16T18:10:00.000Z',
      },
    ],
  }),
  seedThread({
    id: 'seed-thread-003',
    title: 'Is the archive chronological or curated?',
    body: 'Reading order question: do the lore pages follow the timeline, or the order the issues were drawn?',
    anchor: FORUM_ANCHORS.homeSummary,
    createdAt: '2026-09-17T12:05:00.000Z',
  }),
  seedThread({
    id: 'seed-thread-004',
    title: 'Timeline break in issue 4 (spoilers ahead)',
    body: [
      'Working through the continuity notes for issue 4 and the retcon does not line up with the',
      'character sheet that shipped in issue 2. The design sheet shows the arm plating on the wrong',
      'side, and the environment map in the archive places the foundry a full district away from',
      'where the chapter text puts it. Flagging it here before the lore page gets edited again,',
      'because I think the sheet is right and the chapter text is the thing that drifted during',
      'the rewrite. Spoilers for anyone who has not read to the end of the fourth issue yet.',
    ].join(' '),
    anchor: FORUM_ANCHORS.loreReader,
    createdAt: '2026-09-18T20:48:00.000Z',
    comments: [
      {
        id: 'seed-comment-004',
        body: 'The foundry moved in the same rewrite that changed the chapter order. Map is stale.',
        createdAt: '2026-09-19T07:30:00.000Z',
      },
    ],
  }),
  seedThread({
    id: 'seed-thread-005',
    title: `RE: ${FORUM_ANCHORS.conceptsSheetIndex.label}`,
    body: AUTO_FILED_BODY,
    anchor: FORUM_ANCHORS.conceptsSheetIndex,
    createdAt: '2026-09-20T15:15:00.000Z',
    comments: [
      {
        id: 'seed-comment-005',
        body: 'Sheets 02 and 03 are still placeholders, the tablet files are not exported yet.',
        createdAt: '2026-09-20T15:20:00.000Z',
      },
    ],
  }),
];
