/**
 * The guard for the theming framework: the look lives in the token files, and nowhere else.
 *
 *     npm run tokens               check (part of `npm run verify`; exits 1 on any finding)
 *     npm run tokens -- --write    rewrite the generated colour block in app/theme/tokens.css from themes.ts
 *
 * The token files are where a value may be written: `app/theme/tokens.css` (sizes, lines, layers, motion,
 * faces by job), `app/theme/fonts.ts` (the faces), and `app/lib/ui/themes.ts` (the dyes and the two
 * themes). Everything else asks for a name. This refuses, everywhere else under `app/`:
 *
 *   1. a colour value - `#1d3ca6`, `rgb(...)`, `hsl(...)` - in code or CSS;
 *   2. Tailwind's own palette (`text-red-500`, `border-black`, `bg-white`): those colours are switched off,
 *      so one in a component draws nothing;
 *   3. a hand-typed value in a look utility - `text-[13px]`, `py-[2px]`, `z-[90]`, `leading-[14px]`,
 *      `translate-y-[1px]`, `bg-[#...]`. Layout sizes (`w-[22rem]`, `max-h-[62vh]`, `grid-cols-[...]`) are
 *      allowed: they are where a box sits, not how it looks;
 *   4. a face named outside the registry (`DotGothic16`, `'Courier New'`, `font-sans`), and `font-family`,
 *      `font-size`, `z-index` or a border width written as a literal in a stylesheet;
 *   5. a style object that writes a colour, a size of text or a face as a literal (`style={{ fontSize: 13 }}`);
 *   6. a generated colour block that no longer matches `themes.ts` (run with `--write`).
 *
 * People's own colours are data, not the site's look, and are not checked: a name's swatch
 * (`app/lib/profile/name-colours.ts`), a tag's hue (`app/lib/forum/tag-vocabulary.ts`), and the character
 * workbench's figure paint (`app/lib/character/`). A known exception is listed in `EXCEPTIONS` below with
 * its reason - one place, so the list is read rather than scattered through comments.
 *
 * Comments are skipped (the scan reads string literals through the TypeScript parser), because a comment
 * on this site routinely names the very value it is explaining.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const TOKENS_CSS = 'app/theme/tokens.css';
const THEMES_TS = 'app/lib/ui/themes.ts';

/** Where values may be written. */
const TOKEN_FILES = new Set([TOKENS_CSS, 'app/theme/fonts.ts', THEMES_TS]);

/** People's colours and the figure's paint: data, not the look. */
const DATA_FILES = [/^app\/lib\/profile\/name-colours\.ts$/, /^app\/lib\/forum\/tag-vocabulary\.ts$/, /^app\/lib\/character\//];

/** Known exceptions, each with its reason. `file` and the exact `value` found there. */
const EXCEPTIONS = [
  {
    file: 'app/components/CountryFlag.tsx',
    value: 'text-[9px]',
    why: 'the flag fallback letters, under the 13px floor - left for the readability rounds',
  },
  {
    file: 'app/components/TagCreatorWindow.tsx',
    value: '#ffffcc',
    why: 'a contrast tooltip measured against an old chip colour - left for the readability rounds',
  },
  {
    file: 'app/lib/projects/notes.ts',
    value: 'IBM Plex Mono',
    why: 'the /notes page says which face the site is set in: words, not styling',
  },
];

/* ------------------------------------------------------------------------------------------------ */

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function filesUnder(dir, test) {
  const out = [];
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (test(entry.name)) out.push(rel(p));
    }
  })(path.join(ROOT, dir));
  return out.sort();
}

