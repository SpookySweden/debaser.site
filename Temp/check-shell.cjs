/*
 * Scratch check for the window frame, the phone controls and the Google seam
 * (run from the project root):
 *   npx tsc app/components/SiteWindow.tsx app/components/Taskbar.tsx app/components/StartMenu.tsx app/components/SidebarProfile.tsx app/components/SidebarComms.tsx app/components/GoogleSignInButton.tsx app/components/UserDirectory.tsx app/components/SiteNav.tsx app/components/PresenceProvider.tsx app/components/GuestPrompt.tsx --outDir Temp/shell-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 *   npx tsc app/lib/auth/mock-auth.ts app/lib/auth/google.ts --outDir Temp/shell-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-shell.cjs
 *
 * What it is for, at the markup level:
 *   1. the title bar's minimise / maximise / close buttons are gone, and the phone's profile
 *      control has that corner instead;
 *   2. the header carries the five page tabs - the open one pressed in - with users, comms and
 *      account waiting for a wide screen, and the foot carries the Start button and the tray;
 *   3. the Start menu lists the site's keys and the debaser project's shelves, and is shut
 *      until it is asked for;
 *   4. the window carries the side panel, on a wide screen;
 *   5. the Google button is wired to the backend, and says what it needs while the backend
 *      is the mock one.
 *
 * Server rendering is the honest limit here: the profile control draws nothing
 * until the session read has landed, so the signed-in menu is covered by reading
 * the component rather than by rendering it.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const SiteWindow = require('./shell-render/components/SiteWindow.js').default;
const Taskbar = require('./shell-render/components/Taskbar.js').default;
const StartMenu = require('./shell-render/components/StartMenu.js').default;
const { NAV_ITEMS } = require('./shell-render/components/SiteNav.js');
const { PROJECT_SECTIONS } = require('./shell-render/lib/projects/debaser.js');
const { ProfileLogIn, ProfilePictureMenu } = require('./shell-render/components/ProfileControl.js');
const SiteNav = require('./shell-render/components/SiteNav.js').default;
const DesktopSidebar = require('./shell-render/components/DesktopSidebar.js').default;
const SidebarProfile = require('./shell-render/components/SidebarProfile.js').default;
const SidebarComms = require('./shell-render/components/SidebarComms.js').default;
const GoogleSignInButton = require('./shell-render/components/GoogleSignInButton.js').default;
const UserDirectory = require('./shell-render/components/UserDirectory.js').default;
const AuthProvider = require('./shell-render/components/AuthProvider.js').default;
const PresenceProvider = require('./shell-render/components/PresenceProvider.js').default;
const CommsProvider = require('./shell-render/components/CommsProvider.js').default;
const NotificationsProvider = require('./shell-render/components/NotificationsProvider.js').default;

const { GOOGLE_ICON_SRC, GOOGLE_NEEDS_SUPABASE } = require('./shell-out/auth/google.js');
const { getMockAuthRepository } = require('./shell-out/auth/mock-auth.js');
const { GOOGLE_SIGN_IN_AVAILABLE, USING_MOCK_AUTH } = require('./shell-render/lib/auth/auth-repository.js');

const element = React.createElement;

/**
 * Next's app-router context, faked.
 *
 * Two of the components under test open a conversation by pushing to /comms, so
 * they call `useRouter()`, which throws outside a real Next render. Handing it a
 * stub router is the same thing the testing libraries do, and it keeps the check on
 * the markup rather than on a browser.
 */
const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime.js');
const router = {
  push: () => undefined,
  replace: () => undefined,
  refresh: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
};

const withProviders = (child) =>
  renderToStaticMarkup(
    element(
      AppRouterContext.Provider,
      { value: router },
      element(
        AuthProvider,
        null,
        element(
          PresenceProvider,
          null,
          element(CommsProvider, null, element(NotificationsProvider, null, child)),
        ),
      ),
    ),
  );

