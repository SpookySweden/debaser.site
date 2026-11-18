import { USING_MOCK_AUTH } from '../auth/auth-repository';
import { getSupabaseBrowserClient } from '../supabase/client';
import { createWindowSlot } from '../ui/window-slot';
import { announceAccountSettings, onSettingChanged, SYNCED_NAMES, type SyncedName } from './settings-bus';
import {
  DEFAULT_MADE,
  parseAccountSettings,
  settingsForSaving,
  storageKeyOf,
  valuesAfterSignIn,
  type MadeKind,
  type MadeSwitches,
  type SyncedValues,
} from './settings-rules';

/**
 * Settings that follow the account (SPEC-forum-v3.md, F1B and F2A; the table is `user_settings`, Luke's typed OK
 * 2026-11-17: "Yes, create it"). The arrangement of `../ui/modules-slot.ts` with `user_modules`:
 *
 * - Signed out, the browser keeps its own choices, as it always did.
 * - On sign-in the account's row is read and its choices are written over the browser's (the account wins), then every
 *   setting is told to read its key again (`announceAccountSettings`). An account with no row yet starts from the
 *   browser's choices, which are saved to it, so nobody's first sign-in after this ships wipes their look.
 * - Signed in, each change is written to the browser at once (by the setting's own code) and to the account, gathered for
 *   a second so a run of presses is one save.
 *
 * Only the person themselves can read or change their row (owner-only Row Level Security on the table); nothing here is
 * trusted for that.
 */

export type SettingsRow = { settings: unknown; readMarks: unknown };

export type SettingsStore = {
  /** Null when this account has no row yet. */
  read(person: string): Promise<SettingsRow | null>;
  saveSettings(person: string, settings: object): Promise<void>;
  saveReadMarks(person: string, marks: Record<string, string>): Promise<void>;
};

/** The mock's "database": this browser's storage, like every other mock repository, so a drive can seed and read it. */
export const MOCK_SETTINGS_KEY = 'debaser.user-settings.mock.v1';

type MockRows = Record<string, { settings?: unknown; read_marks?: unknown }>;

function readMockRows(): MockRows {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MOCK_SETTINGS_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as MockRows) : {};
  } catch {
    return {};
  }
}

function writeMockRow(person: string, column: 'settings' | 'read_marks', value: unknown): void {
  const rows = readMockRows();
  rows[person] = { ...(rows[person] ?? {}), [column]: value };
  window.localStorage.setItem(MOCK_SETTINGS_KEY, JSON.stringify(rows));
}

const MOCK_STORE: SettingsStore = {
  read: async (person) => {
    const row = readMockRows()[person];
    return row === undefined ? null : { settings: row.settings ?? {}, readMarks: row.read_marks ?? {} };
  },
  saveSettings: async (person, settings) => writeMockRow(person, 'settings', settings),
  saveReadMarks: async (person, marks) => writeMockRow(person, 'read_marks', marks),
};

const SUPABASE_STORE: SettingsStore = {
  read: async (person) => {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('No database.');
    const { data, error } = await client.from('user_settings').select('settings, read_marks').eq('person', person).maybeSingle();
    if (error) throw new Error('Your settings could not be read.');
    if (data === null) return null;
    const row = data as { settings: unknown; read_marks: unknown };
    return { settings: row.settings, readMarks: row.read_marks };
  },
  // An upsert names only the column it changes, so saving settings never touches the read marks and back.
  saveSettings: async (person, settings) => {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('No database.');
    const { error } = await client.from('user_settings').upsert({ person, settings, updated_at: new Date().toISOString() });
    if (error) throw new Error('Your settings could not be saved.');
  },
  saveReadMarks: async (person, marks) => {
    const client = getSupabaseBrowserClient();
    if (client === null) throw new Error('No database.');
    const { error } = await client.from('user_settings').upsert({ person, read_marks: marks, updated_at: new Date().toISOString() });
    if (error) throw new Error('What you have read could not be saved.');
  },
};

const store = (): SettingsStore => (USING_MOCK_AUTH ? MOCK_STORE : SUPABASE_STORE);

/** How long changes are gathered before one save (F2A: "gathered for a second"). */
const SETTINGS_GATHER_MS = 1000;