/** `app/lib/ui/themes.ts`, compiled in memory - it has no imports, so it runs as it is. */
function loadThemes() {
  const { outputText } = ts.transpileModule(read(THEMES_TS), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(module, module.exports, require);
  return module.exports;
}

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The block between the two markers in tokens.css, as `themes.ts` says it should read. */
function generatedColours() {
  const { DYES, FALLBACK_THEME, THEME_TOKEN_NAMES } = loadThemes();
  const dyes = Object.entries(DYES).map(([name, hex]) => `  --dye-${kebab(name)}: ${hex};`);
  const roles = THEME_TOKEN_NAMES.map((token) => `  --color-${token}: ${FALLBACK_THEME.tokens[token]};`);
  return [
    '/* BEGIN GENERATED COLOURS */',
    `/* Written by \`npm run tokens -- --write\` from ${THEMES_TS}. Do not edit by hand: change themes.ts. */`,
    '',
    '/* The nine dyes by name, for the few rules that want a dye whatever the theme (the sprite slot). */',
    ':root,',
    ':host {',
    ...dyes,
    '}',
    '',
    `/* The colours by job, as the fallback theme (${FALLBACK_THEME.id}) sets them. The theme switcher writes the`,
    '   chosen theme over these on <html>. Tailwind\'s own palette is switched off: only these names exist. */',
    '@theme {',
    '  --color-*: initial;',
    ...roles,
    '}',
    '/* END GENERATED COLOURS */',
  ].join('\n');
}

const BLOCK = /\/\* BEGIN GENERATED COLOURS \*\/[\s\S]*?\/\* END GENERATED COLOURS \*\//;

function writeColours() {
  const css = read(TOKENS_CSS);
  const eol = css.includes('\r\n') ? '\r\n' : '\n';
  if (!BLOCK.test(css)) throw new Error(`${TOKENS_CSS} has no BEGIN/END GENERATED COLOURS markers`);
  const next = css.replace(/\r\n/g, '\n').replace(BLOCK, generatedColours()).replace(/\n/g, eol);
  fs.writeFileSync(path.join(ROOT, TOKENS_CSS), next);
  console.log(`${TOKENS_CSS}: generated colours written from ${THEMES_TS}`);
}

/* ------------------------------------------------------------------------------------------------ */

const findings = [];
const allowed = (file, value) => EXCEPTIONS.some((e) => e.file === file && e.value === value);
function find(file, line, value, rule) {
  if (allowed(file, value)) return;
  findings.push({ file, line, value, rule });
}

const COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|oklch|oklab)\(/g;
const FACES = /\b(?:IBM Plex Mono|IBM_Plex_Mono|DotGothic16|Silkscreen|MS Gothic|Osaka|Courier New|Lucida Console|ui-monospace|monospace|sans-serif|serif|Press Start 2P|VT323)\b/g;
const STOCK = /^(?:bg|text|border(?:-[xytblrse])?|outline|ring|ring-offset|fill|stroke|from|to|via|decoration|divide|accent|caret|shadow|placeholder)-(?:black|white|(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|taupe|mauve|mist|olive)-\d{2,3})(?:\/\d+)?$/;
/** Look utilities that may not take a hand-typed value in brackets. */
const LOOK = /^-?(?:text|bg|border(?:-[xytblrse])?|outline(?:-offset)?|ring(?:-offset)?|fill|stroke|decoration|underline-offset|accent|caret|shadow|rounded(?:-[a-z]+)?|font|leading|tracking|p[xytblrse]?|m[xytblrse]?|gap(?:-[xy])?|space-[xy]|z|translate(?:-[xyz])?|opacity|indent)-\[/;
const FAMILY_UTIL = /^font-(?:sans|serif)$/;
/** Tailwind's sizes that tokens.css switched off (`--text-*: initial`): they render no size at all. */
const GONE_SIZE = /^text-(?:xs|lg|2xl|3xl|[6-9]xl)$/;
/** An arbitrary property (`[font-size:13px]`) that writes the look without a token. */
const LOOK_PROPERTY = /^\[(?:font-size|font-family|color|background(?:-color)?|padding[\w-]*|margin[\w-]*|gap|row-gap|column-gap|z-index|line-height|letter-spacing|border[\w-]*)\s*:(?!var\()/;

/**
 * The utility a class names, without its variants and its `!`. The cut is at the last colon *outside*
 * brackets, so `max-[400px]:py-[2px]`, `data-[open=true]:text-[13px]` and `has-[:checked]:bg-white` are
 * all read as the utility they end in.
 */
function bareUtility(raw) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ':' && depth === 0) cut = i + 1;
  }
  return raw.slice(cut).replace(/^!|!$/g, '');
}

function checkClassToken(file, line, raw) {
  const token = bareUtility(raw);
  if (STOCK.test(token)) find(file, line, raw, "Tailwind's own palette - use a colour by job (bg-paper, border-ink-plate)");
  else if (LOOK.test(token)) find(file, line, raw, 'a hand-typed look value - use a token (text-label, py-0.5, z-popout)');
  else if (GONE_SIZE.test(token)) find(file, line, raw, 'a Tailwind size this site switched off (it renders no size) - use text-label and the rest');
  else if (LOOK_PROPERTY.test(token)) find(file, line, raw, 'a look property written by hand - use a token');
  else if (FAMILY_UTIL.test(token)) find(file, line, raw, 'a font family - use a job (font-body, font-mono, font-display)');
  else if (/^border(?:-[xytblrse])?-[2-9]\d*$/.test(token)) find(file, line, raw, 'a numbered line width - use border-line or border-thick');
}

/** Style-object properties that are the look rather than the layout. */
const STYLE_LOOK = /^(?:color|background(?:Color)?|border(?:Top|Right|Bottom|Left)?(?:Color|Width)?|outline(?:Color)?|fontSize|fontFamily|fontWeight|lineHeight|letterSpacing|padding(?:Top|Right|Bottom|Left|Inline|Block)?|margin(?:Top|Right|Bottom|Left|Inline|Block)?|gap|zIndex|boxShadow)$/;

function scanScript(file) {
  const text = read(file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  (function visit(node) {
    let literal = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literal = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) literal = node.text;

    if (literal !== null && !(ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent))) {
      const line = lineOf(node);
      for (const m of literal.matchAll(COLOUR)) find(file, line, m[0], 'a colour value - name the dye in themes.ts and use its token');
      for (const m of literal.matchAll(FACES)) find(file, line, m[0], 'a face named outside app/theme/fonts.ts');
      for (const t of literal.split(/\s+/)) if (t) checkClassToken(file, line, t);
    }

    if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)) {
      const name = node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : null;
      const init = node.initializer;
      const isLiteral = ts.isNumericLiteral(init) || ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init);
      const inStyle = (() => {
        for (let p = node.parent; p; p = p.parent) {
          if (ts.isJsxAttribute(p)) return p.name.getText(source) === 'style';
          if (ts.isVariableDeclaration(p) || ts.isFunctionLike(p)) return false;
        }
        return false;
      })();
      if (name && inStyle && STYLE_LOOK.test(name) && isLiteral && init.text !== '0' && init.text !== 'none' && init.text !== 'transparent') {
        find(file, lineOf(node), `${name}: ${init.getText(source)}`, 'a look value in a style object - use a token');
      }
    }

    ts.forEachChild(node, visit);
  })(source);
}

