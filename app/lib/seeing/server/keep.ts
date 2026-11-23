/**
 * KEEP PAGE's copy (SPEC-seeing-machine.md, "Captures"): made by the server's own signed-out fetch and nothing else, so nobody's signed-in
 * page can be in it. READER's form and the page without scripts, frames or forms, its sheets written into it and its pictures shrunk and
 * written into it, so it asks for nothing from anywhere. SERVER ONLY.
 */
import sharp from 'sharp';
import { AnySiteRefusal, safeFetchAnySite } from '../../web/safe-fetch';
import { KEPT_BYTES, QUOTE_LENGTH, type MadeCopy } from '../pages';
import { cleanTitle } from '../tabs';
import type { AssetKind } from './assets';
import { rewriteCss } from './css';
import { decodeEntities, tokensOf, valueOf } from './html';
import { fetchFile, resolveOn } from './files';
import { LIMITS } from './limits';
import { filesFor, HEADERS, PAGE_TYPES, realSee, ready, recorded, refusesPage, said, siteName, type SeeDeps } from './open';
import { readingOf } from './reading';
import { rewritePage } from './rewrite';
import { watcherAt } from './watchers-list';
import { wordsOf } from './words';

const PICTURES_MOST = 60;
const SHEETS_MOST = 12;
const PICTURE_WIDE = 900;
const CARD_WIDE = 240;
/** A picture larger than this many dots is not opened: it is a trick, or a poster. */
const DOTS_MOST = 16_000_000;
const WITHIN_MS = 45_000;
const AT_ONCE = 4;
const SHRUNK = /^image\/(?:png|jpeg|webp|gif|avif)$/;

/** Two pictures opened at once for everybody: open, one is sixty megabytes of memory. */
const SHRINKS_AT_ONCE = 2;
let shrinking = 0;
const inLine: (() => void)[] = [];

async function shrink(body: Uint8Array, wide: number): Promise<string | null> {
  while (shrinking >= SHRINKS_AT_ONCE) await new Promise<void>((go) => inLine.push(go));
  shrinking += 1;
  try {
    return await shrunk(body, wide);
  } finally {
    shrinking -= 1;
    inLine.shift()?.();
  }
}

