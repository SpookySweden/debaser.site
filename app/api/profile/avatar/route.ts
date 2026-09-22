import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
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
 * Storage and only the returned `src` changes.
 *
 * TODO(auth): require a signed-in session before accepting uploads once Supabase
 * Auth is live, and rate-limit the route.
 */

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  let file: FormDataEntryValue | null = null;
  let userId = 'local';

  try {
    const form = await request.formData();
    file = form.get('file');

    const submittedUserId = form.get('userId');
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
