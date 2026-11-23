/** TIME DIAL (idea vi): the Internet Archive's copy of a page nearest a year, through the same eye. Pure. */

export const DIAL_FIRST = 1996;

const ARCHIVED = /^https:\/\/web\.archive\.org\/web\/(\d{4})\d*(?:[a-z]{2}_)?\/(.+)$/;

/** The address itself and the year it is being seen at, or null for now. */
export function dialOf(address: string): { address: string; year: number | null } {
  const match = ARCHIVED.exec(address);
  if (match === null) return { address, year: null };
  // The Archive writes one slash where an address has two.
  const own = match[2].replace(/^(https?:)\/+/, '$1//');
  return { address: /^https?:\/\//.test(own) ? own : `http://${own}`, year: Number(match[1]) };
}

/** Where the dial leads: the middle of that year, without the Archive's own bar; null is now, the address itself. */
export function dialTo(address: string, year: number | null): string {
  const own = dialOf(address).address;
  return year === null ? own : `https://web.archive.org/web/${year}0701000000if_/${own}`;
}
