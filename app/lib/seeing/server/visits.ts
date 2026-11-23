/**
 * The visit record (SPEC-seeing-machine.md, D3): account, site name and time, never the page or its address; read by Luke only. SERVER ONLY.
 *
 * Its table, `browse_log`, is a database change that waits for Luke's OK, so nothing is written yet: the log says it could not write, and
 * the server's eye opens nothing for anybody but the owner, whose own pages are not recorded.
 */
export type VisitLog = {
  /** False when it could not be written, and then the page is not fetched. */
  write(person: string, site: string): Promise<boolean>;
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

export const visitLog: VisitLog = { write: async () => false };
