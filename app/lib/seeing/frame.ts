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
export type FrameDress = { see: 'dress'; css: string };
export type FrameArt = { see: 'art'; pieces: { src: string; title: string }[] };
export type FrameAnswer =
  | { see: 'answer'; id: number; ok: true; addresses: (string | null)[] }
  | { see: 'answer'; id: number; ok: true; status: number; type: string; url: string; body: ArrayBuffer }
  | { see: 'answer'; id: number; ok: false };

/** From the frame. */
export type FrameMessage =
  | { see: 'ready'; ads: boolean }
  | { see: 'open'; address: string; newTab: boolean }
  | { see: 'form' }
  | { see: 'art'; index: number }
  | { see: 'restricted'; count: number }
  | { see: 'ask'; id: number; address: string }
  | { see: 'seal'; id: number; files: { address: string; kind: string }[] };

const ADDRESS_MOST = 4000;
const FILES_MOST = 50;
const isAddress = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= ADDRESS_MOST;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1_000_000;

/** A message read as if a stranger sent it. Where it came from (the inner frame's own window) is the caller's to check first. */
export function readFrameMessage(data: unknown): FrameMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const { see, address, newTab, ads, index, count, id, files } = data as Record<string, unknown>;
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
