/**
 * The context system (Luke, 2026-11-27): what every session loads stays short, moved rules stay where sessions will
 * find them, the index stays current, and the context hook warns once before the automatic compaction at 300k.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Windows checkouts have CRLF line ends (core.autocrlf); the rules are about the text, not the line ends.
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r/g, '');

// 1. The always-loaded files stay short (2026-11-27 before: CLAUDE.md 10,882 + core.md 16,554 characters).
const claude = read('CLAUDE.md');
const core = read('.claude/rules/core.md');
assert.ok(claude.length < 1500, `CLAUDE.md is ${claude.length} characters: area rules belong in .claude/rules/ with paths`);
assert.ok(core.length < 15000, `core.md is ${core.length} characters: move detail to docs/ or an area rule file`);
assert.doesNotMatch(core, /^paths:/m, 'core.md loads in every session, so it has no paths');

// 2. The moved rules are where their area loads them, word for word.
const scoped = (f) => {
  const text = read(f);
  assert.match(text, /^---\npaths:\n(\s+- ".+"\n)+---\n/, `${f} is scoped to its area by a paths list`);
  return text;
};
const media = scoped('.claude/rules/media.md');
assert.match(media, /Metadata only: title, creator, plain-text description/, 'media.md keeps the metadata-only rule');
assert.match(media, /Counts and ratings stay on the server and decide order only/, 'media.md keeps the counts rule');
assert.match(media, /Reading a platform's ordinary web pages \(scraping\) is a last resort/, 'media.md keeps the scraping rule');
assert.match(media, /"app\/lib\/web\/\*\*"/, 'media.md loads with the WEB code');
const browser = scoped('.claude/rules/browser.md');
assert.match(browser, /The only way to fetch any site is `safeFetchAnySite`/, 'browser.md keeps the one-fetch rule');
assert.match(browser, /SEEING_MACHINE=off/, 'browser.md keeps the off switch');
const art = scoped('.claude/rules/art.md');
for (const exception of ['assets/flags/', 'tmdb.png', 'assets/aquarium/', 'Data Dragon', 'simulated background', 'Smears']) {
  assert.ok(art.includes(exception), `art.md keeps the exception: ${exception}`);
}
assert.match(art, /"app\/\*\*\/\*\.tsx"/, 'art.md loads with every component');
assert.match(core, /No AI-generated artwork of any kind/, 'core.md keeps the firm art line for every session');
assert.match(core, /no database changes \(inserts, updates, deletes, schema, migrations\) without my explicit OK/, 'core.md keeps the database rule');
assert.match(read('.claude/rules/frontend.md'), /Reveals take their space in both states/, 'frontend.md keeps the reveal rule');

// 3. The look-ups exist and the index is current.
for (const f of ['docs/STATE.md', 'docs/decisions.md', 'docs/sessions.md', 'docs/commands.md',
  '.claude/skills/interview/SKILL.md', '.claude/skills/brief/SKILL.md', '.claude/skills/handoff/SKILL.md']) {
  assert.ok(fs.existsSync(f), `${f} exists`);
}
assert.ok(!fs.existsSync('HANDOFF.md'), 'HANDOFF.md is replaced by docs/STATE.md and the handoff skill');
execFileSync(process.execPath, ['scripts/ctx.cjs', '--check'], { stdio: 'pipe' });
const out = execFileSync(process.execPath, ['scripts/ctx.cjs', 'seeing', 'machine'], { encoding: 'utf8' });
assert.match(out, /SPEC-seeing-machine\.md/, 'the digest finds the SPEC for its topic');

// 4. The compaction line and the hooks are wired.
const settings = JSON.parse(read('.claude/settings.json'));
assert.equal(settings.autoCompactWindow, 300000, 'sessions compact at 300k tokens (Luke, 2026-11-27)');
const commands = JSON.stringify(settings.hooks);
for (const mode of ['context.cjs\\" stop', 'context.cjs\\" precompact', 'context.cjs\\" start']) {
  assert.ok(commands.includes(mode), `the hook runs: ${mode}`);
}
assert.ok(commands.includes('guard.cjs') && commands.includes('agent-limit.cjs'), 'the older hooks stay');

// 5. The hook warns once past 250k, stays quiet after, re-arms after a compaction, and never loops.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-check-'));
const transcript = path.join(dir, 't.jsonl');
const usageLine = (size) => JSON.stringify({ type: 'assistant', isSidechain: false,
  message: { role: 'assistant', usage: { input_tokens: 2, cache_read_input_tokens: size - 2, cache_creation_input_tokens: 0 } } });
const session = 'check-' + process.pid + '-' + Date.now();
const runStop = (size, extra = {}) => {
  fs.writeFileSync(transcript, '{"type":"user"}\n' + usageLine(size) + '\n');
  return execFileSync(process.execPath, ['.claude/hooks/context.cjs', 'stop'], {
    input: JSON.stringify({ session_id: session, transcript_path: transcript, ...extra }), encoding: 'utf8' });
};
assert.equal(runStop(120000), '', 'quiet at 120k');
const warned = JSON.parse(runStop(262000));
assert.equal(warned.decision, 'block', 'sent back once past 250k');
assert.match(warned.reason, /about 262k tokens/, 'says the size');
assert.equal(runStop(270000), '', 'only once');
assert.equal(runStop(90000), '', 'quiet after the compaction');
assert.equal(JSON.parse(runStop(255000)).decision, 'block', 're-armed for the next time');
assert.equal(runStop(400000, { stop_hook_active: true }), '', 'never while already sent back');
const start = JSON.parse(execFileSync(process.execPath, ['.claude/hooks/context.cjs', 'start'], { input: '{"source":"compact"}', encoding: 'utf8' }));
assert.match(start.hookSpecificOutput.additionalContext, /docs\/STATE\.md/, 'after a compaction it says to re-read the notes');
fs.rmSync(dir, { recursive: true, force: true });

console.log('check-context-system: ok');
