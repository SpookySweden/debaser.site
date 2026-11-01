/**
 * Hold the artwork registry against the files on disk.
 *
 * The registry is `app/lib/ui/art/slots.ts`: one entry per drawing the site asks for, with the box it is shown
 * in and the whole-number zoom it must be drawn at. This script compiles that module on its own (it imports
 * nothing, so it needs no build), reads every file it names, and reports two things:
 *
 *   - **what is wrong**: a file that is not `shown x k`, an orphan nothing names, a 9-slice margin that reaches
 *     past the edge of the drawing, two slots fighting over the same CSS property, a placeholder that has grown
 *     to the drawing's size. Any of these exits non-zero, because every one of them is a defect rather than a
 *     preference.
 *   - **what is still to draw**: each empty slot with the exact size to draw it at, what the site shows in the
 *     meantime, and one line about what the drawing is for. That list is the brief. `--brief` prints it whether
 *     or not there is anything wrong, and `--sheet` writes it as a page you can open and look at.
 *
 *     npm run art               the audit
 *     npm run art -- --brief    the whole registry, drawn or not, with sizes
 *     npm run art -- --sheet    write Temp/art/contact-sheet.html (open it in a browser)
 *     npm run art -- --json     machine-readable, for another tool
 *
 * It reads sizes from file headers rather than inflating anything: a PNG's IHDR and a GIF's logical screen
 * descriptor both carry width and height, and doing it that way means a 2MB upload is not decoded to be
 * measured. The PNGs still go through `scripts/png-read.cjs` when they are rendered into the contact sheet,
 * because a file that cannot be decoded is a finding of its own.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readPng } = require('./png-read.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'Temp', 'art');
const REGISTRY_SOURCE = 'app/lib/ui/art/slots.ts';

/** Directories under `assets/` that are a visitor's rather than the archive's. */
const NOT_OUR_ART = [path.join('assets', 'profiles', 'uploads'), path.join('assets', 'audio')];

/** The manifest that says which concept sheets exist, and how big each one is. */
const SHEET_MANIFEST = 'app/lib/concepts/sheets.ts';

/** The country list a flag file is drawn for. */
const COUNTRY_LIST = 'app/lib/profile/countries.ts';

const COLOURS = {
  black: '#000000',
  field: '#1A1525',
  blue: '#1D3CA6',
  yellow: '#FFF000',
  flavine: '#E1FF00',
  green: '#28C745',
  pink: '#FF00A0',
  rose: '#E6004C',
  white: '#FFFFFF',
};

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const wantBrief = flag('--brief');
const wantSheet = flag('--sheet');
const wantJson = flag('--json');

/** Compile the registry and require it. It imports nothing, so tsc needs no project. */
function loadRegistry() {
  const outDir = path.join(OUT, 'registry');
  fs.rmSync(outDir, { recursive: true, force: true });

  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tsc)) {
    throw new Error(`typescript is not installed (wanted ${tsc}) - run npm install`);
  }

  // `node <tsc>` rather than the npx shim: on Node 24 for Windows spawning a .cmd fails with EINVAL.
  execFileSync(
    process.execPath,
    [tsc, REGISTRY_SOURCE, '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const compiled = path.join(outDir, 'slots.js');
  if (!fs.existsSync(compiled)) throw new Error(`the registry did not compile (${compiled} is missing)`);
  return require(compiled);
}

/** `[width, height]` from a PNG's IHDR or a GIF's screen descriptor, without decoding the image. */
function imageSize(file) {
  const head = Buffer.alloc(24);
  const handle = fs.openSync(file, 'r');
  try {
    fs.readSync(handle, head, 0, head.length, 0);
  } finally {
    fs.closeSync(handle);
  }

  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  }
  if (head.subarray(0, 3).toString('latin1') === 'GIF') {
    return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
  }
  return { error: 'not a PNG or GIF - only those two carry a size this can read from the header' };
}

