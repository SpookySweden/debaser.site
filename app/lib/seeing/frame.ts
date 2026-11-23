/**
 * The frame a page is drawn in (SPEC-seeing-machine.md, "The frame"): the documents handed to it as `srcdoc`, and what may be said between
 * it and the site. Pure.
 *
 * Two frames, one in the other, both `sandbox="allow-scripts"` and never `allow-same-origin`, so the page inside has no origin at all: no
 * cookies, no storage, no way to the reader's session. The outer one is empty but for the inner and carries the one rule a page can't be
 * trusted to keep about itself: nothing in it may be taken to another address (`frame-src 'none'`). The inner one holds the page, and its
 * policy lets it load our signed files and nothing else. Every message from it is treated as hostile: whatever is in there could have
 * sent it.
 */
import type { FoundMedia } from './engine';
import { HOOK } from './hook';

/** The whole of what each frame is allowed. Checked by Temp/check-seeing.cjs: nothing may be added here without a reason there. */
export const FRAME_SANDBOX = 'allow-scripts';

export type FrameAsk = {
  html: string;
  /** Where the page came from: what its own scripts' addresses are read against. */
  address: string;
  nonce: string;
  /** The only place the frame's messages go. */
  siteOrigin: string;
  /** The only place it may load from, or null for a page with no files. */
  assets: string | null;
  scripts: boolean;
  language?: string | null;
};

/** Where signed files are, as a policy writes it, or nothing at all if it isn't a plain address. */
function plainPlace(assets: string | null): string | null {
  return assets !== null && /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?\/api\/see\/asset\/$/i.test(assets) ? assets : null;
}

