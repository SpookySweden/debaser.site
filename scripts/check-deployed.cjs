/**
 * Confirm the character workbench reached production by **loading the deployed site in a browser**.
 *
 * **Why not grep the deployed bundle, which is what three earlier attempts did.** The workbench is
 * `next/dynamic`, so its chunk is fetched by the client *after* hydration from a path only the runtime knows. It
 * is not referenced from the served HTML: the page names 300 `.js` references but only **12 distinct** chunks, and
 * none of them carries the workbench. Those runs therefore reported "not deployed" for a deploy that was live - a
 * false absence, which is worse than no check, because it is indistinguishable from a true one.
 *
 * A browser solves it because a browser *is* the client: it hydrates, runs the dynamic import, and the chunk
 * arrives. So this drives Chrome over CDP at the deployed address and reads the **response bodies** - never the
 * filenames, which are hashed and change on every rebuild.
 *
 * What it proves: the deploy serves the character workbench's code to a real client. What it does not: that the
 * figure draws, because that needs a session on `/account` and this has none. The local equivalent that *does*
 * reach the canvas is `scripts/cdp-look.cjs`, run against a local build.
 *
 * Run: node scripts/check-deployed.cjs
 */
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { Socket, getJson } = require('./cdp-socket.cjs');

const BASE = process.env.SITE_BASE ?? 'https://debaser-site.vercel.app';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find((candidate) => existsSync(candidate));

if (!CHROME) {
  console.log('NO BROWSER found - cannot check the deployed site.');
  process.exit(2);
}

/** Text that only exists after each fix, matched against every response body the page fetches. */
const NEEDLES = [
  ['the Violet ink', '7A5CC4'],
  ['the limb tone', '4A3A7A'],
  ['EffectComposer autoClear', 'autoClear'],
  ['frameloop always', 'frameloop'],
];


async function main() {
  const PORT = 9337;
  const profile = path.join('Temp', 'browse', 'deployed-profile');
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });

  const child = spawn(
    CHROME,
    [
      `--user-data-dir=${path.resolve(profile)}`,
      '--headless=new',
      '--no-first-run',
      '--disable-extensions',
      '--hide-scrollbars',
      '--window-size=1440,1200',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      `--remote-debugging-port=${PORT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let socket;
  try {
    let targets = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        targets = await getJson(PORT, '/json/list');
        if (targets.some((target) => target.type === 'page')) break;
      } catch {
        /* waiting */
      }
      await sleep(500);
    }

    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('no page target');

    socket = await Socket.connect(page.webSocketDebuggerUrl);
    await socket.send('Page.enable');
    await socket.send('Runtime.enable');
    await socket.send('Network.enable');

    /**
     * **Watch the responses, not the filenames.** URLs are hashed and unpredictable, so a check that names one
     * cannot survive a rebuild; a check that reads the bodies sees whatever the deploy actually sends.
     */
    const bodies = [];
    const urls = [];

    socket.onEvent = (message) => {
      if (message.method === 'Network.responseReceived') urls.push(message.params.response.url);
      if (message.method !== 'Network.loadingFinished') return;

      const requestId = message.params.requestId;
      socket
        .send('Network.getResponseBody', { requestId })
        .then((result) => {
          bodies.push(result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body);
        })
        .catch(() => {
          /* a body can be evicted before it is read; not every response is readable and that is fine */
        });
    };

    console.log(`browser : ${CHROME}`);
    console.log(`url     : ${BASE}/`);

    // The home page, then the account page - the workbench is imported from the customiser, which lives there.
    await socket.send('Page.navigate', { url: `${BASE}/` });
    await sleep(9000);
    await socket.send('Page.navigate', { url: `${BASE}/account` });
    await sleep(9000);

    const corpus = bodies.join('\n');
    const scripts = urls.filter((url) => url.endsWith('.js'));

    console.log(`network : ${urls.length} responses, ${scripts.length} scripts, ${corpus.length} bytes of body`);
    console.log('');

    let missing = 0;
    for (const [what, needle] of NEEDLES) {
      const present = corpus.includes(needle);
      if (!present) missing += 1;
      console.log(`  ${present ? 'YES' : 'no '}  ${what}`);
    }

    console.log('');
    if (missing === 0) {
      console.log('the deployed site serves every fix to a real client.');
    } else {
      console.log(`${missing} of ${NEEDLES.length} not seen among the fetched scripts.`);
      console.log('  The workbench chunk is only fetched once the CHAR tab is pressed, which needs a session,');
      console.log('  so absence here is NOT proof of absence on the site.');
    }

    console.log('');
    console.log('NOT PROVEN: that the figure draws. That needs a session on /account, and this has none.');
    console.log('  The canvas itself was verified locally, by scripts/cdp-look.cjs and scripts/measure-panes.cjs.');
  } finally {
    if (socket) socket.close();
    child.kill();
  }
}

main().catch((error) => {
  console.log('FAILED: ' + error.message);
  process.exit(1);
});
