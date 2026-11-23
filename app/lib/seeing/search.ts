/**
 * Searching from the address box (Luke, 2026-11-23: "a list of multiple search engines such as Google, bing and your best ideas"). An engine is
 * an address with a place for the words; its results are a page like any other, shown through a lens and never read into anything of ours.
 * Pure: the words go to the engine that is asked and nowhere else.
 */
import { ADDRESS_MOST, readAddress } from './address';

/** `here`: its results read in the server's eye (tried, docs/seeing-machine.md). `out`: it turns servers away, so OWN EYE or a new tab. `site`: ours. */
export type Opens = 'here' | 'out' | 'site';
export type Engine = { id: string; name: string; group: string; short: string; address: string; opens: Opens };

export const ENGINE_GROUPS = ['GENERAL', 'SMALL AND OLD WEB', 'KNOWLEDGE', 'WATCHING AND LOOKING', 'HERE', 'YOURS'] as const;

export const ENGINES: readonly Engine[] = [
  { id: 'duckduckgo', name: 'DuckDuckGo', group: 'GENERAL', short: 'd', address: 'https://html.duckduckgo.com/html/?q=%s', opens: 'here' },
  { id: 'google', name: 'Google', group: 'GENERAL', short: 'g', address: 'https://www.google.com/search?q=%s', opens: 'out' },
  { id: 'bing', name: 'Bing', group: 'GENERAL', short: 'b', address: 'https://www.bing.com/search?q=%s', opens: 'out' },
  { id: 'brave', name: 'Brave', group: 'GENERAL', short: 'br', address: 'https://search.brave.com/search?q=%s', opens: 'out' },
  { id: 'startpage', name: 'Startpage', group: 'GENERAL', short: 'sp', address: 'https://www.startpage.com/sp/search?query=%s', opens: 'out' },
  { id: 'mojeek', name: 'Mojeek', group: 'GENERAL', short: 'mj', address: 'https://www.mojeek.com/search?q=%s', opens: 'out' },
  { id: 'ecosia', name: 'Ecosia', group: 'GENERAL', short: 'e', address: 'https://www.ecosia.org/search?q=%s', opens: 'out' },
  { id: 'qwant', name: 'Qwant', group: 'GENERAL', short: 'q', address: 'https://www.qwant.com/?q=%s', opens: 'out' },
  { id: 'marginalia', name: 'Marginalia', group: 'SMALL AND OLD WEB', short: 'ma', address: 'https://marginalia-search.com/search?query=%s', opens: 'here' },
  { id: 'wiby', name: 'Wiby', group: 'SMALL AND OLD WEB', short: 'wb', address: 'https://wiby.me/?q=%s', opens: 'here' },
  { id: 'wayback', name: 'Wayback Machine', group: 'SMALL AND OLD WEB', short: 'wm', address: 'https://web.archive.org/web/*/%s', opens: 'out' },
  { id: 'wikipedia', name: 'Wikipedia', group: 'KNOWLEDGE', short: 'w', address: 'https://en.wikipedia.org/w/index.php?title=Special:Search&fulltext=1&search=%s', opens: 'here' },
  { id: 'wiktionary', name: 'Wiktionary', group: 'KNOWLEDGE', short: 'wt', address: 'https://en.wiktionary.org/w/index.php?title=Special:Search&fulltext=1&search=%s', opens: 'here' },
  { id: 'archive', name: 'Internet Archive', group: 'KNOWLEDGE', short: 'ia', address: 'https://archive.org/search?query=%s', opens: 'out' },
  { id: 'openlibrary', name: 'Open Library', group: 'KNOWLEDGE', short: 'ol', address: 'https://openlibrary.org/search?q=%s', opens: 'out' },
  { id: 'arxiv', name: 'arXiv', group: 'KNOWLEDGE', short: 'ax', address: 'https://arxiv.org/search/?searchtype=all&query=%s', opens: 'here' },
  { id: 'stackoverflow', name: 'Stack Overflow', group: 'KNOWLEDGE', short: 'so', address: 'https://stackoverflow.com/search?q=%s', opens: 'out' },
  { id: 'github', name: 'GitHub', group: 'KNOWLEDGE', short: 'gh', address: 'https://github.com/search?type=repositories&q=%s', opens: 'here' },
  { id: 'mdn', name: 'MDN', group: 'KNOWLEDGE', short: 'mdn', address: 'https://developer.mozilla.org/en-US/search?q=%s', opens: 'out' },
  { id: 'youtube', name: 'YouTube', group: 'WATCHING AND LOOKING', short: 'y', address: 'https://www.youtube.com/results?search_query=%s', opens: 'out' },
  { id: 'openverse', name: 'Openverse', group: 'WATCHING AND LOOKING', short: 'ov', address: 'https://openverse.org/search/?q=%s', opens: 'out' },
  { id: 'commons', name: 'Wikimedia Commons', group: 'WATCHING AND LOOKING', short: 'c', address: 'https://commons.wikimedia.org/w/index.php?title=Special:Search&profile=images&fulltext=1&search=%s', opens: 'here' },
  { id: 'debaser', name: 'DEBASER.SITE', group: 'HERE', short: 's', address: '/search?%s', opens: 'site' },
  { id: 'media', name: 'MEDIA', group: 'HERE', short: 'm', address: '/media?q=%s', opens: 'site' },
];

