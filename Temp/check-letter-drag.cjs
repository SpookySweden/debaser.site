/*
 * Sending a whole letter to a person (SPEC-letter-drag.md, Luke 2026-11-14: "you can drag and drop letters from the profile
 * page to users on the sidebar or directly to a users character to reccomend them the letter"): what is sent, the note a
 * passed-on letter carries, what the sender is told, what is refused, and what a side-panel row writes on itself so a
 * drop can find it. The made-up stores stand in for the database, with its rules. (The carrying itself, in a browser, is
 * scripts/drive-letter-drag.cjs; who may read a sent letter is check-recommendations.cjs, on the live database.)
 * Run from the root:
 *   npx tsc app/lib/recommendations/send-letter.ts app/lib/letters/letter-drag.ts --rootDir app --outDir Temp/letter-drag-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-letter-drag.cjs
 */
const assert = require('node:assert/strict');

const { EMPTY_LETTER, letterCopy, letterNote, lookOf, placesByThing, sendLetterTo, sentLine } = require('./letter-drag-out/lib/recommendations/send-letter.js');
const { getLettersRepository } = require('./letter-drag-out/lib/letters/repository.js');
const { getRecommendationsRepository } = require('./letter-drag-out/lib/recommendations/repository.js');
const { letterCatcherProps } = require('./letter-drag-out/lib/letters/letter-drag.js');

(async () => {
  /* 1. The words ---------------------------------------------------------------------------- */
  assert.equal(letterNote('  for the bus ', null), 'for the bus', 'your own letter carries only what you wrote');
  assert.equal(letterNote('', null), '', 'or nothing');
  assert.equal(letterNote('', 'sweden'), "FROM sweden'S LETTERS", 'a passed-on letter says whose it is');
  assert.equal(letterNote('you will like it', 'sweden'), "FROM sweden'S LETTERS: you will like it", 'then what you wrote');
  assert.equal(letterNote('x'.repeat(400), 'sweden').length, 200, 'held to what a recommendation`s message holds');
  assert.equal(sentLine('MIXTAPE', ['BEE'], 0), 'SENT "MIXTAPE" TO BEE', 'the sender is told what went to whom');
  assert.equal(sentLine('MIXTAPE', ['BEE', 'SEA'], 0), 'SENT "MIXTAPE" TO 2 PEOPLE');
  assert.equal(sentLine('MIXTAPE', ['BEE'], 10), 'SENT "MIXTAPE" TO BEE (ITS FIRST 50 THINGS)', 'and when a long letter was cut');
  console.log('  ok    the words');

  /* 2. The copy ----------------------------------------------------------------------------- */
  const look = lookOf({ id: 'L', owner: 'me', name: 'MIXTAPE', description: 'songs', textColour: '#e6004c', stampUrl: undefined, stampOpacity: 30, stampDensity: 4, isPublic: false, createdAt: '', updatedAt: '' });
  assert.deepEqual(Object.keys(look).sort(), ['description', 'name', 'stampDensity', 'stampOpacity', 'stampUrl', 'textColour'], 'only the look travels: no id, no owner, no dates');
  const spots = placesByThing([{ kind: 'link', ref: 'a', x: 0.2, y: 0.3, turn: 4 }]);
  const copy = letterCopy(look, [{ kind: 'link', ref: 'a' }, { kind: 'link', ref: 'b' }], spots);
  assert.deepEqual(copy.places[0], { x: 0.2, y: 0.3, turn: 4 }, 'a card keeps the spot it had on the letter');
  assert.ok(copy.places[1].x >= 0 && copy.places[1].x <= 1, 'and a thing with no spot lands somewhere on the canvas');
  assert.equal(copy.name, 'MIXTAPE');
  console.log('  ok    the copy');

  /* 3. Sending, against the made-up stores -------------------------------------------------- */
  const letters = getLettersRepository();
  const recs = getRecommendationsRepository();
  const sender = { id: 'me', name: 'ME' };
  const mine = await letters.create('me', 'MIXTAPE');
  await assert.rejects(sendLetterTo({ letter: mine, to: ['bee'], ownerName: null, sender }), new RegExp(EMPTY_LETTER), 'an empty letter is refused');
  assert.equal((await recs.list('sent')).length, 0, 'and nothing went');
  await letters.addItem(mine.id, { kind: 'link', ref: 'https://example.org/a', title: 'A' }, { x: 0.2, y: 0.3, turn: 4 });
  await letters.addItem(mine.id, { kind: 'link', ref: 'https://example.org/b', title: 'B' }, { x: 0.6, y: 0.7, turn: -2 });
  await assert.rejects(sendLetterTo({ letter: mine, to: [], ownerName: null, sender }), /PICK SOMEONE/, 'nobody picked: refused');
  await assert.rejects(sendLetterTo({ letter: mine, to: ['me'], ownerName: null, sender }), /NOT TO YOURSELF/, 'yourself: refused, as the database does');
  const sent = await sendLetterTo({ letter: mine, to: ['bee', 'bee'], ownerName: null, sender });
  assert.deepEqual({ things: sent.things, left: sent.left }, { things: 2, left: 0 });
  const [row] = await recs.list('sent');
  assert.equal(row.id, sent.id);
  assert.equal(row.title, 'MIXTAPE', 'it is titled by the letter`s name');
  assert.equal(row.message, '', 'with no note unless one was written');
  assert.equal(row.isPublic, false, 'never public: it goes to the people named');
  assert.equal(row.itemCount, 2);
  assert.deepEqual(row.letter.places, [{ x: 0.2, y: 0.3, turn: 4 }, { x: 0.6, y: 0.7, turn: -2 }], 'the letter goes with it, its cards where they sat');
  assert.deepEqual((await recs.items(sent.id)).map((item) => item.title), ['A', 'B'], 'and its things in order');

  const passed = await sendLetterTo({ letter: { ...mine, owner: 'sweden' }, to: ['bee'], note: 'look', ownerName: 'sweden', sender });
  assert.equal((await recs.list('sent')).find((rec) => rec.id === passed.id).message, "FROM sweden'S LETTERS: look", 'somebody else`s letter is passed on under their name');

  const long = await letters.create('me', 'LONG ONE');
  for (let at = 0; at < 60; at += 1) await letters.addItem(long.id, { kind: 'link', ref: `https://example.org/${at}`, title: `T${at}` }, { x: 0.5, y: 0.5, turn: 0 });
  const cut = await sendLetterTo({ letter: long, to: ['bee'], ownerName: null, sender });
  assert.deepEqual({ things: cut.things, left: cut.left }, { things: 50, left: 10 }, 'a long letter sends its first 50 and says how many stayed');
  assert.equal((await recs.items(cut.id)).length, 50);
  console.log('  ok    sending');

  /* 4. What a row writes on itself ---------------------------------------------------------- */
  assert.deepEqual(letterCatcherProps('bee', false), { 'data-letter-catcher': 'bee' }, 'a row says whose it is');
  assert.deepEqual(letterCatcherProps('me', true), {}, 'your own row says nothing: it never catches');
  console.log('  ok    the catcher');
  console.log('letter drag checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
