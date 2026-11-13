/*
 * The companion's components, rendered (SPEC-companion.md), run from the root:
 *   npx tsc app/components/Companion.tsx app/components/CompanionReactions.tsx app/components/CompanionPreferences.tsx --rootDir app --outDir Temp/companion-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-companion-render.cjs
 *
 * What it holds: the server render (and so the first paint, before the browser says whether this is a phone and whether
 * motion is wanted) draws no companion and no COMPANION row at all, signed in or out, so nothing ever runs one frame on
 * a guess; and the reactions listener draws nothing. The behaviours themselves are Temp/check-companion.cjs and the
 * live drive, scripts/drive-companion.cjs.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const OUT = path.join(__dirname, 'companion-render');

function stub(file, exports) {
  const resolved = require.resolve(path.join(OUT, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

let user = null;
stub('components/AuthProvider.js', { useAuth: () => ({ user }) });
stub('components/MusicPlayerProvider.js', { useMusicPlayer: () => ({ playing: false }) });
stub('components/NotificationsProvider.js', { useNotifications: () => ({ items: [], ready: true }) });
stub('components/CommsProvider.js', { useComms: () => ({ ready: true, userId: user?.id ?? null, threads: [] }) });
stub('components/PresenceProvider.js', { usePresenceDirectory: () => ({ live: {}, selfId: user?.id ?? null }) });

const Companion = require('./companion-render/components/Companion.js').default;
const CompanionReactions = require('./companion-render/components/CompanionReactions.js').default;
const CompanionPreferences = require('./companion-render/components/CompanionPreferences.js').default;
const draw = (component) => renderToStaticMarkup(React.createElement(component));

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok    ${name}`);
}

ok('signed out: no companion and no COMPANION row', () => {
  user = null;
  assert.equal(draw(Companion), '');
  assert.equal(draw(CompanionPreferences), '');
});

ok('signed in, first paint: still nothing until the device and the motion setting are read in the browser', () => {
  user = { id: 'u-1', displayName: 'TEST' };
  assert.equal(draw(Companion), '', 'no strip on a guess');
  assert.equal(draw(CompanionPreferences), '', 'no row until it knows which switch (phone or computer) it is');
});

ok('the reactions listener draws nothing', () => {
  assert.equal(draw(CompanionReactions), '');
});

console.log(`\n${passed} passed`);
