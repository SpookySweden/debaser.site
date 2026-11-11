/**
 * The theme library, held where it can fail.
 *
 * A theme system's failure mode is quiet: somebody adds a third theme that looks fine to them and
 * cannot be read, or the picker drifts out of step with the library, or a token is added to the
 * default and forgotten in the dark one - which does not throw, it just leaves that property at
 * whatever the last theme wrote, so the page ends up half in one palette and half in another.
 *
 * So this checks the five things that make a theme *valid* rather than merely present:
 *
 *   1. every theme defines every token, and no theme defines a token that does not exist;
 *   2. every theme's colours are drawn from the nine, and none of them is a grey;
 *   3. every pair that carries text clears 4.5:1 - in *every* theme, by arithmetic;
 *   4. `globals.css` and the default theme are the same colours, in both directions. The stylesheet is
 *      what a visitor who never picks a theme is served; the default theme is what the picker applies
 *      on the way back. Two places holding the same values is a drift waiting to happen, and the drift
 *      is invisible - a `:root` variable that disagrees with `THEMES[0].tokens` only shows up as a
 *      page that changes colour when a reader visits the picker and comes back;
 *   5. no class literal pairs an ink with a surface it cannot be read on, in any theme. This is the
 *      *source* half of `scripts/contrast.cjs`, which asks the browser the same question about the DOM
 *      it built: a literal is caught here before anything renders, and the pairs that only exist once a
 *      component renders - an ink inherited from a parent, a row whose surface is its ancestor's - are
 *      what the other instrument is for. The fault the `ink-bar`/`accent-ink`/`ink-quiet` tokens exist
 *      for (`text-paper` on `bg-ena` at 1.91:1 in the dark theme) is one of these pairs, and this
 *      section is what holds it at the source.
 *
 * Steps: the runner matches the `npx tsc ` prefix literally, inside this block. This check compiles
 * its own inputs: an earlier version required `Temp/themes-out/themes.js` that *nothing* compiled, so
 * it read whatever was left there by hand - a stale pass, which is worse than no pass, and the same
 * fault `run-checks.cjs` was fixed for. The outputs land flat in that directory (`themes-out/themes.js`,
 * not `themes-out/lib/ui/themes.js`), because tsc takes the inputs` common root - both files are in
 * `app/lib/ui` - as the directory the structure is measured from.
 *   npx tsc app/lib/ui/themes.ts app/lib/ui/colour.ts --outDir Temp/themes-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { contrastRatio } = require('./themes-out/colour.js');
const { THEMES, THEME_TOKEN_NAMES, FALLBACK_THEME, DYES } = require('./themes-out/themes.js');

const NINE = ['#000000', '#1a1525', '#1d3ca6', '#e1ff00', '#fff000', '#28c745', '#ff00a0', '#e6004c', '#ffffff'];

const isGrey = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) <= 4 && r > 8 && r < 247;
};

// (2026-11-04) The palette grew past the nine, each by Luke's choice and recorded in themes.ts and docs/design.md:
// the SHERBET swatch (2026-10-31, the third template only), the cover card's Ash (2026-11-03) and the stream queue's
// title shades (2026-11-02). `DYES` in themes.ts is the one list ("a tenth colour starts here too"), so it is pinned
// here colour by colour: a new dye, or one drifting, fails until this list is changed on purpose.
const SHERBET = { candy: '#ffb7e6', carnation: '#ffa1c5', salmon: '#ff9da2', coral: '#ff987f', tangerine: '#ff9368', mint: '#67dca9', orchid: '#b149aa', lime: '#c5ff3f' };
const QUEUE_SHADES = { deepRed: '#8c0027', deepGreen: '#0b521b', lightRed: '#ff5c7a', lightBlue: '#7ea6ff' };
const ASH = '#3d3c44';
// (2026-11-11) The reader's papers (SPEC-reader.md, Luke): worn only by the reader-* tokens.
const READER_PAPERS = { vellum: '#faf8f2', moonInk: '#e6e1ee', sepiaPaper: '#f4ecd8', sepiaInk: '#4b3826' };
assert.deepEqual(
  [...Object.values(DYES)].sort(),
  [...NINE, ...Object.values(SHERBET), ...Object.values(QUEUE_SHADES), ...Object.values(READER_PAPERS), ASH].sort(),
  'every dye in themes.ts is one of these, and each is here',
);
assert.equal(new Set(Object.values(DYES)).size, Object.keys(DYES).length, 'and no colour is named twice');
for (const [name, hex] of Object.entries({ ...SHERBET, ...QUEUE_SHADES, ...READER_PAPERS, ash: ASH })) assert.equal(DYES[name], hex, `${name} is ${hex}`);

/** Whether this token, in this theme, may wear this colour: where each colour beyond the nine is allowed to go. */
const wornAllowed = (themeId, token, hex) => {
  if (NINE.includes(hex)) return true;
  if (hex === ASH) return token === 'cover-card';
  if (Object.values(READER_PAPERS).includes(hex)) return token.startsWith('reader-');
  // The reader's highlight colours (2026-11-11) borrow the queue's light blue and light red as tints.
  if (Object.values(QUEUE_SHADES).includes(hex)) return token.startsWith('queue-') || token === 'mark-blue' || token === 'mark-red';
  if (Object.values(SHERBET).includes(hex)) return themeId.startsWith('sherbet-') || (token === 'cover-card-ink' && hex === SHERBET.candy);
  return false;
};

