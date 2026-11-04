/*
 * Scratch check for the closed country list and the flag slot that draws it.
 *
 * **What it is for: the list is 249 strings a person typed, so the list itself is the thing that can
 * be wrong.** A duplicate code, a lower-case one, a code this machine's ICU has no name for, or a pair
 * that is not two letters at all would each fail quietly: a `select` with two identical options, a
 * flag path that 404s for a country ICU knows, a lookup that never matches. None of those is visible
 * by reading the file, and all of them are properties, so they are asserted here rather than assumed.
 *
 * **It drives the module, not a copy of the list.** An earlier probe carried its own copy of the
 * codes, which is a check that cannot fail when the module and the check drift apart - the same fault
 * `check-music-library.cjs` records about a declared href nobody read. This compiles
 * `app/lib/profile/countries.ts` and asks it.
 *
 * **And it holds the two rules the list cannot be by itself:**
 *   - the pair `(code, name)` is one-to-one, so a picker cannot offer the same country twice and
 *     `countryName` cannot answer two ways for one country;
 *   - a pseudo-code is *not* a country here. ICU knows `XK` (Kosovo), `EU`, `AC`, `QO` and `XA`/`XB`,
 *     and the site refuses every one of them, because a flag is chosen from a closed list and a
 *     value in a database column should be an auditable one.
 *
 * Steps: the runner matches the `npx tsc ` prefix literally, inside this block.
 *   npx tsc app/lib/profile/countries.ts --outDir Temp/country-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  COUNTRY_CODES,
  NO_COUNTRY,
  countryFlagPath,
  countryName,
  countryOptions,
  isCountryCode,
  normalizeCountryCode,
} = require('./country-out/countries.js');

/* 1. The list's shape. */
assert.equal(COUNTRY_CODES.length, 249, `249 ISO 3166-1 alpha-2 codes (got ${COUNTRY_CODES.length})`);
assert.equal(new Set(COUNTRY_CODES).size, 249, 'every code appears once');
assert.deepEqual(
  COUNTRY_CODES.filter((code) => !/^[A-Z]{2}$/.test(code)),
  [],
  'every code is two uppercase letters - the shape the column check keeps too',
);

/* 2. Every code has a name, and no two codes share one. */
const named = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) }));
assert.deepEqual(
  named.filter((entry) => entry.name.length === 0).map((entry) => entry.code),
  [],
  'no code resolves to nothing',
);
assert.deepEqual(
  named.filter((entry) => entry.name === entry.code).map((entry) => entry.code),
  [],
  'every code has an ICU name - a code falling back to itself is a nameless option in the picker',
);
const byName = new Map();
const collisions = named.filter((entry) => {
  if (byName.has(entry.name)) return true;
  byName.set(entry.name, entry.code);
  return false;
});
assert.deepEqual(
  collisions.map((entry) => `${entry.code} -> ${entry.name}`),
  [],
  'the pair (code, name) is one-to-one, so the picker cannot offer one country twice',
);

/* 3. The one lenient read, and the strict test beside it. */
assert.equal(NO_COUNTRY, '', 'no country is one value: the empty string');
assert.equal(normalizeCountryCode('SE'), 'SE', 'a stored code is kept as it is');
assert.equal(normalizeCountryCode('se'), 'SE', 'a lower-case code is the same country, tidied up');
assert.equal(normalizeCountryCode('  se  '), 'SE', 'and so is one with space around it');
assert.equal(normalizeCountryCode('Sweden'), '', 'a *name* is not a code and is not guessed at');
assert.equal(normalizeCountryCode('ZZ'), '', 'two letters that are nobody are not a country');
assert.equal(normalizeCountryCode(''), '', 'and nothing is nothing');
assert.equal(isCountryCode('SE'), true, 'a code off the list is known');
assert.equal(isCountryCode('se'), false, 'the list is uppercase, so a lower-case code is not it');
assert.equal(isCountryCode(''), false, 'and the empty string is not a country either');

/* 4. The pseudo-codes ICU knows and this site does not: refused, on purpose. */
for (const pseudo of ['XK', 'EU', 'AC', 'QO', 'XA', 'XB', 'UK']) {
  assert.equal(isCountryCode(pseudo), false, `${pseudo} is not an ISO country and is not offered`);
  assert.equal(normalizeCountryCode(pseudo), '', `${pseudo} reads as no country rather than being kept`);
}

/* 5. The flag path, and the one thing a path can get wrong. */
assert.equal(countryFlagPath('SE'), '/assets/flags/se.png', 'the path is lowercase, like the files');
assert.equal(countryFlagPath('GB'), '/assets/flags/gb.png');
assert.match(
  countryFlagPath('SE'),
  /^\/assets\/flags\/[a-z]{2}\.png$/,
  'every flag resolves to one lowercase two-letter file in one folder',
);
// A folder that exists is what makes the path honest: the slot falls back to the code while the
// drawing is missing, and the README in it is the contract for whoever draws the files. It is
// `assets/` at the project root - not `public/` - because the archive route serves that folder at
// exactly this URL (`app/assets/[...path]/route.ts`), which is where every other drawing lives.
const flagDir = path.join('assets', 'flags');
assert.equal(fs.existsSync(flagDir), true, 'assets/flags exists - the slot points into it');
assert.equal(
  fs.existsSync(path.join(flagDir, 'README.txt')),
  true,
  'and the folder carries the naming contract the path follows',
);
assert.equal(
  fs.existsSync(path.join('public', 'assets', 'flags')),
  false,
  'and it is the archive folder, not a second copy under public/',
);

/* 6. What the picker is handed: every code once, sorted by the name a reader is looking for. */
const options = countryOptions();
assert.equal(options.length, 249, 'the picker gets every country');
assert.equal(new Set(options.map((option) => option.code)).size, 249, 'and each one once');
assert.deepEqual(
  options,
  [...options].sort((left, right) => left.name.localeCompare(right.name)),
  'sorted by name, which is how a reader looks for their own country',
);
assert.equal(options[0].name, 'AFGHANISTAN', 'the list opens at Afghanistan');

/*
 * The summary prints last: `run-checks.cjs` reports the first line of stdout, so a line printed
 * between two sections is read as the verdict of a run that had not finished.
 */
console.log('country flag checks passed');
console.log('  codes   :', COUNTRY_CODES.length, '- unique, two uppercase letters each, all named');
console.log('  refused :', 'XK EU AC QO XA XB UK - pseudo-codes and one non-ISO convenience code');
console.log('  path    :', countryFlagPath('SE'));
console.log(
  '  picker  :',
  options.length,
  'options from',
  options[0].name,
  'to',
  options[options.length - 1].name,
);

