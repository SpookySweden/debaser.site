#!/usr/bin/env node
/*
 * Claude Code hook guard (wired up in .claude/settings.json).
 *
 *   node guard.cjs pre    PreToolUse: keeps .env.local out of reach and refuses secret-looking
 *                         text in files and commands. Database and connector changes are not
 *                         gated here: Luke approves those by typing in chat (.claude/rules/core.md, Safety).
 *   node guard.cjs stop   Stop: runs the typecheck once per turn and sends Claude back to
 *                         fix errors in files that session touched (only once in a row, so it
 *                         cannot loop). Errors elsewhere are other sessions' work in progress.
 *
 * The hook reads its request as JSON on stdin and answers with JSON on stdout.
 * Secret values are compared here and never printed.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function answer(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

// ---- 1. Secrets ------------------------------------------------------------------------

const ENV_FILE = /\.env\.local/i; // .env.local and .env.local.txt

// Values from .env.local that are not public. NEXT_PUBLIC_* values reach the browser anyway.
function privateEnvValues() {
  const values = [];
  for (const name of ['.env.local', '.env.local.txt']) {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m || m[1].startsWith('NEXT_PUBLIC_')) continue;
      const value = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (value.length >= 12) values.push(value);
    }
  }
  return values;
}

const SECRET_SHAPES = [
  [/sbp_[A-Za-z0-9]{20,}/, 'a Supabase access token (sbp_...)'],
  [/sb_secret_[A-Za-z0-9_-]{16,}/, 'a Supabase secret key (sb_secret_...)'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'],
  [/\bsk_live_[A-Za-z0-9]{16,}/, 'a live Stripe key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/, 'a GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
];

// A Supabase JWT is only secret when its role is service_role; the anon key is public.
function hasServiceRoleJwt(text) {
  const jwt = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g;
  let m;
  while ((m = jwt.exec(text))) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload && payload.role === 'service_role') return true;
    } catch {
      // not a readable JWT; ignore
    }
  }
  return false;
}

function secretIn(text) {
  if (!text) return null;
  for (const value of privateEnvValues()) {
    if (text.includes(value)) return 'a value copied from .env.local';
  }
  for (const [shape, label] of SECRET_SHAPES) {
    if (shape.test(text)) return label;
  }
  if (hasServiceRoleJwt(text)) return 'a Supabase service_role key';
  return null;
}

// ---- PreToolUse ------------------------------------------------------------------------

function pre(input) {
  const tool = input.tool_name || '';
  const args = input.tool_input || {};

  if (tool.startsWith('mcp__')) return;

  // Paths a tool would touch.
  const paths = [args.file_path, args.notebook_path, args.path, args.pattern, args.glob].filter(
    (p) => typeof p === 'string',
  );
  if (paths.some((p) => ENV_FILE.test(p))) {
    answer('deny', '.env.local holds the secrets and is off limits. Ask Luke if a value in it needs changing.');
  }

  // Text a tool would write or run.
  let text = '';
  if (tool === 'Write') text = args.content;
  else if (tool === 'Edit') text = args.new_string;
  else if (tool === 'MultiEdit') text = (args.edits || []).map((e) => e.new_string).join('\n');
  else if (tool === 'NotebookEdit') text = args.new_source;
  else if (tool === 'Bash' || tool === 'PowerShell') text = args.command;
  text = typeof text === 'string' ? text : '';

  if (tool === 'Bash' || tool === 'PowerShell') {
    if (ENV_FILE.test(text)) {
      answer('deny', 'This command names .env.local, which holds the secrets and is off limits.');
    }
  }

  const secret = secretIn(text);
  if (secret) {
    answer('deny', `This contains what looks like ${secret}. Secrets live in .env.local only, never in code, commands or commits.`);
  }
}

// ---- Stop: typecheck once per turn -------------------------------------------------------
//
// Several sessions share this folder and the typecheck reads all of it, so it also sees other sessions'
// half-written files. Eight sessions were sent back to "fix" those (2026-10-30 .. 11-02), one of them a session
// that had only changed Edge settings. So a session is sent back only for errors in files its own tool calls named
// (an Edit, a Write, a command; read from its transcript); verify before a commit still sees every error.
// And a typecheck is not run again while no source has changed since the last one (it takes about 15 seconds):
// the last answer is kept per folder in the system temp folder, for every session's turn ends.

const TYPECHECK_CACHE = path.join(os.tmpdir(), 'debaser-typecheck', `${crypto.createHash('sha1').update(ROOT).digest('hex')}.json`);
// Tools that can change a file. Read, Grep and the rest only look, so a file a session only read is not "touched".
const CHANGING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Agent', 'Task']);

// What the typecheck reads: every .ts/.tsx under the folder (dot-folders, node_modules and Temp skipped, as tsc
// skips them), the types Next generates, the config and the installed packages. The list of names catches a
// deleted file; the newest time catches an edit. Taken before a run, so an edit during it makes the next turn rerun.
function sourceStamp() {
  const names = [];
  let newest = 0;
  const note = (rel) => {
    try {
      newest = Math.max(newest, fs.statSync(path.join(ROOT, rel)).mtimeMs);
      names.push(rel);
    } catch {
      // not there
    }
  };
  const walk = (rel) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'Temp') walk(child);
      } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) note(child);
    }
  };
  walk('');
  walk('.next/types');
  walk('.next/dev/types');
  ['tsconfig.json', 'package.json', 'node_modules/.package-lock.json'].forEach(note);
  return `${crypto.createHash('sha1').update(names.sort().join('\n')).digest('hex')}:${newest}`;
}

function typecheck() {
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  try {
    // Same as `npm run typecheck`; called through node because this machine cannot spawn .cmd shims.
    execFileSync(process.execPath, [tsc, '--noEmit'], { cwd: ROOT, stdio: 'pipe', timeout: 170000 });
    return { ok: true, out: '' };
  } catch (err) {
    return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}`.trim() };
  }
}

// tsc's errors, each with its file: `app/x.ts(4,28): error TS2307: ...`, then any indented lines that belong to it.
function errorsIn(out) {
  const errors = [];
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^(\S[^(]*)\(\d+,\d+\): error /);
    if (match) errors.push({ file: match[1].replace(/\\/g, '/').toLowerCase(), lines: [line] });
    else if (errors.length > 0 && line.trim() !== '') errors[errors.length - 1].lines.push(line);
  }
  return errors;
}

// Everything this session's file-changing tool calls named, lower-case with forward slashes; null when the
// transcript cannot be read, which means "cannot tell whose", so every error counts.
function touchedText(transcriptPath) {
  let text;
  try {
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }
  const named = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"tool_use"')) continue; // skips the long tool results, which only say "tool_use_id"
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry && entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'tool_use' && CHANGING_TOOLS.has(block.name)) named.push(JSON.stringify(block.input || {}));
    }
  }
  return named.join('\n').replace(/\\\\/g, '/').toLowerCase();
}

function stop(input) {
  const stamp = sourceStamp();
  let result = null;
  try {
    const kept = JSON.parse(fs.readFileSync(TYPECHECK_CACHE, 'utf8'));
    if (kept.stamp === stamp) result = kept;
  } catch {
    // nothing kept yet, or another session was writing it
  }
  if (result === null) {
    result = typecheck();
    // A run that failed without a single error line (a timeout, tsc missing) is not kept: the next turn tries again.
    if (result.ok || errorsIn(result.out).length > 0) {
      try {
        fs.mkdirSync(path.dirname(TYPECHECK_CACHE), { recursive: true });
        fs.writeFileSync(TYPECHECK_CACHE, JSON.stringify({ stamp, ...result }));
      } catch {
        // not kept: the next turn runs it again
      }
    }
  }
  if (result.ok) process.exit(0);

  const errors = errorsIn(result.out);
  const touched = errors.length > 0 ? touchedText(input.transcript_path) : null;
  const mine = touched === null ? null : errors.filter((error) => touched.includes(error.file));
  if (mine !== null && mine.length === 0) process.exit(0); // only other sessions' work in progress

  const out = (mine === null ? result.out.split('\n') : mine.flatMap((error) => error.lines)).slice(0, 40).join('\n');
  const others = mine === null ? 0 : errors.length - mine.length;
  const note = others > 0 ? `\n(${others} more in files this session never touched: another session's work in progress. Leave those alone.)` : '';
  if (input.stop_hook_active) {
    // Already sent back once this turn: let the turn end, but say so.
    process.stdout.write(JSON.stringify({ systemMessage: `Typecheck still failing at the end of the turn:\n${out}${note}` }));
    process.exit(0);
  }
  const which = mine === null ? '' : ' in files this session changed';
  process.stdout.write(
    JSON.stringify({ decision: 'block', reason: `npm run typecheck failed${which}. Fix these before finishing:\n${out}${note}` }),
  );
  process.exit(0);
}

const input = readStdin();
try {
  if (process.argv[2] === 'stop') stop(input);
  else pre(input);
} catch (err) {
  // A bug in the guard should make Luke look, not silently let things through.
  if (process.argv[2] !== 'stop') answer('ask', `The safety hook hit an error (${err.message}); approve only if this is safe.`);
}
process.exit(0);
