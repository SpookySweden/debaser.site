/**
 * Carrying a letter to a person, in a real browser (SPEC-letter-drag.md; Luke, 2026-11-14). Not in `npm run checks`: it
 * needs a running site. Pictures go to `Temp/browse/letter-drag/`.
 *
 *   node scripts/drive-letter-drag.cjs --base http://localhost:3314 --mock
 *       On a local copy where everything is made up (`node Temp/dev-live-data.cjs 3314 --mock`): three made-up people
 *       live in the browser's own memory, so the whole path is driven, sends included. [ SEND TO ] with a note, then a
 *       letter carried over the side panel (Escape, a drop on nothing, a drop on a person, an empty letter), then both
 *       recommendations read back on RECOMMENDATIONS > SENT. Nothing reaches the database.
 *
 *   node scripts/drive-letter-drag.cjs [--base https://debaser-site.vercel.app]
 *       On the real site as TEST ACCOUNT A, among real people: a letter is carried over a real person's row, the drive
 *       reads that the row lit up and the envelope names them, and presses ESCAPE. It NEVER lets go over a person and
 *       never presses SEND, and to make a slip impossible the browser is forbidden to call `recommendation_send` at all.
 *
 *   node scripts/drive-letter-drag.cjs --room
 *       The one full send on the real site, A to B: both join a stream room A starts, A carries MIXTAPE from its profile
 *       onto B's companion, and B's RECOMMENDATIONS and notification are read. It leaves a recommendation from A to B
 *       and an ended test room behind: both are printed for Luke, and nothing is deleted.
 */
const path = require('node:path');
const { open, close, installSession, signInTestAccount, capture } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const baseAt = args.indexOf('--base');
const MOCK = flag('--mock');
const BASE = (baseAt >= 0 ? args[baseAt + 1] : 'https://debaser-site.vercel.app').replace(/\/$/, '');
const OUT = path.join('Temp', 'browse', 'letter-drag');
const A = '6d89898c-7aa3-47e1-9093-306faeac8679';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
let failed = 0;
function check(what, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? ` (${detail})` : ''}`);
}

const PEOPLE = [
  { id: 'drive-sender', displayName: 'DRIVE SENDER' },
  { id: 'drive-catcher', displayName: 'DRIVE CATCHER' },
  { id: 'drive-friend', displayName: 'DRIVE FRIEND' },
];

async function lettersSection(page, profileId) {
  await page.goto(`${BASE}/profile/${profileId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#profile-letters', { timeout: 60000 });
  await page.mouse.move(5, 5);
  await sleep(2500);
  // Past the one-time PRIVACY window a new browser is shown: it floats over the side panel, and a row behind a window
  // rightly catches nothing.
  const privacy = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await privacy.count()) > 0) await privacy.click();
  const section = page.locator('section[aria-labelledby="profile-letters"]');
  await section.scrollIntoViewIfNeeded();
  await sleep(500);
  return section;
}