function readBrowserValues(): SyncedValues {
  const values: SyncedValues = {};
  try {
    for (const name of SYNCED_NAMES) {
      const value = window.localStorage.getItem(storageKeyOf(name));
      if (value !== null) values[name] = value;
    }
  } catch {
    // No storage: nothing to gather.
  }
  return values;
}

function writeBrowserValues(values: SyncedValues): void {
  try {
    for (const name of SYNCED_NAMES) {
      const value = values[name];
      if (value !== undefined) window.localStorage.setItem(storageKeyOf(name), value);
    }
  } catch {
    // Storage blocked: the settings still apply from the account's copy where their code holds one.
  }
}

const madeSlot = createWindowSlot<MadeSwitches>(DEFAULT_MADE);
/** True once the signed-in account's row has been read (or found missing): until then nothing is saved over it. */
const loadedSlot = createWindowSlot<boolean>(false);

export const madeSwitches = madeSlot.state;
export const subscribeToMadeSwitches = madeSlot.subscribe;
export const serverMadeSwitches = (): MadeSwitches => DEFAULT_MADE;
export const accountSettingsLoaded = loadedSlot.state;
export const subscribeToAccountSettingsLoaded = loadedSlot.subscribe;
export const serverAccountSettingsLoaded = (): boolean => false;

let account: string | null = null;
let lastSaved = '';
let gatherTimer: ReturnType<typeof setTimeout> | null = null;
/** Settings the reader changed while the account was still being read: their press wins over the arriving row. */
const changedMeanwhile = new Set<SyncedName>();

function saveNow(): void {
  gatherTimer = null;
  const person = account;
  if (person === null || !loadedSlot.state()) return;
  const body = settingsForSaving({ keys: readBrowserValues(), made: madeSlot.state() });
  const text = JSON.stringify(body);
  if (text === lastSaved) return;
  lastSaved = text;
  store()
    .saveSettings(person, body)
    .catch(() => {
      // Kept in this browser; the next change tries the account again.
      if (lastSaved === text) lastSaved = '';
    });
}

function scheduleSave(): void {
  if (account === null || !loadedSlot.state()) return;
  if (gatherTimer !== null) clearTimeout(gatherTimer);
  gatherTimer = setTimeout(saveNow, SETTINGS_GATHER_MS);
}

if (typeof window !== 'undefined') {
  onSettingChanged((name) => {
    if (account === null) return;
    if (!loadedSlot.state()) {
      changedMeanwhile.add(name);
      return;
    }
    scheduleSave();
  });
}

/** Who is signed in, from `AccountSettingsKeeper` in `layout.tsx`. Null when nobody is: the browser keeps its own. */
export async function setSettingsAccount(person: string | null): Promise<void> {
  if (person === account) return;
  if (gatherTimer !== null) {
    clearTimeout(gatherTimer);
    saveNow();
  }
  account = person;
  lastSaved = '';
  changedMeanwhile.clear();
  loadedSlot.set(false);
  madeSlot.set(DEFAULT_MADE);
  if (person === null) return;

  let row: SettingsRow | null;
  try {
    row = await store().read(person);
  } catch {
    // The browser's choices stay, and nothing is saved over an account that could not be read this visit.
    return;
  }
  if (account !== person) return;

  if (row === null) {
    loadedSlot.set(true);
    saveNow();
    return;
  }

  const saved = parseAccountSettings(row.settings);
  writeBrowserValues(valuesAfterSignIn(saved.keys, readBrowserValues(), changedMeanwhile));
  madeSlot.set(saved.made);
  lastSaved = JSON.stringify(settingsForSaving(saved));
  loadedSlot.set(true);
  announceAccountSettings();
  // Anything changed meanwhile, or a setting the account had never saved, goes up with the next save.
  scheduleSave();
}

/** One POST WHAT I MAKE TO THE BOARD switch, from PRIVACY. Only once the account's row is read, so it never saves a guess. */
export function setMadeSwitch(kind: MadeKind, on: boolean): void {
  if (account === null || !loadedSlot.state()) return;
  madeSlot.set({ ...madeSlot.state(), [kind]: on });
  scheduleSave();
}
