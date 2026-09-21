import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

/**
 * Serves the hand-drawn art archive straight out of the project `assets/`
 * folder (`G:\debaser.site\assets\...`), so artwork never has to live in
 * `public/` or anywhere outside the project.
 *
 *   assets/concepts/concept-sheet-01.png  ->  /assets/concepts/concept-sheet-01.png
 *   assets/placeholders/avatar-sprite.png ->  /assets/placeholders/avatar-sprite.png
 *
 * Drop a drawing into the folder and reference it with that path in
 * `next/image`; anything missing returns a 404, which the `<SheetImage />`
 * component turns into an "[ ARTWORK FILE NOT FOUND ]" notice naming the path.
 */

const ASSET_ROOT = path.join(process.cwd(), 'assets');

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

type AssetRouteContext = {
  params: Promise<{ path: string[] }>;
};

export async function GET(_request: Request, context: AssetRouteContext) {
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

    const data = await readFile(resolved);

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(info.size),
        'Cache-Control': 'public, max-age=60, must-revalidate',
        'Last-Modified': info.mtime.toUTCString(),
      },
    });
  } catch {
    return new Response('Not found.', { status: 404 });
  }
}
