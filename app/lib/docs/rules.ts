import type { DocAccess, DocRole, DocShare, DocSummary } from './types';

/**
 * The pure facts about DOCS: addresses, labels, who may do what, and the timings live editing keeps.
 *
 * Kept apart from the stores so a check can hold them without a browser or a database, and so the
 * mock store and the screens agree with the database's own rules (the migration's `doc_role`).
 */

/* --- addresses ------------------------------------------------------------------------------------ */

/** What a lore address may be: lower case words and single hyphens. */
export const DOC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DOC_SLUG_LIMIT = 60;

/** A lore page's address, read off its title: `THE GLASS CORRIDOR` -> `the-glass-corridor`. */
export function docSlug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, DOC_SLUG_LIMIT)
    .replace(/-+$/g, '');
}

export function isDocSlug(value: string): boolean {
  return value.length > 0 && value.length <= DOC_SLUG_LIMIT && DOC_SLUG_PATTERN.test(value);
}

/** A slug read back as a title, for the tab before the row has been read. */
export function titleFromSlug(slug: string): string {
  const words = slug.split('-').filter((word) => word.length > 0);
  return words.length === 0 ? 'LORE PAGE' : words.join(' ').toUpperCase();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_ID = /^[a-z]+-[a-z0-9-]{4,60}$/;

/** A document id from an address: a database id, or the mock store's local one. */
export function isDocId(value: string): boolean {
  return UUID.test(value) || LOCAL_ID.test(value);
}

/** Where a document opens: its lore address when it has one, its DOCS address otherwise. */
export function docPath(doc: Pick<DocSummary, 'id' | 'slug'>): string {
  return doc.slug === null ? `/docs/${doc.id}` : `/lore/${doc.slug}`;
}

/** The file browser opened on one folder (`null` is MY DOCS). */
export function folderPath(folderId: string | null): string {
  return folderId === null ? '/docs' : `/docs?folder=${encodeURIComponent(folderId)}`;
}

export const LORE_PATH = '/lore';

/* --- sharing ------------------------------------------------------------------------------------- */

export const DOC_ACCESS_ORDER: DocAccess[] = ['private', 'shared', 'signed_in', 'public'];

export const DOC_ACCESS_LABELS: Record<DocAccess, string> = {
  private: 'PRIVATE',
  shared: 'SHARED WITH',
  signed_in: 'ANYONE SIGNED IN',
  public: 'PUBLIC',
};

export const DOC_ACCESS_NOTES: Record<DocAccess, string> = {
  private: 'Only you.',
  shared: 'The people you name, each able to edit or only read.',
  signed_in: 'Every account can read and edit it.',
  public: 'Anyone can read it; accounts can edit it, as lore is.',
};

export function isDocAccess(value: unknown): value is DocAccess {
  return typeof value === 'string' && (DOC_ACCESS_ORDER as string[]).includes(value);
}

/** Whether a level makes the document's one board post (SPEC-live-docs.md, decision 8). */
export function announcesOnBoard(access: DocAccess): boolean {
  return access === 'public' || access === 'signed_in';
}

/**
 * What one reader may do with one document: the database's `doc_role`, mirrored for the mock store.
 *
 * `viewerId` null is a visitor; `banned` reads only. The owner always owns; otherwise PUBLIC lets
 * accounts edit and visitors read, ANYONE SIGNED IN lets accounts edit, SHARED WITH follows the share.
 */
export function docRoleFor(
  doc: Pick<DocSummary, 'access' | 'ownerId'>,
  viewerId: string | null,
  share: Pick<DocShare, 'canEdit'> | null,
  banned = false,
): DocRole | null {
  const write = viewerId !== null && !banned;

  if (viewerId !== null && doc.ownerId === viewerId) return write ? 'owner' : 'read';
  if (doc.access === 'public') return write ? 'edit' : 'read';
  if (doc.access === 'signed_in' && viewerId !== null) return write ? 'edit' : 'read';
  if (doc.access === 'shared' && viewerId !== null && share !== null) return share.canEdit && write ? 'edit' : 'read';

  return null;
}

export function canEdit(role: DocRole | null): boolean {
  return role === 'owner' || role === 'edit';
}

/* --- live editing -------------------------------------------------------------------------------- */

/** How long the editor waits after the last keystroke before saving. */
export const SAVE_AFTER_MS = 2500;

/** About 8 pointer messages a second while the mouse moves... */
export const POINTER_EVERY_MS = 125;
/** ...and 2 a second once a document is crowded (the realtime safety valve). */
export const POINTER_CROWDED_EVERY_MS = 500;
/** More people than this in one document and pointers slow down. */
export const POINTER_CROWD = 6;

export function pointerInterval(peopleInRoom: number): number {
  return peopleInRoom > POINTER_CROWD ? POINTER_CROWDED_EVERY_MS : POINTER_EVERY_MS;
}

/** A pointer still this long starts to fade... */
export const POINTER_STILL_MS = 10_000;
/** ...in these steps (no easing: the site's no-easing rule), then goes. */
export const POINTER_FADE_STEPS = [1, 0.66, 0.33];
export const POINTER_FADE_STEP_MS = 700;

/** How see-through a pointer is `stillFor` ms after it last moved; 0 is gone. */
export function pointerOpacity(stillFor: number): number {
  if (stillFor < POINTER_STILL_MS) return 1;
  const step = Math.floor((stillFor - POINTER_STILL_MS) / POINTER_FADE_STEP_MS) + 1;
  return step < POINTER_FADE_STEPS.length ? POINTER_FADE_STEPS[step] : 0;
}

/* --- versions ------------------------------------------------------------------------------------ */

/** An unnamed copy is kept at most once an hour while a document is edited. */
export const VERSION_EVERY_MS = 60 * 60 * 1000;
export const VERSION_CAP = 40;

export function versionDue(lastUnnamedAt: string | null, now: number): boolean {
  if (lastUnnamedAt === null) return true;
  const last = Date.parse(lastUnnamedAt);
  return Number.isNaN(last) || now - last >= VERSION_EVERY_MS;
}

/* --- text ---------------------------------------------------------------------------------------- */

export function wordCountOf(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words === null ? 0 : words.length;
}

/** The first line or so of the writing, for a post or a preview. */
export function snippetOf(text: string, limit = 140): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > limit ? `${oneLine.slice(0, limit).trimEnd()}...` : oneLine;
}

/** Newest first, what the browser lists. */
export function sortByUpdated<T extends Pick<DocSummary, 'updatedAt'>>(docs: T[]): T[] {
  return [...docs].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

/* --- pictures ------------------------------------------------------------------------------------ */

export const PICTURE_MAX_BYTES = 1024 * 1024;
export const PICTURE_MAX_EDGE = 1600;
export const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** The storage bucket the pictures live in. */
export const PICTURE_BUCKET = 'doc-pictures';

/**
 * Whether a picture's address is one this site filed.
 *
 * A document is edited by others, so any address could be written into one; only our own bucket is
 * drawn (no tracking pixels, nothing from elsewhere). `base` is the Supabase project address; the
 * mock store's pictures are `data:` addresses it made itself.
 */
export function isOwnPicture(src: unknown, base: string): boolean {
  if (typeof src !== 'string') return false;
  if (base.length > 0 && src.length <= 600 && src.startsWith(`${base.replace(/\/+$/, '')}/storage/v1/object/public/${PICTURE_BUCKET}/`)) {
    return /^[A-Za-z0-9:/._-]+$/.test(src);
  }
  return base.length === 0 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src);
}
