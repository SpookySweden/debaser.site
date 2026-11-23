/**
 * The visit record (SPEC-seeing-machine.md, D3): account, site name and time, never the page or its address; read by Luke only. SERVER ONLY.
 *
 * It is written through one function of the database (`browse_log_write`), called with the reader's own session, which adds a row for whoever
 * calls it and nobody else: the site holds no key to the database. What can't be written is not looked at.
 */
export type VisitLog = {
  /** False when it could not be written, and then the page is not fetched. */
  write(person: string, site: string, token: string | null): Promise<boolean>;
};

export function createMemoryVisits(): VisitLog & { rows: { person: string; site: string; at: number }[] } {
  const rows: { person: string; site: string; at: number }[] = [];
  return {
    rows,
    async write(person, site) {
      rows.push({ person, site, at: Date.now() });
      return true;
    },
  };
}

const WITHIN_MS = 5000;

export function createDatabaseVisits(address: string, key: string, ask: typeof fetch = fetch): VisitLog {
  return {
    async write(_person, site, token) {
      if (token === null || address === '' || key === '') return false;
      try {
        const answer = await ask(`${address.replace(/\/$/, '')}/rest/v1/rpc/browse_log_write`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_site: site }),
          cache: 'no-store',
          signal: AbortSignal.timeout(WITHIN_MS),
        });
        return answer.ok;
      } catch {
        return false;
      }
    },
  };
}

export const visitLog: VisitLog = createDatabaseVisits(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '');
