'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { moduleBarColour, WipTag } from './ModulesWindow';
import SiteArrows from './SiteArrows';
import { MODULES, moduleColour, moduleHoverInk, moduleIsOn, moduleMark } from '../lib/ui/modules';
import {
  modulesState,
  modulesWindowOpen,
  serverModules,
  serverModulesWindowOpen,
  subscribeToModules,
  subscribeToModulesWindow,
  toggleModulesWindow,
} from '../lib/ui/modules-slot';
import { subscribeToTheme, themeState, THEMES } from '../lib/ui/theme-slot';
import {
  ICON_ACCOUNT,
  ICON_ARCADE,
  ICON_COMMS,
  ICON_CYTUBE,
  ICON_FORUM,
  ICON_HOME,
  ICON_HISTORY,
  ICON_LOOP,
  ICON_MEDIA,
  ICON_MUSIC,
  ICON_USERS,
  ICON_WEB,
} from '../lib/ui/icons';
import { QUEUES_HREF } from '../lib/audio/queue-window';
import { HISTORY_HREF } from '../lib/history/history-window';
import { DESK_HREF, deskWindowServerState, deskWindowState, subscribeToDeskWindow, toggleDesk } from '../lib/desk/desk-window';
import { SEARCH_HREF, searchWindowServerState, searchWindowState, subscribeToSearchWindow, toggleSearch } from '../lib/search/site-search';
import { useAuth } from './AuthProvider';
import { useModeration } from './ModerationProvider';
import { reportsWindowServerState, reportsWindowState, subscribeToReportsWindow, toggleReports } from '../lib/moderation/moderation-windows';
import { getModerationStore } from '../lib/moderation/repository';
import { LIBRARY_HREF } from '../lib/audio/music-window';

/**
 * The window's keys, and the mark each one wears.
 *
 * CONCEPTS is not one of them: it is a shelf of the debaser project, and the project page listed on
 * the home page is what opens it. Pages under a project (or otherwise off the taskbar) pass no
 * `active` key, which leaves every key unlit rather than lighting one that does not own the page.
 */
export type NavKey = 'home' | 'forum' | 'media' | 'web' | 'comic' | 'read' | 'tagstation' | 'recommendations' | 'beatbox' | 'cytube' | 'animate' | 'leaguebot' | 'games' | 'music' | 'queues' | 'history' | 'desk' | 'search' | 'users' | 'comms' | 'account';

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
 * The plain "open the arcade" key is off the screen (Luke, 2026-11-14: "remove the arcade button but dont delete the code"). Everything
 * else stays: the window, its addresses (`/forum?arcade=1`, `?invite=`, `?challenge=`), a game invitation from the bell or a message,
 * and CHALLENGE on a profile. Turning this back to true puts the key back in the side panel's shelf and the phone's menu.
 */
export const ARCADE_KEY_SHOWN: boolean = false;

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
  label: 'QUEUE',
  mark: ICON_LOOP,
  href: QUEUES_HREF,
};

/** The HISTORY window's key (SPEC-history.md, Luke 2026-11-17): right under QUEUE on the shelf. Not in the phone's menu yet (desktop first). */
export const SIDE_HISTORY: NavItem = {
  key: 'history',
  label: 'HISTORY',
  mark: ICON_HISTORY,
  href: HISTORY_HREF,
};

/** YOUR DESK and the one SEARCH box (SPEC-forum-v3.md, D1A+ and S2A): windows over the forum, on the top bar and in the Start menu. */
export const SIDE_DESK: NavItem = { key: 'desk', label: 'DESK', mark: '▭', href: DESK_HREF };
export const SIDE_SEARCH: NavItem = { key: 'search', label: 'SEARCH', mark: '⌕', href: SEARCH_HREF };

/**
 * The top bar's two window keys, after the modules: DESK (signed in only: a visitor has no desk) and ⌕ SEARCH (Ctrl+K too).
 * Word keys like the modules, with the hover a module with no colour of its own wears; `aria-expanded` gives them the one
 * "this is open" look while their window is up.
 */
function TopBarWindowKeys({ hover }: { hover: CSSProperties }) {
  const { user } = useAuth();
  const desk = useSyncExternalStore(subscribeToDeskWindow, deskWindowState, deskWindowServerState);
  const find = useSyncExternalStore(subscribeToSearchWindow, searchWindowState, searchWindowServerState);
  return (
    <>
      {user === null ? null : (
        <button type="button" aria-expanded={desk.open} onClick={toggleDesk} title="What is waiting for you" className={`${wordClass(false)} module-key cursor-pointer`} style={hover} data-desk-key>
          DESK
        </button>
      )}
      <button type="button" aria-expanded={find.open} onClick={toggleSearch} title="Search the whole site (Ctrl+K)" className={`${wordClass(false)} module-key cursor-pointer`} style={hover} data-search-key>
        ⌕ SEARCH
      </button>
      <ReportsKey hover={hover} />
    </>
  );
}

/** How often the REPORTS key asks again how many are waiting, besides when a moderator acts or the window closes. */
const REPORTS_COUNT_MS = 5 * 60 * 1000;

/** REPORTS (SPEC-moderation.md, 7A): moderators only, with how many reports and appeals are waiting. */
function ReportsKey({ hover }: { hover: CSSProperties }) {
  const { role, version } = useModeration();
  const reports = useSyncExternalStore(subscribeToReportsWindow, reportsWindowState, reportsWindowServerState);
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    if (!role.moderator) return;
    let cancelled = false;
    const count = () =>
      void getModerationStore()
        .listReports('open')
        .then((rows) => {
          if (!cancelled) setWaiting(rows.length);
        })
        .catch(() => undefined);
    count();
    const timer = window.setInterval(count, REPORTS_COUNT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [role.moderator, version, reports.open]);

  if (!role.moderator) return null;
  return (
    <button type="button" aria-expanded={reports.open} onClick={toggleReports} title="What people reported" className={`${wordClass(false)} module-key cursor-pointer`} style={hover} data-reports-key>
      REPORTS{waiting > 0 ? <span className="ml-1 bg-bubble-pale px-1 text-ink-bar">{waiting}</span> : null}
    </button>
  );
}

