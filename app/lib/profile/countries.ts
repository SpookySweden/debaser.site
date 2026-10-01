/**
 * The countries a profile may wear as a flag.
 *
 * **This replaced a free-text place line, and the reason is the same one a flag has always had.**
 * "PLACE: bomboldilo land" was a sentence the site could not draw, could not sort, could not group
 * and could not check - forty characters in which any two accounts could disagree about what the
 * same place was called. A country is one *code* off a closed list, which is a thing the site can
 * draw (a flag beside a name), count, and refuse when somebody pastes something that is not one.
 *
 * **The list is ISO 3166-1 alpha-2, spelled out rather than derived.** There is no API on this
 * machine that enumerates regions: `Intl.supportedValuesOf` has no `region` type, and walking all
 * 676 letter pairs asking `Intl.DisplayNames` for a name would hand back ICU's own region set, which
 * is a *different* set - it carries `XK` (Kosovo), `EU`, `AC`, `QO` and the pseudo-codes `XA`/`XB`,
 * none of which is an ISO country, and it has no name at all for some codes. A closed list a reader
 * can audit is the honest shape for a value that goes in a database column, so the codes are
 * written out here and `Temp/check-country-flag.cjs` holds the properties that matter: every one
 * unique, every one two uppercase letters, every one a code this machine's ICU knows.
 *
 * **The name is asked for, not stored.** `Intl.DisplayNames` turns a code into "Sweden" in every
 * browser and every Node this site runs on, which is 249 names not written into a file that could
 * drift from them. `countryName` is the only thing that reads it, and its fallback is the code
 * itself, so a code this build somehow lost still prints as *something*.
 *
 * **The flag itself is a hand-drawn file, never code.** `countryFlagPath` points at where the
 * drawing belongs (`assets/flags/<code>.png`, lowercase - the folder's README says so, and the
 * archive route serves it at `/assets/flags/<code>.png`) and `app/components/CountryFlag.tsx`
 * renders that slot, so the artwork rule holds: no CSS gradients, no SVG and no emoji standing in
 * for a drawing. Until a file lands the slot shows the code in glyphs, the same answer
 * `app/lib/ui/icons.ts` gives for a mark whose drawing is not made yet.
 */

/**
 * The ISO 3166-1 alpha-2 codes, in one string so the list reads as a list.
 *
 * Grouped by first letter rather than alphabetised as one run, because that is how a country list
 * is proof-read - and the grouping makes the count (249) checkable by eye, letter by letter.
 */
const ISO_3166_ALPHA_2 = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ ' +
  'BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ ' +
  'EC EE EG EH ER ES ET ' +
  'FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY ' +
  'HK HM HN HR HT HU ' +
  'ID IE IL IM IN IO IQ IR IS IT ' +
  'JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ ' +
  'LA LB LC LI LK LR LS LT LU LV LY ' +
  'MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ ' +
  'OM ' +
  'PA PE PF PG PH PK PL PM PN PR PS PT PW PY ' +
  'QA ' +
  'RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ ' +
  'TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ ' +
  'VA VC VE VG VI VN VU ' +
  'WF WS ' +
  'YE YT ' +
  'ZA ZM ZW'
)
  .split(' ')
  .filter((code) => code.length > 0);


/** Every code a profile may carry, in ISO order. */
export const COUNTRY_CODES: readonly string[] = ISO_3166_ALPHA_2;

/** What "no country" is written as, in the column and in the draft: one way to say nothing. */
export const NO_COUNTRY = '';

/** The one place the flag files are looked for. Lowercase, because that is how the files are named. */
const FLAG_DIRECTORY = '/assets/flags';

/**
 * The codes as a set, so membership is a lookup rather than a scan of 249 strings.
 *
 * Built once at module load: the list is a constant, and `normalizeCountryCode` runs on every read
 * of every profile.
 */
const CODE_SET = new Set(ISO_3166_ALPHA_2);

/**
 * The one name resolver, built once.
 *
 * `Intl.DisplayNames` is a formatter, and constructing one per call is the mistake `Intl` punishes -
 * `countryOptions()` alone would build 249 of them. The locale is pinned to `en` rather than left to
 * the host, because a country's name here is the site's own label rather than a translation: two
 * readers looking at one post should be reading the same words in it.
 */
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

/** Whether this is one of the codes the site knows. Case matters: the stored form is uppercase. */
export function isCountryCode(value: string): boolean {
  return CODE_SET.has(value);
}

/**
 * A stored-or-typed value, as the code the site would keep - or nothing.
 *
 * **Lenient about the shape, strict about the list.** A keyboard, a paste from a URL and a
 * hand-edited row can all arrive as `se`, ` SE ` or `Sweden`; the first two are the same country
 * written untidily and are accepted, the third is not a code at all and is not guessed at. So this
 * trims, uppercases, and then asks the list - which means a profile read out of an older store
 * cannot put a sentence where a country goes.
 */
export function normalizeCountryCode(value: string): string {
  const code = value.trim().toUpperCase();

  return isCountryCode(code) ? code : NO_COUNTRY;
}

/**
 * Where this country's flag is drawn: `/assets/flags/<code>.png`.
 *
 * Lowercase filenames, because a path is a path on a case-sensitive host and one file per country
 * in two cases is a way to be wrong quietly - `assets/flags/`, which the archive route
 * (`app/assets/[...path]/route.ts`) serves at exactly this URL. This returns the path whether or
 * not the drawing exists: `SpriteSlot` is what handles a file that has not arrived, so no caller
 * has to ask the filesystem anything.
 */
export function countryFlagPath(code: string): string {
  return `${FLAG_DIRECTORY}/${code.toLowerCase()}.png`;
}

/**
 * The country's name, in the site's own register.
 *
 * Uppercase, because every label on this site is, and asked of `Intl.DisplayNames` rather than
 * stored: a name is the one part of a country allowed to change (and to be translated) without the
 * code changing. A code with no name falls back to the code, which is at worst the two letters the
 * flag slot is already showing.
 */
export function countryName(code: string): string {
  if (code.length === 0) return '';

  const name = REGION_NAMES.of(code);

  return (name ?? code).toUpperCase();
}

/** Everything the picker needs, sorted the way a reader looks for their own country. */
export function countryOptions(): { code: string; name: string }[] {
  return ISO_3166_ALPHA_2.map((code) => ({ code, name: countryName(code) })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

