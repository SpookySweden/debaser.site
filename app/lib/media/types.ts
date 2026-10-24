/**
 * The media catalogue's own shapes (SPEC-media-catalogue.md).
 *
 * One record per file the site holds, whatever it is - a picture, a track, a video - and one row per
 * place it is used. Everything else on the site keeps its own copy of what it needs (a post keeps its
 * `ForumPreview`, a profile its version list); the catalogue is where those copies are traced back to
 * the file they came from.
 */

export type MediaKind = 'image' | 'audio' | 'video';

/** How a file got into the catalogue. */
export type MediaSource = 'upload' | 'sheet' | 'migrated';

export type MediaItem = {
  id: string;
  kind: MediaKind;
  /** Where the bytes are: a bucket and a path in it; '' for a file that ships with the project. */
  bucket: string;
  path: string;
  /** The public address every reader of the file points at. */
  src: string;
  /** Fingerprint of the bytes: the same file is the same item, however often it is sent. */
  sha256: string;
  /** How a picture looks, as a 64-bit difference hash in hex; undefined for sound and video. */
  phash?: string;
  bytes: number;
  mime: string;
  width?: number;
  height?: number;
  /** Running time as it reads in a list (`5:12`); '' when unknown or not a timed file. */
  length: string;
  title: string;
  credit: string;
  tags: string[];
  /** The archive folder a track is filed in, audio only. */
  folderPath?: string | null;
  source: MediaSource;
  uploadedBy: string | null;
  uploadedByLabel: string;
  createdAt: string;
};

export type MediaUseKind = 'post' | 'reply' | 'profile_picture' | 'profile_song' | 'sheet' | 'lore_page';

export type MediaUse = {
  id: string;
  mediaId: string;
  useKind: MediaUseKind;
  /** The id of the place in its own table, so one place is listed once. */
  useId: string;
  /** Where a reader goes to see it, and what the link is called. */
  href: string;
  label: string;
  addedBy: string | null;
  usedAt: string;
};

/** An item with the places it is used, which is what the catalogue page draws per row. */
export type CatalogueEntry = {
  item: MediaItem;
  uses: MediaUse[];
};
