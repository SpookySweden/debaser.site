import { getSupabaseBrowserClient } from '../supabase/client';
import { PAGE_MAX_BYTES, PAGE_TYPES, UPLOAD_CHUNK_BYTES } from './rules';
import { COMIC_DATA_SOURCE } from './source';
import type { UploadedPage } from './types';

/**
 * The studio's side of a page upload (SPEC-comic.md, "Page files"): the file goes to `/api/comic/upload` in pieces, in order,
 * under an admin's session (a moderator's); the last piece's answer says what the server made and stored. A piece that fails is
 * tried twice more before the page is given up.
 */

export async function sessionHeaders(): Promise<Record<string, string>> {
  if (COMIC_DATA_SOURCE !== 'supabase') return {};
  const client = getSupabaseBrowserClient();
  const { data } = client ? await client.auth.getSession() : { data: { session: null } };
  const token = data.session?.access_token ?? null;
  return token === null ? {} : { Authorization: `Bearer ${token}` };
}

export function pageFileProblem(file: File): string | null {
  if (PAGE_TYPES[file.type] === undefined) return `${file.name}: USE PNG, JPEG, WEBP OR TIFF.`;
  if (file.size > PAGE_MAX_BYTES) return `${file.name}: OVER 500 MB.`;
  if (file.size === 0) return `${file.name}: EMPTY.`;
  return null;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function uploadPage(
  file: File,
  target: { pageId: string; version: number },
  onProgress: (fraction: number) => void,
): Promise<UploadedPage> {
  const problem = pageFileProblem(file);
  if (problem) throw new Error(problem);
  const uploadId = newId();
  const count = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_BYTES));
  for (let index = 0; index < count; index += 1) {
    const piece = file.slice(index * UPLOAD_CHUNK_BYTES, Math.min(file.size, (index + 1) * UPLOAD_CHUNK_BYTES));
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch('/api/comic/upload', {
          method: 'POST',
          body: piece,
          headers: {
            ...(await sessionHeaders()),
            'Content-Type': 'application/octet-stream',
            'x-comic-upload': uploadId,
            'x-comic-page': target.pageId,
            'x-comic-version': String(target.version),
            'x-comic-type': file.type,
            'x-comic-size': String(file.size),
            'x-comic-index': String(index),
            'x-comic-count': String(count),
          },
        });
        const body = (await response.json().catch(() => ({}))) as { error?: string; page?: UploadedPage };
        if (!response.ok) {
          // The server's refusals are final; only a lost connection is worth another try.
          throw Object.assign(new Error(body.error ?? 'THAT PAGE COULD NOT BE UPLOADED.'), { final: true });
        }
        onProgress((index + 1) / count);
        if (index === count - 1) {
          if (!body.page) throw new Error('THAT PAGE COULD NOT BE UPLOADED.');
          return body.page;
        }
        lastError = null;
        break;
      } catch (caught) {
        lastError = caught instanceof Error ? caught : new Error('THAT PAGE COULD NOT BE UPLOADED.');
        if ((caught as { final?: boolean }).final) throw lastError;
      }
    }
    if (lastError) throw lastError;
  }
  throw new Error('THAT PAGE COULD NOT BE UPLOADED.');
}
