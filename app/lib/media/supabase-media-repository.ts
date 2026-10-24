import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../supabase/client';
import type { CreateMediaItemInput, CreateMediaUseInput, MediaRepository, RecordMediaItemInput } from './repository';
import { MEDIA_BUCKETS, mediaExtension, mediaStoragePath, validateMediaFile } from './rules';
import type { MediaItem, MediaKind, MediaSource, MediaUse, MediaUseKind } from './types';

/**
 * The catalogue in Supabase - the production implementation of `MediaRepository`.
 *
 * Tables and buckets it expects (supabase/migrations/20261024021600_media_catalogue.sql):
 *
 *   media_items   one row per file, unique on sha256 and on src
 *   media_uses    one row per place a file is used
 *   images, mp3, video buckets   public read, authenticated insert into the uploader's own folder
 *
 * Two rules, both borrowed from the music shelf:
 *   1. a listing that cannot be read does not throw - it answers an empty catalogue and says it could
 *      not read, so the page draws a fault rather than a lie;
 *   2. an upload *does* throw, with the reason in plain words.
 */

const ITEMS_TABLE = 'media_items';
const USES_TABLE = 'media_uses';

const ITEM_COLUMNS =
  'id, kind, bucket, path, src, sha256, phash, bytes, mime, width, height, length, title, credit, tags, folder_path, source, uploaded_by, uploaded_by_label, created_at';
const USE_COLUMNS = 'id, media_id, use_kind, use_id, href, label, added_by, used_at';

/** The page lists at most this many; the catalogue is a shelf, not a feed. */
const ITEM_LIMIT = 2000;
const USE_LIMIT = 5000;

type ItemRow = {
  id: string;
  kind: MediaKind;
  bucket: string;
  path: string;
  src: string;
  sha256: string;
  phash: string | null;
  bytes: number | string;
  mime: string;
  width: number | null;
  height: number | null;
  length: string;
  title: string;
  credit: string;
  tags: unknown;
  folder_path: string | null;
  source: MediaSource;
  uploaded_by: string | null;
  uploaded_by_label: string;
  created_at: string;
};

type UseRow = {
  id: string;
  media_id: string;
  use_kind: MediaUseKind;
  use_id: string;
  href: string;
  label: string;
  added_by: string | null;
  used_at: string;
};

function toItem(row: ItemRow): MediaItem {
  return {
    id: row.id,
    kind: row.kind,
    bucket: row.bucket,
    path: row.path,
    src: row.src,
    sha256: row.sha256,
    ...(row.phash === null ? {} : { phash: row.phash }),
    bytes: Number(row.bytes),
    mime: row.mime,
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    length: row.length,
    title: row.title,
    credit: row.credit,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    folderPath: row.folder_path,
    source: row.source,
    uploadedBy: row.uploaded_by,
    uploadedByLabel: row.uploaded_by_label,
    createdAt: row.created_at,
  };
}

function toUse(row: UseRow): MediaUse {
  return {
    id: row.id,
    mediaId: row.media_id,
    useKind: row.use_kind,
    useId: row.use_id,
    href: row.href,
    label: row.label,
    addedBy: row.added_by,
    usedAt: row.used_at,
  };
}

class SupabaseMediaRepository implements MediaRepository {
  private client(): SupabaseClient {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('THE CATALOGUE IS NOT AVAILABLE RIGHT NOW.');
    return client;
  }

  async listItems(): Promise<{ items: MediaItem[]; answered: boolean }> {
    const client = getSupabaseBrowserClient();
    if (client === null) return { items: [], answered: false };

    const { data, error } = await client
      .from(ITEMS_TABLE)
      .select(ITEM_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(ITEM_LIMIT);

    if (error !== null) {
      console.warn(`media catalogue read failed: ${error.message}`);
      return { items: [], answered: false };
    }

    return { items: ((data ?? []) as ItemRow[]).map(toItem), answered: true };
  }

  async findBySha(sha256: string): Promise<MediaItem | null> {
    const { data, error } = await this.client().from(ITEMS_TABLE).select(ITEM_COLUMNS).eq('sha256', sha256).maybeSingle();

    if (error !== null) throw new Error('THE CATALOGUE COULD NOT BE ASKED ABOUT THAT FILE.');

    return data === null ? null : toItem(data as ItemRow);
  }

  async uploadItem(input: CreateMediaItemInput): Promise<MediaItem> {
    const problem = validateMediaFile(input.kind, input.file);
    if (problem !== undefined) throw new Error(problem);

    const existing = await this.findBySha(input.sha256);
    if (existing !== null) return existing;

    const extension = mediaExtension(input.kind, input.file);
    if (extension === undefined) throw new Error('THAT KIND OF FILE IS NOT ACCEPTED.');

    const client = this.client();
    const bucket = MEDIA_BUCKETS[input.kind];
    const path = mediaStoragePath(input.kind, input.uploaderId, input.file.name, extension);

    const { error } = await client.storage.from(bucket).upload(path, input.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: input.file.type.length === 0 ? undefined : input.file.type,
    });

    if (error !== null) {
      throw new Error(`${error.message.toUpperCase()} - THE FILE COULD NOT BE SAVED.`);
    }

    const src = client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    const { file, ...rest } = input;

    return this.recordItem({ ...rest, bucket, path, src, bytes: file.size, mime: file.type });
  }

