/*
 * Check for the Cloudflare Worker in front of debaser.site (cloudflare/asleep, list 5 HOSTING: "A 'sleeping' page for when
 * your PC is off"). Runs the real Worker in Node with a stand-in for the site:
 *   node Temp/check-asleep-worker.cjs
 * It must pass the site through whenever the site answers, and answer for it only when the site can't be reached.
 */
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

(async () => {
  const worker = (await import(pathToFileURL(path.join(__dirname, '..', 'cloudflare', 'asleep', 'src', 'index.js')).href)).default;
  let answers = [];
  let asked = 0;
  global.fetch = async () => {
    asked++;
    const next = answers.shift();
    if (next === 'throw') throw new Error('network');
    return new Response(`site ${next}`, { status: next });
  };
  const ask = (pathname, method = 'GET') => worker.fetch(new Request(`https://debaser.site${pathname}`, { method, body: method === 'POST' ? 'x' : undefined }));

  answers = [200]; asked = 0;
  let r = await ask('/forum');
  assert.equal(r.status, 200, 'the site up: its own answer');
  assert.equal(await r.text(), 'site 200');

  answers = [530]; asked = 0;
  r = await ask('/forum');
  assert.equal(r.status, 503, 'the tunnel down (PC off): the asleep page');
  const page = await r.text();
  assert.match(page, /DEBASER_OS IS ASLEEP/);
  assert.match(page, /SWITCHED OFF/);
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(r.headers.get('cache-control'), 'no-store', 'never cached, so the site shows the moment it wakes');
  assert.equal(asked, 1, 'a 530 is not asked again');

  answers = [502, 502]; asked = 0;
  r = await ask('/media');
  assert.equal(r.status, 503, 'nothing behind the tunnel (502 twice): the asleep page');
  assert.equal(asked, 2, 'a 502 is asked once more');

  answers = [502, 200]; asked = 0;
  r = await ask('/media');
  assert.equal(r.status, 200, 'a switch blip (502, then the site): the site, no asleep page');

  answers = ['throw']; asked = 0;
  r = await ask('/forum');
  assert.equal(r.status, 503, 'no answer at all: the asleep page');

  answers = [530]; asked = 0;
  r = await ask('/api/version');
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8', '/api/* stays machine-readable');
  assert.deepEqual(await r.json(), { error: 'DEBASER_OS IS ASLEEP', asleep: true });

  answers = [503]; asked = 0;
  r = await ask('/api/web/live');
  assert.equal(await r.text(), 'site 503', "the site's own 503 passes through");

  answers = [404]; asked = 0;
  r = await ask('/nowhere');
  assert.equal(r.status, 404, "the site's own not-found passes through");

  answers = [502]; asked = 0;
  r = await ask('/api/profile/avatar', 'POST');
  assert.equal(r.status, 503, 'a POST that fails gets the asleep answer');
  assert.equal(asked, 1, 'a POST is never sent twice');

  console.log('ok: the asleep Worker passes the site through and answers only when it is unreachable (10 cases)');
})().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
