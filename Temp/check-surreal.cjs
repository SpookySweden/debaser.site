/*
 * The surreal swatch, and the reactivity: the palette, the contrast between its colours, and the
 * verbs every control answers with.
 *   npx tsc app/lib/ui/colour.ts app/lib/ui/themes.ts app/components/MarqueeText.tsx app/components/SpriteSlot.tsx --outDir Temp/surreal-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-surreal.cjs
 *
 * A palette is the easiest thing on a site to say and the hardest to keep: one component reaches for
 * a hex it likes, another keeps a grey face because it was there first, and a year later the site is
 * four designs. So this check reads the swatch out of `app/globals.css` - where it is declared once -
 * and does three things with it:
 *
 *   1. every colour is web-safe, because the era this GUI is quoting was;
 *   2. the pairs that carry text are held to WCAG's arithmetic, so "playful" never means unreadable;
 *   3. no component has gone back to a grey or an old chrome hex, and nothing has rounded a corner.
 *
 * It also holds the reactivity itself: six keyframes, each registered as an `animate-*` utility, the
 * dashed link rule, the sprite slot's floor, and the one place a long line is allowed to move.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { contrastRatio } = require('./surreal-out/lib/ui/colour.js');
const MarqueeText = require('./surreal-out/components/MarqueeText.js').default;
const SpriteSlot = require('./surreal-out/components/SpriteSlot.js').default;

const read = (file) => fs.readFileSync(file, 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// (2026-10-23, docs/theming.md) globals.css imports app/theme/tokens.css, where the colour block (generated
// from themes.ts) and the motion tokens now live; the two files are one stylesheet and are read as one.
const css = read('app/theme/tokens.css') + read('app/globals.css');
// The swatch is the *bright* theme's (`DEFAULT_THEME`), from the theme library. It was read out of
// `globals.css` until 2026-10-22, when the readability pass made the dark theme the fallback and the
// stylesheet's first-paint block became the dark values. What this file pins (Black ink, Flavine
// panels) is the bright theme; check-themes holds the stylesheet to the fallback.
const { DEFAULT_THEME } = require('./surreal-out/lib/ui/themes.js');
const palette = { ...DEFAULT_THEME.tokens };

/* 1. The swatch: declared once, and every one of them a Dyacid dye ------------------ */
/*
 * The names `globals.css` declares, held to a list so a token cannot be added or renamed by accident.
 *
 * **`blood` and `flame` were on this list and are gone** (2026-09-29). Neither was a colour any *theme*
 * knew - they were declared in `@theme`, which is the default palette and not the theme system - so the
 * dark theme could not move them, and `Temp/check-themes.cjs` now holds the stylesheet and the default
 * theme to the same names and values in both directions. `blood` was asked for by nothing at all;
 * `flame` was a second name for `bubble` (the same #ff00a0 in both themes) reached only by `.sun-stripe`,
 * which asks for `bubble` now. The three inks and the four surfaces added in their place are the ones
 * the dark theme needed: `ink-bar` (White on a bar that does not move), `accent-ink` and `ink-quiet`
 * (the two field inks), `hardware` (Black in both themes), `desktop`/`desktop-dither` (the tile) and
 * `accent` (what the browser draws for itself).
 *
 * `pointed` (2026-10-21) is the row under the pointer: Daffodil in the default theme, Royal Blue in the
 * dark one. Added on purpose: `hover:bg-sun` put the field's inks on a dye that does not move, which was
 * White on Daffodil (1.19:1) on every pointed-at post, file and page link in the dark theme. `pointed-quiet`
 * is the same for a read post, which rests on the dark theme's Royal Blue and so lights up Black.
 */
const EXPECTED = [
  'ink', 'ink-plate', 'ink-bar', 'accent-ink', 'ink-quiet', 'paper',
  'chrome', 'chrome-dark', 'hardware', 'ena', 'ena-deep',
  'sun', 'pointed', 'pointed-quiet', 'sun-pale', 'ice', 'ice-pale', 'bubble', 'bubble-pale',
  'acid', 'acid-pale', 'desktop', 'desktop-dither', 'accent',
  // (2026-11-04) Named since: the BARRED chip, the cover card (Luke 2026-11-03), the stream queue's title inks (Luke 2026-11-02).
  'barred', 'cover-card', 'cover-card-ink', 'cover-card-title', 'queue-played-ink', 'queue-now-ink', 'queue-next-ink',
  // (2026-11-11) The reader's three papers and five highlight colours (SPEC-reader.md, Luke).
  'reader-light-paper', 'reader-light-ink', 'reader-dark-paper', 'reader-dark-ink', 'reader-sepia-paper', 'reader-sepia-ink',
  'mark-yellow', 'mark-pink', 'mark-green', 'mark-blue', 'mark-red',
];

