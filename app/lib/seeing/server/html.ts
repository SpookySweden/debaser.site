/**
 * Reading HTML as a browser's tokenizer does (the HTML standard, 13.2.5): tags, their attributes, words and comments, in the order they
 * were written, whatever state the page is in. The rewriter changes tags as they go by and passes the rest through, so the browser does
 * the building and a broken page stays exactly as broken as it was. Pure.
 *
 * This is not what keeps the reader safe: the frame's sandbox and policy are, and they hold whatever gets past it.
 */

export type Attribute = { name: string; /** As written, entities and all; null for one with no value. */ raw: string | null };
export type Token =
  | { kind: 'text'; text: string }
  /** What is inside a script, a style, a title...: not markup. `of` is the element's name. */
  | { kind: 'raw'; of: string; text: string }
  | { kind: 'start'; name: string; attributes: Attribute[]; selfClosing: boolean; foreign: boolean }
  | { kind: 'end'; name: string }
  | { kind: 'doctype'; text: string }
  | { kind: 'comment' };

/** Their insides are words, not tags, up to their own end tag. */
const RAW = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'textarea', 'title', 'plaintext']);
/** Inside these the rules above don't hold, until one of the second set, where HTML starts again. */
const FOREIGN = new Set(['svg', 'math']);
const BACK_TO_HTML = new Set(['foreignobject', 'desc', 'title', 'annotation-xml', 'mi', 'mo', 'mn', 'ms', 'mtext']);

/** Drawings in drawings: past this they are not told apart, and a page made of nothing else is no slower to read. */
const OPEN_MOST = 64;

const SPACE = /[\t\n\f\r ]/;

function readTag(html: string, from: number): { name: string; attributes: Attribute[]; selfClosing: boolean; end: number } | null {
  let at = from;
  while (at < html.length && !/[\t\n\f\r />]/.test(html[at])) at += 1;
  const name = html.slice(from, at).toLowerCase().replace(/\0/g, '\ufffd');
  const attributes: Attribute[] = [];
  const seen = new Set<string>();
  let selfClosing = false;
  for (;;) {
    while (at < html.length && (SPACE.test(html[at]) || html[at] === '/')) {
      selfClosing = html[at] === '/';
      at += 1;
    }
    // The page ended inside the tag: a browser throws the tag away.
    if (at >= html.length) return null;
    if (html[at] === '>') return { name, attributes, selfClosing, end: at + 1 };
    selfClosing = false;
    const start = at;
    if (html[at] === '=') at += 1;
    while (at < html.length && !/[\t\n\f\r />=]/.test(html[at])) at += 1;
    const attribute = html.slice(start, at).toLowerCase();
    while (at < html.length && SPACE.test(html[at])) at += 1;
    let raw: string | null = null;
    if (html[at] === '=') {
      at += 1;
      while (at < html.length && SPACE.test(html[at])) at += 1;
      const quote = html[at];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, at + 1);
        if (close === -1) return null;
        raw = html.slice(at + 1, close);
        at = close + 1;
      } else {
        const begin = at;
        while (at < html.length && !/[\t\n\f\r >]/.test(html[at])) at += 1;
        raw = html.slice(begin, at);
      }
    }
    // The first of a name counts; a second is not there.
    if (!seen.has(attribute)) {
      seen.add(attribute);
      attributes.push({ name: attribute, raw });
    }
  }
}

/** Where a raw element's own end tag begins, or the end of the page. A script that holds `<!-- <script>` is read as a browser reads it. */
function rawEnd(html: string, from: number, name: string): number {
  if (name === 'plaintext') return html.length;
  const closing = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'gi');
  closing.lastIndex = from;
  if (name !== 'script') return closing.exec(html)?.index ?? html.length;
  const marks = /<!--|-->|<script(?=[\t\n\f\r />])|<\/script(?=[\t\n\f\r />])/gi;
  marks.lastIndex = from;
  let escaped = false;
  let doubled = false;
  for (let mark = marks.exec(html); mark !== null; mark = marks.exec(html)) {
    const text = mark[0].toLowerCase();
    if (text === '<!--') {
      escaped = true;
      // `<!-->` and `<!--->` close it at once.
      marks.lastIndex = mark.index + 2;
      if (/^-->|^--->/.test(html.slice(marks.lastIndex, marks.lastIndex + 4))) marks.lastIndex = mark.index + 2;
      else marks.lastIndex = mark.index + 4;
    } else if (text === '-->') {
      escaped = false;
      doubled = false;
    } else if (text === '<script') {
      if (escaped) doubled = true;
    } else if (doubled) doubled = false;
    else return mark.index;
  }
  return html.length;
}

