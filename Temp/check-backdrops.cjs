/**
 * The frame every background's settings run on (SPEC-backgrounds.md): the knob machinery, the store, and what moves by itself.
 * `Temp/check-aquarium.cjs` holds the sea itself; this holds what the sea now shares with SAND, FLUID and the rest.
 *
 * Held here:
 *   1. the machinery, on a small made-up background and on the aquarium: bands keep their ends apart whichever end moves; a
 *      roll, a party and a morph stay in range; a party and a look leave locked knobs alone; a morph is the first look at one
 *      end and the second at the other;
 *   2. sway and bounce as plain arithmetic: a swaying value stays between its marks, on its steps, and reaches both; a
 *      bouncing puck never leaves its pad and turns at the walls;
 *   3. the store: locks and sways are kept in this browser and in the account's row beside the values, and come back on
 *      another machine; a row from before there were other backgrounds still reads; every background has its own browser key;
 *   4. the runtime: live values are the stored ones (the very same object) until something moves; a bouncing pad moves its
 *      two knobs and leaves them where it is caught;
 *   5. the window draws the new controls;
 *   6. the simulated backgrounds draw nothing on the server (it cannot know which a browser chose).
 *
 * Compiled fresh on every run:
 *   npx tsc app/components/BackdropSettingsWindow.tsx app/components/backdrops/Backdrops.tsx app/lib/backdrops/knobs.ts app/lib/backdrops/store.ts app/lib/backdrops/runtime.ts app/lib/backdrops/registry.ts --outDir Temp/backdrops-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToString } = require('react-dom/server');

const OUT = path.join(__dirname, 'backdrops-out');
const fresh = (file) => {
  for (const key of Object.keys(require.cache)) if (key.startsWith(OUT)) delete require.cache[key];
  return require(path.join(OUT, file));
};
const seeded = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

/* ------------------------------------------------------------------ 1. the machinery */
const K = fresh('lib/backdrops/knobs.js');
const TOY = {
  id: 'toy',
  label: 'TOY',
  tabs: [{ id: 'a', label: 'A' }],
  knobs: [
    { kind: 'range', key: 'from', tab: 'a', label: 'FROM', tip: '', min: 0, max: 100, step: 5, unit: '%' },
    { kind: 'range', key: 'to', tab: 'a', label: 'TO', tip: '', min: 0, max: 100, step: 5, unit: '%' },
    { kind: 'range', key: 'push', tab: 'a', label: 'PUSH', tip: '', min: -1, max: 1, step: 0.1, unit: '', signed: true, party: [-0.5, 0.5] },
    { kind: 'switch', key: 'on', tab: 'a', label: 'ON', tip: '', party: 0.5 },
    { kind: 'switch', key: 'never', tab: 'a', label: 'NEVER', tip: '', party: 0 },
    { kind: 'choice', key: 'kind', tab: 'a', label: 'KIND', tip: '', party: true, options: [{ value: 'x', label: 'X', tip: '' }, { value: 'y', label: 'Y', tip: '' }, { value: 'z', label: 'Z', tip: '' }] },
  ],
  widgets: [{ kind: 'band', id: 'span', tab: 'a', label: 'SPAN', tip: '', low: 'from', high: 'to', gap: 20 }],
  actions: [],
  defaults: { from: 20, to: 60, push: 0, on: false, never: false, kind: 'x' },
  looks: [],
};
const D = TOY.defaults;
assert.deepEqual(K.parseValues(TOY, null), D, 'nothing stored reads as the defaults');
assert.deepEqual(K.parseValues(TOY, { from: 'a', to: NaN, push: 9, on: 'yes', kind: 'q', other: 1 }), { ...D, push: 1 }, 'junk falls back, too much is held, unknown keys go');
assert.equal(K.parseValues(TOY, { push: 0.33 }).push, 0.3, 'a value between steps is snapped to one');
assert.deepEqual([K.withValue(TOY, D, 'from', 55).from, K.withValue(TOY, D, 'from', 55).to], [55, 75], 'the low end moved up: the high end gives way');
assert.deepEqual([K.withValue(TOY, D, 'to', 25).from, K.withValue(TOY, D, 'to', 25).to], [5, 25], 'the high end moved down: the low end gives way');
assert.deepEqual([K.withValue(TOY, D, 'to', 10).from, K.withValue(TOY, D, 'to', 10).to], [0, 20], 'and when there is no room left the band keeps its gap');
assert.deepEqual([K.withValue(TOY, D, 'from', 95).from, K.withValue(TOY, D, 'from', 95).to], [95, 100].map((v, n) => (n === 0 ? 80 : v)), 'at the top too');
assert.equal(K.withValue(TOY, D, 'nonsense', 3), D, 'a knob that does not exist changes nothing');
assert.equal(K.withValue(TOY, D, 'kind', 'q').kind, 'x', 'nor does a choice that is not offered');
assert.equal(K.shownValue(TOY.knobs[2], 0.5), '+0.5', 'a two-way knob is written with its sign');
assert.equal(K.shownValue(TOY.knobs[0], 40), '40%', 'the others with their unit');

