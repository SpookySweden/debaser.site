import { normaliseAudioTags } from '../audio/tags';
import { refreshCatalogue } from './catalogue';
import { LOOKS_ALIKE_DISTANCE, hashDistance, imageLooksHash, imageSize, mediaLength, sha256Hex } from './fingerprint';
import { getMediaRepository } from './repository';
import { validateMediaFile } from './rules';
import type { MediaItem, MediaKind } from './types';

/**
 * Getting a file into the catalogue, from any screen that takes one.
 *
 * One module for every upload on the site - the catalogue page, a post's picture, a profile's picture
 * or song, the music shelf - because the rule it keeps has to hold everywhere or it does not hold:
 *
 *   1. validate (kind, type, size) with the same sentence every screen shows;
 *   2. fingerprint the bytes in the browser, and a picture's look as well;
 *   3. ask the catalogue: the same bytes already there -> hand back the original, upload nothing;
 *   4. otherwise upload to the kind's bucket under the uploader's folder and record the item.
 *
 * The looks-alike check is a separate question (`findLookalike`), because its answer is a
 * recommendation the person decides on, not a rule the upload applies.
 */

export type MediaUploadInput = {
  kind: MediaKind;
  file: File;
  title: string;
  credit?: string;
  tags?: string[];
  folderPath?: string | null;
  uploader: { id: string; displayName: string };
};

export type MediaUploadResult =
  | { ok: true; item: MediaItem; reused: boolean; note: string }
  | { ok: false; error: string };

/** The fingerprints of a file, read before anything is sent. */
export type MediaFingerprint = {
  sha256: string;
  phash?: string;
  width?: number;
  height?: number;
  length?: string;
};

export async function fingerprintFile(kind: MediaKind, file: File): Promise<MediaFingerprint> {
  const sha256 = await sha256Hex(file);

  if (kind === 'image') {
    const [phash, size] = await Promise.all([imageLooksHash(file), imageSize(file)]);
    return { sha256, ...(phash === undefined ? {} : { phash }), ...(size ?? {}) };
  }

  const length = await mediaLength(file, kind);
  return { sha256, ...(length === undefined ? {} : { length }) };
}

/**
 * The catalogued original of a file, if its bytes are already there - asked before an upload that
 * goes somewhere else (a profile picture, a track on the shelf), so the upload can be skipped and
 * the original's address used instead.
 */
export async function findOriginal(
  kind: MediaKind,
  file: File,
): Promise<{ fingerprint: MediaFingerprint; original: MediaItem | null }> {
  const fingerprint = await fingerprintFile(kind, file);
  const original = await getMediaRepository().findBySha(fingerprint.sha256).catch(() => null);

  return { fingerprint, original };
}

export type RecordMediaInput = {
  kind: MediaKind;
  /** The file as it was sent, for its size and type. */
  file: File;
  fingerprint: MediaFingerprint;
  /** Where it ended up. */
  bucket: string;
  path: string;
  src: string;
  title: string;
  credit?: string;
  tags?: string[];
  folderPath?: string | null;
  uploader: { id: string; displayName: string };
};

/**
 * Records a file another screen has just stored (the avatars bucket, the mp3 bucket), so it is in
 * the catalogue like anything uploaded through the catalogue itself. Never throws: a record that
 * fails is reported, because the file itself is safely where its screen put it.
 */
export async function recordMedia(input: RecordMediaInput): Promise<MediaItem | null> {
  try {
    const item = await getMediaRepository().recordItem({
      kind: input.kind,
      ...input.fingerprint,
      bucket: input.bucket,
      path: input.path,
      src: input.src,
      bytes: input.file.size,
      mime: input.file.type,
      title: input.title.trim(),
      credit: (input.credit ?? '').trim(),
      tags: normaliseAudioTags(input.tags ?? []),
      folderPath: input.folderPath ?? null,
      uploaderId: input.uploader.id,
      uploaderName: input.uploader.displayName,
    });
    await refreshCatalogue();
    return item;
  } catch (caught) {
    console.warn(`media not recorded: ${caught instanceof Error ? caught.message : String(caught)}`);
    return null;
  }
}

export async function uploadMedia(input: MediaUploadInput): Promise<MediaUploadResult> {
  const problem = validateMediaFile(input.kind, input.file);
  if (problem !== undefined) return { ok: false, error: problem };

  const title = input.title.trim();
  if (title.length === 0) return { ok: false, error: 'THE FILE NEEDS A TITLE.' };

  try {
    const repository = getMediaRepository();
    const fingerprint = await fingerprintFile(input.kind, input.file);

    const original = await repository.findBySha(fingerprint.sha256);
    if (original !== null) {
      return {
        ok: true,
        item: original,
        reused: true,
        note: `ALREADY IN THE CATALOGUE AS "${original.title}" - USING THE ORIGINAL.`,
      };
    }

    const item = await repository.uploadItem({
      kind: input.kind,
      file: input.file,
      ...fingerprint,
      title,
      credit: (input.credit ?? '').trim(),
      tags: normaliseAudioTags(input.tags ?? []),
      folderPath: input.folderPath ?? null,
      uploaderId: input.uploader.id,
      uploaderName: input.uploader.displayName,
    });

    // The shared list is read again before the item is handed back, so a composer that picks it
    // by id finds it there (the live store has no event to push it; the mock writes one itself).
    await refreshCatalogue();

    return { ok: true, item, reused: false, note: 'FILED IN THE CATALOGUE.' };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : 'THE UPLOAD WAS REFUSED.' };
  }
}

/**
 * The catalogued picture that looks most like this one, if any does.
 *
 * Asked by a composer before it uploads, so the person can cite the original instead. `items` is the
 * catalogue as the caller already has it (the page and the pickers hold it), so this reads nothing.
 */
export function findLookalike(phash: string | undefined, items: MediaItem[]): { item: MediaItem; distance: number } | null {
  if (phash === undefined) return null;

  let best: { item: MediaItem; distance: number } | null = null;

  for (const item of items) {
    if (item.kind !== 'image' || item.phash === undefined) continue;

    const distance = hashDistance(phash, item.phash);
    if (distance <= LOOKS_ALIKE_DISTANCE && (best === null || distance < best.distance)) {
      best = { item, distance };
    }
  }

  return best;
}