// 1. The window: a title, no window decorations, the phone control, the panel.
const frame = withProviders(
  element(SiteWindow, { title: 'DEBASER_OS - v1.0 [CHECK]', active: 'forum', tip: 'What the page is for' }, 'BODY'),
);
assert.match(frame, /DEBASER_OS - v1\.0 \[CHECK\]/);
assert.doesNotMatch(frame, /font-bold">_</, 'the minimise button is gone');
assert.doesNotMatch(frame, /font-bold">□</, 'the maximise button is gone');
assert.doesNotMatch(frame, /font-bold">×</, 'the close button is gone');
assert.match(frame, /BODY/);
// (2026-10-23, SPEC-efficiency.md) The taskbar's `Status: ... :: UTF-8` line is cut, and the page's intro
// paragraph is the window title's hover tip instead. The side panel lost its `SIDE PANEL` title line;
// it is found by its blocks now.
assert.doesNotMatch(frame, /Status: /, 'no status line in the tray');
assert.match(frame, /title="What the page is for"/, "the page's intro is the window title's tip");
assert.match(frame, /PROFILE/, 'the side panel is part of the frame');
assert.doesNotMatch(frame, /\[ LOG IN \]/, 'the phone control waits for the session read before drawing');

// 1c. The offer to sign in, which must not be shown to somebody who is signed in.
//
// (2026-10-23, SPEC-efficiency.md) A guest gets ONE sign-in call per screen now: the banner across the
// top (`./GuestPrompt.tsx`, its key `[ LOG IN ]`). The board's own offer, `GuestOffer`, is cut. This
// section used to drive GuestOffer through the three session states; it drives the banner instead,
// which carries the same guard for the same reason - and holds the board page to drawing no offer.
//
// The bug this holds closed: the sentence used to be plain text inside `app/forum/page.tsx`, a server
// component that cannot read a session, so it told *everybody* to create an account - including the
// reader who already had one. It is `./GuestOffer.tsx` now, a client component behind the same
// `status !== 'anonymous'` guard the guest fault uses.
//
// **Driven, not read.** The first version of this assertion rendered the component through the real
// `AuthProvider` and asserted the text appeared - and it failed, because the provider's status starts
// as `loading` and the offer correctly draws nothing until the session has been read. That is the
// behaviour wanted, so the check was wrong rather than the component: a source-reading assertion
// would have passed while proving nothing, which is the fault `.clinerules` names.
//
// So `useAuth` is stubbed and all three states are exercised. `loading` is the one that matters most:
// it is the state a reader with a session is in for the first moments of every visit, and drawing the
// offer there is what told signed-in readers to sign in.
const AUTH = './shell-render/components/AuthProvider.js';
const OFFER = './shell-render/components/GuestPrompt.js';
const realAuth = require(AUTH);

/**
 * The offer, rendered with the session in a stated condition.
 *
 * Both modules are evicted from the cache on each call, and that is the part worth explaining: the
 * component binds `useAuth` at *import* time, so stubbing the provider and re-requiring the component
 * only works if neither is remembered from the previous call. Restoring both in the `finally` is what
 * keeps the rest of this file, which uses the real provider, unaffected by what happens here.
 */
function withAuth(status) {
  const stub = { ...realAuth, useAuth: () => ({ status, user: null }) };
  const resolvedAuth = require.resolve(AUTH);
  const resolvedOffer = require.resolve(OFFER);

  try {
    require.cache[resolvedAuth] = { id: resolvedAuth, filename: resolvedAuth, loaded: true, exports: stub };
    delete require.cache[resolvedOffer];

    return renderToStaticMarkup(element(require(OFFER).default, null));
  } finally {
    require.cache[resolvedAuth] = { id: resolvedAuth, filename: resolvedAuth, loaded: true, exports: realAuth };
    delete require.cache[resolvedOffer];
  }
}

const offerAnon = withAuth('anonymous');
assert.match(offerAnon, /UNREGISTERED ENTITY/, 'the offer draws for a reader with no account');
assert.match(offerAnon, /\[ LOG IN \]/, 'and its key says how to make one');

assert.equal(withAuth('loading'), '', 'and it does NOT draw while the session is still being read');
assert.equal(withAuth('signed-in'), '', 'nor for a reader who already has an account');

// It must not go back into the server page, which is where it could not tell who was reading it.
// Anchored to markup rather than to the words: `app/forum/page.tsx` explains this fault in a comment,
// and the explanation necessarily quotes the sentence it removed - so a check that forbade the phrase
// would forbid saying why.
const forumPage = require('node:fs').readFileSync('app/forum/page.tsx', 'utf8');
const forumMarkup = forumPage.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

assert.doesNotMatch(forumMarkup, /Guests post as Anonymous/, 'the offer is not drawn by the server component');
assert.doesNotMatch(forumMarkup, /GuestOffer/, 'and the board adds no second offer of its own: the banner is the one');

// 1b. Two things the frame owes a reader and a keyboard:
//   - the taskbar is the site's navigation, so it is written before the page and pulled to the foot
//     with `order-last`: a keyboard user reaches it in one press instead of tabbing the page;
//   - the window refuses text selection (it is a window), and the panel inside it turns selection
//     back on, because the archive is writing somebody may want to quote.
assert.match(frame, /order-last/, 'the taskbar is drawn at the foot of the window');
assert.ok(
  frame.indexOf('aria-label="Site keys"') < frame.indexOf('BODY'),
  'and comes before the page in the document, which is what a keyboard user tabs through',
);
assert.match(frame, /select-text/, 'while the reading panel allows selection, which the window itself does not');

// The two halves of that control, rendered directly: a log-in button signed out,
// the visitor's own picture signed in.
const logIn = renderToStaticMarkup(element(ProfileLogIn, null));
assert.match(logIn, /\[ LOG IN \]/);
assert.match(logIn, /href="\/account"/);
// The wrapper around it is what a wide screen hides, so the button has no breakpoint of its own.
assert.doesNotMatch(logIn, /sm:hidden/, 'the button itself is not breakpoint-bound; its wrapper is');

const picture = withProviders(
  element(ProfilePictureMenu, {
    userId: 'user-sweden',
    displayName: 'sweden',
    avatarVersionId: undefined,
    unreadNotifications: 2,
  }),
);
assert.match(picture, /aria-label="Open the account menu, 2 new"/, 'the picture says how much is waiting');
assert.match(picture, /aria-haspopup="menu"/);
// The breakpoint lives on the wrapper in `ProfileControl`, which is what decides a phone sees this
// and a wide screen does not - so the menu itself is not breakpoint-bound.
assert.doesNotMatch(picture, /sm:hidden/, 'the menu is not itself breakpoint-bound; its wrapper is');
assert.doesNotMatch(picture, />2</, 'as a mark and a label rather than a number crowding the plate');

// The menu itself only draws once it is opened, and server rendering cannot click. Read the
// component instead - and read it for what it holds: the things about *you*, because everything
// else on a phone is either a tab at the top or a row in the Start menu.
const profileControl = require('node:fs').readFileSync('app/components/ProfileControl.tsx', 'utf8');
assert.match(profileControl, /NotificationMenuButton \/>/, 'the phone menu lists the notification button');
// (2026-10-25, SPEC-less-text.md) `MY PUBLIC PROFILE` -> `MY PROFILE`.
// (2026-11-04) One key became two: VIEW PROFILE and EDIT PROFILE.
assert.match(profileControl, /<span>VIEW PROFILE<\/span>/, 'and the way to your own page');
assert.match(profileControl, /<span>EDIT PROFILE<\/span>/, 'and to changing it');
assert.doesNotMatch(profileControl, /MY PUBLIC PROFILE/, 'under its short name');
assert.match(profileControl, /NAV_ITEMS/, 'and the keys drawn from the one shared list');
assert.doesNotMatch(
  profileControl,
  /USER DIRECTORY|\[ COMMS/,
  'the directory and the conversations are the Start menu`s on a phone, not a second row here',
);

const { NotificationMenuButton } = require('./shell-render/components/NotificationBell.js');
assert.match(
  withProviders(element(NotificationMenuButton, {})),
  /\[ NOTIFICATIONS \]/,
  'the button is the phone way into the feed',
);

// 2. The header (the page keys) and the foot (the Start button and the tray).
const nav = withProviders(element(SiteNav, { active: 'forum' }));
// The band is wide-screen chrome in its entirety now: on a phone every one of these keys is behind
// the profile picture, so there is nothing left here that waits for a wider screen.
assert.equal((nav.match(/hidden lg:inline-flex/g) ?? []).length, 0, 'no key waits for a wide screen: the band is one');
// 2026-10-24 (SPEC-media-catalogue.md): MEDIA joined the band, so the five are six.
// (2026-11-04, Luke 2026-10-30 and 2026-11-03, SiteNav.tsx) The header has its own list of named pages, `HEADER_ITEMS`, kept
// apart from `NAV_ITEMS`, which the menus still draw. It is not exported, so it is read from the source, and the rendered
// band is held to it: exactly one link per entry, in that order, with that word and that address.
const headerSource = require('node:fs').readFileSync('app/components/SiteNav.tsx', 'utf8');
const headerBlock = headerSource.slice(headerSource.indexOf('const HEADER_ITEMS'), headerSource.indexOf('];', headerSource.indexOf('const HEADER_ITEMS')));
const HEADER_ITEMS = [...headerBlock.matchAll(/\{ key: '(\w+)', label: '([^']+)', href: '([^']+)' \}/g)].map(([, key, label, href]) => ({ key, label, href }));
assert.ok(HEADER_ITEMS.some((item) => item.key === 'forum'), 'the band has the board on it');
assert.deepEqual(
  [...nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)</g)].map(([, href, label]) => ({ href, label })),
  HEADER_ITEMS.map(({ href, label }) => ({ href, label })),
  'and all of them are drawn together, each a word that goes to its page',
);
// Updated on purpose 2026-11-05 (SPEC-floating-player.md): the band now starts with the site's two arrows, which go
// nowhere of their own and so are buttons. Every page key is still a link.
assert.equal((nav.match(/<button/g) ?? []).length, 2, 'each page key is a link wearing its own chrome; the only buttons are the two arrows');
assert.ok(nav.indexOf('aria-label="Back"') > -1 && nav.indexOf('aria-label="Forward"') > nav.indexOf('aria-label="Back"') && nav.indexOf('aria-label="Forward"') < nav.indexOf('<a '), 'the arrows sit left of the first page key');
// "Pressed in" is a filled pill now (`key-fill`, SPEC-readability.md) rather than the inverted Win95 bevel
// this used to count, and it is held to the tab that says it is the page - not just to a count of one.
assert.equal((nav.match(/(?<=[" ])key-fill(?=[" ])/g) ?? []).length, 1, "the open page's tab is the one pressed in");
assert.match(nav, /<a[^>]*class="[^"]*key-fill[^"]*"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*class="[^"]*key-fill/, 'and it is the open page`s tab that is filled');
assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1, 'and says so to a screen reader');
/**
 * A label or a path read back out of markup.
 *
 * Escaped, because an href may carry regex metacharacters now that the arcade's address is
 * `/forum?arcade=1` - a `?` read as a quantifier makes the pattern match something else entirely.
 */
