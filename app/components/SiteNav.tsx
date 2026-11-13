'use client';

import Link from 'next/link';
import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { moduleBarColour, WipTag } from './ModulesWindow';
import SiteArrows from './SiteArrows';
import { MODULES, moduleInk, moduleIsOn } from '../lib/ui/modules';
import {
  modulesState,
  modulesWindowOpen,
  serverModules,
  serverModulesWindowOpen,
  subscribeToModules,
  subscribeToModulesWindow,
  toggleModulesWindow,
} from '../lib/ui/modules-slot';
import { subscribeToTheme, themeState } from '../lib/ui/theme-slot';
import {
  ICON_ACCOUNT,
  ICON_ARCADE,
  ICON_COMMS,
  ICON_CYTUBE,
  ICON_FORUM,
  ICON_HOME,
  ICON_LOOP,
  ICON_MEDIA,
  ICON_MUSIC,
  ICON_USERS,
  ICON_WEB,
} from '../lib/ui/icons';
import { QUEUES_HREF } from '../lib/audio/queue-window';
import { LIBRARY_HREF } from '../lib/audio/music-window';

/**
 * The window's keys, and the mark each one wears.
 *
 * CONCEPTS is not one of them: it is a shelf of the debaser project, and the project page listed on
 * the home page is what opens it. Pages under a project (or otherwise off the taskbar) pass no
 * `active` key, which leaves every key unlit rather than lighting one that does not own the page.
 */
export type NavKey = 'home' | 'forum' | 'media' | 'web' | 'read' | 'tagstation' | 'recommendations' | 'beatbox' | 'cytube' | 'animate' | 'games' | 'music' | 'queues' | 'users' | 'comms' | 'account';

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
 * HOME is the projects map rather than `/`, and that is not a shortcut: `/` hands the visitor to the
 * board (app/page.tsx), so a HOME pointing there would be a key that goes where FORUM already goes.
 * What "home" means on this site is the archive's own index - the projects it holds, each with the
 * page that gathers its parts. From there a reader chooses the debaser project and gets its shelves.
 *
 * It was `/projects/debaser` - the one project rather than the map - until the map existed. Pointing a
 * key called HOME past the index and into the only thing the index would have listed is a shortcut
 * that stops being one the moment a second project is filed: the key would keep going to the first.
 *
 * ARCADE and MUSIC are not keys on this band at all any more: `◄►` and `♪` live in the side panel,
 * where the account that owns them and the player one of them controls are (`SIDE_ARCADE` and
 * `SIDE_MUSIC` below). Both are still routeable exactly as they were - `/forum?arcade=1` and
 * `/forum?music=1` are the same addresses, and the Start menu, a post's plate, a track's tag badge
 * and the bell's invitation all still open them - so nothing that pointed at either window had to be
 * rewritten; only the band stopped showing them.
 *
 * That leaves this list as the places a reader *goes*, with no key that opens a window over where
 * they already are. The two are kept apart deliberately, and `Temp/check-surreal.cjs` holds the
 * separation: a band that grew a window key back would be a band that lies about what a key does.
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'HOME', mark: ICON_HOME, href: '/projects' },
  { key: 'forum', label: 'FORUM', mark: ICON_FORUM, href: '/forum' },
  // The catalogue, FILES since Luke gave its old name to the search page (2026-11-04), is a place a reader goes, not a
  // window (Luke, 2026-10-24, SPEC-media-catalogue.md):
  // every file the site holds, and where each is used. It took over the ARCHIVE screen of the shelf
  // window, which keeps the reader's own tracks and lists.
  { key: 'media', label: 'FILES', mark: ICON_MEDIA, href: '/files' },
  // One stream of media from other platforms, newest first (SPEC-web.md): a place a reader goes. Called WEB, then
  // ARCHIVE, until Luke renamed it MEDIA (2026-11-04); its key is still `web`.
  { key: 'web', label: 'MEDIA', mark: ICON_WEB, href: '/media' },
  // Watching and listening together (SPEC-cytube.md, Luke 2026-11-03): what streaming is, the live rooms, the
  // stream canvases, GO LIVE and your broadcast look. Named after CyTube (cytu.be) as a nod, Luke's choice.
  { key: 'cytube', label: 'STREAM', mark: ICON_CYTUBE, href: '/stream' },
  { key: 'users', label: 'USERS', mark: ICON_USERS, href: '/users' },
  { key: 'comms', label: 'COMMS', mark: ICON_COMMS, href: '/comms' },
  { key: 'account', label: 'ACCOUNT', mark: ICON_ACCOUNT, href: '/account' },
];

/**
 * The arcade, as the side panel's own key.
 *
 * It sits beside the archive's because the two are the same kind of thing: a window opened over
 * wherever the reader is standing, not a place they go. Keeping both out of `NAV_ITEMS` is what stops
 * the header band drawing them again - the band draws one list, the panel draws the other, and
 * neither can reintroduce the other's key by accident.
 *
 * The address is the arcade's own floor (`/forum?arcade=1`), the same one the Start menu row uses, so
 * a copied link or a middle-click still lands in the same window. An *invitation* and a *challenge*
 * are different addresses and are not this key's business (see lib/games/arcade-window.ts).
 */
