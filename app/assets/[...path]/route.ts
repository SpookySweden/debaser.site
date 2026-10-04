import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

/**
 * Serves the hand-drawn art archive straight out of the project `assets/`
 * folder (`G:\debaser.site\assets\...`), so artwork never has to live in
 * `public/` or anywhere outside the project.
 *
 *   assets/concepts/concept-sheet-01.png  ->  /assets/concepts/concept-sheet-01.png
 *   assets/sprites/walk-cycle.gif         ->  /assets/sprites/walk-cycle.gif
 *
 * Drop a drawing into the folder and reference it with that path in
 * `next/image`; anything missing returns a 404, which the `<SheetImage />`
 * component turns into an "[ ARTWORK FILE NOT FOUND ]" notice naming the path.
 *
 * Every piece of artwork the site has a slot for is declared - with the size to draw it at and the
 * size it is shown at - in `app/lib/ui/art/slots.ts`, and `npm run art` holds the files on disk to
 * what that registry says. This route is only the pump; the registry is the contract.
 */

const ASSET_ROOT = path.join(process.cwd(), 'assets');

/**
 * What the archive may serve.
 *
 * Pictures are the bulk of it; the audio types are here for the music shelf, which
 * plays tracks straight out of `assets/audio/` the same way the sheets are shown
 * out of `assets/concepts/`. A file whose extension is not on this list is refused
 * with a 400 rather than guessed at.
 *
 * Note: responses are whole-file with a Content-Length and no byte ranges, which is
 * plenty for a track that is a few megabytes. Range requests are the thing to add
 * first if a long recording ever needs to scrub before it has buffered.
 *
 * **`.svg` is not on the list, and that is the asset rule rather than an oversight.** AGENTS.md says
 * code never draws a character, an icon or an illustration - and an SVG is vector drawing code, so a
 * file the archive served would be the one exception the rule exists to prevent. Everything here is a
 * raster file hand-drawn on the tablet; a `.svg` asked for by name is refused with a 400, the same as
 * any other type this folder does not know.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

type AssetRouteContext = {
  params: Promise<{ path: string[] }>;
};

/**
 * How long a drawing may be held.
 *
 * Artwork is the one thing on this site that is *replaced in place*: the owner redraws
 * `assets/sprites/walk-cycle.gif` and pushes, and that file's path is the same path it has always
 * been. So this cannot be `immutable` - there is no hashed filename to make a year safe - and a long
 * `max-age` would serve a redrawn sprite from cache with nothing on the site looking wrong.
 *
 * `must-revalidate` plus a validator is what makes a short max-age honest: the browser may reuse the
 * bytes for five minutes, and after that it asks, and the ask is answered with a 304 rather than the
 * file whenever the drawing has not changed. The validator used to be absent and the header read
 * `max-age=60`, so every art request over a minute old re-downloaded the whole file - a 1.8MB upload
 * re-fetched on every page view.
 *
 * **The validator is a digest of the bytes, and it was `size-mtime` until the deployed site was asked
 * what it actually sends.** Reading the headers off the live route showed that every file
 * - the 95-byte cursor and the 77KB sheet alike - answered `Last-Modified: Sat, 20 Oct 2018 01:46:40
 * GMT`, which is `1540000000000` for all of them: the build normalizes a file's mtime on the way in. So
 * in production the validator was the *size alone*, and a redraw that happened to keep its size - a
 * 32x32 cursor re-exported with a pixel moved is exactly that - would have been answered `304` for as
 * long as the browser kept asking, which is a drawing that can no longer be corrected. A digest is
 * correct in both places, needs nothing from the environment, and cannot silently degrade: it costs
 * one pass over bytes this handler has already read to serve them, which is why the earlier reasoning
 * ("hashing to decide whether to send costs what it saves") no longer holds - the old shape avoided the
 * read, and the read was never the expensive half. `sha1` is a cache validator here, not a signature.
 */
const CACHE_CONTROL = 'public, max-age=300, must-revalidate';

export async function GET(request: Request, context: AssetRouteContext) {
  const { path: segments } = await context.params;
  const relative = segments.join('/');

  // Keep requests inside assets/: no dotfiles, no traversal, known types only.
  const extension = path.extname(relative).toLowerCase();
  const contentType = CONTENT_TYPES[extension];

  if (contentType === undefined || segments.some((segment) => segment.startsWith('.'))) {
    return new Response('Unsupported asset.', { status: 400 });
  }

  const resolved = path.resolve(ASSET_ROOT, relative);

  if (resolved !== ASSET_ROOT && !resolved.startsWith(ASSET_ROOT + path.sep)) {
    return new Response('Forbidden.', { status: 403 });
  }

  try {
    const info = await stat(resolved);
    if (!info.isFile()) return new Response('Not found.', { status: 404 });

    /**
     * Read first, then decide: the validator is a digest of these bytes, so there is nothing to work out
     * before reading them. The read is from local disk - it is the *network* copy the 304 saves.
     */
    const data = await readFile(resolved);

    /**
     * The validator: a digest of the drawing's own bytes, with the length in front of it.
     *
     * `size-mtime` was the first shape and the deployed site showed why it cannot be trusted (see the note
     * on `CACHE_CONTROL`): mtime is normalized in the build, so the validator collapsed to the size. This
     * cannot collapse - the bytes are the thing being validated - and it costs one hash of bytes already in
     * hand. The length prefix is kept because it is what a human reads in devtools, and it makes a clash
     * between two drawings of different sizes impossible rather than unlikely.
     */
    const etag = `"${data.length.toString(16)}-${createHash('sha1').update(data).digest('hex').slice(0, 20)}"`;

    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': CACHE_CONTROL, 'Last-Modified': info.mtime.toUTCString() },
      });
    }

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(data.length),
        'Cache-Control': CACHE_CONTROL,
        ETag: etag,
        'Last-Modified': info.mtime.toUTCString(),
      },
    });
  } catch {
    return new Response('Not found.', { status: 404 });
  }
}