  async recordItem(input: RecordMediaItemInput): Promise<MediaItem> {
    const existing = await this.findBySha(input.sha256);
    if (existing !== null) return existing;

    const { data, error: rowError } = await this.client()
      .from(ITEMS_TABLE)
      .insert({
        kind: input.kind,
        bucket: input.bucket,
        path: input.path,
        src: input.src,
        sha256: input.sha256,
        phash: input.phash ?? null,
        bytes: input.bytes,
        mime: input.mime,
        width: input.width ?? null,
        height: input.height ?? null,
        length: input.length ?? '',
        title: input.title.trim(),
        credit: input.credit.trim(),
        tags: input.tags,
        folder_path: input.folderPath ?? null,
        source: input.source ?? 'upload',
        uploaded_by: input.uploaderId,
        uploaded_by_label: input.uploaderName,
      })
      .select(ITEM_COLUMNS)
      .single();

    if (rowError !== null) {
      // Two people sent the same file at once: the row that won is the item.
      const raced = await this.findBySha(input.sha256).catch(() => null);
      if (raced !== null) return raced;

      throw new Error('THE FILE WAS SAVED, BUT IT COULD NOT BE RECORDED IN THE CATALOGUE.');
    }

    return toItem(data as ItemRow);
  }

  async updateItem(id: string, patch: { title?: string; credit?: string; tags?: string[] }): Promise<MediaItem> {
    const update: Record<string, unknown> = {};
    if (patch.title !== undefined) update.title = patch.title.trim();
    if (patch.credit !== undefined) update.credit = patch.credit.trim();
    if (patch.tags !== undefined) update.tags = patch.tags;

    const { data, error } = await this.client().from(ITEMS_TABLE).update(update).eq('id', id).select(ITEM_COLUMNS).single();

    if (error !== null) throw new Error('THAT FILE COULD NOT BE CHANGED - ONLY ITS UPLOADER OR THE ADMIN MAY.');

    return toItem(data as ItemRow);
  }

  async listUses(mediaId?: string): Promise<MediaUse[]> {
    const client = getSupabaseBrowserClient();
    if (client === null) return [];

    let query = client.from(USES_TABLE).select(USE_COLUMNS).order('used_at', { ascending: false }).limit(USE_LIMIT);
    if (mediaId !== undefined) query = query.eq('media_id', mediaId);

    const { data, error } = await query;
    if (error !== null) {
      console.warn(`media uses read failed: ${error.message}`);
      return [];
    }

    return ((data ?? []) as UseRow[]).map(toUse);
  }

  async addUse(input: CreateMediaUseInput): Promise<MediaUse | null> {
    const { data, error } = await this.client()
      .from(USES_TABLE)
      .upsert(
        {
          media_id: input.mediaId,
          use_kind: input.useKind,
          use_id: input.useId,
          href: input.href,
          label: input.label,
          added_by: input.addedBy,
        },
        { onConflict: 'media_id,use_kind,use_id', ignoreDuplicates: true },
      )
      .select(USE_COLUMNS)
      .maybeSingle();

    // A use is a note beside a post, never the post: a refused note is reported, not thrown.
    if (error !== null) {
      console.warn(`media use not recorded: ${error.message}`);
      return null;
    }

    return data === null ? null : toUse(data as UseRow);
  }

  subscribe(listener: () => void): () => void {
    const client = getSupabaseBrowserClient();
    if (client === null) return () => undefined;

    const channel = client
      .channel('media-catalogue')
      .on('postgres_changes', { event: '*', schema: 'public', table: ITEMS_TABLE }, () => listener())
      .on('postgres_changes', { event: '*', schema: 'public', table: USES_TABLE }, () => listener())
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }
}

let instance: SupabaseMediaRepository | null = null;

export function getSupabaseMediaRepository(): MediaRepository {
  if (instance === null) instance = new SupabaseMediaRepository();
  return instance;
}
