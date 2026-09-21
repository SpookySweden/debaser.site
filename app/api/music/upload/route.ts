import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { MUSIC_UPLOAD_DIRECTORY, extensionForTrack, slugFromFileName, validateTrackFile } from '../../../lib/audio/catalogue';

/**
 * Receives a track and files it into the project assets folder, beside the tracks
 * that were dropped in by hand - so the archive's own shelf can grow without a
 * database.
 *
 *   POST multipart/form-data { file }  ->  { ok: true, src }
 *   src: /assets/audio/<slug>-<stamp>.<ext>
 *
 * This is the mock store's half of the music shelf. With Supabase configured the
 * browser uploads straight to the `mp3` bucket instead (see
 * app/lib/audio/supabase-music-repository.ts), which is the path that works on a
 * deployment with a read-only disk - this route says so rather than failing obscurely
 * if the write is refused.
 */

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  let file: FormDataEntryValue | null = null;

  try {
    const form = await request.formData();
    file = form.get('file');
  } catch {
    return json({ ok: false, error: 'EXPECTED A MULTIPART FORM UPLOAD.' }, 400);
  }

  if (!(file instanceof File)) {
    return json({ ok: false, error: 'NO TRACK WAS SENT.' }, 400);
  }

  const problem = validateTrackFile(file);
  if (problem !== undefined) {
    return json({ ok: false, error: problem }, 415);
  }

  const extension = extensionForTrack(file);
  if (extension === undefined) {
    return json({ ok: false, error: 'ONLY MP3, M4A, OGG, WAV AND FLAC TRACKS ARE ACCEPTED.' }, 415);
  }

  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const fileName = `${slugFromFileName(file.name)}-${stamp}${extension}`;
  const directory = path.join(process.cwd(), MUSIC_UPLOAD_DIRECTORY);

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), new Uint8Array(await file.arrayBuffer()));
  } catch {
    return json(
      {
        ok: false,
        error: 'THIS DEPLOYMENT CANNOT STORE UPLOADS (READ-ONLY DISK) - USE THE SUPABASE mp3 BUCKET FOR TRACKS.',
      },
      501,
    );
  }

  return json({ ok: true, src: `/assets/audio/${fileName}` }, 200);
}