/** The windows a menu lists (the phone's picture menu): the shelf's keys, without the arcade while its key is off the screen. */
export const SIDE_WINDOWS: NavItem[] = ARCADE_KEY_SHOWN ? [SIDE_ARCADE, SIDE_MUSIC, SIDE_QUEUES] : [SIDE_MUSIC, SIDE_QUEUES];

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

/** A word key: the same raised and pressed-in faces as the glyph keys, sized for a word. */
function wordClass(isActive: boolean): string {
  const base = WORD_KEY;

  // The page you're on: its word in its own colour, a highlighter stroke behind its lower half (`.module-on`, globals.css; Luke, 2026-11-14).
  return isActive
    ? `${base} key module-on`
    : `${base} key active:translate-y-press active:bg-bubble active:text-ink-plate`;
}

/**
 * The page you're on, drawn right on every theme from the first paint (Luke, 2026-11-16: "Yes, fix it"). The server cannot know the
 * reader's theme, so a colour worked out here for one bar was the dark theme's on every theme until the scripts arrived: bright green
 * on the yellow, pink and orange bars. Instead the word's look is worked out for every theme's own bar at once (`moduleMark`, the same
 * arithmetic) and sent as one rule per look, keyed on the theme the boot script has already put on <html> (`data-theme`), so the
 * browser picks the right one before any script runs, and a new theme is covered without a change here. With no theme on <html> no
 * rule matches and the stylesheet's own pair stands, which reads on the fallback theme. Checked by Temp/check-topbar-word.cjs.
 */
function pageWordRules(key: string, colourId: string): string {
  const byLook = new Map<string, string[]>();
  for (const theme of THEMES) {
    const mark = moduleMark(colourId, theme.tokens['sun-pale']);
    if (mark === null) return '';
    const look = `--module-ink:${mark.word};--module-word:${mark.word};--module-swipe:${mark.swipe}`;
    byLook.set(look, [...(byLook.get(look) ?? []), `:root[data-theme="${theme.id}"] .module-on[data-module="${key}"]`]);
  }
  return [...byLook].map(([look, selectors]) => `${selectors.join(',')}{${look}}`).join('');
}

// No profile key (Luke, 2026-11-03): the reader's own profile is reached from the side panel.
export default function SiteNav({ active, endKey }: { active?: NavKey; /** A key for the far end of the band, when this is the top of the window. */ endKey?: ReactNode }) {
  const choices = useSyncExternalStore(subscribeToModules, modulesState, serverModules);
  const listOpen = useSyncExternalStore(subscribeToModulesWindow, modulesWindowOpen, serverModulesWindowOpen);
  const { id: themeId } = useSyncExternalStore(subscribeToTheme, themeState, themeState);
  const bar = moduleBarColour(themeId);
  // Selected: the word's colour and its stroke, worked out for every theme's bar so the word reads on both (`pageWordRules`). With no
  // colour picked (or no page of the bar's) there are no rules and the stylesheet's own pair stands.
  const current = MODULES.find((module) => module.key === active && module.href !== null && moduleIsOn(module, choices));
  const wordRules = current === undefined ? '' : pageWordRules(current.key, moduleColour(current, choices) ?? '');

  return (
    <nav
      aria-label="Modules"
      // `hidden` below `md`: the profile picture in the title bar is the only door on a phone.
      className="hidden min-w-0 flex-wrap items-center gap-1 border-b-line border-ink bg-sun-pale px-2 py-0.75 md:flex"
    >
      {wordRules === '' ? null : <style dangerouslySetInnerHTML={{ __html: wordRules }} />}
      <SiteArrows />
      {MODULES.filter((module) => moduleIsOn(module, choices)).map((module) => {
        // Every key's hover is its word turning a colour (`moduleHoverInk`): its own, or the fallback for a module with none. No solid block.
        const hover = { style: { '--module-ink': moduleHoverInk(module, choices, bar) } as CSSProperties };
        if (module.href === null) {
          // MODULOS (Luke, 2026-11-16: "a word like the others"): the same word key, the same ink and hover, last on the bar.
          return (
            <button key={module.key} type="button" aria-expanded={listOpen} onClick={toggleModulesWindow} className={`${wordClass(false)} module-key cursor-pointer`} {...hover} data-tour="modulos">
              {module.label}
            </button>
          );
        }
        const isActive = module.key === active;
        // The page you are on keeps its word's colour under the pointer too (`--module-ink` is what the hover rule reads; the rules set it).
        const look = !isActive ? hover : wordRules === '' ? { style: { '--module-ink': 'var(--color-ink)' } as CSSProperties } : { 'data-module': module.key };
        return (
          <Link key={module.key} href={module.href} aria-current={isActive ? 'page' : undefined} className={`${wordClass(isActive)} module-key`} {...look}>
            {module.label}
            {module.wip ? <WipTag /> : null}
          </Link>
        );
      })}
      <TopBarWindowKeys hover={{ '--module-ink': moduleHoverInk(MODULES.find((module) => module.key === 'modules') ?? MODULES[0], choices, bar) } as CSSProperties} />
      {endKey ? <span className="ml-auto flex items-center">{endKey}</span> : null}
    </nav>
  );
}