const esc = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// (2026-11-04, Luke 2026-10-30) The band draws named pages rather than glyphs, so its words are what a reader and a screen
// reader both get (held by the list above). The band itself is named, so it can be told from the menus.
assert.match(nav, /<nav aria-label="(?!Site menu")[^"]+"/, 'the band is a labelled nav, not named as the Start menu is');

const bar = withProviders(element(Taskbar, null));
assert.match(bar, /\[ START \]/, 'the foot of the window carries a Start button');
// (2026-10-23, SPEC-efficiency.md) The tray's status line and its UTF-8 are cut; on a phone the strip is gone.
assert.doesNotMatch(bar, /Status: |UTF-8/, 'and no status line or encoding beside it');
assert.match(bar, /max-sm:hidden/, 'and a phone does not draw the strip at all');
assert.equal(
  (bar.match(/<button/g) ?? []).length,
  1,
  'and one pressable thing on it: the Start button',
);
// The notices plate is not here any more: it sits in the side panel beside `[ OPEN COMMS ]`, because a
// tag or a reply is the same kind of thing as a message. The tray is the foot of every window, which
// is where a notice went when there was nowhere better - and the panel is better.
assert.doesNotMatch(bar, /Notifications:/, 'the tray does not carry the notices plate any more');
for (const item of NAV_ITEMS) {
  assert.doesNotMatch(bar, new RegExp(`>${esc(item.label)}<`), `${item.label} is a tab in the header, not drawn twice`);
}
assert.match(frame, /\[ START \]/, 'the frame carries that strip');
assert.doesNotMatch(frame, /PROJECT SHELVES/, 'and the menu is shut until it is asked for');
// (2026-11-04, Luke 2026-10-30) The frame carries the band's named pages, as above.
for (const item of HEADER_ITEMS) {
  assert.match(frame, new RegExp(`href="${esc(item.href)}"[^>]*>${esc(item.label)}<`), `${item.key} is in the band, under its word`);
}