for (let seed = 1; seed <= 300; seed += 1) {
  const random = seeded(seed);
  const party = K.partyValues(TOY, random);
  assert.deepEqual(K.parseValues(TOY, party), party, 'a party reads back as itself');
  assert.ok(party.to >= party.from + 20, 'and keeps the band apart');
  assert.ok(party.push >= -0.5 && party.push <= 0.5, 'inside what a party may pick');
  assert.equal(party.never, false, 'a switch a party may not touch stays as it came');
  const locked = K.partyValues(TOY, seeded(seed), { ...D, push: 1, kind: 'z' }, ['push', 'kind']);
  assert.ok(locked.push === 1 && locked.kind === 'z', 'locked knobs keep what they have through a party');
  const rolled = K.rolledValue(TOY.knobs[seed % TOY.knobs.length], random);
  const knob = TOY.knobs[seed % TOY.knobs.length];
  assert.ok(knob.kind === 'range' ? rolled >= knob.min && rolled <= knob.max : knob.kind === 'switch' ? typeof rolled === 'boolean' : ['x', 'y', 'z'].includes(rolled), 'a roll is a value the knob can have');
}
assert.ok(new Set(Array.from({ length: 40 }, (_, n) => K.partyValues(TOY, seeded(n + 1)).kind)).size === 3, 'a party picks among a choice`s options when it may');
const A = { from: 0, to: 100, push: -1, on: false, never: false, kind: 'x' };
const B = { from: 40, to: 60, push: 1, on: true, never: true, kind: 'z' };
assert.deepEqual(K.morphValues(TOY, A, B, 0), A, 'a morph starts at the first');
assert.deepEqual(K.morphValues(TOY, A, B, 1), B, 'and ends at the second');
assert.deepEqual(K.morphValues(TOY, A, B, 0.5), { from: 20, to: 80, push: 0, on: true, never: true, kind: 'z' }, 'half way: sliders half way, switches and choices changed over');
assert.equal(K.morphValues(TOY, A, B, 0.49).on, false, 'just before the middle they have not');
assert.deepEqual(K.keepingLocks(TOY, B, A, ['push', 'on']), { ...B, push: -1, on: false }, 'a look put on leaves locked knobs as they were');
assert.equal(K.keepingLocks(TOY, B, A, []), B, 'and with nothing locked is the look itself');
assert.ok(K.sameValues(TOY, { ...D, extra: 1 }, D) && !K.sameValues(TOY, { ...D, on: true }, D), 'two settings are the same when every knob is');

