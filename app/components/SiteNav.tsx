'use client';

import Link from 'next/link';
import {
  ICON_ACCOUNT,
  ICON_ARCADE,
  ICON_COMMS,
  ICON_FORUM,
  ICON_HOME,
  ICON_MUSIC,
  ICON_USERS,
} from '../lib/ui/icons';
import { useComms } from './CommsProvider';

/**
 * The window's keys, and the mark each one wears.
 *
 * CONCEPTS is not one of them: it is a shelf of the debaser project, and the project page listed on
 * the home page is what opens it. Pages under a project (or otherwise off the taskbar) pass no
 * `active` key, which leaves every key unlit rather than lighting one that does not own the page.
 */
export type NavKey = 'home' | 'forum' | 'games' | 'music' | 'users' | 'comms' | 'account';

/**
 * A key: a glyph, and the word a screen reader reads it as.
 *
 * A key carries both because they are for different readers. The glyph is what the eye is given - a
 * run of words at 11px is a paragraph, and a paragraph is not something you press. The `label` is
 * what is *said*, and it is never the glyph's Unicode name: `♪` read aloud is "eighth note", which
 * says nothing about an archive.
 */
export type NavItem = {
  key: NavKey;
  /** The word: the `aria-label`, the tooltip, and the legend. */
  label: string;
  /** The character the key is drawn with (see app/lib/ui/icons.ts). */
  mark: string;
  href: string;
};

/**
 * The keys the window carries, in the order the header draws them.
 *
 * Exported because the Start menu offers the same list on a wide screen (see ./StartMenu.tsx) and the
 * account menu offers the same list on a phone: one list, so a key added here is reachable everywhere
 * without anybody remembering to write it down twice. The project's own shelves are the other list
 * the menu draws from, and that one lives with the project (app/lib/projects/debaser.ts).
 *
 * HOME is the debaser project rather than `/`, and that is not a shortcut: `/` hands the visitor to
 * the board (app/page.tsx), so a HOME pointing there would be a key that goes where FORUM already
 * goes. What "home" means on this site is the project page - the comic, its music, its notes and its
 * links - which is the one page that explains what the archive is *for*. The board is the front door;
 * this is the address.
 *
 * ARCADE is the only window key left here, because the archive is not a key on this band at all any
 * more: `♪` lives in the side panel, beside the player it controls and the account that owns it
 * (`SIDE_MUSIC` below). It is still routeable exactly as it was - `/forum?music=1` is the same
 * address, and the Start menu, a post's plate and a track's tag badge all still open it - so nothing
 * that pointed at the archive had to be rewritten; only the band stopped showing it.
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'HOME :: THE DEBASER PROJECT', mark: ICON_HOME, href: '/projects/debaser' },
  { key: 'forum', label: 'FORUM', mark: ICON_FORUM, href: '/forum' },
  { key: 'games', label: 'ARCADE', mark: ICON_ARCADE, href: '/forum?arcade=1' },
  { key: 'users', label: 'USERS', mark: ICON_USERS, href: '/users' },
  { key: 'comms', label: 'COMMS', mark: ICON_COMMS, href: '/comms' },
  { key: 'account', label: 'ACCOUNT', mark: ICON_ACCOUNT, href: '/account' },
];

/**
 * The archive, as the side panel's own key.
 *
 * It is not part of `NAV_ITEMS` because the panel is not a row of page keys: the five above are
 * places you *go*, and this one opens a window over wherever you already are. Keeping it out of the
 * list is what stops the header band drawing it again - the two draw from different lists now, and
 * neither can reintroduce the other's key by accident.
 *
 * The address is the same one every other route to the archive uses (`/forum?music=1`), so the Start
 * menu's shelf, a post's `♪ MP3` plate and a track's tag badge all still land in the same window.
 */
export const SIDE_MUSIC: NavItem = {
  key: 'music',
  label: 'MUSIC',
  mark: ICON_MUSIC,
  href: '/forum?music=1',
};

/**
 * A key: raised while its page is closed, pressed in while it is the one on screen.
 *
 * The glyph is the label and the word is the tooltip, which is the trade the marks in
 * `lib/ui/icons.ts` are for. A key is a square rather than a pill so a row of seven of them reads as
 * a row of switches - and so the two that open a *window* over the board rather than a page of their
 * own can sit in the same row without lying about what they do, which the title attribute and the
 * aria-label are what make honest.
 */
function tabClass(isActive: boolean): string {
  const base = 'inline-flex h-7 min-w-7 items-center justify-center text-[13px] font-bold leading-none';

  return isActive
    ? `${base} border-t-2 border-l-2 border-black border-r border-b border-white bg-ena text-sun`
    : `${base} border-t border-l border-white border-r-2 border-b-2 border-black bg-sun text-ink hover:animate-bump hover:bg-ena hover:text-sun active:border-t-2 active:border-l-2 active:border-black active:border-r active:border-b active:border-white active:bg-bubble active:text-ink`;
}

/**
 * The window's keys: one per part of the site, with the open page's pressed in.
 *
 * They are the header of the window - the first thing under the title bar - rather than buttons in
 * the taskbar at its foot, because a key is where you are and the taskbar is what you can open. A
 * phone does not get them at all: the band is `hidden sm:flex`, and every one of these destinations
 * is behind the profile picture in the title bar instead (see ./ProfileControl.tsx). That is the
 * whole mobile rule in one line - the feed keeps the screen, and the one control that remains is the
 * reader's own face.
 *
 * Client-side because the comms key carries the unread count - the one number on the site that has to
 * move without a reload, and the same count the notification window clears when a message is put on
 * screen. `active` is left out by pages that are not one of the keys, so nothing lights up on them.
 */
export default function SiteNav({ active }: { active?: NavKey }) {
  const { unreadTotal } = useComms();

  return (
    <nav
      aria-label="Site keys"
      className="hidden min-w-0 flex-wrap items-center gap-1 border-b-2 border-ink bg-sun-pale px-2 py-[3px] sm:flex"
    >
      {NAV_ITEMS.map((item) => {
        const unread = item.key === 'comms' ? unreadTotal : 0;

        return (
          <Link
            key={item.key}
            href={item.href}
            // The word the key is read with. The glyph itself is decorative once this is on, which is
            // why `aria-hidden` marks it below rather than the whole link being labelled twice.
            aria-label={unread === 0 ? item.label : `${item.label}, ${unread} unread`}
            title={unread === 0 ? item.label : `${item.label} (${unread} unread)`}
            aria-current={item.key === active ? 'page' : undefined}
            className={tabClass(item.key === active)}
          >
            <span aria-hidden="true">{item.mark}</span>
            {/* The count rides the key, and only ever on the one it belongs to. It is drawn on top of
                the glyph rather than beside it, so the row's boxes stay square. */}
            {unread === 0 ? null : (
              <span
                aria-hidden="true"
                className="ml-[2px] text-[9px] leading-none text-acid"
              >
                {unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}