console.log('=== the library ===\n');

assert.ok(THEMES.length >= 2, 'there is a default and at least one other');
// The fallback - what a visitor who never chose gets, the dark theme since SPEC-readability.md - is first,
// so the picker opens on what the site opens in. (Until 2026-10-22 this asked for the bright `default`.)
assert.equal(THEMES[0].id, FALLBACK_THEME.id, 'the fallback is first, so the picker opens on it');
assert.equal(FALLBACK_THEME.id, 'dark', 'a visitor who never chose a theme gets the dark one');

for (const theme of THEMES) {
  const keys = Object.keys(theme.tokens);

  // 1. Complete, and nothing extra. A missing token is the quiet failure: the property keeps the
  //    previous theme's value and nobody notices until they switch back.
  for (const token of THEME_TOKEN_NAMES) {
    assert.ok(keys.includes(token), `${theme.id} defines ${token}`);
    assert.ok(/^#[0-9a-f]{6}$/.test(theme.tokens[token]), `${theme.id}.${token} is a hex`);
  }
  assert.equal(keys.length, THEME_TOKEN_NAMES.length, `${theme.id} defines nothing beyond the token list`);

  // 2. Drawn from the nine, and no grey.
  for (const token of THEME_TOKEN_NAMES) {
    const hex = theme.tokens[token];
    assert.ok(wornAllowed(theme.id, token, hex), `${theme.id}.${token} (${hex}) is one of the nine, or a named colour in the one place it is allowed`);
    assert.ok(!isGrey(hex), `${theme.id}.${token} (${hex}) is a grey, and this site has none`);
  }

  console.log(`  ${theme.id.padEnd(9)} ${String(keys.length).padStart(2)} tokens, all named dyes, none of them grey`);
}

/* 3. The pairs that carry text, in every theme.
   Every one of these is a pair that actually exists in the markup - the token a control uses, on the
   face it uses it on - so the check is about the site rather than about a palette in isolation. */
const PAIRS = [
  ['ink', 'paper', 'prose read on the field'],
  ['ink', 'sun-pale', 'a label on a panel'],
  ['ink', 'ice-pale', 'a label on an inset'],
  ['ink-plate', 'sun', 'a plate label on a plate face'],
  ['ink-plate', 'acid', 'a status bar label'],
  // (2026-11-04) TITLE_BAR left this pair long ago, and sun on ena failed all three SHERBET themes on the selected row and menu hovers: they wear ink-bar now.
  ['ink-bar', 'ena', 'a selected row and a pointed-at menu key'],
  ['ink', 'chrome-dark', 'an inactive title bar`s name, and a disabled plate`s label'],
  // The three inks that move with the *field*: the byline, the timestamp, the brand label. Each is a
  // pair that exists in the markup, and each was a dye doing an ink's job until it had a token. Note
  // what is *not* here: neither of these inks on `hardware`. Black is stable, so a caption on a black
  // readout is the bar ink's job - Nigrosine on Black is 1.18:1 and Royal Blue on Black is 2.25:1, and
  // those are the pairs the per-literal rewrite moved to `ink-bar`.
  ['accent-ink', 'paper', 'the brand ink on the field - `TimeStamp`, `ACCOUNT`, a `debaser.site` byline'],
  ['accent-ink', 'sun-pale', 'the brand ink on a panel - a link in a comment, a track`s own title line'],
  ['ink-quiet', 'paper', 'the caption ink on the field - a `text-[9px]` line under a title'],
  ['ink-quiet', 'sun-pale', 'the same caption on a panel'],
  // The bar ink, on every surface that does not move with the theme.
  ['ink-bar', 'ena', 'a chip or title bar in Royal Blue'],
  ['ink-bar', 'bubble-pale', 'a Rose badge or plate - `TagBadge`, and the board`s own header'],
  ['ink-bar', 'hardware', 'a reverse-video chip, and the player`s screen'],
  ['ink-bar', 'chrome', 'the disabled plate'],
  // The row under the pointer carries the field's inks while it is lit, so it has to hold all three.
  ['ink', 'pointed', 'a pointed-at post, file or page link - its prose'],
  ['accent-ink', 'pointed', 'the same row - its timestamps and bylines'],
  ['ink-quiet', 'pointed', 'the same row - its captions'],
  ['ink', 'pointed-quiet', 'a pointed-at post the reader has already read'],
  ['accent-ink', 'pointed-quiet', 'the same read post - its timestamps'],
  ['ink-quiet', 'pointed-quiet', 'the same read post - its captions'],
  // The reader's three papers (SPEC-reader.md, 2026-11-11): a book's words on the page picked in LOOK.
  ['reader-light-ink', 'reader-light-paper', 'a book on the light paper'],
  ['reader-dark-ink', 'reader-dark-paper', 'a book on the dark paper'],
  ['reader-sepia-ink', 'reader-sepia-paper', 'a book on the sepia paper'],
];

console.log('\n=== the pairs, per theme ===\n');
console.log('pair                            ' + THEMES.map((t) => t.id.padEnd(10)).join(''));

let failures = 0;

for (const [ink, surface, why] of PAIRS) {
  const cells = THEMES.map((theme) => {
    const ratio = contrastRatio(theme.tokens[ink], theme.tokens[surface]);
    if (ratio < 4.5) failures += 1;
    return `${ratio.toFixed(2).padStart(5)}${ratio >= 4.5 ? ' ok ' : '  X '}`;
  });

  console.log(`${(ink + ' on ' + surface).padEnd(31)} ${cells.join(' ')}`);
  if (failures > 0 && cells.some((c) => c.includes('X'))) {
    console.log(`   ^ ${why}`);
  }
}

assert.equal(failures, 0, `${failures} text pair(s) below 4.5:1 - a theme that cannot be read is not a theme`);

// (2026-11-04) The pair list above says which inks read on `ena`, not who wears them. A selected ListRow sits on `ena`,
// and Daffodil there was 2.28-2.81:1 in the SHERBET themes, so its label and key are held to the ink that reads.
const listRow = fs.readFileSync('app/components/ListRow.tsx', 'utf8');
assert.match(listRow, /selected \? 'bg-ena'/, 'a selected row is on ena, which is why the next two matter');
assert.match(listRow, /selected \? 'text-ink-bar'/, 'and its label wears ink-bar');
assert.match(listRow, /\[--key-ink:var\(--color-ink-bar\)\]/, 'and so does its delete key');
assert.doesNotMatch(listRow, /text-sun|--color-sun/, 'Daffodil does not read on ena in every theme');

/* 4. The stylesheet and the default theme, in both directions.
   `globals.css` is what a visitor who never picks a theme is served; `FALLBACK_THEME` (the dark theme since 2026-10-22) is what the picker
   applies when they come back to it. Both are "the default", and if they disagree the page changes colour
   on a round trip through the picker - with nothing in the source looking wrong, because each half is
   internally consistent. */
// (2026-10-23, docs/theming.md) The stylesheet's colour block moved to app/theme/tokens.css, generated from
// themes.ts by `npm run tokens -- --write`; it is the first @theme block there. Read first, so the regex
// below finds it. This section still holds the copy to the library, independently of the generator.
const css = fs.readFileSync('app/theme/tokens.css', 'utf8') + fs.readFileSync('app/globals.css', 'utf8');
const block = css.match(/\n@theme \{([\s\S]*?)\n\}/);
assert.ok(block, 'there is an @theme block for the default palette');
const declared = new Map(
  [...block[1].matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [m[1], m[2].toLowerCase()]),
);

for (const token of THEME_TOKEN_NAMES) {
  assert.equal(
    declared.get(token),
    FALLBACK_THEME.tokens[token],
    `globals.css declares --color-${token} exactly as the fallback theme does`,
  );
}
for (const declaredToken of declared.keys()) {
  assert.ok(THEME_TOKEN_NAMES.includes(declaredToken), `--color-${declaredToken} in globals.css is a token a theme knows`);
}

console.log(`\n=== globals.css and the default theme ===\n`);
console.log(`  ${declared.size} colour variable(s), the same ${THEME_TOKEN_NAMES.length} names and the same values`);

/* 5. Every literal that names an ink and a surface together, held to the floor in every theme.
   The scan is deliberately narrow: bare `text-<token>` and bare `bg-<token>` in the same class literal,
   with no state prefix. That is exactly the shape a per-literal rewrite can be sure about, and exactly
   the shape that produced the fault these tokens exist for - a literal naming both is a pair nobody has
   to guess at. Prefixed pairs (`hover:bg-sun text-ink`) are left to `check-hover-pairs.cjs`, which
   works out the pointed-at state, and to `Temp/hover-contrast.cjs`, which points a real mouse at the DOM. */
const INKS = ['ink', 'ink-plate', 'ink-bar', 'accent-ink', 'ink-quiet', 'paper'];
const SURFACES = THEME_TOKEN_NAMES.filter((token) => !INKS.includes(token));
const inkOf = (literal) => [...literal.matchAll(/(?<![\w:-])text-([\w-]+)(?![\w-])/g)].map((m) => m[1]).filter((n) => INKS.includes(n));
const surfaceOf = (literal) => [...literal.matchAll(/(?<![\w:-])bg-([\w-]+)(?![\w-/])/g)].map((m) => m[1]).filter((n) => SURFACES.includes(n));

/**
 * Every context in which a class list is written, as plain strings - comments skipped, because this
 * check's own subject matter means a comment can name the very classes being checked.
 *
 * **A scanner rather than a regex, and that is not fussiness.** A regex cannot see the end of a template
 * whose `${}` holds another string, so `className={`absolute ... ${selected ? 'bg-sun text-ink' : '...'}`}`
 * is not one match - and the multi-line templates are where a real ink bug lived: `RadioLoops`'s close
 * badge is `bg-bubble-pale ... text-paper` (White on Rose in the default theme, Nigrosine on Rose at
 * 3.79:1 in the dark one) inside exactly that shape, and a regex reported nothing at all.
 *
 * **And it keeps the arms apart, which a whole-literal grain cannot.** `bg-hardware ${on ? 'text-acid' :
 * 'text-ink-bar'}` is three contexts - the static text on its own, the static text with each arm - and
 * never `text-acid` beside `text-ink-bar`, which no element ever wears together. Both halves matter:
 * conflating the arms invents pairs that do not exist, and reading only the arms loses the pair that
 * does (a surface in the static text with the ink in an arm is the commonest shape on this site).
 */
function skipQuoted(source, at) {
  const quote = source[at];
  let i = at + 1;

  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && source[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        if (inner === '\\') {
          i += 2;
          continue;
        }
        if (inner === '"' || inner === "'" || inner === '`') {
          i = skipQuoted(source, i);
          continue;
        }
        if (inner === '{') depth += 1;
        else if (inner === '}') depth -= 1;
        i += 1;
      }
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote !== '`' && ch === '\n') return i;
    i += 1;
  }

  return i;
}

