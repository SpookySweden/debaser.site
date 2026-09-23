import type { ProfileAnchorTarget } from '../forum/anchors';
import { AUTO_FILED_BODY, autoThreadTitle, profileAnchor, profileAnchorId } from './anchors';
import { SITE_AUTHOR } from './site-author';
import { deriveTags } from './tags';
import type { ForumComment, ForumThread } from './types';
import type { ProfileComment, ProfileCommentEntry } from '../profile/types';

/**
 * Profile comments, as the board's own threads.
 *
 * A profile is commentable in three places, and each is a subject of its own: the page, one of its
 * pictures, and the track beside the picture. This turns the comments the profile store holds into
 * one thread per subject that carries any, so the board shows them where everything else is read -
 * filterable as `PROFILE COMMENTS`, searchable by the words in them, tagged from those words, and
 * answerable.
 *
 * Nothing is invented here. The title comes off the anchor, the body is the auto-filed marker an
 * item's own thread carries (so the header credits the site rather than the first commenter, see
 * ./site-author.ts), and the tags are read out of the comments' own text by the same rule that tags
 * a post - which is what lets the board's tag filter and its search reach a profile comment at all.
 *
 * The comments stay where they are: writing one is still a profile write, which is what keeps the
 * owner's comments switch and a pinned remark working (`ForumProvider.addProfileComment`).
 */
export function profileCommentThreads(entries: ProfileCommentEntry[]): ForumThread[] {
  const groups = new Map<string, { target: ProfileAnchorTarget; comments: ForumComment[]; latest: string }>();

  for (const entry of entries) {
    const target: ProfileAnchorTarget = {
      userId: entry.userId,
      displayName: entry.displayName,
      kind: entry.comment.kind,
      ...(entry.comment.kind === 'avatar' && entry.comment.avatarVersionId !== undefined
        ? { versionId: entry.comment.avatarVersionId, ...(entry.comment.avatarVersionNumber === undefined ? {} : { versionNumber: entry.comment.avatarVersionNumber }) }
        : {}),
      ...(entry.comment.kind === 'song' && entry.comment.songVersionId !== undefined
        ? { versionId: entry.comment.songVersionId, ...(entry.comment.songVersionNumber === undefined ? {} : { versionNumber: entry.comment.songVersionNumber }) }
        : {}),
    };

    const id = profileAnchorId(target);
    const comment = profileCommentAsForumComment(entry.comment, id);
    const existing = groups.get(id);

    if (existing === undefined) {
      groups.set(id, { target, comments: [comment], latest: entry.comment.createdAt });
      continue;
    }

    existing.comments.push(comment);
    if (entry.comment.createdAt > existing.latest) existing.latest = entry.comment.createdAt;
  }

  return [...groups.values()]
    .map((group) => {
      const anchor = profileAnchor(group.target);
      const comments = [...group.comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      return {
        id: anchor.id,
        title: autoThreadTitle(anchor),
        body: AUTO_FILED_BODY,
        // The credit the header draws for an item-owned thread: the site, whose page is collecting
        // the comments (./site-author.ts reads the empty body and answers with SITE_AUTHOR).
        author: SITE_AUTHOR,
        createdAt: group.latest,
        anchor,
        // Tags read out of the comments themselves, so a profile comment is findable by what it says
        // exactly as a post is.
        tags: deriveTags({ text: comments.map((comment) => comment.body).join('\n'), maxTags: 6 }),
        comments,
        origin: 'user' as const,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** One profile comment as the board's own kind of comment: the same words, in the thread's terms. */
export function profileCommentAsForumComment(comment: ProfileComment, threadId: string): ForumComment {
  return {
    id: `profile-comment:${comment.id}`,
    threadId,
    body: comment.body,
    author: comment.author,
    createdAt: comment.createdAt,
    // A profile comment carries no board tags of its own: the tags on its thread are read out of the
    // words by `profileCommentThreads`, so there is nothing to add here.
    tags: [],
  };
}