/* ------------------------------------------------------------------ 2. sway and bounce */
const push = TOY.knobs[2];
assert.deepEqual(K.firstSway(push, 0), [-0.4, 0.4], 'sway starts a fifth of the range either side of where the knob is');
assert.deepEqual(K.firstSway(push, 0.9), [0.5, 1], 'held to the range');
assert.deepEqual(K.parseSway(TOY, { push: [0.8, -0.2], on: [0, 1], from: [1], to: 'x', gone: [0, 1] }), { push: [-0.2, 0.8] }, 'stored sways: sliders only, two numbers, the lower first');
assert.deepEqual(K.parseLocks(TOY, ['push', 'gone', 'on']), ['push', 'on'], 'stored locks: only knobs that exist');
assert.deepEqual(K.parseLocks(TOY, 'push'), [], 'and only a list');
const period = K.swayPeriod(TOY, 'push');
const seen = new Set();
for (let t = 0; t <= period; t += period / 200) {
  const v = K.swayedValue(TOY, 'push', [-0.4, 0.6], t);
  assert.ok(v >= -0.4 && v <= 0.6, 'a swaying value stays between its marks');
  assert.ok(Math.abs(v * 10 - Math.round(v * 10)) < 1e-6, 'on the knob`s steps');
  seen.add(v);
}
assert.ok(seen.has(-0.4) && seen.has(0.6) && seen.size >= 10, 'and goes all the way to both, through the steps between');
assert.equal(K.swayedValue(TOY, 'push', [-0.4, 0.6], 0), K.swayedValue(TOY, 'push', [-0.4, 0.6], period), 'there and back in one period');
assert.notEqual(K.swayPeriod(TOY, 'from'), K.swayPeriod(TOY, 'push'), 'no two knobs keep the same time');
assert.equal(K.swayedValues(TOY, D, {}, 5), D, 'with nothing swaying the settings are the very same object');
assert.equal(K.swayedValues(TOY, D, { push: [0.2, 0.2] }, 5).push, 0.2, 'a swaying knob is where its sway has it');
let puck = { x: 0.5, y: 0.5, vx: 0.9, vy: -0.7 };
let turns = 0;
const walls = { left: 0, right: 0, top: 0, bottom: 0 };
for (let n = 0; n < 2000; n += 1) {
  const next = K.bouncedPuck(puck, 0.125);
  assert.ok(next.x >= 0 && next.x <= 1 && next.y >= 0 && next.y <= 1, 'a bouncing puck never leaves its pad');
  assert.ok(Math.abs(Math.abs(next.vx) - 0.9) < 1e-9 && Math.abs(Math.abs(next.vy) - 0.7) < 1e-9, 'and keeps its speed');
  if (next.vx !== puck.vx || next.vy !== puck.vy) turns += 1;
  if (next.vx !== puck.vx) walls[next.vx > 0 ? 'left' : 'right'] += 1;
  if (next.vy !== puck.vy) walls[next.vy > 0 ? 'top' : 'bottom'] += 1;
  puck = next;
}
for (const [wall, hits] of Object.entries(walls)) assert.ok(hits > 20, `it comes back off the ${wall} wall (${hits} times)`);
assert.ok(turns > 100, `turning back at the walls (${turns} turns)`);

/* ------------------------------------------------------------------ 3. the store */
process.env.NEXT_PUBLIC_SUPABASE_URL = '';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '';
process.env.NEXT_PUBLIC_AUTH_BACKEND = 'mock';
const stored = new Map();
global.window = {
  localStorage: { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) },
  addEventListener: () => {},
  removeEventListener: () => {},
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

