/**
 * FIRSTVISIT (Luke, 2026-11-20: "Gentler first visits: replace the full-page 'HAD AN ACCOUNT?' pop-up with a short guided tour
 * of the desktop"): who is toured, which steps, what is remembered, and that the lost-account window no longer opens by itself.
 *   npx tsc app/lib/ui/first-visit-tour.ts app/lib/settings/settings-rules.ts --outDir Temp/out-first-visit --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   npx tsc app/components/FirstVisitTour.tsx --outDir Temp/out-first-visit-render --rootDir app --module commonjs --target es2022 --lib es2022,dom,dom.iterable --jsx react-jsx --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-first-visit.cjs
 * The drive (scripts/drive-first-visit.cjs) walks it in a browser on the local mock server.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'out-first-visit');
const store = new Map();
let refuse = false;
global.window = {
  localStorage: {
    getItem: (key) => {
      if (refuse) throw new Error('blocked');
      return store.has(key) ? store.get(key) : null;
    },
    setItem: (key, value) => {
      if (refuse) throw new Error('blocked');
      store.set(key, String(value));
    },
    removeItem: (key) => store.delete(key),
  },
};
const tour = require(path.join(OUT, 'lib', 'ui', 'first-visit-tour.js'));
const bus = require(path.join(OUT, 'lib', 'settings', 'settings-bus.js'));
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Who is toured, and where.
// Everyone once more (Luke, 2026-11-20: "make it so the tutorial plays for any user who returns to the site again for the first
// time starting now"): signed in or not, anybody not toured under v2 is toured; only a v2 mark ends it.
const owed = (said, { held = false, replaying = false, where = '/forum' } = {}) => tour.tourOwed({ said, held, replaying, path: where });
assert.equal(owed(null), true, 'a reader not toured since v2 is toured on the board, visitor or account');
assert.equal(owed(null, { where: '/media' }), false, 'only on the board, the desktop');
assert.equal(owed('done'), false, 'DONE: never again');
assert.equal(owed('skipped'), false, 'SKIP: never again');
assert.equal(owed(null, { held: true }), false, "never while a new account's PRIVACY window holds it");
assert.equal(owed('done', { replaying: true }), true, 'TOUR in MODULOS plays it again');
assert.equal(owed('done', { replaying: true, where: '/media' }), false, 'a replay still plays on the board only');

// The seven steps: the visitor's LOG IN, the account's DESK; a thing not on screen drops out.
const all = () => true;
const ids = (signedIn, shown = all) => tour.stepsFor(signedIn, shown).map((step) => step.id);
assert.deepEqual(ids(false), ['board', 'modules', 'search', 'login', 'modulos', 'shelf', 'music'], 'a visitor: seven steps with LOG IN');
assert.deepEqual(ids(true), ['board', 'modules', 'search', 'desk', 'modulos', 'shelf', 'music'], 'an account: seven steps with DESK');
assert.deepEqual(ids(false, (target) => !target.includes('shelf')), ['board', 'modules', 'search', 'login', 'modulos', 'music'], 'a folded sidebar: no SHELF step');
for (const step of tour.TOUR_STEPS) {
  assert.ok(step.title.length > 0 && step.line.length <= 48, `${step.id}: a few words, the outline does the showing`);
  assert.equal(step.title, step.title.toUpperCase(), `${step.id}: in capitals, the site's voice`);
}

// Each step's thing is still marked where it is drawn (a lost mark would quietly drop the step).
const marked = {
  board: ['app/components/ForumBoard.tsx', 'data-tour="board"'],
  modules: ['app/components/SiteNav.tsx', 'aria-label="Modules"'],
  search: ['app/components/SiteNav.tsx', 'data-search-key'],
  login: ['app/components/GuestPrompt.tsx', 'data-tour="login"'],
  desk: ['app/components/SiteNav.tsx', 'data-desk-key'],
  modulos: ['app/components/SiteNav.tsx', 'data-tour="modulos"'],
  shelf: ['app/components/DesktopSidebar.tsx', 'data-tour="shelf"'],
  music: ['app/components/MusicPlayer.tsx', 'data-tour="music"'],
};
for (const step of tour.TOUR_STEPS) {
  const [file, mark] = marked[step.id];
  assert.ok(read(file).includes(mark), `${step.id}: ${file} still carries ${mark}`);
}

// What is remembered, and that it follows the account.
assert.equal(bus.SYNCED_KEYS.tour2, tour.TOUR_KEY, 'the tour key follows the account, under its v2 name');
assert.equal(bus.SYNCED_KEYS.tour, undefined, "the first day's synced name is gone, so an account's old mark is never written back");
// The marks from before v2, in this browser and as the account's old value under the old key, no longer count.
const rules = require(path.join(OUT, 'lib', 'settings', 'settings-rules.js'));
const fromAccount = rules.parseAccountSettings({ keys: { tour: 'done' }, made: {} });
assert.equal(fromAccount.keys.tour2, undefined, "an account's saved mark from the first day is not read back as a v2 mark");
assert.equal(Object.keys(fromAccount.keys).length, 0, 'nor kept under its old name');
store.set('debaser.tour.v1', 'done');
assert.notEqual(tour.TOUR_KEY, 'debaser.tour.v1', 'a new key');
assert.equal(tour.readTourSaid(), null, 'an old DONE in this browser no longer suppresses the tour');
assert.equal(owed(tour.readTourSaid()), true, 'so a returning reader is toured once more');
store.set('debaser.tour.v1', 'skipped');
assert.equal(tour.readTourSaid(), null, 'nor an old SKIP');
tour.endTour('done');
assert.equal(tour.readTourSaid(), 'done', 'DONE is written down, under v2');
assert.equal(owed(tour.readTourSaid()), false, 'and a v2 mark does suppress it');
const release = tour.holdTour();
assert.equal(tour.tourHeld(), true, 'PRIVACY holds the tour');
release();
assert.equal(tour.tourHeld(), false, 'and lets it go');
assert.match(read('app/components/PrivacyFirstLook.tsx'), /holdTour\(\)/, 'the PRIVACY window holds the tour while it is open');
assert.match(read('app/components/PrivacyFirstLook.tsx'), /const holding = userId !== null && closedFor !== userId && \(!read \|\| !profile\.privacySeen\);/, 'and while the profile is still being read, so the tour never starts before PRIVACY can appear');
tour.replayTour();
assert.equal(tour.tourReplaying(), true);
tour.endTour('skipped');
assert.equal(tour.tourReplaying(), false, 'ending a replay ends it');
assert.equal(tour.readTourSaid(), 'skipped', 'SKIP is written down');
assert.equal(tour.parseTourSaid('nonsense'), null);
// A scripted test browser is not toured unless it asks; a person's browser always is.
window.navigator = { webdriver: false };
assert.equal(tour.automatedWithoutTour(), false, "a person's browser is toured");
window.navigator = { webdriver: true };
assert.equal(tour.automatedWithoutTour(), true, 'a drive or check is not, so the tour never holds a test that is about something else');
store.set(tour.TOUR_DRIVE_KEY, '1');
assert.equal(tour.automatedWithoutTour(), false, 'unless it asks (the tour drive, npm run shot -- --tour)');
store.delete(tour.TOUR_DRIVE_KEY);
assert.match(read('app/components/FirstVisitTour.tsx'), /if \(!owed \|\| automatedWithoutTour\(\)\) return;/, 'the tour reads it before it starts');
refuse = true;
assert.equal(tour.readTourSaid(), 'done', 'storage refused: never nagged on every page');
refuse = false;

// The lost-account window waits to be asked (FIRSTVISIT): no pop-up by itself on any page; the quiet line is on the board.
const lost = read('app/components/LostAccountWindow.tsx');
const body = lost.slice(lost.indexOf('export default function LostAccountWindow'), lost.indexOf('export function LostAccountLine'));
const firstReturn = body.indexOf('const find = async');
assert.match(body.slice(0, firstReturn), /if \(!asked\) return null;/, 'the window opens only when asked');
assert.doesNotMatch(body, /saidNotNowTo|loginFormShown|LOGIN_PAGE/, 'no longer decides by itself where it may pop up');
assert.match(read('app/components/SidebarProfile.tsx'), /<LostAccountLine \/>/, "the quiet line sits in the board's PROFILE panel for a visitor");
assert.match(read('app/components/AccountForms.tsx'), /<LostAccountLine \/>/, 'and still in the LOG IN box');

// Drawn once, instant, still under reduced motion; MODULOS replays it; PRIVACY hands over to it.
assert.match(read('app/layout.tsx'), /<FirstVisitTour \/>/, 'drawn in the layout');
const css = read('app/globals.css');
assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.tour-outline \{\s*animation: none;/, 'the outline holds still under reduced motion');
assert.match(read('app/theme/tokens.css'), /--animate-tour-blink: tour-blink [^;]*steps\(/, 'the blink is in whole frames, no easing');
const component = read('app/components/FirstVisitTour.tsx');
assert.doesNotMatch(component, /transition|ease/, 'nothing slides or fades');
assert.match(read('app/components/ModulesWindow.tsx'), /replayTour\(\)/, 'the TOUR key in MODULOS');

// The server draws nothing: only a browser knows whether it was toured (its snapshot says 'done' until then).
{
  const RENDER = path.join(__dirname, 'out-first-visit-render');
  const stub = (file, exports) => {
    const resolved = require.resolve(path.join(RENDER, file));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
  };
  stub('components/AuthProvider.js', { useAuth: () => ({ status: 'anonymous', user: null }) });
  stub('lib/settings/account-settings.js', { accountSettingsLoaded: () => false, serverAccountSettingsLoaded: () => false, subscribeToAccountSettingsLoaded: () => () => undefined });
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Tour = require('./out-first-visit-render/components/FirstVisitTour.js').default;
  assert.equal(renderToStaticMarkup(React.createElement(Tour)), '', 'FirstVisitTour: the server draws nothing');
}

console.log('first visit checks passed');
