/*
 * The keys on somebody else's profile (Luke, 2026-11-21): "the tell me when live should be a notification button ... when
 * clicked it lights up for now which has the same function, the report and block features should be a red exclamation mark
 * which then opens the encompassing reporting/ block pop up". Rendered with their real code and fake stores.
 *   npx tsc app/components/LiveWatchKey.tsx app/components/ProfileModerationKeys.tsx app/lib/ui/themes.ts --rootDir app --outDir Temp/profile-keys-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-profile-keys.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const jsxRuntime = require('react/jsx-runtime');
const { renderToStaticMarkup } = require('react-dom/server');

const OUT = path.join(__dirname, 'profile-keys-out');
const el = React.createElement;

function stub(file, exports) {
  const resolved = require.resolve(path.join(OUT, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

let drawn = [];
for (const name of ['jsx', 'jsxs']) {
  const real = jsxRuntime[name];
  jsxRuntime[name] = (type, props, key) => {
    if (typeof type === 'string') drawn.push({ type, props });
    return real(type, props, key);
  };
}
const draw = (element) => {
  drawn = [];
  return renderToStaticMarkup(element);
};
const buttons = () => drawn.filter(({ type }) => type === 'button');

const calls = [];
const auth = { user: { id: 'me' } };
const notify = { ready: true, watches: [] };
stub('components/AuthProvider.js', { useAuth: () => auth });
stub('lib/notifications/notify-settings-store.js', {
  useNotifySettings: () => notify,
  setLiveWatch: async (...args) => void calls.push(['setLiveWatch', ...args]),
});
stub('lib/moderation/moderation-windows.js', { openReport: (target) => void calls.push(['openReport', target]) });
stub('components/ModerationProvider.js', { useModeration: () => ({ block: async () => undefined, unblock: async () => undefined }) });

const LiveWatchKey = require(path.join(OUT, 'components/LiveWatchKey.js')).default;
const { ProfileModerationKeys } = require(path.join(OUT, 'components/ProfileModerationKeys.js'));
const { ICON_BELL } = require(path.join(OUT, 'lib/ui/icons.js'));
const { THEMES } = require(path.join(OUT, 'lib/ui/themes.js'));

/* --- the bell: TELL ME WHEN LIVE as a notification key ------------------------------------------------------------------ */
draw(el(LiveWatchKey, { host: 'them' }));
let [bell] = buttons();
assert.equal(buttons().length, 1, 'one key');
assert.equal(bell.props.children, `[ ${ICON_BELL} ]`, "off: the site's own notices glyph in brackets, no words");
assert.equal(bell.props['aria-label'], 'Tell me when they go live', 'its name says what it does');
assert.equal(bell.props.title, 'Tell me when they go live', 'and so does its tip');
assert.equal(bell.props['aria-pressed'], false);
assert.doesNotMatch(bell.props.className, /key-on/, 'off: a plain bracket key');
bell.props.onClick();
assert.deepEqual(calls.pop(), ['setLiveWatch', 'them', true], 'one press turns the follow on, as before');

notify.watches = ['them'];
draw(el(LiveWatchKey, { host: 'them' }));
[bell] = buttons();
assert.equal(bell.props['aria-pressed'], true, 'on: pressed');
assert.match(bell.props.className, /key-fill key-on/, 'on: it lights up (the filled pill every key that is on wears)');
assert.equal(bell.props.children, ICON_BELL, 'a lit pill carries the glyph without brackets');
assert.match(bell.props.title, /TELLING YOU|telling you/i, 'its tip says it is on');
bell.props.onClick();
assert.deepEqual(calls.pop(), ['setLiveWatch', 'them', false], 'pressed again, it turns off');

assert.equal(draw(el(LiveWatchKey, { host: 'me' })), '', 'never on your own profile');
auth.user = null;
assert.equal(draw(el(LiveWatchKey, { host: 'them' })), '', 'nothing signed out');
auth.user = { id: 'me' };

/* --- the red [ ! ]: one key for REPORT and BLOCK ----------------------------------------------------------------------- */
draw(el(ProfileModerationKeys, { userId: 'them', name: 'TROLLFACE' }));
assert.equal(buttons().length, 1, 'one key where BLOCK and REPORT were two');
const [bang] = buttons();
assert.equal(bang.props.children, '[ ! ]');
assert.match(bang.props.className, /\[--key-ink:var\(--color-queue-played-ink\)\]/, "red: the theme's own red ink");
assert.equal(bang.props['aria-label'], 'Report or block TROLLFACE');
assert.equal(bang.props['aria-haspopup'], 'dialog');
bang.props.onClick();
assert.deepEqual(calls.pop(), ['openReport', { accountId: 'them', name: 'TROLLFACE', block: true }], 'it opens REPORT / BLOCK for them');
assert.equal(draw(el(ProfileModerationKeys, { userId: 'me', name: 'ME' })), '', 'never on your own profile');

// The red ink reads 4.5:1 on the window in every theme, and so does the window's colour on the red fill under the pointer.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
for (const theme of THEMES) {
  const r = ratio(theme.tokens['queue-played-ink'], theme.tokens.paper);
  assert.ok(r >= 4.5, `${theme.id}: the red [ ! ] on the window reads ${r.toFixed(2)}:1`);
  const [red, green, blue] = [1, 3, 5].map((i) => parseInt(theme.tokens['queue-played-ink'].slice(i, i + 2), 16));
  assert.ok(red > green * 1.6 && red > blue * 1.6, `${theme.id}: and it is a red (${theme.tokens['queue-played-ink']})`);
}

console.log('check-profile-keys: OK');