/** Stylesheets outside tokens.css: colours, faces, sizes of text, layers and line widths are tokens. */
function scanStyles(file) {
  const lines = read(file).split(/\r?\n/);
  let inComment = false;
  lines.forEach((raw, i) => {
    let line = raw;
    // Drop comments, which name values freely.
    let out = '';
    for (let j = 0; j < line.length; j++) {
      if (inComment) {
        if (line.startsWith('*/', j)) {
          inComment = false;
          j++;
        }
      } else if (line.startsWith('/*', j)) {
        inComment = true;
        j++;
      } else out += line[j];
    }
    line = out;
    const at = i + 1;
    for (const m of line.matchAll(COLOUR)) find(file, at, m[0], 'a colour value - use a colour token (var(--color-ink), var(--dye-black))');
    for (const m of line.matchAll(FACES)) find(file, at, m[0], 'a face named outside the registry - use var(--font-body) and the rest');
    // Every declaration on the line, so a one-line rule (`.x { font-size: 13px; padding: 4px; }`) is read too.
    for (const segment of line.split(/[{};]/)) {
      const decl = /^\s*([a-z-]+)\s*:\s*(.+?)\s*$/.exec(segment);
      if (!decl) continue;
      const [, prop, value] = decl;
      const literalLength = /(?<![\w(-])\d*\.?\d+(?:px|rem|em)\b/;
      if (prop === 'font-size' && literalLength.test(value) && !/var\(/.test(value)) find(file, at, `${prop}: ${value}`, 'a literal text size - use var(--text-label) and the rest');
      if (prop === 'font-family' && !/^(?:var\(|inherit)/.test(value)) find(file, at, `${prop}: ${value}`, 'a face named outside the registry');
      if (prop === 'z-index' && /^-?\d+$/.test(value) && value !== '0') find(file, at, `${prop}: ${value}`, 'a literal layer - name it in tokens.css');
      if (/^border(?:-(?:top|right|bottom|left))?(?:-width)?$/.test(prop) && /\b[1-9]\d*px\b/.test(value)) find(file, at, `${prop}: ${value}`, 'a literal line width - use var(--border-width-line)');
      if (/^(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?$/.test(prop) && /(?<![\w(-])[1-9]\d*\.?\d*(?:px|rem)\b/.test(value.replace(/--spacing\([^)]*\)|var\([^)]*\)|calc\([^;]*\)/g, ''))) {
        find(file, at, `${prop}: ${value}`, 'a literal spacing - use --spacing(n) so the space dial reaches it');
      }
    }
  });
}

/* ------------------------------------------------------------------------------------------------ */

if (process.argv.includes('--write')) {
  writeColours();
  process.exit(0);
}

// 6. The generated block - and nothing after it that resets the colours. An @theme reset clears every
//    name declared before it, so a `--color-*: initial` below the block would quietly wipe the palette.
const uncommented = read(TOKENS_CSS).replace(/\/\*[\s\S]*?\*\//g, '');
if ((uncommented.match(/--color-\*:\s*initial/g) ?? []).length !== 1 || !BLOCK.exec(read(TOKENS_CSS))?.[0].includes('--color-*: initial')) {
  findings.push({ file: TOKENS_CSS, line: 0, value: '--color-*: initial', rule: 'the colour reset belongs once, inside the generated block' });
}
// The block itself.
const css = read(TOKENS_CSS).replace(/\r\n/g, '\n');
const current = BLOCK.exec(css)?.[0];
if (!current) findings.push({ file: TOKENS_CSS, line: 0, value: 'BEGIN/END GENERATED COLOURS', rule: 'the generated colour block is missing' });
else if (current !== generatedColours()) {
  findings.push({ file: TOKENS_CSS, line: css.slice(0, css.indexOf(current)).split('\n').length, value: 'GENERATED COLOURS', rule: `out of date with ${THEMES_TS} - run \`npm run tokens -- --write\`` });
}

const isData = (file) => DATA_FILES.some((re) => re.test(file));
const scripts = filesUnder('app', (n) => /\.(tsx?)$/.test(n)).filter((f) => !TOKEN_FILES.has(f) && !isData(f));
const styles = filesUnder('app', (n) => n.endsWith('.css')).filter((f) => !TOKEN_FILES.has(f));
for (const file of scripts) scanScript(file);
for (const file of styles) scanStyles(file);

if (findings.length === 0) {
  console.log(`tokens: ${scripts.length} scripts and ${styles.length} stylesheet(s) ask for names; the colour block matches ${THEMES_TS}.`);
} else {
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.value}\n    ${f.rule}`);
  console.log(`\ntokens: ${findings.length} raw value(s) outside the token files. See docs/theming.md.`);
  process.exitCode = 1;
}
