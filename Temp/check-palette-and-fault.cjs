/**
 * The nine-colour palette and the guest fault, held where they can fail.
 *
 * Two things this project settled that are easy to undo by accident:
 *
 *   1. The palette is nine colours and no grey. It *had* two furniture greys, because a quiet surface
 *      cannot be quiet by being dark: an inactive title bar read in Black needs a pale background, and
 *      a disabled plate read in Pure White needs a dark one. Both jobs are done in dye now - Flavine
 *      and Nigrosine - and this holds them to the arithmetic so neither can be collapsed onto the
 *      other, which is the exact failure that produced the greys in the first place.
 *   2. The guest banner is a fault, not an offer: fixed to the viewport, across the full width, and
 *      stepping between Emerald and Rose. It also has to stay out of the music player's way, because
 *      both are `fixed` at the foot of the window.
 *
 * The palette it holds is the *bright* theme's (`DEFAULT_THEME`, id `default`), read from the theme
 * library. It read `globals.css` until 2026-10-22, when the readability pass made the dark theme the
 * fallback and the stylesheet's first-paint block became the dark values. The claims below (an inactive
 * bar is pale, a disabled plate is dark) were always about the bright theme, and both themes' text pairs
 * are held by check-themes.
 *   npx tsc app/lib/ui/themes.ts app/lib/ui/colour.ts --outDir Temp/palette-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { contrastRatio } = require('./palette-out/colour.js');
const { DEFAULT_THEME, DYES } = require('./palette-out/themes.js');

// (2026-10-23, docs/theming.md) The motion tokens moved to app/theme/tokens.css; the keyframes stayed in
// globals.css. The two files are one stylesheet (globals imports tokens), so they are read as one.
const css = fs.readFileSync('app/globals.css', 'utf8') + fs.readFileSync('app/theme/tokens.css', 'utf8');

/* 1. Nine colours, no grey ------------------------------------------------------- */
const NINE = {
  black: '#000000',
  nigrosine: '#1a1525',
  royal: '#1d3ca6',
  daffodil: '#fff000',
  flavine: '#e1ff00',
  emerald: '#28c745',
  pink: '#ff00a0',
  rose: '#e6004c',
  white: '#ffffff',
};

const declared = Object.entries(DEFAULT_THEME.tokens);
// (2026-11-04) Plus Luke's named colours, recorded in themes.ts and docs/design.md: the stream queue's title inks
// (2026-11-02, the dyes fail as words there) and the cover card's Ash with Candy words (2026-11-03). This theme wears
// each on exactly one token, held by name, and each is one of themes.ts's named dyes. Any other colour still fails.
const NAMED_HERE = {
  'queue-played-ink': ['deepRed', '#8c0027'],
  'queue-now-ink': ['deepGreen', '#0b521b'],
  'cover-card': ['ash', '#3d3c44'],
  'cover-card-ink': ['candy', '#ffb7e6'],
  // (2026-11-11) The reader's papers and two of its highlight colours (SPEC-reader.md, Luke): reading colours for long
  // reading, worn only by the book's page at /read.
  'reader-light-paper': ['vellum', '#faf8f2'],
  'reader-dark-ink': ['moonInk', '#e6e1ee'],
  'reader-sepia-paper': ['sepiaPaper', '#f4ecd8'],
  'reader-sepia-ink': ['sepiaInk', '#4b3826'],
  'mark-blue': ['lightBlue', '#7ea6ff'],
  'mark-red': ['lightRed', '#ff5c7a'],
};
for (const [token, [dye, hex]] of Object.entries(NAMED_HERE)) {
  assert.equal(DYES[dye], hex, `${dye} is still ${hex} in themes.ts`);
  assert.equal(DEFAULT_THEME.tokens[token], hex, `--color-${token} is ${dye}`);
}
const allowedOn = (name) => (NAMED_HERE[name] === undefined ? Object.values(NINE) : [NAMED_HERE[name][1]]);

// A grey is a colour whose three channels sit within a couple of steps of each other and which is
// neither black nor white - which is what the old #484848 and #c0c0c0 were, and what nothing is now.
const isGrey = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return spread <= 4 && r > 8 && r < 247;
};

for (const [name, hex] of declared) {
  assert.ok(allowedOn(name).includes(hex), `--color-${name} (${hex}) is one of the nine, or the named colour this token wears`);
  assert.ok(!isGrey(hex), `--color-${name} (${hex}) is a grey, and this site has none`);
}

// The two furniture surfaces, held to the jobs they do and to the ink that sits on each.
const find = (name) => declared.find(([n]) => n === name)[1];

for (const [ink, surface, why] of [
  ['ink', 'chrome-dark', 'the inactive title bar: SIDE PANEL, SHELF, PROFILE, COMMS'],
  ['paper', 'chrome', 'a disabled plate, e.g. [ CHALLENGE ] while the account is offline'],
]) {
  const ratio = contrastRatio(find(ink), find(surface));
  assert.ok(ratio >= 4.5, `${why}: ${ink} on ${surface} is ${ratio.toFixed(2)}:1, and has to clear 4.5:1`);
}

// Lightness is what separates them, not hue: one pale, one dark. Collapsed, both break at once.
assert.notEqual(find('chrome'), find('chrome-dark'), 'the disabled surface and the inactive bar differ');
assert.ok(
  contrastRatio(find('chrome'), find('chrome-dark')) > 2,
  'and they are separated by lightness rather than by a shade nobody can see',
);

