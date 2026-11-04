/**
 * What a class list looks like *while it is pointed at*, held to 4.5:1 in every theme.
 *
 * `check-themes.cjs` holds the bare pairs (`text-ink bg-paper`) and leaves the prefixed ones alone on
 * purpose: a `hover:` pair belongs to a state it did not evaluate. That gap is where this fault lived -
 * `hover:bg-sun` on rows whose inks are the field's: White on Daffodil (1.19:1) and Daffodil dates on
 * Daffodil (1:1) on every pointed-at board post, archive file and page link in the dark theme, and White on
 * Daffodil (1.07:1) on every Rose tag chip in *both* themes. Measured with a real pointer by
 * `Temp/hover-contrast.cjs`; this is the source half, so the same shape cannot come back unseen.
 *
 * The hovered state of one class context is worked out the way the browser does it:
 *   - the surface is `hover:bg-<token>`;
 *   - the ink is `hover:text-<token>` if there is one, else the bare `text-<token>`;
 *   - and when the context names no ink at all, the element *inherits* one. Every such element on this
 *     site is a row or a link on the field (a post, a file, a page link), so its text is in the field's
 *     inks - `ink`, `accent-ink`, `ink-quiet` - and the hover surface has to hold all three, in every
 *     theme. That is the rule `hover:bg-sun` broke and `hover:bg-pointed` keeps.
 *
 * What it cannot see: an ink a *child* names (a Rose word inside a row), or a row that inherits a bar's
 * ink rather than the field's. Those need the browser - `node Temp/hover-contrast.cjs <base> --signin`.
 * Contexts it cannot read whole (a textless swatch, a shared helper's classes) are in `KNOWN`, each with its reason.
 *
 *   npx tsc app/lib/ui/themes.ts app/lib/ui/colour.ts --outDir Temp/hover-pairs-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { contrastRatio } = require('./hover-pairs-out/colour.js');
const { THEMES, THEME_TOKEN_NAMES } = require('./hover-pairs-out/themes.js');

const FIELD_INKS = ['ink', 'accent-ink', 'ink-quiet'];

/**
 * Contexts whose hovered pair this scan cannot see, each with the reason: file, a piece of the context.
 *
 * Two are a shared helper's classes. A context only sees its own literal, so `${PLATE} ... hover:bg-bubble`
 * reads as White on Pink, but PLATE also writes `hover:bg-ena hover:text-sun`. Of two `hover:bg-*` classes
 * on one element the stylesheet decides, and in the build (2026-10-21) the order is bubble < bubble-pale
 * < ena < ice < pointed. So PLATE's `ena` beats `bubble` (Daffodil on Royal Blue, 7.88:1) and
 * `pressable(false)`'s `ice` beats `bubble-pale` (the field ink on the field). The Pink and Rose hovers
 * written there never show.
 */
const KNOWN = [
  ['app/components/TagCreatorWindow.tsx', 'hover:bg-sun', 'a colour swatch: the button holds a TagMark square and an aria-label, no text'],
  ['app/components/UnsavedPrompt.tsx', 'hover:bg-bubble', 'PLATE`s hover:bg-ena and hover:text-sun win: Daffodil on Royal Blue'],
  ['app/components/CharacterViewport.tsx', 'hover:bg-bubble-pale', '`pressable(false)`s hover:bg-ice wins, under its text-ink'],
];

/* The class-context scanner, the same one `check-themes.cjs` uses: comments skipped, and a template's two
   ternary arms never merged into one context (each arm is read with the static text, never with the other). */
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

const tokens = (literal, prefix) =>
  [...literal.matchAll(new RegExp(`(?<![\\w:\\[-])${prefix}([\\w-]+)(?![\\w/\\[-])`, 'g'))]
    .map((m) => m[1])
    .filter((name) => THEME_TOKEN_NAMES.includes(name));

/** The hovered pairs one context spells out: `[ink, surface, why]`. */
function hoveredPairs(context) {
  const surfaces = [...new Set(tokens(context, 'hover:bg-'))];
  if (surfaces.length === 0) return [];

  const hoverInks = tokens(context, 'hover:text-');
  const inks = hoverInks.length > 0 ? hoverInks : tokens(context, 'text-');
  const pairs = [];
  for (const surface of surfaces) {
    if (inks.length > 0) for (const ink of new Set(inks)) pairs.push([ink, surface, 'its own ink']);
    else for (const ink of FIELD_INKS) pairs.push([ink, surface, 'an inherited field ink']);
  }
  return pairs;
}

