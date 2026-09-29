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
 * connection, filed under the name of the account page, with nothing anywhere to say so. Two
 * instruments then read it and reported `0 panes` and `no WebGL context`, which both read as statements
 * about the site.
 *
 * So this refuses loudly instead: when the page is the browser's own error page it says **NOTHING IS
 * LISTENING at that address**, prints the `ERR_...`, and writes nothing. A capture that did not happen
 * is a hundred times more useful than a capture that lies. `--allow-error-page` overrides it, because a
 * guard with no way past it is a guard that gets deleted.
 *
 * **What it can and cannot do.** It can name one page, wait for it, name a sequence of controls by their
 * *text* (or a selector), hover, focus or press them, and write the PNG - then read the PNG back and
 * report its size, its distinct colours and whether any pixel is a grey. It cannot decide what to press
 * for you, it cannot judge whether the result looks right, and one still frame cannot show motion: a
 * `READING...` in a capture is a pre-hydration state and not a result.
 *
 *     npm run shot                                          the deployed board
 *     npm run shot -- --url http://localhost:3100/account   a local build
 *     npm run shot -- --out Temp/browse/account.png --full-page
 *     npm run shot -- --clip "fieldset:first-of-type"       one element
 *     npm run shot -- --hover "[ MUSIC ]"                   with a real pointer on it
 *     npm run shot -- --click "[ CUSTOMISE PUBLIC PROFILE ]" --click "[ CHAR" --at 12000
 *     npm run shot -- --width 390 --height 844 --mobile     a phone
 *     npm run shot -- --signin                              a throwaway session, for a page behind one
 *     npm run shot -- --profile Temp/browse/owner-profile   a profile signed in by hand, kept
 *
 * `--signin` makes one of the throwaway accounts the checks make and hands the page its session, so a
 * page behind a session can be reached without a password. It leaves the account behind - removing it
 * takes the service role - so `npm run db:sweep` is what clears it up, after the last check run.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const {
  arrive,
  capture,
  click,
  findControl,
  forceFocus,
  hover,
  installSession,
  launch,
  signUp,
  sleep,
  socketOn,
} = require('./cdp-page.cjs');
const { readPng } = require('./png-read.cjs');

const { all, at, has, number } = require('./cdp-page.cjs').flags();

const url = at('--url', 'https://debaser-site.vercel.app/forum');
const out = path.resolve(at('--out', path.join('Temp', 'browse', 'shot.png')));
const width = number('--width', 1440);
const height = number('--height', 1000);
const settle = number('--at', 4000);
const fullPage = has('--full-page');
const mobile = has('--mobile');
const allowErrorPage = has('--allow-error-page');
const signIn = has('--signin');
const keepProfile = at('--profile', null);
const clipTarget = at('--clip', null);
const within = at('--within', null);
const hovers = all('--hover');
const focuses = all('--focus');
const presses = all('--click');

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

async function main() {
  const profile = keepProfile ?? path.join('Temp', 'browse', 'shot-profile');
  const port = 9333 + Math.floor(Math.random() * 400);

  note('address', url);
  note('capture', `${out}${clipTarget ? ` (clipped to ${clipTarget})` : fullPage ? ' (whole page)' : ''}`);

  const { child } = launch({ port, profile, size: [width, height], keepProfile: keepProfile !== null });
  let socket = null;

  try {
    socket = await socketOn(port);

    // The viewport is set through the protocol rather than trusted to `--window-size`, because
    // `--window-size` includes the browser chrome and is ignored once a tab is restored.
    await socket.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      screenWidth: width,
      screenHeight: height,
    });
    if (mobile) await socket.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    if (signIn) {
      const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      // `cline-` is the prefix the sweep already reviews (`supabase/cleanup/throwaway-accounts-review.sql`),
      // so an account this tool makes is one `npm run db:sweep` already knows how to find.
      const account = await signUp(`cline-shot-${stamp}@debaser.site`, `shot-${stamp}-pw`, `shot ${stamp}`);

      if (account.error) {
        note('session', `NO: ${account.error}`);
        process.exitCode = 3;
        return;
      }

      await installSession(socket, account);
      note('session', `${account.userId} - left behind for \`npm run db:sweep\``);
    }

    const arrival = await arrive(socket, url, { settle, allowErrorPage });

    note('arrived', `${arrival.title} - ${arrival.href}`);
    if (allowErrorPage) note('warning', 'the error-page guard is off: this may be a picture of a refusal');

    /**
     * The actions, in the order they were given, each one a real event through the browser's own input
     * path - and each one **failing the run when the control is not there**. A sequence that quietly
     * skipped its second press would capture a page nobody asked for and report success.
     */
    for (const target of hovers) {
      const found = await findControl(socket, target, { within });
      if (!found.found) throw new Error(`cannot hover ${JSON.stringify(target)}: ${found.why}`);

      await hover(socket, found.x, found.y);
      note('hover', `${found.label.replace(/\n/g, ' / ')} at ${found.x},${found.y}`);
    }

    for (const target of focuses) {
      const forced = await forceFocus(socket, target);
      if (!forced.forced) throw new Error(`cannot focus ${JSON.stringify(target)}: ${forced.why}`);

      note('focus', target);
    }

    for (const target of presses) {
      const found = await findControl(socket, target, { within });
      if (!found.found) throw new Error(`cannot press ${JSON.stringify(target)}: ${found.why}`);

      await click(socket, found.x, found.y);
      note('press', `${found.label.replace(/\n/g, ' / ')} at ${found.x},${found.y}`);
      await sleep(900); // a screen behind the press mounts its own chunks; the next lookup needs them
    }

    let clip = null;
    if (clipTarget !== null) {
      const found = await findControl(socket, clipTarget, { within });
      if (!found.found) throw new Error(`cannot clip to ${JSON.stringify(clipTarget)}: ${found.why}`);

      clip = { x: found.x - found.w / 2, y: found.y - found.h / 2, w: found.w, h: found.h };
      note('clipped', `${found.label.replace(/\n/g, ' / ')} ${found.w}x${found.h}`);
    }

    const shot = await capture(socket, { out, fullPage, clip });
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

    /**
     * What this run does and does not establish, printed every time rather than kept in a document,
     * because the sentence that matters is the one that travels with the file.
     */
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
    } else {
      throw error;
    }
    process.exitCode = 4;
  } finally {
    // Chrome is a child process and will outlive this script if it is not ended; the profile it held
    // open is what `--profile` chooses to keep.
    if (socket) {
      try {
        await socket.send('Browser.close');
      } catch {
        /* already gone */
      }
    }
    child.kill();
  }
}

main();
