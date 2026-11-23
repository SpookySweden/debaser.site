/**
 * The frame a page is drawn in (SPEC-seeing-machine.md, "The frame"): the document handed to it as `srcdoc`, and what may be said between
 * it and the site. Pure.
 *
 * The frame is `sandbox="allow-scripts"` and never `allow-same-origin`, so the page inside has no origin at all: no cookies, no storage, no
 * way to the reader's session. Its policy lets nothing load but what the document carries and our one script. Every message from it is
 * treated as hostile: whatever is in there could have sent it.
 */

/** The whole of what the frame is allowed. Checked by Temp/check-seeing.cjs: nothing may be added here without a reason there. */
export const FRAME_SANDBOX = 'allow-scripts';

/** What a page may load: nothing from anywhere, its own styles, and our script. */
export function framePolicy(nonce: string): string {
  return `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`;
}

/** From the site to the frame: the lens's stylesheet. */
export type FrameDress = { see: 'dress'; css: string };

/** From the frame: it is drawn, or a link in it was pressed. */
export type FrameMessage = { see: 'ready' } | { see: 'open'; address: string; newTab: boolean };

const ADDRESS_SENT_MOST = 4000;

/** A message read as if a stranger sent it. Where it came from (the frame's own window) is the caller's to check first. */
export function readFrameMessage(data: unknown): FrameMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const { see, address, newTab } = data as Record<string, unknown>;
  if (see === 'ready') return { see: 'ready' };
  if (see === 'open' && typeof address === 'string' && address.length > 0 && address.length <= ADDRESS_SENT_MOST) {
    return { see: 'open', address, newTab: newTab === true };
  }
  return null;
}

/**
 * Our script in the frame. Runs before anything the page brought. A pressed link is told to the site instead of followed; a link to a
 * place on the same page scrolls there. It listens only to the window it is framed by.
 */
const HOOK = `(function () {
  var site = window.parent, to = SITE_ORIGIN, sheet = document.createElement('style'), dressed = false;
  function say(message) { site.postMessage(message, to); }
  function show() { if (!dressed) { dressed = true; document.documentElement.removeAttribute('data-see-waiting'); } }
  document.head.appendChild(sheet);
  window.addEventListener('message', function (event) {
    if (event.source !== site || !event.data || event.data.see !== 'dress' || typeof event.data.css !== 'string') return;
    sheet.textContent = event.data.css;
    show();
  });
  function pressed(event) {
    if (!event.isTrusted || (event.type === 'auxclick' && event.button !== 1)) return;
    var link = event.target instanceof Element ? event.target.closest('a[href], area[href]') : null;
    if (!link) return;
    var address = link.getAttribute('href') || '';
    event.preventDefault();
    if (address.charAt(0) === '#') {
      var spot = address.length > 1 ? document.getElementById(decodeURIComponent(address.slice(1))) : document.documentElement;
      if (spot) spot.scrollIntoView();
      return;
    }
    say({ see: 'open', address: address, newTab: event.type === 'auxclick' || event.ctrlKey || event.metaKey });
  }
  document.addEventListener('click', pressed, true);
  document.addEventListener('auxclick', pressed, true);
  document.addEventListener('submit', function (event) { event.preventDefault(); }, true);
  document.addEventListener('DOMContentLoaded', function () { say({ see: 'ready' }); });
  setTimeout(show, 1000);
})();`;

/** Written into a script element, so nothing in it may close that element. */
const inScript = (text: string): string => JSON.stringify(text).replace(/</g, '\\u003c');

/** The document the frame is given. `siteOrigin` is the only place its messages go. */
export function frameDocument(html: string, nonce: string, siteOrigin: string): string {
  return [
    '<!doctype html><html data-see-waiting><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${framePolicy(nonce)}">`,
    '<meta name="referrer" content="no-referrer">',
    '<style>[data-see-waiting]{visibility:hidden}</style>',
    `<script nonce="${nonce}">${HOOK.replace('SITE_ORIGIN', inScript(siteOrigin))}</script>`,
    `</head><body>${html}</body></html>`,
  ].join('');
}
