/*
 * Scratch check that a username always wears its account's colour (run from the root):
 *   npx tsc app/components/ProfileName.tsx app/components/ProfileBoardActivity.tsx app/components/AccountProfilePanel.tsx app/components/CommsThreadPanel.tsx app/lib/ui/modules.ts --outDir Temp/name-colour-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-name-colour.cjs
 *
 * Every place a name is printed now draws it with `ProfileName`, so the swatch an
 * account picked in the customiser follows the name onto the board, the comments,
 * the comms page, the profile page and the account page. This proves the markup:
 *
 *   1. ProfileName paints the colour it is given and can leave the lamp off;
 *   2. the profile page's board-activity line takes the page's own colour;
 *   3. the comms "message to" line names the peer through ProfileName;
 *   4. the account page's profile panel names the account through ProfileName too;
 *   5. the swatch is a *pair* - the value on the light field and the value on the dark one - and the row
 *      the picker offers as readable is readable in both themes.
 *
 * The colour is applied as two custom properties (`--name-ink`, `--name-ink-dark`) rather than as
 * `color`, and `.name-ink` in globals.css chooses between them on `[data-theme='dark']`. That is why the
 * assertions below look for `--name-ink` and for the class rather than for `color:` - and it is the one
 * place a theme is branched on in CSS, because a name colour is chosen by a reader and cannot be a token.
 *
 * Only (2) can be proved at the colour level here, because the colour comes from
 * an asynchronous profile read: server rendering has no store yet, which is why
 * the account-page cases below check the wrapper the colour lands in, and the
 * store-to-colour step itself is covered by profileNameColour in the other checks.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

/** A module replaced before anything requires it: the audio stores are not what is on trial. */
function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub('./name-colour-render/components/MusicPlayerProvider.js', {
  useMusicPlayer: () => ({ assign: () => undefined, track: undefined, playing: false }),
});

stub('./name-colour-render/lib/ui/use-compact-viewport.js', {
  useCompactViewport: () => false,
});

const ProfileName = require('./name-colour-render/components/ProfileName.js').default;
const ProfileBoardActivity = require('./name-colour-render/components/ProfileBoardActivity.js').default;
const AccountProfilePanel = require('./name-colour-render/components/AccountProfilePanel.js').default;
const CommsThreadPanel = require('./name-colour-render/components/CommsThreadPanel.js').default;
const AuthProvider = require('./name-colour-render/components/AuthProvider.js').default;
const PresenceProvider = require('./name-colour-render/components/PresenceProvider.js').default;

const element = React.createElement;
/** ProfileName asks for presence, so the providers have to be around it. */
const withProviders = (child) =>
  renderToStaticMarkup(element(AuthProvider, null, element(PresenceProvider, null, child)));

/** A drawn lamp: presence is not ready during server rendering, so this is 0 today. */
const LAMP = /aria-label="(ONLINE|AWAY|OFFLINE)"/;