assert.deepEqual(Object.keys(palette).sort(), [...EXPECTED].sort(), 'the swatch is exactly these colours');

// The dye pot: nine colours and no grey anywhere. Every token above has to be one of them, and the
// two that were greys - `chrome` and `chrome-dark` - now *name* a dye rather than being furniture.
//
// They still exist as tokens because the components ask for them, and they still have to be a light
// surface and a dark one, because that is the pair of jobs they do: an inactive title bar (quiet, and
// read in Black) and a disabled plate (quiet, and read in Pure White). What changed is the colour
// they are made of. Both pairs are held to the arithmetic in section 2, so neither can be collapsed
// onto a single dark value again - which is the failure that put the greys here in the first place.
const DYES = ['#000000', '#1a1525', '#1d3ca6', '#e1ff00', '#fff000', '#28c745', '#ff00a0', '#e6004c', '#ffffff'].map(
  (hex) => hex.toLowerCase(),
);

// (2026-11-04) Beyond the nine, this theme wears four colours Luke named, recorded in themes.ts and docs/design.md, each
// on exactly one token: the stream queue's deep title inks (2026-11-02) and the cover card's Ash and Candy (2026-11-03).
// Named exactly, so none can spread to another token or drift. Everything else is still one of the nine.
const NAMED_TOKENS = {
  'queue-played-ink': '#8c0027',
  'queue-now-ink': '#0b521b',
  'cover-card': '#3d3c44',
  'cover-card-ink': '#ffb7e6',
  // (2026-11-11) The reader's papers and two highlight colours (SPEC-reader.md, Luke), worn only at /read.
  'reader-light-paper': '#faf8f2',
  'reader-dark-ink': '#e6e1ee',
  'reader-sepia-paper': '#f4ecd8',
  'reader-sepia-ink': '#4b3826',
  'mark-blue': '#7ea6ff',
  'mark-red': '#ff5c7a',
};

for (const [name, hex] of Object.entries(palette)) {
  if (NAMED_TOKENS[name] !== undefined) {
    assert.equal(hex, NAMED_TOKENS[name], `${name} is the colour Luke named for it`);
    continue;
  }
  assert.ok(DYES.includes(hex), `${name} (${hex}) is one of the nine - and nothing on this site is grey`);
}

// Named exactly, so a token cannot drift to a neighbouring hue and still be "close enough".
assert.equal(palette.ink, '#000000', 'Black is the ink, and the dark side of every bevel');
// The two furniture surfaces, and the thing that matters about them is that they differ in *lightness*:
// an inactive title bar is pale (Black reads on it) and a disabled plate is dark (Pure White reads on
// it). Collapsed onto one value - which is what happened once - the first becomes invisible and the
// second becomes a blank.
assert.equal(palette['chrome-dark'], '#e1ff00', 'Flavine is the quiet furniture: an inactive title bar');
assert.equal(palette.chrome, '#1a1525', 'and the disabled plate is Nigrosine, the field pressed in');
assert.notEqual(
  palette.chrome,
  palette['chrome-dark'],
  'the disabled surface and the ink that sits on it cannot be the same colour, which is what broke',
);
assert.equal(palette.ena, '#1d3ca6', 'Royal Blue is the window you are in');
assert.equal(palette.sun, '#fff000', 'Daffodil Yellow is every plate face');
assert.equal(palette['sun-pale'], '#e1ff00', 'and Flavine is the pale field panels are read on');
assert.equal(palette.acid, '#28c745', 'Emerald is anything that is a "go"');
assert.equal(palette.bubble, '#ff00a0', 'Brilliant Pink is the one accent');
assert.equal(palette['bubble-pale'], '#e6004c', 'and Rose is the warning beside it');

