/**
 * The rewriter (SPEC-seeing-machine.md): a page as its makers sent it, changed only so that nothing on it reaches anywhere but us. Links
 * become whole addresses for the hook to press; pictures, styles, fonts and scripts become signed ones; frames, plug-ins, its own policy,
 * refreshes and hints go; known ad servers and trackers are refused, said, and their boxes marked for BILLBOARD; password boxes are dead.
 *
 * Pure but for `sign`, which makes a signed address or refuses. SERVER ONLY.
 */
import type { FoundMedia, Watcher } from '../engine';
import { rewriteCss } from './css';
import { decodeEntities, escapeValue, tokensOf, valueOf, writeStart, type Attribute } from './html';
import type { AssetKind } from './assets';
import { createMediaFinder, isMediaLink } from './media';
import { rewriteImports, rewriteLocation } from './modules';
import { watcherAt } from './watchers-list';

export type Sign = (address: string, kind: AssetKind) => string | null;

export type Rewritten = {
  html: string;
  /** Attributes of the page's own <html> and <body> travel in `html`; its title is words. */
  title: string | null;
  language: string | null;
  watchers: Watcher[];
  media: FoundMedia[];
  files: number;
  refused: number;
  /** A password box was found and made dead. */
  signIn: boolean;
  /** Where the page says it sends people on to, and after how many seconds. */
  refresh: { address: string; after: number } | null;
};

/** Elements that are taken out. */
const GONE = new Set(['base', 'object', 'embed', 'applet', 'portal', 'fencedframe', 'param', 'frameset', 'noembed', 'noframes']);
/** Attributes that do nothing here but reach out, or bind a file to its first bytes. */
const DROPPED = new Set(['integrity', 'crossorigin', 'nonce', 'ping', 'srcdoc', 'manifest', 'autofocus', 'http-equiv', 'attributionsrc', 'fetchpriority', 'referrerpolicy', 'target', 'download', 'csp', 'is', 'formaction', 'formtarget', 'formmethod', 'background-src', 'lowsrc', 'dynsrc', 'codebase', 'archive', 'classid', 'data-see-ad', 'data-see-waiting', 'data-see-dead', 'data-see-frame', 'imagesrcset', 'imagesizes', 'profile', 'longdesc', 'cite', 'itemid']);
/** A drawing's animations, which can set any attribute of what they animate. */
const SMIL = new Set(['animate', 'set', 'animatemotion', 'animatetransform', 'animatecolor']);
const STYLESHEET =/(?:^|\s)stylesheet(?:\s|$)/i;
const LAZY = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy'];
const LAZY_SET = ['data-srcset', 'data-lazy-srcset'];

/** A box that says it is an advertisement's. Whole words only: `gradient`, `header`, `download` and `add` are not. */
const AD_BOX = /(?:^|[\s_-])(?:adsbygoogle|ad|ads|advert|adverts|advertisement|advertising|adslot|adunit|adbox|adcontainer|adwrapper|dfp|gpt|sponsored)(?=$|[\s_\d-])/i;

/** The last two names of a host, or three for the common second-level endings: near enough to say whose a file is. */
export function siteOf(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  const three = parts.length > 2 && /^(?:co|com|org|net|ac|gov|edu|ne|or|go)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(three ? -3 : -2).join('.');
}

/** A srcset's candidates, each address signed; the sizes kept. */
export function rewriteSrcset(text: string, sign: (address: string) => string | null): string {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    while (at < text.length && /[\s,]/.test(text[at])) at += 1;
    let end = at;
    while (end < text.length && !/\s/.test(text[end])) end += 1;
    let address = text.slice(at, end);
    if (address === '') break;
    let size = '';
    if (address.endsWith(',')) {
      address = address.replace(/,+$/, '');
      at = end;
    } else {
      let depth = 0;
      at = end;
      while (end < text.length && (text[end] !== ',' || depth > 0)) {
        if (text[end] === '(') depth += 1;
        if (text[end] === ')') depth -= 1;
        end += 1;
      }
      size = text.slice(at, end).trim();
      at = end + 1;
    }
    const answer = /^data:/i.test(address) ? address : sign(address);
    if (answer !== null) out.push(size === '' ? answer : `${answer} ${size}`);
  }
  return out.join(', ');
}

/**
 * No frame, and no link element, is left in a page however it was written, in a script's own words too: whatever the tags above were read as, a browser finds none.
 * (A frame, even an empty one, is a fresh window with none of the hook in it: see `frame.ts`. A link's hints, preconnect and dns-prefetch, reach another host and no policy stops them.)
 */
export function noFrames(html: string): string {
  return html.replace(/<(\/?)(?=(?:iframe|frame|frameset|object|embed|fencedframe|portal|link)(?![a-z0-9]))/gi, '<$1see-');
}

