/**
 * READER's extraction (SPEC-seeing-machine.md, "02 READER"): the main words and pictures of a page, in reading order, as a small set of
 * plain tags. Pure but for `sign`. Nothing of the page's own markup is copied: every tag here is written by us, and every word escaped.
 */
import { decodeEntities, escapeText, escapeValue, tokensOf, valueOf, type Attribute } from './html';
import type { Sign } from './rewrite';

type Element = { name: string; attributes: Attribute[]; children: (Element | string)[]; parent: Element | null; depth: number; words: number; commas: number; linked: number };

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** Never read: not the page's words. */
const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'canvas', 'audio', 'video', 'form', 'button', 'select', 'input', 'textarea', 'nav', 'dialog', 'menu', 'head', 'title']);
const FURNITURE = /(?:^|[\s_-])(?:nav|navbar|navigation|menu|sidebar|footer|masthead|breadcrumbs?|share|sharing|social|related|recommended|promo|newsletter|subscribe|signup|cookie|consent|banner|comments?|disqus|advert|advertisement|ads?|sponsored|skip-link|sr-only|visually-hidden|toolbar|widget|popup|modal)(?=$|[\s_\d-])/i;
const LIKELY = /(?:^|[\s_-])(?:article|story|content|main|post|entry|body|text|prose|page)(?=$|[\s_\d-])/i;
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'center', 'details', 'dir', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
/** What each of these ends, and where that stops. */
const ENDS: Record<string, readonly string[]> = { li: ['li'], dd: ['dd', 'dt'], dt: ['dd', 'dt'], td: ['td', 'th'], th: ['td', 'th'], tr: ['td', 'th', 'tr'], tbody: ['td', 'th', 'tr', 'thead', 'tbody'], option: ['option'] };
/** Deeper than anything written to be read: past it, what is inside is taken as beside. A page made to be slow is no slower for its depth. */
const DEEPEST = 120;
/** More tags than any page a person reads; the rest is not looked at. */
const TOKENS_MOST = 300_000;
const BOUNDS = new Set(['ul', 'ol', 'dl', 'table', 'body', 'html']);

const element = (name: string, attributes: Attribute[], parent: Element | null): Element => ({ name, attributes, children: [], parent, depth: parent === null ? 0 : parent.depth + 1, words: 0, commas: 0, linked: 0 });

/** A plain tree from the tokens, with the ends a browser would put in. Enough to find the words by; not a browser's tree. */
function treeOf(html: string): Element {
  const root = element('root', [], null);
  let here = root;
  let skip: string | null = null;
  let depth = 0;
  const closeTo = (names: readonly string[]) => {
    for (let at: Element | null = here; at !== null && at.parent !== null; at = at.parent) {
      if (names.includes(at.name)) {
        here = at.parent;
        return;
      }
      if (BOUNDS.has(at.name)) return;
    }
  };
  let tokens = 0;
  for (const token of tokensOf(html)) {
    tokens += 1;
    if (tokens > TOKENS_MOST) break;
    if (skip !== null) {
      if (token.kind === 'start' && token.name === skip && !token.selfClosing) depth += 1;
      if (token.kind === 'end' && token.name === skip && (depth -= 1) === 0) skip = null;
      continue;
    }
    if (token.kind === 'text') here.children.push(token.text);
    else if (token.kind === 'start') {
      if (SKIPPED.has(token.name)) {
        if (!VOID.has(token.name) && !token.selfClosing) {
          skip = token.name;
          depth = 1;
        }
        continue;
      }
      if (CLOSES_P.has(token.name)) closeTo(['p']);
      const ends = ENDS[token.name];
      if (ends !== undefined) for (let i = 0; i < 3; i += 1) closeTo(ends);
      const made = element(token.name, token.attributes, here);
      here.children.push(made);
      if (!VOID.has(token.name) && !token.selfClosing && made.depth < DEEPEST) here = made;
    } else if (token.kind === 'end') {
      for (let at: Element | null = here; at !== null && at.parent !== null; at = at.parent) {
        if (at.name !== token.name) continue;
        here = at.parent;
        break;
      }
    }
  }
  return root;
}

