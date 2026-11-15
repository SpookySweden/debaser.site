import { USING_MOCK_AUTH } from '../auth/auth-repository';
import { getSupabaseBrowserClient } from '../supabase/client';
import { BACKDROPS, backdropState, setBackdrop, subscribeToBackdrop, type BackdropId } from '../ui/backdrop-slot';
import { createWindowSlot } from '../ui/window-slot';
import { DEFAULT_SETTINGS, parseAquariumSettings, sameSettings, type AquariumSettings } from './settings';

/**
 * The AQUARIUM's settings as the site holds them (SPEC-aquarium-settings.md): a store outside React, the MODULOS arrangement
 * (`../ui/modules-slot.ts`). This browser's copy draws the sea at once and is all a signed-out visitor has; a signed-in person's
 * settings are saved to their account as well, in `user_aquarium`, which only they can read or write, so the sea follows them
 * between machines. The account's copy carries the BACKGROUND choice too (AQUARIUM or TILE); in the browser that stays under
 * its own key (`../ui/backdrop-slot.ts`), which the boot script reads before the first paint.
 *
 * Saving to accounts is switched on by `NEXT_PUBLIC_AQUARIUM_DATA_SOURCE=supabase` (the table is a database change, so it
 * waits for Luke's OK; until the switch is set, a signed-in person's settings are kept in their browser like a visitor's and
 * nothing asks the database). Under mock sign-in the "account" is this browser's storage, one entry a person.
 */

/** What an account holds: the settings, and which background is on. */
export type SavedAquarium = { settings: AquariumSettings; backdrop: BackdropId };

export type AquariumStore = {
  /** Null when this account has saved nothing yet. */
  read(person: string): Promise<SavedAquarium | null>;
  save(person: string, saved: SavedAquarium): Promise<void>;
};

/** An account's stored value, read back through the same checks as everything else. */
export function parseSavedAquarium(raw: unknown): SavedAquarium {
  const held = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const backdrop = BACKDROPS.find((option) => option.id === held.backdrop)?.id ?? backdropState().id;
  return { settings: parseAquariumSettings(raw), backdrop };
}

const MOCK_KEY = 'debaser.aquarium.mock.v1';

function readMock(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(MOCK_KEY);
    const parsed = raw === null ? {} : (JSON.parse(raw) as unknown);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const MOCK_STORE: AquariumStore = {
  read: async (person) => {
    const held = readMock()[person];
    return held === undefined ? null : parseSavedAquarium(held);
  },
  save: async (person, saved) => {
    window.localStorage.setItem(MOCK_KEY, JSON.stringify({ ...readMock(), [person]: { ...saved.settings, backdrop: saved.backdrop } }));
  },
};

const SUPABASE_STORE: AquariumStore = {
  read: async (person) => {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('No database.');
    const { data, error } = await client.from('user_aquarium').select('settings').eq('person', person).maybeSingle();
    if (error) throw new Error('Your aquarium could not be read.');
    return data === null ? null : parseSavedAquarium((data as { settings: unknown }).settings);
  },
  save: async (person, saved) => {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('No database.');
    const { error } = await client.from('user_aquarium').upsert({ person, settings: { ...saved.settings, backdrop: saved.backdrop } });
    if (error) throw new Error('Your aquarium could not be saved.');
  },
};

/** Where accounts' settings are kept; null while accounts aren't being saved to (see the note at the top). */
function store(): AquariumStore | null {
  if (USING_MOCK_AUTH) return MOCK_STORE;
  return process.env.NEXT_PUBLIC_AQUARIUM_DATA_SOURCE === 'supabase' ? SUPABASE_STORE : null;
}

const STORAGE_KEY = 'debaser.site.aquarium.v1';
/** Whose account this browser's copy last came from or went to; absent while it is only ever a visitor's. */
const OWNER_KEY = 'debaser.site.aquarium.owner.v1';

function browserOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function setBrowserOwner(person: string): void {
  try {
    window.localStorage.setItem(OWNER_KEY, person);
  } catch {
    // Without storage there is no copy to mix up either.
  }
}

function readBrowser(): AquariumSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? DEFAULT_SETTINGS : parseAquariumSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeBrowser(settings: AquariumSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private windows and full storage: the sea still follows for this visit.
  }
}

const settingsSlot = createWindowSlot<AquariumSettings>(readBrowser());
const failedSlot = createWindowSlot<boolean>(false);

export const aquariumSettings = settingsSlot.state;
export const subscribeToAquariumSettings = settingsSlot.subscribe;
/** What the sea is drawn with where the browser's copy can't be read (the server, a check). */
export const serverAquariumSettings = (): AquariumSettings => DEFAULT_SETTINGS;

export const aquariumSaveFailed = failedSlot.state;
export const subscribeToAquariumSaveFailed = failedSlot.subscribe;
export const serverAquariumSaveFailed = (): boolean => false;

let account: string | null = null;
/** Bumped by every change, so an answer that was already on its way can't overwrite what somebody has just set. */
let changes = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Set while the account's own copy is being put on, so that doing so isn't taken for a change to save back. */
let applying = false;

/** How long after the last change the account is written: a slider drag is one save, not one a pixel. */
const SAVE_AFTER_MS = 700;