export const SEARCH_ALL_MOST = 3;
export const OWN_ENGINES_MOST = 20;
export const ENGINE_NAME_MOST = 30;

/** What the reader has chosen: the engine asked, the ones switched off, their order, the three SEARCH ALL asks, and their own. */
export type SearchChoices = { chosen: string; off: readonly string[]; order: readonly string[]; all: readonly string[]; own: readonly Engine[] };
export const CHOICES_AT_FIRST: SearchChoices = { chosen: 'duckduckgo', off: [], order: [], all: ['duckduckgo', 'marginalia', 'wikipedia'], own: [] };

/** Every engine there is, in the reader's order: the ones they have moved first in their groups' places, the rest as they come. */
export function enginesOf(choices: SearchChoices): Engine[] {
  const every = [...ENGINES, ...choices.own];
  const place = (id: string) => {
    const at = choices.order.indexOf(id);
    return at === -1 ? choices.order.length + every.findIndex((each) => each.id === id) : at;
  };
  return every.sort((a, b) => place(a.id) - place(b.id));
}
export const enginesOn = (choices: SearchChoices): Engine[] => enginesOf(choices).filter((each) => !choices.off.includes(each.id));
export function engineChosen(choices: SearchChoices): Engine {
  const on = enginesOn(choices);
  return on.find((each) => each.id === choices.chosen) ?? on[0] ?? ENGINES[0];
}