export function rewritePage(html: string, address: string, sign: Sign, scripts: boolean): Rewritten {
  const page = new URL(address);
  let base = address;
  const watchers = new Map<string, Watcher>();
  let files = 0;
  let refused = 0;
  let title: string | null = null;
  let language: string | null = null;
  let signIn = false;
  let refresh: Rewritten['refresh'] = null;
  /** A script in a drawing was left out: its end goes too. */
  let dropped = false;
  const media = createMediaFinder(address);
  /** What the page calls the thing it shows, which is better than its window's title. */
  let shownTitle = '';
  /** The words inside a link to media, until it ends. */
  let linking: { address: string; words: string } | null = null;
  if (isMediaLink(address)) media.add(address, '', 'page');

  const absolute = (text: string): URL | null => {
    try {
      const url = new URL(text.trim(), base);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  };

  /** Who a file is from, when it isn't the page's own site. */
  const note = (url: URL): boolean => {
    const known = watcherAt(url.hostname);
    if (known === null && siteOf(url.hostname) === siteOf(page.hostname)) return false;
    const host = known === null ? siteOf(url.hostname) : url.hostname;
    const key = `${known?.company ?? ''} ${host}`;
    if (watchers.size < 100 && !watchers.has(key)) watchers.set(key, { company: known?.company ?? host, host, refused: known !== null });
    return known !== null;
  };

  const file = (text: string, kind: AssetKind): string | null => {
    const url = absolute(text);
    if (url === null) return null;
    if (note(url)) {
      refused += 1;
      return null;
    }
    const answer = sign(url.href, kind);
    if (answer === null) refused += 1;
    else files += 1;
    return answer;
  };
  const css = (text: string) => rewriteCss(text, file);

  let out = '';
  /** The raw insides that come next belong to this. */
  let rawFor: 'keep' | 'drop' | 'css' | 'script' | 'module' | 'title' | 'data' = 'keep';

  for (const token of tokensOf(html)) {
    if (token.kind === 'comment' || token.kind === 'doctype') continue;
    if (token.kind === 'text') {
      if (linking !== null && linking.words.length < 160) linking.words += decodeEntities(token.text);
      out += token.text;
      continue;
    }
    if (token.kind === 'raw') {
      if (rawFor === 'title') {
        if (title === null) title = decodeEntities(token.text);
        out += token.text;
      } else if (rawFor === 'data') {
        media.linkedData(token.text);
        if (scripts) out += token.text;
      } else if (rawFor === 'css') out += css(token.text);
      else if (rawFor === 'module') out += rewriteImports(rewriteLocation(token.text), (each) => file(each, 'module')).replace(/<\/(?=script)/gi, '<\\/');
      else if (rawFor === 'script') out += rewriteLocation(token.text);
      else if (rawFor === 'keep') out += token.text;
      rawFor = 'keep';
      continue;
    }
    if (token.kind === 'end') {
      if (token.name === 'a' && linking !== null) {
        media.add(linking.address, linking.words, 'link');
        linking = null;
      }
      if (token.name === 'script' && (!scripts || dropped)) {
        dropped = false;
        continue;
      }
      if (token.name === 'iframe' || token.name === 'frame' || GONE.has(token.name)) continue;
      out += token.name === 'noscript' ? (scripts ? '</template>' : '</div>') : `</${token.name.replace(/[^\w:.\u0080-\uffff-]/g, '')}>`;
      continue;
    }

    const { name, attributes } = token;
    const value = (each: string) => valueOf(attributes, each);
    rawFor = 'keep';
    if (!/^[\w:.\u0080-\uffff-]+$/.test(name)) continue;

    if (token.foreign && SMIL.has(name)) {
      // An animation in a drawing that sets an address, or a value with one in it, would point the drawing somewhere after we have read it.
      const said = ['to', 'from', 'values', 'by'].map(value).join(' ');
      if (/href\s*$/i.test(value('attributename') ?? '') || /url|\\|&/i.test(said)) {
        refused += 1;
        continue;
      }
    }
    if (name === 'base') {
      const href = value('href');
      const url = href === null ? null : absolute(href);
      // The page's own, read once and not kept: every address is written whole.
      if (url !== null && base === address) base = url.href;
      continue;
    }
    if (GONE.has(name)) {
      // Two of them hold words, not tags; out of them, the words would be tags nobody had looked at.
      rawFor = 'drop';
      // Only the element goes: what it falls back to may be read.
      refused += 1;
      continue;
    }
    if (name === 'iframe' || name === 'frame') {
      rawFor = 'drop';
      const url = absolute(value('src') ?? value('data-src') ?? '');
      refused += 1;
      if (url === null || url.href === address) continue;
      const watched = note(url);
      if (!watched) media.add(url.href, value('title') ?? '', 'player');
      if (watched || AD_BOX.test(`${value('id') ?? ''} ${value('class') ?? ''}`)) {
        const size = (text: string | null) => (text !== null && /^\d{1,4}$/.test(text) ? Number(text) : null);
        const [width, height] = [size(value('width')), size(value('height'))];
        if (width !== null && height !== null && width >= 120 && height >= 50) out += `<span data-see-ad style="display:inline-block;max-width:100%;width:${width}px;height:${height}px"></span>`;
      } else {
        // Named by where it goes, so a frameset's menu and main page read apart; a frameset's frames each take a line.
        const path = url.pathname === '/' ? '' : url.pathname.length > 40 ? `${url.pathname.slice(0, 39)}…` : url.pathname;
        out += `<a data-see-frame href="${escapeValue(url.href)}"${name === 'frame' ? ' style="display:block"' : ''}>[ FRAME: ${escapeValue(url.hostname + path)} ]</a>`;
      }
      continue;
    }
    if (name === 'meta') {
      const said = (value('property') ?? value('name') ?? '').toLowerCase();
      if (said === 'og:title') shownTitle = value('content') ?? '';
      if (/^(?:og:video(?::url|:secure_url)?|og:audio(?::url|:secure_url)?|twitter:player(?::stream)?)$/.test(said)) media.add(value('content'), '', 'declared');
      if ((value('http-equiv') ?? '').trim().toLowerCase() === 'refresh' && refresh === null) {
        // Not left for the frame, which may go nowhere: the site is told where, and goes there as a pressed link would.
        const said = /^\s*(\d{1,4})(?:\.\d*)?\s*[;,]\s*(?:url\s*=\s*)?["']?([^"']+)/i.exec(value('content') ?? '');
        const url = said === null ? null : absolute(said[2]);
        if (said !== null && url !== null && url.href !== address && Number(said[1]) <= 30) refresh = { address: url.href, after: Number(said[1]) };
      }
      if (value('http-equiv') !== null || value('charset') !== null) continue;
      out += writeStart(name, attributes, token.selfClosing);
      continue;
    }
    if (name === 'link') {
      if (!STYLESHEET.test(value('rel') ?? '')) continue;
      const media = value('media');
      const answer = file(value('href') ?? '', 'style');
      // As a style that imports it: there is no link element in a page for its scripts to turn into something else.
      if (answer !== null) out += `<style${media === null ? '' : ` media="${escapeValue(media)}"`}>@import url("${answer.replace(/[^\w:/.-]/g, encodeURIComponent)}");</style>`;
      continue;
    }
    if (name === 'script' && token.foreign) {
      // A script in a drawing: what it holds is read as tags in some places and as words in others, so it is neither.
      rawFor = 'drop';
      refused += 1;
      dropped = !token.selfClosing;
      continue;
    }
    if (name === 'script') {
      const src = value('src') ?? value('href') ?? value('xlink:href');
      const type = (value('type') ?? '').trim().toLowerCase();
      const isModule = type === 'module';
      if (!scripts) {
        // What it says it plays is read, and none of it is written: words from inside a script would be tags out here.
        rawFor = type === 'application/ld+json' ? 'data' : 'drop';
        if (src !== null) {
          const url = absolute(src);
          if (url !== null) note(url);
          refused += 1;
        }
        continue;
      }
      if (src !== null) {
        const answer = file(src, isModule ? 'module' : 'script');
        const kept = attributes.filter((each) => ['type', 'async', 'defer', 'nomodule', 'id', 'class'].includes(each.name) || each.name.startsWith('data-'));
        if (answer === null) rawFor = 'drop';
        // One that is refused stays, empty, so a page that looks for it finds it.
        out += writeStart('script', answer === null ? [{ name: 'type', raw: 'text/plain' }] : [...kept, { name: 'src', raw: escapeValue(answer) }], token.selfClosing);
        continue;
      }
      if (type === 'application/ld+json') rawFor = 'data';
      if (type === 'speculationrules' || type === 'importmap') {
        rawFor = 'drop';
        out += '<script type="text/plain">';
        continue;
      }
      // Data in a script element is not a script.
      if (isModule) rawFor = 'module';
      else if (type === '' || /^(?:text|application)\/(?:javascript|x-javascript|ecmascript)$/.test(type)) rawFor = 'script';
      out += writeStart('script', attributes.filter((each) => !DROPPED.has(each.name)), token.selfClosing);
      continue;
    }
    if (name === 'noscript') {
      // Scripts run in the frame either way (ours does), so a browser would not draw this: shown as itself when the page's are off.
      out += scripts ? '<template>' : '<div>';
      continue;
    }
    if (name === 'style') rawFor = 'css';
    if (name === 'title' && !token.foreign) rawFor = 'title';
    if (name === 'html' && language === null) language = value('lang');

    const kept: Attribute[] = [];
    const put = (each: string, text: string) => kept.push({ name: each, raw: escapeValue(text) });
    const picture = name === 'img' || name === 'image' || name === 'source' || (name === 'input' && (value('type') ?? '').toLowerCase() === 'image');
    let ad = false;
    for (const attribute of attributes) {
      const text = decodeEntities(attribute.raw ?? '');
      const each = attribute.name;
      if (DROPPED.has(each)) continue;
      if (each.startsWith('on')) {
        if (scripts) kept.push(attribute);
        continue;
      }
      if (each === 'style') {
        // Written by rewriteCss, whose own quotes are the double kind.
        put('style', css(text));
        continue;
      }
      if (each === 'href' || each === 'xlink:href') {
        if (name === 'a' || name === 'area') {
          if (text.trim().startsWith('#')) put(each, text.trim());
          else {
            const url = absolute(text);
            if (url !== null) {
              if (name === 'a' && isMediaLink(url.href)) linking = { address: url.href, words: value('title') ?? '' };
              const here = url.hash !== '' && url.href.split('#')[0] === address.split('#')[0];
              put(each, here ? url.hash : url.href);
            } else if (/^\s*(?:mailto|tel):/i.test(text) || (scripts && /^\s*javascript:/i.test(text))) put(each, text.trim());
          }
        } else if (token.foreign) {
          if (text.trim().startsWith('#') || /^\s*data:image\//i.test(text)) put(each, text.trim());
          else {
            const answer = file(text, 'picture');
            if (answer !== null) put(each, answer);
          }
        }
        continue;
      }
      if (each === 'src') {
        if (!picture || name === 'source') {
          // Video and sound never pass through: the tray is where they are played from (Phase 4).
          if (name === 'video' || name === 'audio' || name === 'track' || name === 'source') put('data-see-media', absolute(text)?.href ?? '');
          if (name === 'video' || name === 'audio') media.add(text, value('title') ?? value('aria-label') ?? '', name);
          if (name === 'source') media.add(text, '', /^audio\//i.test(value('type') ?? '') ? 'audio' : 'video');
          continue;
        }
        if (/^\s*data:image\//i.test(text)) put(each, text.trim());
        else {
          const answer = file(text, 'picture');
          if (answer !== null) put(each, answer);
        }
        continue;
      }
      if (each === 'srcset') {
        if (picture) put(each, rewriteSrcset(text, (one) => file(one, 'picture')));
        continue;
      }
      if (each === 'poster' || each === 'background') {
        const answer = file(text, 'picture');
        if (answer !== null) put(each, answer);
        continue;
      }
      if (each === 'action') {
        put(each, absolute(text)?.href ?? address);
        continue;
      }
      if (each === 'loading' && text === 'lazy') {
        kept.push(attribute);
        continue;
      }
      if ((each === 'id' || each === 'class') && AD_BOX.test(text)) ad = true;
      kept.push(attribute);
    }
    if (name === 'form' && value('action') === null) put('action', address);
    if (picture && !scripts) {
      // Pictures a script would have put in, put in here.
      const now = kept.find((each) => each.name === 'src');
      const later = LAZY.map(value).find((each) => each !== null) ?? null;
      if (later !== null && (now === undefined || (now.raw ?? '').startsWith('data:'))) {
        const answer = file(later, 'picture');
        if (answer !== null) {
          if (now === undefined) put('src', answer);
          else now.raw = escapeValue(answer);
        }
      }
      const laterSet = LAZY_SET.map(value).find((each) => each !== null) ?? null;
      if (laterSet !== null && !kept.some((each) => each.name === 'srcset')) put('srcset', rewriteSrcset(laterSet, (one) => file(one, 'picture')));
    }
    if (name === 'input' && (value('type') ?? '').trim().toLowerCase() === 'password') {
      signIn = true;
      out += '<input type="text" disabled data-see-dead placeholder="NO SIGN-INS HERE" title="Sign in on the site itself">';
      continue;
    }
    if (ad && (name === 'div' || name === 'ins' || name === 'aside' || name === 'section')) kept.push({ name: 'data-see-ad', raw: null });
    out += writeStart(name, kept, token.selfClosing);
  }
  // A thing with no name of its own is called what the page is.
  const named = media.list().map((each) => (each.title !== '' ? each : { ...each, title: (shownTitle || title || '').slice(0, 160) }));
  return { html: noFrames(out), title, language, media: named, watchers: [...watchers.values()], files, refused, signIn, refresh };
}
