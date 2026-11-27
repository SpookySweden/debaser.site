/**
 * Which eye BROWSER opens a page with (Luke, 2026-11-23: "make own eye option default in the browser"): OWN EYE, your own browser, where you are
 * signed in, when the extension answers; the server's eye one press away, and the way when it doesn't. Remembered in this browser. And the
 * sites that offer a sign-in on entering ("for now only prompt on youtube"), and those the reader said not to ask about again.
 */
export type Eye = 'own' | 'server';

const EYE_KEY = 'debaser-seeing-eye-v1';
const NOT_AGAIN_KEY = 'debaser-seeing-not-again-v1:';
const listeners = new Set<() => void>();
let eye: Eye | null = null;
const said = (): void => {
  for (const listener of listeners) listener();
};
export function subscribeToEyeChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function eyeChoice(): Eye {
  if (eye === null) {
    eye = 'own';
    try {
      if (window.localStorage.getItem(EYE_KEY) === 'server') eye = 'server';
    } catch {
      // No storage: OWN EYE.
    }
  }
  return eye;
}
export const eyeChoiceOnServer = (): Eye => 'own';
export function chooseEye(next: Eye): void {
  eye = next;
  try {
    window.localStorage.setItem(EYE_KEY, next);
  } catch {
    // It lasts as long as the page.
  }
  said();
}

/** The sites that offer to sign in on entering, by their own name and every name under it. One list, for more later. */
export const SIGN_IN_OFFERED = ['youtube.com'] as const;
export function offerFor(address: string | null): (typeof SIGN_IN_OFFERED)[number] | null {
  if (address === null) return null;
  try {
    const host = new URL(address).hostname.toLowerCase().replace(/\.$/, '');
    return SIGN_IN_OFFERED.find((site) => host === site || host.endsWith(`.${site}`)) ?? null;
  } catch {
    return null;
  }
}

let notAgain: { owner: string; sites: readonly string[] } | null = null;
export function notAskedAgain(owner: string): readonly string[] {
  if (notAgain?.owner !== owner) {
    let sites: string[] = [];
    try {
      const value: unknown = JSON.parse(window.localStorage.getItem(NOT_AGAIN_KEY + owner) ?? '[]');
      if (Array.isArray(value)) sites = value.filter((each): each is string => typeof each === 'string' && (SIGN_IN_OFFERED as readonly string[]).includes(each));
    } catch {
      // Nothing readable: ask.
    }
    notAgain = { owner, sites };
  }
  return notAgain.sites;
}
export const notAskedAgainOnServer = (): readonly string[] => [];
export function dontAskAgain(owner: string, site: string): void {
  const sites = [...new Set([...notAskedAgain(owner), site])];
  notAgain = { owner, sites };
  try {
    window.localStorage.setItem(NOT_AGAIN_KEY + owner, JSON.stringify(sites));
  } catch {
    // It lasts as long as the page.
  }
  said();
}
