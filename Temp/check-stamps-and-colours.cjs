/*
 * Scratch check for the stamps and the username swatch (run from the root):
 *   npx tsc app/lib/forum/format.ts app/lib/profile/name-colours.ts app/lib/profile/visibility.ts app/lib/profile/mock-profile-repository.ts --outDir Temp/check-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/TimeStamp.tsx app/components/PostAuthorRow.tsx app/components/ProfileCustomiserOptionsTabs.tsx --outDir Temp/render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-stamps-and-colours.cjs
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { formatStamp } = require('./check-out/forum/format.js');
const {
  LOW_CONTRAST_NAME_COLOURS,
  NAME_COLOURS,
  NAME_COLOURS_THAT_GLOW,
  NAME_COLOURS_THAT_READ,
  isNameColour,
  nameColourContrast,
  nameColourLabel,
  profileNameColour,
} = require('./check-out/profile/name-colours.js');
const { validateNameColour } = require('./check-out/profile/visibility.js');
const { getMockProfileRepository } = require('./check-out/profile/mock-profile-repository.js');
const TimeStamp = require('./render-out/components/TimeStamp.js').default;
const PostAuthorRow = require('./render-out/components/PostAuthorRow.js').default;
const AuthProvider = require('./render-out/components/AuthProvider.js').default;
const PresenceProvider = require('./render-out/components/PresenceProvider.js').default;
const { ProfileIdentityTab } = require('./render-out/components/ProfileCustomiserOptionsTabs.js');

const element = React.createElement;

/** PostAuthorRow draws the presence lamp, so it needs the providers around it. */
const withProviders = (child) =>
  renderToStaticMarkup(element(AuthProvider, null, element(PresenceProvider, null, child)));

// 1. Stamps: UTC to the minute, no trailing Z, in the swatch's blue.
assert.equal(formatStamp('2026-09-21T04:39:52.000Z'), '2026-09-21 04:39');
assert.equal(formatStamp('nonsense'), 'nonsense', 'an unreadable stamp is passed through');
assert.ok(!formatStamp(new Date().toISOString()).endsWith('Z'));

// What Supabase sends: the instant as Postgres stores it, not as the spec spells
// it. A directory row has to read `2026-09-21 07:30`, never a wall of ISO.
assert.equal(formatStamp('2026-09-21T07:30:44.427944+00:00'), '2026-09-21 07:30', 'microseconds');
assert.equal(formatStamp('2026-09-21 07:30:44.427944+00:00'), '2026-09-21 07:30', 'a space instead of the T');
assert.equal(formatStamp('2026-09-21T07:30:44.427+00:00'), '2026-09-21 07:30');
assert.equal(formatStamp('2026-09-21T07:30:44+0000'), '2026-09-21 07:30', 'an offset with no colon');
assert.equal(formatStamp('2026-09-21T09:30:44.427944+02:00'), '2026-09-21 07:30', 'read as the instant it names');
assert.equal(formatStamp('2026-09-21T07:30:44.427944Z'), '2026-09-21 07:30');

const stampHtml = renderToStaticMarkup(element(TimeStamp, { at: '2026-09-21T04:39:52.000Z' }));
assert.match(stampHtml, /text-accent-ink\b/, 'the stamp is drawn in the brand ink, as a token');
assert.match(stampHtml, /2026-09-21 04:39/);
assert.doesNotMatch(stampHtml, /04:39:/, 'no seconds, no Z');

// A stamp that is not there at all: a hand-made row, or a column a select skipped. It reads
// as unknown rather than throwing, which is what one blank column used to do to a whole page.
assert.equal(formatStamp(undefined), '--:--', 'a missing stamp reads as unknown');
assert.equal(formatStamp(null), '--:--');
assert.equal(formatStamp(''), '--:--');
assert.equal(formatStamp('   '), '--:--');
assert.match(renderToStaticMarkup(element(TimeStamp, { at: undefined })), /--:--/);

