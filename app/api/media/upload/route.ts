import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { MEDIA_UPLOAD_DIRECTORY, mediaExtension, validateMediaFile } from '../../../lib/media/rules';
import type { MediaKind } from '../../../lib/media/types';

/**
 * Receives a catalogue file and files it into the project assets folder - the mock store's half of
 * the media catalogue, used only while `NEXT_PUBLIC_MEDIA_DATA_SOURCE` is not `supabase`. With
 * Supabase configured the browser uploads straight to the kind's bucket instead
 * (app/lib/media/supabase-media-repository.ts), which is the path that works on a read-only host.
 *
 *   POST multipart/form-data { file, kind, userId }  ->  { ok: true, src }
 *   src: /assets/media/<kind>/<userId>-<stamp>.<ext>
 *
 * Who may file one, the rate limit and the ordering (who is asking, before the body is read) are the
 * avatar route's, which is the pattern (.claude/rules/backend.md): with Supabase Auth behind the site
 * the caller presents a session token and the file is filed under that account; with the mock accounts
 * there is no session to check and the sent id is used.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const AUTH_IS_SUPABASE =
  process.env.NEXT_PUBLIC_AUTH_BACKEND === 'supabase' && SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

const MAX_UPLOADS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60_000;
const uploads = new Map<string, number[]>();

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sessionUserId(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (token.length === 0) return null;

  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error !== null) return null;

    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function rateLimitKey(request: Request, userId: string | null): string {
  if (userId !== null) return `account:${userId}`;

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const address = forwarded.split(',')[0]?.trim() ?? '';

  return `address:${address.length === 0 ? 'unknown' : address}`;
}

function tooManyUploads(key: string, now: number): boolean {
  const recent = (uploads.get(key) ?? []).filter((stamp) => now - stamp < WINDOW_MS);

  if (recent.length >= MAX_UPLOADS_PER_WINDOW) {
    uploads.set(key, recent);
    return true;
  }

  recent.push(now);
  uploads.set(key, recent);

  if (uploads.size > 500) {
    for (const [entry, stamps] of uploads) {
      if (stamps.every((stamp) => now - stamp >= WINDOW_MS)) uploads.delete(entry);
    }
  }

  return false;
}

function isKind(value: unknown): value is MediaKind {
  return value === 'image' || value === 'audio' || value === 'video';
}

export async function POST(request: Request) {
  const account = AUTH_IS_SUPABASE ? await sessionUserId(request) : null;

  if (AUTH_IS_SUPABASE && account === null) {
    return json({ ok: false, error: 'SIGN IN AGAIN BEFORE FILING A FILE - THE UPLOAD NEEDS A SESSION.' }, 401);
  }

  if (tooManyUploads(rateLimitKey(request, account), Date.now())) {
    return json({ ok: false, error: 'THAT IS A LOT OF FILES AT ONCE - WAIT A FEW MINUTES AND TRY AGAIN.' }, 429);
  }

  let file: FormDataEntryValue | null = null;
  let kind: FormDataEntryValue | null = null;
  let userId = account ?? 'local';

  try {
    const form = await request.formData();
    file = form.get('file');
    kind = form.get('kind');

    const submittedUserId = account === null ? form.get('userId') : null;
    if (typeof submittedUserId === 'string' && submittedUserId.length > 0) userId = submittedUserId;
  } catch {
    return json({ ok: false, error: 'EXPECTED A MULTIPART FORM UPLOAD.' }, 400);
  }

  if (!(file instanceof File)) return json({ ok: false, error: 'NO FILE WAS SENT.' }, 400);
  if (!isKind(kind)) return json({ ok: false, error: 'SAY WHAT KIND OF FILE IT IS.' }, 400);

  const problem = validateMediaFile(kind, file);
  if (problem !== undefined) return json({ ok: false, error: problem }, 415);

  const extension = mediaExtension(kind, file) ?? '.bin';
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'local';
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const fileName = `${safeUserId}-${stamp}-${Math.random().toString(36).slice(2, 8)}${extension}`;
  const directory = path.join(/* turbopackIgnore: true */ process.cwd(), MEDIA_UPLOAD_DIRECTORY, kind);

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(/* turbopackIgnore: true */ directory, fileName), new Uint8Array(await file.arrayBuffer()));
  } catch {
    return json({ ok: false, error: 'FILES CANNOT BE STORED ON THIS DEPLOYMENT - TRY AGAIN LATER.' }, 501);
  }

  return json({ ok: true, src: `/assets/media/${kind}/${fileName}` }, 200);
}
