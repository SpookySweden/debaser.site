#!/usr/bin/env node
/*
 * The context finder (Luke, 2026-11-27: "Build it"). Instead of reading whole SPECs, a session asks for a topic and
 * gets one page: the SPECs and docs about it (title, date, the headings that match), the rule lines, Luke's standing
 * decisions, his quoted words in those files, and the recent commits.
 *
 *   node scripts/ctx.cjs <words...>     a digest for a topic, e.g. `node scripts/ctx.cjs rooms queue`
 *   node scripts/ctx.cjs --index        rewrites docs/INDEX.md, the map of every SPEC, doc, rule file and skill
 *   node scripts/ctx.cjs --check        exits 1 if docs/INDEX.md is out of date (a file added, renamed or retitled)
 *
 * Reads only tracked text in the repo and `git log`. No packages, nothing sent anywhere.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const readText = (p) => fs.readFileSync(p, 'utf8');

// Which part of the site a SPEC or doc is about, by its file name. First match wins; add a line for a new area.
const AREAS = [
  ['BROWSER', /seeing-machine/],
  ['MEDIA', /web|media|book|reader|reading-places|live-streams|kino|subtitles|recommend|discover|youtube/],
  ['ROOMS', /room|watch|stream|music-queues|cytube|guests|floating-player|screens/],
  ['CHARACTERS', /character|figures|pixel-render|animat|companion|^SPEC\.md$/],
  ['FORUM', /forum|letter|notification|moderation|history|comic|live-docs/],
  ['PEOPLE', /privacy|test-accounts|vanity/],
  ['LOOK', /theme|background|aquarium|readability|less-text|windows|design|specimen|beatbox|tag-station/],
  ['GAMES', /leaguebot/],
  ['HOUSE', /self-hosting|command-center|efficiency|sessions|STATE|decisions|commands|handoff|INDEX|site-review/],
];
const areaOf = (name) => (AREAS.find(([, re]) => re.test(name)) || ['OTHER'])[0];

function sources() {
  const list = [];
  for (const f of fs.readdirSync(ROOT)) if (/^SPEC.*\.md$/.test(f)) list.push(path.join(ROOT, f));
  for (const f of fs.readdirSync(path.join(ROOT, 'docs'))) if (f.endsWith('.md') && f !== 'INDEX.md') list.push(path.join(ROOT, 'docs', f));
  return list.sort();
}
function ruleFiles() {
  const dir = path.join(ROOT, '.claude', 'rules');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f));
}
function skillFiles() {
  const dir = path.join(ROOT, '.claude', 'skills');
  return fs.readdirSync(dir)
    .map((d) => path.join(dir, d, 'SKILL.md'))
    .filter((f) => fs.existsSync(f));
}

function lastChanged(file) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', rel(file)], { cwd: ROOT, encoding: 'utf8' }).trim() || 'new';
  } catch {
    return '?';
  }
}
const titleOf = (text) => ((text.match(/^#\s+(.+)$/m) || [])[1] || '').replace(/^SPEC:\s*/, '').trim();
const tokensOf = (text) => Math.round(text.length / 4);
const descriptionOf = (text) => ((text.match(/^description:\s*(.+)$/m) || [])[1] || '').trim();

function buildIndex() {
  const rows = sources().map((f) => {
    const text = readText(f);
    return { file: rel(f), area: areaOf(path.basename(f)), title: titleOf(text), tokens: tokensOf(text) };
  });
  const out = [
    '# Index of SPECs and docs',
    '',
    'Made by `node scripts/ctx.cjs --index`: do not edit by hand. A one-page digest of any topic: `node scripts/ctx.cjs <words>`.',
    'Always loaded: `CLAUDE.md`, `.claude/rules/core.md`. Loaded when a file in the area is opened: the other rule files.',
    'Sizes are rough tokens (characters / 4): read the sections you need, not the whole file.',
    '',
    '## Rule files',
    '',
    '| File | Loads | ≈ tokens |',
    '|---|---|---|',
    ...ruleFiles().map((f) => {
      const text = readText(f);
      const scoped = /^---[\s\S]*?^paths:/m.test(text);
      return `| \`${rel(f)}\` | ${scoped ? 'when a file in its area is opened' : 'every session'} | ${tokensOf(text)} |`;
    }),
    '',
    '## Skills',
    '',
    ...skillFiles().map((f) => `- \`${rel(path.dirname(f))}\`: ${descriptionOf(readText(f)).slice(0, 160)}`),
    '',
  ];
  for (const [area] of [...AREAS, ['OTHER']]) {
    const inArea = rows.filter((r) => r.area === area);
    if (!inArea.length) continue;
    out.push(`## ${area}`, '', '| File | What | ≈ tokens |', '|---|---|---|');
    for (const r of inArea) out.push(`| \`${r.file}\` | ${r.title.replace(/\|/g, '/')} | ${r.tokens} |`);
    out.push('');
  }
  return out.join('\n');
}

