#!/usr/bin/env node
/*
 * Agent cap (wired up in .claude/settings.json, PreToolUse on Agent).
 *
 * Counts subagent launches per session and refuses the one after MAX_AGENTS. A new session
 * starts at 0. Each launch claims one numbered file (`<session>.<n>`, created only if it isn't
 * there yet), so agents launched together can't read the same count and slip past the cap.
 * The files live in the system temp folder and are removed after two days.
 * Fails open: a request it can't read goes ahead, so a broken counter never stops work.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_AGENTS = 10;
const DIR = path.join(os.tmpdir(), 'claude-agent-limit');
const STALE_MS = 2 * 24 * 60 * 60 * 1000;

function readRequest() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function removeStale() {
  for (const name of fs.readdirSync(DIR)) {
    const old = path.join(DIR, name);
    try {
      if (Date.now() - fs.statSync(old).mtimeMs > STALE_MS) fs.rmSync(old, { force: true });
    } catch {
      // another launch removed it first
    }
  }
}

// True when a free slot was claimed; false when all MAX_AGENTS are taken.
function claimSlot(session) {
  for (let n = 1; n <= MAX_AGENTS; n++) {
    try {
      fs.closeSync(fs.openSync(path.join(DIR, `${session}.${n}`), 'wx'));
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  return false;
}

const session = String(readRequest().session_id || '').replace(/[^A-Za-z0-9_-]/g, '');
if (!session) process.exit(0);

try {
  fs.mkdirSync(DIR, { recursive: true });
  removeStale();
  if (!claimSlot(session)) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Agent cap (${MAX_AGENTS}) reached for this session. Do the rest here, or tell Luke a fresh session is needed.`,
        },
      }),
    );
    process.exit(0);
  }
} catch {
  // fail open
}
process.exit(0);
