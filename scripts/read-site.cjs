/*
 * Reads the site - the deployed one, or a local build - and confirms what is actually in the served
 * HTML. **This is the agent's eyes.** There is no browser here: no screenshots, no clicking, no
 * layout, no colour. This script is what stands in for looking, so it is tracked in `scripts/` rather
 * than kept in `Temp/` as scratch - a viewer that a fresh clone does not have is not a guarantee.
 *
 *   npm run read                       the deployed site, default expectations
 *   npm run read:local                 a local `next start` on :3210
 *   npm run read -- "[ ♪ MUSIC ]"      expect this text to be present
 *   npm run read -- --absent "[ SHELF (" expect this text to be gone
 *
 * Why a script rather than a grep, and why it is not a matter of taste: **React wraps dynamic text in
 * HTML comments.** The player's music key is served as
 *
 *   [ <!-- -->♪<!-- --> <!-- -->MUSIC<!-- --> ]
 *
 * so grepping the raw HTML for `[ ♪ MUSIC ]` finds nothing and reports a change missing that is
 * perfectly present. That misled twice here - each time it looked like a stale deploy rather than a
 * wrong grep. Stripping `<!-- -->` before matching is the whole fix.
 *
 * The default expectations are the two controls whose migration produced this tool: the player's music
 * key (present) and the shelf button it replaced (absent). With no arguments it answers "is the site
 * serving what the repository says it should" - which is the question worth asking after every change.
 */
const DEPLOYED = 'https://debaser-site.vercel.app/forum';
const LOCAL = 'http://127.0.0.1:3210/forum';

/** What must be there, and what must not. */
function expectations() {
  const argv = process.argv.slice(2);
  const absentAt = argv.indexOf('--absent');
  const urlAt = argv.indexOf('--url');

  // Collected by *index*, not by value: `indexOf` would collapse two identical expectations and
  // promote the second one to the wrong list. The value after `--url` is the address rather than an
  // expectation, so it is skipped by position.
  const urlValueAt = urlAt === -1 ? -1 : urlAt + 1;

  const present = [];
  const absent = [];

  argv.forEach((arg, index) => {
    if (arg.startsWith('--') || index === urlValueAt) return;
    if (absentAt !== -1 && index > absentAt) absent.push(arg);
    else present.push(arg);
  });

  // No arguments: the two controls this tool was written for, so the bare command is worth running.
  if (present.length === 0 && absent.length === 0) {
    return { present: ['[ ♪ MUSIC ]'], absent: ['[ SHELF (60) ]'] };
  }

  return { present, absent };
}

/**
 * The address to read.
 *
 * `--url <address>` reads any route, which is how a page other than the board is checked - the tool is
 * about *this* site, not about one page of it.
 */
function target() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--url');
  if (at !== -1 && argv[at + 1] !== undefined) return argv[at + 1];
  return argv.includes('--local') ? LOCAL : DEPLOYED;
}

(async () => {
  const url = target();
  const { present, absent } = expectations();

  let html;
  try {
    const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) {
      console.error(`${url} answered ${response.status}`);
      process.exitCode = 1;
      return;
    }
    html = await response.text();
  } catch (caught) {
    console.error(`could not reach ${url}: ${caught instanceof Error ? caught.message : 'unknown'}`);
    if (url.startsWith('http://127.0.0.1')) {
      console.error('');
      console.error('Serve it first:  npm run build && npx next start -p 3210');
    }
    process.exitCode = 1;
    return;
  }

  // The one line that matters: React's text-node comments are not part of what anybody reads.
  const readable = html.replace(/<!--.*?-->/g, '');

  console.log(`${url}  (${html.length} bytes)\n`);

  let bad = 0;

  for (const text of present) {
    const found = readable.includes(text);
    if (!found) bad += 1;
    console.log(`  ${found ? 'ok      ' : 'MISSING '} ${text}`);
  }

  for (const text of absent) {
    const found = readable.includes(text);
    if (found) bad += 1;
    console.log(`  ${found ? 'STILL   ' : 'gone    '} ${text}`);
  }

  console.log('');
  if (bad > 0) {
    console.log(`${bad} expectation(s) not met. If this is the deployed site, the change is probably`);
    console.log('uncommitted - Vercel builds from GitHub, so a local edit is invisible until it is pushed.');
    process.exitCode = 1;
    return;
  }

  console.log('the served HTML matches. This is not the same as looking at it: it says the bytes are');
  console.log('right, not that the page reads well. See the limits table in AGENTS.md.');
})();
