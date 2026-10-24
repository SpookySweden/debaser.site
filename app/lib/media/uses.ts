import type { ForumPreview, ForumTrack } from '../forum/types';
import { threadDomId } from '../forum/anchors';
import { getMediaRepository } from './repository';
import type { MediaItem, MediaUseKind } from './types';

/**
 * Pointing at a catalogued file from the rest of the site, and saying so.
 *
 * A post keeps its own copy of what it shows (a `ForumPreview`, a `ForumTrack`); the catalogue keeps
 * the file. These helpers go between: what the picker offers, the preview a chosen item becomes, and
 * the *use* recorded once the post is filed - the row the catalogue page lists under WHERE IT IS USED.
 */

/** A picker's tile for every picture in the catalogue: the sheets first, then uploads, newest first. */
export function pictureTiles(items: MediaItem[]): { id: string; label: string; preview: ForumPreview }[] {
  return items
    .filter((item) => item.kind === 'image')
    .sort((a, b) => Number(b.source === 'sheet') - Number(a.source === 'sheet') || b.createdAt.localeCompare(a.createdAt))
    .map((item) => ({ id: item.id, label: item.title, preview: previewOf(item) }));
}

/** What a post stores for a picture it carries. */
export function previewOf(item: MediaItem): ForumPreview {
  return { src: item.src, alt: item.title, width: item.width ?? 352, height: item.height ?? 352 };
}

/** The preview for a chosen picker tile, or undefined when nothing (or nothing known) was chosen. */
export function previewFor(items: MediaItem[], id: string): ForumPreview | undefined {
  const item = items.find((candidate) => candidate.id === id);
  return item === undefined ? undefined : previewOf(item);
}

/** The catalogued file behind an address, if the catalogue holds it. */
export function itemForSrc(items: MediaItem[], src: string | undefined): MediaItem | undefined {
  return src === undefined ? undefined : items.find((item) => item.src === src);
}

export type UseSite = {
  useKind: MediaUseKind;
  useId: string;
  href: string;
  label: string;
  addedBy: string | null;
};

/**
 * Records that a post, reply or profile now carries these files. Never throws and never waits for
 * anything the caller needs: a use is a note beside the thing, and the thing is already filed.
 *
 * A sheet still read off the manifest (`sheet:` id, no row) cannot be recorded until the migration
 * gives it one; the migration rebuilds every use from the posts anyway.
 */
export function recordUses(
  items: MediaItem[],
  site: UseSite,
  carried: { mediaId?: string; preview?: ForumPreview; track?: ForumTrack },
): void {
  const ids = new Set<string>();

  if (carried.mediaId !== undefined && !carried.mediaId.startsWith('sheet:') && carried.mediaId.length > 0) {
    ids.add(carried.mediaId);
  }

  const picture = itemForSrc(items, carried.preview?.src);
  if (picture !== undefined && picture.source !== 'sheet') ids.add(picture.id);

  const track = itemForSrc(items, carried.track?.src);
  if (track !== undefined) ids.add(track.id);

  // A guest cannot record a use (the table takes them from accounts only); the migration script
  // rebuilds every use from the posts themselves, so nothing is lost for good.
  if (site.addedBy === null) return;

  const repository = getMediaRepository();
  for (const mediaId of ids) {
    void repository.addUse({ mediaId, ...site }).catch(() => undefined);
  }
}

/** The use a post records: the thread, by its anchor on the board. */
export function postUse(thread: { id: string; title: string }, addedBy: string | null): UseSite {
  return { useKind: 'post', useId: thread.id, href: `/forum#${threadDomId(thread.id)}`, label: thread.title, addedBy };
}

/** The use a reply records: the reply, inside its thread. */
export function replyUse(comment: { id: string }, thread: { id: string; title: string }, addedBy: string | null): UseSite {
  return {
    useKind: 'reply',
    useId: comment.id,
    href: `/forum#comment-${comment.id}`,
    label: `REPLY ON ${thread.title}`,
    addedBy,
  };
}