function count(node: Element, inLink: boolean): void {
  const link = inLink || node.name === 'a';
  for (const child of node.children) {
    if (typeof child === 'string') {
      const text = decodeEntities(child);
      // Words in alphabets without spaces are counted by their letters.
      const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length + Math.floor((text.match(/[぀-ヿ㐀-鿿가-힯]/g) ?? []).length / 3);
      node.words += words;
      node.commas += (text.match(/[,、，;；。]/g) ?? []).length;
      if (link) node.linked += words;
    } else {
      count(child, link);
      node.words += child.words;
      node.commas += child.commas;
      node.linked += child.linked;
    }
  }
}

const named = (node: Element): string => `${valueOf(node.attributes, 'id') ?? ''} ${valueOf(node.attributes, 'class') ?? ''}`;

function isFurniture(node: Element): boolean {
  if (node.name === 'article' || node.name === 'main' || node.name === 'body' || node.name === 'html') return false;
  if (node.name === 'aside' || node.name === 'footer') return true;
  const role = valueOf(node.attributes, 'role') ?? '';
  if (/^(?:navigation|banner|contentinfo|complementary|search|dialog|alert)$/.test(role)) return true;
  if (valueOf(node.attributes, 'aria-hidden') === 'true' || node.attributes.some((each) => each.name === 'hidden')) return true;
  return FURNITURE.test(named(node)) && !(LIKELY.test(named(node)) && node.words > 200);
}

/** The element most of the page's writing is in. */
function mainOf(root: Element): Element | null {
  const scores = new Map<Element, number>();
  const add = (node: Element | null, points: number) => {
    if (node !== null) scores.set(node, (scores.get(node) ?? 0) + points);
  };
  const walk = (node: Element): void => {
    if (isFurniture(node)) return;
    const own = node.name === 'p' || node.name === 'pre' || node.name === 'blockquote' || node.name === 'td' || (node.name === 'div' && node.children.some((child) => typeof child === 'string' && child.trim().length > 80));
    if (own && node.words >= 8) {
      const points = (1 + Math.min(node.commas, 12) + Math.min(node.words / 20, 8)) * (1 - node.linked / Math.max(1, node.words));
      add(node.parent, points);
      add(node.parent?.parent ?? null, points / 2);
      add(node.parent?.parent?.parent ?? null, points / 4);
    }
    for (const child of node.children) if (typeof child !== 'string') walk(child);
  };
  walk(root);
  let best: Element | null = null;
  let most = 0;
  for (const [node, points] of scores) {
    const bonus = node.name === 'article' || node.name === 'main' ? 1.4 : LIKELY.test(named(node)) ? 1.15 : 1;
    const score = points * bonus * (1 - node.linked / Math.max(1, node.words));
    if (score > most) {
      most = score;
      best = node;
    }
  }
  return best !== null && best.words >= 20 ? best : null;
}

/** Links that say something, as a list of results has: three words at least, and not the page's furniture. */
const RESULTS_LEAST = 6;
function listOf(root: Element): Element | null {
  const inside = new Map<Element, number>();
  let all = 0;
  const walk = (node: Element): number => {
    if (isFurniture(node)) return 0;
    let found = 0;
    if (node.name === 'a' && node.words >= 3 && valueOf(node.attributes, 'href') !== null) found = 1;
    else for (const child of node.children) if (typeof child !== 'string') found += walk(child);
    inside.set(node, found);
    return found;
  };
  all = walk(root);
  if (all < RESULTS_LEAST) return null;
  // The smallest element most of them are in.
  let here = root;
  for (;;) {
    const next = here.children.find((child): child is Element => typeof child !== 'string' && (inside.get(child) ?? 0) >= all * 0.7);
    if (next === undefined || next.name === 'a') return here;
    here = next;
  }
}

const KEPT = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'code', 'kbd', 'samp', 'var', 'figure', 'figcaption', 'table', 'caption', 'thead', 'tbody', 'tr', 'td', 'th', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'sub', 'sup', 'small', 'mark', 'q', 'cite', 'abbr', 'time', 'br', 'hr', 'ruby', 'rt', 'rp']);
const BLOCK = new Set(['div', 'section', 'article', 'main', 'header', 'center', 'details', 'summary', 'address', 'picture', 'span', 'font', 'body', 'html', 'label', 'fieldset', 'legend', 'nobr', 'tt', 'big', 'a', 'dfn', 'bdi', 'bdo', 'data']);

