/** The recommendations page, opened on one recommendation (a notification's link, a forum thread's link). */
export function recommendationHref(id: string): string {
  return `/recommendations?open=${encodeURIComponent(id)}`;
}

/** The recommendation an address asks for, or null. */
export function recommendationIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('open');
  return id !== null && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}

/** A public recommendation's forum thread hangs off this anchor, one thread per recommendation (as streams do). */
export function recommendationAnchor(id: string): { kind: 'board'; id: string; label: string } {
  return { kind: 'board', id: `recommendation:${id}`, label: 'RECOMMENDATION' };
}
