/**
 * Take a picture of a page - and say what is in the picture.
 *
 * **Why this is a tool and not a command line.** The line it replaces was retyped, wrongly, every time:
 *
 *     chrome.exe --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --screenshot=out.png <url>
 *
 * which cannot wait for a client-rendered page, cannot press anything, cannot capture past the first
 * screen, and - the one that cost the most - **writes a picture of "This site can't be reached" to disk
 * under whatever name it was given**. `Temp/browse/account.png` is exactly that file: a refused
 * connection, filed under the name of the account page, with nothing anywhere to say so. Two instruments
 * then read it and reported `0 panes` and `no WebGL context`, which both read as statements about the site.
 *
 * So this refuses loudly instead: when the page is the browser's own error page it says **NOTHING IS
 * LISTENING at that address**, prints the `ERR_...`, and writes nothing. A capture that did not happen is a
 * hundred times more useful than a capture that lies. `--allow-error-page` overrides it, because a guard
 * with no way past it is a guard that gets deleted.
 *
 * **What it can and cannot do.** It can name one page, wait for it, name a sequence of controls by their
 * *text* (or a selector), hover, focus or press them, **type into one, press keys, drag one onto another,
 * and scroll** - then write the PNG, read it back, and report its size, its distinct colours and whether
 * any pixel is a grey. It cannot decide what to press for you, it cannot judge whether the result looks
 * right, and one still frame cannot show motion: a `READING...` in a capture is a pre-hydration state and
 * not a result.
 *
 *     npm run shot                                          the deployed board
 *     npm run shot -- --url http://localhost:3210/account    a local build
 *     npm run shot -- --out Temp/browse/account.png --full-page
 *     npm run shot -- --clip "fieldset:first-of-type"       one element
 *     npm run shot -- --hover "[ MUSIC ]"                   with a real pointer on it
 *     npm run shot -- --click "[ CUSTOMISE PUBLIC PROFILE ]" --click "[ CHAR" --at 12000
 *     npm run shot -- --width 390 --height 844 --mobile     a phone
 *     npm run shot -- --scale 0.5                           a cheap reading, half the pixels
 *     npm run shot -- --wait-for "WHAT IS DRAWN"            wait for a chunk, not for a stopwatch
 *     npm run shot -- --signin                              a throwaway session, for a page behind one
 *     npm run shot -- --attach                              use the session `npm run browser -- --start` left
 *     npm run shot -- --profile Temp/browse/owner-profile   a profile signed in by hand, kept
 *
 * `--attach` is the cheap way round: `npm run browser -- --start --signin` opens one browser and signs one
 * account into it, and every capture after that costs seconds and no account at all. An attached browser is
 * *stateful* - the page may already have been scrolled, pressed and signed in - so the output says it is
 * attached, and `--fresh` reloads before the steps if the capture is meant to be a first visit.
 *
 * Actions run in a fixed order - hovers, then focuses, then presses, then the input hands (`--type`,
 * `--key`, `--scroll`, `--drag`) in the order they were given - and **every one of them fails the run when
 * its control is not there**. A sequence that quietly skipped its second press would capture a page nobody
 * asked for and report success. A control whose text matches several others is a refusal too, unless
 * `--allow-ambiguous` says the ambiguity is intended: pressing the first of several matches is how a press
 * lands somewhere nobody named while the transcript says otherwise.
 *
 * `--signin` makes one of the throwaway accounts the checks make and hands the page its session, so a page
 * behind a session can be reached without a password. It leaves the account behind - removing it takes the
 * service role - so `npm run db:sweep` is what clears it up, after the last check run. `--reuse` makes no
 * account at all: it asks whether the profile already holds a session, and says which it found.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const {
  capture,
  click,
  close,
  drag,
  flags,
  forceFocus,
  goto,
  holdsSession,
  hover,
  key,
  mustFind,
  open,
  report,
  scroll,
  sessionAlive,
  signInPage,
  sleep,
  type,
} = require('./browser.cjs');
const { readPng } = require('./png-read.cjs');

const { all, at, has, number } = flags();

const url = at('--url', 'https://debaser-site.vercel.app/forum');
const out = path.resolve(at('--out', path.join('Temp', 'browse', 'shot.png')));
const width = number('--width', 1440);
const height = number('--height', 1000);
const settle = number('--at', 4000);
const scale = number('--scale', 1);
const fullPage = has('--full-page');
const mobile = has('--mobile');
const reducedMotion = has('--reduced-motion');
const allowErrorPage = has('--allow-error-page');
const allowAmbiguous = has('--allow-ambiguous');
const signIn = has('--signin');
const reuse = has('--reuse');
const attach = has('--attach');
const fresh = has('--fresh');
const keepProfile = at('--profile', null);
const clipTarget = at('--clip', null);
const within = at('--within', null);
const waitFor = at('--wait-for', null);
const hovers = all('--hover');
const focuses = all('--focus');
const presses = all('--click');
const types = all('--type');
const keys = all('--key');
const scrolls = all('--scroll');
const drags = all('--drag');
const by = at('--by', null);
const onto = at('--onto', null);

/**
 * The nine dyes, named from the stylesheet rather than copied out of it.
 *
 * A name beside a colour is what turns `62.3% rgb(26,21,37)` into `62.3% rgb(26,21,37) NIGROSINE`, which
 * is the difference between a reading and a reading somebody can act on. It is *read* from
 * `app/globals.css` so that renaming a token there renames it here, instead of the two drifting.
 */