// The menu those five come from: every key on a wide screen, and on a phone only the ones the
// header does not already carry.
const menu = withProviders(element(StartMenu, { onDismiss: () => undefined, commsUnread: 3 }));
// A labelled list of links rather than `role="menu"`: a menu role promises arrow-key focus handling,
// and claiming it without doing it is worse for a screen reader than being what this is.
assert.match(menu, /<nav aria-label="Site menu"/, 'the menu is a nav, and says which');
assert.match(menu, /max-sm:min-h-tap/, 'its rows are thumb-sized, because on a phone it is the whole navigation');
assert.match(menu, /PROJECT SHELVES/, 'it names the second list');
assert.match(menu, /DEBASER PROJECT/, "and its spine carries the desktop's own name");
for (const item of NAV_ITEMS) assert.match(menu, new RegExp(`href="${esc(item.href)}"`));
for (const section of PROJECT_SECTIONS) assert.match(menu, new RegExp(`>${esc(section.label)}<`));
// Every key, both windows and every shelf is listed on every screen now: the header band and the
// side panel are wide-screen only, so the menu is what a phone has, and folding rows away here would
// hide them from the only surface that can reach them. Five keys, then the two windows, then the
// project's own shelves.
// (2026-10-23, SPEC-efficiency.md review) Three windows now: QUEUES joined ARCADE and MUSIC, because the
// player bar lost its queues key and a 640-767px screen (no phone card, no side panel) had no other way in.
assert.equal(
  (menu.match(/<a\b/g) ?? []).length,
  NAV_ITEMS.length + 3 + PROJECT_SECTIONS.length,
  'every key, all three windows and every shelf is a link in this menu',
);
assert.match(menu, /COMMS/, 'and comms is one of them');
assert.match(menu, /\(3\)/, 'saying how many are waiting, on every screen');

