'use client';

/**
 * OWN EYE from the site (SPEC-seeing-machine.md, D1): whether the DEBASER extension is in this browser, telling it the theme that is on, and
 * asking it to open a page. Nothing is asked of it but that, and it answers nothing about the reader.
 */
import { themeById, type ThemeTokens } from '../ui/themes';
import { CHROME_STORE_ID, EDGE_STORE_ID, isExtensionId, type ExtensionFrom } from './extension-ids';

/** From the `key` in extension/manifest.json; Temp/check-see-extension.cjs holds the two together. */
export const EXTENSION_ID = 'apbecjpegfcbbjjhjbcjojpfajjpokgn';

type Runtime = { sendMessage?: (id: string, message: unknown, answer?: (value: unknown) => void) => void; lastError?: unknown };
const runtime = (): Runtime | null => (globalThis as typeof globalThis & { chrome?: { runtime?: Runtime } }).chrome?.runtime ?? null;

/** Every copy the site may talk to: the zip's, and each store's once it has one (extension-ids.ts). */
const COPIES: { id: string; from: ExtensionFrom }[] = [
  { id: EXTENSION_ID, from: 'zip' as const },
  { id: CHROME_STORE_ID, from: 'chrome' as const },
  { id: EDGE_STORE_ID, from: 'edge' as const },
].filter((copy) => isExtensionId(copy.id));
/** The copy that answered last: a store's before the zip's when both are in. */
let talkingTo = EXTENSION_ID;

function say(message: unknown, to = talkingTo, wait = 1500): Promise<unknown> {
  return new Promise((done) => {
    const own = runtime();
    if (own?.sendMessage === undefined) {
      done(null);
      return;
    }
    const timer = window.setTimeout(() => done(null), wait);
    try {
      own.sendMessage(to, message, (value) => {
        // Read, so the browser doesn't log that nobody looked: an extension that isn't there is an answer.
        void own.lastError;
        window.clearTimeout(timer);
        done(value ?? null);
      });
    } catch {
      window.clearTimeout(timer);
      done(null);
    }
  });
}

const field = (answer: unknown, name: string): unknown => (typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>)[name] : undefined);

const versionOf = (answer: unknown): string | null => {
  const version = field(answer, 'version');
  return field(answer, 'see') === 'pong' && typeof version === 'string' && /^[\d.]{1,23}$/.test(version) ? version : null;
};

export type ExtensionFound = { version: string; from: ExtensionFrom; copies: number } | null;

/** Which copy is in (a store's first), its version, and how many copies answered; null when none is here: silence is an answer. */
export async function extensionFound(): Promise<ExtensionFound> {
  const answers = await Promise.all(COPIES.map(async (copy) => ({ ...copy, version: versionOf(await say({ see: 'ping' }, copy.id)) })));
  const here = answers.filter((copy) => copy.version !== null);
  const chosen = here.find((copy) => copy.from !== 'zip') ?? here[0];
  if (chosen === undefined || chosen.version === null) return null;
  talkingTo = chosen.id;
  return { version: chosen.version, from: chosen.from, copies: here.length };
}

/** Its version, or null when it isn't here. */
export const extensionVersion = async (): Promise<string | null> => (await extensionFound())?.version ?? null;

export const OWN_EYE_LENSES = [
  ['standard', 'STANDARD'],
  ['reader', 'READER'],
  ['xray', 'X-RAY'],
  ['lowfi', 'LOW-FI'],
  ['yours', 'YOUR THEME'],
] as const;
export type OwnEyeSettings = { lens: (typeof OWN_EYE_LENSES)[number][0]; wear: boolean };

/** Its settings, changed first when some are given; null from one that has none. */
export async function ownEyeSettings(change?: OwnEyeSettings): Promise<OwnEyeSettings | null> {
  const settings = field(await say({ see: 'settings', settings: change ?? null }), 'settings');
  const lens = OWN_EYE_LENSES.find(([id]) => id === field(settings, 'lens'))?.[0];
  const wear = field(settings, 'wear');
  return lens === undefined || typeof wear !== 'boolean' ? null : { lens, wear };
}

/**
 * Whether this page may be shown from the reader's own browser (`on`: its site was added by name, or EVERY SITE is on), whether its site is on
 * the list by name (`named`; null from a copy that doesn't say), and that site's name as the extension counts sites. Null when it doesn't say.
 */
export async function ownEyeHas(address: string): Promise<{ on: boolean; site: string; named: boolean | null } | null> {
  const answer = await say({ see: 'has', address });
  const on = field(answer, 'on');
  const site = field(answer, 'site');
  const named = field(answer, 'named');
  // Past the few sites an hour it answers for, with every site allowed, it says that alone (`every`) and nothing of the list: not by name, then.
  const unnamed = typeof named !== 'boolean' && field(answer, 'every') === true;
  return typeof on === 'boolean' && typeof site === 'string' && /^[a-z0-9.-]{1,253}$/.test(site) ? { on, site, named: typeof named === 'boolean' ? named : unnamed ? false : null } : null;
}

