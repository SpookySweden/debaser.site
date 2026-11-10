/*
 * Letters on screen (SPEC-letters.md, Luke 2026-11-10): what the canvas, the envelope, the window, the pop-up, the settings
 * and the ADD TO LETTER key draw, and where a new card lands. (Who may read and write is check-letters.cjs, on the live
 * database.) Run from the root:
 *   npx tsc app/components/LetterWindow.tsx app/components/ProfileLetters.tsx app/components/AddToLetterKey.tsx app/lib/letters/placement.ts app/lib/letters/things.ts --rootDir app --outDir Temp/letters-render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-letters-render.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const el = React.createElement;
const OUT = path.join(__dirname, 'letters-render-out');

function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

let auth = { status: 'anonymous', user: null };
stub(path.join(OUT, 'components/AuthProvider.js'), { useAuth: () => auth });
stub(path.join(OUT, 'components/DockWindow.js'), { default: ({ title, children }) => el('section', { 'data-window': title }, children) });
stub(path.join(OUT, 'components/PopoutWindow.js'), { default: ({ title, children, actions }) => el('div', { 'data-popout': title }, children, actions) });
stub(path.join(OUT, 'components/SpriteSlot.js'), { default: ({ src }) => el('span', { 'data-slot': src }) });
stub(path.join(OUT, 'components/NameColourWindow.js'), { nameInkStyle: (hex) => ({ '--name-ink': hex }) });
stub(path.join(OUT, 'components/WebStream.js'), { WebRow: ({ item }) => el('li', { 'data-web-row': item.id }) });
stub(path.join(OUT, 'lib/web/use-web-item.js'), { useWebItem: () => undefined });
let asked = '';
stub('next/navigation', {
  useSearchParams: () => new URLSearchParams(asked),
  usePathname: () => '/forum',
  useRouter: () => ({ replace: () => undefined }),
});

const { placeCard, scatter } = require('./letters-render-out/lib/letters/placement.js');
const { hrefOf, isWebAddress, cardPicture, verbOf } = require('./letters-render-out/lib/letters/things.js');
const store = require('./letters-render-out/lib/letters/store.js');
const { openLetter } = require('./letters-render-out/lib/letters/letter-window.js');
const LetterCanvas = require('./letters-render-out/components/LetterCanvas.js').default;
const LetterStamp = require('./letters-render-out/components/LetterStamp.js').default;
const LetterWindow = require('./letters-render-out/components/LetterWindow.js').default;
const LetterItemPopout = require('./letters-render-out/components/LetterItemPopout.js').default;
const LetterSettings = require('./letters-render-out/components/LetterSettings.js').default;
const ProfileLetters = require('./letters-render-out/components/ProfileLetters.js').default;
const AddToLetterKey = require('./letters-render-out/components/AddToLetterKey.js').default;

(async () => {
  /* 1. Where a card lands ------------------------------------------------------------------ */
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const taken = [];
  for (let i = 0; i < 30; i += 1) {
    const spot = placeCard(taken, random);
    assert.ok(spot.x >= 0.1 && spot.x <= 0.9 && spot.y >= 0.12 && spot.y <= 0.88, 'a card lands clear of the edges');
    assert.ok(Number.isInteger(spot.turn) && Math.abs(spot.turn) <= 8, 'with a slight whole-degree tilt');
    taken.push(spot);
  }
  const nearest = (list) => Math.min(...list.map((a, i) => Math.min(...list.filter((_, j) => j !== i).map((b) => Math.hypot(a.x - b.x, a.y - b.y)))));
  assert.ok(nearest(taken.slice(0, 8)) > 0.12, 'the first few keep well apart, not piled up');
  const shuffled = scatter([{ id: 'a' }, { id: 'b' }, { id: 'c' }], random);
  assert.deepEqual(shuffled.map((card) => card.id), ['a', 'b', 'c'], 'SHUFFLE moves every card, and only those');
  console.log('  ok    where a card lands');

  /* 2. Where a thing opens ----------------------------------------------------------------- */
  assert.equal(hrefOf({ kind: 'thread', ref: 't1', title: '' }), '/forum#thread-t1');
  assert.equal(hrefOf({ kind: 'profile', ref: 'u 1', title: '' }), '/profile/u%201');
  assert.equal(hrefOf({ kind: 'link', ref: 'javascript:alert(1)', title: '' }), '/', 'a link that is not a web address goes nowhere');
  assert.equal(isWebAddress('https://example.org/a'), true);
  assert.equal(isWebAddress('javascript:alert(1)'), false);
  assert.equal(cardPicture('http://example.org/x.png'), undefined, 'a card shows only an https or site picture');
  assert.equal(cardPicture('//evil.example/x.png'), undefined);
  assert.equal(verbOf('song'), 'LISTEN');
  assert.equal(verbOf('lore'), 'READ');
  assert.equal(verbOf('kino'), 'WATCH');
  console.log('  ok    where a thing opens');

  /* 3. The canvas ------------------------------------------------------------------------- */
  const letter = {
    id: 'L1', owner: 'me', name: 'SUMMER', description: 'warm things', textColour: '#e6004c', stampUrl: 'https://example.org/stamp.png',
    stampOpacity: 30, stampDensity: 4, isPublic: false, createdAt: '', updatedAt: '',
  };
  const items = [
    { id: 'i1', letterId: 'L1', kind: 'web', ref: 'youtube:abc', title: 'A VIDEO', picture: 'https://i.ytimg.com/vi/abc/0.jpg', x: 0.4, y: 0.6, turn: 5, addedAt: '' },
    { id: 'i2', letterId: 'L1', kind: 'lore', ref: 'the-city', title: 'THE CITY', x: 0.2, y: 0.3, turn: -3, addedAt: '' },
  ];
  const canvas = renderToStaticMarkup(el(LetterCanvas, { letter, items, onOpen: () => undefined }));
  assert.match(canvas, /opacity:0\.3/, 'the stamp pattern is drawn at the letter`s opacity');
  assert.match(canvas, /background-size:25% auto/, 'and repeats four times across at density 4');
  assert.match(canvas, /left:40%;top:60%;transform:translate\(-50%, -50%\) rotate\(5deg\)/, 'a card sits where it landed, tilted');
  assert.match(canvas, /i\.ytimg\.com/, 'a card shows its picture');
  assert.match(canvas, />LORE</, 'a thing with no picture shows its kind');
  const empty = renderToStaticMarkup(el(LetterCanvas, { letter: { ...letter, stampUrl: undefined }, items: [], onOpen: () => undefined }));
  assert.match(empty, /NOTHING HERE YET/, 'an empty letter says how to fill it');
  assert.doesNotMatch(empty, /background-image/, 'and with no picture there is no pattern');
  const envelope = renderToStaticMarkup(el(LetterStamp, { letter }));
  assert.match(envelope, /data-slot="\/assets\/letters\/envelope\.png"/, 'the envelope is Luke`s drawing, through its slot');
  assert.match(envelope, /rounded-full[^>]*><img src="https:\/\/example\.org\/stamp\.png"/, 'the stamp is the letter`s picture, round');
  console.log('  ok    the canvas and the envelope');

  /* 4. The window: the owner's keys, and no one else's -------------------------------------- */
  auth = { status: 'signed-in', user: { id: 'me' } };
  const mine = await store.createLetter('me', 'SUMMER');
  await store.updateLetter(mine.id, { description: 'warm things', textColour: '#e6004c' });
  assert.notEqual(await store.addThing(mine.id, { kind: 'lore', ref: 'the-city', title: 'THE CITY' }), 'already');
  assert.equal(await store.addThing(mine.id, { kind: 'lore', ref: 'the-city', title: 'THE CITY' }), 'already', 'the same thing twice is refused');
  await store.addThing(mine.id, { kind: 'link', ref: 'https://example.org/', title: 'EXAMPLE' });
  openLetter(mine.id);
  const window1 = renderToStaticMarkup(el(LetterWindow));
  assert.match(window1, /SUMMER/, 'the window is headed with the letter`s name');
  assert.match(window1, /--name-ink:#e6004c/, 'in its text colour');
  assert.match(window1, /\[ ⚙ \]/, 'the owner has the cog');
  assert.match(window1, /\[ 🔒 PRIVATE \]/, 'and the lock, closed for a new letter');
  assert.match(window1, /\[ SHUFFLE \]/, 'and SHUFFLE');
  assert.match(window1, /PASTE A LINK/, 'and can paste a link');
  assert.equal((window1.match(/aria-label="(LORE|LINK): /g) ?? []).length, 2, 'both things are on the canvas');
  auth = { status: 'signed-in', user: { id: 'someone-else' } };
  const window2 = renderToStaticMarkup(el(LetterWindow));
  assert.doesNotMatch(window2, /⚙|PRIVATE|SHUFFLE|PASTE A LINK/, 'someone else gets none of the owner`s keys');
  console.log('  ok    the letter window');

  /* 5. The pop-up: the key that fits, and a link that leaves safely -------------------------- */
  const link = renderToStaticMarkup(el(LetterItemPopout, { item: { ...items[1], kind: 'link', ref: 'https://example.org/', title: 'EXAMPLE' }, owner: false, onClose: () => undefined }));
  assert.match(link, /href="https:\/\/example\.org\/" target="_blank" rel="noopener noreferrer nofollow"/, 'a pasted link opens in a new tab, safely');
  assert.doesNotMatch(link, /TAKE OUT/, 'only the owner can take a thing out');
  const lore = renderToStaticMarkup(el(LetterItemPopout, { item: items[1], owner: true, onClose: () => undefined }));
  assert.match(lore, /href="\/lore\/the-city"[^>]*>READ</, 'a lore page says READ and goes to its page');
  assert.match(lore, /\[ TAKE OUT \]/, 'the owner can take it out');
  const web = renderToStaticMarkup(el(LetterItemPopout, { item: items[0], owner: false, onClose: () => undefined }));
  assert.match(web, /READING\.\.\./, 'a MEDIA row says so while it is read, then draws as MEDIA draws it');
  console.log('  ok    the pop-up');

  /* 6. Settings: the picture's sliders beside it, and the swatches ----------------------------- */
  const settings = renderToStaticMarkup(el(LetterSettings, { letter: { ...letter, stampOpacity: 30, stampDensity: 4 }, items, onClose: () => undefined }));
  assert.match(settings, /OPACITY[\s\S]*value="30"[\s\S]*30%/, 'the opacity slider starts at 30%');
  assert.match(settings, /DENSITY[\s\S]*value="4"/, 'and the density slider beside it');
  assert.match(settings, /OR PICK ONE FROM THIS LETTER/, 'a picture can be picked from the letter');
  assert.match(settings, /aria-label="ROSE"/, 'the text colours are the name-colour swatches');
  assert.match(settings, /\[ DELETE LETTER \]/);
  console.log('  ok    the settings');

  /* 7. ADD TO LETTER and the profile's list, signed out and in -------------------------------- */
  auth = { status: 'anonymous', user: null };
  assert.equal(renderToStaticMarkup(el(AddToLetterKey, { thing: { kind: 'lore', ref: 'x', title: 'X' } })), '', 'signed out, there is no key');
  auth = { status: 'signed-in', user: { id: 'me' } };
  assert.match(renderToStaticMarkup(el(AddToLetterKey, { thing: { kind: 'lore', ref: 'x', title: 'X' } })), /\[ \+ LETTER \]/, 'signed in, there is');
  assert.equal(renderToStaticMarkup(el(ProfileLetters, { userId: 'nobody', owner: false })), '', 'a profile with no letters to show shows nothing to a visitor');
  assert.match(renderToStaticMarkup(el(ProfileLetters, { userId: 'me', owner: true })), /\[ \+ NEW LETTER \]/, 'its owner can start one');
  console.log('  ok    the key and the profile');
  console.log('letters render checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