const centre = async (locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('nothing on screen to point at');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Presses on a letter and carries it to a point, in steps, without letting go. */
async function carry(page, chip, to) {
  const from = await centre(chip);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 4, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await sleep(250);
}

const carriedText = (page) => page.evaluate(() => document.querySelector('[data-letter-carried]')?.textContent ?? null);
const rowLook = (page, id) =>
  page.evaluate((who) => {
    const row = document.querySelector(`[data-letter-catcher="${who}"]`);
    if (!row) return 'no row';
    return row.className.includes('outline-dotted') ? 'lit' : row.className.includes('outline-2') ? 'over' : 'plain';
  }, id);

async function mock() {
  const s = await open({ size: [1440, 1000], profile: path.join(OUT, 'profile-mock') });
  const page = s.page;
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  try {
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((people) => {
      const users = people.map((person) => ({ ...person, email: `${person.id}@debaser.site`, createdAt: new Date().toISOString(), salt: '', secretHash: '' }));
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users, sessionUserId: users[0].id, bannedIds: [] }));
    }, PEOPLE);
    const section = await lettersSection(page, 'drive-sender');

    console.log('[ SEND TO ], from the opened letter');
    await page.fill('input[aria-label="New letter\'s name"]', 'DRIVE LETTER');
    await page.keyboard.press('Enter');
    await page.waitForSelector('input[aria-label="Link address"]', { timeout: 20000 });
    const sendKey = page.getByRole('button', { name: '[ SEND TO ]' });
    check('an empty letter cannot be sent: the key is off', await sendKey.isDisabled());
    await page.fill('input[aria-label="Link address"]', 'https://example.org/');
    await page.fill('input[aria-label="Link title"]', 'A TEST LINK');
    await page.getByRole('button', { name: '[ + ADD LINK ]' }).click();
    await sleep(1200);
    check('with a thing in it, the key is on', await sendKey.isEnabled());
    await sendKey.click();
    const box = page.getByRole('dialog', { name: 'SEND TO' });
    await box.waitFor({ timeout: 10000 });
    const names = await box.locator('ul[aria-label="People"] li').allInnerTexts();
    check('the picker lists the other people, not yourself', names.some((name) => /DRIVE CATCHER/.test(name)) && names.some((name) => /DRIVE FRIEND/.test(name)) && !names.some((name) => /DRIVE SENDER/.test(name)), names.join(' | '));
    check('SEND is off until someone is picked', await box.getByRole('button', { name: 'SEND', exact: true }).isDisabled());
    await box.getByLabel('Find a person').fill('catch');
    await sleep(300);
    check('the names can be searched', (await box.locator('ul[aria-label="People"] li').count()) === 1);
    await box.locator('ul[aria-label="People"] input[type="checkbox"]').first().check();
    await box.getByLabel('A note to go with it').fill('for the bus');
    await capture(page, { out: path.join(OUT, 'mock-send-to-box.png') });
    await box.getByRole('button', { name: 'SEND', exact: true }).click();
    await sleep(1200);
    const said = await page.locator('[data-dock-window="letter"] [role="status"]').allInnerTexts();
    check('it says SENT "DRIVE LETTER" TO DRIVE CATCHER', said.some((line) => line.includes('SENT "DRIVE LETTER" TO DRIVE CATCHER')), said.join(' | '));
    await capture(page, { out: path.join(OUT, 'mock-send-to-sent.png') });
    await page.locator('[data-dock-window="letter"]').getByRole('button', { name: /^Close / }).click();
    await sleep(500);

    console.log('carrying a letter over the side panel');
    const chip = section.locator('li button', { hasText: 'DRIVE LETTER' }).first();
    const catcher = page.locator('[data-letter-catcher="drive-catcher"]');
    const friend = page.locator('[data-letter-catcher="drive-friend"]');
    check('before a letter is picked up, nobody is lit', (await rowLook(page, 'drive-catcher')) === 'plain' && (await rowLook(page, 'drive-friend')) === 'plain');
    check('your own row is not a catcher', (await page.locator('[data-letter-catcher="drive-sender"]').count()) === 0);

    await carry(page, chip, { x: 400, y: 300 });
    check('in the air: the envelope follows, naming nobody', (await carriedText(page)) === 'DRIVE LETTER', String(await carriedText(page)));
    check('in the air: everyone who can catch it is lit', (await rowLook(page, 'drive-catcher')) === 'lit' && (await rowLook(page, 'drive-friend')) === 'lit');
    await page.mouse.move((await centre(catcher)).x, (await centre(catcher)).y, { steps: 10 });
    await sleep(250);
    check('over a person: their row goes solid', (await rowLook(page, 'drive-catcher')) === 'over' && (await rowLook(page, 'drive-friend')) === 'lit');
    check('over a person: the envelope says who', /→ DRIVE CATCHER/.test((await carriedText(page)) ?? ''), String(await carriedText(page)));
    await capture(page, { out: path.join(OUT, 'mock-carried-over-a-person.png') });
    await page.keyboard.press('Escape');
    await sleep(200);
    check('ESCAPE puts the letter back', (await carriedText(page)) === null && (await rowLook(page, 'drive-catcher')) === 'plain');
    await page.mouse.up();
    await sleep(400);
    check('and nothing was sent or opened', (await page.locator('[data-letter-said]').count()) === 0 && (await page.locator('[data-dock-window="letter"]').count()) === 0);

    await carry(page, chip, { x: 400, y: 300 });
    await page.mouse.up();
    await sleep(600);
    check('let go over nobody: nothing is sent, and the letter does not open', (await page.locator('[data-letter-said]').count()) === 0 && (await page.locator('[data-dock-window="letter"]').count()) === 0);

    await carry(page, chip, await centre(friend));
    await page.mouse.up();
    await page.waitForSelector('[data-letter-said]', { timeout: 10000 });
    const flash = await page.locator('[data-letter-said]').innerText();
    check('let go on a person: it sends at once and says so where it landed', flash === 'SENT "DRIVE LETTER" TO DRIVE FRIEND', flash);
    const line = await section.locator('[role="status"]').allInnerTexts();
    check('and under the LETTERS title', line.includes('SENT "DRIVE LETTER" TO DRIVE FRIEND'), line.join(' | '));
    await capture(page, { out: path.join(OUT, 'mock-sent-by-dropping.png') });

    await page.fill('input[aria-label="New letter\'s name"]', 'EMPTY ONE');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-dock-window="letter"]', { timeout: 20000 });
    await page.locator('[data-dock-window="letter"]').getByRole('button', { name: /^Close / }).click();
    await sleep(500);
    await carry(page, section.locator('li button', { hasText: 'EMPTY ONE' }).first(), await centre(friend));
    await page.mouse.up();
    await sleep(1200);
    const empty = await section.locator('[role="status"]').allInnerTexts();
    check('an empty letter is refused in words', empty.includes('EMPTY LETTER: NOTHING TO SEND'), empty.join(' | '));

    // A letter picked up, put back with ESCAPE, then changed: the next carry sends it as it is now, not as it was read.
    const hollow = section.locator('li button', { hasText: 'EMPTY ONE' }).first();
    await carry(page, hollow, await centre(friend));
    await page.keyboard.press('Escape');
    await page.mouse.move(400, 300, { steps: 4 });
    await page.mouse.up();
    await sleep(400);
    await hollow.click();
    await page.waitForSelector('input[aria-label="Link address"]', { timeout: 20000 });
    await page.fill('input[aria-label="Link address"]', 'https://example.org/later');
    await page.getByRole('button', { name: '[ + ADD LINK ]' }).click();
    await sleep(1200);
    await page.locator('[data-dock-window="letter"]').getByRole('button', { name: /^Close / }).click();
    await sleep(500);
    await carry(page, hollow, await centre(friend));
    await page.mouse.up();
    await sleep(1200);
    const filled = await section.locator('[role="status"]').allInnerTexts();
    check('put back with ESCAPE, filled, carried again: it sends what it holds now', filled.includes('SENT "EMPTY ONE" TO DRIVE FRIEND'), filled.join(' | '));

    console.log('carrying a letter onto a character (two stand-in figures: the real ones are the --room drive`s)');
    await page.evaluate(() => {
      for (const [id, left] of [['drive-catcher', 300], ['drive-sender', 500]]) {
        const figure = document.createElement('div');
        figure.setAttribute('data-companion-of', id);
        figure.style.cssText = `position:fixed;left:${left}px;top:820px;width:32px;height:32px;pointer-events:none`;
        document.body.appendChild(figure);
      }
    });
    await carry(page, chip, { x: 400, y: 300 });
    const outlines = await page.evaluate(() => [...document.querySelectorAll('[data-letter-catcher-outline]')].map((box) => box.getAttribute('data-letter-catcher-outline')));
    check('in the air: another person`s character is outlined, your own is not', outlines.length === 1 && outlines[0] === 'drive-catcher', outlines.join(','));
    await page.mouse.move(316, 836, { steps: 10 });
    await sleep(250);
    check('over the character: the envelope says whose it is', /→ DRIVE CATCHER/.test((await carriedText(page)) ?? ''), String(await carriedText(page)));
    await capture(page, { out: path.join(OUT, 'mock-carried-over-a-character.png') });
    await page.mouse.move(516, 836, { steps: 6 });
    await sleep(250);
    check('over your own character: nobody is named', (await carriedText(page)) === 'DRIVE LETTER', String(await carriedText(page)));
    await page.mouse.move(316, 836, { steps: 6 });
    await page.mouse.up();
    await sleep(1200);
    const onFigure = await section.locator('[role="status"]').allInnerTexts();
    check('let go on the character: it sends at once', onFigure.includes('SENT "DRIVE LETTER" TO DRIVE CATCHER'), onFigure.join(' | '));

    console.log('reading them back on RECOMMENDATIONS > SENT');
    await page.evaluate(() => window.next.router.push('/recommendations'));
    await page.getByRole('tab', { name: 'SENT', exact: true }).click({ timeout: 30000 });
    await sleep(1500);
    const rows = page.locator('li.rule-pixel');
    check('four recommendations were sent, no more', (await rows.count()) === 4, String(await rows.count()));
    check('each carries the letter`s envelope', (await rows.locator('.letter-envelope').count()) === 4);
    const text = (await rows.allInnerTexts()).join(' || ');
    check('the note written in [ SEND TO ] shows on its row', /for the bus/.test(text), text.replace(/\s+/g, ' ').slice(0, 200));
    await capture(page, { out: path.join(OUT, 'mock-sent-tab.png') });
  } finally {
    await close(s);
  }
}

