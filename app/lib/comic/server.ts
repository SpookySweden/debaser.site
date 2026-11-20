import path from 'node:path';
import os from 'node:os';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { guessPanels } from './panel-guess';
import { PAGE_TYPES, READING_WIDTH, storagePaths, ZOOM_LONG_SIDE } from './rules';
import { COMIC_DATA_SOURCE } from './source';
import type { UploadedPage } from './types';

/**
 * The server's half of COMIC (SPEC-comic.md, "Page files"): who may upload, the copies made of each page, and where the files
 * go. Server only: the browser never imports this.
 *
 *   - Luke's original is kept as he uploaded it; the site makes a READING copy (READING_WIDTH wide) and a ZOOM copy
 *     (ZOOM_LONG_SIDE on the long side), high-quality JPEG with full colour detail, so line art stays crisp.
 *   - The first guess at the panels is read from the reading copy (`panel-guess.ts`).
 *   - On the database: the private `comic` bucket, written under the house account's own session (the bucket's policies
 *     check it). The original goes up in 6 MB pieces (Supabase Storage's resumable upload), so neither Cloudflare's 100 MB
 *     request cap nor a single slow request stops a big page.
 *   - On the mock store: files in `.comic-mock/` under the project folder, on this computer only.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const BUCKET = 'comic';
const TUS_CHUNK = 6 * 1024 * 1024;
const MOCK_ROOT = path.join(process.cwd(), '.comic-mock');
const UPLOAD_ROOT = path.join(os.tmpdir(), 'debaser-comic-uploads');

/** A page bigger than this many pixels is refused before it is decoded (a 30000 x 30000 sheet is 900 million). */
const MAX_PIXELS = 900_000_000;

export const IS_MOCK = COMIC_DATA_SOURCE === 'mock';

export function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

/** A Supabase client that asks as this session (or as a visitor, with no token). */
export function clientFor(token: string | null): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token === null ? undefined : { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Tokens already checked as the house account's, for a few minutes, so a 50-piece upload asks once. */
const admins = new Map<string, number>();

/** True when this token is the house account's (the database's own `is_admin()` decides). */
export async function isAdminToken(token: string | null): Promise<boolean> {
  if (token === null) return false;
  const known = admins.get(token);
  if (known !== undefined && known > Date.now()) return true;
  const client = clientFor(token);
  const { data: user, error } = await client.auth.getUser(token);
  if (error || !user.user) return false;
  const { data } = await client.rpc('is_admin');
  if (data !== true) return false;
  admins.set(token, Date.now() + 5 * 60_000);
  return true;
}

function uploadFile(uploadId: string): string {
  return path.join(UPLOAD_ROOT, `${uploadId}.part`);
}

/** Adds one piece to an upload in progress. Pieces must come in order: returns the bytes held so far. */
export async function appendPiece(uploadId: string, index: number, pieceBytes: number, piece: Uint8Array): Promise<number> {
  await mkdir(UPLOAD_ROOT, { recursive: true });
  const file = uploadFile(uploadId);
  const start = index * pieceBytes;
  if (index === 0) await rm(file, { force: true });
  const held = index === 0 ? 0 : await stat(file).then((info) => info.size, () => -1);
  // Fewer bytes than the pieces before this one: a piece went missing. More: this piece is being sent again.
  if (held < start) throw new Error('THE UPLOAD LOST A PIECE: TRY THAT PAGE AGAIN.');
  const handle = await open(file, index === 0 ? 'w' : 'r+');
  try {
    await handle.truncate(start);
    await handle.write(piece, 0, piece.byteLength, start);
  } finally {
    await handle.close();
  }
  return start + piece.byteLength;
}

export async function dropUpload(uploadId: string): Promise<void> {
  await rm(uploadFile(uploadId), { force: true });
}

/** Makes the copies and the panel guess from a finished upload, stores all three files, and says what was stored. */
export async function finishUpload(input: { uploadId: string; pageId: string; version: number; type: string; token: string | null }): Promise<UploadedPage> {
  const file = uploadFile(input.uploadId);
  const extension = PAGE_TYPES[input.type];
  if (extension === undefined) throw new Error('THAT FILE TYPE CAN\'T BE A PAGE: USE PNG, JPEG, WEBP OR TIFF.');
  try {
    const meta = await sharp(file, { limitInputPixels: MAX_PIXELS }).metadata();
    if (!['png', 'jpeg', 'webp', 'tiff'].includes(meta.format ?? '')) throw new Error('THAT FILE ISN\'T A PICTURE THIS CAN READ.');
    // A picture turned by its camera mark is stood upright first, so its sizes are the upright ones.
    const turned = (meta.orientation ?? 1) >= 5;
    const width = (turned ? meta.height : meta.width) ?? 0;
    const height = (turned ? meta.width : meta.height) ?? 0;
    if (width === 0 || height === 0) throw new Error('THAT FILE ISN\'T A PICTURE THIS CAN READ.');

    const white = { r: 255, g: 255, b: 255 };
    const jpeg = { quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true, progressive: true } as const;
    const reading = await sharp(file, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: READING_WIDTH, withoutEnlargement: true })
      .flatten({ background: white })
      .jpeg(jpeg)
      .toBuffer({ resolveWithObject: true });
    const zoom = await sharp(file, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: ZOOM_LONG_SIDE, height: ZOOM_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: white })
      .jpeg(jpeg)
      .toBuffer();
    const grey = await sharp(reading.data).greyscale().resize({ width: 500 }).raw().toBuffer({ resolveWithObject: true });
    const panels = guessPanels({ width: grey.info.width, height: grey.info.height, data: new Uint8Array(grey.data) });

    const paths = storagePaths(input.pageId, input.version, extension);
    if (IS_MOCK) {
      await mockWrite(paths.reading, reading.data);
      await mockWrite(paths.zoom, zoom);
      await mockWrite(paths.original, await readFile(file));
    } else {
      const client = clientFor(input.token);
      const putCopy = async (where: string, data: Buffer) => {
        const { error } = await client.storage.from(BUCKET).upload(where, data, { contentType: 'image/jpeg', upsert: true });
        if (error) throw new Error('THE PAGE\'S COPIES COULD NOT BE STORED.');
      };
      await putCopy(paths.reading, reading.data);
      await putCopy(paths.zoom, zoom);
      await resumableUpload(input.token, paths.original, file, input.type);
    }

    return {
      width,
      height,
      readingWidth: reading.info.width,
      readingHeight: reading.info.height,
      version: input.version,
      originalPath: paths.original,
      readingPath: paths.reading,
      zoomPath: paths.zoom,
      panels,
    };
  } finally {
    await rm(file, { force: true });
  }
}