/* 2. The contrast: every pair that carries text, held to the arithmetic ---------------- */
const PAIRS = [
  ['ink', 'sun', 12, 'a plate label on a plate face'],
  ['sun', 'ena', 4.5, 'the same label after the hover inverts it'],
  ['ink', 'sun-pale', 12, 'body text on a panel'],
  ['ink', 'ice-pale', 12, 'body text on an inset or a hover'],
  ['ink', 'acid', 4.5, 'a status bar'],
  ['paper', 'ink', 12, 'a field'],
  ['ena', 'sun', 4.5, 'the deep blue on a headline'],
  // The two furniture greys, which the dye pass collapsed onto one near-black and nobody noticed
  // until a reader said three elements were unreadable. They are added here rather than left to the
  // eye because both are *surfaces with ink on them* - which is the one job a grey can fail at.
  ['ink', 'chrome-dark', 4.5, 'the inactive title bar`s name: SIDE PANEL, SHELF, PROFILE, COMMS'],
  ['chrome-dark', 'chrome', 4.5, 'a disabled plate`s label, e.g. [ CHALLENGE ] while an account is off'],
];

for (const [inkName, paperName, floor, why] of PAIRS) {
  const ratio = contrastRatio(palette[inkName], palette[paperName]);

  assert.ok(
    ratio >= floor,
    `${inkName} on ${paperName} is ${ratio.toFixed(1)}:1 (${why}) and has to clear ${floor}:1`,
  );
}

/* 3. The verbs: six of them, each one a registered utility --------------------------- */
for (const verb of ['wobble', 'bump', 'shake', 'flash', 'marquee', 'blip']) {
  assert.match(css, new RegExp(`@keyframes ${verb}\\b`), `${verb} is defined`);
  assert.match(css, new RegExp(`--animate-${verb}:`), `and reachable as animate-${verb}`);
}