// 2. The swatch: the eight dyes, no duplicates, and only those.
assert.equal(NAME_COLOURS.length, 8);
assert.equal(new Set(NAME_COLOURS.map((colour) => colour.hex)).size, 8, 'every dye is distinct');
assert.equal(NAME_COLOURS[0].hex, '#000000');
assert.equal(NAME_COLOURS[7].hex, '#fff000');
assert.equal(isNameColour('#ff00a0'), true, 'Brilliant Pink is on the swatch');
assert.equal(isNameColour('#123456'), false, 'an off-swatch colour is refused');
assert.equal(isNameColour('#ffff00'), false, 'and so is a yellow the dye pot does not hold');

// The two rows the picker draws are *derived from the arithmetic*, not written down by hand: a
// swatch is INK if a name written in it reads on the page, and GLOW if the page shows through it.
// (The list this replaced named four colours by hand and the numbers disagreed with it.)
assert.equal(
  NAME_COLOURS_THAT_READ.length + NAME_COLOURS_THAT_GLOW.length,
  NAME_COLOURS.length,
  'every swatch is in one row or the other',
);

for (const colour of NAME_COLOURS_THAT_READ) {
  assert.ok(
    nameColourContrast(colour.hex) >= 4.5,
    `${colour.label} reads on the page (${nameColourContrast(colour.hex).toFixed(2)}:1)`,
  );
}

for (const colour of NAME_COLOURS_THAT_GLOW) {
  assert.ok(
    nameColourContrast(colour.hex) < 4.5,
    `${colour.label} is meant to glow (${nameColourContrast(colour.hex).toFixed(2)}:1)`,
  );
}

assert.deepEqual(
  LOW_CONTRAST_NAME_COLOURS,
  NAME_COLOURS_THAT_GLOW.map((colour) => colour.hex),
  'and the "hard to read" list is the glow row, by definition rather than by memory',
);
assert.ok(NAME_COLOURS_THAT_READ.length >= 3, 'at least the three dark dyes read on the page');
assert.ok(NAME_COLOURS_THAT_GLOW.length >= 5, 'and the saturated half of the palette is still offered');

assert.equal(profileNameColour({ nameColour: '#1d3ca6' }), '#1d3ca6');
assert.equal(profileNameColour({ nameColour: '#123456' }), undefined, 'a hand-edited colour is ignored');
assert.equal(profileNameColour({}), undefined);
assert.equal(profileNameColour(null), undefined);
assert.equal(nameColourLabel('#1d3ca6'), 'ROYAL BLUE');
assert.equal(nameColourLabel(''), 'DEFAULT');

assert.equal(validateNameColour(''), undefined, 'empty means default');
assert.equal(validateNameColour('#28c745'), undefined);
assert.equal(typeof validateNameColour('#123456'), 'string', 'off-swatch colours are rejected');

