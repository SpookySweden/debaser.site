/*
 * QA pass over what the built site actually serves (scratch, run from the root):
 *   npm run build
 *   npm run capture                    # writes Temp/qa/*.html from a server it starts
 *   npm run audit                      # reads them back and reports
 *
 * It reads the HTML captured from `next start` in Temp/qa/ - one file per route, the same bytes a
 * visitor's browser gets before any JavaScript runs, which is also what a screen reader and a
 * crawler see - and reports what a person would run into: missing labels, controls that cannot be
 * reached or seen, text too small to read, tap targets too small to hit, colour pairs that fail the
 * contrast arithmetic, and the questions no automated pass can answer, which it asks out loud.
 *
 * **The capture is a separate step on purpose, and skipping it is the trap.** This file reads
 * yesterday's files happily. On 2026-09-25 the captures were two days older than the components, so
 * an audit that said "nothing new" was describing a build nobody was shipping. `capture-qa.cjs`
 * refreshes them, and `ROUTES` below is what both scripts read - so the list is written once and the
 * two cannot disagree.
 *
 * `music` was in this list until 2026-09-25 and had to come out: `/music` is **not a route** (see
 * AGENTS.md - the archive is a screen inside `MusicWindow`, never a page), so the capture failed with
 * a 404 and this audit went on reading a file left from before the route was deleted. That is worse
 * than a missing entry: it reported on a screen that had never been looked at.
 *
 * **Tracked in `scripts/`, not `Temp/`.** `AGENTS.md` names this as step 3 of the ship loop, and
 * `capture-qa.cjs` reads `ROUTES` out of this file so the two cannot disagree about what is being
 * audited - neither works if the file sits in the gitignored folder. Its *input* is a snapshot in
 * `Temp/qa/`; what it holds is the route list and the rules, and that belongs to the repository.
 *
 * Regex rather than a DOM library, on purpose: what is being measured is counts and attributes, and
 * a scratch script with no dependency is one that can still be run next year. The limits that follow
 * from that (no nesting, no computed styles) are stated where they matter.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = [
  ['home', '/'],
  ['forum', '/forum'],
  ['users', '/users'],
  ['comms', '/comms'],
  ['account', '/account'],
  ['concepts', '/concepts'],
  ['lore', '/lore'],
  ['lorepage', '/lore/the-glass-corridor'],
  ['notes', '/notes'],
  ['links', '/links'],
  ['project', '/projects/debaser'],
  ['profile', '/profile/qa-visitor'],
];

const findings = [];

/** A finding is one line somebody can act on: how bad, where, what, and what to do about it. */
function note(severity, area, what, fix) {
  findings.push({ severity, area, what, fix });
}

/** Every tag of one name, as its raw attribute string. */
function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((match) => match[1]);
}

/** The same, with where each one sits in the page, for the tests that skip whole containers. */
function matches(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((match) => ({
    attributes: match[1],
    index: match.index ?? 0,
  }));
}

function attr(attributes, name) {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attributes);

  return match === null ? null : match[1];
}

