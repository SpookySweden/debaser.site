/**
 * Where your own Riot ID is kept (SPEC-leaguebot.md, Luke's 3B): on your account, private (`user_league`, owner only by Row
 * Level Security), or, signed out, in this browser alone. The mock site keeps it in this browser too.
 *
 * `NEXT_PUBLIC_LEAGUEBOT_DATA_SOURCE=supabase|mock`; unset, it follows the profiles switch, as HISTORY does. The same switch
 * makes the window read recorded answers instead of the live sources (`./client.ts`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '../supabase/client';
import { regionById, type RegionId } from './regions';
import { riotIdFrom } from './riot-id';

export type SavedRiotId = { name: string; tag: string; region: RegionId };

export type RiotIdStore = {
  load(): Promise<SavedRiotId | null>;
  save(saved: SavedRiotId): Promise<boolean>;
  forget(): Promise<boolean>;
};

function readSource(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

const REQUESTED = readSource(process.env.NEXT_PUBLIC_LEAGUEBOT_DATA_SOURCE) ?? readSource(process.env.NEXT_PUBLIC_PROFILE_DATA_SOURCE);
export const LEAGUEBOT_DATA_SOURCE: 'mock' | 'supabase' = REQUESTED === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

/** A stored value read back through one door: anything that isn't a whole, valid Riot ID and server is nothing. */
export function parseSaved(value: unknown): SavedRiotId | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, tag, region } = value as Record<string, unknown>;
  const id = riotIdFrom(name, tag);
  const where = regionById(region);
  return id && where ? { name: id.name, tag: id.tag, region: where.id } : null;
}

export function createBrowserRiotIdStore(key: string): RiotIdStore {
  return {
    async load() {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? null : parseSaved(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    async save(saved) {
      const clean = parseSaved(saved);
      if (clean === null) return false;
      try {
        window.localStorage.setItem(key, JSON.stringify(clean));
        return true;
      } catch {
        return false;
      }
    },
    async forget() {
      try {
        window.localStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function me(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  return user && !user.is_anonymous ? user.id : null;
}

/** On the account (`user_league`, 20261117060000_user_league.sql). The database refuses anyone but the owner. */
export function createSupabaseRiotIdStore(client: SupabaseClient): RiotIdStore {
  return {
    async load() {
      const person = await me(client);
      if (person === null) return null;
      const { data, error } = await client.from('user_league').select('riot_name, riot_tag, region').eq('person', person).maybeSingle();
      if (error || !data) return null;
      return parseSaved({ name: data.riot_name, tag: data.riot_tag, region: data.region });
    },
    async save(saved) {
      const clean = parseSaved(saved);
      const person = await me(client);
      if (clean === null || person === null) return false;
      const { error } = await client
        .from('user_league')
        .upsert({ person, riot_name: clean.name, riot_tag: clean.tag, region: clean.region, saved_at: new Date().toISOString() });
      return !error;
    },
    async forget() {
      const person = await me(client);
      if (person === null) return false;
      const { error } = await client.from('user_league').delete().eq('person', person);
      return !error;
    },
  };
}

const MOCK_KEY = 'debaser.leaguebot.mock.v1';
const VISITOR_KEY = 'debaser.leaguebot.browser.v1';

let account: RiotIdStore | null = null;
let browser: RiotIdStore | null = null;
let mock: RiotIdStore | null = null;

/** The account's for a signed-in person on the real site; this browser's for anybody else, or the mock site. */
export function riotIdStore(signedIn: boolean): RiotIdStore {
  if (LEAGUEBOT_DATA_SOURCE === 'mock') return (mock ??= createBrowserRiotIdStore(MOCK_KEY));
  const client = getSupabaseBrowserClient();
  if (signedIn && client !== null) return (account ??= createSupabaseRiotIdStore(client));
  return (browser ??= createBrowserRiotIdStore(VISITOR_KEY));
}

/** True when your Riot ID is kept in this browser only (the window says so). */
export function riotIdInBrowser(signedIn: boolean): boolean {
  return LEAGUEBOT_DATA_SOURCE === 'mock' || !signedIn;
}