// 3. The store: a chosen swatch round-trips, and '' puts the default back.
(async () => {
  const repository = getMockProfileRepository();

  await repository.saveProfile('user-colour', { displayName: 'sweden', nameColour: '#ff00a0' });
  assert.equal((await repository.getProfile('user-colour')).nameColour, '#ff00a0');

  await repository.saveProfile('user-colour', { bio: 'figure studies' });
  assert.equal(
    (await repository.getProfile('user-colour')).nameColour,
    '#ff00a0',
    'saving the rest of the form keeps the colour',
  );

  await repository.saveProfile('user-colour', { nameColour: '' });
  assert.equal((await repository.getProfile('user-colour')).nameColour, undefined);

  await assert.rejects(() => repository.saveProfile('user-colour', { nameColour: '#123456' }));

  // 4. Rendered markup: the colour reaches the post header and the picker.
  const rowHtml = withProviders(
    element(PostAuthorRow, {
      author: { id: 'user-colour', displayName: 'sweden' },
      avatar: 'hidden',
      nameColour: '#ff0000',
    }),
  );
  assert.match(rowHtml, /--name-ink:#ff0000/, 'the username carries the swatch');
  assert.match(rowHtml, /sweden/);

  const plainRow = withProviders(
    element(PostAuthorRow, { author: { id: null, displayName: '' }, avatar: 'hidden' }),
  );
  assert.doesNotMatch(plainRow, /color:/, 'no colour means the page default');

  const tabHtml = renderToStaticMarkup(
    element(ProfileIdentityTab, {
      profile: { displayName: 'sweden' },
      name: 'sweden',
      bio: '',
      country: '',
      status: '',
      nameColour: '#fff000',
      onNameChange: () => undefined,
      onBioChange: () => undefined,
      onCountryChange: () => undefined,
      onStatusChange: () => undefined,
      onNameColourChange: () => undefined,
      onSave: () => undefined,
      busy: false,
      bioProblem: undefined,
      countryProblem: undefined,
      statusProblem: undefined,
    }),
  );
  assert.equal((tabHtml.match(/aria-pressed/g) ?? []).length, 8, 'the picker shows the eight dyes');
  assert.match(tabHtml, /color:#fff000/, 'and previews the chosen dye');
  assert.match(tabHtml, /PREVIEW :: DAFFODIL YELLOW/);

  // the picker itself: eight dyes drawn as keys on neutral chips in two derived rows, not as
  // eight blocks of colour - and each one a thumb's height on a phone.
  // (2026-10-25, SPEC-less-text.md) The row heads are `INK` and `GLOW` (were `INK :: A NAME THE PAGE CANNOT
  // SWALLOW` / `GLOW :: A NAME THE PAGE SHOWS THROUGH`); what the two mean moved into the `[ ? ]` fold
  // (InfoFold, topic "name colours") under NAME COLOUR, replacing the label's hover tip.
  assert.equal((tabHtml.match(/>INK<\/p>/g) ?? []).length, 1, 'the readable dyes are one row');
  assert.equal((tabHtml.match(/>GLOW<\/p>/g) ?? []).length, 1, 'and the bright ones another');
  assert.doesNotMatch(tabHtml, /A NAME THE PAGE CANNOT SWALLOW|A NAME THE PAGE SHOWS THROUGH/, 'with short heads');
  const colourFold = (tabHtml.match(/<details[^>]*>(?:(?!<\/details>)[\s\S])*aria-label="About name colours"[\s\S]*?<\/details>/) ?? [''])[0];
  assert.match(colourFold, /\[ \? \]/, 'the INK / GLOW explanation sits behind a [ ? ] key');
  assert.match(colourFold, /INK READS IN EITHER THEME[\s\S]*GLOW IS HARD TO READ ON PURPOSE/, 'and says what each row means, inside the fold');
  assert.doesNotMatch(tabHtml, /title="AN INK SWATCH IS/, 'no longer as a hover tip a phone never shows');
  assert.doesNotMatch(tabHtml, /PICK ONE OF THE EIGHT DYES/, 'and the label no longer miscounts the swatches');
  assert.equal(
    (tabHtml.match(/background-color/g) ?? []).length,
    8,
    'every dye is a key of the colour rather than a block of it',
  );
  assert.ok(
    (tabHtml.match(/max-sm:min-h-tap/g) ?? []).length >= 8,
    'and the dyes are thumb-sized on a phone (the tab`s plates carry it too)',
  );
  // The number in the tooltip is now the *worst of both themes* rather than the light theme's own, and
  // the wording says so: Daffodil is 1.19:1 on White and 15.04:1 on the dark field, and a reader picking
  // a name has to be told the first number, because the light theme is the one it fails in.
  // (2026-10-25, SPEC-less-text.md) Each swatch's tip (`DAFFODIL YELLOW :: 1.2:1 wherever the name is read`)
  // repeated the name drawn on the key, plus a ratio: cut. The key names itself; the INK / GLOW rows (built
  // from the same contrast arithmetic, app/lib/profile/name-colours.ts) are what say whether a dye reads.
  assert.doesNotMatch(tabHtml, /wherever the name is read/, 'the swatches carry no ratio tip');
  assert.match(tabHtml, /<button[^>]*aria-pressed="(true|false)"[^>]*>(?:(?!<\/button>)[\s\S])*DAFFODIL YELLOW<\/button>/, 'and each key names its dye on its face');

  console.log('stamp + swatch checks passed');
  console.log('  stamp  :', formatStamp('2026-09-21T04:39:52.000Z'), '->', "text-[#0000ff]");
  console.log('  swatches:', NAME_COLOURS.length, '::', NAME_COLOURS.map((colour) => colour.label).join(' '));
  console.log('  header :', rowHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