const box = (size) => `${size[0]}x${size[1]}`;

/** Every file under a directory, as paths from the project root. */
function filesUnder(relDir) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  };
  walk(abs);
  return found;
}

/* ------------------------------------------------------------------ the slot itself */

/**
 * The registry's own arithmetic, which has nothing to do with any file.
 *
 * Every one of these is a rule the *declaration* breaks, so they fail even on a slot nobody has drawn yet:
 * a slot that says it is shown at 1.5x is wrong whoever is drawing it.
 */
function auditDeclaration(slot, seenIds, seenCss) {
  const problems = [];
  const natural = [slot.shown[0][0] * slot.k, slot.shown[0][1] * slot.k];

  if (seenIds.has(slot.id)) problems.push(`two slots share the id "${slot.id}"`);
  seenIds.add(slot.id);

  if (!slot.label || !slot.brief || !slot.fallback) {
    problems.push(`${slot.id}: label, brief and fallback are all required - each one is used`);
  }
  if (!Number.isInteger(slot.k) || slot.k < 1) {
    problems.push(`${slot.id}: k is ${slot.k} - it must be a whole number, 1 or more`);
  }

  for (const [w, h] of slot.shown) {
    if (w < 1 || h < 1) problems.push(`${slot.id}: the shown box ${box([w, h])} has no area`);
    if (slot.scales) {
      if (w > natural[0] || h > natural[1]) {
        problems.push(`${slot.id}: shown ${box([w, h])} is larger than the drawing ${box(natural)}`);
      }
      continue;
    }
    if (natural[0] % w !== 0 || natural[1] % h !== 0) {
      problems.push(
        `${slot.id}: drawn ${box(natural)} is not a whole multiple of the box ${box([w, h])} - ` +
          `it would resample (${natural[0]}/${w} x ${natural[1]}/${h})`,
      );
    }
  }

  // A tile is its own repeat, so there is no zoom to apply: drawing at 2x would halve the pattern's scale
  // rather than sharpen it, which changes the desktop instead of improving it.
  if (slot.fit === 'tile' && slot.k !== 1) {
    problems.push(`${slot.id}: a tile is its own repeat, so k must be 1 (it says ${slot.k})`);
  }

  if (slot.fit === 'slice') {
    if (!slot.margins) {
      problems.push(`${slot.id}: fit is "slice", so the 9-slice margins are required`);
    } else if (slot.margins.length !== 4) {
      problems.push(`${slot.id}: margins are [top, right, bottom, left] - four numbers, found ${slot.margins.length}`);
    } else {
      const [top, right, bottom, left] = slot.margins;
      if ([top, right, bottom, left].some((n) => !Number.isInteger(n) || n < 0)) {
        problems.push(`${slot.id}: margins must be whole and non-negative (found ${slot.margins.join(', ')})`);
      } else {
        // An inset is a corner. If the two ends meet or pass each other there is no middle left to stretch,
        // and the drawing becomes one smeared corner - wrong at every size but one.
        if (top + bottom >= natural[1]) {
          problems.push(
            `${slot.id}: the top and bottom margins (${top} + ${bottom}) fill the drawing's ${natural[1]}px ` +
              'height - nothing is left to stretch',
          );
        }
        if (left + right >= natural[0]) {
          problems.push(
            `${slot.id}: the left and right margins (${left} + ${right}) fill the drawing's ${natural[0]}px ` +
              'width - nothing is left to stretch',
          );
        }
      }
    }
  } else if (slot.margins) {
    problems.push(`${slot.id}: declares margins but fit is "${slot.fit}" - margins only mean something 9-sliced`);
  }

  for (const property of slot.css ?? []) {
    if (!property.startsWith('--art-')) {
      problems.push(`${slot.id}: the CSS property ${property} must start with --art- so no component writes it`);
    }
    if (seenCss.has(property)) {
      problems.push(`${slot.id}: ${property} is already claimed by ${seenCss.get(property)}`);
    }
    seenCss.set(property, slot.id);
  }

  return { problems, natural };
}


