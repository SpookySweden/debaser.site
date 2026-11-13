import type { EngineBook } from './reader-engine';

/**
 * A scanned Internet Archive book's page pictures, shown in the site's own reader (SPEC-reading-places.md, decision 6, Luke
 * 2026-11-13): for a book with no EPUB and no PDF, which used to show only the Archive's own viewer. The list of pages comes
 * from the Archive's public IIIF service (`iiif.archive.org`, the open standard for page images; checked live 2026-11-13: a
 * JSON manifest per item, sent with `Access-Control-Allow-Origin: *`), fetched by the reader's own browser. Each page is an
 * `<img>` pointing straight at the Archive's image server: linked, never copied or passed through the site, as thumbnails
 * are. The engine sees the pages as a fixed-layout book, so the page is known, saved and turned like a PDF's.
 * When the manifest can't be read, or lists no pages, the reader falls back to the Archive's own viewer.
 */

export const IIIF_HOST = 'iiif.archive.org';
/** How large each page is asked for: fits a 1400 by 1400 box (the engine scales it to the screen). */
export const PAGE_SIZE = '!1400,1400';
export const PAGES_MAX = 5000;

export type PicturePage = { image: string; width: number; height: number };

/** The manifest's address for an Archive identifier (already checked by `archiveBookId`). */
export function manifestUrl(identifier: string): string {
  return `https://${IIIF_HOST}/iiif/3/${encodeURIComponent(identifier)}/manifest.json`;
}

/** An image service on the Archive's IIIF host only, as a plain https address with nothing odd in it. */
function serviceOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== IIIF_HOST || url.username || url.password || url.search || url.hash) return null;
  if (!url.pathname.startsWith('/image/iiif/')) return null;
  return url.toString().replace(/\/+$/, '');
}

const dimension = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100_000 ? Math.round(value) : null);

/**
 * The pages of a IIIF Presentation 3 manifest, in order: each canvas's painted image (its image service, else the image's own
 * address on the same host) and its size. Anything off the Archive's IIIF host, or without a size, is left out.
 */
export function pagesOf(manifest: unknown): { pages: PicturePage[]; rightToLeft: boolean } {
  const none = { pages: [], rightToLeft: false };
  if (!manifest || typeof manifest !== 'object') return none;
  const root = manifest as Record<string, unknown>;
  if (!Array.isArray(root.items)) return none;
  const pages: PicturePage[] = [];
  for (const canvas of root.items.slice(0, PAGES_MAX)) {
    if (!canvas || typeof canvas !== 'object') continue;
    const { width, height, items } = canvas as Record<string, unknown>;
    const w = dimension(width);
    const h = dimension(height);
    if (w === null || h === null || !Array.isArray(items)) continue;
    const page = items[0] as { items?: unknown[] } | undefined;
    const annotation = Array.isArray(page?.items) ? (page.items[0] as { body?: Record<string, unknown> } | undefined) : undefined;
    const body = annotation?.body;
    if (!body) continue;
    const services = Array.isArray(body.service) ? body.service : [];
    const fromService = serviceOf((services[0] as { id?: unknown } | undefined)?.id);
    const image = fromService ? `${fromService}/full/${PAGE_SIZE}/0/default.jpg` : null;
    if (image) pages.push({ image, width: w, height: h });
  }
  return { pages, rightToLeft: root.viewingDirection === 'right-to-left' };
}

/** Reads the pages from the Archive (in the browser), or nothing when it can't. */
export async function fetchPages(identifier: string, signal?: AbortSignal): Promise<{ pages: PicturePage[]; rightToLeft: boolean } | null> {
  try {
    const response = await fetch(manifestUrl(identifier), { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) return null;
    const found = pagesOf(await response.json());
    return found.pages.length > 0 ? found : null;
  } catch {
    return null;
  }
}

const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** One page as a tiny document of our own making: the picture, linked, at the page's own size. No script, nothing else. */
export function pageDocument(page: PicturePage, number: number): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<meta name="viewport" content="width=${page.width}, height=${page.height}">`,
    '<style>html, body { margin: 0; padding: 0; } img { display: block; width: 100%; height: 100%; }</style>',
    `</head><body><img src="${attribute(page.image)}" alt="Page ${number}" referrerpolicy="no-referrer"></body></html>`,
  ].join('');
}

/** The pages as a book the engine opens like a PDF: fixed pages, one section each, no contents and no links. */
export function pictureBook(found: { pages: PicturePage[]; rightToLeft: boolean }, title: string): EngineBook {
  const made: string[] = [];
  const book = {
    rendition: { layout: 'pre-paginated' },
    dir: found.rightToLeft ? 'rtl' : 'ltr',
    metadata: { title },
    toc: [],
    sections: found.pages.map((page, index) => ({
      id: index,
      size: 1000,
      load: async () => {
        const src = URL.createObjectURL(new Blob([pageDocument(page, index + 1)], { type: 'text/html' }));
        made.push(src);
        return src;
      },
    })),
    isExternal: () => true,
    resolveHref: () => ({ index: 0 }),
    splitTOCHref: async () => [0, null],
    getTOCFragment: (doc: Document) => doc.documentElement,
    destroy: () => {
      for (const src of made.splice(0)) URL.revokeObjectURL(src);
    },
  };
  return book as unknown as EngineBook;
}