function classContexts(source) {
  const out = [];
  let i = 0;

  while (i < source.length) {
    const c = source[i];

    if (c === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2) + 2;
      continue;
    }

    if (c === '"' || c === "'") {
      const end = skipQuoted(source, i);
      out.push(source.slice(i + 1, end));
      i = end + 1;
      continue;
    }

    if (c === '`') {
      // The template is read part by part: the text between the interpolations, and the source of each
      // interpolation - which is scanned on its own so that two arms of one ternary are never merged.
      const parts = [];
      let text = '';
      i += 1;

      while (i < source.length) {
        const ch = source[i];
        if (ch === '\\') {
          text += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (ch === '$' && source[i + 1] === '{') {
          parts.push({ text });
          text = '';
          let depth = 1;
          i += 2;
          const start = i;
          while (i < source.length && depth > 0) {
            const inner = source[i];
            if (inner === '\\') {
              i += 2;
              continue;
            }
            if (inner === '"' || inner === "'" || inner === '`') {
              i = skipQuoted(source, i);
              continue;
            }
            if (inner === '{') depth += 1;
            else if (inner === '}') depth -= 1;
            i += 1;
          }
          parts.push({ expr: source.slice(start, i - 1) });
          continue;
        }
        if (ch === '`') {
          i += 1;
          break;
        }
        text += ch;
        i += 1;
      }

      parts.push({ text });

      const plain = parts.map((part) => part.text ?? '').join(' ');
      out.push(plain);

      for (const part of parts) {
        if (part.expr === undefined) continue;
        for (const inner of classContexts(part.expr)) out.push(`${plain} ${inner}`);
      }

      continue;
    }

    i += 1;
  }

  return out;
}

