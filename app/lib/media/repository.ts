import { isSupabaseConfigured } from '../supabase/client';
import { getMockMediaRepository } from './mock-media-repository';
import { getSupabaseMediaRepository } from './supabase-media-repository';
import type { MediaItem, MediaKind, MediaSource, MediaUse, MediaUseKind } from './types';

/**
 * The switch that decides where the catalogue keeps its records and its files.
 *
 * Supabase means the `media_items` and `media_uses` tables and the `images`, `mp3` and `video` buckets
 * (supabase/migrations/20261024021600_media_catalogue.sql). The mock means the browser's own storage for
 * the records and the project's `assets/media/` folder for the files, through `app/api/media/upload`.
 * Default is the mock, like every other store, so the site runs with no backend. To move it over:
 *
 *   NEXT_PUBLIC_MEDIA_DATA_SOURCE=supabase
 */
export type MediaDataSource = 'mock' | 'supabase';

export const MEDIA_DATA_SOURCE: MediaDataSource =
  process.env.NEXT_PUBLIC_MEDIA_DATA_SOURCE === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

/** What `uploadItem` needs besides the file: the fingerprints are computed by the caller (./upload.ts). */
export type CreateMediaItemInput = {
  kind: MediaKind;
  file: File;
  sha256: string;
  phash?: string;
  width?: number;
  height?: number;
  length?: string;
  title: string;
  credit: string;
  tags: string[];
  folderPath?: string | null;
  source?: MediaSource;
  uploaderId: string;
  uploaderName: string;
};

/** A file that is already stored somewhere the site serves (a bucket, the assets folder): record it. */
export type RecordMediaItemInput = Omit<CreateMediaItemInput, 'file'> & {
  bucket: string;
  path: string;
  src: string;
  bytes: number;
  mime: string;
};

export type CreateMediaUseInput = {
  mediaId: string;
  useKind: MediaUseKind;
  useId: string;
  href: string;
  label: string;
  addedBy: string | null;
};

export type MediaRepository = {
  /** Every item, newest first. Never throws: an unreadable catalogue reads as an empty one, and says so. */
  listItems(): Promise<{ items: MediaItem[]; answered: boolean }>;
  /** The item with these bytes, if the catalogue already holds it. */
  findBySha(sha256: string): Promise<MediaItem | null>;
  /** Files the bytes and records them. Throws with a sentence fit to show. */
  uploadItem(input: CreateMediaItemInput): Promise<MediaItem>;
  /** Records a file that is already stored. The same bytes already recorded -> that row, unchanged. */
  recordItem(input: RecordMediaItemInput): Promise<MediaItem>;
  /** Title, credit and tags of an item the caller owns. */
  updateItem(id: string, patch: { title?: string; credit?: string; tags?: string[] }): Promise<MediaItem>;
  /** Every recorded use, newest first (all items, or one). */
  listUses(mediaId?: string): Promise<MediaUse[]>;
  /** Records one place a file is used. A place already recorded is left as it is. */
  addUse(input: CreateMediaUseInput): Promise<MediaUse | null>;
  /** Draws from the catalogue: the listener fires when an item or a use is written. */
  subscribe(listener: () => void): () => void;
};

let repository: MediaRepository | null = null;

export function getMediaRepository(): MediaRepository {
  if (repository === null) {
    repository = MEDIA_DATA_SOURCE === 'supabase' ? getSupabaseMediaRepository() : getMockMediaRepository();
  }

  return repository;
}