/**
 * OWN WEB for the pages OWN EYE shows (Luke, 2026-11-27: "Keep every page"). The switch is the extension's, in this browser, off until two presses
 * on its own SITES page: the site can read it and switch it OFF, never on. Null from a copy too old to have it, or none.
 */
export async function ownEyeKeep(off = false): Promise<boolean | null> {
  const answer = await say(off ? { see: 'keep', off: true } : { see: 'keep' });
  const on = field(answer, 'on');
  return field(answer, 'see') === 'keep' && typeof on === 'boolean' ? on : null;
}

export type OwnEyeWords = { href: string; title: string; description: string; language: string; paragraphs: { heading: boolean; words: string }[] };
const WORDS_MOST = 200_000;

/**
 * The words a reader can see on the page OWN EYE is showing in this tab, as the extension read them: never what is in a box, never anything not
 * drawn. Null when it gives none (its switch is off, the page moved on, a never-list page, an older copy). What comes back is a stranger's: only
 * strings of a known shape and size are taken.
 */
export async function ownEyeWords(address: string): Promise<OwnEyeWords | null> {
  const read = field(await say({ see: 'words', address }, talkingTo, 8000), 'words');
  const href = field(read, 'href');
  const paragraphs = field(read, 'paragraphs');
  if (typeof href !== 'string' || !/^https?:\/\//.test(href) || href.length > 4000 || !Array.isArray(paragraphs)) return null;
  const text = (value: unknown, most: number): string => (typeof value === 'string' ? value.slice(0, most) : '');
  let room = WORDS_MOST;
  const kept: OwnEyeWords['paragraphs'] = [];
  for (const each of paragraphs) {
    const words = text(field(each, 'words'), room);
    if (words === '') continue;
    kept.push({ heading: field(each, 'heading') === true, words });
    room -= words.length;
    if (room <= 0) break;
  }
  return { href, title: text(field(read, 'title'), 200), description: text(field(read, 'description'), 300), language: text(field(read, 'language'), 20), paragraphs: kept };
}

/**
 * Four of BROWSER's tools on a page OWN EYE shows (Luke, 2026-11-28: "MEDIA,SEARCH THIS,WATCHERS,ERASE"), done by the extension on the one frame
 * BROWSER made in this tab, each when its key is pressed. What comes back is a stranger's: only strings of a known shape and size are taken.
 */
const tool = async (name: 'media' | 'watchers' | 'selection' | 'erase', more: Record<string, unknown> = {}): Promise<unknown> => {
  const answer = await say({ see: 'tool', tool: name, ...more }, talkingTo, 5000);
  return field(answer, 'see') === 'tool' && field(answer, 'tool') === name ? field(answer, 'found') : null;
};
/** The videos and sounds the page names, by address and title; null when the extension gave none. */
export async function ownEyeMedia(): Promise<{ address: string; title: string }[] | null> {
  const found = await tool('media');
  if (!Array.isArray(found)) return null;
  return found.slice(0, 40).flatMap((each) => {
    const address = field(each, 'address');
    const title = field(each, 'title');
    return typeof address === 'string' && /^https?:\/\//.test(address) && address.length <= 2000 ? [{ address, title: typeof title === 'string' ? title.slice(0, 160) : '' }] : [];
  });
}
/** The outside hosts the page spoke to, most asked first, as its own browser counted them; null when the extension gave none. */
export async function ownEyeWatchers(): Promise<{ host: string; count: number }[] | null> {
  const found = await tool('watchers');
  if (!Array.isArray(found)) return null;
  return found.slice(0, 100).flatMap((each) => {
    const host = field(each, 'host');
    const count = field(each, 'count');
    return typeof host === 'string' && /^[a-z0-9.-]{1,253}$/i.test(host) && typeof count === 'number' && Number.isFinite(count) ? [{ host: host.toLowerCase(), count: Math.max(1, Math.round(count)) }] : [];
  });
}
/** The words selected on the page, as one line (never ones inside a box); '' when none are, null when the extension didn't say. */
export async function ownEyeSelection(): Promise<string | null> {
  const found = await tool('selection');
  return typeof found === 'string' ? found.slice(0, 200) : null;
}
/** ERASE on the page: what is taken out of it (BROWSER's own list for the site), and whether pressing a part takes it out now. */
export const ownEyeErase = async (on: boolean, erased: readonly string[]): Promise<boolean> => (await tool('erase', { on, erased: [...erased] })) === true;

/** Its own list of the sites it may act on, in its own page: the site is never told them. */
export const openOwnEyeSites = async (): Promise<void> => void (await say({ see: 'sites' }));
/** The version the site has, so its key in the browser's bar can say when an update is ready. */
export const newestToOwnEye = async (version: string): Promise<void> => void (await say({ see: 'newest', version }));
/** Whether it heard: its files have been written again, and it should read them. */
export const reloadOwnEye = async (): Promise<boolean> => field(await say({ see: 'reload' }), 'ok') === true;

/** The theme as the extension wears it: a few values, never a stylesheet. */
export function ownEyeTheme(tokens: ThemeTokens, scheme: 'light' | 'dark') {
  return { paper: tokens.paper, ink: tokens.ink, accent: tokens['accent-ink'], quiet: tokens['ink-quiet'], fault: tokens['bubble-pale'], faultInk: tokens['ink-bar'], sun: tokens.sun, scheme };
}

export async function tellOwnEyeTheme(themeId: string): Promise<void> {
  const theme = themeById(themeId);
  await say({ see: 'theme', theme: ownEyeTheme(theme.tokens, theme.scheme) });
}

/** The lenses the extension has, as BROWSER names them; the rest are the house's only. */
export const OWN_EYE_LENS: Record<string, 'standard' | 'reader' | 'xray' | 'lowfi' | 'yours'> = { standard: 'standard', reader: 'reader', xray: 'xray', lowfi: 'lowfi', dye: 'yours' };

/** `worn`: the extension wears it; `house`: a lens only the house has (the page is left plain); `unheard`: the extension isn't answering. */
export type OwnEyeWorn = 'worn' | 'house' | 'unheard';
export type OwnEyeHold = { lens: (id: string) => OwnEyeWorn; release: () => void };

type HeldPort = { onMessage: { addListener: (hear: (value: unknown) => void) => void }; onDisconnect: { addListener: (hear: () => void) => void }; postMessage: (message: unknown) => void; disconnect: () => void };
/** Held again after the extension's worker restarts or updates (it forgets every hold then), at most this often and this many times running. */
const HELD_AGAIN_MS = 1500;
const HELD_AGAIN_MOST = 5;

/** BROWSER's page, held open to the extension while it is drawn: an added site may then be framed in its tabs. What a framed page says is a stranger's. */
export function holdOwnEye(onAt: (href: string, title: string) => void, onErased: (href: string, selector: string) => void = () => undefined): OwnEyeHold {
  const own = (globalThis as typeof globalThis & { chrome?: { runtime?: { connect?: (id: string, info: { name: string }) => HeldPort } } }).chrome?.runtime;
  if (own?.connect === undefined) return { lens: () => 'unheard', release: () => undefined };
  const connect = own.connect;
  let port: HeldPort | null = null;
  let released = false;
  let tries = 0;
  let again: ReturnType<typeof setTimeout> | null = null;
  // What the extension was last asked to wear: asked again once it is held again.
  let wearing: string | null = null;
  const hold = () => {
    again = null;
    try {
      const held = connect(talkingTo, { name: 'browser' });
      held.onMessage.addListener((value) => {
        if (field(value, 'see') === 'ready') {
          tries = 0;
          if (wearing !== null) held.postMessage({ see: 'lens', lens: wearing });
          return;
        }
        const href = field(value, 'href');
        const title = field(value, 'title');
        // ERASE's press on the framed page: which part, of which page. The list is BROWSER's own (memory.ts reads the selector's shape again).
        const selector = field(value, 'selector');
        if (field(value, 'see') === 'erased' && typeof href === 'string' && /^https?:\/\//.test(href) && href.length <= 4000 && typeof selector === 'string' && selector.length <= 500) onErased(href, selector);
        if (field(value, 'see') === 'at' && typeof href === 'string' && /^https?:\/\//.test(href) && href.length <= 4000) onAt(href, typeof title === 'string' ? title.slice(0, 160) : '');
      });
      held.onDisconnect.addListener(() => {
        if (port === held) port = null;
        if (released || tries >= HELD_AGAIN_MOST) return;
        tries += 1;
        again = setTimeout(hold, HELD_AGAIN_MS);
      });
      port = held;
    } catch {
      port = null;
    }
  };
  hold();
  return {
    lens: (id) => {
      // A lens only the house has: the page goes back to plain, so the one worn before doesn't stay on under the notice.
      const theirs = OWN_EYE_LENS[id] ?? 'standard';
      wearing = theirs;
      if (port === null) return 'unheard';
      try {
        port.postMessage({ see: 'lens', lens: theirs });
      } catch {
        return 'unheard';
      }
      return OWN_EYE_LENS[id] === undefined ? 'house' : 'worn';
    },
    release: () => {
      released = true;
      if (again !== null) clearTimeout(again);
      port?.disconnect();
    },
  };
}

/** In an ordinary tab, signed in, the lenses beside it (the default); or in the machine's own page, its frame. */
export async function openInOwnEye(address: string, where: 'tab' | 'machine' = 'tab'): Promise<void> {
  await say({ see: 'open', address, in: where });
}
