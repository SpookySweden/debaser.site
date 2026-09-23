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
    href: '/',
    summary: 'The landing page: what the archive is, and the projects filed in it.',
  },
  {
    id: 'project',
    label: 'DEBASER PROJECT',
    href: '/projects/debaser',
    summary: 'The project page, where the four shelves below are gathered.',
  },
  {
    id: 'concepts',
    label: 'CONCEPT ARCHIVE',
    href: '/concepts',
    summary: 'The hand-drawn sheets, each in its own window with its own thread.',
  },
  {
    id: 'lore',
    label: 'LORE PAGES',
    href: '/lore',
    summary: 'The world written down: pages any account can add to, merged as they are typed.',
  },
  {
    id: 'music',
    label: 'MUSIC',
    href: '/music',
    summary: 'The score and the rough mixes, played from the track list.',
  },
  {
    id: 'notes',
    label: 'NOTES',
    href: '/notes',
    summary: 'How the archive is built, and the rules it keeps.',
  },
  {
    id: 'forum',
    label: 'MESSAGE BOARD',
    href: '/forum',
    summary: 'Every thread: what was posted straight onto the board, and what the items collected.',
  },
  {
    id: 'users',
    label: 'USER DIRECTORY',
    href: '/users',
    summary: 'Every account on the site, with the lamp that says who is around.',
  },
  {
    id: 'comms',
    label: 'COMMS',
    href: '/comms',
    summary: 'Direct messages between accounts.',
  },
  {
    id: 'account',
    label: 'ACCOUNT',
    href: '/account',
    summary: 'Sign in, edit the account, and shape the public profile visitors see.',
  },
];

/** Everywhere else. Filed by hand; the page says so while this is empty. */
export const OUTBOUND_LINKS: ArchiveLink[] = [];
