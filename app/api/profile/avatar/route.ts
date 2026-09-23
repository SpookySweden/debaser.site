import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { AVATAR_UPLOAD_DIRECTORY, MAX_AVATAR_BYTES } from '../../../lib/profile/avatar-catalogue';
/**
 * Receives a hand-drawn profile picture and files it into the project assets
 * folder, so the drawing is a normal file the site serves like every other one -
 * never generated in code, never inlined into a page.
 *
 *   POST multipart/form-data { file, userId }  ->  { ok: true, src }
 *   src: /assets/profiles/uploads/<userId>-<stamp>.<ext>
 *
 * Hosting note: this writes to the project folder, which works locally and on
 * any host with a writable disk. On a read-only deployment (Vercel) the write
 * fails and the reply says so - profile pictures then belong in Supabase
 * Storage and only the returned `src` changes (see lib/profile/avatar-upload.ts,
 * which is what the browser calls, and which only comes here when profiles are on
 * the mock store).
 *
 * Who may file one: with Supabase Auth behind the site - the switch the rest of the
 * site reads, `NEXT_PUBLIC_AUTH_BACKEND=supabase` plus a project url - the caller has
 * to present a session token, and the drawing is filed under the account that token
 * belongs to. The `userId` field is then ignored outright, so the folder a picture
 * lands in is not the sender's to choose. With the mock accounts there is no session
 * to check at all, so the route keeps its older behaviour and says so here rather than
 * pretending: that is the configuration the site runs in with no backend, and the
 * browser's own upload form is the only writer of it.
 *
 * One drawing per few minutes, per account, at most: see `tooManyUploads` below. The
 * limit is best-effort rather than a promise - a serverless host may run several
 * instances of this route and each counts only what it saw - but it is what stops a
 * script filling the disk on a host that has one. On the Supabase path the drawing
 * never reaches this file at all, and the bucket's policies are the bound.
 */

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True when there is a session worth asking about: the site's auth switch, plus a project. */
const AUTH_IS_SUPABASE =
  process.env.NEXT_PUBLIC_AUTH_BACKEND === 'supabase' && SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/** How many drawings one account may file, and the window they are counted over. */
const MAX_UPLOADS_PER_WINDOW = 5;
const WINDOW_MS = 10 * 60_000;

/** The stamps of the uploads this instance has seen, per account or per address. */
const uploads = new Map<string, number[]>();

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * The account the session belongs to, or null when there is no usable one.
 *
 * The token is checked against the project rather than trusted: a signature is the only
 * thing that makes the id inside it worth reading, and `getUser` is what checks it. The
 * client is made per call and keeps no session of its own - this is a server, and the
 * caller's token is the only credential in play.
 */
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
    // The project could not be reached: refused, not waved through. A picture is not
    // worth filing under an id nobody checked.
    return null;
  }
}

/** What the window is counted against: the account when there is one, the address otherwise. */
function rateLimitKey(request: Request, userId: string | null): string {
  if (userId !== null) return `account:${userId}`;

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const address = forwarded.split(',')[0]?.trim() ?? '';

  return `address:${address.length === 0 ? 'unknown' : address}`;
}

/**
 * True when this caller has used its window up.
 *
 * The stamps are pruned as they are read, so a key that has gone quiet stops costing
 * anything, and the map is swept once it holds more keys than one deployment should ever
 * need - which is what keeps an in-memory counter from becoming the leak it is often
 * accused of being.
 */
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

export async function POST(request: Request) {
  // Who is asking, before the body is read: an unauthenticated caller never gets this
  // route to parse a drawing at all.
  const account = AUTH_IS_SUPABASE ? await sessionUserId(request) : null;

  if (AUTH_IS_SUPABASE && account === null) {
    return json(
      { ok: false, error: 'SIGN IN AGAIN BEFORE FILING A DRAWING - THE UPLOAD NEEDS A SESSION.' },
      401,
    );
  }

  if (tooManyUploads(rateLimitKey(request, account), Date.now())) {
    return json(
      { ok: false, error: 'THAT IS A LOT OF DRAWINGS AT ONCE - WAIT A FEW MINUTES AND TRY AGAIN.' },
      429,
    );
  }

  let file: FormDataEntryValue | null = null;
  let userId = account ?? 'local';

  try {
    const form = await request.formData();
    file = form.get('file');

    // Only read while the accounts are the mock ones: with a session, the picture is filed
    // under the account the token belongs to and this field means nothing.
    const submittedUserId = account === null ? form.get('userId') : null;
    if (typeof submittedUserId === 'string' && submittedUserId.length > 0) userId = submittedUserId;
  } catch {
    return json({ ok: false, error: 'EXPECTED A MULTIPART FORM UPLOAD.' }, 400);
  }

  if (!(file instanceof File)) {
    return json({ ok: false, error: 'NO DRAWING WAS SENT.' }, 400);
  }

  const extension = CONTENT_TYPE_EXTENSIONS[file.type];
  if (extension === undefined) {
    return json({ ok: false, error: 'ONLY PNG, JPG, WEBP OR GIF DRAWINGS ARE ACCEPTED.' }, 415);
  }

  if (file.size > MAX_AVATAR_BYTES) {
    return json(
      { ok: false, error: `DRAWINGS MUST BE ${Math.round(MAX_AVATAR_BYTES / 1024)}KB OR SMALLER.` },
      413,
    );
  }

  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'local';
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const fileName = `${safeUserId}-${stamp}${extension}`;
  const directory = path.join(/* turbopackIgnore: true */ process.cwd(), AVATAR_UPLOAD_DIRECTORY);

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), new Uint8Array(await file.arrayBuffer()));
  } catch {
    return json(
      {
        ok: false,
        error: 'DRAWINGS CANNOT BE STORED ON THIS DEPLOYMENT - TRY AGAIN LATER.',
      },
      501,
    );
  }

  return json({ ok: true, src: `/assets/profiles/uploads/${fileName}` }, 200);
}
