import { USING_MOCK_AUTH } from '../auth/auth-repository';
import { isSupabaseConfigured } from '../supabase/client';
import { getMockModerationStore } from './mock-moderation-repository';
import { getSupabaseModerationStore } from './supabase-moderation-repository';
import type { ModerationStore } from './types';

/**
 * Moderation follows the accounts: the mock accounts get the mock store (this browser's storage), real accounts the database.
 * Blocks, reports and moderators are about accounts, so a mock account against the real tables would be nobody.
 */
export const MODERATION_USES_MOCK = USING_MOCK_AUTH || !isSupabaseConfigured;

export function getModerationStore(): ModerationStore {
  return MODERATION_USES_MOCK ? getMockModerationStore() : getSupabaseModerationStore();
}
