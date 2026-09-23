import { USING_MOCK_AUTH } from '../auth/auth-repository';
import { getSupabaseBrowserClient } from '../supabase/client';
import { MAX_AVATAR_BYTES } from './avatar-catalogue';
import { PROFILE_DATA_SOURCE } from './repository';

/**
 * Where an uploaded drawing goes.
 *
 * Two stores, one call. With profiles on Supabase the file goes to Supabase
 * Storage from the browser, under the visitor's own session - which is the whole
 * point, because the bucket's policies check that session and the upload therefore
 * works on a host with a read-only filesystem. With the mock profile store the file
 * goes to the project's own upload route, which writes it into
 * `assets/profiles/uploads/` beside every other drawing.
 *
 * The path carries the owner's id (`<user id>/avatar-v3-...png`) because that is
 * what the bucket policies read to keep one account out of another's folder.
 */
export const AVATAR_BUCKET = 'avatars';

export type AvatarUploadResult =
  | { ok: true; src: string; note: string }
  | { ok: false; error: string };

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** The rules the form keeps, so a refusal reads the same wherever it comes from. */
export function validateAvatarFile(file: File): string | undefined {
  if (CONTENT_TYPE_EXTENSIONS[file.type] === undefined) {
    return 'ONLY PNG, JPG, WEBP OR GIF DRAWINGS ARE ACCEPTED.';
  }

  if (file.size > MAX_AVATAR_BYTES) {
    return `DRAWINGS MUST BE ${Math.round(MAX_AVATAR_BYTES / 1024)}KB OR SMALLER.`;
  }

  return undefined;
}

/** `<user id>/avatar-v<version>-<stamp>.<ext>`, which is what the policies read. */
export function avatarStoragePath(userId: string, version: number, extension: string): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'local';
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

  return `${safeUserId}/avatar-v${version}-${stamp}${extension}`;
}

/**
 * The credential the upload route is sent with, once the site has real accounts.
 *
 * `app/api/profile/avatar/route.ts` checks the session when Supabase Auth is the backend,
 * and files the drawing under the account the token belongs to - so the browser has to
 * present its token or the picture is refused. With the mock accounts there is no session
 * to present, and the route's own rate limit is what stands in its place.
 *
 * Null means "there is nothing to present": signed out, or no client to read a session
 * from. Worth refusing before the upload rather than after it.
 */
async function sessionHeaders(): Promise<Record<string, string> | null> {
  if (USING_MOCK_AUTH) return {};

  const client = getSupabaseBrowserClient();
  if (client === null) return null;

  const { data } = await client.auth.getSession();
  const token = data.session?.access_token ?? null;

  return token === null ? null : { Authorization: `Bearer ${token}` };
}

export async function uploadAvatarDrawing(input: {
  file: File;
  userId: string;
  version: number;
}): Promise<AvatarUploadResult> {
  const problem = validateAvatarFile(input.file);
  if (problem !== undefined) return { ok: false, error: problem };

  const extension = CONTENT_TYPE_EXTENSIONS[input.file.type] ?? '.png';

  if (PROFILE_DATA_SOURCE === 'supabase') {
    const client = getSupabaseBrowserClient();
    if (client === null) return { ok: false, error: 'THE DRAWING UPLOAD IS NOT AVAILABLE.' };

    const path = avatarStoragePath(input.userId, input.version, extension);
    const { error } = await client.storage.from(AVATAR_BUCKET).upload(path, input.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: input.file.type,
    });

    if (error !== null) {
      return {
        ok: false,
        error: `${error.message.toUpperCase()} - THE DRAWING COULD NOT BE SAVED.`,
      };
    }

    const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(path);

    return { ok: true, src: data.publicUrl, note: 'DRAWING FILED.' };
  }

  try {
    const headers = await sessionHeaders();
    if (headers === null) return { ok: false, error: 'SIGN IN AGAIN BEFORE FILING A DRAWING.' };

    const form = new FormData();
    form.append('file', input.file);
    form.append('userId', input.userId);

    const response = await fetch('/api/profile/avatar', { method: 'POST', body: form, headers });
    const payload = (await response.json()) as { ok?: boolean; src?: string; error?: string };

    if (payload.ok !== true || payload.src === undefined) {
      return { ok: false, error: payload.error ?? 'THE UPLOAD WAS REFUSED.' };
    }

    return { ok: true, src: payload.src, note: 'DRAWING FILED.' };
  } catch {
    return { ok: false, error: 'UPLOAD FAILED.' };
  }
}