/** What a page may load. Nothing is asked for by the page itself: its scripts' requests go to the site by message. */
export function framePolicy({ nonce, assets, scripts }: Pick<FrameAsk, 'nonce' | 'assets' | 'scripts'>): string {
  const place = plainPlace(assets);
  const files = place === null ? '' : ` ${place}`;
  return [
    "default-src 'none'",
    `img-src${files} data: blob:`,
    `style-src${files} 'unsafe-inline'`,
    `font-src${files} data:`,
    // The page's own scripts, when they are on, run as they are written: the frame is where they are held. Off, only ours does.
    scripts ? `script-src${files} 'unsafe-inline' 'unsafe-eval' data: blob:` : `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "media-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "webrtc 'block'",
    // Every way a script has of turning words into markup goes through one policy, the hook's, which lets no frame be written: a frame, even
    // an empty one, is a fresh window with none of the hook in it, where WebRTC (which no policy Chrome knows can stop) would be back.
    ...(scripts ? ['trusted-types default', "require-trusted-types-for 'script'"] : []),
  ].join('; ');
}

/** The outer frame's: what a page can't be trusted to keep about itself. */
export const OUTER_POLICY = "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'; connect-src 'none'";

/** From the site to the frame. */
export type FrameTools = {
  /** THEME DYE: every colour on the page moved to the nearest of these. */
  dye?: { dyes: string[]; paper: string };
  /** Pictures dithered to these, no larger than `most` each way. */
  pictures?: { dyes: string[]; most: number };
  /** GLASS: words on strips of their own. */
  strips?: true;
  /** X-RAY: what is pointed at is told. */
  xray?: true;
  erase?: true;
  /** Where the pointer is, and how far down the page is, are told: for the LOUPE and the SEAM. */
  pointer?: true;
  scroll?: true;
  /** How far down the page is, at once and as it moves: for GRAFFITI. */
  place?: true;
  /** Passages marked where they stand, for MARGINALIA. */
  marks?: string[];
  /** What the reader has selected is told: for quotes. */
  select?: true;
};
export type FrameDress = { see: 'dress'; css: string; tools: FrameTools };
export type FrameScroll = { see: 'scrollTo'; x: number; y: number; whole: number };
/** A marked passage brought into sight. */
export type FrameFind = { see: 'find'; index: number };
export type FrameArt = { see: 'art'; pieces: { src: string; title: string }[] };
export type FrameAnswer =
  | { see: 'answer'; id: number; ok: true; addresses: (string | null)[] }
  | { see: 'answer'; id: number; ok: true; status: number; type: string; url: string; body: ArrayBuffer }
  | { see: 'answer'; id: number; ok: false };

/** What X-RAY is pointing at. Words from a page: drawn as words. */
export type Pointed = { path: string[]; kind: string; size: string; ink: string; ground: string; face: string; words: string; inside: number };
/** What a page is made of. */
export type Census = { counts: Record<'words' | 'pictures' | 'links' | 'frames' | 'scripts' | 'forms', number>; rows: { depth: number; name: string; inside: number }[] };

/** From the frame. */
export type FrameMessage =
  | { see: 'ready'; ads: boolean }
  | { see: 'open'; address: string; newTab: boolean }
  | { see: 'form' }
  | { see: 'art'; index: number }
  | { see: 'restricted'; count: number }
  | { see: 'point'; point: Pointed }
  | { see: 'census'; census: Census }
  | { see: 'erase'; selector: string }
  | { see: 'media'; media: FoundMedia[] }
  | { see: 'select'; text: string }
  | { see: 'pointer'; x: number; y: number }
  | { see: 'scroll'; x: number; y: number; whole: number }
  | { see: 'ask'; id: number; address: string }
  | { see: 'seal'; id: number; files: { address: string; kind: string }[] };

const ADDRESS_MOST = 4000;
const FILES_MOST = 50;
const isAddress = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= ADDRESS_MOST;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1_000_000;

const isPlace = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 10_000_000;
const words = (value: unknown, most: number): string => (typeof value === 'string' ? value.slice(0, most) : '');

/** A selector of the one shape our script makes (`#id`, `div:nth-of-type(3)`, joined by ` > `): it is put back into a stylesheet. */
export function isSelector(text: string): boolean {
  return text.length <= 500 && /^(?:#[A-Za-z][\w-]{0,60}|[a-z][a-z0-9-]{0,40}:nth-of-type\(\d{1,5}\))(?: > [a-z][a-z0-9-]{0,40}:nth-of-type\(\d{1,5}\)){0,8}$/.test(text);
}

/** What a page's scripts have put on it to play: addresses the Room will judge as it judges any other. */
function readMedia(data: Record<string, unknown>): FrameMessage | null {
  if (!Array.isArray(data.media)) return null;
  const media: FoundMedia[] = [];
  for (const each of data.media.slice(0, 20)) {
    const { address, title, from, seconds } = (typeof each === 'object' && each !== null ? each : {}) as Record<string, unknown>;
    if (!isAddress(address) || !/^https?:/.test(address)) continue;
    media.push({ address, title: words(title, 160), from: from === 'audio' ? 'audio' : 'video', seconds: isCount(seconds) && seconds > 0 ? seconds : null });
  }
  return { see: 'media', media };
}

function readPoint(data: Record<string, unknown>): FrameMessage | null {
  if (!Array.isArray(data.path) || data.path.length > 12) return null;
  return {
    see: 'point',
    point: { path: data.path.map((each: unknown) => words(each, 60)), kind: words(data.kind, 12), size: words(data.size, 30), ink: words(data.ink, 40), ground: words(data.ground, 40), face: words(data.face, 120), words: words(data.words, 160), inside: isCount(data.inside) ? data.inside : 0 },
  };
}

function readCensus(data: Record<string, unknown>): FrameMessage | null {
  const counts = (typeof data.counts === 'object' && data.counts !== null ? data.counts : {}) as Record<string, unknown>;
  const rows = Array.isArray(data.rows) ? data.rows.slice(0, 160) : [];
  const number = (value: unknown) => (isCount(value) ? value : 0);
  return {
    see: 'census',
    census: {
      counts: { words: number(counts.words), pictures: number(counts.pictures), links: number(counts.links), frames: number(counts.frames), scripts: number(counts.scripts), forms: number(counts.forms) },
      rows: rows.map((row: unknown) => {
        const { depth, name, inside } = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>;
        return { depth: Math.min(number(depth), 6), name: words(name, 60), inside: number(inside) };
      }),
    },
  };
}

/** A message read as if a stranger sent it. Where it came from (the inner frame's own window) is the caller's to check first. */
export function readFrameMessage(data: unknown): FrameMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const { see, address, newTab, ads, index, count, id, files, selector, x, y, whole } = data as Record<string, unknown>;
  switch (see) {
    case 'ready':
      return { see, ads: ads === true };
    case 'open':
      return isAddress(address) ? { see, address, newTab: newTab === true } : null;
    case 'form':
      return { see };
    case 'art':
      return isCount(index) && index < 100 ? { see, index } : null;
    case 'restricted':
      return isCount(count) ? { see, count } : null;
    case 'point':
      return readPoint(data as Record<string, unknown>);
    case 'census':
      return readCensus(data as Record<string, unknown>);
    case 'media':
      return readMedia(data as Record<string, unknown>);
    case 'erase':
      return typeof selector === 'string' && isSelector(selector) ? { see, selector } : null;
    case 'select':
      return typeof data === 'object' && 'text' in data ? { see, text: words(data.text, 300).replace(/\s+/g, ' ').trim() } : null;
    case 'pointer':
      return isPlace(x) && isPlace(y) ? { see, x, y } : null;
    case 'scroll':
      return isPlace(x) && isPlace(y) && isPlace(whole) ? { see, x, y, whole } : null;
    case 'ask':
      return isCount(id) && isAddress(address) ? { see, id, address } : null;
    case 'seal': {
      if (!isCount(id) || !Array.isArray(files) || files.length > FILES_MOST) return null;
      const read = files.map((file: unknown) => {
        const { address: where, kind } = (typeof file === 'object' && file !== null ? file : {}) as Record<string, unknown>;
        return isAddress(where) && typeof kind === 'string' && kind.length < 20 ? { address: where, kind } : null;
      });
      return read.every((file) => file !== null) ? { see, id, files: read } : null;
    }
    default:
      return null;
  }
}

/** Written into a script element, so nothing in it may close that element. */
const inScript = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
const inValue = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The page's own document. Ours comes first: the policy, then the hook. */
export function pageDocument(ask: FrameAsk): string {
  const config = { site: ask.siteOrigin, page: ask.address, scripts: ask.scripts, assets: plainPlace(ask.assets) ?? 'none:' };
  return [
    `<!doctype html><html data-see-waiting${ask.language ? ` lang="${inValue(ask.language)}"` : ''}><head><meta charset="utf-8">`,
    `<meta http-equiv="Content-Security-Policy" content="${inValue(framePolicy(ask))}">`,
    '<meta name="referrer" content="no-referrer"><meta http-equiv="x-dns-prefetch-control" content="off">',
    '<style>[data-see-waiting]{visibility:hidden}</style>',
    `<script nonce="${inValue(ask.nonce)}">${HOOK}(${inScript(config)});</script>`,
    ask.html,
  ].join('');
}

/** What the site's own frame is given: the outer document, with the page's in it. */
export function frameDocument(ask: FrameAsk): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${inValue(OUTER_POLICY)}">`,
    '<meta name="referrer" content="no-referrer">',
    '<style>html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style></head><body>',
    `<iframe sandbox="${FRAME_SANDBOX}" referrerpolicy="no-referrer" srcdoc="${inValue(pageDocument(ask))}"></iframe>`,
    '</body></html>',
  ].join('');
}