async function live() {
  const kept = await signInTestAccount('A');
  if (kept.error) throw new Error(kept.error);
  const s = await open({ size: [1440, 1000], profile: path.join(OUT, 'profile-live') });
  const page = s.page;
  await installSession(page, kept);
  // The guard: among real people, this browser may not send a recommendation at all.
  let tried = 0;
  await page.route('**/rest/v1/rpc/recommendation_send*', (route) => {
    tried += 1;
    return route.abort();
  });
  try {
    const section = await lettersSection(page, A);
    const chip = section.locator('li button', { hasText: 'MIXTAPE' }).first();
    const rows = page.locator('[data-letter-catcher]');
    const count = await rows.count();
    check('the side panel has people who could catch a letter', count > 0, `${count} rows`);
    if (count === 0) return;
    const who = await rows.first().getAttribute('data-letter-catcher');
    check('TEST ACCOUNT A`s own row is not a catcher', (await page.locator(`[data-letter-catcher="${A}"]`).count()) === 0);
    check('at rest, nobody is lit', (await rowLook(page, who)) === 'plain');

    await carry(page, chip, { x: 400, y: 300 });
    check('in the air: the envelope follows the pointer', (await carriedText(page)) === 'MIXTAPE', String(await carriedText(page)));
    const lit = await page.evaluate(() => [...document.querySelectorAll('[data-letter-catcher]')].filter((row) => row.className.includes('outline-dotted')).length);
    check('in the air: every person in the side panel is lit', lit === count, `${lit} of ${count}`);
    await capture(page, { out: path.join(OUT, 'live-in-the-air.png') });
    const spot = await centre(rows.first());
    await page.mouse.move(spot.x, spot.y, { steps: 10 });
    await sleep(300);
    check('over a person: their row goes solid', (await rowLook(page, who)) === 'over');
    check('over a person: the envelope names them', /→ \S/.test((await carriedText(page)) ?? ''));
    await capture(page, { out: path.join(OUT, 'live-over-a-person.png') });
    // Never let go here. ESCAPE first, then away from everyone, and only then the button comes up.
    await page.keyboard.press('Escape');
    await sleep(200);
    check('ESCAPE puts the letter back', (await carriedText(page)) === null && (await rowLook(page, who)) === 'plain');
    await page.mouse.move(400, 300, { steps: 4 });
    await page.mouse.up();
    await sleep(600);

    await carry(page, chip, { x: 400, y: 300 });
    await page.mouse.up();
    await sleep(600);
    check('let go over nobody: nothing is said or opened', (await page.locator('[data-letter-said]').count()) === 0 && (await page.locator('[data-dock-window="letter"]').count()) === 0);

    await chip.click();
    const sendKey = page.getByRole('button', { name: '[ SEND TO ]' });
    await sendKey.waitFor({ timeout: 20000 });
    await sleep(1500);
    await sendKey.click();
    const box = page.getByRole('dialog', { name: 'SEND TO' });
    await box.waitFor({ timeout: 10000 });
    check('[ SEND TO ] opens its box, with SEND off until someone is picked', await box.getByRole('button', { name: 'SEND', exact: true }).isDisabled());
    await capture(page, { out: path.join(OUT, 'live-send-to-box.png') });
    await box.getByRole('button', { name: '[ CANCEL ]' }).click();
    await sleep(400);
    check('CANCEL shuts it', (await page.getByRole('dialog', { name: 'SEND TO' }).count()) === 0);
    check('the browser never tried to send anything', tried === 0, `${tried} tries`);
  } finally {
    await close(s);
  }
}

