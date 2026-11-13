import { USING_MOCK_AUTH } from '../auth/auth-repository';
import { getSupabaseBrowserClient } from '../supabase/client';
import { createWindowSlot } from '../ui/window-slot';
import { DEFAULT_COMPANION, parseCompanionChoices, type CompanionChoices } from './choices';

/**
 * Your COMPANION choices (`choices.ts`), the way the MODULOS choices are kept (`../ui/modules-slot.ts`): this browser's
 * copy draws at once, and a signed-in person's choices are saved to their account as well, in `user_companion`, which
 * only they can read or write, so the switch follows them between machines.
 *
 * Until that table exists (it waits for Luke's OK), the account's read fails and the browser's copy is all there is:
 * nothing breaks, the choice just stays on this machine.
 */

export type CompanionStore = {
  /** Null when this account has saved nothing yet. */
  read(person: string): Promise<CompanionChoices | null>;
  save(person: string, choices: CompanionChoices): Promise<void>;
};

const mockAccounts = new Map<string, CompanionChoices>();
const MOCK_STORE: CompanionStore = {
  read: async (person) => mockAccounts.get(person) ?? null,
  save: async (person, choices) => {
    mockAccounts.set(person, choices);
  },
};

const SUPABASE_STORE: CompanionStore = {
  read: async (person) => {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('No database.');
    const { data, error } = await client.from('user_companion').select('choices').eq('person', person).maybeSingle();
    if (error) throw new Error('Your companion could not be read.');
    return data === null ? null : parseCompanionChoices((data as { choices: unknown }).choices);
  },
  save: async (person, choices) => {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('No database.');
    const { error } = await client.from('user_companion').upsert({ person, choices });
    if (error) throw new Error('Your companion could not be saved.');
  },
};

/**
 * Whether `user_companion` exists yet (supabase/pending/user_companion.sql, waiting for Luke's OK). Until it does, the
 * account is not asked at all, so no sign-in or press sends a request that can only fail: the browser's copy is the copy.
 */
const ACCOUNT_TABLE_LIVE = false;

const store = (): CompanionStore | null => (USING_MOCK_AUTH ? MOCK_STORE : ACCOUNT_TABLE_LIVE ? SUPABASE_STORE : null);

const STORAGE_KEY = 'debaser-companion';

function readBrowser(): CompanionChoices {
  if (typeof window === 'undefined') return DEFAULT_COMPANION;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? DEFAULT_COMPANION : parseCompanionChoices(JSON.parse(stored));
  } catch {
    return DEFAULT_COMPANION;
  }
}

function writeBrowser(choices: CompanionChoices): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choices));
  } catch {
    // Private windows and full storage: the switch still holds for this visit.
  }
}

const choicesSlot = createWindowSlot<CompanionChoices>(readBrowser());

export const companionChoicesState = choicesSlot.state;
export const subscribeToCompanionChoices = choicesSlot.subscribe;
/** What a page is drawn with before the browser's copy can be read, so the server and the first draw agree. */
export const serverCompanionChoices = (): CompanionChoices => DEFAULT_COMPANION;

let account: string | null = null;
/** Bumped by every change, so an answer already on its way can't overwrite what somebody has just pressed. */
let changes = 0;

/** Who is signed in. Their account's choices replace the browser's; an account with none takes the browser's. */
export async function setCompanionAccount(person: string | null): Promise<void> {
  if (person === account) return;
  account = person;
  const accountStore = store();
  if (person === null || accountStore === null) return;
  const before = changes;
  try {
    const saved = await accountStore.read(person);
    if (account !== person || changes !== before) return;
    if (saved !== null) {
      choicesSlot.set(saved);
      writeBrowser(saved);
      return;
    }
    const held = companionChoicesState();
    if (held !== DEFAULT_COMPANION) await accountStore.save(person, held);
  } catch {
    // The browser's copy stands (and, until `user_companion` exists, is the only copy).
  }
}

export function setCompanionChoices(choices: CompanionChoices): void {
  changes += 1;
  choicesSlot.set(choices);
  writeBrowser(choices);
  const accountStore = store();
  if (account === null || accountStore === null) return;
  void accountStore.save(account, choices).catch(() => undefined);
}
