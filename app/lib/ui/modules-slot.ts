import { USING_MOCK_AUTH } from '../auth/auth-repository';
import { getSupabaseBrowserClient } from '../supabase/client';
import { NO_CHOICES, parseModuleChoices, type ModuleChoices } from './modules';
import { createWindowSlot } from './window-slot';

/**
 * Whose modules are on, for the bar and the MODULES window (`modules.ts`). A browser's copy draws the bar at once and is all a signed-out visitor has; a signed-in
 * person's choices are saved to their account as well, in `user_modules`, which only they can read or write, so they follow them between machines.
 */

export type ModulesStore = {
  /** Null when this account has saved nothing yet. */
  read(person: string): Promise<ModuleChoices | null>;
  save(person: string, choices: ModuleChoices): Promise<void>;
};

const mockAccounts = new Map<string, ModuleChoices>();
const MOCK_STORE: ModulesStore = {
  read: async (person) => mockAccounts.get(person) ?? null,
  save: async (person, choices) => {
    mockAccounts.set(person, choices);
  },
};

const SUPABASE_STORE: ModulesStore = {
  read: async (person) => {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('No database.');
    const { data, error } = await client.from('user_modules').select('choices').eq('person', person).maybeSingle();
    if (error) throw new Error('Your modules could not be read.');
    return data === null ? null : parseModuleChoices((data as { choices: unknown }).choices);
  },
  save: async (person, choices) => {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('No database.');
    const { error } = await client.from('user_modules').upsert({ person, choices });
    if (error) throw new Error('Your modules could not be saved.');
  },
};

const store = (): ModulesStore => (USING_MOCK_AUTH ? MOCK_STORE : SUPABASE_STORE);

const STORAGE_KEY = 'debaser-modules';

function readBrowser(): ModuleChoices {
  if (typeof window === 'undefined') return NO_CHOICES;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? NO_CHOICES : parseModuleChoices(JSON.parse(stored));
  } catch {
    return NO_CHOICES;
  }
}

function writeBrowser(choices: ModuleChoices): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choices));
  } catch {
    // Private windows and full storage: the bar still follows for this visit.
  }
}

const choicesSlot = createWindowSlot<ModuleChoices>(readBrowser());
const openSlot = createWindowSlot<boolean>(false);
const failedSlot = createWindowSlot<boolean>(false);

export const modulesState = choicesSlot.state;
export const subscribeToModules = choicesSlot.subscribe;
/** What a page is drawn with before the browser's copy can be read, so the server and the first draw agree. */
export const serverModules = (): ModuleChoices => NO_CHOICES;

export const modulesWindowOpen = openSlot.state;
export const subscribeToModulesWindow = openSlot.subscribe;
export const serverModulesWindowOpen = (): boolean => false;
export const toggleModulesWindow = (): void => openSlot.set(!openSlot.state());
export const closeModulesWindow = (): void => openSlot.set(false);

export const modulesSaveFailed = failedSlot.state;
export const subscribeToModulesSaveFailed = failedSlot.subscribe;
export const serverModulesSaveFailed = (): boolean => false;

let account: string | null = null;
/** Bumped by every change, so an answer that was already on its way can't overwrite what somebody has just pressed. */
let changes = 0;

/** Who is signed in, from the MODULES window. Their account's choices replace the browser's; an account with none takes the browser's. */
export async function setModulesAccount(person: string | null): Promise<void> {
  if (person === account) return;
  account = person;
  failedSlot.set(false);
  if (person === null) return;
  const before = changes;
  try {
    const saved = await store().read(person);
    if (account !== person || changes !== before) return;
    if (saved !== null) {
      choicesSlot.set(saved);
      writeBrowser(saved);
      return;
    }
    const held = choicesSlot.state();
    if (Object.keys(held.on).length > 0 || Object.keys(held.colours).length > 0) await store().save(person, held);
  } catch {
    // The bar keeps the browser's copy; pressing something tries the account again and says if it fails.
  }
}

export function setModuleChoices(choices: ModuleChoices): void {
  changes += 1;
  choicesSlot.set(choices);
  writeBrowser(choices);
  if (account === null) return;
  const person = account;
  store()
    .save(person, choices)
    .then(() => failedSlot.set(false))
    .catch(() => failedSlot.set(true));
}
