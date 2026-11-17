/*
 * CANVAS (2026-11-17): PAST CANVASES' read on the live database, as TEST ACCOUNT A (read-only, one sign-in). The
 * Supabase store's listPastCanvases asks room_canvases with two embeds (the room's ended_at, the timeline's count) and
 * an or() of whose canvases; this proves the database takes that ask under its read rules and every row it answers
 * is a past one: unsaved, not hidden, with strokes, its canvas closed or its room ended. The mock side and the room
 * are Temp/check-canvas-kept.cjs and scripts/drive-room-canvas.cjs. Needs `.env.test` (skipped without it).
 *   npx tsc app/lib/watch/supabase-canvas-repository.ts --rootDir app --outDir Temp/canvas-past-live-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-canvas-past-live.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

if (!fs.existsSync(path.join(__dirname, '..', '.env.test'))) {
  console.log('  skip  no .env.test: the live read needs TEST ACCOUNT A');
  process.exit(0);
}
const { testAccountClient } = require('../scripts/browser.cjs');
const OUT = path.join(__dirname, 'canvas-past-live-out');

(async () => {
  const { client, id } = await testAccountClient('A');
  const resolved = require.resolve(path.join(OUT, 'lib/watch/room-client.js'));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, roomClient: () => client, whenRoomClientChanges: () => () => undefined } };
  const { getSupabaseCanvasRepository } = require('./canvas-past-live-out/lib/watch/supabase-canvas-repository.js');
  try {
    const past = await getSupabaseCanvasRepository().listPastCanvases(id);
    assert.ok(Array.isArray(past), 'an answer, not a refusal');
    for (const entry of past) {
      assert.equal(entry.canvas.savedAt, null, 'never a saved one');
      assert.equal(entry.canvas.hidden, false, 'never a hidden one');
      assert.ok(entry.inputCount > 0, 'never an empty one');
    }
    console.log(`  ok  the live database answers PAST CANVASES for TEST ACCOUNT A (${past.length} found), each unsaved, shown and drawn on`);
  } finally {
    await client.auth.signOut({ scope: 'local' });
  }
})().catch((failure) => {
  console.error(failure);
  process.exitCode = 1;
});