(async () => {
  let store = fresh('lib/backdrops/store.js');
  const registry = require(path.join(OUT, 'lib/backdrops/registry.js'));
  assert.ok(registry.BACKDROP_DEFS.some((def) => def.id === 'aquarium'), 'the aquarium is one of the backgrounds');
  for (const def of registry.BACKDROP_DEFS) {
    assert.equal(registry.backdropDef(def.id), def, `${def.label} is found by its id`);
    assert.deepEqual(K.parseValues(def, def.defaults), def.defaults, `${def.label}: its defaults read back as themselves`);
    assert.equal(new Set(def.knobs.map((knob) => knob.key)).size, def.knobs.length, `${def.label}: no knob twice`);
    // [ THEME ] (Luke, 2026-11-16) is the one knob in no tab: the window draws it above the tabs (Temp/check-backdrop-theme.cjs).
    for (const knob of def.knobs) assert.ok(knob.key in def.defaults && (def.tabs.some((tab) => tab.id === knob.tab) || (knob.key === 'theme' && knob.tab === '')), `${def.label}: ${knob.key} has a default and a tab`);
    for (const widget of def.widgets) for (const key of widget.kind === 'pad' ? [widget.x, widget.y] : [widget.low, widget.high]) assert.ok(def.knobs.some((knob) => knob.key === key && knob.kind === 'range'), `${def.label}: ${widget.label} is made of sliders that exist`);
    for (const look of def.looks) assert.deepEqual(K.parseValues(def, look.values), look.values, `${def.label}: the ${look.label} look is in range`);
    assert.ok(def.looks.length === 0 || K.sameValues(def, def.looks[0].values, def.defaults), `${def.label}: its first look is the background as it comes`);
    for (let seed = 1; seed <= 50; seed += 1) assert.deepEqual(K.parseValues(def, K.partyValues(def, seeded(seed))), K.partyValues(def, seeded(seed)), `${def.label}: a party is in range`);
    assert.ok(JSON.stringify(def.defaults).length < 1200, `${def.label}: its settings are a small thing to save`);
  }
  assert.equal(registry.backdropDef('tile'), null, 'TILE has no settings');
  assert.equal(store.backdropValues('aquarium'), registry.backdropDef('aquarium').defaults, 'a browser with nothing stored holds the defaults themselves');
  assert.deepEqual(store.backdropExtras('aquarium'), { locks: [], sway: {} }, 'nothing locked, nothing swaying');

  store.setBackdropLock('aquarium', 'count', true);
  store.setBackdropSway('aquarium', 'speed', [2, 0.5]);
  assert.deepEqual(store.backdropExtras('aquarium'), { locks: ['count'], sway: { speed: [0.5, 2] } }, 'a lock and a sway are held (the sway`s lower mark first)');
  const kept = JSON.parse(stored.get('debaser.site.aquarium.v1'));
  assert.deepEqual([kept._locks, kept._sway, kept.count], [['count'], { speed: [0.5, 2] }, 4], 'and kept in this browser beside the values');
  store = fresh('lib/backdrops/store.js');
  assert.deepEqual(store.backdropExtras('aquarium'), { locks: ['count'], sway: { speed: [0.5, 2] } }, 'a reload reads them back');
  store.setBackdropLock('aquarium', 'count', true);
  store.setBackdropSway('aquarium', 'speed', [0.5, 2]);
  const before = store.backdropExtras('aquarium');
  assert.equal(store.backdropExtras('aquarium'), before, 'setting what is already so changes nothing');

  await store.setBackdropAccount('person-a');
  const row = JSON.parse(stored.get('debaser.aquarium.mock.v1'))['person-a'];
  assert.deepEqual([row._locks, row._sway, row.backdrop, row.count], [['count'], { speed: [0.5, 2] }, 'fluid', undefined], 'signing in carries the locks and sways to the account (a knob that is as it comes is left out of the row; the background saved is the one on, FLUID by default since 2026-11-16)');
  store.setBackdropSway('aquarium', 'speed', null);
  store.setBackdropLock('aquarium', 'size', true);
  store.flushBackdropSave();
  await settle();
  const after = JSON.parse(stored.get('debaser.aquarium.mock.v1'))['person-a'];
  assert.deepEqual([after._locks, after._sway], [['count', 'size'], undefined], 'changes to them are saved like any other');

  // Another machine.
  const account = stored.get('debaser.aquarium.mock.v1');
  stored.clear();
  stored.set('debaser.aquarium.mock.v1', account);
  store = fresh('lib/backdrops/store.js');
  await store.setBackdropAccount('person-a');
  assert.deepEqual([...store.backdropExtras('aquarium').locks].sort(), ['count', 'size'], 'another machine gets the locks with the account');

  // The account's row is lean: only what differs from how a background comes, so five of them fit well inside what the table allows.
  const defs = registry.BACKDROP_DEFS;
  const scenesOf = (make) => Object.fromEntries(defs.map((def) => [def.id, make(def)]));
  const plain = store.rowObject({ scenes: scenesOf((def) => ({ values: def.defaults, extras: { locks: [], sway: {} } })), backdrop: 'aquarium' });
  assert.deepEqual(plain, { v: 1, backdrop: 'aquarium' }, 'every background as it comes: the row is two words');
  const busy = { scenes: scenesOf((def) => ({ values: K.partyValues(def, seeded(def.id.length + 3)), extras: { locks: def.knobs.slice(0, 3).map((knob) => knob.key), sway: Object.fromEntries(def.knobs.filter((knob) => knob.kind === 'range').slice(0, 4).map((knob) => [knob.key, [knob.min, knob.max]])) } })), backdrop: 'sand' };
  const busyRow = store.rowObject(busy);
  assert.ok(JSON.stringify(busyRow).length < 2600, `a party on all five, with locks and sways on each: ${JSON.stringify(busyRow).length} characters of the 4096 the table allows`);
  const back = store.parseSavedBackdrops(JSON.parse(JSON.stringify(busyRow)));
  for (const def of defs) {
    assert.ok(K.sameValues(def, back.scenes[def.id].values, busy.scenes[def.id].values), `${def.label}: a lean row reads back as the same settings`);
    assert.deepEqual([...back.scenes[def.id].extras.locks].sort(), [...busy.scenes[def.id].extras.locks].sort(), `${def.label}: and the same locks`);
    assert.deepEqual(back.scenes[def.id].extras.sway, busy.scenes[def.id].extras.sway, `${def.label}: and the same sways`);
  }
  assert.equal(back.backdrop, 'sand', 'and the same background on');
  // The worst there could be: every knob of every background changed, locked and swaying. It is trimmed rather than refused.
  const most = { scenes: scenesOf((def) => ({ values: K.parseValues(def, Object.fromEntries(def.knobs.map((knob) => [knob.key, knob.kind === 'range' ? (def.defaults[knob.key] === knob.max ? knob.min : knob.max) : knob.kind === 'switch' ? !def.defaults[knob.key] : knob.options[knob.options.length - 1].value]))), extras: { locks: def.knobs.map((knob) => knob.key), sway: Object.fromEntries(def.knobs.filter((knob) => knob.kind === 'range').map((knob) => [knob.key, [knob.min, knob.max]])) } })), backdrop: 'fluid' };
  const mostRow = store.rowObject(most);
  assert.ok(JSON.stringify(mostRow).length <= store.ROW_ROOM && store.ROW_ROOM < 3600, `even then the row is kept inside the table's limit (${JSON.stringify(mostRow).length} characters)`);
  const trimmed = store.parseSavedBackdrops(JSON.parse(JSON.stringify(mostRow)));
  for (const def of defs) assert.ok(K.sameValues(def, trimmed.scenes[def.id].values, most.scenes[def.id].values), `${def.label}: by shedding sways and locks, never a knob's value`);
  assert.ok(Object.keys(trimmed.scenes.fluid.extras.sway).length > 0, 'and the background that is on is the last to lose its own');

  // A knob changed while the account is still being read: that background keeps what was just set, the others are the account's.
  stored.clear();
  stored.set('debaser.aquarium.mock.v1', JSON.stringify({ 'person-c': store.rowObject({ scenes: scenesOf((def) => ({ values: K.withValue(def, def.defaults, def.knobs.find((knob) => knob.kind === 'range').key, def.knobs.find((knob) => knob.kind === 'range').max), extras: { locks: [], sway: {} } })), backdrop: 'aquarium' }) }));
  store = fresh('lib/backdrops/store.js');
  const reading = store.setBackdropAccount('person-c');
  const sandDef = registry.backdropDef('sand');
  store.setBackdropValues('sand', K.withValue(sandDef, sandDef.defaults, 'brush', 9));
  await reading;
  assert.equal(store.backdropValues('sand').brush, 9, 'the knob touched during the read keeps what it was set to');
  assert.equal(store.backdropValues('aquarium').size, 12, 'and a background that was not touched is as the account had it');
  store.flushBackdropSave();
  await settle();
  const mergedRow = JSON.parse(stored.get('debaser.aquarium.mock.v1'))['person-c'];
  assert.ok(mergedRow.size === 12 && mergedRow.scenes.sand.brush === 9, 'which is what the account is then given: nothing it held is lost');

  // A row from before there were other backgrounds: the aquarium's knobs at the top level, nothing else.
  const old = store.parseSavedBackdrops({ v: 1, size: 3, rainbow: true, backdrop: 'tile' });
  assert.deepEqual([old.scenes.aquarium.values.size, old.scenes.aquarium.values.rainbow, old.backdrop], [3, true, 'tile'], 'an account row from before reads as it did');
  for (const def of registry.BACKDROP_DEFS) assert.ok(old.scenes[def.id] !== undefined, `and gives ${def.label} its defaults`);
  const junk = store.parseSavedBackdrops({ scenes: 'no', backdrop: 7, _locks: 'x', _sway: [] });
  assert.deepEqual(junk.scenes.aquarium.extras, { locks: [], sway: {} }, 'junk in a row is read as nothing');

  /* ---------------------------------------------------------------- 4. the runtime */
  stored.clear();
  store = fresh('lib/backdrops/store.js');
  const runtime = require(path.join(OUT, 'lib/backdrops/runtime.js'));
  assert.equal(runtime.liveValues('aquarium'), store.backdropValues('aquarium'), 'with nothing moving the live settings are the stored ones, the very same object');
  assert.equal(runtime.padIsBouncing('aquarium', 'water'), false, 'no pad bounces until it is let go');
  assert.deepEqual(runtime.padPuck('aquarium', 'water'), { x: 0.5, y: 0.5 }, 'the puck sits where its two knobs are: at rest, the middle');
  runtime.startBounce('aquarium', 'water', { x: 0.75, y: 0.25, vx: 0, vy: 0 });
  assert.equal(runtime.padIsBouncing('aquarium', 'water'), true, 'BOUNCE lets it go');
  const live = runtime.liveValues('aquarium');
  assert.deepEqual([live.current, live.gravity], [50, -50], 'and the two knobs go where the puck is');
  assert.equal(store.backdropValues('aquarium').current, 0, 'without the stored settings changing (nothing is saved while it bounces)');
  await new Promise((resolve) => setTimeout(resolve, 450));
  const later = runtime.padPuck('aquarium', 'water');
  assert.ok(later.x !== 0.75 || later.y !== 0.25, 'a puck let go at rest is given a push: it moves');
  runtime.stopBounce('aquarium', 'water');
  assert.equal(runtime.padIsBouncing('aquarium', 'water'), false, 'catching it stops it');
  const caught = store.backdropValues('aquarium');
  assert.ok(Math.abs(caught.current - (later.x * 200 - 100)) <= 12.5 && caught.current % 5 === 0, 'and the knobs stay where it was caught, on their steps');
  assert.equal(runtime.liveValues('aquarium'), caught, 'the live settings are the stored ones again');
  let heard = null;
  const stop = runtime.onBackdropAction('aquarium', (action) => (heard = action));
  runtime.fireBackdropAction('aquarium', 'giant');
  assert.equal(heard, 'giant', 'a window`s one-press key reaches its background');
  stop();
  runtime.setActionActive('aquarium', 'giant', true);
  assert.deepEqual(runtime.activeActions(), ['aquarium:giant'], 'which can say it is on for a while');
  runtime.setActionActive('aquarium', 'giant', false);
  runtime.setBackdropMeters([{ id: 'n', label: 'N', value: 3, most: 10 }]);
  runtime.setBackdropMeters([{ id: 'n', label: 'N', value: 5, most: 10 }]);
  assert.deepEqual(runtime.backdropMeters()[0].history, [3, 5], 'a meter keeps its last readings');
  for (let n = 0; n < 60; n += 1) runtime.setBackdropMeters([{ id: 'n', label: 'N', value: n, most: 10 }]);
  assert.equal(runtime.backdropMeters()[0].history.length, 48, 'forty-eight of them');
  runtime.setBackdropMeters([]);
  assert.equal(runtime.ghostState(), 'off', 'no ghost pointer until one is recorded');
  delete global.window;

  /* ---------------------------------------------------------------- 5. the window draws the new controls */
  const { BackdropKnobs } = require('./backdrops-out/components/BackdropSettingsWindow.js');
  const fish = renderToString(React.createElement(BackdropKnobs, { id: 'aquarium' })).replace(/<!-- -->/g, '');
  assert.match(fish, /data-backdrop-band="depth"/, 'a band: one strip for HIGHEST and LOWEST');
  assert.equal((fish.match(/role="slider"/g) ?? []).length, 2, 'with two handles a keyboard can move');
  assert.match(fish, /data-backdrop-sway="size"/, 'a sway key beside a slider');
  assert.match(fish, /data-backdrop-roll="size"/, 'a roll key');
  assert.match(fish, /data-backdrop-lock="size"/, 'a lock key');
  assert.match(fish, /data-backdrop-morph=""/, 'MORPH at the foot');
  assert.match(fish, /\[ RECORD POINTER \]/, 'and the ghost pointer`s key');
  assert.doesNotMatch(fish, /data-backdrop-knob="depthTop"/, 'the two sliders the band stands for are not drawn again');
  assert.equal(renderToString(React.createElement(BackdropKnobs, { id: 'nothing' })), '', 'a background with no settings draws no knobs');

  /* ---------------------------------------------------------------- 6. nothing from the server */
  const Backdrops = require('./backdrops-out/components/backdrops/Backdrops.js').default;
  const CanvasBackdrop = require('./backdrops-out/components/backdrops/CanvasBackdrop.js').default;
  assert.equal(renderToString(React.createElement(Backdrops)), '', 'the server draws no simulated background');
  const engine = { id: 'toy', cell: () => 4, rate: () => 30, init: () => ({}), step: () => {}, render: () => {}, stillSteps: 0 };
  assert.equal(renderToString(React.createElement(CanvasBackdrop, { engine })), '', 'whichever engine it is given');
  for (const def of registry.BACKDROP_DEFS.filter((each) => each.id !== 'aquarium')) {
    assert.ok(fs.readFileSync('app/components/backdrops/Backdrops.tsx', 'utf8').includes(`${def.id}Engine`), `${def.label} is mounted by the shell`);
    assert.ok(require(path.join(OUT, 'lib/ui/backdrop-slot.js')).BACKDROPS.some((row) => row.id === def.id), `and offered in PREFERENCES`);
  }

  // On a stage (the surround of a fullscreen picture): still nothing from the server.
  const { StageBackdrop } = require('./backdrops-out/components/backdrops/Backdrops.js');
  assert.equal(renderToString(React.createElement(StageBackdrop)), '', 'nor a background on a stage');
  const runtimeSource = fs.readFileSync('app/lib/backdrops/runtime.ts', 'utf8');
  assert.match(runtimeSource, /if \(document\.fullscreenElement !== null\) return true;/, 'the page`s own background rests while something is fullscreen');
  // The site window put away (HIDE WINDOW; Luke, 2026-11-16: the background acted as if the window were still there).
  {
    const had = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element };
    class FakeElement {
      constructor(inside = []) {
        this.inside = inside;
      }
      closest(selector) {
        return this.inside.includes(selector) ? this : null;
      }
    }
    const marks = new Map();
    const html = new FakeElement();
    const body = new FakeElement();
    html.getAttribute = (name) => marks.get(name) ?? null;
    let filledPage = false;
    globalThis.Element = FakeElement;
    globalThis.document = { fullscreenElement: null, documentElement: html, body, querySelector: (selector) => (selector === '[data-page-fill]' && filledPage ? {} : null) };
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    try {
      const desk = new FakeElement(['[data-site-window="desk"]']);
      const inWindow = new FakeElement(['[data-site-window="desk"]', '[data-site-window="frame"]']);
      const dock = new FakeElement(['[data-dock-window]']);
      assert.equal(runtime.onBareBackground(desk), true, 'a press on the desk round the site window is on the bare background');
      assert.equal(runtime.onBareBackground(inWindow), false, 'one inside the site window is not');
      assert.equal(runtime.onBareBackground(dock), false, 'nor one on a docked window');
      assert.equal(runtime.onBareBackground(body), false, 'nor, with the window there, one that somehow reached the page`s body');
      assert.equal(runtime.onBareBackground(null), false);
      assert.equal(runtime.backgroundCovered(), false, 'the background shows round a window of the usual size');
      marks.set('data-site-fill', 'on');
      assert.equal(runtime.backgroundCovered(), true, 'FILL WINDOW covers it: it rests');
      marks.set('data-site-hidden', 'on');
      assert.equal(runtime.backgroundCovered(), false, 'put away, a filled window covers nothing: the background runs');
      marks.delete('data-site-fill');
      filledPage = true;
      assert.equal(runtime.backgroundCovered(), false, 'nor does a page that fills by itself, put away');
      assert.equal(runtime.onBareBackground(body), true, 'put away, the desk lets the pointer through: a press that lands on the page`s body is on the bare background');
      assert.equal(runtime.onBareBackground(html), true, 'or on the page itself');
      assert.equal(runtime.onBareBackground(dock), false, 'a docked window is still a window');
      globalThis.document.fullscreenElement = {};
      assert.equal(runtime.backgroundCovered(), true, 'something fullscreen still covers it, put away or not');
    } finally {
      globalThis.document = had.document;
      globalThis.window = had.window;
      globalThis.Element = had.Element;
    }
  }
  const canvasSource = fs.readFileSync('app/components/backdrops/CanvasBackdrop.tsx', 'utf8');
  assert.match(canvasSource, /: onBareBackground\(target\);/, 'a simulated background takes its presses by that rule');
  assert.match(fs.readFileSync('app/components/Aquarium.tsx', 'utf8'), /: !onBareBackground\(event\.target\)\) return;/, 'and so does the sea');
  assert.match(canvasSource, /const stopHidden = stage \? \(\) => undefined : subscribeToSiteHidden\(again\);/, 'with motion off, the still frame is made again when the window is put away or brought back');
  assert.match(canvasSource, /covered = !stage && backgroundCovered\(\);/, 'and the copy on the stage does not');

  console.log('backdrops');
  console.log('  machinery : bands, rolls, parties, locks, morphs on a made-up background and every real one');
  console.log('  motion    : sway between its marks on its steps; a bouncing puck stays on its pad');
  console.log('  store     : locks and sways kept in the browser and the account row; an old row still reads');
  console.log('  runtime   : live values are the stored ones until something moves; a caught puck leaves its knobs where it was');
  console.log('  window    : band, sway, roll, lock, morph and ghost keys are drawn');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
