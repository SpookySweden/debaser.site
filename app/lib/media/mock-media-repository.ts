import type { CreateMediaItemInput, CreateMediaUseInput, MediaRepository, RecordMediaItemInput } from './repository';
import { mediaExtension, validateMediaFile } from './rules';
import type { MediaItem, MediaUse } from './types';

/**
 * The catalogue without a backend: records in the browser's own storage, files in the project's
 * `assets/media/` folder through `app/api/media/upload` (which refuses on a read-only host and says so).
 *
 * Same shape as the Supabase store, so a screen written against one runs against the other. The
 * mock keeps the one rule that matters here too: one item per fingerprint.
 */

const ITEMS_KEY = 'debaser.media.items.v1';
const USES_KEY = 'debaser.media.uses.v1';
const WIRE = 'debaser.media.changed';

let items: MediaItem[] | null = null;
let uses: MediaUse[] | null = null;
const listeners = new Set<() => void>();

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readList<T>(key: string, isShaped: (value: unknown) => value is T): T[] {
  if (!hasStorage()) return [];

  const raw = window.localStorage.getItem(key);
  if (raw === null || raw.length === 0) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isShaped) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: unknown[]): void {
  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Storage full or refused: the in-memory copy still serves this tab.
  }
}

function isItemShaped(value: unknown): value is MediaItem {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<MediaItem>;

  return typeof row.id === 'string' && typeof row.src === 'string' && typeof row.sha256 === 'string' && typeof row.kind === 'string';
}

function isUseShaped(value: unknown): value is MediaUse {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<MediaUse>;

  return typeof row.id === 'string' && typeof row.mediaId === 'string' && typeof row.useKind === 'string';
}

function allItems(): MediaItem[] {
  if (items === null) items = readList(ITEMS_KEY, isItemShaped);
  return items;
}

function allUses(): MediaUse[] {
  if (uses === null) uses = readList(USES_KEY, isUseShaped);
  return uses;
}

function changed(): void {
  for (const listener of listeners) listener();

  if (hasStorage()) {
    try {
      window.localStorage.setItem(WIRE, String(Date.now()));
    } catch {
      // Another tab simply does not hear about it.
    }
  }
}

function localId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class MockMediaRepository implements MediaRepository {
  async listItems(): Promise<{ items: MediaItem[]; answered: boolean }> {
    return { items: [...allItems()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), answered: true };
  }

  async findBySha(sha256: string): Promise<MediaItem | null> {
    return allItems().find((item) => item.sha256 === sha256) ?? null;
  }

  async uploadItem(input: CreateMediaItemInput): Promise<MediaItem> {
    const problem = validateMediaFile(input.kind, input.file);
    if (problem !== undefined) throw new Error(problem);

    const existing = await this.findBySha(input.sha256);
    if (existing !== null) return existing;

    const form = new FormData();
    form.append('file', input.file);
    form.append('kind', input.kind);
    form.append('userId', input.uploaderId);

    const response = await fetch('/api/media/upload', { method: 'POST', body: form });
    const payload = (await response.json()) as { ok?: boolean; src?: string; error?: string };

    if (payload.ok !== true || payload.src === undefined) {
      throw new Error(payload.error ?? 'THE UPLOAD WAS REFUSED.');
    }

    const { file, ...rest } = input;

    return this.recordItem({
      ...rest,
      bucket: '',
      path: payload.src,
      src: payload.src,
      bytes: file.size,
      mime: file.type.length === 0 ? `${input.kind}/${(mediaExtension(input.kind, file) ?? '.bin').slice(1)}` : file.type,
    });
  }

  async recordItem(input: RecordMediaItemInput): Promise<MediaItem> {
    const existing = await this.findBySha(input.sha256);
    if (existing !== null) return existing;

    const item: MediaItem = {
      id: localId('media'),
      kind: input.kind,
      bucket: input.bucket,
      path: input.path,
      src: input.src,
      sha256: input.sha256,
      ...(input.phash === undefined ? {} : { phash: input.phash }),
      bytes: input.bytes,
      mime: input.mime,
      ...(input.width === undefined ? {} : { width: input.width }),
      ...(input.height === undefined ? {} : { height: input.height }),
      length: input.length ?? '',
      title: input.title.trim(),
      credit: input.credit.trim(),
      tags: input.tags,
      folderPath: input.folderPath ?? null,
      source: input.source ?? 'upload',
      uploadedBy: input.uploaderId,
      uploadedByLabel: input.uploaderName,
      createdAt: new Date().toISOString(),
    };

    items = [item, ...allItems()];
    writeList(ITEMS_KEY, items);
    changed();

    return item;
  }

  async updateItem(id: string, patch: { title?: string; credit?: string; tags?: string[] }): Promise<MediaItem> {
    const current = allItems().find((item) => item.id === id);
    if (current === undefined) throw new Error('THAT FILE IS NOT IN THE CATALOGUE.');

    const next: MediaItem = {
      ...current,
      ...(patch.title === undefined ? {} : { title: patch.title.trim() }),
      ...(patch.credit === undefined ? {} : { credit: patch.credit.trim() }),
      ...(patch.tags === undefined ? {} : { tags: patch.tags }),
    };

    items = allItems().map((item) => (item.id === id ? next : item));
    writeList(ITEMS_KEY, items);
    changed();

    return next;
  }

  async listUses(mediaId?: string): Promise<MediaUse[]> {
    return allUses()
      .filter((use) => mediaId === undefined || use.mediaId === mediaId)
      .sort((a, b) => b.usedAt.localeCompare(a.usedAt));
  }

  async addUse(input: CreateMediaUseInput): Promise<MediaUse | null> {
    const already = allUses().find(
      (use) => use.mediaId === input.mediaId && use.useKind === input.useKind && use.useId === input.useId,
    );
    if (already !== undefined) return already;

    const use: MediaUse = {
      id: localId('use'),
      mediaId: input.mediaId,
      useKind: input.useKind,
      useId: input.useId,
      href: input.href,
      label: input.label,
      addedBy: input.addedBy,
      usedAt: new Date().toISOString(),
    };

    uses = [use, ...allUses()];
    writeList(USES_KEY, uses);
    changed();

    return use;
  }

  subscribe(listener: () => void): () => void {
    listeners.add(listener);

    const onStorage = (event: StorageEvent) => {
      if (event.key === WIRE || event.key === ITEMS_KEY || event.key === USES_KEY) {
        items = null;
        uses = null;
        listener();
      }
    };

    if (hasStorage()) window.addEventListener('storage', onStorage);

    return () => {
      listeners.delete(listener);
      if (hasStorage()) window.removeEventListener('storage', onStorage);
    };
  }
}

let instance: MockMediaRepository | null = null;

export function getMockMediaRepository(): MediaRepository {
  if (instance === null) instance = new MockMediaRepository();
  return instance;
}