export const SIDE_ARCADE: NavItem = {
  key: 'games',
  label: 'ARCADE',
  mark: ICON_ARCADE,
  href: '/forum?arcade=1',
};

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
  /**
   * The *personal* screen, not the archive, and that is the whole point of this key.
   *
   * The archive is where a reader goes to browse a shelf somebody else filled; the side panel is where
   * they keep their own things - the profile, the conversations, the directory of accounts - so its
   * music key opens the shelf *they* have a stake in. Everything that points at the archive from a
   * file - a post's `[ ♪ MP3 ]` plate, a track's tag badge, the Start menu's MUSIC shelf - keeps
   * `MUSIC_HREF` and still lands on the browser, because those are all "show me this file" rather than
   * "show me my music".
   */
  href: LIBRARY_HREF,
};

/**
 * The queue window's key: the things you can listen *along to*.
 *
 * A `NavItem` like the other two, so the three shelf keys in the panel are written the same way and the
 * Start menu and the account drawer can offer it without a second list. Its glyph is the loop, because
 * that is what the window is about - a place you go back to - and its `href` is the board carrying the
 * query, the way MUSIC's and the arcade's are.
 */
export const SIDE_QUEUES: NavItem = {
  key: 'queues',
  label: 'QUEUES',
  mark: ICON_LOOP,
  href: QUEUES_HREF,
};

/**
 * The header's own list is the modules (`app/lib/ui/modules.ts`, Luke 2026-11-06): named pages rather than glyphs, each person ticking which appear.
 *
 * Kept apart from `NAV_ITEMS` on purpose. The phone's picture menu, the side panel and the Start menu
 * still draw `NAV_ITEMS`, so COMMS and ACCOUNT stay reachable there even though the header dropped
 * them.
 *
 * MEDIA is the search page that was WEB, then ARCHIVE (Luke, 2026-11-04). The catalogue, which this key used to open,
 * is one of its servers now (DEBASER.SITE in a search) and left the band, so there is one MEDIA; the catalogue is
 * FILES in the Start menu and the phone's menu, and each of its search results links to it.
 *
 * No DIRECTORY key (Luke, 2026-11-03): the account list is the side panel's DIRECTORY, whose `[ ALL ]` opens /users.
 */

const WORD_KEY = 'inline-flex h-7 min-w-0 items-center px-2 text-label font-bold leading-none max-md:min-h-tap';

/** MODULOS at rest: a solid block among bare words, set apart by a gap (globals.css). Open, it wears the same face as the page you're on. */
const MODULOS_KEY = `${WORD_KEY} key key-fill modulos-key active:translate-y-press active:bg-bubble active:text-ink-plate`;

/** A word key: the same raised and pressed-in faces as the glyph keys, sized for a word. */
function wordClass(isActive: boolean): string {
  const base = WORD_KEY;

  return isActive
    ? `${base} key key-fill [--key-fill:var(--color-ink)] text-paper`
    : `${base} key active:translate-y-press active:bg-bubble active:text-ink-plate`;
}

// No profile key (Luke, 2026-11-03): the reader's own profile is reached from the side panel.
export default function SiteNav({ active, endKey }: { active?: NavKey; /** A key for the far end of the band, when this is the top of the window. */ endKey?: ReactNode }) {
  const choices = useSyncExternalStore(subscribeToModules, modulesState, serverModules);
  const listOpen = useSyncExternalStore(subscribeToModulesWindow, modulesWindowOpen, serverModulesWindowOpen);
  const { id: themeId } = useSyncExternalStore(subscribeToTheme, themeState, themeState);
  const bar = moduleBarColour(themeId);

  return (
    <nav
      aria-label="Modules"
      // `hidden` below `md`: the profile picture in the title bar is the only door on a phone.
      className="hidden min-w-0 flex-wrap items-center gap-1 border-b-line border-ink bg-sun-pale px-2 py-0.75 md:flex"
    >
      <SiteArrows />
      <span className="px-1 text-label font-bold leading-none text-ink">MODULES:</span>
      {MODULES.filter((module) => moduleIsOn(module, choices)).map((module) => {
        const ink = moduleInk(choices.colours[module.key], bar);
        const hover = ink === null ? {} : { style: { '--module-ink': ink } as CSSProperties };
        const inked = ink === null ? '' : ' module-key';
        if (module.href === null) {
          return (
            <button key={module.key} type="button" aria-expanded={listOpen} onClick={toggleModulesWindow} className={`${listOpen ? wordClass(true) : MODULOS_KEY} ml-2 cursor-pointer${inked}`} {...hover}>
              {module.label}
            </button>
          );
        }
        const isActive = module.key === active;
        return (
          <Link key={module.key} href={module.href} aria-current={isActive ? 'page' : undefined} className={`${wordClass(isActive)}${inked}`} {...hover}>
            {module.label}
            {module.wip ? <WipTag /> : null}
          </Link>
        );
      })}
      {endKey ? <span className="ml-auto flex items-center">{endKey}</span> : null}
    </nav>
  );
}