// Both windows are reachable from this menu, and that is not a nicety: the side panel their keys
// live in is `lg:` only, so a phone's *only* way to the arcade or the archive is a row here. They
// have a shelf of their own rather than sitting among the keys, because they open over the reader
// instead of taking them somewhere - the same separation the header band keeps.
assert.match(menu, /WINDOWS/, 'the menu names the two windows');
assert.match(menu, /href="\/forum\?arcade=1"/, 'the arcade is reachable from it');
// 2026-10-24: the window is the reader's own music (`?music=mine`); the archive is the media page.
assert.match(menu, /href="\/forum\?music=mine"/, 'and so is the music window');
assert.match(menu, /href="\/files\?kind=audio"/, 'and the archive, on the FILES page (2026-11-04)');
assert.match(menu, /href="\/forum\?queues=1"/, 'and the queues, which no other key reaches from 640 to 767px');

// 3. The side panel and its three blocks.
const sidebar = withProviders(element(DesktopSidebar, null));
// (2026-10-23, SPEC-efficiency.md) No `SIDE PANEL` title line: the window is the panel. Its blocks are what it is.
assert.doesNotMatch(sidebar, /<span>SIDE PANEL<\/span>/, 'the open panel is not titled twice');
assert.match(sidebar, /SHELF/);
assert.match(sidebar, /hidden w-60[^"]*md:flex lg:w-72/, 'the panel opens from a tablet and widens on a desktop');

// The panel used to be `lg:` only, which left 640-1023px with no panel *and* no tab keys for the
// arcade or the archive - `SiteNav` is `hidden sm:flex` and carries neither - so both windows were
// unreachable on a tablet. It opens from `md` now, narrower there than on a desktop. A phone still
// does not get it: `hidden` is the phone's answer, and the picture in the title bar is the door.
assert.match(sidebar, /hidden w-60[^"]*md:flex/, 'and below `md` it is out of the way');

// The profile card has three states, and the first paint is the *loading* one: a synchronous render
// has not run the session read yet, so `status` is `loading` and `user` is null. That is precisely
// the state in which the old `user === null` branch offered a log-in button to somebody who was
// already signed in, so the check holds the panel to saying "reading" and nothing else here.
const profileLoading = withProviders(element(SidebarProfile, null));
// (2026-10-25, SPEC-less-text.md) `READING THE LOCAL SESSION...` -> `LOADING...`.
assert.match(profileLoading, />LOADING\.\.\.</, 'the profile card says it is reading first');
assert.doesNotMatch(profileLoading, /READING THE LOCAL SESSION/, 'in one word');
assert.doesNotMatch(
  profileLoading,
  /LOG IN WITH GOOGLE/,
  'and does not offer a log-in to an account that may already exist',
);
// The card is three states in the source, and the anonymous one still carries the way in.
// (2026-10-23, SPEC-efficiency.md) A guest gets one sign-in call per screen (the banner's `[ LOG IN ]`); the
// card's sentence and its `[ LOG IN OR CREATE AN ACCOUNT ]` are cut, and the Google key is its way in.
const profileSrc = require('node:fs').readFileSync('app/components/SidebarProfile.tsx', 'utf8');
assert.match(profileSrc, /status === 'loading' \? \(/, 'the card branches on the session, not just `user`');
assert.match(profileSrc, /<GoogleSignInButton \/>/, 'and the way in is still there once it lands');
assert.doesNotMatch(
  profileSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
  /LOG IN OR CREATE AN ACCOUNT/,
  'as the only sign-in call in the card',
);

// The comms block is folded by default: the panel offers one button, and the conversations are behind
// it. What the check can hold without a press is that the block is *built* around a toggle and that the
// button carries the count - the count is the whole reason a folded block is not a hidden one.
const sidebarCommsHtml = withProviders(element(SidebarComms, null));
assert.match(sidebarCommsHtml, /\[ COMMS \]/, 'the comms block is one button');
assert.match(sidebarCommsHtml, /aria-expanded="false"/, 'which starts folded');
assert.match(sidebarCommsHtml, /aria-controls="sidebar-comms-list"/, 'and says what it opens');
// (2026-10-23, SPEC-efficiency.md) `[ n OPEN ]` is cut; `n NEW` rides the line only while something is unread
// (none in this render), so the folded block still says whether it is worth a press when it is.
assert.doesNotMatch(sidebarCommsHtml, /\[ \d+ OPEN \]/, 'with no count of open conversations on it');
assert.match(
  require('node:fs').readFileSync('app/components/SidebarComms.tsx', 'utf8'),
  /\{comms\.unreadTotal\} NEW/,
  'and the unread count beside it whenever there is one',
);
assert.doesNotMatch(
  sidebarCommsHtml,
  /MESSAGES GO ACCOUNT TO ACCOUNT/,
  'the conversations are not drawn until it is pressed',
);
// The notices key *is* in the panel, on the comms block's own row. It appears only when something is
// unread, which is why the check drives both states rather than asserting one markup.
const readShellFile = (file) => require('node:fs').readFileSync(file, 'utf8');
assert.match(
  readShellFile('app/components/SidebarComms.tsx'),
  /<NotificationBell \/>/,
  'the comms row carries the notices key',
);
assert.match(
  readShellFile('app/components/NotificationBell.tsx'),
  /if \(unread === 0\) return null;/,
  'which draws nothing at all until there is something to say',
);
assert.doesNotMatch(
  readShellFile('app/components/Taskbar.tsx'),
  /NotificationBell/,
  'and the tray does not: it was moved out, and must not creep back',
);

// The compact directory drops the legend and links to the whole page instead.
const compactDirectory = withProviders(element(UserDirectory, { compact: true }));
assert.doesNotMatch(compactDirectory, /THE LAMP/, 'the panel version has no footer notes');
assert.match(compactDirectory, /href="\/users"/, 'it hands over to the full directory');
// (2026-10-23, SPEC-efficiency.md) The `THE LAMP [ LEGEND ]` panel is cut; the legend is the directory title's tip.
// (2026-10-25, SPEC-less-text.md) The tip shortened from `The lamp: green while a tab of that account is open, ...`
// (plus the game sentence for an account) to `Green: on. Yellow: under 1h. Red: away.`, on both versions.
const fullDirectory = withProviders(element(UserDirectory, null));
// (2026-10-27, Luke: "far more reactive" lamps) Yellow is AWAY now, red is not on the site: the tip says so.
// (2026-11-05, the privacy plan's phase 0) Lamps are for people with a session. This render has none, so it draws no lamp and
// no tip about lamps; the tip's words are checked in the source, for the signed-in render.
assert.doesNotMatch(fullDirectory, /title="Green: in use/, 'a visitor is not told about lamps they cannot see');
assert.match(readShellFile('app/components/UserDirectory.tsx'), /Green: in use\. Yellow: away\. Red: not on the site\./, 'the page version carries the legend as a tip');
assert.doesNotMatch(fullDirectory, /The lamp: green|A game is asked for from the arcade/, 'in a few words');

// 4. Google: the button, the retro mark, and the backend's honest answer.
const google = withProviders(element(GoogleSignInButton, null));
// (2026-10-25, Luke) The long `[ LOG IN WITH GOOGLE ]` became two keys that both start Google sign-in:
// `[ LOG IN ]` and the Google mark's own key, which reads `[ G ]` until the drawing is in assets/icons/.
assert.doesNotMatch(google, /LOG IN WITH GOOGLE/, 'the long key is gone');
const googleKeys = google.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
assert.equal(googleKeys.length, 2, 'two keys: LOG IN and the Google mark');
assert.match(googleKeys[0], /\[ LOG IN \]/);
assert.match(googleKeys[1], /aria-label="Log in with Google"/, 'the mark key is named for a screen reader');
assert.match(googleKeys[1], /\[ G \]/, 'and reads [ G ] until the drawing loads');
assert.match(googleKeys[1], /max-sm:min-w-tap/, 'with a thumb-wide tap area on a phone');
assert.match(googleKeys[1], /src="\/assets\/icons\/google-retro\.png"/, 'the mark is the hand-drawn file as drawn, not resampled');
// (2026-10-25, Luke) The account page's email form ends in its own `[ LOG IN ]`, so the Google key
// there says `[ LOG IN WITH ]`; the side panel keeps the short `[ LOG IN ]`.
const googleWith = withProviders(element(GoogleSignInButton, { label: '[ LOG IN WITH ]' }));
assert.match((googleWith.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [])[0] ?? '', /\[ LOG IN WITH \]/, 'the key takes the words it is given');
assert.match(require('node:fs').readFileSync('app/components/AccountForms.tsx', 'utf8'), /<GoogleSignInButton label="\[ LOG IN WITH \]"/, 'the account page asks for LOG IN WITH');
const googleSrc = require('node:fs').readFileSync('app/components/GoogleSignInButton.tsx', 'utf8');
assert.equal((googleSrc.match(/onClick=\{\(\) => void handleClick\(\)\}/g) ?? []).length, 2, 'both keys start the same sign-in');
assert.match(google, /google-retro\.png/, 'the mark is a hand-drawn file, not a drawn logo');
assert.equal(USING_MOCK_AUTH, true, 'these checks run against the mock backend');
assert.equal(GOOGLE_SIGN_IN_AVAILABLE, false);
// (2026-10-25, SPEC-less-text.md) The standing local-mode note under the keys (`GOOGLE SIGN-IN IS NOT SET UP
// YET...`) is cut (rule 1): only a click's answer is shown, and on the mock backend that answer is
// GOOGLE_NEEDS_SUPABASE (asserted on the repository below).
assert.doesNotMatch(google, new RegExp(GOOGLE_NEEDS_SUPABASE.slice(0, 40)), 'no standing note before anything is pressed');
assert.match(googleSrc, /if \(!result\.ok\) setMessage\(result\.error\)/, 'a click still shows the backend`s answer');

(async () => {
  const repository = getMockAuthRepository();
  assert.equal(typeof repository.signInWithGoogle, 'function', 'the seam exists on the repository');

  const result = await repository.signInWithGoogle();
  assert.equal(result.ok, false, 'the mock backend cannot do OAuth, and says so');
  assert.equal(result.error, GOOGLE_NEEDS_SUPABASE);
  assert.match(GOOGLE_ICON_SRC, /^\/assets\/icons\/.+\.png$/);

  console.log('shell checks passed');
  console.log('  banner  :', (nav.match(/hidden lg:inline-flex/g) ?? []).length, 'of 5 tabs wait for a wide screen; the other two are the phone`s');
  console.log('  keys    : one page, one place on a phone - tabs, Start menu, account menu');
  console.log('  panel   :', sidebar.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120));
  console.log('  google  :', result.error);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
