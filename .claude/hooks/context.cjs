#!/usr/bin/env node
/*
 * Context hooks (wired up in .claude/settings.json; Luke, 2026-11-27: "Auto-shrink" at "300k tokens").
 *
 * Every session on this repo is compacted automatically at 300,000 tokens (`autoCompactWindow`). These hooks make
 * sure nothing is lost when that happens:
 *
 *   node context.cjs stop        Stop: once a session's conversation passes WARN_AT tokens, sends it back ONCE to
 *                                bring its notes or hand-over up to date before the compaction. Re-arms after the
 *                                conversation falls below REARM_AT (after a compaction). Never loops: it does
 *                                nothing while `stop_hook_active` is set.
 *   node context.cjs precompact  PreCompact: tells the summary what it must keep (stdout becomes its instructions).
 *   node context.cjs start       SessionStart (after compact or clear): tells the session to re-read its notes.
 *
 * The size is read from the session's own transcript: the last main-conversation reply's `usage` (input plus cache
 * reads and writes = everything it re-read). Fails open: anything it can't read lets the session go on.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const WARN_AT = 250000;
const REARM_AT = 200000;
const COMPACT_AT = 300000;
const DIR = path.join(os.tmpdir(), 'claude-context-warn');
const TAIL_BYTES = 512 * 1024;

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

// The context size of the session's latest reply, or 0 when it can't be read.
function contextSize(transcriptPath) {
  try {
    const stat = fs.statSync(transcriptPath);
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue; // the first line of the tail may be cut
      }
      if (row.isSidechain || row.type !== 'assistant') continue;
      const u = row.message && row.message.usage;
      if (!u) continue;
      return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    }
  } catch {
    /* fail open */
  }
  return 0;
}

function markerFile(session) {
  return path.join(DIR, String(session).replace(/[^A-Za-z0-9_-]/g, '') + '.json');
}

function stop(req) {
  if (req.stop_hook_active || !req.session_id || !req.transcript_path) return;
  const size = contextSize(req.transcript_path);
  if (!size) return;
  fs.mkdirSync(DIR, { recursive: true });
  const file = markerFile(req.session_id);
  let armed = true;
  try {
    armed = JSON.parse(fs.readFileSync(file, 'utf8')).armed !== false;
  } catch {
    /* no marker yet: armed */
  }
  if (size < REARM_AT) {
    if (!armed) fs.writeFileSync(file, JSON.stringify({ armed: true }));
    return;
  }
  if (size < WARN_AT || !armed) return;
  fs.writeFileSync(file, JSON.stringify({ armed: false, at: size, when: new Date().toISOString() }));
  const k = Math.round(size / 1000);
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        `Context is about ${k}k tokens; this session is compacted automatically at ${COMPACT_AT / 1000}k (Luke, 2026-11-27). ` +
        'Before that, bring your notes up to date in full (the `handoff` skill): your hand-over or coordinator-notes.md in ' +
        "the group's notes folder, and docs/STATE.md if a line of it changed. Anything not written there or in git is lost " +
        'at the compaction. If you keep no notes file (a one-off task), say in one line what is done and left, then stop.',
    }),
  );
}

function precompact() {
  process.stdout.write(
    'Keep, word for word where it matters: the task and Luke\'s exact words for it; the list of changed files and commits; ' +
      'the current plan and which steps are done; the verification commands; the path of this session\'s notes or ' +
      'hand-over file and its notes folder; every session it started or talks to (name, id, task, what it waits on); ' +
      'Luke\'s open questions and his answers quoted with dates; anything waiting on Luke.\n',
  );
}

function start(req) {
  const how = req.source === 'clear' ? 'cleared' : 'compacted';
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          `This conversation was just ${how}. Before carrying on: read docs/STATE.md, then your own notes: ` +
          "the coordinator reads coordinator-notes.md in its notes folder and docs/sessions.md; a builder reads its " +
          '<task>-handover.md and brief in the notes folder named in the summary. Carry on from their Next list.',
      },
    }),
  );
}

const mode = process.argv[2];
const req = readStdin();
try {
  if (mode === 'stop') stop(req);
  else if (mode === 'precompact') precompact();
  else if (mode === 'start') start(req);
} catch {
  /* fail open */
}
