/*
 * No YouTube Shorts anywhere in MEDIA, and never a song lost to the rule (Luke, 2026-11-14: "im noticing that youtube shorts
 * still appear in the media tab, i want them exluded from the results entirely"; "make sure the shorts thing doesnt affect any
 * music on youtube at all"). Offline: a fake YouTube answers the /shorts/ check.
 *   npx tsc app/lib/web/search/shorts-check.ts app/lib/web/shorts-client.ts --rootDir app/lib --outDir Temp/web-shorts-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-web-shorts.cjs
 *
 * Known ids (checked live against YouTube on 2026-11-14 with Temp/browse/shorts-live-proof.cjs): EycY6jDFK74 and YsKxkP_kGbE
 * are Shorts (200); dQw4w9WgXcQ is a music video (303 to /watch).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const check = require('./web-shorts-out/web/search/shorts-check.js');
const shorts = require('./web-shorts-out/web/shorts.js');

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const SHORTS = new Set(['EycY6jDFK74', 'YsKxkP_kGbE', 'musicShort1']);
let asked = [];
/** YouTube as it answers with the consent cookie: 200 for a Short, 303 to /watch for any other; `broken` ids fail. */
const youtube = (broken = new Set()) => async (url, init) => {
  const id = /\/shorts\/([A-Za-z0-9_-]{11})$/.exec(url)?.[1];
  asked.push({ id, method: init?.method, cookie: init?.headers?.Cookie, redirect: init?.redirect });
  if (broken.has(id)) throw new Error('network');
  if (id === 'consentPage') return new Response(null, { status: 302, headers: { location: 'https://consent.youtube.com/m?continue=x' } });
  return SHORTS.has(id) ? new Response(null, { status: 200 }) : new Response(null, { status: 303, headers: { location: `https://www.youtube.com/watch?v=${id}` } });
};
const video = (id, extra = {}) => ({ id: `youtube:${id}`, platform: 'youtube', externalId: id, kind: 'video', url: `https://youtu.be/${id}`, title: `Video ${id}`, publishedAt: '2026-01-01T00:00:00.000Z', fetchedAt: '2026-01-01T00:00:00.000Z', ...extra });

