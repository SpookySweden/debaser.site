/**
 * A news feed (RSS or Atom) seen in BROWSER, drawn as what it lists instead of its raw XML (IMPROVE, 2026-11-23, decision 42): its title,
 * then each item's title as a link, its date and a few plain words of what it says. Everything the feed says is plain text here, escaped:
 * no markup of its own reaches the page, and only http(s) links are kept. Pure; nothing is fetched. Anything that isn't a feed gives null.
 * Read by searching forward only, never by patterns that go back over what they've read, so a feed built to be slow to read isn't.
 */
import { escapeText, escapeValue } from './html';

const ITEMS_MOST = 200;
const SAYS_MOST = 300;
const PIECE_MOST = 20_000;

/** The words inside a tag, entities read and any markup they held taken out. */
function plain(text: string): string {
  const unwrapped = text.slice(0, PIECE_MOST).split('<![CDATA[').join('').split(']]>').join('');
  const once = decode(unwrapped.replace(/<[^<>]*>/g, ' '));
  // A description often holds HTML written as entities: read, it is markup again, and goes too.
  return decode(once.replace(/<[^<>]*>/g, ' ')).replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (all, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#')) {
      const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : ' ';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[lower] ?? all;
  });
}

/** What the first <name ...>…</name> in this piece holds, as it is written, or null. */
function inside(piece: string, name: string): string | null {
  const lower = piece.toLowerCase();
  const open = `<${name.toLowerCase()}`;
  for (let from = 0; ; ) {
    const at = lower.indexOf(open, from);
    if (at === -1) return null;
    const next = lower.charAt(at + open.length);
    if (next === '>' || /\s/.test(next)) {
      const end = lower.indexOf('>', at);
      if (end === -1 || lower.charAt(end - 1) === '/') return null;
      const close = lower.indexOf(`</${name.toLowerCase()}>`, end);
      return close === -1 ? null : piece.slice(end + 1, close);
    }
    from = at + 1;
  }
}

/** The first of these tags' words, in this piece of the feed. */
function first(piece: string, names: readonly string[]): string {
  for (const name of names) {
    const found = inside(piece, name);
    if (found !== null) return plain(found);
  }
  return '';
}

/** Where an item leads: RSS's <link>words</link>, or Atom's <link href> (the alternate, or one with no rel). Only http(s). */
function linkOf(piece: string, base: string): string | null {
  let said = first(piece, ['link']);
  if (said === '') {
    for (const tag of piece.match(/<link\b[^<>]*>/gi) ?? []) {
      const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1].toLowerCase() ?? 'alternate';
      const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
      if (rel === 'alternate' && href !== undefined) {
        said = decode(href).trim();
        break;
      }
    }
  }
  if (said === '') said = first(piece, ['guid']);
  try {
    const url = new URL(said, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The items: each closing tag's text back to the last opening before it. */
function piecesOf(words: string, tag: string): string[] {
  const out: string[] = [];
  const chunks = words.split(new RegExp(`</${tag}\\s*>`, 'i'));
  chunks.pop();
  for (const chunk of chunks) {
    const at = chunk.toLowerCase().lastIndexOf(`<${tag}`);
    if (at !== -1) out.push(chunk.slice(at).slice(0, PIECE_MOST));
  }
  return out;
}

export function feedPage(words: string, address: string): { html: string; title: string } | null {
  const head = words.slice(0, 2000);
  const atom = /<feed\b[^<>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(head);
  if (!atom && !/<(?:rss|rdf:RDF)\b/i.test(head)) return null;
  const tag = atom ? 'entry' : 'item';
  const pieces = piecesOf(words, tag);
  const opening = words.toLowerCase().indexOf(`<${tag}`);
  const top = (opening === -1 ? words : words.slice(0, opening)).slice(0, PIECE_MOST);
  let host = '';
  try {
    host = new URL(address).hostname;
  } catch {
    // Not an address: the title stands alone.
  }
  const title = first(top, ['title']).slice(0, 200) || host;
  const about = first(top, atom ? ['subtitle'] : ['description']).slice(0, SAYS_MOST);
  const rows = pieces.slice(0, ITEMS_MOST).map((piece) => {
    const name = first(piece, ['title']).slice(0, 300) || 'UNTITLED';
    const link = linkOf(piece, address);
    const when = first(piece, ['pubDate', 'published', 'updated', 'dc:date']).slice(0, 40);
    const said = first(piece, atom ? ['summary', 'content'] : ['description', 'content:encoded']);
    const says = said.length > SAYS_MOST ? `${said.slice(0, SAYS_MOST - 1)}…` : said;
    return `<li style="margin:0 0 1em">${link === null ? `<b>${escapeText(name)}</b>` : `<a href="${escapeValue(link)}">${escapeText(name)}</a>`}${when === '' ? '' : `<br><small>${escapeText(when)}</small>`}${says === '' ? '' : `<br>${escapeText(says)}`}</li>`;
  });
  const count = `A FEED · ${pieces.length} ${pieces.length === 1 ? 'ITEM' : 'ITEMS'}${pieces.length > ITEMS_MOST ? ` · THE FIRST ${ITEMS_MOST} SHOWN` : ''}`;
  const html = `<main style="max-width:48em;margin:0 auto;padding:1em"><h1>${escapeText(title)}</h1><p><small>${count}</small></p>${about === '' ? '' : `<p>${escapeText(about)}</p>`}<ul style="padding-left:1.2em">${rows.join('')}</ul></main>`;
  return { html, title };
}