/* -------------------------------------------------------------------- the files */

const IMAGE = /\.(png|gif|jpe?g|webp)$/i;

/** The files a slot's path names: one exact file, or every file its `{code}`/`{n}` pattern matches. */
function filesForSlot(slot) {
  if (!slot.path.includes('{')) {
    return fs.existsSync(path.join(ROOT, slot.path)) ? [slot.path] : [];
  }

  const dir = path.posix.dirname(slot.path);
  const name = path.posix
    .basename(slot.path)
    .replace(/[.]/g, '\\.')
    .replace('{code}', '([A-Za-z]{2})')
    .replace('{n}', '([A-Za-z0-9_-]+)');
  const pattern = new RegExp(`^${dir}/${name}$`);
  return filesUnder(dir).filter((file) => pattern.test(file) && IMAGE.test(file));
}

/**
 * The list a per-file slot is drawn *for* - the country codes, or the sheets the manifest names.
 *
 * It is read out of the source rather than imported, deliberately: both files are app modules with their own
 * imports, so compiling them to answer "which codes are there" would make the audit depend on the whole
 * component tree. A parse that stops matching is not allowed to pass quietly - a country list that came back
 * empty is reported as a failure, because "0 of 0 countries drawn" reads exactly like success.
 */
function manifestFor(slot) {
  if (slot.id === 'flag') {
    const source = fs.readFileSync(path.join(ROOT, COUNTRY_LIST), 'utf8');
    const block = source.match(/const ISO_3166_ALPHA_2 = \(([\s\S]*?)\);/);
    if (!block) return { kind: 'flag', codes: [], parseFailed: true };
    const codes = [...block[1].matchAll(/'([A-Z ]+)'/g)]
      .map((match) => match[1])
      .join(' ')
      .split(/\s+/)
      .filter((code) => /^[A-Z]{2}$/.test(code))
      .map((code) => code.toLowerCase());
    return { kind: 'flag', codes: [...new Set(codes)], parseFailed: codes.length === 0 };
  }

  if (slot.id === 'concept-sheet') {
    const source = fs.readFileSync(path.join(ROOT, SHEET_MANIFEST), 'utf8');
    const entries = new Map();
    // `[^}]*?` rather than `[\s\S]*?`, so one entry's width cannot be borrowed from the entry below it.
    for (const match of source.matchAll(/src:\s*'(\/assets\/[^']+)'[^}]*?width:\s*(\d+)[^}]*?height:\s*(\d+)/g)) {
      entries.set(match[1], [Number(match[2]), Number(match[3])]);
    }
    return { kind: 'sheet', entries, parseFailed: entries.size === 0 };
  }

  return null;
}


