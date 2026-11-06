/*
 * The beat box against SPEC-beatbox-ui.md's seven acceptance tests, in a real browser. It needs a running site, so the suite
 * leaves it out; run it by hand:
 *   node Temp/check-beatbox-ui.cjs --url http://localhost:3001 --stand-in     a local mock build; also saves and shares, signed in to a stand-in account in this browser
 *   node Temp/check-beatbox-ui.cjs --url https://debaser-site.vercel.app               the deployed site, signed out. It posts nothing and saves nothing.
 *   --only 1,2     just those tests
 *   --out <dir>    where the song file and pictures go
 *
 * Prints every number the spec asks for, and exits 1 if any test fails. 400% browser zoom is a window a quarter of the size
 * as far as a page can tell, which is how it's driven here. The sound isn't judged: only that the keys do what they say.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const argument = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};
const BASE = argument('--url', 'http://localhost:3001');
const OUT = argument('--out', path.join(__dirname, 'browse', 'bb-accept'));
const ONLY = argument('--only', '1,2,3,4,5,6,7,8,9,10,11').split(',').map(Number);
const STAND_IN = process.argv.includes('--stand-in');
assert.ok(!STAND_IN || /localhost|127\.0\.0\.1/.test(BASE), 'the stand-in account is for a local build only');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((file) => fs.existsSync(file));
const SIZES = [[1280, 900], [1920, 1080]];
const EXAMPLE = '#9n30sbk7l00e00t2-a7g00j00r1i0o443T0v2u00f0qw02d03w2h0E0T0v2u00f0qw02d03w2h0E0T0v0u00f0qw02d03w1h0E0bUp1OFEYtghQ4sBihS7dQQuwE8W2eywzwPbGcKCzZk4t17hghQCngpo';
// The beat: a kick and snare taking turns, a tune climbing, each a two-beat step apart, on bars 1 to 4 (a new song's first pattern).
const BEAT = JSON.stringify([
  { type: 'pitch', bars: '1,1,1,1', notes: '48@0 50@8 52@16 54@24' },
  { type: 'drum', bars: '1,1,1,1', notes: '0@0 3@8 0@16 3@24' },
]);
const NOTES = '[role="grid"][aria-label^="Notes"]';
const BARS = '[role="grid"][aria-label^="Bars"]';
const STATUS = '.debaser-beatbox p[role="status"][aria-live]';
const MAIN = '[aria-label="Main keys"]';
const PANE = '[data-scroll-pane="page"]';

const results = [];
const numbers = {};

async function open(browser, width, height, { hash = '', storage = {}, standIn = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
  const page = await context.newPage();
  await page.addInitScript(
    ({ storage: seeded, standIn: seedAccount }) => {
      for (const [key, value] of Object.entries(seeded)) if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
      if (seedAccount && localStorage.getItem('debaser.auth.mock.v1') === null) {
        // A stand-in account in this browser's own storage, for a local mock build. It reaches no server.
        localStorage.setItem(
          'debaser.auth.mock.v1',
          JSON.stringify({
            users: [{ id: 'check-stand-in', email: 'stand-in@check.test', displayName: 'STAND IN', createdAt: '2026-11-06T00:00:00.000Z', salt: 'x', secretHash: 'x', hidden: true }],
            sessionUserId: 'check-stand-in',
            bannedIds: [],
          }),
        );
      }
      const made = URL.createObjectURL;
      URL.createObjectURL = (blob) => {
        window.__lastBlob = blob;
        return made.call(URL, blob);
      };
      // Was each key used? Runs after the page's own listener.
      window.addEventListener('keydown', (event) => { window.__used = event.defaultPrevented; });
      // A keyboard plugged into a stand-in for the browser's MIDI.
      const input = { name: 'CHECK KEYS', onmidimessage: null };
      window.__midiInput = input;
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: async () => ({ inputs: new Map([['one', input]]), onstatechange: null }),
      });
    },
    { storage, standIn },
  );
  await page.goto(`${BASE}/beatbox${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(NOTES, { timeout: 120000 });
  await page.waitForTimeout(800);
  return { context, page };
}

const status = (page) => page.locator(STATUS).textContent();
const focused = (page) => page.evaluate(() => document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent?.slice(0, 40));
const paneTop = (page) => page.evaluate((pane) => document.querySelector(pane).scrollTop, PANE);

async function expectStatus(page, pattern, what) {
  await page.waitForFunction(
    ({ selector, source }) => new RegExp(source).test(document.querySelector(selector)?.textContent ?? ''),
    { selector: STATUS, source: pattern.source },
    { timeout: 5000 },
  ).catch(async () => assert.fail(`${what}: the status line says "${await status(page)}", wanted ${pattern}`));
}

/** The song as a person gets it out: its own Save key, read back. Opens and shuts the Song window. */
async function songFile(page) {
  await page.keyboard.press('Shift+O');
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: /Save song file/ }).click();
  await page.waitForTimeout(250);
  const json = JSON.parse(await page.evaluate(() => window.__lastBlob.text()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  return json;
}

const shape = (json) =>
  JSON.stringify(
    json.channels
      .map((channel) => ({
        type: channel.type,
        bars: channel.sequence.slice(0, 4).join(','),
        notes: (channel.patterns[0]?.notes ?? []).map((note) => `${note.pitches.join('+')}@${note.points[0].tick}`).join(' '),
      }))
      .filter((channel) => channel.notes),
  );

/** Everything that should show on opening, and whether it does. */
const openingLook = ({ MAIN: main, NOTES: notes, PANE: paneName }) => {
  const pane = document.querySelector(paneName);
  const paneBox = pane.getBoundingClientRect();
  const inView = (box) => box.top >= paneBox.top - 1 && box.bottom <= Math.min(paneBox.bottom, innerHeight) + 1 && box.left >= paneBox.left - 1 && box.right <= paneBox.right + 1;
  const buttons = [...document.querySelectorAll('.debaser-beatbox button')].filter((button) => button.getBoundingClientRect().width > 1 && !button.classList.contains('sr-only'));
  const keyNamed = (pattern) => buttons.find((button) => pattern.test(button.textContent ?? '') || pattern.test(button.getAttribute('aria-label') ?? ''));
  const keys = { play: keyNamed(/^(Play|Pause)/), stop: keyNamed(/^Stop/), loop: keyNamed(/^Loop/), record: keyNamed(/^(Record|Rec)/), undo: keyNamed(/^Undo/), slower: keyNamed(/^Slower/), faster: keyNamed(/^Faster/), sounds: keyNamed(/^Sounds/), recorder: keyNamed(/^Recorder/), playing: keyNamed(/^Playing/), song: keyNamed(/^Song/), settings: keyNamed(/^Settings/), help: keyNamed(/^All the keys/) };
  const grid = document.querySelector(notes);
  const cells = [...grid.querySelectorAll('[role="gridcell"]')];
  const mainRow = document.querySelector(main);
  const rowsOf = (list) => new Set(list.map((element) => Math.round(element.getBoundingClientRect().top))).size;
  const box = grid.getBoundingClientRect();
  return {
    scrollNeeded: pane.scrollHeight > pane.clientHeight + 1,
    sideways: pane.scrollWidth > pane.clientWidth + 1,
    keysMissing: Object.entries(keys).filter(([, key]) => !key || !inView(key.getBoundingClientRect())).map(([name]) => name),
    keyRows: mainRow ? rowsOf([...mainRow.querySelectorAll('button')]) : rowsOf(Object.values(keys).filter(Boolean)),
    keysOnScreen: buttons.filter((button) => inView(button.getBoundingClientRect())).length,
    keysOnPage: buttons.length,
    gridTop: Math.round(box.top),
    cells: cells.length,
    cellsInView: cells.filter((cell) => inView(cell.getBoundingClientRect())).length,
    gridRows: grid.querySelectorAll('[role="row"]').length - 1,
    gridColumns: cells.length / (grid.querySelectorAll('[role="row"]').length - 1),
    gridShare: Math.round(((box.width * box.height) / (pane.clientWidth * pane.clientHeight)) * 100),
    screens: +(pane.scrollHeight / pane.clientHeight).toFixed(1),
    labelsWithShortcuts: buttons.filter((button) => /\((Space|R|Ctrl\+|B|\.|,|I)/.test(button.textContent ?? '')).length,
    smallestKeyText: Math.min(...buttons.map((button) => parseFloat(getComputedStyle(button).fontSize))),
    smallestKeyHeight: Math.min(...Object.values(keys).filter(Boolean).map((key) => key.getBoundingClientRect().height)),
  };
};
const look = (page) => page.evaluate(openingLook, { MAIN, NOTES, PANE });

async function test(number, name, run) {
  if (!ONLY.includes(number)) return;
  try {
    await run();
    results.push({ name: `${number}. ${name}`, ok: true });
  } catch (error) {
    results.push({ name: `${number}. ${name}`, ok: false, why: error.message.split('\n').slice(0, 5).join(' ').slice(0, 400) });
  }
  const last = results[results.length - 1];
  console.log(`${last.ok ? 'PASS' : 'FAIL'}  ${last.name}${last.why ? `\n      ${last.why}` : ''}`);
}

const main = async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });

  // 1. Everything on one screen, nothing wrapped.
  for (const [w, h] of SIZES) {
    await test(1, `opens at ${w}x${h} with the grid and main keys in view, no scrolling, no wrapping`, async () => {
      const { context, page } = await open(browser, w, h, { hash: EXAMPLE });
      const seen = await look(page);
      numbers[`opening ${w}x${h}`] = seen;
      await page.screenshot({ path: path.join(OUT, `open-${w}.png`) });
      await context.close();
      assert.equal(seen.scrollNeeded, false, `the page needs scrolling: ${seen.screens} screens`);
      assert.equal(seen.sideways, false, 'the page scrolls sideways');
      assert.deepEqual(seen.keysMissing, [], 'main keys out of view');
      assert.equal(seen.cellsInView, seen.cells, `${seen.cellsInView} of ${seen.cells} grid cells in view`);
      assert.equal(seen.keyRows, 1, `the main keys take ${seen.keyRows} rows`);
      assert.equal(seen.labelsWithShortcuts, 0, 'keys spell out their shortcuts');
      assert.ok(seen.smallestKeyText >= 16, `smallest key text ${seen.smallestKeyText}px, DISCOVER's default is 16`);
      assert.ok(seen.gridShare >= 50, `the grid has only ${seen.gridShare}% of the page`);
      assert.ok(seen.gridRows >= 7 && seen.gridColumns >= 12, `grid ${seen.gridRows} x ${seen.gridColumns}`);
    });
  }

  // 2. The 4-bar beat by keyboard alone.
  for (const [w, h] of SIZES) {
    for (const jump of [false, true]) {
      await test(2, `4-bar beat, keyboard only, ${jump ? 'with Ctrl+arrow, ' : ''}${w}x${h}`, async () => {
        const { context, page } = await open(browser, w, h);
        let presses = 0;
        const press = async (key, times = 1) => {
          for (let i = 0; i < times; i += 1) {
            await page.keyboard.press(key);
            presses += 1;
          }
        };
        const along = () => (jump ? press('Control+ArrowRight', 2) : press('ArrowRight', 8));
        const toBars = async () => {
          await press('Shift+Tab');
          assert.match((await focused(page)) ?? '', /^(Tune|Drums).*, bar \d+,/, 'Shift+Tab from the notes reaches the bars');
        };
        assert.match((await focused(page)) ?? '', /^Bar 1, beat 1 step 1/, 'the cursor starts on the grid');
        await toBars();
        await press('ArrowRight', 3); // to the drums
        await press('Enter');
        await press('Enter'); // kick
        await along();
        await press('ArrowUp', 3); // snare
        await press('Enter');
        await along();
        await press('ArrowDown', 3);
        await press('Enter');
        await along();
        await press('ArrowUp', 3);
        await press('Enter');
        await toBars();
        await press('ArrowLeft', 3); // back to the tune
        await press('Enter');
        for (let note = 0; note < 4; note += 1) {
          await press('Enter');
          if (note < 3) {
            await along();
            await press('ArrowUp', 2);
          }
        }
        const scrolled = await paneTop(page);
        const song = shape(await songFile(page));
        numbers[`keyboard ${w}x${h}${jump ? ' with jumps' : ''}`] = { presses, scrolled };
        await context.close();
        assert.equal(scrolled, 0, 'the page scrolled');
        assert.equal(song, BEAT, 'the saved song is the beat');
        assert.ok(presses < 94, `${presses} presses, today's page takes 94`);
      });
    }
  }

  // 3. The same by mouse alone.
  for (const [w, h] of SIZES) {
    await test(3, `4-bar beat, mouse only, ${w}x${h}`, async () => {
      const { context, page } = await open(browser, w, h);
      let clicks = 0;
      const click = async (target) => {
        await target.click({ timeout: 4000 });
        clicks += 1;
        await page.waitForTimeout(40);
      };
      const stepShowing = (beat) => page.locator(`${NOTES} [role="columnheader"][aria-label="beat ${beat} step 1"]`).count();
      const cell = (beat, name) => page.locator(`${NOTES} [role="gridcell"][aria-label="Bar 1, beat ${beat} step 1, ${name}, off"]`);
      async function write(channel, names) {
        await click(page.getByRole('button', { name: `Pick ${channel}` }).or(page.locator(`${BARS} [role="columnheader"] button[title="Pick ${channel}"]`)).first());
        for (let i = 0; i < names.length; i += 1) {
          const beat = i * 2 + 1;
          if ((await stepShowing(beat)) === 0) await click(page.getByRole('button', { name: `Go to beat ${beat}` }));
          while ((await cell(beat, names[i]).count()) === 0) await click(page.getByRole('button', { name: 'Higher', exact: true }));
          await click(cell(beat, names[i]));
        }
      }
      await write('Drums', ['Kick', 'Snare', 'Kick', 'Snare']);
      await write('Tune 1', ['C4', 'D4', 'E4', 'F#4']);
      const scrolled = await paneTop(page);
      const song = shape(await songFile(page));
      numbers[`mouse ${w}x${h}`] = { clicks, scrolled };
      await context.close();
      assert.equal(scrolled, 0, 'the page scrolled');
      assert.equal(song, BEAT, 'the saved song is the beat');
      assert.ok(clicks < 20, `${clicks} clicks, today's page takes 20 and some scrolling`);
    });
  }

  // 4. Three loop passes and one undo, without leaving the screen.
  await test(4, 'records three loop passes and undoes the last, all on one screen', async () => {
    const { context, page } = await open(browser, 1280, 900);
    const notesIn = (json) => json.channels[0].patterns.reduce((sum, pattern) => sum + pattern.notes.length, 0);
    const key = page.locator(`${MAIN} [aria-keyshortcuts="R"]`);
    const allInView = async () => {
      const seen = await look(page);
      assert.equal(seen.cellsInView, seen.cells, 'the grid left the screen while recording');
    };
    await page.keyboard.press('r');
    const seen = [];
    const started = Date.now();
    while (Date.now() - started < 90000) {
      await page.keyboard.down('a');
      await page.waitForTimeout(120);
      await page.keyboard.up('a');
      await page.waitForTimeout(600);
      const text = (await key.textContent()) ?? '';
      if (!seen.includes(text)) seen.push(text);
      if (/pass 4/i.test(text)) break;
    }
    assert.ok(seen.some((text) => /pass 4/i.test(text)), `only reached: ${seen.join(', ')}`);
    await allInView();
    await page.keyboard.press('r');
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const before = notesIn(await songFile(page));
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expectStatus(page, /^Undone/, 'undo');
    const after = notesIn(await songFile(page));
    numbers['loop passes'] = { keys: seen, notesBeforeUndo: before, notesAfterUndo: after, scrolled: await paneTop(page) };
    assert.ok(after < before, `the undo took no notes away: ${before} then ${after}`);
    assert.ok(after > 0, 'the undo took more than the last pass');
    assert.equal(await paneTop(page), 0, 'the page scrolled');
    await context.close();
  });

  // 5. A new person can tell what to press first.
  await test(5, 'one obvious main key, and an empty grid that says what to do', async () => {
    const { context, page } = await open(browser, 1280, 900);
    const bar = await page.evaluate((main) => {
      const buttons = [...document.querySelectorAll('.debaser-beatbox button')].filter((button) => button.getBoundingClientRect().width > 1);
      const filled = buttons.filter((button) => !['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(button).backgroundColor));
      const yellow = filled.filter((button) => {
        const key = button.getBoundingClientRect();
        return getComputedStyle(button).backgroundColor === getComputedStyle(document.querySelector(`${main} button`)).backgroundColor && key.height > 1;
      });
      return { filledYellow: yellow.map((button) => button.textContent), firstKey: document.querySelector(`${main} button`)?.textContent };
    }, MAIN);
    const words = (await page.locator('.debaser-beatbox').innerText()).toUpperCase();
    await page.screenshot({ path: path.join(OUT, 'empty.png') });
    await context.close();
    assert.equal(bar.firstKey, 'Play', 'PLAY comes first');
    assert.deepEqual(bar.filledYellow.filter((text) => !/^(Tune|Drums)/.test(text)), ['Play'], 'PLAY is the only filled main key');
    assert.match(words, /CLICK A SQUARE/, 'the empty grid says what to do');
    assert.match(words, /ARROWS AND ENTER/, 'for the keyboard too');
  });

  // 6. XL, and 400% zoom.
  const overflow = (pane) => {
    const paneElement = document.querySelector(pane);
    const right = paneElement.getBoundingClientRect().right;
    const cut = [...paneElement.querySelectorAll('button, [role="gridcell"], p, h2, h3, label')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 1 && !element.closest('.sr-only') && !element.classList.contains('sr-only') && !element.closest('dialog') && box.right > right + 1;
      })
      .slice(0, 5)
      .map((element) => (element.getAttribute('aria-label') || element.textContent).slice(0, 30));
    return { page: document.documentElement.scrollWidth > innerWidth + 1, pane: paneElement.scrollWidth > paneElement.clientWidth + 1, cut, screens: +(paneElement.scrollHeight / paneElement.clientHeight).toFixed(1) };
  };
  for (const [w, h] of SIZES) {
    await test(6, `XL at ${w}x${h}: no cut-off, no scrolling`, async () => {
      const { context, page } = await open(browser, w, h, { hash: EXAMPLE });
      await page.getByRole('radio', { name: 'XL' }).click();
      await page.waitForTimeout(300);
      const seen = await look(page);
      const side = await page.evaluate(overflow, PANE);
      numbers[`XL ${w}x${h}`] = { rows: seen.gridRows, columns: seen.gridColumns };
      await page.screenshot({ path: path.join(OUT, `xl-${w}.png`) });
      await context.close();
      assert.equal(seen.cellsInView, seen.cells, 'grid cells cut off');
      assert.equal(side.pane, false, 'sideways scrolling');
      assert.deepEqual(side.cut, [], 'cut off');
      assert.equal(seen.scrollNeeded, false, 'the page needs scrolling');
    });
  }
  for (const [w, h, name] of [[320, 225, '400% of 1280x900'], [480, 270, '400% of 1920x1080']]) {
    for (const size of ['L', 'XL']) {
      await test(6, `${name}, size ${size}: nothing cut off, nothing sideways, every key reachable`, async () => {
        const { context, page } = await open(browser, w, h, { hash: EXAMPLE });
        const first = await page.evaluate(() => document.querySelector('[data-scroll-pane="page"]').scrollTop);
        if (size === 'XL') {
          await page.keyboard.press('=');
          await page.waitForTimeout(300);
        }
        const side = await page.evaluate(overflow, PANE);
        numbers[`${name} ${size}`] = side;
        await page.screenshot({ path: path.join(OUT, `zoom-${w}-${size}.png`) });
        assert.equal(first, 0, 'opens at the top, on the main keys');
        assert.equal(side.page, false, 'the page scrolls sideways');
        assert.equal(side.pane, false, 'the page scrolls sideways inside its window');
        assert.deepEqual(side.cut, [], 'cut off');
        // The main keys, the grid, and the bars can each be brought to the screen.
        for (const target of [`${MAIN} button >> nth=0`, `${MAIN} button >> nth=-1`, `${NOTES} [role="gridcell"] >> nth=0`, `${BARS} [role="gridcell"] >> nth=0`]) {
          await page.locator(target).scrollIntoViewIfNeeded({ timeout: 3000 });
        }
        // Every window too, at this zoom.
        for (const name of ['sounds', 'recorder', 'playing', 'song', 'settings']) {
          await page.locator(`[data-window-key="${name}"]`).click();
          await page.waitForTimeout(250);
          const withWindow = await page.evaluate(overflow, PANE);
          await page.screenshot({ path: path.join(OUT, `zoom-${w}-${size}-${name}.png`) });
          assert.equal(withWindow.pane, false, `the ${name} window scrolls sideways`);
          assert.deepEqual(withWindow.cut, [], `cut off in the ${name} window`);
          assert.equal(await page.locator(`[data-window="${name}"]`).evaluate((box) => getComputedStyle(box).position), 'static', 'no room to float, so it stacks');
          assert.equal(await page.getByRole('button', { name: /^Move the / }).count(), 0, 'and it has no title to drag');
          await page.keyboard.press('Escape');
          await page.waitForTimeout(100);
        }
        await context.close();
      });
    }
  }

  // 7. Everything that worked still works.
  await test(7, 'every key in the help does what it says', async () => {
    const { context, page } = await open(browser, 1280, 900);
    const press = (key) => page.keyboard.press(key);
    const cursor = () => focused(page);
    const onCursor = async (pattern, what) => assert.match((await cursor()) ?? '', pattern, what);
    const pressed = (name) => page.getByRole('button', { name }).getAttribute('aria-pressed');
    const chosen = async (group, option) => {
      const checked = await page.locator(`[role="radiogroup"][aria-label="${group}"] [aria-checked="true"]`).textContent();
      assert.match(checked ?? '', option, `${group}: ${checked}`);
    };

    // Anywhere.
    await press('Space');
    await page.waitForTimeout(150);
    assert.equal(await page.locator(`${MAIN} button`).first().textContent(), 'Pause', 'Space plays');
    await press('Escape');
    await page.waitForTimeout(100);
    assert.equal(await page.locator(`${MAIN} button`).first().textContent(), 'Play', 'Esc stops');
    await press('Space');
    await press('Space');
    await expectStatus(page, /^Paused/, 'Space pauses');
    await press('Escape');
    await press('r');
    await page.locator(MAIN).getByRole('button', { name: /^Rec/, pressed: true }).waitFor({ timeout: 5000 });
    await press('r');
    await press('Escape');
    await press(']');
    await expectStatus(page, /Speed: 155/, ']');
    await press('[');
    await expectStatus(page, /Speed: 150/, '[');
    assert.match(await page.locator(MAIN).innerText(), /SPEED 150|Speed 150/, 'the speed shows on the bar');
    await press('b');
    await expectStatus(page, /now follow/, 'B');
    await press('b');
    await expectStatus(page, /stay on the bar/, 'B again');
    for (const mode of [/^Sonify/, /^Perform/, /^Practice/]) {
      await press('i');
      await expectStatus(page, mode, 'I');
    }
    await press('.');
    await expectStatus(page, /Focus view: the notes/, '.');
    assert.equal(await page.locator(BARS).isVisible(), false, 'focus view hides the bars');
    assert.equal(await page.getByRole('button', { name: 'Slower' }).isVisible(), false, 'and the speed');
    assert.equal(await page.getByRole('button', { name: 'Bars', exact: true }).count(), 0, 'and the keys for the bars');
    assert.equal(await page.getByRole('button', { name: /^Settings/ }).isVisible(), true, 'with Settings still there');
    assert.equal(await page.getByRole('button', { name: /^Sounds/ }).count(), 0, 'and the other windows out of the way');
    await press('.');
    await expectStatus(page, /Focus view off/, '. again');
    assert.equal(await page.locator(BARS).isVisible(), true);
    await press(',');
    assert.equal(await page.locator('.debaser-beatbox').getAttribute('data-theme'), 'high-contrast', ',');
    await press(',');
    assert.equal(await page.locator('.debaser-beatbox').getAttribute('data-theme'), 'default');
    await press('-');
    await chosen('Size', /M/);
    await press('=');
    await chosen('Size', /L/);
    await press('?');
    assert.equal(await page.locator('dialog[open]').count(), 1, '? opens the help');
    const help = await page.locator('dialog[open]').innerText();
    for (const words of ['Ctrl+Left', 'Open or close Settings', 'Show or hide the bars', 'Bring back or fold away', "this bar's pattern on the whole loop"]) {
      assert.ok(help.toLowerCase().includes(words.toLowerCase()), `the help lists: ${words}`);
    }
    await press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 0, 'Esc closes the help');
    await page.locator(`${NOTES} [role="gridcell"][tabindex="0"]`).focus();
    await press('/');
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('dialog', { name: 'Settings' }).isVisible(), true, '/ opens Settings');
    await press('Escape');
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('dialog', { name: 'Settings' }).isVisible(), false, 'Esc closes it');
    await onCursor(/^Bar 1, beat 1/, 'the cursor goes back where it was');
    await press("'");
    await page.waitForTimeout(100);
    assert.equal(await page.locator(BARS).isVisible(), false, "' hides the bars");
    await press("'");
    await page.waitForTimeout(100);
    assert.equal(await page.locator(BARS).isVisible(), true, "' shows the bars");

    // The loop recorder's keys.
    await press('v');
    await chosen('Mode', /Replace/);
    await press('v');
    await chosen('Mode', /Overdub/);
    await press('n');
    await chosen('Count-in', /2 bars/);
    await press('n');
    await chosen('Count-in', /Off/);
    await press('n');
    await chosen('Count-in', /1 bar/);
    await press('m');
    await chosen('Metronome', /Always/);
    await press('m');
    await chosen('Metronome', /Off/);
    await press('m');
    await chosen('Metronome', /Count-in only/);
    await press('q');
    await chosen('Quantise', /Triplets/);
    await press('q');
    await chosen('Quantise', /Off/);
    await press('q');
    await press('q');
    await press('q');
    await chosen('Quantise', /1\/16/);
    await press('c');
    await expectStatus(page, /capture|Captured/i, 'C');

    // Note keys: each plays, none does anything else.
    await page.getByRole('button', { name: /^Playing/ }).click();
    await page.getByRole('button', { name: /^Pads/ }).click();
    await page.keyboard.press('Escape');
    await page.locator(`${NOTES} [role="gridcell"][tabindex="0"]`).focus();
    const pads = page.locator('[aria-label="Pads"] button');
    assert.equal(await pads.count(), 12, 'twelve pads for a tune');
    for (const key of ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j']) {
      await page.keyboard.down(key);
      assert.equal(await page.evaluate(() => window.__used), true, `${key} is used`);
      assert.equal(await page.locator('[aria-label="Pads"] button[aria-pressed="true"]').count(), 1, `${key} lights a pad`);
      await page.keyboard.up(key);
    }
    for (const key of ['k', 'o', 'l', 'p', ';']) {
      await press(key);
      assert.equal(await page.evaluate(() => window.__used), true, `${key} is used`);
    }
    await press('z');
    await expectStatus(page, /Octave 3/, 'Z');
    await press('x');
    await expectStatus(page, /Octave 4/, 'X');
    const firstPad = pads.first();
    await firstPad.focus();
    await page.keyboard.down('Enter');
    assert.equal(await firstPad.getAttribute('aria-pressed'), 'true', 'Enter holds a pad');
    await page.keyboard.up('Enter');
    await page.keyboard.down('Space');
    assert.equal(await firstPad.getAttribute('aria-pressed'), 'true', 'Space holds a pad');
    await page.keyboard.up('Space');
    const padBox = await firstPad.boundingBox();
    await page.mouse.move(padBox.x + 5, padBox.y + 5);
    await page.mouse.down();
    assert.equal(await firstPad.getAttribute('aria-pressed'), 'true', 'the mouse holds a pad');
    await page.mouse.up();

    // In the notes.
    const cell = page.locator(`${NOTES} [role="gridcell"][tabindex="0"]`);
    await cell.focus();
    await onCursor(/beat 1 step 1, C4/, 'the cursor');
    await press('Enter');
    await expectStatus(page, /C4 on/, 'Enter');
    await press('Control+z');
    await expectStatus(page, /^Undone/, 'Ctrl+Z');
    await press('Control+y');
    await expectStatus(page, /^Redone/, 'Ctrl+Y');
    await press('Control+z');
    await press('Control+Shift+z');
    await expectStatus(page, /^Redone/, 'Ctrl+Shift+Z');
    await press('Shift+ArrowRight');
    await expectStatus(page, /2 steps long/, 'Shift+Right');
    await press('Shift+ArrowLeft');
    await expectStatus(page, /1 steps long/, 'Shift+Left');
    await press('Delete');
    await expectStatus(page, /Note deleted/, 'Delete');
    await press('ArrowRight');
    await onCursor(/beat 1 step 2/, 'Right');
    await press('ArrowLeft');
    await onCursor(/beat 1 step 1/, 'Left');
    await press('ArrowUp');
    await onCursor(/C#4/, 'Up');
    await press('ArrowDown');
    await onCursor(/C4/, 'Down');
    await press('Control+ArrowRight');
    await onCursor(/beat 2 step 1/, 'Ctrl+Right');
    await press('Control+ArrowLeft');
    await onCursor(/beat 1 step 1/, 'Ctrl+Left');
    await press('End');
    await onCursor(/beat 8 step 4/, 'End');
    await press('ArrowRight');
    await expectStatus(page, /^Bar 2/, 'off the end of a bar');
    await onCursor(/Bar 2, beat 1 step 1/, 'on to the next');
    await press('ArrowLeft');
    await onCursor(/Bar 1, beat 8 step 4/, 'and back');
    await press('Home');
    await onCursor(/beat 1 step 1/, 'Home');
    await press('PageUp');
    const upRow = await cursor();
    assert.doesNotMatch(upRow ?? '', /C4,/, 'Page Up moves up a screenful');
    await press('PageDown');
    await onCursor(/C4/, 'Page Down comes back');
    await press('Control+End');
    await onCursor(/beat 8 step 4/, 'Ctrl+End');
    await press('Control+Home');
    await onCursor(/beat 1 step 1/, 'Ctrl+Home');

    // In the bars.
    await cell.focus();
    await press('Shift+Tab');
    await onCursor(/^Tune 1, bar 1,/, 'Shift+Tab reaches the bars');
    await press('ArrowDown');
    await onCursor(/^Tune 1, bar 2,/, 'Down: a later bar');
    await press('ArrowUp');
    await onCursor(/^Tune 1, bar 1,/, 'Up: an earlier bar');
    await press('ArrowRight');
    await onCursor(/^Tune 2, bar 1,/, 'Right: another channel');
    await press('ArrowLeft');
    await onCursor(/^Tune 1, bar 1,/, 'Left: back');
    await press('End');
    await onCursor(/, bar 16,/, 'End');
    await press('Home');
    await onCursor(/, bar 1,/, 'Home');
    await press('Control+End');
    await onCursor(/^Drums, bar 16,/, 'Ctrl+End');
    await press('Control+Home');
    await onCursor(/^Tune 1, bar 1,/, 'Ctrl+Home');
    await press('Shift+ArrowDown');
    await expectStatus(page, /Bars 1 to 2 picked/, 'Shift+Down');
    await press('l');
    await expectStatus(page, /Loop: bars 1 to 2/, 'L');
    await press('Control+z');
    await expectStatus(page, /^Undone/, 'undo of L');
    await press('5');
    await onCursor(/pattern 5/, 'a number sets the pattern');
    await press('+');
    await onCursor(/pattern 6/, '+');
    await press('-');
    await onCursor(/pattern 5/, '-');
    await press('0');
    await onCursor(/silent/, '0');
    await press('1');
    await press('f');
    await expectStatus(page, /pattern 1 on the whole loop/, 'F');
    await press('Enter');
    await onCursor(/^Bar 1, beat 1 step 1/, 'Enter goes to the notes');

    // A set of choices: arrows.
    await page.locator('[role="radiogroup"][aria-label="Size"] [aria-checked="true"]').focus();
    await press('ArrowLeft');
    await chosen('Size', /M/);
    await press('ArrowRight');
    await chosen('Size', /L/);

    // Where the old keys went, by name.
    for (const name of [/^Stop$/, /^Loop 1-4$/, /^Slower$/, /^Faster$/, /^Undo$/, /^Sounds$/, /^Recorder$/, /^Playing$/, /^Song$/, /^Settings$/, /^All the keys$/, /^Earlier$/, /^Later$/, /^Higher$/, /^Lower$/, /^Bars$/, /^Previous pattern$/, /^Next pattern$/, /^Fill$/, /^Set loop$/, /^Earlier bars$/, /^Later bars$/]) {
      assert.equal(await page.getByRole('button', { name }).count(), 1, `the ${name} key is there`);
    }
    const inWindow = async (windowName, names) => {
      await page.locator(`[data-window-key="${windowName.toLowerCase()}"]`).click();
      await page.waitForTimeout(100);
      const dialog = page.getByRole('dialog', { name: windowName });
      for (const name of names) assert.ok((await dialog.getByRole('button', { name }).count()) >= 1, `the ${name} key is in ${windowName}`);
      return dialog;
    };
    await inWindow('Settings', [/^High contrast/, /^Follow/, /^Focus view/, /^Redo$/, /^Put windows back$/, /^Put all the keys back$/]);
    assert.equal(await pressed(/^Follow/), 'false');
    await page.keyboard.press('Escape');
    const recorder = await inWindow('Recorder', [/^Capture last pass/, /^Calibrate timing$/]);
    assert.equal(await recorder.getByRole('slider', { name: /Quantise strength/ }).count(), 1, 'quantise strength');
    await page.keyboard.press('Escape');
    await inWindow('Playing', [/^Lower$/, /^Higher$/, /^Pads/, /^Connect MIDI keyboard$/]);
    await page.keyboard.press('Escape');
    await inWindow('Song', [/^Open song$/, /^Use example song$/, /^Open a song file$/, /^Save MIDI/, /^Save sound/, /^Save song file/, /^Copy share link$/]);
    await page.keyboard.press('Escape');
    await context.close();
  });

  await test(7, 'keyboard reach: Tab gets to every key, and the focus ring is as strong as DISCOVER', async () => {
    const { context, page } = await open(browser, 1280, 900);
    const reach = async () => {
      const wanted = await page.evaluate(() => {
        document.querySelectorAll('[data-reached]').forEach((element) => element.removeAttribute('data-reached'));
        return [...document.querySelectorAll('.debaser-beatbox button:not([tabindex="-1"]), .debaser-beatbox a, .debaser-beatbox input:not([tabindex="-1"]), .debaser-beatbox textarea')]
          .filter((element) => element.getBoundingClientRect().width > 1 && !element.classList.contains('sr-only')).length;
      });
      await page.locator(`${MAIN} button`).first().focus();
      let reached = 0;
      for (let i = 0; i < 90; i += 1) {
        const inBox = await page.evaluate(() => {
          const active = document.activeElement;
          if (!active.closest('.debaser-beatbox')) return null;
          if (active.getBoundingClientRect().width <= 1 || active.hasAttribute('data-reached')) return false;
          active.setAttribute('data-reached', '');
          return active.matches('button, a, input, textarea');
        });
        if (inBox === null) break;
        if (inBox) reached += 1;
        await page.keyboard.press('Tab');
      }
      return { wanted, reached };
    };
    const shut = await reach();
    await page.locator(`${NOTES} [role="gridcell"][tabindex="0"]`).focus();
    await page.keyboard.press('Shift+S');
    await page.waitForTimeout(150);
    const opened = await reach();
    await page.keyboard.press('Escape');
    const ring = await page.locator(`${MAIN} button`).first().evaluate((button) => {
      button.focus();
      const style = getComputedStyle(button);
      return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
    });
    numbers['keyboard reach'] = { shut, opened, ring };
    await context.close();
    assert.ok(shut.reached >= shut.wanted, `Tab reached ${shut.reached} of ${shut.wanted} with the windows shut`);
    assert.ok(opened.reached >= opened.wanted, `Tab reached ${opened.reached} of ${opened.wanted} with a window open`);
    assert.ok(ring.width >= 2 && ring.style !== 'none', `focus ring ${ring.width}px, DISCOVER's is 2px`);
  });

  await test(7, 'screen-reader words: names, the status line, problems', async () => {
    const { context, page } = await open(browser, 1280, 900);
    assert.equal(await page.locator(STATUS).getAttribute('aria-live'), 'polite');
    assert.equal(await page.locator('.debaser-beatbox [role="alert"]').count(), 1, 'an alert place, there before a problem');
    assert.match((await page.locator(`${NOTES} [role="gridcell"]`).first().getAttribute('aria-label')) ?? '', /^Bar 1, beat 1 step 1, .+, off$/);
    assert.match((await page.locator(`${BARS} [role="gridcell"]`).first().getAttribute('aria-label')) ?? '', /^Tune 1, bar 1, pattern 1$/);
    assert.match(await page.locator('.debaser-beatbox h2.sr-only').first().textContent(), /Bars|Tune/);
    assert.equal(await page.locator('.debaser-beatbox [aria-keyshortcuts="Space"]').count(), 1, 'Play names its key');
    await page.keyboard.press('i');
    assert.equal(await page.locator(STATUS).getAttribute('aria-live'), 'off', 'Sonify quiets the status');
    await page.keyboard.press('i');
    await page.keyboard.press('i');
    await page.keyboard.press('Shift+O');
    await page.locator('#song-link').fill('not a song');
    await page.keyboard.press('Enter');
    await expectStatus(page, /^Problem/, 'a bad link');
    assert.match((await page.locator('.debaser-beatbox [role="alert"]').textContent()) ?? '', /^Problem/, 'problems are spoken');
    await context.close();
  });

  await test(7, 'MIDI: connects, and a played note lights a pad', async () => {
    const { context, page } = await open(browser, 1280, 900);
    await page.keyboard.press('Shift+P');
    await page.getByRole('button', { name: /^Pads/ }).click();
    await page.getByRole('button', { name: 'Connect MIDI keyboard' }).click();
    await page.getByText(/Connected: CHECK KEYS/).waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const lit = await page.evaluate(() => {
      window.__midiInput.onmidimessage?.({ data: new Uint8Array([0x90, 60, 100]), timeStamp: performance.now() });
      return new Promise((resolve) => setTimeout(() => resolve(document.querySelectorAll('[aria-label="Pads"] button[aria-pressed="true"]').length), 100));
    });
    await context.close();
    assert.equal(lit, 1, 'the note lights its pad');
  });

  await test(7, 'opening: a link in the address, in the box, an example and a file', async () => {
    const { context, page } = await open(browser, 1280, 900, { hash: EXAMPLE });
    await expectStatus(page, /^Song opened/, 'a link in the address');
    assert.ok((await page.locator(`${BARS} [role="gridcell"]`).count()) > 0);
    await page.keyboard.press('Shift+O');
    await page.getByRole('button', { name: 'Use example song' }).click();
    assert.ok(((await page.locator('#song-link').inputValue()) ?? '').includes('beepbox'), 'the example fills the box');
    await page.locator('#song-link').focus();
    await page.keyboard.press('Enter');
    await expectStatus(page, /^Song opened/, 'the link box');
    const song = await songFileWhileOpen(page);
    await page.locator('input[type="file"]').setInputFiles({ name: 'song.json', mimeType: 'application/json', buffer: Buffer.from(song) });
    await expectStatus(page, /^Song opened/, 'a song file');
    await context.close();
  });

  await test(7, 'exporting: real .mid, .wav and .json downloads, and a share link', async () => {
    const { context, page } = await open(browser, 1280, 900);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+O');
    await page.waitForTimeout(100);
    for (const [name, file] of [[/^Save MIDI/, /\.mid$/], [/^Save sound/, /\.wav$/], [/^Save song file/, /\.json$/]]) {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.getByRole('button', { name }).click()]);
      assert.match(download.suggestedFilename(), file);
      assert.ok(fs.statSync(await download.path()).size > 20, `${file} has something in it`);
    }
    await page.getByRole('button', { name: 'Copy share link' }).click();
    await page.waitForTimeout(200);
    const link = await page.locator('textarea[readonly]').inputValue();
    assert.match(link, /\/beatbox#/, 'the share link opens here');
    // The link really does bring the song back.
    const original = shape(JSON.parse(await page.evaluate(() => window.__lastBlob.text())));
    const again = await open(browser, 1280, 900, { hash: link.slice(link.indexOf('#')) });
    const reopened = shape(await songFile(again.page));
    await again.context.close();
    await context.close();
    assert.equal(reopened, original, 'the same notes come back from the link');
  });

  await test(7, 'saving and sharing: signed out, the way in; signed in, save, open, delete and post', async () => {
    const { context, page } = await open(browser, 1280, 900);
    await page.keyboard.press('Shift+O');
    await page.waitForTimeout(100);
    const menu = page.getByRole('dialog', { name: 'Song' });
    if (!STAND_IN) {
      assert.equal(await menu.getByRole('link', { name: /Sign in to save songs/i }).count(), 1, 'sign in to save');
      assert.equal(await menu.getByRole('link', { name: /Sign in to share/i }).count(), 1, 'sign in to share');
      assert.equal(await menu.getByRole('link', { name: /CREDITS/i }).getAttribute('href'), '/beatbox/credits');
      numbers['saving and sharing'] = 'signed out only: the way in shows. Saving and posting not driven on the deployed site.';
      await context.close();
      return;
    }
    await context.close();
    const signed = await open(browser, 1280, 900, { standIn: true });
    const box = signed.page;
    await box.keyboard.press('Enter');
    await box.keyboard.press('Shift+O');
    await box.waitForTimeout(150);
    const area = box.getByRole('dialog', { name: 'Song' });
    await area.getByLabel('Title', { exact: true }).fill('CHECK SONG');
    await area.getByRole('button', { name: /Save as new song/ }).click();
    await area.getByText(/Saved: CHECK SONG/).waitFor({ timeout: 5000 });
    await area.getByRole('button', { name: /^Save over CHECK SONG/ }).click();
    await area.getByRole('button', { name: /^Save over CHECK SONG, really/ }).click();
    await area.getByText(/Saved over CHECK SONG/).waitFor({ timeout: 5000 });
    await area.getByRole('button', { name: /^Open CHECK SONG/ }).click();
    await area.getByRole('button', { name: /^Open CHECK SONG, replacing/ }).click();
    await box.waitForSelector(NOTES, { timeout: 10000 });
    await box.waitForTimeout(500);
    await box.keyboard.press('Shift+O');
    await box.waitForTimeout(150);
    const reopened = box.getByRole('dialog', { name: 'Song' });
    await reopened.getByRole('button', { name: /^Delete CHECK SONG/ }).click();
    await reopened.getByRole('button', { name: /^Delete CHECK SONG, really/ }).click();
    await reopened.getByText(/Deleted: CHECK SONG/).waitFor({ timeout: 5000 });
    await reopened.getByRole('button', { name: 'Share to forum' }).click();
    await reopened.getByLabel('Title for the post').fill('CHECK POST');
    await reopened.getByRole('button', { name: 'Post', exact: true }).click();
    await reopened.getByText(/Posted to the forum/).waitFor({ timeout: 8000 });
    numbers['saving and sharing'] = 'signed in to a stand-in account on the mock store: saved, saved over, opened, deleted, posted';
    await signed.context.close();
  });

  await test(7, 'the way back: tabs and music bar stay, and leaving restores the side panel', async () => {
    // Someone who keeps their panel folded, and someone who keeps it open.
    for (const stored of ['closed', 'open']) {
      const { context, page } = await open(browser, 1280, 900, { storage: { 'debaser.shell.sidebar.v1': stored } });
      assert.equal(await page.locator('aside').isVisible().catch(() => false), false, 'the panel starts folded here');
      assert.ok(await page.getByRole('link', { name: 'FORUM' }).first().isVisible(), 'the site tabs stay');
      assert.ok(await page.getByText(/PLAYER|NOTHING QUEUED/).first().isVisible(), 'the music bar stays');
      await page.keyboard.press('\\');
      await page.waitForTimeout(150);
      assert.equal(await page.locator('aside').isVisible(), true, '\\ brings the panel back');
      await page.keyboard.press('\\');
      await page.waitForTimeout(150);
      assert.equal(await page.locator('aside').count(), 0, '\\ folds it again');
      await page.getByRole('button', { name: /SIDE PANEL/ }).click();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('aside').isVisible(), true, 'the rail is the one key too');
      await page.getByRole('link', { name: 'FORUM' }).first().click();
      await page.waitForURL(/\/forum/, { timeout: 60000 });
      await page.waitForTimeout(800);
      assert.equal(await page.locator('aside').count() > 0, stored === 'open', `a reader who keeps it ${stored} finds it ${stored}`);
      assert.equal(await page.evaluate(() => localStorage.getItem('debaser.shell.sidebar.v1')), stored, 'what they chose is untouched');
      await context.close();
    }
  });

  // 8. The windows: they move, they stay on the screen, and the page works behind them.
  const windowBox = (page, name) => page.locator(`[data-window="${name}"]`).boundingBox();
  const dragTitle = async (page, name, by) => {
    const title = await page.getByRole('button', { name: new RegExp(`^Move the ${name} window`) }).boundingBox();
    const from = { x: title.x + title.width / 2, y: title.y + title.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + by.x / 2, from.y + by.y / 2);
    await page.mouse.move(from.x + by.x, from.y + by.y);
    await page.mouse.up();
    await page.waitForTimeout(100);
  };

  await test(8, 'a window drags by its title, moves by the arrow keys, and is back there next time', async () => {
    const { context, page } = await open(browser, 1280, 900);
    await page.getByRole('button', { name: /^Sounds/ }).click();
    await page.waitForTimeout(150);
    const start = await windowBox(page, 'sounds');
    await dragTitle(page, 'Sounds', { x: 300, y: 40 });
    const dragged = await windowBox(page, 'sounds');
    assert.ok(Math.abs(dragged.x - start.x - 300) <= 1, `moved ${dragged.x - start.x} across`);
    assert.ok(Math.abs(dragged.y - start.y - 40) <= 41, 'and down, as far as there is room');
    await page.getByRole('button', { name: /^Move the Sounds window/ }).focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(80);
    const nudged = await windowBox(page, 'sounds');
    assert.equal(Math.round(dragged.x - nudged.x), 32, 'the arrow keys move it too');
    await page.screenshot({ path: path.join(OUT, 'window-moved.png') });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(NOTES, { timeout: 120000 });
    await page.waitForTimeout(500);
    assert.equal(await page.getByRole('dialog', { name: 'Sounds' }).count(), 0, 'the page opens clear');
    await page.getByRole('button', { name: /^Sounds/ }).click();
    await page.waitForTimeout(150);
    const again = await windowBox(page, 'sounds');
    assert.equal(Math.round(again.x), Math.round(nudged.x), 'it opens where it was left');
    await page.keyboard.press('/');
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Put windows back' }).click();
    await page.waitForTimeout(150);
    const backAgain = await windowBox(page, 'sounds');
    assert.equal(Math.round(backAgain.x), Math.round(start.x), 'Put windows back');
    await context.close();
  });

  await test(8, 'a window cannot be lost off an edge, even dragged hard, even when the screen shrinks', async () => {
    const { context, page } = await open(browser, 1280, 900);
    await page.getByRole('button', { name: /^Recorder/ }).click();
    await page.waitForTimeout(150);
    const seen = [];
    const room = () => page.evaluate(() => {
      const box = document.querySelector('[data-window="recorder"]').parentElement.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    });
    for (const by of [{ x: -3000, y: -3000 }, { x: 3000, y: 3000 }, { x: 3000, y: -3000 }, { x: -3000, y: 3000 }]) {
      await dragTitle(page, 'Recorder', by);
      seen.push([await windowBox(page, 'recorder'), await room(), await page.locator(MAIN).boundingBox()]);
    }
    await page.setViewportSize({ width: 900, height: 620 });
    await page.waitForTimeout(300);
    seen.push([await windowBox(page, 'recorder'), await room(), await page.locator(MAIN).boundingBox()]);
    await context.close();
    for (const [box, area, barBottom] of seen) {
      assert.ok(box.x >= area.left - 1 && box.y >= area.top - 1, `off the top or left: ${JSON.stringify(box)}`);
      assert.ok(box.x + box.width <= area.right + 1 && box.y + box.height <= area.bottom + 1, `off the bottom or right: ${JSON.stringify(box)} in ${JSON.stringify(area)}`);
      assert.ok(box.y >= barBottom.y + barBottom.height - 1, 'and never over the main keys');
    }
  });

  await test(8, 'the page works behind a window, several stay open, and the one clicked comes to the front', async () => {
    const { context, page } = await open(browser, 1920, 1080);
    await page.getByRole('button', { name: /^Sounds/ }).click();
    await page.getByRole('button', { name: /^Recorder/ }).click();
    await page.waitForTimeout(150);
    assert.equal(await page.getByRole('dialog').count(), 2, 'both open');
    // Nothing on the page draws over a window: an empty grid's words once did.
    await page.getByRole('button', { name: /^Sounds/ }).click();
    await page.waitForTimeout(100);
    await dragTitle(page, 'Sounds', { x: 750, y: 0 });
    const covered = await page.evaluate(() => {
      const box = document.querySelector('[data-window="sounds"]');
      // Those words let clicks through, so the browser wouldn't say they're there without this.
      const see = document.createElement('style');
      see.textContent = '.debaser-beatbox * { pointer-events: auto !important; }';
      document.head.append(see);
      const under = [...box.querySelectorAll('button')]
        .filter((key) => {
          const { left, top, width, height } = key.getBoundingClientRect();
          const point = document.elementFromPoint(left + width / 2, top + height / 2);
          return !box.contains(point);
        })
        .map((key) => key.textContent);
      see.remove();
      return under;
    });
    assert.deepEqual(covered, [], 'keys covered in the window in front');
    await page.getByRole('button', { name: /^Recorder/ }).click();
    await page.waitForTimeout(100);
    const stack = (name) => page.locator(`[data-window="${name}"]`).evaluate((box) => Number(getComputedStyle(box).zIndex));
    assert.ok((await stack('recorder')) > (await stack('sounds')), 'the newest in front');
    // Behind them: a note goes in, the song plays, the bars answer.
    await page.locator(`${NOTES} [role="gridcell"]`).last().click();
    await expectStatus(page, / on, beat /, 'a note goes in behind the windows');
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    assert.equal(await page.locator(`${MAIN} button`).first().textContent(), 'Pause', 'and the song plays');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 1, 'Esc closes the one in front');
    assert.equal(await page.locator(`${MAIN} button`).first().textContent(), 'Pause', 'and only that');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.equal(await page.locator(`${MAIN} button`).first().textContent(), 'Play', 'with none open, Esc stops');
    // The key of a window behind others brings it forward; the key of the one in front closes it.
    await page.getByRole('button', { name: /^Sounds/ }).click();
    await page.getByRole('button', { name: /^Recorder/ }).click();
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: /^Sounds/ }).click();
    await page.waitForTimeout(100);
    assert.ok((await stack('sounds')) > (await stack('recorder')), 'brought forward');
    assert.equal(await page.getByRole('dialog').count(), 2);
    await page.getByRole('button', { name: /^Sounds/ }).click();
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('dialog').count(), 1, 'closed');
    // A click on one behind brings it forward too.
    await page.getByRole('button', { name: /^Song/ }).click();
    await page.waitForTimeout(100);
    await page.getByRole('dialog', { name: 'Recorder' }).getByRole('button', { name: /^Move the / }).click({ position: { x: 12, y: 12 } });
    await page.waitForTimeout(100);
    assert.ok((await stack('recorder')) > (await stack('song')), 'a click brings it forward');
    await context.close();
  });

  // 9. Play, pause, stop and the loop.
  await test(9, 'Play, Pause and Stop: a pause keeps the place, Stop goes back, and the keys stay where they are', async () => {
    const { context, page } = await open(browser, 1280, 900);
    const first = page.locator(`${MAIN} button`).first();
    const spot = () => page.evaluate(() => document.querySelector('.debaser-beatbox [data-playhead]')?.getAttribute('data-playhead') ?? null);
    const widthBefore = (await first.boundingBox()).width;
    const stopBefore = (await page.getByRole('button', { name: 'Stop', exact: true }).boundingBox()).x;
    await page.keyboard.press('Space');
    await page.waitForTimeout(1200);
    assert.equal(await first.textContent(), 'Pause');
    assert.equal((await first.boundingBox()).width, widthBefore, 'the key keeps its size between Play and Pause');
    assert.equal((await page.getByRole('button', { name: 'Stop', exact: true }).boundingBox()).x, stopBefore, 'and nothing moves');
    await page.keyboard.press('Space');
    await expectStatus(page, /^Paused/, 'Space pauses');
    assert.equal(await first.textContent(), 'Play');
    const held = await spot();
    assert.ok(held !== null, 'the playhead stays where it paused');
    await page.waitForTimeout(500);
    assert.equal(await spot(), held, 'and stays still');
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    assert.equal(await first.textContent(), 'Pause', 'Space carries on');
    const on = await spot();
    const [heldBar, heldStep] = held.split(':').map(Number);
    const [onBar, onStep] = on.split(':').map(Number);
    assert.ok(onBar * 1000 + onStep >= heldBar * 1000 + heldStep, `carried on from the same place: ${held} then ${on}`);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expectStatus(page, /^Stopped/, 'Stop');
    assert.equal(await first.textContent(), 'Play');
    assert.equal(await spot(), null, 'Stop clears the playhead');
    await context.close();
  });

  await test(9, 'Space plays and pauses wherever the cursor is, and never presses the last key clicked', async () => {
    const { context, page } = await open(browser, 1280, 900);
    const first = page.locator(`${MAIN} button`).first();
    await page.getByRole('button', { name: /^Faster/ }).click();
    await expectStatus(page, /Speed: 155/, 'Faster');
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    assert.equal(await first.textContent(), 'Pause', 'Space plays, with Faster last clicked');
    assert.match(await page.locator(MAIN).innerText(), /155/, 'and did not press Faster again');
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    assert.equal(await first.textContent(), 'Play', 'pauses too');
    await page.keyboard.press('Escape');
    // Enter still presses a key, for anyone on the keyboard.
    await page.getByRole('button', { name: /^Faster/ }).focus();
    await page.keyboard.press('Enter');
    await expectStatus(page, /Speed: 160/, 'Enter presses the key');
    // Where Space has a use of its own, it keeps it: typing, and a set of choices.
    await page.keyboard.press('Shift+O');
    await page.waitForTimeout(100);
    await page.locator('#song-link').focus();
    await page.keyboard.type('a b');
    assert.equal(await page.locator('#song-link').inputValue(), 'a b', 'Space types in a text box');
    assert.equal(await first.textContent(), 'Play', 'without playing');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+R');
    await page.waitForTimeout(100);
    const replace = page.getByRole('radio', { name: /Replace/ });
    await page.getByRole('radio', { name: /Overdub/ }).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('radio', { name: /Overdub/ }).focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    assert.equal(await first.textContent(), 'Play', 'Space picks a choice');
    assert.equal(await replace.getAttribute('aria-checked'), 'false', 'the one it was on');
    await context.close();
  });

  await test(9, 'the Loop key: on repeats, off plays the song once and stops, and recording always goes round', async () => {
    const { context, page } = await open(browser, 1280, 900);
    const first = page.locator(`${MAIN} button`).first();
    const loop = page.locator(MAIN).getByRole('button', { name: /^Loop/ });
    assert.equal(await loop.textContent(), 'Loop 1-4', 'it says which bars');
    assert.equal(await loop.getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Shift+L');
    await expectStatus(page, /^Loop off/, 'Shift+L');
    assert.equal(await loop.textContent(), 'Loop off');
    assert.equal(await loop.getAttribute('aria-pressed'), 'false');
    // A short song, to reach its end in good time.
    for (let i = 0; i < 6; i += 1) await page.keyboard.press(']');
    await page.locator(`${BARS} [role="gridcell"]`).nth(0).focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    assert.equal(await first.textContent(), 'Pause', 'from the last bar');
    await expectStatus(page, /^That's the end of the song/, 'it stops by itself at the end');
    assert.equal(await first.textContent(), 'Play');
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('r');
    await page.locator(MAIN).getByRole('button', { name: /^Rec/, pressed: true }).waitFor({ timeout: 5000 });
    await page.locator(MAIN).getByRole('button', { name: /^Rec.* 2$/ }).waitFor({ timeout: 30000 });
    await page.keyboard.press('Escape');
    await loop.click();
    await expectStatus(page, /^Loop on/, 'and back on');
    assert.equal(await loop.textContent(), 'Loop 1-4');
    await context.close();
  });

  // 10. The keyboard keys.
  await test(10, 'the Settings window shows every key, and one can be changed, swapped, refused, kept and put back', async () => {
    const { context, page } = await open(browser, 1280, 900);
    const first = page.locator(`${MAIN} button`).first();
    await page.getByRole('button', { name: /^Settings/ }).click();
    await page.waitForTimeout(150);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    const shown = (action) => settings.locator(`[data-key-shown="${action}"]`).textContent();
    const change = (action) => settings.locator(`[data-change-key="${action}"]`).click();
    assert.equal(await shown('playPause'), 'Space', 'Space is play and pause to begin with');
    assert.equal(await settings.locator('[data-change-key]').count(), 27, 'every key that can change');
    await page.screenshot({ path: path.join(OUT, 'settings.png') });

    // A key that would break the notes.
    await change('playPause');
    assert.equal(await shown('playPause'), 'Press a key');
    await page.keyboard.press('a');
    await settings.getByRole('alert').waitFor({ timeout: 2000 });
    assert.match(await settings.getByRole('alert').textContent(), /A plays notes/);
    assert.equal(await shown('playPause'), 'Press a key', 'still waiting');
    await page.keyboard.press('Enter');
    assert.match(await settings.getByRole('alert').textContent(), /Enter moves around/);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    assert.equal(await shown('playPause'), 'Space', 'Esc leaves it');
    assert.equal(await page.getByRole('dialog', { name: 'Settings' }).isVisible(), true, 'and the window open');

    // A free key.
    await change('playPause');
    await page.keyboard.press('Insert');
    await page.waitForTimeout(80);
    assert.equal(await shown('playPause'), 'Insert');
    await expectStatus(page, /Play or pause is now Insert/, 'it says so');
    assert.match(await first.getAttribute('title'), /Insert/, 'the key on the bar says so too');
    await page.keyboard.press('Insert');
    await page.waitForTimeout(150);
    assert.equal(await first.textContent(), 'Pause', 'the new key plays');
    await page.keyboard.press('Insert');
    await page.waitForTimeout(100);
    assert.equal(await first.textContent(), 'Play');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.locator(`${NOTES} [role="gridcell"][tabindex="0"]`).focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    assert.equal(await first.textContent(), 'Play', 'Space does nothing now');
    await page.keyboard.press('/');
    await page.waitForTimeout(150);

    // A key something else has: it offers to swap.
    await change('playPause');
    await page.keyboard.press('r');
    await settings.getByRole('alert').waitFor({ timeout: 2000 });
    assert.match(await settings.getByRole('alert').textContent(), /R is already: Record/);
    await settings.getByRole('button', { name: 'Leave it' }).click();
    await page.waitForTimeout(80);
    assert.equal(await shown('playPause'), 'Insert', 'Leave it leaves it');
    await change('playPause');
    await page.keyboard.press('r');
    await settings.getByRole('button', { name: 'Swap them' }).click();
    await page.waitForTimeout(80);
    assert.equal(await shown('playPause'), 'R');
    assert.equal(await shown('record'), 'Insert', 'each has the other key');

    // A key that plays no note otherwise, and Space given back, pressed on the focused Change key.
    await change('help');
    await page.keyboard.press('Shift+A');
    await page.waitForTimeout(80);
    assert.equal(await shown('help'), 'Shift+A', 'Shift and a piano key is free');
    await change('record');
    await page.keyboard.press('Space');
    await page.waitForTimeout(80);
    assert.equal(await shown('record'), 'Space', 'Space can be chosen, and pressed no key doing it');
    assert.equal(await settings.getByRole('alert').count(), 0);

    // Remembered, in the help too.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(NOTES, { timeout: 120000 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Shift+A');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('dialog[open]').count(), 1, 'the changed key opens the help after a reload');
    assert.match(await page.locator('dialog[open]').innerText(), /Shift\+A/, 'and the help lists it');
    await page.keyboard.press('Escape');
    await page.keyboard.press('/');
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Put all the keys back' }).click();
    await page.waitForTimeout(100);
    assert.equal(await shown('playPause'), 'Space', 'all back');
    assert.equal(await shown('record'), 'R');
    assert.equal(await shown('help'), '?');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(NOTES, { timeout: 120000 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    assert.equal(await first.textContent(), 'Pause', 'and they stay back');
    await context.close();
  });

  // 11. The sounds.
  const peaks = async (page) => {
    await page.getByRole('button', { name: /^Save sound/ }).click();
    await page.waitForFunction(() => /\.wav$/.test(window.__lastSaved ?? '') || window.__lastBlob?.type === 'audio/wav', null, { timeout: 90000 });
    await page.waitForTimeout(150);
    return page.evaluate(async () => {
      const bytes = new Int16Array(await window.__lastBlob.slice(44).arrayBuffer());
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < bytes.length; i += 1) {
        peak = Math.max(peak, Math.abs(bytes[i]));
        sum = (sum * 31 + bytes[i]) % 1000000007;
      }
      window.__lastBlob = null;
      return { peak, sum };
    });
  };

  await test(11, 'a channel picks a kind of instrument, the song keeps it, and undo brings the last one back', async () => {
    const { context, page } = await open(browser, 1280, 900);
    await page.keyboard.press('Shift+S');
    await page.waitForTimeout(150);
    const sounds = page.getByRole('dialog', { name: 'Sounds' });
    const chosen = async () => (await sounds.getByRole('radiogroup', { name: 'Sound' }).locator('[aria-checked="true"]').textContent()).replace('> ', '');
    assert.equal(await sounds.getByRole('radiogroup', { name: 'Sound' }).getByRole('radio').count(), 15, 'fifteen for a tune');
    const before = await chosen();
    await sounds.getByRole('radio', { name: 'Plucked string' }).click();
    await expectStatus(page, /has a new sound/, 'picking one');
    assert.equal(await chosen(), 'Plucked string');
    await page.screenshot({ path: path.join(OUT, 'sounds.png') });
    const saved = async () => {
      await page.keyboard.press('Shift+O');
      await page.waitForTimeout(100);
      await page.getByRole('button', { name: /Save song file/ }).click();
      await page.waitForTimeout(200);
      const json = JSON.parse(await page.evaluate(() => window.__lastBlob.text()));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      return json;
    };
    assert.equal((await saved()).channels[0].instruments[0].type, 'Picked String', 'the saved song has it');
    await page.keyboard.press('Control+z');
    await expectStatus(page, /^Undone/, 'undo');
    assert.equal(await chosen(), before, 'undo brings the last one back');
    await page.keyboard.press('Control+y');
    assert.equal(await chosen(), 'Plucked string', 'redo too');
    // The drums have their own list, and the window follows the channel.
    await sounds.getByRole('radio', { name: 'Drums' }).click();
    await page.waitForTimeout(100);
    assert.equal(await sounds.getByRole('radiogroup', { name: 'Sound' }).getByRole('radio').count(), 7, 'seven for the drums');
    await sounds.getByRole('radio', { name: 'Clang' }).click();
    assert.equal((await saved()).channels[3].instruments[0].wave, 'clang');
    // A link keeps it.
    await page.keyboard.press('Shift+O');
    await page.getByRole('button', { name: 'Copy share link' }).click();
    await page.waitForTimeout(200);
    const link = await page.locator('textarea[readonly]').inputValue();
    const again = await open(browser, 1280, 900, { hash: link.slice(link.indexOf('#')) });
    await again.page.keyboard.press('Shift+S');
    await again.page.waitForTimeout(150);
    const reopened = again.page.getByRole('dialog', { name: 'Sounds' });
    assert.equal(await reopened.getByRole('radio', { name: 'Plucked string' }).getAttribute('aria-checked'), 'true', 'a share link brings it back');
    await again.context.close();
    await context.close();
  });

  await test(11, 'a song with a sound of its own keeps it until something else is picked', async () => {
    const { context, page } = await open(browser, 1280, 900, { hash: EXAMPLE });
    await expectStatus(page, /^Song opened/, 'the example');
    await page.keyboard.press('Shift+S');
    await page.waitForTimeout(150);
    const sounds = page.getByRole('dialog', { name: 'Sounds' });
    assert.ok((await sounds.getByRole('radiogroup', { name: 'Sound' }).locator('[aria-checked="true"]').count()) === 1, 'one chosen, whatever it is');
    await context.close();
  });

  await test(11, 'every sound on the list makes sound, and each comes out different', async () => {
    const { context, page } = await open(browser, 1280, 900);
    await page.setViewportSize({ width: 1920, height: 1080 });
    // One note on the tune and one on the drums, in a short song, so each sound file is quick to make.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+S');
    await page.keyboard.press('Shift+O');
    await page.waitForTimeout(200);
    await dragTitle(page, 'Song', { x: 800, y: 0 });
    const sounds = page.getByRole('dialog', { name: 'Sounds' });
    const report = {};
    for (const channel of ['Tune 1', 'Drums']) {
      await sounds.getByRole('radio', { name: channel }).click();
      await page.waitForTimeout(100);
      if (channel === 'Drums') {
        await page.locator(`${NOTES} [role="gridcell"]`).nth(0).click();
        await page.waitForTimeout(100);
      }
      const names = await sounds.getByRole('radiogroup', { name: 'Sound' }).getByRole('radio').allTextContents();
      for (const raw of names) {
        const name = raw.replace('> ', '');
        await sounds.getByRole('radio', { name: new RegExp(`^(> )?${name}$`) }).click();
        await page.waitForTimeout(60);
        report[`${channel}: ${name}`] = await peaks(page);
      }
    }
    numbers.sounds = report;
    await context.close();
    const entries = Object.entries(report);
    for (const [name, { peak }] of entries) assert.ok(peak > 100, `${name} is silent: peak ${peak}`);
    const tuneSums = entries.filter(([name]) => name.startsWith('Tune')).map(([, { sum }]) => sum);
    assert.equal(new Set(tuneSums).size, tuneSums.length, 'two tune sounds came out the same');
    const drumSums = entries.filter(([name]) => name.startsWith('Drums')).map(([, { sum }]) => sum);
    assert.equal(new Set(drumSums).size, drumSums.length, 'two drum sounds came out the same');
  });

  await browser.close();

  fs.writeFileSync(path.join(OUT, 'numbers.json'), JSON.stringify(numbers, null, 1));
  console.log('\nNUMBERS');
  for (const [name, value] of Object.entries(numbers)) console.log(`  ${name}: ${JSON.stringify(value)}`);
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} passed against ${BASE}`);
  if (failed.length > 0) process.exit(1);
};

/** The song file while the Song window's already open. */
async function songFileWhileOpen(page) {
  await page.getByRole('button', { name: /Save song file/ }).click();
  await page.waitForTimeout(250);
  return page.evaluate(() => window.__lastBlob.text());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