async function shrunk(body: Uint8Array, wide: number): Promise<string | null> {
  try {
    const made = await sharp(body, { limitInputPixels: DOTS_MOST, failOn: 'error' }).rotate().resize({ width: wide, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
    return `data:image/webp;base64,${made.toString('base64')}`;
  } catch {
    return null;
  }
}

/** What a page says it is, from its own head. Words: drawn as words. */
export function cardOf(html: string, address: string): { title: string; description: string; picture: string | null; language: string; date: string } {
  const card = { title: '', description: '', picture: null as string | null, language: '', date: '' };
  let windowTitle = '';
  let inTitle = false;
  const line = (text: string, most: number) => decodeEntities(text).replace(/\s+/g, ' ').trim().slice(0, most);
  let tokens = 0;
  for (const token of tokensOf(html)) {
    tokens += 1;
    // A head is near the front.
    if (tokens > 4000) break;
    if (token.kind === 'raw' && inTitle) windowTitle ||= line(token.text, 200);
    inTitle = token.kind === 'start' && token.name === 'title';
    if (token.kind !== 'start') continue;
    if (token.name === 'html') card.language = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.exec(valueOf(token.attributes, 'lang') ?? '')?.[0].slice(0, 20) ?? '';
    if (token.name === 'time' && card.date === '') card.date = /^\d{4}-\d{2}-\d{2}/.exec(valueOf(token.attributes, 'datetime') ?? '')?.[0] ?? '';
    if (token.name !== 'meta') continue;
    const content = valueOf(token.attributes, 'content') ?? '';
    switch ((valueOf(token.attributes, 'property') ?? valueOf(token.attributes, 'name') ?? '').toLowerCase()) {
      case 'og:title':
        card.title ||= line(content, 200);
        break;
      case 'og:description':
        card.description = line(content, QUOTE_LENGTH) || card.description;
        break;
      case 'description':
        card.description ||= line(content, QUOTE_LENGTH);
        break;
      case 'og:image':
        card.picture ??= resolveOn(content, address);
        break;
      case 'article:published_time':
        card.date = /^\d{4}-\d{2}-\d{2}/.exec(content)?.[0] ?? card.date;
        break;
    }
  }
  return { ...card, title: card.title || windowTitle };
}

/** A form is not a form in a copy; its words stay. (A box's own insides are words to a browser, so boxes keep their names.) */
const noForms = (html: string): string => html.replace(/<(\/?)(?=form(?![a-z0-9]))/gi, '<$1see-');

/** POST /api/see/keep { address } -> { ok: true, card, copy } ; `copy` null when the page asked for a sign-in, or did not answer as itself. */
export async function keepAnswer(request: Request, deps: SeeDeps = realSee()): Promise<Response> {
  const asked = await ready(request, deps);
  if (!asked.ok) return asked.response;
  const { person, token, way, body } = asked;
  const address = typeof body.address === 'string' ? body.address : '';
  const tooMany = deps.counter.page(person);
  if (tooMany !== null) return said(429, tooMany);
  if (!(await recorded(person, [siteName(address)], deps, token))) return said(503, 'THE MACHINE IS OFF');
  const until = AbortSignal.any([request.signal, AbortSignal.timeout(WITHIN_MS)]);
  try {
    const answer = await deps.counter.turn(
      person,
      () => safeFetchAnySite(address, { way, accept: 'text/html,application/xhtml+xml', maxBytes: LIMITS.pageBytes, timeoutMs: LIMITS.timeoutMs, maxRedirects: LIMITS.redirects, types: PAGE_TYPES, refuses: refusesPage, signal: until }),
      until,
    );
    if (answer === null) return said(429, 'TOO MANY PAGES AT ONCE: WAIT A MINUTE');
    if (!/html/.test(answer.type)) return said(403, 'ONLY PAGES ARE KEPT');
    deps.counter.sent(person, answer.body.byteLength);
    const words = wordsOf(answer.body, answer.charset);
    const card = cardOf(words, answer.url);
    const files = filesFor(request, deps, way);

    // Each file's place is held by an address nobody can have: the page can't write one, since it can't know this one's name.
    const name = crypto.randomUUID();
    const wanted: { address: string; kind: AssetKind }[] = [];
    const known = new Map<string, number>();
    const hold = (base: string) => (text: string, kind: AssetKind): string | null => {
      if (kind !== 'picture' && kind !== 'style') return null;
      if (/^\s*data:image\//i.test(text)) return null;
      const where = resolveOn(text, base);
      if (where === null || where.length > 3000 || watcherAt(new URL(where).hostname) !== null) return null;
      const key = `${kind} ${where}`;
      let at = known.get(key);
      if (at === undefined) {
        if (wanted.filter((each) => each.kind === kind).length >= (kind === 'picture' ? PICTURES_MOST : SHEETS_MOST)) return null;
        at = wanted.length;
        wanted.push({ address: where, kind });
        known.set(key, at);
      }
      return `https://${name}.invalid/${at}`;
    };
    const sign = hold(answer.url);
    const page = rewritePage(words, answer.url, sign, false);
    const reading = readingOf(words, answer.url, page.title, sign);
    // A box for a password is on many ordinary pages; a page that is nothing else is a sign-in.
    const own = answer.status === 200 && !(page.signIn && reading === null);

    const got: string[] = [];
    const get = async (at: number): Promise<void> => {
      const file = wanted[at];
      got[at] = '';
      if (until.aborted || !deps.counter.file(person)) return;
      try {
        const answered = await deps.counter.turn(person, () => fetchFile(file.address, file.kind, files, until), until);
        if (answered === null) return;
        if (file.kind === 'picture') got[at] = SHRUNK.test(answered.type) ? ((await shrink(answered.body, PICTURE_WIDE)) ?? '') : '';
        // A sheet's own sheets, pictures and fonts stay behind; nothing in it can end the element it is written into (`rewriteCss`).
        else got[at] = rewriteCss(wordsOf(answered.body, answered.charset), () => null);
      } catch {
        // It did not come: a copy without it.
      }
    };
    let next = 0;
    const line = async () => {
      while (next < wanted.length) await get(next++);
    };
    const cardPicture = async (): Promise<string | null> => {
      if (card.picture === null || watcherAt(new URL(card.picture).hostname) !== null || !deps.counter.file(person)) return null;
      const from = card.picture;
      const answered = await deps.counter.turn(person, () => fetchFile(from, 'picture', files, until), until).catch(() => null);
      return answered === null || !SHRUNK.test(answered.type) ? null : shrink(answered.body, CARD_WIDE);
    };
    const [picture] = await Promise.all([own ? cardPicture() : null, ...(own ? Array.from({ length: AT_ONCE }, line) : [])]);

    let left = KEPT_BYTES;
    const filled = (html: string): string => {
      const place = new RegExp(`https://${name}\\.invalid/(\\d{1,3})`, 'g');
      left -= html.length;
      // Each writing of a sheet is counted as it is written: a page can name one sheet a hundred thousand times.
      const sheeted = html.replace(new RegExp(`@import url\\("https://${name}\\.invalid/(\\d{1,3})"\\);`, 'g'), (_, at: string) => {
        const sheet = got[Number(at)] ?? '';
        if (sheet.length > left) return '';
        left -= sheet.length;
        return sheet;
      });
      return sheeted.replace(place, (_, at: string) => {
        const data = wanted[Number(at)]?.kind === 'picture' ? (got[Number(at)] ?? '') : '';
        // The same picture a thousand times over is not ten megabytes a thousand times.
        if (data.length > left) return '';
        left -= data.length;
        return data;
      });
    };
    const readingMade = reading === null ? null : filled(reading);
    const pageMade = noForms(filled(page.html));
    const copy: MadeCopy | null = !own || left < 0 ? null : { html: pageMade, reading: readingMade, title: page.title ?? '' };
    return Response.json(
      { ok: true, address: answer.url, card: { title: cleanTitle(card.title) ?? cleanTitle(page.title ?? '') ?? answer.url, description: card.description, picture, language: card.language, date: card.date }, copy },
      { headers: HEADERS },
    );
  } catch (error) {
    return said(error instanceof AnySiteRefusal ? 403 : 502, error instanceof AnySiteRefusal ? error.message : 'THE SOURCE DID NOT ANSWER');
  }
}
