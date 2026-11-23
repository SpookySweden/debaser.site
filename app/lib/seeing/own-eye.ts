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

export async function ownEyeHere(): Promise<boolean> {
  const answer = await say({ see: 'ping' });
  return typeof answer === 'object' && answer !== null && (answer as { see?: unknown }).see === 'pong';
}

/** The theme as the extension wears it: a few values, never a stylesheet. */
export function ownEyeTheme(tokens: ThemeTokens, scheme: 'light' | 'dark') {
  return { paper: tokens.paper, ink: tokens.ink, accent: tokens['accent-ink'], quiet: tokens['ink-quiet'], fault: tokens['bubble-pale'], faultInk: tokens['ink-bar'], sun: tokens.sun, scheme };
}

export async function tellOwnEyeTheme(themeId: string): Promise<void> {
  const theme = themeById(themeId);
  await say({ see: 'theme', theme: ownEyeTheme(theme.tokens, theme.scheme) });
}

export async function openInOwnEye(address: string): Promise<void> {
  await say({ see: 'open', address });
}