function write(node: Element, base: string, sign: Sign, title: { left: string | null }, list = false): string {
  let out = '';
  for (const child of node.children) {
    if (typeof child === 'string') {
      out += escapeText(decodeEntities(child));
      continue;
    }
    if (isFurniture(child)) continue;
    // A list or a box that is nearly all links is a menu, whatever it is called.
    if (!list && ['ul', 'ol', 'div', 'section', 'table'].includes(child.name) && child.words > 6 && child.linked / child.words > 0.8 && child.commas < 3) continue;
    if (child.name === 'img') {
      const given = valueOf(child.attributes, 'src') ?? '';
      const src = given === '' || given.startsWith('data:') ? (valueOf(child.attributes, 'data-src') ?? valueOf(child.attributes, 'data-lazy-src') ?? '') : given;
      const small = ['width', 'height'].some((each) => Number(valueOf(child.attributes, each) ?? '100') < 40);
      const answer = src === '' || small ? null : sign(src, 'picture');
      if (answer !== null) out += `<img src="${escapeValue(answer)}" alt="${escapeValue(valueOf(child.attributes, 'alt') ?? '')}" loading="lazy">`;
      continue;
    }
    const inside = write(child, base, sign, title, list);
    if (child.name === 'a') {
      const href = valueOf(child.attributes, 'href');
      let address: string | null = null;
      try {
        const url = href === null ? null : new URL(href.trim(), base);
        address = url !== null && (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
      } catch {
        // Not an address: its words stay, without the link.
      }
      out += address === null ? inside : `<a href="${escapeValue(address)}">${inside}</a>`;
    } else if (KEPT.has(child.name)) {
      if (child.name === 'br' || child.name === 'hr') out += `<${child.name}>`;
      else if (inside.trim() !== '') {
        // The page's own heading is the title already at the top.
        const same = /^h[1-2]$/.test(child.name) && title.left !== null && inside.replace(/<[^>]+>/g, '').trim() === title.left;
        if (same) title.left = null;
        else {
          const name = child.name === 'h1' ? 'h2' : child.name;
          const spans = ['colspan', 'rowspan'].filter((each) => (name === 'td' || name === 'th') && /^\d{1,2}$/.test(valueOf(child.attributes, each) ?? '')).map((each) => ` ${each}="${valueOf(child.attributes, each)}"`);
          out += `<${name}${spans.join('')}>${inside}</${name}>`;
        }
      }
    } else if (BLOCK.has(child.name) && !['span', 'font', 'nobr', 'tt', 'big', 'dfn', 'bdi', 'bdo', 'data', 'label'].includes(child.name)) out += `<div>${inside}</div>`;
    else out += inside;
  }
  return out;
}

/** The page's main words and pictures, or null when none were found. */
export function readingOf(html: string, address: string, title: string | null, sign: Sign): string | null {
  const root = treeOf(html);
  count(root, false);
  const written = mainOf(root);
  // No writing to speak of, and a list of links that say something: the list is what the page is for.
  const links = written === null || written.words < 120 ? listOf(root) : null;
  const main = links ?? written;
  if (main === null) return null;
  let base = address;
  const tag = /<base\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(html.slice(0, 5_000))?.[1];
  try {
    if (tag !== undefined) base = new URL(decodeEntities(tag), address).href;
  } catch {
    // The page's own address stands.
  }
  const signed: Sign = (text, kind) => {
    try {
      return sign(new URL(text.trim(), base).href, kind);
    } catch {
      return null;
    }
  };
  // The page's first heading, as its title, where the words start; a title like `Story - Site` says more than the story does.
  const heading = firstHeading(root);
  const shown = heading ?? title;
  const body = write(main, base, signed, { left: shown === null ? null : escapeText(shown) }, links !== null);
  return `${shown === null ? '' : `<h1>${escapeText(shown)}</h1>`}${body}`;
}

function firstHeading(node: Element): string | null {
  for (const child of node.children) {
    if (typeof child === 'string' || isFurniture(child)) continue;
    if (child.name === 'h1') {
      const text = wordsIn(child).replace(/\s+/g, ' ').trim();
      if (text.length > 2 && text.length < 200) return text;
    }
    const deeper = firstHeading(child);
    if (deeper !== null) return deeper;
  }
  return null;
}

function wordsIn(node: Element): string {
  return node.children.map((child) => (typeof child === 'string' ? decodeEntities(child) : wordsIn(child))).join('');
}