function dyeNames() {
  let css = '';

  try {
    css = readFileSync('app/globals.css', 'utf8');
  } catch {
    return new Map();
  }

  const names = new Map();

  for (const [, name, hex] of css.matchAll(/--color-([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const key = `${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)}`;
    if (!names.has(key)) names.set(key, name.toUpperCase());
  }

  return names;
}

/**
 * What a capture actually contains: the size, how many colours, the dominant one, and any grey.
 */
function readBack(file) {
  let image = null;

  try {
    image = readPng(file);
  } catch (error) {
    return { error: error.message };
  }

  if (image.error) return { error: image.error };

  const counts = new Map();
  let greys = 0;
  let sampled = 0;

  for (let y = 0; y < image.height; y += 2) {
    for (let x = 0; x < image.width; x += 2) {
      const offset = (y * image.width + x) * image.channels;
      const red = image.pixels[offset];
      const green = image.pixels[offset + 1];
      const blue = image.pixels[offset + 2];
      const key = `${red},${green},${blue}`;

      counts.set(key, (counts.get(key) ?? 0) + 1);
      sampled += 1;

      // The palette has no greys at all: Black and Pure White are not greys, and every dye is
      // saturated. A grey here is a colour the site does not own - `MODEL_INK` was `#FFFFFF`, and a
      // lambert light turned it into rgb(226,226,226), which read as "the figure has no colour of its
      // own".
      if (red === green && green === blue && red !== 0 && red !== 255) greys += 1;
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const names = dyeNames();
  const total = sampled === 0 ? 1 : sampled;

  return {
    width: image.width,
    height: image.height,
    colours: counts.size,
    greys,
    sampled,
    top: sorted.slice(0, 3).map(([colour, count]) => ({
      colour,
      name: names.get(colour) ?? null,
      share: Math.round((count / total) * 1000) / 10,
    })),
  };
}

/** One line per thing done, so the transcript reads as the sequence of presses it was. */
function note(label, value) {
  console.log(`${label.padEnd(9)}: ${value}`);
}

/**
 * The session, handed over before the page's own scripts run.
 *
 * `--signin` is the old behaviour: make one throwaway account and give the page its session. `--reuse`
 * makes **no account at all** - it asks the profile whether it already holds one, and the answer is printed
 * either way, because "this capture is signed in" and "this capture is of a signed-out page" look identical
 * afterwards.
 */
async function readySession(browser, { reload }) {
  const stored = await holdsSession(browser.page);

  if (reuse) {
    note(
      'session',
      stored
        ? 'the profile already holds one - no account made'
        : 'NONE in this profile: this capture is signed out, and --signin would make one',
    );
    return;
  }

  if (!signIn) return;

  if (stored) {
    note('session', 'the profile already holds one, and --signin makes another; --reuse would have kept it');
  }

  const account = await signInPage(browser.page, { label: 'cline-shot' });

  if (account.error) {
    note('session', `NO: ${account.error}`);
    process.exitCode = 3;
    return;
  }

  note('session', `${account.userId} - left behind for \`npm run db:sweep\``);

  if (reload) await goto(browser.page, url, { settle });
}

async function main() {
  const running = await sessionAlive();
  const profile = keepProfile ?? path.join('Temp', 'browse', 'shot-profile');

  note('address', url);
  note(
    'capture',
    `${out}${clipTarget ? ` (clipped to ${clipTarget})` : fullPage ? ' (whole page)' : ''}${scale === 1 ? '' : ` at ${scale}x`}`,
  );

  let browser = null;
  let clip = null;

  try {
    if (!attach && running) {
      note('session', `one is running on port ${running.port} - add --attach to use it and leave it running`);
    }

    browser = await open({
      size: [width, height],
      mobile,
      scale,
      profile,
      keepProfile: keepProfile !== null,
      attach,
      reducedMotion,
    });

    if (browser.attached) {
      note('attached', `port ${browser.port} - stateful, so this is not a first visit`);
    }

    /*
     * A throwaway profile has no session by construction, so the session is handed over *before* the first
     * navigation and the page never renders signed out. An attached browser is the opposite problem - it is
     * already somewhere - so there the profile is asked first and the page is re-navigated only if a
     * session was handed to it.
     */
    if (!browser.attached) await readySession(browser, { reload: false });

    const arrival = await goto(browser.page, url, { settle: fresh ? 0 : settle, waitFor, allowErrorPage });
    note('arrived', `${arrival.title} - ${arrival.href}`);
    if (allowErrorPage) note('warning', 'the error-page guard is off: this may be a picture of a refusal');
    if (waitFor !== null) note('wait-for', `${waitFor} appeared`);

    if (browser.attached) await readySession(browser, { reload: true });

    if (fresh) {
      // A cold document: an attached page may have been scrolled, pressed and hydrated minutes ago.
      await goto(browser.page, url, { settle, allowErrorPage });
      note('fresh', 'reloaded before the steps');
    }

    for (const target of hovers) {
      const found = await mustFind(browser.page, target, 'hover');
      await hover(browser.page, found.x, found.y);
      note('hover', `${found.label.replace(/\n/g, ' / ')} at ${found.x},${found.y} (matched by ${found.how})`);
    }

    for (const target of focuses) {
      const forced = await forceFocus(browser.page, target);
      if (!forced.forced) throw new Error(`cannot focus ${JSON.stringify(target)}: ${forced.why}`);

      note('focus', target);
    }

    for (const target of presses) {
      const found = await mustFind(browser.page, target, 'press');
      await click(browser.page, found.x, found.y);
      note('press', `${found.label.replace(/\n/g, ' / ')} at ${found.x},${found.y} (matched by ${found.how})`);
      await sleep(900); // a screen behind the press mounts its own chunks; the next lookup needs them
    }

    /*
     * The input hands, in the order they were given. They come after the presses because that is what they
     * are for - pressing a plate opens a field, and then something has to go into it.
     */
    for (const text of types) {
      await type(browser.page, text, { target: into, within, allowAmbiguous });
      note('type', `${JSON.stringify(text)}${into === null ? ' into whatever has focus' : ` into ${JSON.stringify(into)}`}`);
      await sleep(250);
    }

    for (const name of keys) {
      await key(browser.page, name);
      note('key', name);
      await sleep(250);
    }

    for (const amount of scrolls) {
      await scroll(browser.page, Number(amount));
      note('scroll', `${amount}px`);
      await sleep(250);
    }

    for (const source of drags) {
      const from = await mustFind(browser.page, source, 'drag');
      let to = null;

      if (by !== null) {
        const [dx, dy] = by.split(',').map(Number);
        to = { x: from.x + dx, y: from.y + dy };
      } else if (onto !== null) {
        const target = await mustFind(browser.page, onto, 'drag onto');
        to = { x: target.x, y: target.y };
      } else {
        throw new Error('--drag needs a destination: --by dx,dy or --onto "<control text>"');
      }

      await drag(browser.page, { x: from.x, y: from.y }, to);
      note('drag', `${JSON.stringify(source)} from ${from.x},${from.y} to ${to.x},${to.y}`);
      await sleep(600);
    }

    if (clipTarget !== null) {
      const found = await mustFind(browser.page, clipTarget, 'clip to');
      clip = { pageX: found.pageX, pageY: found.pageY, w: found.w, h: found.h };
      note('clipped', `${found.label.replace(/\n/g, ' / ')} ${found.w}x${found.h}`);
    }

    const shot = await capture(browser.page, { out, fullPage, clip });
    note('wrote', `${path.relative(process.cwd(), shot.file)} (${shot.bytes} bytes)`);

    const reading = readBack(shot.file);
    if (reading.error) {
      note('read', `could not read the file back: ${reading.error}`);
    } else {
      note('read', `${reading.width}x${reading.height}, ${reading.colours} distinct colours`);
      for (const top of reading.top) {
        note(' ', `${top.share}% rgb(${top.colour})${top.name ? ` ${top.name}` : ''}`);
      }
      note('greys', reading.greys === 0 ? 'none' : `${reading.greys} of ${reading.sampled} - the palette has no greys`);
    }

    /*
     * What the page said while this was happening, and what the run does *not* establish - printed every
     * time rather than kept in a document, because the sentence that matters is the one that travels with
     * the file.
     */
    report(browser.log);

    console.log('');
    console.log('That file is a picture of that address after those actions. Nothing above looked at it:');
    console.log('read it with the file-reading tool to describe its layout, its colours and its text.');
    console.log('One still frame cannot show motion, and a prerendered READING... is not a result.');
  } catch (error) {
    if (error.noAnswer) {
      console.log('');
      note('NO ANSWER', error.message);
      console.log('');
      console.log('Nothing is listening at that address, so no file was written - a refused capture kept');
      console.log('under a page name is a capture that lies. Start the server, or check the address.');
      process.exitCode = 4;
    } else {
      throw error;
    }
  } finally {
    await close(browser, { keep: keepProfile !== null });
  }
}

main().catch((error) => {
  console.log('FAILED: ' + error.message);
  process.exit(1);
});



