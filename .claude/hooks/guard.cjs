#!/usr/bin/env node
/*
 * Claude Code hook guard (wired up in .claude/settings.json).
 *
 *   node guard.cjs pre    PreToolUse: keeps .env.local out of reach and refuses secret-looking
 *                         text in files and commands. Database and connector changes are not
 *                         gated here: Luke approves those by typing in chat (CLAUDE.md, Safety).
 *   node guard.cjs stop   Stop: runs the typecheck once per turn and sends Claude back to
 *                         fix any errors (only once in a row, so it cannot loop).
 *
 * The hook reads its request as JSON on stdin and answers with JSON on stdout.
 * Secret values are compared here and never printed.
 */
const fs = require('fs');
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

function stop(input) {
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  try {
    // Same as `npm run typecheck`; called through node because this machine cannot spawn .cmd shims.
    execFileSync(process.execPath, [tsc, '--noEmit'], { cwd: ROOT, stdio: 'pipe', timeout: 170000 });
    process.exit(0);
  } catch (err) {
    const out = `${err.stdout || ''}${err.stderr || ''}`.trim().split('\n').slice(0, 40).join('\n');
    if (input.stop_hook_active) {
      // Already sent back once this turn: let the turn end, but say so.
      process.stdout.write(JSON.stringify({ systemMessage: `Typecheck still failing at the end of the turn:\n${out}` }));
      process.exit(0);
    }
    process.stdout.write(
      JSON.stringify({ decision: 'block', reason: `npm run typecheck failed. Fix these before finishing:\n${out}` }),
    );
    process.exit(0);
  }
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