const B = 'e1ca5c36-0a1d-4a42-89a4-44e663ca1279';

async function closeFirstLooks(page) {
  for (const id of ['privacy-first-look', 'preferences']) {
    const shut = page.locator(`[data-dock-window="${id}"]`).getByRole('button', { name: /^Close / });
    if ((await shut.count()) > 0) await shut.first().click().catch(() => undefined);
  }
}

async function unfoldRoom(page) {
  const up = page.locator('[data-watch-tv-box] button');
  if ((await up.count()) > 0 && (await up.first().isVisible().catch(() => false))) await up.first().click();
}

/** The one real send: A carries MIXTAPE onto B's companion while both are in a stream room A started. */
async function room() {
  const left = [];
  const accountA = await signInTestAccount('A');
  const accountB = await signInTestAccount('B');
  if (accountA.error || accountB.error) throw new Error(accountA.error ?? accountB.error);
  const a = await open({ size: [1440, 1000], profile: path.join(OUT, 'profile-room-a') });
  const b = await open({ size: [1440, 1000], profile: path.join(OUT, 'profile-room-b') });
  await installSession(a.page, accountA);
  await installSession(b.page, accountB);
  for (const s of [a, b]) await s.page.addInitScript(() => window.localStorage.setItem('debaser.lost-account.never.v1', '1'));
  let live = null;
  try {
    const rooms = [];
    const sends = [];
    a.page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      if (/\/rest\/v1\/watch_rooms\b/.test(request.url())) {
        try {
          const body = JSON.parse(request.postData() ?? '{}');
          if (typeof body.id === 'string') rooms.push(body.id);
        } catch {
          // Not the row.
        }
      }
    });
    a.page.on('response', (response) => {
      if (/\/rest\/v1\/rpc\/recommendation_send/.test(response.url())) response.text().then((body) => sends.push(body.replace(/"/g, '').trim())).catch(() => undefined);
    });

    console.log('A starts a room, B joins it');
    await a.page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
    await a.page.mouse.move(700, 300);
    await a.page.waitForFunction(() => document.querySelector('[data-watch-in-room="start"]') !== null || document.querySelector('button[aria-label^="Play"]') !== null, null, { timeout: 60000 });
    await closeFirstLooks(a.page);
    const row = a.page.locator('li').filter({ hasText: 'YOUTUBE' }).filter({ hasText: '[ ▶ PLAY ]' }).first();
    const title = await row.locator('p').first().innerText();
    await row.locator('button[aria-label^="Play"]').first().click();
    await a.page.waitForSelector('[data-floating-player] iframe', { timeout: 30000 });
    await sleep(3000);
    await a.page.locator('li').filter({ hasText: title }).first().locator('[data-watch-in-room="start"]').click();
    const dialog = a.page.getByRole('dialog', { name: 'WATCH IN ROOM' });
    await dialog.waitFor();
    await dialog.locator('[data-go-live-name]').fill('LETTER DRAG DRIVE');
    await dialog.locator('[data-go-live-topic]').fill('A test room, to be deleted');
    await dialog.locator('[data-room-privacy="open"]').click();
    await dialog.locator('[data-go-live-start]').click();
    live = 'started';
    await a.page.waitForSelector('[data-room-picture]', { timeout: 30000 });
    const roomId = rooms.at(-1) ?? null;
    if (roomId === null) throw new Error('the room was not written');
    live = roomId;
    left.push(`stream room ${roomId}, named LETTER DRAG DRIVE (ended at the close; its record and board thread stay)`);
    await unfoldRoom(a.page);
    await sleep(1500);

    await b.page.goto(`${BASE}/forum?watch=${roomId}`, { waitUntil: 'domcontentloaded' });
    await b.page.mouse.move(700, 300);
    await b.page.waitForSelector('[data-room-picture], [data-watch-tv-box]', { state: 'attached', timeout: 60000 });
    await closeFirstLooks(b.page);
    await unfoldRoom(b.page);
    await a.page.waitForSelector(`[data-companion="room"][data-companion-of="${B}"]`, { state: 'attached', timeout: 45000 });
    check('B`s companion is on A`s screen, and says whose it is', true);

    console.log('A goes to its own profile, the room folded away');
    // Without a page load, so A stays in the room: the site's own router, or the side panel's link to your profile.
    const pushed = await a.page.evaluate((to) => {
      const router = window.next?.router;
      if (!router || typeof router.push !== 'function') return false;
      router.push(to);
      return true;
    }, `/profile/${A}`);
    if (!pushed) await a.page.locator(`a[href="/profile/${A}"]`).first().click({ force: true });
    await a.page.waitForSelector('#profile-letters', { timeout: 60000 });
    await closeFirstLooks(a.page);
    const fold = a.page.locator('[data-dock-window="stream"]').getByRole('button', { name: /^Fold / });
    if ((await fold.count()) > 0) await fold.first().click();
    await sleep(3000);
    const section = a.page.locator('section[aria-labelledby="profile-letters"]');
    await section.scrollIntoViewIfNeeded();
    await sleep(800);
    const chip = section.locator('li button', { hasText: 'MIXTAPE' }).first();
    const figure = a.page.locator(`[data-companion="room"][data-companion-of="${B}"]`).first();
    const where = () =>
      a.page.evaluate((who) => {
        const box = document.querySelector(`[data-companion="room"][data-companion-of="${who}"]`)?.getBoundingClientRect();
        return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2, w: box.width } : null;
      }, B);
    const first = await where();
    check('B`s companion is drawn where a letter can reach it', first !== null && first.w > 0, JSON.stringify(first));
    if (first === null) throw new Error('no figure to carry the letter to');

    console.log('A carries MIXTAPE onto B`s companion');
    await carry(a.page, chip, { x: first.x, y: first.y - 120 });
    const outlined = await a.page.evaluate(() => [...document.querySelectorAll('[data-letter-catcher-outline]')].map((box) => box.getAttribute('data-letter-catcher-outline')));
    check('in the air: B`s companion is outlined, A`s own is not', outlined.includes(B) && !outlined.includes(A), outlined.join(','));
    // It may be walking: go to where it is now, twice, then let go.
    for (let turn = 0; turn < 2; turn += 1) {
      const now = await where();
      if (now) await a.page.mouse.move(now.x, now.y, { steps: 6 });
      await sleep(120);
    }
    const named = (await carriedText(a.page)) ?? '';
    check('over it: the envelope names TEST ACCOUNT B', /→ TEST ACCOUNT B/.test(named), named);
    await capture(a.page, { out: path.join(OUT, 'room-over-the-companion.png') });
    // Watched from before the letter lands: the catch is one short motion.
    const motions = new Set();
    let watching = true;
    const watch = (async () => {
      while (watching) {
        motions.add(await figure.getAttribute('data-motion').catch(() => null));
        await sleep(60);
      }
    })();
    await a.page.mouse.up();
    await a.page.waitForSelector('[data-letter-said]', { timeout: 15000 });
    const said = await a.page.locator('[data-letter-said]').innerText();
    check('let go on it: SENT "MIXTAPE" TO TEST ACCOUNT B', said === 'SENT "MIXTAPE" TO TEST ACCOUNT B', said);
    await capture(a.page, { out: path.join(OUT, 'room-sent.png') });
    await sleep(2500);
    watching = false;
    await watch;
    check('its character played the catch as the letter landed', motions.has('catch'), [...motions].join(','));
    await capture(a.page, { out: path.join(OUT, 'room-after-the-catch.png') });
    if (sends.length > 0) left.push(`recommendation ${sends.at(-1)} from TEST ACCOUNT A to TEST ACCOUNT B (the letter MIXTAPE), with B's notification`);
    check('one send left the browser, no more', sends.length === 1, `${sends.length}`);

    console.log('B reads it');
    await b.page.goto(`${BASE}/recommendations`, { waitUntil: 'domcontentloaded' });
    await b.page.mouse.move(700, 300);
    await b.page.getByRole('tab', { name: 'FOR YOU', exact: true }).click({ timeout: 45000 });
    await sleep(2500);
    const got = b.page.locator('li.rule-pixel').filter({ hasText: 'MIXTAPE' }).first();
    check('B`s RECOMMENDATIONS shows MIXTAPE', (await got.count()) === 1);
    check('with its envelope', (await got.locator('.letter-envelope').count()) === 1);
    await capture(b.page, { out: path.join(OUT, 'room-b-for-you.png') });
  } finally {
    if (live !== null) {
      try {
        await unfoldRoom(a.page);
        await a.page.getByRole('button', { name: '[ END STREAM ]' }).last().click({ timeout: 10000 });
        await a.page.getByRole('button', { name: '[ END FOR EVERYBODY ]' }).last().click({ timeout: 10000 });
        await sleep(1500);
        console.log(`  the room ${live} ended`);
      } catch (error) {
        console.log(`  COULD NOT END THE ROOM ${live}: ${String(error).slice(0, 160)}`);
      }
    }
    if (left.length > 0) console.log(`Left behind (for Luke; nothing is deleted):\n  ${left.join('\n  ')}`);
    await close(a);
    await close(b);
  }
}

(async () => {
  const ROOM = flag('--room');
  console.log(`${MOCK ? 'made-up people' : ROOM ? 'the real site: A sends one letter to B, in a room' : 'the real site, never letting go over a person'}: ${BASE}`);
  if (MOCK) await mock();
  else if (ROOM) await room();
  else await live();
  console.log(`\n${passed} passed, ${failed} failed. Pictures: ${OUT}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(`FAILED: ${String(error.message).split('\n')[0]}`);
  process.exit(1);
});