/* 0. The scan can see what it is for: the shapes this check exists to catch fail it, and the fixes pass. */
const shape = (context) =>
  hoveredPairs(context).filter(([ink, surface]) => THEMES.some((t) => contrastRatio(t.tokens[ink], t.tokens[surface]) < 4.5));
assert.ok(shape('border-b border-dotted border-ink px-2 py-1 hover:bg-sun').length > 0, 'a field row lighting up Daffodil fails');
assert.equal(shape('border-b border-dotted border-ink px-2 py-1 hover:bg-pointed').length, 0, 'the same row on `pointed` passes');
assert.ok(shape('bg-bubble-pale text-ink-bar hover:bg-sun').length > 0, 'a Rose chip lighting up Daffodil under White fails');
assert.equal(shape('bg-bubble-pale text-ink-bar hover:bg-sun hover:text-ink-plate').length, 0, 'with the plate ink it passes');
assert.ok(shape('bg-sun text-ink-plate hover:bg-ice').length > 0, 'a plate lighting up the field under Black fails');
assert.equal(shape('bg-sun text-ink-plate hover:bg-ice hover:text-ink').length, 0, 'with the field ink it passes');
assert.equal(shape('hover:bg-sun-pale hover:text-accent-ink').length, 0, 'a hover ink names its own pair');
assert.equal(shape('disabled:hover:bg-sun-pale text-ink-bar').length, 0, 'a chained state is not the hover state');

/* 1. The pointed-at row's own surface, in every theme: the field's three inks on it. */
console.log('=== the field inks on the pointed-at row ===\n');
for (const surface of ['pointed', 'pointed-quiet']) {
  for (const ink of FIELD_INKS) {
    const cells = THEMES.map((t) => `${t.id} ${contrastRatio(t.tokens[ink], t.tokens[surface]).toFixed(2)}:1`);
    console.log(`  ${(ink + ' on ' + surface).padEnd(28)} ${cells.join('   ')}`);
    for (const t of THEMES) assert.ok(contrastRatio(t.tokens[ink], t.tokens[surface]) >= 4.5, `${ink} on ${surface} in ${t.id}`);
  }
}

/* 1b. A highlight is a different colour from the row it lights up - or pointing at the row shows nothing.
   That is not hypothetical: a read post rests on `chrome-dark`, Royal Blue in the dark theme, and `pointed`
   is Royal Blue there too, so a read post lit up in its own colour until it got `pointed-quiet`. The rows
   each token is used on: posts, files, comms rows and page links rest on paper / sun-pale / ice-pale;
   a read post rests on chrome-dark. */
const RESTS = { pointed: ['paper', 'sun-pale', 'ice-pale'], 'pointed-quiet': ['chrome-dark'] };
for (const [lit, rests] of Object.entries(RESTS)) {
  for (const t of THEMES) {
    for (const rest of rests) {
      assert.notEqual(t.tokens[lit], t.tokens[rest], `${lit} differs from the ${rest} row it lights up, in ${t.id}`);
    }
  }
}
console.log(`\n  every highlight differs from the rows it lights up, in ${THEMES.length} themes`);

/* 2. Every hovered pair a class list spells out, in every theme. */
const bad = [];
const seen = new Set();
let hovered = 0;

for (const file of files('app')) {
  const rel = file.replace(/\\/g, '/');
  for (const context of classContexts(fs.readFileSync(file, 'utf8'))) {
    const pairs = hoveredPairs(context);
    if (pairs.length === 0) continue;
    hovered += 1;

    for (const [ink, surface, why] of pairs) {
      if (KNOWN.some(([f, piece]) => f === rel && context.includes(piece))) continue;

      for (const theme of THEMES) {
        const ratio = contrastRatio(theme.tokens[ink], theme.tokens[surface]);
        if (ratio >= 4.5) continue;
        const key = `${rel}|${theme.id}|${ink}|${surface}`;
        if (seen.has(key)) continue;
        seen.add(key);
        bad.push(`${rel}\n    theme=${theme.id}  ${ink} (${why}) on hover:bg-${surface}  ${ratio.toFixed(2)}:1\n    ${context.trim().slice(0, 220)}`);
      }
    }
  }
}

assert.equal(bad.length, 0, `${bad.length} hovered pair(s) below 4.5:1:\n  ${bad.join('\n  ')}`);

console.log(`\n${hovered} class context(s) with a hover surface, every hovered pair at 4.5:1 or better in ${THEMES.length} themes`);
