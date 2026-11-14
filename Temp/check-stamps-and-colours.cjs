/*
 * Scratch check for the stamps and the username swatch (run from the root):
 *   npx tsc app/lib/forum/format.ts app/lib/profile/name-colours.ts app/lib/profile/visibility.ts app/lib/profile/mock-profile-repository.ts --outDir Temp/check-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/TimeStamp.tsx app/components/PostAuthorRow.tsx app/components/ProfileCustomiserOptionsTabs.tsx app/components/NameColourWindow.tsx --outDir Temp/render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
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
assert.equal(NAME_COLOURS.length, 17, 'the eight dyes and nine more (Luke, 2026-11-07)');
assert.equal(new Set(NAME_COLOURS.map((colour) => colour.hex)).size, 17, 'every colour is distinct');
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
      bioProblem: undefined,
      countryProblem: undefined,
      statusProblem: undefined,
    }),
  );
  // (Changed on purpose, Luke 2026-11-07: "make the username colour chooser a pop up that opens when you click change colour
  // next to where you input your profile name".) The tab has the key and the name as it stands; the rows are in the window.
  assert.match(tabHtml, /\[ CHANGE COLOUR \]/, 'the key is in the tab');
  assert.ok(tabHtml.indexOf('[ CHANGE COLOUR ]') > tabHtml.indexOf('id="customise-name"') && tabHtml.indexOf('[ CHANGE COLOUR ]') < tabHtml.indexOf('id="customise-country"'), 'next to the name field');
  assert.match(tabHtml, /aria-haspopup="dialog"/, 'and says it opens a window');
  assert.doesNotMatch(tabHtml, /aria-pressed/, 'the swatches are not in the tab any more');
  assert.match(tabHtml, /DAFFODIL YELLOW/, 'but the colour in force is named');
  assert.doesNotMatch(tabHtml, /\[ SAVE \]/, 'the save key is in the window foot now, not here');

  const { NameColourChooser } = require('./render-out/components/NameColourWindow.js');
  const chooser = (hex) => renderToStaticMarkup(element(NameColourChooser, { hex, sample: 'sweden', onChoose: () => undefined }));
  const chooserHtml = chooser('#fff000');
  assert.equal((chooserHtml.match(/aria-pressed/g) ?? []).length, 18, 'the seventeen colours and the way back to none');
  assert.equal((chooserHtml.match(/aria-pressed="true"/g) ?? []).length, 1, 'with one picked');
  assert.match(chooserHtml, /color:#fff000/, 'and previews the chosen dye');
  assert.match(chooserHtml, /<button[^>]*aria-pressed="true"[^>]*aria-label="DAFFODIL YELLOW"[^>]*>(?:(?!<\/button>)[\s\S])*\[ ✓ \]/, 'marked by a tick, not by colour alone');
  assert.equal((chooserHtml.match(/\[ ✓ \]/g) ?? []).length, 1, 'and only the picked one has it');
  assert.match(chooserHtml, /aria-label="SITE COLOUR"/, 'the site colour is a choice, so a colour can be taken off again');
  assert.match(chooserHtml, /aria-label="BLACK \/ WHITE"/, 'a dye that draws two colours says both');
  assert.match(chooserHtml, /aria-label="TEAL"/, 'and the new colours are there');
  assert.match(chooserHtml, />READS ON ITS OWN<\/p>/, 'the readable colours are one group');
  // Changed on purpose 2026-11-14 (Luke: "opt for a border instead of a bar"): those colours are outlined now, so the group says so.
  // It was `DARK STRIP ON BRIGHT THEMES`.
  assert.match(chooserHtml, />OUTLINED ON BRIGHT THEMES<\/p>/, 'and the bright ones another');
  assert.doesNotMatch(chooserHtml, /DARK STRIP/, 'named for the outline, not the strip that went');
  assert.doesNotMatch(chooserHtml, />INK<\/p>|>GLOW<\/p>|PREVIEW ::/, 'the old heads and the readback are gone');
  assert.equal((chooserHtml.match(/>sweden<\/span>/g) ?? []).length, 18 + 5, 'the reader own name beside each choice and on all five themes');
  for (const colour of NAME_COLOURS) assert.doesNotMatch(chooser(colour.hex), /HARD TO READ/, colour.label + ' reads on every theme, so nothing warns');

  console.log('stamp + swatch checks passed');
  console.log('  stamp  :', formatStamp('2026-09-21T04:39:52.000Z'), '->', "text-[#0000ff]");
  console.log('  swatches:', NAME_COLOURS.length, '::', NAME_COLOURS.map((colour) => colour.label).join(' '));
  console.log('  header :', rowHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