async function mockWrite(where: string, data: Buffer): Promise<void> {
  const target = path.join(MOCK_ROOT, ...where.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
}

/** A copy from the mock store's folder, or null. The path is built by `storagePaths` from checked parts only. */
export async function mockRead(where: string): Promise<Buffer | null> {
  const target = path.resolve(MOCK_ROOT, ...where.split('/'));
  if (!target.startsWith(MOCK_ROOT + path.sep)) return null;
  return readFile(target).catch(() => null);
}

function metadataValue(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

/** Supabase Storage's resumable (TUS) upload: one request to begin, then the file in 6 MB pieces. */
async function resumableUpload(token: string | null, where: string, file: string, type: string): Promise<void> {
  const size = (await stat(file)).size;
  const auth = { authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY, 'tus-resumable': '1.0.0' };
  const begin = await fetch(`${SUPABASE_URL}/storage/v1/upload/resumable`, {
    method: 'POST',
    headers: {
      ...auth,
      'x-upsert': 'true',
      'upload-length': String(size),
      'upload-metadata': [
        `bucketName ${metadataValue(BUCKET)}`,
        `objectName ${metadataValue(where)}`,
        `contentType ${metadataValue(type)}`,
        `cacheControl ${metadataValue('3600')}`,
      ].join(','),
    },
  });
  const location = begin.headers.get('location');
  if (begin.status !== 201 || location === null) {
    throw new Error(begin.status === 413 ? 'THAT PAGE IS BIGGER THAN THE SITE\'S STORAGE TAKES.' : 'THE ORIGINAL COULD NOT BE STORED.');
  }
  // Only the path and query: self-hosted Storage may name its own inside address, which the server can't reach.
  const given = new URL(location, `${SUPABASE_URL}/`);
  const target = `${SUPABASE_URL}${given.pathname}${given.search}`;
  const handle = await open(file, 'r');
  try {
    let offset = 0;
    const buffer = Buffer.alloc(TUS_CHUNK);
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, 0, TUS_CHUNK, offset);
      const piece = await fetch(target, {
        method: 'PATCH',
        headers: { ...auth, 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' },
        body: new Uint8Array(buffer.subarray(0, bytesRead)),
      });
      if (piece.status !== 204) throw new Error('THE ORIGINAL COULD NOT BE STORED.');
      offset = Number(piece.headers.get('upload-offset') ?? offset + bytesRead);
    }
  } finally {
    await handle.close();
  }
}