/** Every file a slot names, measured, with what is wrong about it. */
function auditFiles(slot, natural) {
  const problems = [];
  const notes = [];
  const drawn = [];

  for (const file of filesForSlot(slot)) {
    const size = imageSize(path.join(ROOT, file));
    if (size.error) {
      problems.push(`${file}: ${size.error}`);
      continue;
    }

    if (slot.placeholder) {
      // A stand-in is declared, not detected, so this cannot require the drawing's size - the blank the cursors
      // ship is already on a 32x32 canvas, which is the right canvas and not a drawing on it. What it *can*
      // require is that the stand-in never be bigger than the box it fills, because a file larger than the
      // drawing would be downscaled and could never be the drawing. Every run says the stand-in is one, so the
      // exemption is never silent: a placeholder is not a file that slipped past the size check.
      if (size.width > natural[0] || size.height > natural[1]) {
        problems.push(
          `${file} is ${box([size.width, size.height])}, larger than the ${box(natural)} it fills - ` +
            'a stand-in that big is just a wrong-sized drawing',
        );
      } else {
        notes.push(`${file} is a stand-in, not the drawing yet; draw it at ${box(natural)} when it is ready`);
      }
      drawn.push({ file, size, placeholder: true });
      continue;
    }

    if (size.width !== natural[0] || size.height !== natural[1]) {
      problems.push(
        `${file} is ${box([size.width, size.height])}; ${slot.id} is shown ${box(slot.shown[0])} at x${slot.k}, ` +
          `so the file must be exactly ${box(natural)}`,
      );
    }
    drawn.push({ file, size, placeholder: false });
  }

  // The manifest is the site's own claim about what exists, so it is checked both ways: a claim with no file is
  // a picture that shows the not-found notice, and a file with no claim is a drawing nothing will ever show.
  const manifest = manifestFor(slot);
  if (manifest?.parseFailed) {
    const what = manifest.kind === 'flag' ? 'countries' : 'sheets';
    problems.push(`${slot.id}: could not read the list of ${what} - the parse found none, which cannot be right`);
  } else if (manifest?.kind === 'sheet') {
    for (const { file, size } of drawn) {
      const entry = manifest.entries.get(`/${file}`);
      if (!entry) {
        notes.push(`${file} is not in ${SHEET_MANIFEST} - no component will ever show it`);
      } else if (entry[0] !== size.width || entry[1] !== size.height) {
        problems.push(
          `${file} is ${box([size.width, size.height])} but its manifest entry says ${box(entry)} - ` +
            'the notice and the drawing would disagree about the box',
        );
      }
    }
    for (const [src, entry] of manifest.entries) {
      if (!fs.existsSync(path.join(ROOT, src.replace(/^\//, '')))) {
        notes.push(`${src} is in ${SHEET_MANIFEST} and is not drawn yet - draw it at ${box(entry)}`);
      }
    }
  } else if (manifest?.kind === 'flag') {
    const have = new Set(drawn.map(({ file }) => path.posix.basename(file, '.png').toLowerCase()));
    const missing = manifest.codes.filter((code) => !have.has(code));
    notes.push(`${have.size} of ${manifest.codes.length} countries drawn; ${missing.length} still to draw`);
    if (have.size > 0 && missing.length > 0) {
      notes.push(`still to draw: ${missing.slice(0, 12).join(' ')}${missing.length > 12 ? ' ...' : ''}`);
    }
  }

  return { problems, notes, drawn };
}

/**
 * Files in a slot's own directory that no slot names.
 *
 * Per-file slots are exempt: `assets/concepts/{n}.png` matches whatever is there by design, and the manifest
 * cross-check above is what holds those files to account.
 */
function orphanProblems(slots) {
  const problems = [];
  const claimedBy = new Map();

  for (const slot of slots) {
    if (slot.path.includes('{')) continue;
    const dir = path.posix.dirname(slot.path);
    if (!claimedBy.has(dir)) claimedBy.set(dir, new Set());
    claimedBy.get(dir).add(path.posix.basename(slot.path));
  }

  for (const [dir, claimed] of claimedBy) {
    for (const file of filesUnder(dir)) {
      if (!IMAGE.test(file)) continue;
      if (NOT_OUR_ART.some((skip) => file === skip || file.startsWith(`${skip}/`))) continue;
      if (path.posix.dirname(file) !== dir) continue; // a subdirectory belongs to whatever put it there
      if (!claimed.has(path.posix.basename(file))) {
        problems.push(`${file} is in ${dir} and no slot names it - draw it into a slot or delete it`);
      }
    }
  }

  return problems;
}


/* ------------------------------------------------------------------ the contact sheet */

/** A `file://` URL for the browser, so the page opens by double-clicking it. */
const fileUrl = (file) => `file:///${path.resolve(ROOT, file).split(path.sep).join('/')}`;

/**
 * The brief as a page: every slot, drawn or not, at the size it will be shown.
 *
 * This is a scratch tool page under `Temp/`, not a page of the site - it keeps none of the site's rules, and it
 * writes literal colours because it has no stylesheet to inherit them from. It exists for one reason: a size in
 * a terminal is a number, and the same size on a page with the drawing inside it is something you can measure
 * by looking.
 */
function writeContactSheet(rows) {
  const card = ({ slot, natural, drawn, notes }) => {
    const [shownW, shownH] = slot.shown[0];
    const picture = drawn.filter((entry) => !entry.placeholder).map(({ file }) => file);
    const preview =
      picture.length === 0
        ? `<div class="waiting" style="width:${Math.max(shownW, 40)}px;height:${Math.max(shownH, 24)}px">not drawn</div>`
        : picture
            .map(
              (file) =>
                `<img src="${fileUrl(file)}" alt="" style="width:${shownW}px;height:${shownH}px">` +
                `<img src="${fileUrl(file)}" alt="" class="zoom">`,
            )
            .join('');

    return `<figure class="card">
      <figcaption>
        <strong>${slot.label}</strong>
        <code>${slot.id}</code>
      </figcaption>
      <div class="stage">${preview}</div>
      <p class="size">draw ${box(natural)} &middot; show ${box([shownW, shownH])} at x${slot.k}${
        slot.margins ? ` &middot; 9-slice ${slot.margins.join(' ')}` : ''
      }${slot.scales ? ' &middot; scales' : ''}${slot.placeholder ? ' &middot; placeholder' : ''}</p>
      <p class="brief">${slot.brief}</p>
      <p class="fallback">meanwhile: ${slot.fallback}</p>
      <p class="path"><code>${slot.path}</code></p>
      ${notes.map((note) => `<p class="note">${note}</p>`).join('')}
    </figure>`;
  };

  const waiting = rows.filter((row) => row.drawn.length === 0);
  const html = `<!doctype html>
<meta charset="utf-8">
<title>ART BRIEF</title>
<style>
  body { margin: 0; padding: 16px; background: ${COLOURS.field}; color: ${COLOURS.white};
         font: 12px/1.5 'Courier New', monospace; }
  h1 { margin: 0 0 4px; font-size: 16px; letter-spacing: 1px; }
  h2 { margin: 24px 0 8px; font-size: 13px; color: ${COLOURS.yellow}; }
  .grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .card { margin: 0; padding: 10px; width: 300px; background: ${COLOURS.black};
          border: 3px solid ${COLOURS.flavine}; border-right-color: ${COLOURS.blue};
          border-bottom-color: ${COLOURS.blue}; }
  .card figcaption { display: flex; justify-content: space-between; gap: 8px; }
  .card code { color: ${COLOURS.flavine}; }
  .stage { display: flex; align-items: flex-end; gap: 8px; margin: 8px 0;
           min-height: 40px; padding: 6px; background: ${COLOURS.field}; }
  .waiting { display: flex; align-items: center; justify-content: center; border: 1px dashed ${COLOURS.pink};
             color: ${COLOURS.pink}; }
  img { image-rendering: pixelated; border: 1px solid ${COLOURS.black}; }
  img.zoom { width: auto; height: auto; }
  .size { color: ${COLOURS.green}; margin: 4px 0; }
  .brief { color: ${COLOURS.white}; margin: 4px 0; }
  .fallback, .path { color: ${COLOURS.flavine}; margin: 4px 0; }
  .note { color: ${COLOURS.rose}; margin: 4px 0; }
</style>
<h1>THE ART BRIEF</h1>
<p>${rows.length} slots, ${rows.length - waiting.length} with a file, ${waiting.length} to draw.
Left is the file at the size the site shows it; right is it 1:1, pixels as drawn.</p>
${waiting.length > 0 ? `<h2>STILL TO DRAW</h2><div class="grid">${waiting.map(card).join('')}</div>` : ''}
<h2>ALL SLOTS</h2>
<div class="grid">${rows.filter((row) => row.drawn.length > 0).map(card).join('')}</div>
`;

  fs.mkdirSync(OUT, { recursive: true });
  const target = path.join(OUT, 'contact-sheet.html');
  fs.writeFileSync(target, html, 'utf8');
  return target;
}


/* --------------------------------------------------------------------------- the report */

const pad = (text, width) => String(text).padEnd(width);

/** One line per slot: the id, the box to draw it at, the box it is shown in, and how many files it has. */
function line(row) {
  const { slot, natural, drawn } = row;
  const state = slot.placeholder && drawn.length > 0 ? 'placeholder' : drawn.length === 0 ? 'to draw' : `${drawn.length} file(s)`;
  return `  ${pad(slot.id, 20)} ${pad(box(natural), 7)} shown ${pad(box(slot.shown[0]), 7)} x${slot.k}  ${state}`;
}

function main() {
  const { ART_SLOTS } = loadRegistry();

  const seenIds = new Set();
  const seenCss = new Map();
  const rows = ART_SLOTS.map((slot) => {
    const declaration = auditDeclaration(slot, seenIds, seenCss);
    const files = auditFiles(slot, declaration.natural);
    return {
      slot,
      natural: declaration.natural,
      problems: [...declaration.problems, ...files.problems],
      notes: files.notes,
      drawn: files.drawn,
      files: filesForSlot(slot),
    };
  });

  const problems = [...rows.flatMap((row) => row.problems.map((problem) => `${row.slot.id}: ${problem}`)), ...orphanProblems(ART_SLOTS)];
  const notes = rows.flatMap((row) => row.notes.map((note) => `${row.slot.id}: ${note}`));
  const waiting = rows.filter((row) => row.drawn.length === 0);

  if (wantJson) {
    console.log(
      JSON.stringify(
        {
          slots: rows.map((row) => ({
            id: row.slot.id,
            label: row.slot.label,
            natural: row.natural,
            shown: row.slot.shown,
            k: row.slot.k,
            margins: row.slot.margins ?? null,
            fit: row.slot.fit,
            css: row.slot.css ?? [],
            ink: row.slot.ink ?? null,
            files: row.files,
            state: row.slot.placeholder ? 'placeholder' : row.drawn.length === 0 ? 'empty' : 'drawn',
          })),
          problems,
          notes,
        },
        null,
        2,
      ),
    );
    process.exitCode = problems.length > 0 ? 1 : 0;
    return;
  }

  console.log(`ART :: ${rows.length} slots, ${rows.length - waiting.length} with a file, ${waiting.length} to draw`);
  console.log('');

  if (wantBrief) {
    console.log('THE REGISTRY');
    for (const row of rows) console.log(line(row));
    console.log('');
    console.log('THE BRIEF');
    for (const row of rows) {
      console.log(`  ${row.slot.label}  (${row.slot.id})`);
      console.log(`    draw ${box(row.natural)}   ${row.slot.brief}`);
      console.log(`    meanwhile: ${row.slot.fallback}`);
      console.log('');
    }
  }

  if (notes.length > 0) {
    console.log('NOTES');
    for (const note of notes) console.log(`  - ${note}`);
    console.log('');
  }

  if (problems.length === 0) {
    console.log('OK :: every file is the size its slot declares, and nothing on disk is unclaimed.');
  } else {
    console.log(`PROBLEMS (${problems.length})`);
    for (const problem of problems) console.log(`  [!] ${problem}`);
    process.exitCode = 1;
  }

  if (wantSheet) {
    const target = writeContactSheet(rows);
    console.log('');
    console.log(`contact sheet: ${path.relative(ROOT, target).split(path.sep).join('/')}`);
    console.log(`  open it in a browser, or: npm run shot -- --url ${fileUrl(path.relative(ROOT, target))} --out Temp/art/contact-sheet.png`);
  }
}

try {
  main();
} catch (error) {
  console.error(`art-audit could not run: ${error.message}`);
  process.exitCode = 1;
}