function digest(words) {
  // "rooms" finds "room" too: a plain trailing s is dropped from longer words.
  const terms = words.map((w) => w.toLowerCase().replace(/^(.{4,}?)s$/, '$1')).filter(Boolean);
  const hit = (s) => terms.some((t) => s.toLowerCase().includes(t));
  const allHit = (s) => terms.every((t) => s.toLowerCase().includes(t));
  const print = (s) => process.stdout.write(s + '\n');

  // Score every SPEC and doc: name and title count most, headings next, body lines least.
  const scored = sources().map((f) => {
    const text = readText(f);
    const lines = text.split('\n');
    const name = path.basename(f);
    const title = titleOf(text);
    let score = 0;
    for (const t of terms) {
      if (name.toLowerCase().includes(t)) score += 20;
      if (title.toLowerCase().includes(t)) score += 15;
    }
    const heads = [];
    const quotes = [];
    let body = 0;
    lines.forEach((line, i) => {
      if (/^#{2,4}\s/.test(line) && hit(line)) heads.push(`${i + 1}: ${line.replace(/^#+\s*/, '')}`);
      if (hit(line)) {
        body++;
        if (/Luke[^"\n]{0,40}"/.test(line)) quotes.push(`${i + 1}: ${line.trim().slice(0, 220)}`);
      }
    });
    score += heads.length * 4 + Math.min(body, 40);
    return { file: rel(f), title, date: null, f, score, heads, quotes, tokens: tokensOf(text) };
  });
  const top = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);

  print(`# ${terms.join(' ')}: what the repo says (node scripts/ctx.cjs)`);
  print('');
  print('## Files, best match first (read the listed sections, not the whole file)');
  if (!top.length) print('- nothing matched: try another word, or see docs/INDEX.md');
  for (const s of top) {
    print(`- ${s.file} (${lastChanged(s.f)}, ≈${s.tokens} tokens): ${s.title}`);
    for (const h of s.heads.slice(0, 6)) print(`    § ${h}`);
    for (const q of s.quotes.slice(0, 3)) print(`    " ${q}`);
  }

  print('');
  print('## Rule lines');
  let ruleCount = 0;
  for (const f of ruleFiles()) {
    readText(f).split('\n').forEach((line, i) => {
      if (ruleCount < 12 && line.trim().startsWith('-') && hit(line)) {
        print(`- ${rel(f)}:${i + 1}: ${line.trim().replace(/^-\s*/, '').slice(0, 240)}`);
        ruleCount++;
      }
    });
  }
  if (!ruleCount) print('- none');

  print('');
  print("## Luke's standing decisions (docs/decisions.md)");
  const decisions = path.join(ROOT, 'docs', 'decisions.md');
  const dLines = fs.existsSync(decisions) ? readText(decisions).split('\n').filter((l) => l.startsWith('- 20') && hit(l)) : [];
  for (const l of dLines.slice(0, 10)) print(l.slice(0, 260));
  if (!dLines.length) print('- none');

  print('');
  print('## Recent commits');
  try {
    const args = ['log', '-i', '--format=%h %cs %s', '-n', '10'];
    for (const t of terms) args.push(`--grep=${t}`);
    if (terms.length > 1) args.push('--all-match');
    const log = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
    print(log ? log.split('\n').map((l) => '- ' + l.slice(0, 200)).join('\n') : '- none');
  } catch {
    print('- (git log could not be read)');
  }
  const strong = top.filter((s) => allHit(s.title + ' ' + s.file));
  if (strong.length) {
    print('');
    print(`Start with: ${strong[0].file}`);
  }
}

process.stdout.on('error', () => process.exit(0)); // piped into head: stop quietly
const args = process.argv.slice(2);
const indexFile = path.join(ROOT, 'docs', 'INDEX.md');
if (args[0] === '--index') {
  fs.writeFileSync(indexFile, buildIndex() + '\n');
  console.log('docs/INDEX.md written');
} else if (args[0] === '--check') {
  const now = fs.existsSync(indexFile) ? readText(indexFile) : '';
  const fresh = buildIndex() + '\n';
  // Sizes drift with every edit; only files and titles count as out of date.
  // Windows checkouts turn LF into CRLF (core.autocrlf), so line ends don't count either.
  const shape = (s) => s.replace(/\r/g, '').replace(/\| \d+ \|$/gm, '|');
  if (shape(now) !== shape(fresh)) {
    console.error('docs/INDEX.md is out of date: run `node scripts/ctx.cjs --index`');
    process.exit(1);
  }
  console.log('docs/INDEX.md is up to date');
} else if (args.length) {
  digest(args);
} else {
  console.log('Usage: node scripts/ctx.cjs <words...> | --index | --check');
}
