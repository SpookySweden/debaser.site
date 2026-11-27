'use client';

/**
 * OWN EYE from the site (SPEC-seeing-machine.md, D1): whether the DEBASER extension is in this browser, telling it the theme that is on, and
 * asking it to open a page. Nothing is asked of it but that, and it answers nothing about the reader.
 */
import { themeById, type ThemeTokens } from '../ui/themes';

/** From the `key` in extension/manifest.json; Temp/check-see-extension.cjs holds the two together. */
export const EXTENSION_ID = 'apbecjpegfcbbjjhjbcjojpfajjpokgn';

type Runtime = { sendMessage?: (id: string, message: unknown, answer?: (value: unknown) => void) => void; lastError?: unknown };
const runtime = (): Runtime | null => (globalThis as typeof globalThis & { chrome?: { runtime?: Runtime } }).chrome?.runtime ?? null;

function say(message: unknown): Promise<unknown> {
  return new Promise((done) => {
    const own = runtime();
    if (own?.sendMessage === undefined) {
      done(null);
      return;
    }
    const timer = window.setTimeout(() => done(null), 1500);
    try {
      own.sendMessage(EXTENSION_ID, message, (value) => {
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

/** Its version, or null when it isn't here: silence is an answer. */
export async function extensionVersion(): Promise<string | null> {
  const answer = await say({ see: 'ping' });
  const version = field(answer, 'version');
  return field(answer, 'see') === 'pong' && typeof version === 'string' && /^[\d.]{1,23}$/.test(version) ? version : null;
}

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

/** In an ordinary tab, signed in, the lenses beside it (the default); or in the machine's own page, its frame. */
export async function openInOwnEye(address: string, where: 'tab' | 'machine' = 'tab'): Promise<void> {
  await say({ see: 'open', address, in: where });
}
