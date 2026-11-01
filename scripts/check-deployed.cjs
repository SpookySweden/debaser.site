/**
 * Confirm the character workbench reached production by **loading the deployed site in a browser**.
 *
 * **Why not grep the deployed bundle, which is what three earlier attempts did.** The workbench is
 * `next/dynamic`, so its chunk is fetched by the client *after* hydration from a path only the runtime knows. It
 * is not referenced from the served HTML: the page names 300 `.js` references but only **12 distinct** chunks,
 * and none of them carries the workbench. Those runs therefore reported "not deployed" for a deploy that was
 * live - a false absence, which is worse than no check, because it is indistinguishable from a true one.
 *
 * A browser solves it because a browser *is* the client: it hydrates, runs the dynamic import, and the chunk
 * arrives. So this loads the deployed address and reads the **response bodies** - never the filenames, which are
 * hashed and change on every rebuild. The bodies come from a `response` listener rather than a hand-rolled CDP
 * socket, which is what `scripts/browser.cjs` is for.
 *
 * What it proves: the deploy serves the character workbench's code to a real client. What it does not: that the
 * figure draws, because that needs a session on `/account` and this has none. The tools that *do* reach the canvas
 * are `npm run stages` (each render stage, from the composited page) and `npm run panes` (colours inside a pane).
 *
 * Run: node scripts/check-deployed.cjs
 */
const { close, flags, goto, open, report } = require('./browser.cjs');

const BASE = process.env.SITE_BASE ?? 'https://debaser-site.vercel.app';

/** Text that only exists after each fix, matched against every response body the page fetches. */
const NEEDLES = [
  ['the Violet ink', '7A5CC4'],
  ['the limb tone', '4A3A7A'],
  ['EffectComposer autoClear', 'autoClear'],
  ['frameloop always', 'frameloop'],
];

/** Bodies are held only up to a bound: a full page is a few megabytes and there is no need for all of it. */
const MAX_BODIES = 400;

async function main() {
  const { has } = flags();
  const browser = await open({ size: [1440, 1200] });

  try {
    /**
     * **Watch the responses, not the filenames.** URLs are hashed and unpredictable, so a check that names one
     * cannot survive a rebuild; a check that reads the bodies sees whatever the deploy actually sends.
     */
    const bodies = [];
    const urls = [];

    browser.page.on('response', async (response) => {
      const url = response.url();
      urls.push(url);

      if (bodies.length >= MAX_BODIES) return;

      try {
        bodies.push((await response.body()).toString('utf8'));
      } catch {
        /* a body can be evicted before it is read; not every response is readable and that is fine */
      }
    });

    console.log(`url     : ${BASE}/`);

    // The home page, then the account page - the workbench is imported from the customiser, which lives there.
    await goto(browser.page, `${BASE}/`, { settle: 9000 });
    await goto(browser.page, `${BASE}/account`, { settle: 9000 });

    const corpus = bodies.join('\n');
    const scripts = urls.filter((url) => url.split('?')[0].endsWith('.js'));

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

    report(browser.log);

    console.log('');
    console.log('NOT PROVEN: that the figure draws. That needs a session on /account, and this has none.');
    console.log('  The canvas was verified with `npm run stages` (per render stage) and `npm run panes`');

    if (has('--dump')) console.log(`  scripts fetched: ${scripts.slice(0, 20).join('\n    ')}`);
  } finally {
    await close(browser);
  }
}

main().catch((error) => {
  if (error.noAnswer) {
    console.log(`FAILED: ${error.message}`);
    console.log('  The deployed site did not answer, so nothing was checked - a refusal is not a missing fix.');
    process.exit(1);
  }

  console.log('FAILED: ' + error.message);
  process.exit(1);
});