function files(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const bad = [];
const seen = new Set();
let scanned = 0;

console.log('\n=== every ink/surface pair a literal spells out ===\n');

for (const file of files('app')) {
  for (const context of classContexts(fs.readFileSync(file, 'utf8'))) {
    scanned += 1;

    for (const ink of inkOf(context)) {
      for (const surface of surfaceOf(context)) {
        for (const theme of THEMES) {
          const ratio = contrastRatio(theme.tokens[ink], theme.tokens[surface]);
          if (ratio >= 4.5) continue;

          // One report per pair per file: a multi-line template yields several contexts (the static text,
          // and the static text with each arm), so without this the same fault is printed three times and
          // a reader stops reading the list.
          const key = `${file}|${theme.id}|${ink}|${surface}`;
          if (seen.has(key)) continue;
          seen.add(key);

          bad.push(`${file}\n    theme=${theme.id}  text-${ink} on bg-${surface}  ${ratio.toFixed(2)}:1\n    ${context.trim()}`);
        }
      }
    }
  }
}

assert.equal(bad.length, 0, `${bad.length} ink/surface pair(s) a literal spells out are below 4.5:1:\n  ${bad.join('\n  ')}`);

console.log(`  ${scanned} class context(s) read, and none pairs an ink with a surface it cannot be read on in either theme`);

/* 6. Rose is a surface, never an ink (2026-10-23, Luke's pick).
   Errors and refusals were Rose words on the window - `text-bubble-pale` in ~30 places - and Rose is
   under the floor on every field either theme has: the scan above never saw it, because it only reads
   the six inks. So a fault is a Rose *chip* with the bar ink (`bg-bubble-pale ... text-ink-bar`, the
   pair section 3 holds), and this holds the other half: no class literal prints Rose words at all.
   The one exception is the tic-tac-toe O, which is a game mark rather than a message. */
console.log('\n=== Rose is a chip, not an ink ===\n');
for (const theme of THEMES) {
  for (const field of ['paper', 'sun-pale']) {
    const ratio = contrastRatio(theme.tokens['bubble-pale'], theme.tokens[field]);
    console.log(`  theme=${theme.id.padEnd(8)} Rose words on ${field.padEnd(9)} ${ratio.toFixed(2)}:1`);
  }
}
const ROSE_INK_EXEMPT = [path.join('app', 'components', 'TicTacToeBoard.tsx')];
const roseInk = [];
for (const file of files('app')) {
  if (ROSE_INK_EXEMPT.includes(file)) continue;
  for (const context of classContexts(fs.readFileSync(file, 'utf8'))) {
    if (/(?<![\w-])text-bubble-pale(?![\w-])/.test(context)) roseInk.push(`${file}\n    ${context.trim()}`);
  }
}
assert.equal(
  roseInk.length,
  0,
  `${roseInk.length} class literal(s) print Rose words - make them a Rose chip (bg-bubble-pale ... text-ink-bar):\n  ${[...new Set(roseInk)].join('\n  ')}`,
);
console.log('  no class literal prints Rose words; faults are Rose chips with the bar ink');

/* The summary sits at the end of the file, and it sits *there* because it did not once: printed between
   two sections, it was reported by `run-checks.cjs` (which shows the first line of stdout) as a pass
   beside a later failure. A summary is a claim about everything above it. */
console.log(`\n${THEMES.length} themes, ${PAIRS.length} pairs each, all clearing 4.5:1; the stylesheet and the default agree; no literal spells out a pair below the floor`);

