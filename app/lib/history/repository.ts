import { getSupabaseBrowserClient, isSupabaseConfigured } from '../supabase/client';
import { createBrowserPlays } from './browser-plays';
import { createSupabasePlays } from './supabase-plays';
import { BROWSER_MAX, type Play, type PlayNote } from './types';

/** Where HISTORY's lines are kept (SPEC-history.md). Both halves answer the same questions. */
export type PlaysRepository = {
  /** A play started: its line's id, or null when it was not kept (refused, offline). */
  note(note: PlayNote): Promise<string | null>;
  /** The play stopped: where it got to, once, for jumping back in. */
  stop(id: string, leftAtSeconds: number | null, lengthSeconds: number | null): Promise<void>;
  /** The newest `limit` lines, or the `limit` before `before` (a `playedAt`). */
  list(limit: number, before?: string): Promise<Play[]>;
  remove(id: string): Promise<boolean>;
  erase(): Promise<boolean>;
};

function readSource(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

/**
 * The account's table when `NEXT_PUBLIC_HISTORY_DATA_SOURCE=supabase`, or, with that unset, when profiles are on Supabase
 * (HISTORY lives on the account, as letters do); otherwise the mock site's copy in this browser.
 */
const REQUESTED = readSource(process.env.NEXT_PUBLIC_HISTORY_DATA_SOURCE) ?? readSource(process.env.NEXT_PUBLIC_PROFILE_DATA_SOURCE);
export const HISTORY_DATA_SOURCE: 'mock' | 'supabase' = REQUESTED === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

const MOCK_KEY = 'debaser.plays.mock.v1';
const VISITOR_KEY = 'debaser.plays.browser.v1';
/** The mock site stands in for an account: it keeps more than a visitor's browser does. */
const MOCK_MAX = 3000;

let account: PlaysRepository | null = null;
let browser: PlaysRepository | null = null;
let mock: PlaysRepository | null = null;

/** The account's log for a signed-in person on the real site; the browser's own for anybody else, or the mock site. */
export function playsRepository(signedIn: boolean): PlaysRepository {
  if (HISTORY_DATA_SOURCE === 'mock') return (mock ??= createBrowserPlays(MOCK_KEY, MOCK_MAX));
  const client = getSupabaseBrowserClient();
  if (signedIn && client !== null) return (account ??= createSupabasePlays(client));
  return (browser ??= createBrowserPlays(VISITOR_KEY, BROWSER_MAX));
}

/** True when the log is kept in this browser only (the window says so). */
export function keptInBrowser(signedIn: boolean): boolean {
  return HISTORY_DATA_SOURCE === 'supabase' && !signedIn;
}
