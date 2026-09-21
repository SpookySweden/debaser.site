import { resolveAnchorTarget } from './anchors';
import type { ForumPreview, ForumThread } from './types';

/**
 * Where a thread's pictures live.
 *
 * A collapsed card shows one small preview, so this picks the most relevant
 * image in a predictable order and reports how many there are in total:
 *
 *   1. artwork attached to the post itself
 *   2. otherwise the first reply that carries artwork
 *   3. otherwise the artwork of the item the thread is filed under (so a
 *      comment thread on a concept sheet previews that drawing)
 */
export type ThreadImageSource = 'post' | 'comment' | 'item';

export type ThreadImageSummary = {
  preview: ForumPreview | undefined;
  source: ThreadImageSource | undefined;
  /** Total images in the thread: the post's own plus any reply attachments. */
  count: number;
};

export function collectThreadImages(thread: ForumThread): ThreadImageSummary {
  const replyImages = thread.comments.filter((comment) => comment.media !== undefined);
  const count = (thread.media === undefined ? 0 : 1) + replyImages.length;

  if (thread.media !== undefined) {
    return { preview: thread.media, source: 'post', count };
  }

  if (replyImages.length > 0) {
    return { preview: replyImages[0].media, source: 'comment', count };
  }

  const itemArtwork = resolveAnchorTarget(thread.anchor).preview;
  return {
    preview: itemArtwork,
    source: itemArtwork === undefined ? undefined : 'item',
    count,
  };
}

/** Short label for the preview thumbnail's tooltip. */
export function imageSourceLabel(source: ThreadImageSource | undefined): string {
  switch (source) {
    case 'post':
      return 'IMAGE ATTACHED TO THIS POST';
    case 'comment':
      return 'IMAGE ATTACHED TO A REPLY';
    case 'item':
      return 'ARTWORK OF THE ITEM THIS THREAD IS FILED UNDER';
    default:
      return 'NO IMAGE';
  }
}