/** The words as they are sent: one line, nothing that turns a line round, and whole characters only. */
export const cleanWords = (text: string): string => text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '').replace(/[\s\u0000-\u001f\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim();

/** An engine's own address for some words. A function, so nothing in the words is read as a pattern. */
export const searchAddress = (engine: Engine, words: string): string => engine.address.replace('%s', () => encodeURIComponent(cleanWords(words)));

/** A name that ends like a file, and is nobody's site: `node.js`, `notes.txt`. */
const FILE_ENDING = /\.(?:js|mjs|cjs|ts|tsx|jsx|txt|css|html?|json|xml|ya?ml|exe|dll|jpe?g|png|gif|svg|pdf|docx?|xlsx?|mp[34]|wav|py|rb|rs|cpp|java|php|sql|ini|cfg|log)$/i;

/** Whether what was typed is an address; null when it is words. A refusal is for what is plainly an address, and can't be opened. */
function addressIn(text: string): { ok: true; address: string } | { ok: false; reason: string } | null {
  if (/^see:/i.test(text)) return readAddress(text);
  if (/^https?:\/\//i.test(text)) return readAddress(text.replace(/ /g, '%20'));
  // `//example.com` and `http:example.com` are addresses as a browser reads them, when what follows is a site's name.
  const loose = /^(?:(https?):(?!\/)|\/\/(?!\/))(\S+)$/i.exec(text);
  if (loose !== null) {
    const read = addressIn(loose[2]);
    return read?.ok === true && loose[1]?.toLowerCase() === 'http' ? readAddress(read.address.replace(/^https:/, 'http:')) : read;
  }
  if (/\s/.test(text)) return null;
  // Another kind of address (`javascript:`, `file:`), typed whole: refused, and not handed to an engine either.
  if (/^(?:javascript|data|file|blob|vbscript|about|chrome|edge|ftp|mailto|tel|ws|wss|view-source|chrome-extension):/i.test(text)) return readAddress(text);
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#].*)?$/.test(text) || /^[a-z0-9-]+:\d{2,5}(?:[/?#].*)?$/i.test(text)) return readAddress(text);
  const host = /^([^/?#:@]+)(?::\d{1,5})?(?:[/?#].*)?$/.exec(text)?.[1] ?? '';
  // A site's name: parts between dots, the last of them letters (or a name in another alphabet), two at least.
  if (!/^(?:[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}-]*[\p{L}\p{N}\p{M}])?\.)+(?:\p{L}[\p{L}\p{M}]+|xn--[a-z0-9-]+)\.?$/u.test(host)) return null;
  if (host === text && FILE_ENDING.test(text)) return null;
  return readAddress(text);
}

export type Typed = { kind: 'nothing' } | { kind: 'address'; address: string } | { kind: 'refused'; reason: string } | { kind: 'list' } | { kind: 'search'; engine: Engine; words: string };

/** What GO will do with what is in the box. */
export function readBox(typed: string, choices: SearchChoices): Typed {
  const text = typed.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, ADDRESS_MOST);
  if (text === '') return { kind: 'nothing' };
  if (text === '!') return { kind: 'list' };
  // `w words`, or `!w words`: that engine, for this once.
  const first = /^(!?)([a-z]{1,8})\s+(\S[\s\S]*)$/i.exec(text);
  if (first !== null) {
    const engine = (first[1] === '!' ? enginesOf(choices) : enginesOn(choices)).find((each) => each.short === first[2].toLowerCase());
    if (engine !== undefined) return { kind: 'search', engine, words: cleanWords(first[3]) };
  }
  const address = addressIn(text);
  if (address !== null) return address.ok ? { kind: 'address', address: address.address } : { kind: 'refused', reason: address.reason };
  const words = cleanWords(text);
  return words === '' ? { kind: 'nothing' } : { kind: 'search', engine: engineChosen(choices), words };
}

/** Said under the box before it is pressed. */
export function sayBox(typed: Typed): string {
  switch (typed.kind) {
    case 'address':
      // The server refuses any other port whatever is said here (public-address.ts); said before GO, so the refusal is no surprise.
      // First, so a long address truncated on the line never hides it.
      return oddPort(typed.address) ? `THE SERVER'S EYE ASKS ONLY PORTS 80 AND 443 · GO TO ${typed.address}` : `GO TO ${typed.address}`;
    case 'search':
      return `SEARCH ${typed.engine.name.toUpperCase()} FOR ${typed.words}${typed.engine.opens === 'out' ? ' ↗' : ''}`;
    case 'list':
      return 'SHOW THE LIST';
    case 'refused':
      return typed.reason;
    case 'nothing':
      return '';
  }
}

/** An address on a port other than the ordinary two. */
function oddPort(address: string): boolean {
  try {
    const { port } = new URL(address);
    return port !== '' && port !== '80' && port !== '443';
  } catch {
    return false;
  }
}

/** Names that mean something only inside a house. The server refuses them whatever is said here; this keeps a mistake off the list. */
const INSIDE = /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|arpa|corp|private|test|invalid|onion|ts\.net|debaser\.site)$/i;

/** An engine the reader adds: a name, and an https address with one `%s` in it. */
export function ownEngine(name: string, address: string, id: string): Engine | string {
  const called = name.replace(/\s+/g, ' ').trim().slice(0, ENGINE_NAME_MOST);
  if (called === '') return 'IT NEEDS A NAME';
  const typed = address.trim();
  if (typed.split('%s').length !== 2) return 'ITS ADDRESS NEEDS ONE %s, WHERE THE WORDS GO';
  if (!/^https:\/\//i.test(typed)) return 'ITS ADDRESS STARTS WITH https://';
  const read = readAddress(typed.replace('%s', 'words'));
  // The engines list keeps its own words for an address inside the house (the box says NOT A PUBLIC ADDRESS).
  if (!read.ok) return read.reason === 'NOT A PUBLIC ADDRESS' ? "THAT ISN'T A SITE OUTSIDE" : read.reason;
  const url = new URL(read.address);
  const plain = new URL(typed.replace('%s', 'other'));
  if (url.hostname !== plain.hostname || url.port !== plain.port) return 'THE WORDS CAN\'T BE PART OF THE SITE\'S NAME';
  if (url.port !== '' || /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith('[') || !url.hostname.includes('.') || INSIDE.test(url.hostname.replace(/\.$/, ''))) return "THAT ISN'T A SITE OUTSIDE";
  return { id, name: called, group: 'YOURS', short: '', address: typed, opens: 'here' };
}

/** The words a results page in front was asked for, and by which engine. */
export function askedOf(address: string, choices: SearchChoices): { engine: Engine; words: string } | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  for (const engine of enginesOf(choices)) {
    if (engine.opens === 'site') continue;
    const mark = 'QZWORDSZQ';
    const pattern = new URL(engine.address.replace('%s', mark));
    if (pattern.hostname !== url.hostname) continue;
    let words: string | null = null;
    if (pattern.pathname.includes(mark)) {
      const [before, after] = pattern.pathname.split(mark);
      if (url.pathname.startsWith(before) && url.pathname.endsWith(after)) words = url.pathname.slice(before.length, url.pathname.length - after.length);
      try {
        words = words === null ? null : decodeURIComponent(words);
      } catch {
        words = null;
      }
    } else if (pattern.pathname === url.pathname || `${pattern.pathname}/` === url.pathname) {
      for (const [key, value] of pattern.searchParams) if (value === mark) words = url.searchParams.get(key);
      for (const [key, value] of pattern.searchParams) if (value !== mark && key === 'title' && url.searchParams.get(key) !== value) words = null;
    }
    const clean = words === null ? '' : cleanWords(words);
    if (clean !== '') return { engine, words: clean };
  }
  return null;
}

/** Read back through one door. */
export function choicesFrom(value: unknown): SearchChoices {
  if (typeof value !== 'object' || value === null) return CHOICES_AT_FIRST;
  const { chosen, off, order, all, own } = value as Record<string, unknown>;
  const mine: Engine[] = [];
  for (const each of Array.isArray(own) ? own.slice(0, OWN_ENGINES_MOST) : []) {
    const { id, name, address } = (typeof each === 'object' && each !== null ? each : {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !/^own-[a-z0-9-]{1,40}$/.test(id) || typeof name !== 'string' || typeof address !== 'string' || mine.some((known) => known.id === id)) continue;
    const made = ownEngine(name, address, id);
    if (typeof made !== 'string') mine.push(made);
  }
  const known = new Set([...ENGINES, ...mine].map((each) => each.id));
  const ids = (from: unknown, most: number): string[] => (Array.isArray(from) ? [...new Set(from.filter((each): each is string => typeof each === 'string' && known.has(each)))].slice(0, most) : []);
  const every = known.size;
  return {
    chosen: typeof chosen === 'string' && known.has(chosen) ? chosen : CHOICES_AT_FIRST.chosen,
    off: ids(off, every - 1),
    order: ids(order, every),
    all: Array.isArray(all) ? ids(all, SEARCH_ALL_MOST) : CHOICES_AT_FIRST.all,
    own: mine,
  };
}

/** One place up (-1) or down (1) among the others of its group. */
export function moved(choices: SearchChoices, id: string, by: -1 | 1): SearchChoices {
  const every = enginesOf(choices);
  const group = every.find((each) => each.id === id)?.group;
  const peers = every.filter((each) => each.group === group);
  const other = peers[peers.findIndex((each) => each.id === id) + by];
  if (other === undefined) return choices;
  const order = every.map((each) => (each.id === id ? other.id : each.id === other.id ? id : each.id));
  return { ...choices, order };
}