/** The text of one element, with markup and entities taken off. */
function textOf(attributes, html, name) {
  const start = html.indexOf(`<${name}${attributes}>`);
  if (start < 0) return '';

  const end = html.indexOf(`</${name}>`, start);
  if (end < 0) return '';

  return html
    .slice(start, end)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

console.log('QA PASS :: what the built site serves\n');

for (const [name, route] of ROUTES) {
  const file = path.join('Temp', 'qa', `${name}.html`);

  if (!fs.existsSync(file)) {
    note('blocker', name, 'no capture to read', `re-run the capture for ${route}`);
    continue;
  }

  const html = fs.readFileSync(file, 'utf8');
  const controls = [
    ...tags(html, 'a').filter((attributes) => attr(attributes, 'href') !== null),
    ...tags(html, 'button'),
    ...tags(html, 'input'),
    ...tags(html, 'select'),
    ...tags(html, 'textarea'),
  ];

  const headings = ['h1', 'h2', 'h3', 'h4'].map((level) => tags(html, level).length);
  const h1s = tags(html, 'h1');
  const h1 = h1s.length === 1 ? textOf(h1s[0], html, 'h1') : `${h1s.length} h1s`;

  // Fields: anything a person fills in needs a name, and the name has to be attached to it rather
  // than merely sitting near it. A field counts as named either by a `<label for>` or by being
  // *wrapped* in a label, which is what the board's sort switch does - the first draft of this
  // audit only looked for `for=` and reported three false failures, which is its own lesson.
  const labelled = new Set([...html.matchAll(/<label\b[^>]*for="([^"]+)"/gi)].map((match) => match[1]));
  const wrapped = [...html.matchAll(/<label\b[^>]*>([\s\S]{0,400}?)<\/label>/gi)].map((match) => match[1]);
  const isWrapped = (attributes) =>
    wrapped.some((block) => {
      const at = block.indexOf(attributes);

      return at >= 0 && !block.slice(0, at).includes('</label>');
    });

  const fields = [
    ...tags(html, 'input').filter((attributes) => attr(attributes, 'type') !== 'hidden'),
    ...tags(html, 'select'),
    ...tags(html, 'textarea'),
  ];
  const unnamed = fields.filter((attributes) => {
    const id = attr(attributes, 'id');

    return (
      attr(attributes, 'aria-label') === null &&
      attr(attributes, 'aria-labelledby') === null &&
      (id === null || !labelled.has(id)) &&
      !isWrapped(attributes)
    );
  });

  // Tap targets: below `lg` this site asks for 44px of height on anything pressable (PLATE carries
  // `max-sm:min-h-11`). This counts the pressable things that never ask, and skips two kinds: the
  // ones hidden below `lg` (a control a phone cannot see is not one a thumb has to hit) and the ones
  // inside a container that does the hiding - the side panel and the task buttons. Reading a page
  // without a DOM means this is a position-in-the-string test rather than a nesting one, which is
  // exactly enough for the two containers involved.
  const desktopOnly = [
    // The side panel folds away below `lg` as a whole, so its controls are not targets a phone has.
    ['<aside', '</aside>'],
  ]
    .map(([open, close]) => {
      const start = html.indexOf(open);
      if (start < 0) return null;

      const end = html.indexOf(close, start);

      return [start, end < 0 ? html.length : end];
    })
    .filter((range) => range !== null);

  const positioned = [...matches(html, 'a'), ...matches(html, 'button')].filter(
    (entry) =>
      !(attr(entry.attributes, 'class') ?? '').includes('hidden lg:') &&
      !desktopOnly.some(([start, end]) => entry.index > start && entry.index < end),
  );

  const pressable = positioned.map((entry) => entry.attributes);
  const withTapHeight = pressable.filter((attributes) => (attr(attributes, 'class') ?? '').includes('min-h-11'));

  // Text size: every `text-[Npx]` on the page, and how much of it is at the two smallest sizes.
  const sizes = [...html.matchAll(/text-\[(\d+)px\]/g)].map((match) => Number(match[1]));
  const tiny = sizes.filter((size) => size <= 9).length;
  const small = sizes.filter((size) => size === 10).length;

  console.log(
    `${name.padEnd(9)} h1:${String(h1).slice(0, 24).padEnd(25)} h:${headings.join('/')} ` +
      `controls:${String(controls.length).padStart(3)} fields:${String(fields.length).padStart(2)} unnamed:${unnamed.length} ` +
      `tap44:${withTapHeight.length}/${pressable.length} <=9px:${tiny} 10px:${small}`,
  );

  if (h1s.length !== 1) {
    note('medium', name, `${h1s.length} h1 headings, where a page wants exactly one`, 'one <h1> saying what the page is');
  }
  if (unnamed.length > 0) {
    note('high', name, `${unnamed.length} field(s) with no label, aria-label or aria-labelledby`, 'attach a label to each field');

    for (const attributes of unnamed.slice(0, 4)) {
      console.log(
        `          unnamed field: name=${attr(attributes, 'name')} type=${attr(attributes, 'type')} ` +
          `placeholder="${attr(attributes, 'placeholder')}" class="${(attr(attributes, 'class') ?? '').slice(0, 40)}"`,
      );
    }
  }

  if (withTapHeight.length < pressable.length) {
    const offenders = pressable.filter((attributes) => !(attr(attributes, 'class') ?? '').includes('min-h-11'));

    // `low` rather than `medium` on purpose: the comfortable target is 44px and this site gives that
    // to the primary controls (the plates, the menu rows, the shelf chips), while WCAG's *minimum* is
    // 24px and the rest of these - the filter chips, the title-bar buttons, links inside a sentence -
    // are a line of text with padding around it, which clears that. What is worth a look is anything
    // here that is a *row* somebody is meant to pick from.
    note(
      'low',
      name,
      `${offenders.length} pressable element(s) without a 44px small-screen height`,
      'check the row-shaped ones (the wire, list rows) rather than inline links or a padded chip',
    );

    for (const attributes of offenders.slice(0, 4)) {
      const text = textOf(attributes, html, 'a') || textOf(attributes, html, 'button') || attr(attributes, 'aria-label') || '';

      console.log(`          small target: "${text.slice(0, 30)}" class="${(attr(attributes, 'class') ?? '').slice(0, 46)}"`);
    }
  }
  if (tiny > 0) {
    note('low', name, `${tiny} run(s) of text at 9px or smaller`, 'raise to 10px; below that the pixel face stops reading');
  }
}

// Properties of the chrome rather than of one page, so they are asked once, of the source. ---------
/**
 * The source with its commentary taken off.
 *
 * A check that greps the source has to look at the *code*: this file's own findings live in comments
 * (`role="menu"` is named in the note explaining why it is gone), and a test that reads prose as
 * code reports a defect that was deliberately fixed. The first draft of this did exactly that.
 */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const read = (file) => fs.readFileSync(file, 'utf8');
const codeOf = (file) => code(read(file));

const siteWindow = codeOf('app/components/SiteWindow.tsx');

if (/select-none/.test(siteWindow) && !/select-text/.test(siteWindow)) {
  note(
    'high',
    'every page',
    'the window is `select-none`, so no post, note or lore page can be selected or copied',
    'keep select-none on the chrome, add `select-text` to the reading panel',
  );
}

const controls = read('app/lib/ui/controls.ts');

if (/outline-none/.test(controls) && !/focus:/.test(controls)) {
  note(
    'high',
    'every form',
    'fields switch the browser outline off and draw nothing in its place',
    'give a focused field a visible ring - a 1px dotted navy suits the window',
  );
}

if (siteWindow.indexOf('<Taskbar') > siteWindow.indexOf('{children}')) {
  note(
    'high',
    'every page',
    'the taskbar is the site navigation and comes after the page in the document, so a keyboard user tabs the whole page to reach it',
    'keep the visual order: put it first in the DOM and pull it to the foot with `order-last`',
  );
}

if (/role="menu"/.test(codeOf('app/components/StartMenu.tsx')) && !/ArrowDown/.test(codeOf('app/components/StartMenu.tsx'))) {
  note(
    'medium',
    'start menu',
    'the menu claims `role="menu"` while the arrow keys do nothing in it',
    'either run focus the way a menu must, or drop the role and let it be the list of links it is',
  );
}

if (!/\.focus\(\)|autoFocus/.test(codeOf('app/components/PopoutWindow.tsx'))) {
  note(
    'medium',
    'every pop-up',
    'a pop-up opens without taking focus, and Tab walks straight into the page behind it',
    'focus the window on open, give focus back on close',
  );
}

if (!/aria-label="[^"]*"|title="/.test(codeOf('app/components/Taskbar.tsx').split('[ START ]')[0])) {
  note(
    'medium',
    'phone chrome',
    'the Start button holds every destination on a phone and does not say what it opens',
    'name it: `title`/`aria-label` saying it is the site menu',
  );
}

if (/crawl/.test(codeOf('app/components/NewsTicker.tsx'))) {
  note(
    'low',
    'forum, profile',
    'the wire pauses on hover, which a finger cannot do before the tap lands on the row',
    'give its rows a 44px small-screen height or slow the crawl on a phone',
  );
}

// Contrast, computed rather than eyeballed: the pairs this site actually puts on top of each other.
function channel(value) {
  const ratio = value / 255;

  return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const clean = hex.replace('#', '');

  return (
    0.2126 * channel(parseInt(clean.slice(0, 2), 16)) +
    0.7152 * channel(parseInt(clean.slice(2, 4), 16)) +
    0.0722 * channel(parseInt(clean.slice(4, 6), 16))
  );
}

function contrast(ink, paper) {
  const a = luminance(ink);
  const b = luminance(paper);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const PAIRS = [
  ['body text on a panel', '#000000', '#ffffff', 4.5],
  ['quiet text on the chrome', '#374151', '#c0c0c0', 4.5],
  ['quiet text on a panel', '#374151', '#f0f0f0', 4.5],
  ['quiet text on white', '#374151', '#ffffff', 4.5],
  ['a link stamp', '#0000ff', '#ffffff', 4.5],
  ['a link stamp on the chrome', '#0000ff', '#c0c0c0', 4.5],
  ['an error line', '#800000', '#c0c0c0', 4.5],
  ['a badge on a post', '#ffffff', '#800000', 4.5],
  ['the title bar', '#ffffff', '#000080', 4.5],
  ['the player readout', '#33ff33', '#000000', 4.5],
  ['the player, second line', '#1f9f1f', '#000000', 4.5],
  ['a name in dark blue on the chrome', '#000080', '#c0c0c0', 4.5],
];

/** The tag palette as the site actually spells it, one pair per pill: white ink on its own colour. */
const tagColours = read('app/lib/forum/tag-colours.ts');
const pills = [...tagColours.matchAll(/'#[0-9a-fA-F]{6}'/g)].map((match) => match[0].slice(1, -1));

for (const colour of new Set(pills)) {
  PAIRS.push([`a tag pill (${colour})`, '#ffffff', colour, 4.5]);
}

/** The name palette, which is ink rather than a surface: every swatch on the two backgrounds it is
 *  printed on. The light ones are the interesting case - the site keeps `LOW_CONTRAST_NAME_COLOURS`
 *  for exactly that reason, and this is what says whether it still needs them. The palette is read
 *  out of its own declaration rather than out of the whole file, because the file also names the
 *  backgrounds the names are printed on and those are not swatches anybody can pick. */
const nameColourSource = read('app/lib/profile/name-colours.ts');
const nameColourBlock = /export const NAME_COLOURS: NameColour\[\] = \[([\s\S]*?)\];/.exec(nameColourSource)?.[1] ?? '';
const nameColours = [...new Set([...nameColourBlock.matchAll(/'#[0-9a-fA-F]{6}'/g)].map((match) => match[0].slice(1, -1)))];
const garish = nameColours.filter((colour) => Math.min(contrast(colour, '#c0c0c0'), contrast(colour, '#f0f0f0')) < 4.5);

if (garish.length > 0) {
  // Reported, not raised: a garish sixteen-colour palette is the brief this site is built to, and the
  // customiser is honest about it - the picker draws the palette as two derived rows, INK and GLOW, so
  // the swatch that will fade is picked with its eyes open. A finding here would be telling the
  // archive to stop being a Web 1.0 desktop.
  console.log(`  note  ${garish.length} of ${nameColours.length} username swatches sit below 4.5:1 on the chrome or a panel`);
  console.log(`        ${garish.join(', ')}`);
  console.log('        (deliberate: the palette is the aesthetic, and the picker says so - see the GLOW row)');
}

console.log('\ncontrast (WCAG AA: 4.5 for text, 3.0 for large text)');
let failures = 0;

for (const [what, ink, paper, floor] of PAIRS) {
  const ratio = contrast(ink, paper);
  const pass = ratio >= floor;
  if (!pass) failures += 1;

  console.log(`  ${pass ? 'pass' : 'FAIL'} ${ratio.toFixed(2).padStart(5)}:1  ${what.padEnd(34)} ${ink} on ${paper}`);
}

if (failures > 0) {
  note('high', 'palette', `${failures} colour pair(s) below 4.5:1`, 'darken the ink or lighten the surface for those two');
}

// The report: worst first, because that is the order a person would fix them in.
const ORDER = { blocker: 0, high: 1, medium: 2, low: 3 };

console.log(`\nfindings (${findings.length})`);

for (const finding of [...findings].sort((left, right) => ORDER[left.severity] - ORDER[right.severity])) {
  console.log(`  ${finding.severity.toUpperCase().padEnd(7)} ${finding.area.padEnd(14)} ${finding.what}`);
  console.log(`          ${' '.repeat(22)}-> ${finding.fix}`);
}

console.log('\nwhat no script can answer, and a person should walk through:');
console.log('  - open /lore, sign in, open a page, then open the same page in a second tab: does typing in one');
console.log('    appear in the other, and does the page say who else is in it?');
console.log('  - on a phone: fold the side panel away, open the Start menu, and try to reach COMMS and LORE');
console.log('    without scrolling the page behind it;');
console.log('  - with the player playing, walk from the board to a profile to /music: does the track survive, and');
console.log('    does any page put something under the player bar?');
console.log('  - as a visitor with no account: can you read a lore page, a note and a post without being asked');
console.log('    to sign in, and is it clear what an account would add?');
console.log('  - keyboard only: Tab from the top of /lore. How many presses before you are back at the taskbar?');


