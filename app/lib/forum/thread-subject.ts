import { resolveAnchorTarget } from './anchors';
import { isItemOwnedThread, profileOwner } from './site-author';
import type { ForumAuthor, ForumPreview, ForumThread } from './types';

/**
 * What an item's own thread is *about*, for the strip under its title.
 *
 * A thread an item's comment box opened is not a post: nobody wrote it, so a byline
 * ("debaser.site POSTED ...") over an empty body read as an empty post the site had made
 * and somebody had answered (Luke, 2026-10-24, on `RE: PROFILE // DEMZOU`). The strip on
 * such a thread names the subject instead, and the subject is the link - there is no
 * separate `GO TO` key, because the name, the picture or the title is what a reader clicks.
 *
 *   person   a profile, one of its pictures or the track beside it: the page's owner, drawn
 *            as a byline is (picture, name) and opening their page
 *   track    an archive track: its title, opening the music window
 *   item     anything else (a concept sheet, a text box): its label, with the drawing's
 *            thumbnail when it has one, opening the page it sits on
 *
 * `undefined` for an ordinary post, whose strip is still its poster's byline.
 */
export type ThreadSubject =
  | { kind: 'person'; owner: ForumAuthor }
  | { kind: 'track'; title: string; href: string }
  | { kind: 'item'; label: string; href: string; preview: ForumPreview | undefined };

export function threadSubject(thread: ForumThread): ThreadSubject | undefined {
  if (!isItemOwnedThread(thread)) return undefined;

  const owner = profileOwner(thread.anchor);
  if (owner !== null) return { kind: 'person', owner };

  const target = resolveAnchorTarget(thread.anchor);

  if (thread.anchor.kind === 'track') {
    return { kind: 'track', title: thread.track?.title ?? thread.anchor.label, href: target.href };
  }

  return { kind: 'item', label: thread.anchor.label, href: target.href, preview: target.preview };
}

/**
 * When something last happened on the thread: the newest comment, or the thread itself.
 *
 * An item's thread was not posted, so its strip says when it was last commented on instead.
 */
export function lastActivityAt(thread: ForumThread): string {
  return thread.comments.reduce(
    (latest, comment) => (comment.createdAt > latest ? comment.createdAt : latest),
    thread.createdAt,
  );
}