(async () => {
  // How YouTube's answer reads.
  assert.equal(check.readShortsAnswer(200, null), true, '200: a Short');
  assert.equal(check.readShortsAnswer(303, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'), false, 'sent on to /watch: not a Short');
  assert.equal(check.readShortsAnswer(302, 'https://consent.youtube.com/m?continue=x'), null, 'a consent page: unsure');
  assert.equal(check.readShortsAnswer(404, null), null, 'an error: unsure');

  // Asked once, HEAD only, no redirect followed, with the consent cookie; answers kept.
  check.forgetShortAnswers();
  asked = [];
  const answers = await check.askShorts(['EycY6jDFK74', 'dQw4w9WgXcQ', 'consentPage', 'not an id!!'], { fetch: youtube() });
  assert.equal(answers.get('EycY6jDFK74'), true);
  assert.equal(answers.get('dQw4w9WgXcQ'), false, 'a music video under three minutes is not a Short');
  assert.equal(answers.get('consentPage'), null);
  assert.equal(asked.length, 3, 'a malformed id is never asked');
  assert.ok(asked.every((one) => one.method === 'HEAD' && one.redirect === 'manual' && one.cookie === 'SOCS=CAI'), 'HEAD, no redirect followed, the "reject all" consent cookie');
  asked = [];
  await check.askShorts(['EycY6jDFK74', 'dQw4w9WgXcQ'], { fetch: youtube() });
  assert.equal(asked.length, 0, 'a known answer is not asked again');

  // dropShorts: only confirmed or marked Shorts go; music only when YouTube confirms; length never decides; unsure stays.
  check.forgetShortAnswers();
  asked = [];
  const items = [
    video('EycY6jDFK74'), // a Short, no marks: confirmed and dropped
    video('dQw4w9WgXcQ', { durationSeconds: 213 }), // a music video over three minutes: never asked
    video('songUnder3m', { durationSeconds: 150, creator: 'Some Band' }), // a short song: asked, kept
    video('topicTagged', { durationSeconds: 120, creator: 'Some Band - Topic', title: 'Song #shorts' }), // music with a tag: kept
    video('musicShort1', { durationSeconds: 40, creator: 'Some Band - Topic' }), // music YouTube confirms is a Short: dropped
    video('taggedShort', { title: 'Cat #shorts' }), // marked: dropped without asking
    video('brokenCheck', { durationSeconds: 30 }), // the check fails: kept
    { ...video('archive0001'), platform: 'internet_archive', id: 'internet_archive:archive0001' }, // not YouTube: untouched
  ];
  const kept = (await check.dropShorts(items, { fetch: youtube(new Set(['brokenCheck'])) })).map((item) => item.externalId);
  assert.deepEqual(kept, ['dQw4w9WgXcQ', 'songUnder3m', 'topicTagged', 'brokenCheck', 'archive0001'], `kept: ${kept}`);
  assert.ok(!asked.some((one) => one.id === 'dQw4w9WgXcQ'), 'over three minutes: not asked');
  assert.ok(!asked.some((one) => one.id === 'taggedShort'), 'marked: not asked');
  assert.equal(shorts.isShort(items[3]), false, 'a "- Topic" music row is never a Short by its marks');
  assert.equal(shorts.isMusicItem(items[3]), true);

  // The browser's filter (the saved stream, read from the database): asks our own route, drops only confirmed Shorts.
  global.window = { setTimeout };
  const seen = [];
  global.fetch = async (url) => {
    seen.push(url);
    const ids = new URL(url, 'https://debaser.site').searchParams.get('ids').split(',');
    return new Response(JSON.stringify({ shorts: ids.filter((id) => SHORTS.has(id)) }), { status: 200 });
  };
  const client = require('./web-shorts-out/web/shorts-client.js');
  const stream = [video('EycY6jDFK74'), video('YsKxkP_kGbE'), video('dQw4w9WgXcQ'), video('songUnder3m', { durationSeconds: 150 })];
  assert.deepEqual((await client.withoutShorts(stream)).map((item) => item.externalId), ['dQw4w9WgXcQ', 'songUnder3m'], 'saved Shorts are dropped as they are read');
  assert.equal(seen.length, 1, 'one ask for the page');
  assert.match(seen[0], /^\/api\/web\/shorts\?ids=/, 'through our own route, never YouTube from the browser');
  global.fetch = async () => {
    throw new Error('offline');
  };
  assert.equal((await client.withoutShorts([video('unknownAAAA')])).length, 1, 'the route cannot be asked: the row stays');

  // Every path is wired.
  assert.match(read('app/lib/web/search/run.ts'), /if \(deps\.dropShorts !== undefined\) \{/, 'search: every list, before it is merged');
  assert.match(read('app/api/web/search/route.ts'), /dropShorts: \(items: WebItem\[\]\) => dropShorts\(items\),/, '... the route hands the check in');
  assert.match(read('app/lib/web/ingest.ts'), /if \(source\.platform === 'youtube' && deps\.dropShorts !== undefined\) \{/, 'the hourly run saves no Shorts');
  assert.match(read('app/api/web/ingest/route.ts'), /\{ dropShorts: \(items\) => dropShorts\(items\) \}/);
  // Updated on purpose 2026-11-14 (YOUTUBE session: uploads and likes come back apart): the likes are asked about, and the
  // one list of both keeps only what stays. The uploads list already has no Shorts.
  assert.match(read('app/api/web/youtube/mine/route.ts'), /const liked = await dropShorts\(mine\.liked\)\.catch\(\(\) => mine\.liked\);/, 'YOUR YOUTUBE: a liked Short goes');
  assert.match(read('app/api/web/youtube/mine/route.ts'), /liked, items: mine\.items\.filter\(\(item\) => stays\.has\(item\.id\)\)/, '... from the likes and from the list of both');
  const repo = read('app/lib/web/repository.ts');
  assert.match(repo, /return withoutShortsRepository\(WEB_DATA_SOURCE === 'supabase'/, 'the saved stream as read, mock and live alike');
  assert.doesNotMatch(repo, /getItem: async/, 'what the music bar or a queue reads back by id is never taken away');
  assert.match(read('app/components/WebStream.tsx'), /const hiddenShort = useHiddenShort\(item\);\n  if \(hiddenShort\) return null;/, 'the last net, on every row MEDIA draws (picks, catalogue)');
  assert.match(read('app/api/web/shorts/route.ts'), /const MAX_IDS = 60;/);
  assert.doesNotMatch(read('app/lib/web/shorts-client.ts'), /youtube\.com/, 'the browser never asks YouTube itself');
  assert.match(read('app/lib/web/use-hidden-short.ts'), /^'use client';/, 'the row hook lives in a client file');
  assert.doesNotMatch(read('app/lib/web/shorts-client.ts'), /from 'react'/, 'shorts-client.ts stays free of React (the repository reads it)');

  console.log('ok: no YouTube Shorts: confirmed by YouTube or marked; music only when confirmed; unsure stays; every path wired');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
