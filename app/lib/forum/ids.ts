/**
 * Ids for rows created in the browser by the mock repository.
 * Supabase will hand out uuid primary keys once the tables exist, so this
 * helper stays mock-only.
 */
export function createLocalId(prefix: string): string {
  const globalCrypto = globalThis.crypto;

  if (typeof globalCrypto !== 'undefined' && typeof globalCrypto.randomUUID === 'function') {
    return `${prefix}-${globalCrypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
