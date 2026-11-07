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
assert.match(activity, /NOTHING YET\./, 'the empty board activity says so in two words');
assert.doesNotMatch(activity, /HAS NOT FILED/, 'not as a sentence');
assert.doesNotMatch(activity, />sweden<|>SWEDEN</, 'and draws no name, so none can lose its colour');
assert.doesNotMatch(activity, LAMP);

const plainActivity = withProviders(
  element(ProfileBoardActivity, { userId: 'user-luke', displayName: 'luke', threads: [] }),
);
assert.doesNotMatch(plainActivity, /--name-ink/, 'an account with no swatch stays the page black');
assert.match(plainActivity, /NOTHING YET\./);

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
  ['black', 'nigrosine', 'royal-blue'],
  'the INK row is the three dyes that read wherever the field is, each restated in the dark theme',
);

// 5b. (Luke, 2026-11-06.) A swatch says what it draws, and the group offered as reading on every theme does, on all five.
const { nameColourPairLabel, nameColourWords, nameOnThemes, profileNameColour } = require('./name-colour-render/lib/profile/name-colours.js');
const { THEMES } = require('./name-colour-render/lib/ui/themes.js');
const { moduleSwatches, moduleInk } = require('./name-colour-render/lib/ui/modules.js');

assert.deepEqual(
  NAME_COLOURS.map((swatch) => swatch.id),
  ['black', 'nigrosine', 'royal-blue', 'emerald', 'rose', 'brilliant-pink', 'flavine', 'daffodil'],
  'the stored ids have not moved: user_modules holds them',
);
assert.deepEqual(
  NAME_COLOURS.map((swatch) => swatch.hex),
  ['#000000', '#1a1525', '#1d3ca6', '#28c745', '#e6004c', '#ff00a0', '#e1ff00', '#fff000'],
  'nor have the stored values: profiles hold those',
);
for (const swatch of NAME_COLOURS) {
  const named = NAME_COLOURS.find((other) => other.hex === swatch.dark);
  if (swatch.dark === swatch.hex) assert.equal(nameColourPairLabel(swatch), swatch.label, swatch.label + ' draws one colour, and has one name');
  else assert.ok(swatch.darkLabel && nameColourPairLabel(swatch).startsWith(swatch.label + ' / '), swatch.label + ' draws two colours, and names both');
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
// The strip (Luke, 2026-11-06): every choice reads on every theme now, and a faded colour keeps its colour on a bright one.
const { nameColourWearsStrip } = require('./name-colour-render/lib/profile/name-colours.js');
for (const swatch of NAME_COLOURS) {
  for (const theme of nameOnThemes(swatch.hex)) {
    assert.ok(theme.readable, swatch.label + ' reads on ' + theme.label + ': ' + contrastRatio(theme.value, theme.strip ?? theme.field).toFixed(2) + ':1');
  }
}
for (const swatch of NAME_COLOURS) {
  assert.equal(nameColourWearsStrip(swatch.hex), !NAME_COLOURS_THAT_READ.includes(swatch), swatch.label + ' wears the strip only if it would fade');
  for (const theme of nameOnThemes(swatch.hex)) {
    const light = THEMES.find((entry) => entry.id === theme.id).scheme === 'light';
    assert.equal(theme.strip !== null, light && nameColourWearsStrip(swatch.hex), swatch.label + ' on ' + theme.label + ': a strip on bright themes only');
    if (theme.strip !== null) assert.equal(theme.value, swatch.dark, swatch.label + ' takes its dark reading on the strip, as .name-strip draws it');
  }
}
const flavineName = withProviders(element(ProfileName, { author: { id: 'user-x', displayName: 'x' }, colour: '#e1ff00' }));
assert.match(flavineName, /class="name-ink name-strip"/, 'a faded name is drawn with the strip');
const blueName = withProviders(element(ProfileName, { author: { id: 'user-x', displayName: 'x' }, colour: '#1d3ca6' }));
assert.doesNotMatch(blueName, /name-strip/, 'and a name that reads on its own is not');
const css = require('node:fs').readFileSync('app/globals.css', 'utf8').replace(/\r\n/g, '\n');
const stripRule = /:root\[data-scheme='light'\] \.name-strip \{([^}]*)\}/.exec(css);
assert.ok(stripRule, 'the strip belongs to bright themes only');
assert.match(stripRule[1], /background-color: var\(--color-hardware\)/, 'and is the colour the arithmetic above asked about');
assert.match(stripRule[1], /color: var\(--name-ink-dark, var\(--name-ink\)\)/, 'and draws the reading the arithmetic above asked about');
assert.doesNotMatch(css, /^\.name-strip/m, 'nothing draws it on a dark theme');
assert.match(css, /\.name-glow:hover \.name-strip \{\s*background-color: transparent;/, 'and a lit directory row has no dark box on it');
assert.equal(profileNameColour({ nameColour: '#800000' }), undefined, 'a colour since taken off the swatch counts as none');

// MODULOS: the label beside the square is the colour in the square.
const darkBar = THEMES.find((theme) => theme.id === 'dark').tokens['sun-pale'];
const offered = moduleSwatches(darkBar, undefined);
assert.deepEqual(
  offered.map((swatch) => swatch.label),
  ['WHITE', 'FLAVINE', 'DAFFODIL', 'EMERALD', 'BRILLIANT PINK'],
  'on the dark bar each swatch is named for what it draws',
);
assert.deepEqual(offered.map((swatch) => swatch.id), ['black', 'nigrosine', 'royal-blue', 'emerald', 'rose'], 'and still stores the same ids');
assert.equal(moduleInk('black', darkBar), '#ffffff');
const brightBar = THEMES.find((theme) => theme.id === 'default').tokens['sun-pale'];
assert.equal(moduleSwatches(brightBar, undefined)[0].label, 'BLACK', 'and BLACK where it draws black');

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