function saveNow(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  const keeper = store();
  if (account === null || keeper === null) return;
  keeper
    .save(account, { settings: settingsSlot.state(), backdrop: backdropState().id })
    .then(() => failedSlot.set(false))
    .catch(() => failedSlot.set(true));
}

function saveSoon(): void {
  if (account === null || store() === null) return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_AFTER_MS);
}

/** Anything still waiting to be saved goes now: the window closing, the tab being put away. */
export function flushAquariumSave(): void {
  if (saveTimer !== null) saveNow();
}

/**
 * Who is signed in, from the AQUARIUM window's host. Their account's settings and background replace the browser's; an account
 * with none takes the browser's, if the browser has anything worth keeping.
 */
export async function setAquariumAccount(person: string | null): Promise<void> {
  if (person === account) return;
  flushAquariumSave();
  account = person;
  if (failedSlot.state()) failedSlot.set(false);
  const keeper = store();
  if (person === null || keeper === null) return;
  const before = changes;
  try {
    const saved = await keeper.read(person);
    // Somebody who changed a knob while the account was being read keeps what they just set: it is saved over the account's copy.
    if (account !== person || changes !== before) return;
    const owner = browserOwner();
    setBrowserOwner(person);
    if (saved === null && owner !== null && owner !== person) {
      // A second person on this browser, with nothing saved: they start on the default sea, not on the last person's.
      applying = true;
      try {
        if (!sameSettings(DEFAULT_SETTINGS, settingsSlot.state())) settingsSlot.set(DEFAULT_SETTINGS);
        writeBrowser(DEFAULT_SETTINGS);
        setBackdrop('aquarium');
      } finally {
        applying = false;
      }
      return;
    }
    if (saved !== null) {
      applying = true;
      try {
        if (!sameSettings(saved.settings, settingsSlot.state())) settingsSlot.set(saved.settings);
        writeBrowser(saved.settings);
        setBackdrop(saved.backdrop);
      } finally {
        applying = false;
      }
      return;
    }
    if (!sameSettings(settingsSlot.state(), DEFAULT_SETTINGS) || backdropState().id !== 'aquarium') {
      await keeper.save(person, { settings: settingsSlot.state(), backdrop: backdropState().id });
    }
  } catch {
    // The sea keeps the browser's copy; changing something tries the account again and says if it fails.
  }
}

export function setAquariumSettings(next: AquariumSettings): void {
  if (sameSettings(next, settingsSlot.state())) return;
  changes += 1;
  settingsSlot.set(next);
  writeBrowser(next);
  saveSoon();
}

// The BACKGROUND choice rides in the account's copy: pressing AQUARIUM or TILE is a change to save like any other.
if (typeof window !== 'undefined') {
  subscribeToBackdrop(() => {
    if (applying) return;
    changes += 1;
    saveSoon();
  });
  // A tab being put away may never get to its timer. (Best effort: a browser may drop a request made this late, and then the
  // account keeps what it had a moment before. This browser's own copy is always written first.)
  window.addEventListener('pagehide', flushAquariumSave);
}

/* ------------------------------------------------------------------ the window, and GIANT MODE */

/** `dock` is the window's own id in the layout (`DockWindow`'s `id`): the undo arrows read it, to close the right window when this one was opened from PREFERENCES. */
export type AquariumWindowState = { open: boolean; seeThrough: boolean; dock: 'aquarium' };

const windowSlot = createWindowSlot<AquariumWindowState>({ open: false, seeThrough: false, dock: 'aquarium' });

export const aquariumWindowState = windowSlot.state;
export const subscribeToAquariumWindow = windowSlot.subscribe;

export function openAquariumWindow(): void {
  if (!windowSlot.state().open) windowSlot.set({ ...windowSlot.state(), open: true });
}

export function closeAquariumWindow(): void {
  if (windowSlot.state().open) windowSlot.set({ ...windowSlot.state(), open: false });
  flushAquariumSave();
}

export function toggleAquariumWindow(): void {
  if (windowSlot.state().open) closeAquariumWindow();
  else openAquariumWindow();
}

/** The `[ 50% ]` key: the window itself half see-through, so the sea shows through it. */
export function toggleAquariumSeeThrough(): void {
  windowSlot.set({ ...windowSlot.state(), seeThrough: !windowSlot.state().seeThrough });
}

/** How long GIANT MODE lasts. */
export const GIANT_MS = 20_000;

const giantSlot = createWindowSlot<boolean>(false);
let giantTimer: ReturnType<typeof setTimeout> | null = null;

export const aquariumGiant = giantSlot.state;
export const subscribeToAquariumGiant = giantSlot.subscribe;
export const serverAquariumGiant = (): boolean => false;

/** GIANT MODE: on for twenty seconds, or off again at a second press. Never saved. */
export function toggleGiant(): void {
  if (giantTimer !== null) clearTimeout(giantTimer);
  giantTimer = null;
  if (giantSlot.state()) {
    giantSlot.set(false);
    return;
  }
  giantSlot.set(true);
  giantTimer = setTimeout(() => {
    giantTimer = null;
    giantSlot.set(false);
  }, GIANT_MS);
}