assert.match(css, /\.link-pixel\s*\{/, 'the dotted link rule is declared');
assert.match(
  css,
  /background-image: repeating-linear-gradient\(to right, var\(--color-ena\)/,
  'its underline is a pixel pattern rather than a hairline',
);
assert.match(
  css,
  /\.link-pixel:hover[\s\S]{0,200}var\(--color-bubble\)/,
  'and the dashes change to a contrasting colour on hover',
);
assert.match(css, /\.sprite-slot\s*\{/, 'the artwork slot has a dithered floor of its own');
assert.match(css, /prefers-reduced-motion: reduce/, 'and everything that moves can be switched off');
// The desktop is Brilliant Pink - and now it says so with the *tokens*, which is what lets a theme
// dither the tile through Nigrosine instead. The assertion used to look for a `#ff00a0` literal within
// the rule, and that literal was the whole problem: a tile painted from a hex kept its Brilliant Pink
// dither in a dark theme, which is a pink stripe down the side of a night desktop. The rule holds the
// stronger thing now - the fill and the dither are both tokens, and they are different tokens, because
// a dither equal to its fill is a tile with no texture at all.
assert.match(
  css,
  /\.desktop-tile\s*\{[\s\S]{0,240}background-color:\s*var\(--color-desktop\)/,
  'the desktop tile is filled from the desktop token',
);
assert.match(
  css,
  /\.desktop-tile\s*\{[\s\S]{0,600}var\(--color-desktop-dither\)/,
  'and dithered through its own token, so a theme can move both',
);
assert.deepEqual(
  Object.keys(palette).filter((name) => name.startsWith('desktop')),
  ['desktop', 'desktop-dither'],
  'the two desktop tokens are the pair a theme sets together',
);

// (2026-11-04) One cursor became three sets the reader picks in PREFERENCES (app/lib/ui/cursor-slot.ts, globals.css,
// assets/cursors/README.txt), each three custom properties the element rules read. So each set is held, with the
// ordinary cursor behind every picture, and the element rule has to read the property.
for (const set of ['white', 'black', 'pink']) {
  assert.match(css, new RegExp(`--cursor-arrow: url\\('/assets/cursors/arrow-${set}\\.png'\\) 0 0, auto;`), `the ${set} arrow, with the ordinary one behind it`);
  assert.match(css, new RegExp(`--cursor-pointer: url\\('/assets/cursors/pointer-${set}\\.png'\\) 0 0, pointer;`), `the ${set} pointer, with the ordinary one behind it`);
  assert.match(css, new RegExp(`--cursor-text: url\\('/assets/cursors/text-${set}\\.png'\\) 0 0, text;`), `the ${set} text cursor, with the ordinary one behind it`);
}
assert.match(css, /cursor: var\(--cursor-arrow\)/, 'the pointer is still the hand-drawn cursor, read from the set');

/* 4. The vocabulary: the chrome is written in the swatch, and in nothing else --------- */
const controls = read('app/lib/ui/controls.ts');

// The Gnorp keys (SPEC-readability.md, 2026-10-22): an outlined `key` on the window fill, the accent ink
// as the hover's colour swap, the Daffodil and Brilliant Pink fills of the main action and the accent
// plate (`--key-fill`), the pink press flash - and no hover wobble, because a label that moves under
// the pointer is the thing the readability pass removed. This list used to hold the Win95 vocabulary
// (`hover:bg-ena`, `hover:animate-wobble`), which is why it changed rather than grew.
for (const token of [
  'key',
  'bg-sun-pale',
  'text-ink',
  'active:animate-flash',
  'active:bg-bubble',
  'focus-visible:outline-bubble',
  '[--key-fill:var(--color-sun)]',
  '[--key-fill:var(--color-bubble)]',
  'bg-chrome-dark',
  'link-pixel',
  'sprite-slot',
]) {
  assert.match(controls, new RegExp(escape(token)), `${token} is part of the shared vocabulary`);
}

// (2026-10-23, SPEC-efficiency.md) Bracket keys: a key at rest is its label in the accent ink with no
// outline, and fills with that ink under the pointer. The look moved from controls.ts' utilities
// (`hover:text-accent-ink` on every key) into one rule in globals.css, so that is where it is asked for.
assert.match(
  css,
  /\.key:not\(\.key-fill\) \{[^}]*border-width: 0;[^}]*color: var\(--key-ink, var\(--color-accent-ink\)\)/,
  'a bracket key is its label in the accent ink, with no outline',
);
assert.match(
  css,
  /\.key:not\(\.key-fill\):hover:not\(:disabled\) \{[^}]*background-color: var\(--key-ink, var\(--color-accent-ink\)\)/,
  'and fills with the accent ink under the pointer',
);
// (2026-10-24, Luke's OK on the review leftovers) A key that cannot be pressed carries a dotted rule under
// its words: on the dark theme the quiet ink (Flavine) sits too close to the keys' Daffodil for colour
// alone to say "not now".
assert.match(
  css,
  /\.key:not\(\.key-fill\):disabled \{[^}]*text-decoration-style: dotted;/,
  'and a disabled key says so with a dotted rule, not with colour alone',
);

assert.doesNotMatch(controls, /animate-(wobble|bump|shake)/, 'and no shared control moves its label under the pointer');

assert.doesNotMatch(
  controls,
  /#c0c0c0|#000080|#484848/,
  'and no control is written in the old chrome hexes - the greys are gone from the palette entirely',
);

/** Every source file under `app`, so a hex or a corner cannot hide in a component. */
const sources = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) sources.push(path);
  }
};

walk('app');

/**
 * No component writes a chrome hex of its own.
 *
 * This is the rule that keeps a palette a palette: every fill and every ink on the site comes from the
 * shared vocabulary (`controls.ts`), which comes from the swatch (`globals.css`). A component with a
 * hex in it is a colour with no source, which is how the grey survived sixteen components in the first
 * place. The `lib/` modules are exempt on purpose - two of them hold *swatches* (the sixteen an
 * account may pick from) and one holds the house account's own navy, which are data, not chrome.
 */
const componentHexes = sources
  .filter((file) => file.startsWith('app/components/'))
  // `TagCreatorWindow` is the one exception, and it is not a fill: it *measures* a swatch against the
  // paper it will be read on and prints the ratio, so it has to name the paper to do the arithmetic.
  .filter((file) => file !== 'app/components/TagCreatorWindow.tsx')
  // Any six-digit hex at all. A component with a colour in it is a colour with no source, and the
  // dye pot is small enough that "I'll just pick one here" is always a mistake.
  .filter((file) => /#[0-9a-fA-F]{6}\b/.test(read(file)));

assert.deepEqual(componentHexes, [], 'no component writes a palette hex of its own');

// (2026-11-04, SPEC-vanity.md: "three small round faces") One exception, named: the recommendation faces in VANITY are
// the uploader's picture cropped round. It is held to that one wrapper round `ProfileAvatar`, so chrome still cannot round.
const ROUND_FACE = /<span className="inline-flex overflow-hidden rounded-full">\s*<ProfileAvatar\b/;
const ROUNDED = /rounded-(sm|md|lg|xl|2xl|3xl|full|tl-|tr-|bl-|br-)/;
assert.match(read('app/components/VanityView.tsx'), ROUND_FACE, 'VANITY`s faces are the one round thing');
// (2026-11-10, SPEC-letters.md: "the stamp is replaced by a circular cropped picture of the users choosing") The second
// named exception: a letter's stamp picture, cropped round, held to the one `StampCircle` wrapper in LetterStamp.tsx.
const STAMP_CIRCLE = /<span className=\{`block overflow-hidden rounded-full border border-ink bg-paper \$\{className\}`\}>/;
assert.match(read('app/components/LetterStamp.tsx'), STAMP_CIRCLE, 'a letter`s stamp is the other round thing');
const rounded = sources.filter((file) => {
  const text = read(file);
  if (file === 'app/components/VanityView.tsx') return ROUNDED.test(text.replace(ROUND_FACE, ''));
  if (file === 'app/components/LetterStamp.tsx') return ROUNDED.test(text.replace(STAMP_CIRCLE, ''));
  return ROUNDED.test(text);
});
assert.deepEqual(rounded, [], 'nothing else on this site has rounded a corner');

/* 5. The moving line, and the room for artwork ---------------------------------------- */
const player = read('app/components/MusicPlayer.tsx');
assert.match(player, /<MarqueeText/, 'the player scrolls a long title rather than clipping it');
assert.match(read('app/components/MarqueeText.tsx'), /animate-marquee/, 'and the ticker is the shared one');
assert.match(
  read('app/components/MarqueeText.tsx'),
  /ResizeObserver/,
  'it measures first, so a title that fits is left still',
);

const still = renderToStaticMarkup(React.createElement(MarqueeText, { text: 'WARD THEME' }));
assert.match(still, /WARD THEME/, 'a short title is drawn as words');
assert.doesNotMatch(still, /animate-marquee/, 'and is not animated');

const slot = renderToStaticMarkup(
  React.createElement(SpriteSlot, { src: '/assets/sprites/walk-cycle.gif', alt: 'a figure', width: 24, height: 24 }),
);
assert.match(slot, /sprite-slot/, 'a sprite slot is a dithered field');
assert.match(slot, /width="24"/, 'at the size the hand-drawn sprite will be');
assert.match(slot, /sprites\/walk-cycle\.gif/, 'pointing at the path the file belongs at');
assert.match(slot, /not in the assets folder yet/, 'and saying which file it is waiting for');

assert.match(read('app/components/Taskbar.tsx'), /<SpriteSlot/, 'the taskbar leaves room for a walking figure');
assert.match(read('app/components/ProfileStatusBar.tsx'), /<SpriteSlot/, 'and so does a profile status line');
assert.ok(fs.existsSync('assets/sprites/README.txt'), 'with both files named in the assets README');

/* 6. The mandates: the things that are rules rather than taste -------------------------- */

// A window opens from an address or not at all: the arcade's slot starts shut, so refreshing the
// board cannot open it. This is the one that is easiest to break by "helpfully" defaulting to open.
const arcade = read('app/lib/games/arcade-window.ts');
assert.match(arcade, /const CLOSED: ArcadeWindowState = \{ open: false/, 'the arcade starts closed');
assert.match(arcade, /createWindowSlot<ArcadeWindowState>\(CLOSED\)/, 'and its slot is seeded with that');

// The two window keys are symbols, not words, and each says what it is out loud.
const nav = read('app/components/SiteNav.tsx');
assert.match(nav, /ICON_MUSIC/, 'the archive key is the cassette glyph');
assert.match(nav, /ICON_ARCADE/, 'the arcade key is the joystick glyph');
assert.match(nav, /aria-label=/, 'and every key carries the word it is read with');
assert.doesNotMatch(nav, />\s*MUSIC\s*</, 'neither key is drawn as a word');

// The header band and the Start plate are wide-screen chrome: a phone's only door is the picture.
// (2026-11-04) The band now appears from `md`, not `sm`; below that it is still hidden, which is the rule.
assert.match(nav, /<nav\b[^>]*className="hidden[^"]*\b(sm|md):flex/, 'the key band is hidden on a phone');
assert.match(read('app/components/Taskbar.tsx'), /hidden sm:inline-flex/, 'and so is the Start plate');
// The picture button: the label comes first in the JSX and the avatar sits inside it, which is the
// thing worth holding - the avatar is *in* the control, not beside it.
assert.match(
  read('app/components/ProfileControl.tsx'),
  /aria-label=\{`Open the account menu[\s\S]{0,900}<ProfileAvatar/,
  'the profile picture is what opens the site menu on a phone',
);

// The guest banner is drawn in the shell, so every page says it rather than the landing page alone.
assert.match(read('app/components/SiteWindow.tsx'), /<GuestPrompt \/>/, 'the shell carries the guest banner');
// ...and it is drawn only once the session has been read and came back empty. `user` is null while
// the session is still loading, so a `user === null` guard would flash the sign-in offer at somebody
// who is already signed in - which is what "the banner should not show when I am signed in" means.
assert.match(
  read('app/components/GuestPrompt.tsx'),
  /if \(status !== 'anonymous'\) return null;/,
  'the guest banner waits for the session rather than flashing at the signed-in',
);
assert.doesNotMatch(
  read('app/components/GuestPrompt.tsx').replace(/^\s*\*.*$/gm, '').replace(/\/\/[^\n]*/g, ''),
  /user === null/,
  'and it never guards on `user`, which is null mid-read',
);

// The side panel's own card makes the same distinction, in the same place: three states, so the
// log-in link and the Google button are not offered to an account that already exists.
const sidebarProfile = read('app/components/SidebarProfile.tsx');
assert.match(
  sidebarProfile,
  /status === 'loading' \? \(/,
  'the side panel`s profile card has a loading state of its own',
);
assert.doesNotMatch(
  sidebarProfile,
  /^\s*\{user === null \? \(/m,
  'and does not branch on `user` first, which is what put the log-in button in front of the signed-in',
);



// The landing page is the board, not a brochure.
assert.match(read('app/page.tsx'), /redirect\('\/forum'\)/, 'an unauthenticated visitor lands on the board');

// An account with no drawing wears a slot, never a broken image or a compact "[ ? ]" notice.
const avatar = read('app/components/ProfileAvatar.tsx');
assert.match(avatar, /AnonymousSlot/, 'there is one anonymous placeholder');
assert.match(avatar, /SPRITE_SLOT/, 'and it is a dithered field rather than a broken picture');
assert.match(
  avatar,
  /anonymous \|\| picture === undefined \? \(/,
  'the anonymous branch is what a missing picture takes, so SheetImage never sees one',
);

// Every account opens with one welcome tag: approved, given by the house account, and not the
// owner's own badge - so a fresh profile is not an empty tag heading, and the "one self-given tag"
// rule is not spent on it. This is the row the Supabase trigger files too (supabase/schema.sql,
// `handle_new_user`), which is why the id is a constant both sides can agree on.
const visibilitySrc = read('app/lib/profile/visibility.ts');
assert.match(visibilitySrc, /DEFAULT_PROFILE_TAG\b/, 'there is one welcome tag');
assert.match(visibilitySrc, /export function defaultProfileTag\(/, 'built in one place');
assert.match(
  read('app/lib/profile/mock-profile-repository.ts'),
  /tags: \[defaultProfileTag\(now\)\]/,
  'and every fresh profile wears it',
);
assert.match(
  read('supabase/schema.sql'),
  /insert into public\.profile_tags[\s\S]{0,400}NEW HERE/,
  'the database files the same welcome on signup',
);
assert.match(
  read('supabase/schema.sql'),
  /where not exists \(select 1 from public\.profile_tags/,
  'and backfills it for accounts that predate it',
);

// The welcome tag's colour is the swatch's, not a second copy of it.
assert.match(visibilitySrc, /DEFAULT_PROFILE_TAG_COLOUR = ACCENT_COLOUR/, 'it wears the site`s Royal Blue');

// HOME is the projects map, not `/` and not the one project it lists: `/` hands over to the board, so a
// HOME pointing there would go where FORUM already goes - and a HOME pointing straight at
// `/projects/debaser` would keep going to the first project filed whatever else gets added.
const homeNavSource = read('app/components/SiteNav.tsx');
assert.match(homeNavSource, /href: '\/projects'/, 'HOME opens the projects index');
assert.doesNotMatch(
  homeNavSource.match(/home',\s*label[^}]*\}/)[0],
  /\/projects\/debaser/,
  'not the one project the index exists to list',
);
assert.ok(
  fs.existsSync('app/projects/page.tsx'),
  'and the index is a page, built from the list it presents',
);
assert.match(
  read('app/projects/page.tsx'),
  /ARCHIVE_PROJECTS\.map/,
  'drawn from `ARCHIVE_PROJECTS` rather than from an href typed out beside it',
);

// Neither window is a key on the header band, and neither is a plate on the board's title bar: both
// open *over* wherever the reader is standing, so both live in the side panel's shelf, at the
// thumb-end of the panel rather than mixed into a row of pages you go to. Three places to check,
// because "I moved it and something put it back" is exactly the drift this catches.
const board = read('app/components/ForumBoard.tsx');
assert.doesNotMatch(board, /ICON_ARCADE/, 'the arcade is not a plate on the board');
assert.doesNotMatch(board, /ICON_MUSIC/, 'and nor is the archive');
assert.doesNotMatch(board, /WINDOW_KEY/, 'so the recess that held the pair is gone with them');

const navSource = read('app/components/SiteNav.tsx');
assert.match(navSource, /export const SIDE_MUSIC/, 'the archive is the side panel`s own key');
assert.match(navSource, /export const SIDE_ARCADE/, 'and so is the arcade');
const band = navSource.match(/export const NAV_ITEMS[\s\S]*?\];/)[0];
assert.doesNotMatch(band, /music/, 'neither is in the header band`s list');
assert.doesNotMatch(band, /games/, 'not the arcade either');

const panelSource = read('app/components/DesktopSidebar.tsx');
assert.match(panelSource, /item=\{SIDE_ARCADE\}/, 'which the side panel draws');
assert.match(panelSource, /item=\{SIDE_MUSIC\}/, 'both of them');
assert.match(
  panelSource,
  /SidebarProfile \/>[\s\S]*?SIDE_ARCADE[\s\S]*?SIDE_MUSIC[\s\S]*?SidebarComms \/>/,
  'under the profile and above the conversations, so the panel reads account-then-shelf-then-talk',
);

// The two shelf keys are switches, not links: a second press shuts the window. Both windows answer
// the same way, which is the whole reason `ShelfKey` is written once - and a *link* into either
// window (a tag badge, the Start menu shelf, a post's plate, the bell's invitation) still only ever
// opens it, because a link that closed what it was asked for is a link that does nothing.
//
// `toggleMusic` takes a screen because the side panel's key opens the reader's *own* music rather
// than the archive (`SIDE_MUSIC.href` is `LIBRARY_HREF`). The switch behaviour is the part that must
// not change, so this asserts the shape of the close branch rather than the exact signature: pressing
// the key of the screen that is showing still shuts the window, and naming the other screen moves to
// it instead of closing, because the reader asked for somewhere rather than for nothing.
assert.match(
  read('app/lib/audio/music-window.ts'),
  // (2026-10-24: the default screen is the reader's own music; the archive is the media page.)
  /export function toggleMusic\(screen: MusicScreen = 'mine'\): void \{[\s\S]{0,600}slot\.state\(\)\.screen === screen[\s\S]{0,40}closeMusic\(\)/,
  'the archive has one toggle, it closes when that screen is open, and it opens on the screen it is asked for',
);
assert.match(
  read('app/lib/games/arcade-window.ts'),
  /export function toggleArcade\(\): void \{[\s\S]{0,120}closeArcade\(\)[\s\S]{0,60}openArcade\(\)/,
  'and so does the arcade',
);
assert.match(
  read('app/components/DesktopSidebar.tsx'),
  /isOpen=\{arcadeOpen\} onPress=\{pressArcade\}/,
  'the arcade`s key presses that toggle',
);
assert.match(
  read('app/components/DesktopSidebar.tsx'),
  /isOpen=\{musicOpen\} onPress=\{pressMusic\}/,
  'and so does the archive`s',
);

// The addresses are spent on close, or the shut window disagrees with the URL and the window's own
// effect opens the thing straight back up. The arcade has four addresses (floor, invite, challenge)
// and the archive two; both questions answer for every shape, in the module that owns them.
assert.match(
  read('app/lib/games/arcade-window.ts'),
  /arcadeAddressSpentByClose[\s\S]{0,200}arcadeFocusFromSearch/,
  'the arcade spends any address that names it, all three shapes at once',
);
assert.match(
  read('app/components/DesktopSidebar.tsx'),
  /if \(wasOpen && spentByClose\(asked\)\) router\.replace\(pathname\)/,
  'and both keys spend it, through one press',
);

// The address is built by the module that owns and reads it, never spelled out at a call site. This
// is not tidiness: three shapes of arcade address exist (`?arcade=`, `?invite=`, `?challenge=&game=`)
// and the window reads them through `arcadeFocusFromSearch`. A component that wrote one by hand would
// be a second opinion about what an address means, and it would be the one that drifts.
assert.match(
  read('app/components/NotificationMenu.tsx'),
  /arcadeHref\(\{ kind: 'invite'/,
  'the bell builds an invitation through `arcadeHref`',
);
// (2026-10-23, SPEC-efficiency.md) The directory's `[ ARCADE ]` link went with the `THE LAMP [ LEGEND ]`
// panel and its row of nav links (the header and the side panel already reach the arcade). The loop
// below still holds it to never spelling an arcade address by hand.
assert.doesNotMatch(
  read('app/components/UserDirectory.tsx'),
  /\[ ARCADE \]/,
  'and the directory carries no second way to the arcade floor',
);
for (const file of ['app/components/NotificationMenu.tsx', 'app/components/UserDirectory.tsx']) {
  assert.doesNotMatch(
    read(file).replace(/^\s*\*.*$/gm, '').replace(/\/\/[^\n]*/g, ''),
    /['"`]\/forum\?(arcade|invite|challenge)/,
    `${file} does not spell an arcade address out by hand`,
  );
}

// No component reaches past the palette for a colour the palette already has. `white` is not a token
// in the `@theme` block - `paper` is, and it is the same #ffffff - so `text-white` agreed with the
// swatch by accident rather than by intent, and a change to `paper` would have skipped all 33 files
// that wore it. `border-white` is left alone: it is part of the raised bevel the vocabulary already
// expresses (`BEVEL_OUT`).
//
// Every utility that can carry a colour is listed, not just `text-`. An earlier version of this check
// looked for `text-white` alone and so missed `divide-gray-300` in the board's thread list and
// `divide-gray-500` twice on the link page - four grey rules on a site that has no greys, which is the
// same defect wearing a different utility.
const strayPattern =
  /\b(?:text|bg|border|divide|ring|outline|fill|stroke|from|via|to|decoration|accent|caret)-(?:white|black|gray|grey|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/;

const strayFiles = [];
const walkApp = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkApp(path);
    else if (/\.tsx?$/.test(entry.name)) strayFiles.push(path.replace(/\\/g, '/'));
  }
};
walkApp('app');

const strays = [];
for (const file of strayFiles) {
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/^\s*(\*|\/\/)/.test(line)) return;
      // (2026-11-04) The cursor sets' art slots are named `cursor-text-white` and filed at `.../text-white.png`: a
      // slot's own id and path, not a class. Only those two fields of the slot registry; any class there still fails.
      if (file === 'app/lib/ui/art/slots.ts' && /^\s*(id|path): '[^']*',\s*$/.test(line)) return;

      const hits = line.match(new RegExp(strayPattern.source, 'g'));
      if (hits === null) return;

      // The raised bevel is `border-white` / `border-black`, and it is declared by the vocabulary
      // (`BEVEL_OUT` and friends) rather than invented at each call site - so those two are the one
      // allowed shape, and anything else is a colour that came from somewhere other than the swatch.
      const offending = hits.filter((hit) => !/^border-(white|black)$/.test(hit));
      if (offending.length > 0) strays.push(`${file}:${i + 1} ${[...new Set(offending)].join(' ')}`);
    });
}
assert.deepEqual(strays, [], 'no component inks or rules with a Tailwind default instead of a token');

console.log('dyes       : the swatch is exactly the nine, and every pair that carries text clears its floor');
console.log(`  swatch   : ${Object.keys(palette).length} tokens over ${new Set(Object.values(palette)).size} colours, ${PAIRS.length} pairs held to the arithmetic`);
console.log('  verbs    : wobble / bump / shake / flash / marquee / blip, each an animate-* utility');
console.log('  surfaces : no component writes a hex, nothing rounded, no default palette colours');
console.log('  artwork  : two sprite slots and a marquee, all pointing at hand-drawn files');