export function* tokensOf(html: string): Generator<Token> {
  let at = 0;
  /** The foreign elements and the ways back to HTML that are open, innermost last. */
  const open: string[] = [];
  const foreign = () => open.length > 0 && FOREIGN.has(open[open.length - 1]);
  while (at < html.length) {
    const next = html.indexOf('<', at);
    if (next === -1) {
      yield { kind: 'text', text: html.slice(at) };
      return;
    }
    if (next > at) yield { kind: 'text', text: html.slice(at, next) };
    at = next;
    const after = html[at + 1] ?? '';
    if (/[a-z]/i.test(after)) {
      const tag = readTag(html, at + 1);
      if (tag === null) return;
      at = tag.end;
      const inForeign = foreign();
      yield { kind: 'start', name: tag.name, attributes: tag.attributes, selfClosing: tag.selfClosing, foreign: inForeign || FOREIGN.has(tag.name) };
      if (FOREIGN.has(tag.name) && !tag.selfClosing) {
        if (open.length < OPEN_MOST) open.push(tag.name);
      } else if (inForeign && BACK_TO_HTML.has(tag.name) && !tag.selfClosing) {
        if (open.length < OPEN_MOST) open.push(tag.name);
      } else if (RAW.has(tag.name) && !inForeign) {
        const end = rawEnd(html, at, tag.name);
        if (end > at) yield { kind: 'raw', of: tag.name, text: html.slice(at, end) };
        at = end;
      } else if (inForeign && (tag.name === 'script' || tag.name === 'style') && !tag.selfClosing) {
        // In SVG these hold text with entities and tags read as tags; taken up to their end so the insides go through the same hands.
        const end = rawEnd(html, at, tag.name);
        if (end > at) yield { kind: 'raw', of: tag.name, text: html.slice(at, end) };
        at = end;
      }
    } else if (after === '/' && /[a-z]/i.test(html[at + 2] ?? '')) {
      const tag = readTag(html, at + 2);
      if (tag === null) return;
      at = tag.end;
      const here = open.lastIndexOf(tag.name);
      if (here !== -1) open.length = here;
      yield { kind: 'end', name: tag.name };
    } else if (html.startsWith('<!--', at)) {
      const rest = html.slice(at + 4, at + 6);
      if (rest.startsWith('>')) at += 5;
      else if (rest === '->') at += 6;
      else {
        const ends = /--!?>/g;
        ends.lastIndex = at + 4;
        const end = ends.exec(html);
        at = end === null ? html.length : end.index + end[0].length;
      }
      yield { kind: 'comment' };
    } else if (html.startsWith('<![CDATA[', at) && foreign()) {
      const end = html.indexOf(']]>', at);
      yield { kind: 'text', text: escapeText(html.slice(at + 9, end === -1 ? html.length : end)) };
      at = end === -1 ? html.length : end + 3;
    } else if (after === '!' || after === '?' || after === '/') {
      const end = html.indexOf('>', at);
      const text = html.slice(at, end === -1 ? html.length : end + 1);
      at = end === -1 ? html.length : end + 1;
      if (/^<!doctype/i.test(text)) yield { kind: 'doctype', text };
      else yield { kind: 'comment' };
    } else {
      yield { kind: 'text', text: '&lt;' };
      at += 1;
    }
  }
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', colon: ':', sol: '/', period: '.', comma: ',', num: '#', quest: '?', equals: '=', lpar: '(', rpar: ')', tab: '\t', newline: '\n', hyphen: '‐', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', middot: '·', bull: '•', raquo: '»', laquo: '«', copy: '©', reg: '®', trade: '™', pound: '£', euro: '€', eacute: 'é', times: '×' };
/** Windows' own numbers for these, which every browser reads as what was meant. */
const C1: Record<number, number> = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030, 0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178 };

/** A value's entities read: numbers, and the names an address or a title is likely to hold. Others are left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]{1,8})|#([0-9]{1,8})|([a-z]{2,10}));?/gi, (whole, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
    if (name !== undefined) {
      // Without its `;` a name is only an entity when nothing follows it that could be part of an address (`&copy=1`).
      const known = NAMED[name] ?? (whole.endsWith(';') ? NAMED[name.toLowerCase()] : undefined);
      return known !== undefined && (whole.endsWith(';') || name === 'amp' || name === 'lt' || name === 'gt' || name === 'quot') ? known : whole;
    }
    const number = hex !== undefined ? parseInt(hex, 16) : parseInt(decimal ?? '', 10);
    const code = C1[number] ?? number;
    return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
  });
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeValue(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function valueOf(attributes: readonly Attribute[], name: string): string | null {
  const found = attributes.find((attribute) => attribute.name === name);
  return found === undefined ? null : decodeEntities(found.raw ?? '');
}

/** An attribute's name as a browser would take it back; one that could not be is dropped. */
const NAME = /^[^\s"'<>/=\u0000-\u001f]+$/;

/** A tag written again. A value keeps its entities as they were, between quotes nothing in it can end. */
export function writeStart(name: string, attributes: readonly Attribute[], selfClosing: boolean): string {
  let out = `<${name}`;
  for (const attribute of attributes) {
    if (!NAME.test(attribute.name)) continue;
    out += attribute.raw === null ? ` ${attribute.name}` : ` ${attribute.name}="${attribute.raw.replace(/"/g, '&quot;')}"`;
  }
  return `${out}${selfClosing ? '/' : ''}>`;
}
