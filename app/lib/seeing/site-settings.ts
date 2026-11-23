/** What is remembered for one site in this browser (SPEC-seeing-machine.md): that its scripts are off (`[ SCRIPTS OFF ]`). */

const STORAGE_KEY = 'debaser-seeing-scripts-off-v1';
const SITES_MOST = 500;

const listeners = new Set<() => void>();
let held: readonly string[] | null = null;

function sites(): readonly string[] {
  if (held !== null) return held;
  held = [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (Array.isArray(value)) held = value.filter((each): each is string => typeof each === 'string').slice(0, SITES_MOST);
  } catch {
    // No storage, or nothing readable in it: scripts are on.
  }
  return held;
}

function siteIn(address: string): string | null {
  try {
    return new URL(address).hostname;
  } catch {
    return null;
  }
}

export function scriptsOff(address: string): boolean {
  const site = siteIn(address);
  return site !== null && sites().includes(site);
}

export function setScriptsOff(address: string, off: boolean): void {
  const site = siteIn(address);
  if (site === null) return;
  const rest = sites().filter((each) => each !== site);
  held = off ? [...rest, site].slice(-SITES_MOST) : rest;
  for (const listener of listeners) listener();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(held));
  } catch {
    // It lasts as long as the page.
  }
}

export function subscribeToSiteSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const siteSettings = (): readonly string[] => sites();
const NONE: readonly string[] = [];
export const siteSettingsOnServer = (): readonly string[] => NONE;
