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

function say(message: unknown, to = talkingTo): Promise<unknown> {
  return new Promise((done) => {
    const own = runtime();
    if (own?.sendMessage === undefined) {
      done(null);
      return;
    }
    const timer = window.setTimeout(() => done(null), 1500);
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

/** Whether the site of this page is on its list, and that site's name as it counts sites; null when it doesn't say. */
export async function ownEyeHas(address: string): Promise<{ on: boolean; site: string } | null> {
  const answer = await say({ see: 'has', address });
  const on = field(answer, 'on');
  const site = field(answer, 'site');
  return typeof on === 'boolean' && typeof site === 'string' && /^[a-z0-9.-]{1,253}$/.test(site) ? { on, site } : null;
}

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
export function holdOwnEye(onAt: (href: string, title: string) => void): OwnEyeHold {
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