console.log('palette');
console.log(`  tokens   : ${declared.length} over ${new Set(declared.map(([, h]) => h)).size} colours, none of them grey`);
console.log('  furniture: Flavine under Black, Nigrosine under White, both held to the floor');

/* 2. The guest fault ------------------------------------------------------------- */
const guest = fs.readFileSync('app/components/GuestPrompt.tsx', 'utf8');

// (2026-10-25, SPEC-less-text.md) The crawl keeps its in-world flavour, `ERROR: UNREGISTERED ENTITY.` (spared,
// rule 6), and drops the instruction `CREATE ACCOUNT OR LOG IN TO INTERACT.`: the strip's `[ LOG IN ]` key does it.
assert.match(guest, /text="ERROR: UNREGISTERED ENTITY\."/, 'the fault says what it is');
assert.doesNotMatch(guest, /CREATE ACCOUNT OR LOG IN TO INTERACT/, 'without the instruction the key beside it carries out');
assert.match(guest, /\[ LOG IN \]/, 'the strip has the key that does it');
assert.match(guest, /fixed\b/, 'it is pinned to the viewport rather than scrolling with the page');
assert.match(guest, /inset-x-0/, 'and spans the width');
assert.match(guest, /animate-alarm/, 'and it is the one thing on the site that flashes');
assert.match(guest, /status !== 'anonymous'/, 'it waits for the session read instead of guessing');
// The *copy* is gone, not the phrase: the old sentence survives in this file's own comment as the
// thing it replaced, and a check that forbade the words would forbid explaining why.
assert.doesNotMatch(guest, /text="NOBODY IS SIGNED IN/, 'the polite offer text is gone');
assert.doesNotMatch(guest, /NOBODY IS SIGNED IN :: AN ACCOUNT/, 'and so is the line it used to crawl');

// It must not sit at the foot of the window: the music bar and the taskbar are both `fixed` there at
// `z-50`, so a banner at the foot would cover the player for every guest.
assert.doesNotMatch(guest, /bottom-0/, 'it does not sit where the player bar lives');
assert.match(guest, /top-0/, 'it covers the title bar instead, which is chrome rather than content');

// The alarm itself: Emerald and Rose, and a step rather than a fade.
assert.match(css, /@keyframes alarm\b/, 'the alarm keyframe exists');
assert.match(css, /--animate-alarm:\s*alarm [\d.]+m?s steps\(/, 'and it steps rather than eases');
assert.match(css, /@keyframes alarm[\s\S]{0,220}var\(--color-acid\)/, 'starting on Emerald');
assert.match(css, /@keyframes alarm[\s\S]{0,420}var\(--color-bubble-pale\)/, 'and stepping to Rose');

// The words sit on Black, and the flash is the frame around them - because the two dyes have no common
// ink. This is the assertion that says so: it proves the arrangement is necessary, not decorative.
//
// **`bg-hardware text-ink-bar`, and it was `bg-ink text-paper` until the dark theme existed** - which is
// the fault the tokens were added for. `ink` and `paper` both *move* with the theme, and in opposite
// directions: the old pair was Black under White in the default theme and became White under Nigrosine
// (1.18:1) in the dark one. A panel that "does not change colour" has to say so with tokens that do not
// change either, and `hardware` is Black in every theme while `ink-bar` is Pure White in every theme.
assert.match(guest, /bg-hardware[^"]*text-ink-bar/, 'the words are on a panel that does not change colour');
assert.ok(
  contrastRatio(NINE.white, NINE.emerald) < 3 && contrastRatio(NINE.black, NINE.rose) < 4.5,
  'no single ink clears the floor on both Emerald and Rose, which is why the field cannot be the flash',
);
assert.ok(
  contrastRatio(NINE.white, NINE.black) >= 12,
  'and the panel the words are actually on is the one readable pair, at over 12:1',
);

console.log('guest fault');
console.log('  fixed at the top, full width, Emerald to Rose in whole frames around a Black panel');

/* 3. The mobile arrangement: no band below `md`, and one drawer that carries everything ---- */
const nav = fs.readFileSync('app/components/SiteNav.tsx', 'utf8');
assert.match(nav, /className="hidden[^"]*md:flex"/, 'the key band is gone for the whole phone range');

const profile = fs.readFileSync('app/components/ProfileControl.tsx', 'utf8');
// Changed on purpose 2026-11-14 (Luke: "remove the arcade button but dont delete the code"): the drawer lists the windows through
// SIDE_WINDOWS (SiteNav.tsx), which leaves the arcade out while its key is switched off. It was `[SIDE_ARCADE, SIDE_MUSIC, ...]` here.
assert.match(profile, /SIDE_WINDOWS\.map/, 'and the profile drawer carries the windows');
assert.match(nav, /SIDE_WINDOWS: NavItem\[\] = ARCADE_KEY_SHOWN \? \[SIDE_ARCADE, SIDE_MUSIC, SIDE_QUEUES\] : \[SIDE_MUSIC, SIDE_QUEUES\]/, 'MUSIC and QUEUES always, the arcade only behind its switch');
assert.match(profile, /WINDOWS/, 'under a heading that separates them from the pages');

// The root path still hands over to the board, which is what makes "/ mounts the feed" true.
assert.match(
  fs.readFileSync('app/page.tsx', 'utf8'),
  /redirect\('\/forum'\)/,
  'the root path mounts the forum feed',
);

console.log('mobile');
console.log('  no key band below `md`; the picture is the only door, and it carries all of them');
console.log('  / hands over to /forum');