// 1. The name itself.
const named = withProviders(
  element(ProfileName, {
    author: { id: 'user-sweden', displayName: 'sweden' },
    colour: '#ff0000',
    lamp: false,
  }),
);
assert.match(named, /--name-ink:#ff0000/, 'the name carries the swatch it was given');
assert.match(named, /class="name-ink"/, 'and wears the class the stylesheet picks a value on');
assert.doesNotMatch(named, /--name-ink-dark/, 'a colour that is not on the swatch has no dark counterpart');
assert.match(named, /<span[^>]*>sweden<\/span>/);
assert.doesNotMatch(named, LAMP, 'a list entry draws no lamp');

// 2. The profile page's board activity: the account whose page it is.
const activity = withProviders(
  element(ProfileBoardActivity, {
    userId: 'user-sweden',
    displayName: 'sweden',
    nameColour: '#ff0000',
    threads: [],
  }),
);
// (2026-10-25, SPEC-less-text.md) The empty state `SWEDEN HAS NOT FILED ANYTHING ON THE BOARD YET.` is cut to
// `NOTHING YET.`: the profile page already names whose page it is, so this panel draws no name at all - and a
// name that is not drawn has no colour to wear. What is held now is that no stray, uncoloured name appears.
// Updated on purpose (Luke's list, 2026-11-14, "make board activity expandable and collapsd by default"): the section
// is drawn shut, so its empty line is not in the page until its key is pressed. What it draws shut is the key, and
// still no name. The open list is a browser's job (`scripts/drive-profile-rows.cjs`): a static render cannot press.
assert.match(activity, /aria-expanded="false"/, 'the board activity is drawn folded away');
assert.doesNotMatch(activity, /NOTHING YET\.|HAS NOT FILED/, 'with no empty line, in two words or as a sentence, until it is opened');
assert.doesNotMatch(activity, />sweden<|>SWEDEN</, 'and draws no name, so none can lose its colour');
assert.doesNotMatch(activity, LAMP);

const plainActivity = withProviders(
  element(ProfileBoardActivity, { userId: 'user-luke', displayName: 'luke', threads: [] }),
);
assert.doesNotMatch(plainActivity, /--name-ink/, 'an account with no swatch stays the page black');
assert.match(plainActivity, /aria-expanded="false"/, 'folded away too (2026-11-14)');

// 3. Comms: the panel names the peer it is addressed to.
const panel = withProviders(
  element(CommsThreadPanel, {
    idPrefix: 'check',
    thread: {
      id: 'dm:user-a|user-b',
      participants: ['user-a', 'user-b'],
      kind: 'dm',
      name: '',
      messages: [],
      readAt: {},
      createdAt: '2026-09-21T04:39:52.000Z',
      updatedAt: '2026-09-21T04:39:52.000Z',
    },
    userId: 'user-a',
    otherId: 'user-b',
    nameById: new Map([['user-b', 'sweden']]),
    onSend: async () => undefined,
    limit: 6,
  }),
);
// (2026-10-23, SPEC-efficiency.md) The `MESSAGE TO name:` label over the field is cut; the field's placeholder
// and accessible name address the other side, and the window's title line draws their name in colour.
assert.doesNotMatch(panel, /MESSAGE TO /, 'no label restating who the field writes to');
assert.match(panel, /placeholder="Message sweden\.\.\."/, 'the field itself says who it writes to');
assert.doesNotMatch(panel, LAMP);

// 4. The account page: the name is drawn by ProfileName, not interpolated raw.
const accountPanel = withProviders(element(AccountProfilePanel, { userId: 'user-sweden' }));
// (2026-10-25, SPEC-less-text.md) The account page names the account once, in ACCOUNT DETAILS (`NAME: ...`);
// the PUBLIC PROFILE panel's `NAME ON THE PROFILE:` line is cut. So the panel draws no name, and the one
// that is drawn goes through ProfileName with the profile's colour (read in AccountDetails' source: that
// component is not compiled for this check).
assert.doesNotMatch(accountPanel, /NAME ON THE PROFILE/, 'the profile panel no longer repeats the name');
assert.doesNotMatch(accountPanel, LAMP);
const accountDetailsSource = require('node:fs').readFileSync('app/components/AccountDetails.tsx', 'utf8');
assert.match(
  accountDetailsSource,
  /NAME:\{' '\}\s*<ProfileName[\s\S]*?colour=\{profileNameColour\(profile\)\}[\s\S]*?\/>/,
  'and ACCOUNT DETAILS draws it through ProfileName, in the account`s colour',
);

// 5. The swatch is a *pair*: the value drawn on a light field and the value drawn on the dark one, and
//    the row the picker offers as readable is readable in both themes. Held to the arithmetic rather
//    than to a memory of which dyes are dark, because the memory is what was wrong: Royal Blue is
//    9.34:1 on White and was 1.91:1 on the dark field, and a name is the one ink a reader chooses.
const { NAME_COLOURS, NAME_COLOURS_THAT_READ } = require('./name-colour-render/lib/profile/name-colours.js');
const { contrastRatio } = require('./name-colour-render/lib/ui/colour.js');

const LIGHT_FIELDS = ['#ffffff', '#e1ff00'];
const DARK_FIELD = '#1a1525';

for (const swatch of NAME_COLOURS) {
  assert.match(swatch.dark, /^#[0-9a-f]{6}$/, `${swatch.label} has a dark counterpart`);
}

for (const swatch of NAME_COLOURS_THAT_READ) {
  for (const field of LIGHT_FIELDS) {
    const ratio = contrastRatio(swatch.hex, field);
    assert.ok(ratio >= 4.5, `${swatch.label} reads on the light field (${field}): ${ratio.toFixed(2)}:1`);
  }

  const onDark = contrastRatio(swatch.dark, DARK_FIELD);
  assert.ok(onDark >= 4.5, `${swatch.label} reads on the dark field as ${swatch.dark}: ${onDark.toFixed(2)}:1`);
}

assert.deepEqual(
  NAME_COLOURS_THAT_READ.map((swatch) => swatch.id),
  ['black', 'nigrosine', 'royal-blue', 'red', 'orange', 'gold', 'brown', 'green', 'teal', 'sky', 'violet', 'orchid'],
  'the INK row is the three dyes that read wherever the field is, each restated in the dark theme',
);

// 5b. (Luke, 2026-11-06.) A swatch says what it draws, and the group offered as reading on every theme does, on all five.
const { nameColourPairLabel, nameColourWords, nameOnThemes, profileNameColour } = require('./name-colour-render/lib/profile/name-colours.js');
const { THEMES } = require('./name-colour-render/lib/ui/themes.js');
const { moduleSwatches, moduleInk } = require('./name-colour-render/lib/ui/modules.js');

assert.deepEqual(
  NAME_COLOURS.map((swatch) => swatch.id),
  ['black', 'nigrosine', 'royal-blue', 'emerald', 'rose', 'brilliant-pink', 'flavine', 'daffodil', 'red', 'orange', 'gold', 'brown', 'green', 'teal', 'sky', 'violet', 'orchid'],
  'the stored ids have not moved: user_modules holds them',
);
assert.deepEqual(
  NAME_COLOURS.slice(0, 8).map((swatch) => swatch.hex),
  ['#000000', '#1a1525', '#1d3ca6', '#28c745', '#e6004c', '#ff00a0', '#e1ff00', '#fff000'],
  'nor have the stored values: profiles hold those',
);
for (const swatch of NAME_COLOURS) {
  const named = NAME_COLOURS.find((other) => other.hex === swatch.dark);
  // Two different colours name both; two shades of one hue are one name (Rose and the second batch).
  if (swatch.darkLabel === undefined) assert.equal(nameColourPairLabel(swatch), swatch.label, swatch.label + ' has one name');
  else assert.ok(nameColourPairLabel(swatch).startsWith(swatch.label + ' / '), swatch.label + ' draws two colours, and names both');
  if (swatch.darkLabel && named) assert.ok(named.label.startsWith(swatch.darkLabel), swatch.label + ' second name is the colour it draws');
}
assert.equal(nameColourWords(''), 'SITE COLOUR');
assert.equal(nameColourWords('#1d3ca6'), 'ROYAL BLUE / DAFFODIL');

assert.equal(THEMES.length, 5, 'every theme is asked about, not only the two the older arithmetic knows');
for (const swatch of NAME_COLOURS_THAT_READ) {
  for (const theme of nameOnThemes(swatch.hex)) assert.ok(theme.readable, swatch.label + ' reads on ' + theme.label);
}
for (const theme of nameOnThemes('')) assert.ok(theme.readable, 'the site colour reads on ' + theme.label);
for (const theme of THEMES) {
  const shown = nameOnThemes('#000000').find((entry) => entry.id === theme.id);
  assert.equal(shown.value, theme.scheme === 'dark' ? '#ffffff' : '#000000', 'the strip draws what .name-ink draws on ' + theme.label);
  assert.equal(shown.readable, contrastRatio(shown.value, theme.tokens['sun-pale']) >= 4.5);
}
// The edge. Changed on purpose 2026-11-14 (Luke: "for usernames on different themes where they need it to be readable with their selected
// colour opt for a border instead of a bar"; confirmed in the main session: "Outline the letters"). From 2026-11-06 a faded colour sat on
// a Black strip on a bright theme (`.name-strip`, `nameColourWearsStrip`, `theme.strip`). Now each of its letters has a hard one-pixel
// Black outline (`.name-edge`, `nameColourWearsEdge`, `theme.edge`) and no box behind the name. What "readable" means for an edged name:
// the edge reads on the window (the letter's shape), and the letter reads on its edge (its colour). Both are held at 4.5:1 below.
const { nameColourWearsEdge } = require('./name-colour-render/lib/profile/name-colours.js');
for (const swatch of NAME_COLOURS) {
  for (const theme of nameOnThemes(swatch.hex)) {
    assert.ok(theme.readable, swatch.label + ' reads on ' + theme.label + ': ' + contrastRatio(theme.value, theme.edge ?? theme.field).toFixed(2) + ':1');
  }
}
// All seventeen, on both surfaces a name is read on, in all five themes: the real values, not by eye.
for (const swatch of NAME_COLOURS) {
  for (const theme of THEMES) {
    const edged = theme.scheme === 'light' && nameColourWearsEdge(swatch.hex);
    const value = theme.scheme === 'dark' || nameColourWearsEdge(swatch.hex) ? swatch.dark : swatch.hex;
    for (const field of [theme.tokens['sun-pale'], theme.tokens.paper]) {
      if (edged) {
        const shape = contrastRatio(theme.tokens.hardware, field);
        const colour = contrastRatio(value, theme.tokens.hardware);
        assert.ok(shape >= 4.5, swatch.label + "'s edge on " + theme.label + ' (' + field + '): ' + shape.toFixed(2) + ':1');
        assert.ok(colour >= 4.5, swatch.label + ' inside its edge on ' + theme.label + ': ' + colour.toFixed(2) + ':1');
      } else {
        const ratio = contrastRatio(value, field);
        assert.ok(ratio >= 4.5, swatch.label + ' on ' + theme.label + ' (' + field + '): ' + ratio.toFixed(2) + ':1');
      }
    }
  }
}
assert.ok(nameOnThemes('#e6004c').every((theme, index) => theme.value !== nameOnThemes('#ff00a0')[index].value), 'Rose is its own colour again on every theme');
for (const swatch of NAME_COLOURS) {
  assert.equal(nameColourWearsEdge(swatch.hex), !NAME_COLOURS_THAT_READ.includes(swatch), swatch.label + ' is outlined only if it would fade');
  for (const theme of nameOnThemes(swatch.hex)) {
    const light = THEMES.find((entry) => entry.id === theme.id).scheme === 'light';
    assert.equal(theme.edge !== null, light && nameColourWearsEdge(swatch.hex), swatch.label + ' on ' + theme.label + ': an edge on bright themes only');
    if (theme.edge !== null) assert.equal(theme.value, swatch.dark, swatch.label + ' takes its dark reading inside the edge, as .name-edge draws it');
    assert.equal('strip' in theme, false, 'and nothing reports a strip any more');
  }
}
const flavineName = withProviders(element(ProfileName, { author: { id: 'user-x', displayName: 'x' }, colour: '#e1ff00' }));
assert.match(flavineName, /class="name-ink name-edge"/, 'a faded name is drawn with the edge');
assert.doesNotMatch(flavineName, /name-strip/, 'and not with the strip');
const blueName = withProviders(element(ProfileName, { author: { id: 'user-x', displayName: 'x' }, colour: '#1d3ca6' }));
assert.doesNotMatch(blueName, /name-edge|name-strip/, 'and a name that reads on its own wears neither');
const css = require('node:fs').readFileSync('app/globals.css', 'utf8').replace(/\r\n/g, '\n');
const edgeRule = /:root\[data-scheme='light'\] \.name-edge \{([^}]*)\}/.exec(css);
assert.ok(edgeRule, 'the edge belongs to bright themes only');
assert.match(edgeRule[1], /--edge: var\(--color-hardware\)/, 'and is the colour the arithmetic above asked about');
assert.match(edgeRule[1], /color: var\(--name-ink-dark, var\(--name-ink\)\)/, 'and draws the reading the arithmetic above asked about');
// Each copy is `x y blur colour`: x and y are 0, 1px or -1px, and the blur is 0.
const copies = edgeRule[1].match(/(?:-?\d+px|0) (?:-?\d+px|0) \S+ var\(--edge\)/g) ?? [];
assert.equal(new Set(copies).size, 8, 'eight copies of the letters, one pixel out in each direction: an edge all the way round');
assert.ok(copies.every((copy) => /^(-?1px|0) (-?1px|0) 0 /.test(copy)), 'each one pixel out and with no blur: a hard edge');
assert.doesNotMatch(edgeRule[1], /background/, 'and no box behind the name: the bar is gone');
assert.doesNotMatch(css, /\.name-strip/, 'the strip rule is gone from the stylesheet');
assert.doesNotMatch(css, /^\.name-edge/m, 'nothing draws the edge on a dark theme');
assert.match(css, /\.name-glow:hover \.name-edge \{\s*text-shadow: none;/, 'and a lit directory row, whose name takes the row\'s own ink, has no edge');
for (const file of ['app/components/ProfileName.tsx', 'app/components/NameColourWindow.tsx', 'app/components/ProfileCustomiserOptionsTabs.tsx']) {
  assert.doesNotMatch(require('node:fs').readFileSync(file, 'utf8'), /name-strip|WearsStrip/, file + ' no longer asks for the strip');
}
assert.equal(profileNameColour({ nameColour: '#800000' }), undefined, 'a colour since taken off the swatch counts as none');

// MODULOS: the label beside the square is the colour in the square.
const darkBar = THEMES.find((theme) => theme.id === 'dark').tokens['sun-pale'];
const offered = moduleSwatches(darkBar, undefined);
assert.deepEqual(
  offered.map((swatch) => swatch.label),
  ['WHITE', 'FLAVINE', 'DAFFODIL', 'EMERALD', 'ROSE', 'BRILLIANT PINK', 'RED', 'ORANGE', 'GOLD', 'BROWN', 'GREEN', 'TEAL', 'SKY', 'VIOLET', 'ORCHID'],
  'on the dark bar each swatch is named for what it draws',
);
assert.deepEqual(offered.slice(0, 5).map((swatch) => swatch.id), ['black', 'nigrosine', 'royal-blue', 'emerald', 'rose'], 'and still stores the same ids');
for (const theme of THEMES) {
  const bar = theme.tokens['sun-pale'];
  for (const swatch of moduleSwatches(bar, undefined)) assert.ok(contrastRatio(swatch.ink, bar) >= 4.5, swatch.label + ' reads on the ' + theme.label + ' bar');
  assert.ok(moduleSwatches(bar, undefined).some((swatch) => swatch.id === 'teal'), 'and the new colours reach MODULOS on ' + theme.label);
}
assert.equal(moduleInk('black', darkBar), '#ffffff');
const brightBar = THEMES.find((theme) => theme.id === 'default').tokens['sun-pale'];
assert.equal(moduleSwatches(brightBar, undefined)[0].label, 'BLACK', 'and BLACK where it draws black');

// The module you are on (Luke, 2026-11-14: "the selected text colour is constant and ... becomes just a little bit highlighter"): its
// word in its picked colour over a pale stroke of that colour. On every theme, for every colour a person can pick, the word reads on
// the bar and on its own stroke; where the colour as picked could not, the word is stepped towards white or black and keeps its hue.
const { moduleMark, moduleMarkFrom, mixHex, SWIPE_SHARE } = require('./name-colour-render/lib/ui/modules.js');
assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080', 'colours mix as the stylesheet mixes them');
let stepped = 0;
let tightest = 99;
for (const theme of THEMES) {
  const bar = theme.tokens['sun-pale'];
  // Every colour on the swatch, not only those MODULOS offers on this theme: a pick made on another theme still has to show here.
  for (const colour of NAME_COLOURS) {
    const offeredHere = moduleSwatches(bar, undefined).find((entry) => entry.id === colour.id);
    const swatch = { label: colour.label, ink: offeredHere?.ink ?? moduleInk(colour.id, bar) ?? (contrastRatio(colour.hex, bar) >= contrastRatio(colour.dark, bar) ? colour.hex : colour.dark) };
    const mark = moduleMark(colour.id, bar);
    assert.ok(mark !== null, swatch.label + ' has a mark on ' + theme.label);
    // The stroke is a pale tint of the picked colour on the bar, or of the word itself where the pick is too near the bar's own colour to show.
    assert.ok([mixHex(bar, swatch.ink, SWIPE_SHARE), mixHex(bar, mark.word, SWIPE_SHARE)].includes(mark.swipe), swatch.label + "'s stroke on " + theme.label + ' is a pale tint of its colour');
    assert.notEqual(mark.swipe, bar, 'and can be seen');
    const onBar = contrastRatio(mark.word, bar);
    const onStroke = contrastRatio(mark.word, mark.swipe);
    assert.ok(onBar >= 4.5, swatch.label + ' word on the ' + theme.label + ' bar: ' + onBar.toFixed(2) + ':1');
    assert.ok(onStroke >= 4.5, swatch.label + ' word on its stroke on ' + theme.label + ': ' + onStroke.toFixed(2) + ':1');
    assert.ok(contrastRatio(mark.swipe, bar) >= 1.15, swatch.label + "'s stroke stands off the " + theme.label + ' bar: ' + contrastRatio(mark.swipe, bar).toFixed(2) + ':1');
    if (mark.word !== swatch.ink) stepped += 1;
    tightest = Math.min(tightest, onBar, onStroke);
  }
  assert.equal(moduleMark(undefined, bar), null, 'no colour picked: no mark of its own, the stylesheet pair stands');
  // That pair, as globals.css writes it: the field ink for the word, 34% of the accent ink on the bar for the stroke.
  const plain = moduleMarkFrom(theme.tokens.ink, theme.tokens['accent-ink'], bar);
  assert.equal(plain.word, theme.tokens.ink, 'with no colour picked the field ink needs no help on ' + theme.label);
  assert.ok(contrastRatio(theme.tokens.ink, plain.swipe) >= 4.5, 'and reads on the site stroke on ' + theme.label + ': ' + contrastRatio(theme.tokens.ink, plain.swipe).toFixed(2) + ':1');
}
const moduleCss = require('node:fs').readFileSync('app/globals.css', 'utf8');
assert.ok(moduleCss.includes('color-mix(in srgb, var(--color-accent-ink) ' + Math.round(SWIPE_SHARE * 100) + '%, var(--color-sun-pale))'), 'the stylesheet mixes the site stroke at the same share the arithmetic used');
assert.match(moduleCss, /\.key\.module-on,[\s\S]{0,200}color: var\(--module-word, var\(--color-ink\)\)/, 'and draws the word in the worked-out colour');
assert.doesNotMatch(moduleCss, /module-glow/, 'the halo is gone');
console.log('  modules   : the selected word reads on the bar and on its stroke for every pick on every theme (tightest ' + tightest.toFixed(2) + ':1; ' + stepped + ' picks stepped towards white or black)');

// 6. A row that arrives with no name at all - a hand-made row, or a column a select skipped -
//    reads as the anonymous default instead of taking the page down with it.
const { authorLabel, authorTag } = require('./name-colour-render/lib/auth/author.js');
assert.equal(authorLabel({ id: 'user-x', displayName: '' }), 'Anonymous', 'a blank name reads as anonymous');
assert.equal(authorLabel({ id: 'user-x', displayName: '   ' }), 'Anonymous', 'and so does whitespace');
assert.equal(authorLabel({ id: 'user-x' }), 'Anonymous', 'and a name that is not there at all');
assert.equal(authorLabel({ id: 'user-x', displayName: 'amy' }), 'amy', 'a real name is left alone');
assert.equal(authorTag({ id: 'user-x' }), 'Anonymous (account)', 'the tag says which kind of author it is');

console.log('name colour checks passed');
console.log('  name     :', named);
console.log('  activity :', activity.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
console.log('  comms    :', panel.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160));
