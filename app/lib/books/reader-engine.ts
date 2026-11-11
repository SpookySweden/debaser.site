/**
 * The reader's engine (SPEC-reader.md, Luke 2026-11-11): foliate-js, a pinned copy in `vendor/foliate-js/` (MIT; see its
 * README-DEBASER.md). BROWSER ONLY: loaded on the reader page alone, never on the server.
 *
 * The book arrives as a Blob from the site's own route (/api/web/book/epub), never as an address the engine could fetch.
 * No script from a book ever runs: script files are refused before they load, and each chapter has its `<script>`
 * elements, `on...` attributes, `javascript:` links and embedded frames taken out, and a Content-Security-Policy written
 * into its head (`CHAPTER_POLICY`: no scripts; pictures, styles and fonts only from the book itself, and the site's own
 * face from the site, so a chapter can't reach out to any other site either), before the engine draws it.
 */

export const CHAPTER_POLICY =
  "default-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; img-src blob: data:; style-src blob: 'unsafe-inline'; font-src blob: data: 'self'; media-src blob:";

const XHTML = 'http://www.w3.org/1999/xhtml';
const MARKUP_TYPES = ['application/xhtml+xml', 'text/html', 'image/svg+xml'];
const DROPPED = 'script, iframe, frame, frameset, object, embed, applet, base, meta[http-equiv="refresh" i]';

/** One chapter's markup with every way to run script or reach out taken away, and the policy in its head. */
export function sanitizeChapter(markup: string, type: string): string {
  const parseType = type === 'text/html' ? 'text/html' : (type as DOMParserSupportedType);
  const doc = new DOMParser().parseFromString(markup, parseType);
  if (doc.querySelector('parsererror')) return '';
  for (const element of Array.from(doc.querySelectorAll(DROPPED))) element.remove();
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name.endsWith(':href') || name === 'src' || name === 'action' || name === 'formaction') && /^(javascript|vbscript|data:text\/html)/.test(value))) {
        element.removeAttributeNode(attribute);
      }
    }
  }
  if (type === 'image/svg+xml') return new XMLSerializer().serializeToString(doc);
  const html = doc.documentElement;
  let head = doc.querySelector('head');
  if (!head) {
    head = type === 'text/html' ? doc.createElement('head') : doc.createElementNS(XHTML, 'head');
    html.insertBefore(head, html.firstChild);
  }
  const policy = type === 'text/html' ? doc.createElement('meta') : doc.createElementNS(XHTML, 'meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', CHAPTER_POLICY);
  head.insertBefore(policy, head.firstChild);
  return type === 'text/html' ? `<!DOCTYPE html>\n${html.outerHTML}` : new XMLSerializer().serializeToString(doc);
}

type LoadDetail = { type: string; isScript: boolean; allow: boolean | Promise<boolean> };
type DataDetail = { data: unknown; type: string };

/** The engine's book, with the hooks above on it. */
export type EngineBook = {
  toc?: TocItem[];
  metadata?: { title?: unknown; author?: unknown; language?: unknown };
  dir?: string;
  transformTarget?: EventTarget;
};
export type TocItem = { label?: string; href?: string; subitems?: TocItem[] | null };

/** The custom element foliate-js defines (`<foliate-view>`): the parts the reader uses. */
export type EngineView = HTMLElement & {
  book: EngineBook;
  renderer: HTMLElement & { setStyles?: (css: string) => void; next: () => Promise<void>; prev: () => Promise<void>; getContents: () => { doc: Document; index: number }[] };
  lastLocation: unknown;
  open: (book: EngineBook) => Promise<void>;
  close: () => void;
  init: (options: { lastLocation?: string | null; showTextStart?: boolean }) => Promise<void>;
  goTo: (target: string | number) => Promise<unknown>;
  goToFraction: (fraction: number) => Promise<void>;
  goLeft: () => Promise<void>;
  goRight: () => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  getCFI: (index: number, range: Range) => string;
  addAnnotation: (annotation: { value: string; color?: string }) => Promise<unknown>;
  deleteAnnotation: (annotation: { value: string }) => Promise<unknown>;
  search: (options: { query: string; matchCase?: boolean; matchDiacritics?: boolean; matchWholeWords?: boolean; drawOptions?: { color: string } }) => AsyncGenerator<SearchYield>;
  clearSearch: () => void;
  deselect: () => void;
  getSectionFractions: () => number[];
};

export type SearchExcerpt = { pre: string; match: string; post: string };
export type SearchYield = 'done' | { progress: number } | { label: string; subitems: { cfi: string; excerpt: SearchExcerpt }[] };

export type HighlightDraw = (rects: DOMRectList, options: { color: string }) => SVGElement;

/** Loads the engine (defining `<foliate-view>`), and the way highlights are drawn. */
export async function loadEngine(): Promise<{ highlight: HighlightDraw; makeBook: (file: Blob) => Promise<EngineBook> }> {
  const [view, overlayer] = await Promise.all([import('../../../vendor/foliate-js/view.js'), import('../../../vendor/foliate-js/overlayer.js')]);
  const makeBook = (view as unknown as { makeBook: (file: Blob) => Promise<EngineBook> }).makeBook;
  const Overlayer = (overlayer as unknown as { Overlayer: { highlight: HighlightDraw } }).Overlayer;
  return { highlight: Overlayer.highlight, makeBook };
}

/** Opens a book from its Blob, with scripts refused and every chapter cleaned (above). */
export async function openBook(file: Blob, makeBook: (file: Blob) => Promise<EngineBook>): Promise<EngineBook> {
  const book = await makeBook(file);
  const target = book.transformTarget;
  if (!target) throw new Error('The engine has no way to clean chapters.');
  target.addEventListener('load', (event) => {
    const detail = (event as CustomEvent<LoadDetail>).detail;
    if (detail.isScript) detail.allow = false;
  });
  target.addEventListener('data', (event) => {
    const detail = (event as CustomEvent<DataDetail>).detail;
    if (!MARKUP_TYPES.includes(detail.type)) return;
    const type = detail.type;
    detail.data = Promise.resolve(detail.data).then((data) => (typeof data === 'string' ? sanitizeChapter(data, type) : data));
  });
  return book;
}

/** A title, author or label from the book's own metadata (a string, or a map of languages), as plain text. */
export function metadataText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(metadataText).filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const named = (value as Record<string, unknown>).name;
    if (named !== undefined) return metadataText(named);
    const first = Object.values(value as Record<string, unknown>)[0];
    return typeof first === 'string' ? first : '';
  }
  return '';
}
