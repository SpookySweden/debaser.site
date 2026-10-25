/**
 * The links shelf.
 *
 * Two lists, because they are not the same kind of thing:
 *
 *   ARCHIVE_LINKS  the site's own pages, so the shelf is a map of the archive
 *                  rather than a set of bookmarks - these are real and always
 *                  current, because they are the same hrefs the taskbar uses.
 *   OUTBOUND_LINKS everywhere else. Empty by default: an address is only worth
 *                  listing once somebody has decided it should be listed, so the
 *                  page says the shelf is waiting instead of guessing at URLs.
 *
 * Adding an outbound link: append an entry with a label, an href (full address,
 * https:// included) and a line saying what is there.
 */
export type ArchiveLink = {
  id: string;
  /** What the link reads as. */
  label: string;
  /** Where it goes: a path on this site, or a full address. */
  href: string;
  /** One line saying what is at the other end. */
  summary: string;
};

export const ARCHIVE_LINKS: ArchiveLink[] = [
  {
    id: 'home',
    label: 'HOME',
    // `/` hands the visitor to the board (app/page.tsx); HOME is the projects map, as on the header.
    href: '/projects',
    summary: 'The projects.',
  },
  {
    id: 'project',
    label: 'DEBASER PROJECT',
    href: '/projects/debaser',
    summary: 'Its five shelves, on one page.',
  },
  {
    id: 'concepts',
    label: 'CONCEPT ARCHIVE',
    href: '/concepts',
    summary: 'Hand-drawn sheets.',
  },
  {
    id: 'lore',
    label: 'LORE PAGES',
    href: '/lore',
    summary: 'The world, written down.',
  },
  {
    id: 'music',
    label: 'MUSIC',
    // The archive's address: the AUDIO tab of the media catalogue page, which took the shelf over
    // from the music window on 2026-10-24 (`app/lib/audio/music-window.ts`, MUSIC_HREF).
    href: '/media?kind=audio',
    summary: 'Score and rough mixes.',
  },
  {
    id: 'notes',
    label: 'NOTES',
    href: '/notes',
    summary: 'Working notes and house rules.',
  },
  {
    id: 'forum',
    label: 'MESSAGE BOARD',
    href: '/forum',
    summary: 'Every thread.',
  },
  {
    id: 'users',
    label: 'USER DIRECTORY',
    href: '/users',
    summary: 'Every account, and who is on.',
  },
  {
    id: 'comms',
    label: 'COMMS',
    href: '/comms',
    summary: 'Direct messages.',
  },
  {
    id: 'account',
    label: 'ACCOUNT',
    href: '/account',
    summary: 'Sign in, account, profile.',
  },
];

/** Everywhere else. Filed by hand; the page says so while this is empty. */
export const OUTBOUND_LINKS: ArchiveLink[] = [];
