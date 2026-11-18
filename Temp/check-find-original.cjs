/*
 * Scratch check for the catalogue's "same bytes, same file" rule after the move to Luke's PC (run from the root):
 *   npx tsc app/lib/media/upload.ts --outDir Temp/find-original --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-find-original.cjs
 *
 * What it is for (2026-11-18, SPEC-self-hosting.md): some files stayed locked in the old cloud project until Stage 6, and
 * re-uploading one of them was answered "ALREADY ON THE SITE ... NOT FILED YET" and pointed back at the missing file
 * (Luke: "it wont allow since its already technically filed"). findOriginal must reuse an original only when its file
 * answers, and otherwise let the upload go ahead. Proves it with the real compiled findOriginal: the repository and the
 * browser parts (fingerprint, fetch) are stand-ins.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, 'find-original');
function stub(file, exports) {
  const resolved = require.resolve(path.join(OUT, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

let catalogued = null;
stub('media/repository.js', { getMediaRepository: () => ({ findBySha: async () => catalogued }) });
stub('media/fingerprint.js', {
  sha256Hex: async () => 'abc123',
  imageLooksHash: async () => undefined,
  imageSize: async () => undefined,
  mediaLength: async () => undefined,
  hashDistance: () => 0,
  LOOKS_ALIKE_DISTANCE: 0,
});
stub('media/catalogue.js', { refreshCatalogue: async () => undefined });

const asked = [];
global.fetch = async (url) => {
  asked.push(String(url));
  const missing = String(url).includes('missing');
  return { ok: !missing, status: missing ? 500 : 206, body: { cancel: async () => undefined } };
};

const { findOriginal } = require(path.join(OUT, 'media/upload.js'));
const file = { name: 'kaiji.png', type: 'image/png', size: 52377 };

(async () => {
  catalogued = null;
  let r = await findOriginal('image', file);
  assert.equal(r.original, null, 'nothing catalogued: nothing to reuse');
  assert.equal(asked.length, 0, 'nothing catalogued: no file is asked for');

  catalogued = { id: 'm1', title: 'GOOD MORNING // PICTURE v1', src: 'https://api.debaser.site/storage/v1/object/public/avatars/u/present.png' };
  r = await findOriginal('image', file);
  assert.equal(r.original?.id, 'm1', 'an original whose file answers is reused, as before');
  assert.equal(r.fingerprint.sha256, 'abc123', 'the fingerprint still comes back for the upload');

  catalogued = { id: 'm2', title: 'GOOD MORNING // PICTURE v1', src: 'https://api.debaser.site/storage/v1/object/public/avatars/u/missing.png' };
  r = await findOriginal('image', file);
  assert.equal(r.original, null, 'an original whose file is missing is NOT reused, so the new upload goes ahead');

  global.fetch = async () => { throw new Error('offline'); };
  catalogued = { id: 'm3', title: 'X', src: '/assets/media/x.png' };
  r = await findOriginal('image', file);
  assert.equal(r.original, null, 'a file that cannot be asked for at all counts as missing');

  console.log('ok: findOriginal reuses only an original whose file answers (4 cases)');
})().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
