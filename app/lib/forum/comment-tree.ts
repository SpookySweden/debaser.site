import type { ForumComment } from './types';

/**
 * Reply threads, as data.
 *
 * A comment replies either to the post itself (no `parentId`) or to another
 * comment. The board and the comment window render the same tree, so the rules
 * live here: children are ordered oldest first under their parent, and a comment
 * whose parent has gone (deleted, or written by a build that had no threading)
 * is promoted to the top level instead of vanishing.
 */
export type CommentNode = {
  comment: ForumComment;
  children: CommentNode[];
  /** 0 for a top-level reply, rising with each nesting level. */
  depth: number;
};

export function buildCommentTree(comments: ForumComment[]): CommentNode[] {
  const ordered = [...comments].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
  const ids = new Set(ordered.map((comment) => comment.id));
  const childrenOf = new Map<string, ForumComment[]>();
  const roots: ForumComment[] = [];

  for (const comment of ordered) {
    const parentId = comment.parentId;

    if (parentId === undefined || parentId === comment.id || !ids.has(parentId)) {
      roots.push(comment);
      continue;
    }

    const bucket = childrenOf.get(parentId);
    if (bucket === undefined) childrenOf.set(parentId, [comment]);
    else bucket.push(comment);
  }

  const nest = (comment: ForumComment, depth: number): CommentNode => ({
    comment,
    depth,
    children: (childrenOf.get(comment.id) ?? []).map((child) => nest(child, depth + 1)),
  });

  return roots.map((root) => nest(root, 0));
}

/** Direct replies to one comment. */
export function directReplyCount(comments: ForumComment[], parentId: string): number {
  return comments.filter((comment) => comment.parentId === parentId).length;
}

/** Every reply underneath one comment, however deeply nested. */
export function descendantCount(comments: ForumComment[], parentId: string): number {
  const byParent = new Map<string, ForumComment[]>();

  for (const comment of comments) {
    if (comment.parentId === undefined) continue;
    const bucket = byParent.get(comment.parentId);
    if (bucket === undefined) byParent.set(comment.parentId, [comment]);
    else bucket.push(comment);
  }

  const walk = (id: string): number => {
    const children = byParent.get(id) ?? [];
    return children.reduce((total, child) => total + 1 + walk(child.id), 0);
  };

  return walk(parentId);
}

/** How deep a reply is buried, for the indent cap in the UI. */
export function commentDepth(comments: ForumComment[], comment: ForumComment): number {
  let depth = 0;
  let current = comment;

  while (current.parentId !== undefined && depth < 32) {
    const parent = comments.find((candidate) => candidate.id === current.parentId);
    if (parent === undefined) break;
    depth += 1;
    current = parent;
  }

  return depth;
}
